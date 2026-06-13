const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const http = require("http");
const config = require("./config");

const pendingPayments = new Map();
const pendingRegistrations = new Map();
const pendingTicketRequests = new Map();
const pendingPixPrompts = new Map();
const TEMP_MESSAGE_MS = 10_000;
const PORT = Number(process.env.PORT || 3000);

http
  .createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end(`Bot ${config.shopName} online\n`);
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`Healthcheck HTTP ouvindo na porta ${PORT}`);
  });

process.on("unhandledRejection", (error) => {
  if (error?.code === 50013) {
    console.error("Permissao ausente no Discord. Confira hierarquia do cargo do bot e permissoes.");
    return;
  }

  console.error("Erro nao tratado:", error);
});

process.on("uncaughtException", (error) => {
  console.error("Excecao nao tratada:", error);
});

process.on("SIGTERM", () => {
  console.error("Recebi SIGTERM do host. O processo foi encerrado externamente.");
  process.exit(0);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Bot online como ${readyClient.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();
    const command = content.split(/\s+/)[0]?.toLowerCase();

    const pendingPix = pendingPixPrompts.get(message.author.id);
    if (pendingPix && pendingPix.channelId === message.channel.id) {
      await handlePixAmountResponse(message, content);
      return;
    }

    if (command === "!help") {
      await sendHelp(message);
      return;
    }

    if (command === "!setup") {
      if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await sendTemporaryReply(message, "Apenas administradores podem usar este comando.");
        return;
      }

      const result = await setupGuild(message.guild);
      await sendRegistrationPanel(result.connectChannel);
      await sendTicketPanel(result.ticketPanelChannel);
      await sendTemporaryReply(message, "Servidor configurado. Criei/ajustei cargos, canais, permissoes e paineis.");
      return;
    }

    if (command === "!painel-tickets") {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        await sendTemporaryReply(message, "Voce precisa da permissao `Gerenciar servidor` para enviar este painel.");
        return;
      }

      await sendTicketPanel(message.channel);
      await sendTemporaryReply(message, "Painel de tickets enviado.");
      return;
    }

    if (command === "!painel-verificacao") {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        await sendTemporaryReply(message, "Voce precisa da permissao `Gerenciar servidor` para enviar este painel.");
        return;
      }

      await sendVerificationPanel(message.channel);
      await sendTemporaryReply(message, "Painel de verificacao enviado.");
      return;
    }

    if (command === "!cobrar") {
      await handlePaymentCommand(message, content);
      return;
    }

    if (command === "!pix") {
      await handlePixPromptCommand(message, content);
      return;
    }

    if (command === "!add" || command === "!adicionar") {
      await handleAddTicketMemberCommand(message);
      return;
    }

    if (command === "!notify" || command === "!notificar") {
      await handleNotifyTicketCommand(message, content);
      return;
    }

    if (command === "!assumir") {
      await handleClaimTicketCommand(message);
      return;
    }

    if (command === "!finalizar" || command === "!fechar") {
      await handleFinalizeTicketCommand(message, content);
      return;
    }
  } catch (error) {
    console.error(error);
    await sendTemporaryReply(message, "Algo deu errado ao executar esse comando. Veja os logs do bot.").catch(() => {});
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  await member.guild.channels.fetch().catch(() => null);
  const welcomeChannel = await getWelcomeChannel(member.guild);
  if (!welcomeChannel) {
    console.error("Canal de boas-vindas nao encontrado. Configure WELCOME_CHANNEL_ID ou rode !setup.");
    return;
  }

  const embed = buildStoreEmbed({ imageUrl: config.welcomeBannerUrl })
    .setTitle(`Bem-vindo(a) a ${config.shopName}`)
    .setDescription(
      [
        `${member}, que bom ter voce por aqui.`,
        "",
        "Antes de explorar a loja, passe no canal **connect** e faca seu registro rapidinho.",
        "Prometo que e coisa fofa e leva menos de um minutinho.",
        "",
        "**Depois do registro voce recebe acesso aos canais da loja.**",
      ].join("\n")
    )
    .setFooter({ text: `${config.shopName} - seja bem-vindo(a)` });

  await welcomeChannel.send({ content: `${member}`, embeds: [embed] }).catch((error) => {
    console.error(`Nao consegui enviar boas-vindas em ${welcomeChannel.name}. Codigo: ${error.code || "sem-codigo"}`);
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
      return;
    }

    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
    }
  } catch (error) {
    console.error(error);
    await sendTemporaryInteractionReply(interaction, {
      content: "Algo deu errado ao executar essa acao. Confira minhas permissoes e tente novamente.",
      ephemeral: true,
    });
  }
});

async function sendHelp(message) {
  const embed = buildStoreEmbed({ imageUrl: config.welcomeBannerUrl })
    .setColor(0x8b5cf6)
    .setTitle(`Central de Ajuda - ${config.shopName}`)
    .setDescription(
      [
        "Bem-vindo ao painel de comandos da loja.",
        "Use esta lista para administrar registros, tickets e pagamentos Pix.",
      ].join("\n")
    )
    .addFields(
      {
        name: "Primeiros passos",
        value: [
          "`!help` - Mostra esta central.",
          "`!setup` - Ajusta canais, cargos, logs e paineis.",
          "`!painel-tickets` - Envia o painel de atendimento.",
          "`!painel-verificacao` - Envia o painel de registro.",
        ].join("\n"),
      },
      {
        name: "Registro de entrada",
        value: [
          "`connect` - Canal onde novos membros fazem registro.",
          "`logs-registros` - Guarda nome, interesse e indicacao.",
          "`Cliente` - Cargo liberado ao concluir o registro.",
        ].join("\n"),
      },
      {
        name: "Atendimento",
        value: [
          "`!add @pessoa` - Adiciona alguem ao ticket.",
          "`!assumir` - Marca o ticket como assumido.",
          "`!notificar mensagem` - Envia DM para participantes.",
          "`!finalizar motivo` - Fecha o ticket e salva transcript.",
        ].join("\n"),
      },
      {
        name: "Pagamento Pix",
        value: [
          "`!pix` - Pergunta o valor e gera QR Code.",
          "`!pix 25,50` - Gera Pix direto com valor.",
          "`!cobrar 25,50` - Gera Pix dentro do ticket.",
          "`MERCADO_PAGO_ACCESS_TOKEN` precisa estar configurado.",
        ].join("\n"),
      },
      {
        name: "Logs",
        value: [
          "`logs-tickets` - Tickets finalizados e transcripts.",
          "`logs-registros` - Registros de entrada.",
          "Canais de logs sao privados para a equipe.",
        ].join("\n"),
      }
    )
    .setFooter({ text: `${config.shopName} - sistema de atendimento` });

  await message.reply({ embeds: [embed] });
}

async function sendTemporaryReply(message, options, ttl = TEMP_MESSAGE_MS) {
  const reply = await message.reply(options).catch(() => null);
  setTimeout(() => {
    reply?.delete().catch(() => {});
    message.delete().catch(() => {});
  }, ttl);
  return reply;
}

async function sendTemporaryInteractionReply(interaction, options, ttl = TEMP_MESSAGE_MS) {
  const payload = typeof options === "string" ? { content: options, ephemeral: true } : options;

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(payload).catch(() => {});
  } else {
    await interaction.reply(payload).catch(() => {});
  }

  setTimeout(() => interaction.deleteReply().catch(() => {}), ttl);
}

async function handleCommand(interaction) {
  if (interaction.commandName === "setup") {
    await interaction.deferReply({ ephemeral: true });
    const result = await setupGuild(interaction.guild);
    await sendRegistrationPanel(result.connectChannel);
    await sendTicketPanel(result.ticketPanelChannel);
    await interaction.editReply("Servidor configurado. Criei os canais, cargos e paineis da loja.");
    return;
  }

  if (interaction.commandName === "painel-tickets") {
    await sendTicketPanel(interaction.channel);
    await interaction.reply({ content: "Painel de tickets enviado.", ephemeral: true });
    return;
  }

  if (interaction.commandName === "painel-verificacao") {
    await sendVerificationPanel(interaction.channel);
    await interaction.reply({ content: "Painel de verificacao enviado.", ephemeral: true });
  }
}

async function handleButton(interaction) {
  if (interaction.customId === "verify_member" || interaction.customId === "start_registration") {
    await showNameRegistrationModal(interaction);
    return;
  }

  if (interaction.customId === "continue_registration_referral") {
    const registration = pendingRegistrations.get(interaction.user.id);
    if (!registration?.nickname || !registration?.interest) {
      await sendTemporaryInteractionReply(interaction, "Seu registro expirou. Comece de novo pelo canal connect.");
      return;
    }

    await showReferralRegistrationModal(interaction);
    return;
  }

  if (interaction.customId === "claim_ticket") {
    if (!isStaffMember(interaction.member)) {
      await interaction.reply({ content: "Apenas a equipe pode assumir tickets.", ephemeral: true });
      return;
    }

    await interaction.channel.setTopic(updateTopicValue(interaction.channel.topic, "Assumido", interaction.user.id));
    await interaction.reply(`${interaction.user} assumiu este ticket.`);
    await logTicketEvent(interaction.guild, "Ticket assumido", `${interaction.user} assumiu ${interaction.channel}.`);
    return;
  }

  if (interaction.customId === "notify_ticket_owner") {
    if (!isStaffMember(interaction.member)) {
      await interaction.reply({ content: "Apenas a equipe pode notificar clientes.", ephemeral: true });
      return;
    }

    await notifyTicketParticipants(
      interaction.channel,
      "Ticket respondido",
      `A equipe respondeu seu ticket **#${interaction.channel.name}**. Da uma olhadinha quando puder.`
    );
    await interaction.reply({ content: "Cliente notificado no privado.", ephemeral: true });
    await logTicketEvent(interaction.guild, "Cliente notificado", `${interaction.user} notificou o dono de ${interaction.channel}.`);
    return;
  }

  if (interaction.customId === "close_ticket") {
    const isStaff = isStaffMember(interaction.member);
    const ownsTicket = interaction.channel.topic?.includes(`Dono: ${interaction.user.id}`);

    if (!isStaff && !ownsTicket) {
      await interaction.reply({ content: "Apenas o dono do ticket ou a equipe pode fechar este ticket.", ephemeral: true });
      return;
    }

    await interaction.reply("Ticket finalizado. Vou salvar os logs e apagar este canal em 8 segundos.");
    await finalizeTicket(interaction.channel, interaction.user, "Fechado pelo botao");
  }
}

async function handleSelectMenu(interaction) {
  if (interaction.customId === "registration_interest") {
    const registration = pendingRegistrations.get(interaction.user.id);
    if (!registration) {
      await sendTemporaryInteractionReply(interaction, "Comece pelo botao de registro no canal connect.");
      return;
    }

    registration.interest = interaction.values[0];
    pendingRegistrations.set(interaction.user.id, registration);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("continue_registration_referral")
        .setLabel("Continuar registro")
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.update({
      content: `Perfeito, **${registration.interest}**. Agora falta so contar como voce conheceu a ${config.shopName}.`,
      components: [row],
    });
    return;
  }

  if (interaction.customId !== "ticket_category") return;

  const ticketType = config.ticketTypes.find((type) => type.id === interaction.values[0]);
  if (!ticketType) {
    await sendTemporaryInteractionReply(interaction, "Categoria de ticket invalida.");
    return;
  }

  const existingTicket = interaction.guild.channels.cache.find((channel) => {
    return channel.topic?.includes(`Dono: ${interaction.user.id}`) && channel.topic?.includes(`Tipo: ${ticketType.id}`);
  });

  if (existingTicket) {
    await sendTemporaryInteractionReply(interaction, `Voce ja tem um ticket aberto para essa categoria: ${existingTicket}.`);
    return;
  }

  pendingTicketRequests.set(interaction.user.id, { ticketType });
  await interaction.message.edit({ components: [buildTicketMenuRow()] }).catch(() => {});
  await showTicketSubjectModal(interaction, ticketType);
}

async function handleModalSubmit(interaction) {
  if (interaction.customId === "registration_name") {
    const nickname = interaction.fields.getTextInputValue("registration_nickname").trim();
    if (!nickname) {
      await sendTemporaryInteractionReply(interaction, "O nome/nickname nao pode ficar em branco.");
      return;
    }

    await interaction.member.setNickname(nickname.slice(0, 32), "Registro Iconics Store").catch(() => {});
    pendingRegistrations.set(interaction.user.id, { nickname });

    const interestMenu = new StringSelectMenuBuilder()
      .setCustomId("registration_interest")
      .setPlaceholder("O que voce busca encontrar na loja?")
      .addOptions(
        { label: "Cabelos", description: "Cabelos, estilos e aparencias.", value: "Cabelos", emoji: "💇" },
        { label: "Roupas", description: "Looks, pecas e combinacoes.", value: "Roupas", emoji: "👕" },
        { label: "Site", description: "Ajuda, compras e acesso pelo site.", value: "Site", emoji: "🌐" },
        { label: "Prop", description: "Props, itens e detalhes especiais.", value: "Prop", emoji: "✨" },
        { label: "Parceria", description: "Parcerias, divulgacoes e collabs.", value: "Parceria", emoji: "🤝" },
        { label: "Outro", description: "Algo diferente das opcoes acima.", value: "Outro", emoji: "💜" }
      );

    await interaction.reply({
      content: `Que nome lindo, **${nickname}**. Agora escolha o que voce busca encontrar na ${config.shopName}:`,
      components: [new ActionRowBuilder().addComponents(interestMenu)],
      ephemeral: true,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 120_000);
    return;
  }

  if (interaction.customId === "registration_referral") {
    const referral = interaction.fields.getTextInputValue("registration_referral_answer").trim();
    if (!referral) {
      await sendTemporaryInteractionReply(interaction, "Essa resposta nao pode ficar em branco.");
      return;
    }

    const registration = pendingRegistrations.get(interaction.user.id);
    if (!registration?.nickname || !registration?.interest) {
      await sendTemporaryInteractionReply(interaction, "Seu registro expirou. Comece de novo pelo canal connect.");
      return;
    }

    const role = await getVerifiedRole(interaction.guild).catch((error) => {
      console.error(`Nao consegui criar/encontrar cargo ${config.verifiedRoleName}. Codigo: ${error.code || "sem-codigo"}`);
      return null;
    });

    if (!role) {
      await sendTemporaryInteractionReply(interaction, {
        content: "Registro recebido, mas nao consegui preparar o cargo Cliente. Confira se eu tenho permissao para gerenciar cargos.",
        ephemeral: true,
      }, 20_000);
      return;
    }

    const addedRole = await addRoleSafely(interaction.member, role);

    if (!addedRole) {
      await sendTemporaryInteractionReply(interaction, {
        content: "Registro recebido, mas eu nao consegui dar o cargo de acesso. Coloque meu cargo acima do cargo Cliente e ative Gerenciar cargos.",
        ephemeral: true,
      }, 20_000);
      return;
    }

    pendingRegistrations.delete(interaction.user.id);

    const destinationChannel = await getPostRegistrationChannel(interaction.guild);
    const destinationText = destinationChannel
      ? `Agora pode ir para ${destinationChannel} para continuar.`
      : "Agora voce ja pode explorar os canais liberados da loja.";
    const components = destinationChannel
      ? [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setLabel("Ir para a loja")
              .setStyle(ButtonStyle.Link)
              .setURL(`https://discord.com/channels/${interaction.guild.id}/${destinationChannel.id}`)
          ),
        ]
      : [];

    await sendTemporaryInteractionReply(interaction, {
      content: `Registro concluido. Bem-vindo(a) a **${config.shopName}**, ${registration.nickname}. ${destinationText}`,
      components,
      ephemeral: true,
    }, 60_000);

    await logRegistrationEvent(
      interaction.guild,
      "Novo registro",
      [
        `Usuario: ${interaction.user}`,
        `Nome/Nick: ${registration.nickname}`,
        `Busca: ${registration.interest}`,
        `Como conheceu/indicacao: ${referral}`,
      ].join("\n")
    );
  }

  if (interaction.customId === "ticket_subject") {
    const pendingTicket = pendingTicketRequests.get(interaction.user.id);
    if (!pendingTicket?.ticketType) {
      await sendTemporaryInteractionReply(interaction, "Seu pedido de ticket expirou. Escolha a categoria de novo.");
      return;
    }

    const subject = interaction.fields.getTextInputValue("ticket_subject_text").trim();
    if (!subject) {
      await sendTemporaryInteractionReply(interaction, "O assunto do ticket nao pode ficar em branco.");
      return;
    }

    pendingTicketRequests.delete(interaction.user.id);
    await interaction.deferReply({ ephemeral: true });
    const ticketChannel = await createTicketChannel(interaction, pendingTicket.ticketType, subject);
    await interaction.editReply(`Ticket criado: ${ticketChannel}`);
    setTimeout(() => interaction.deleteReply().catch(() => {}), TEMP_MESSAGE_MS);
  }
}

async function addRoleSafely(member, role) {
  return member.roles.add(role).then(() => true).catch((error) => {
      console.error(`Nao consegui adicionar o cargo ${role.name}. Verifique se o cargo do bot esta acima dele. Codigo: ${error.code || "sem-codigo"}`);
      return false;
    });
}

async function getVerifiedRole(guild) {
  if (config.verifiedRoleId) {
    const roleById = await guild.roles.fetch(config.verifiedRoleId).catch(() => null);
    if (roleById) return roleById;
  }

  return ensureRole(guild, config.verifiedRoleName);
}

async function getPostRegistrationChannel(guild) {
  if (config.postRegistrationChannelId) {
    const channel = await guild.channels.fetch(config.postRegistrationChannelId).catch(() => null);
    if (channel) return channel;
  }

  return findChannelByNames(guild, [config.infoChannelName, "sobre-nos", "chat-geral"], ChannelType.GuildText) || null;
}

async function getWelcomeChannel(guild) {
  if (config.welcomeChannelId) {
    const channel = await guild.channels.fetch(config.welcomeChannelId).catch(() => null);
    if (channel?.type === ChannelType.GuildText) return channel;
  }

  return findChannelByNames(
    guild,
    [
      config.welcomeChannelName,
      "boas-vindas",
      "boas vindas",
      "bem-vindo",
      "bem-vindos",
      "welcome",
    ],
    ChannelType.GuildText
  ) || null;
}

async function setupGuild(guild) {
  const everyone = guild.roles.everyone;
  const verifiedRole = await getVerifiedRole(guild);
  const staffRole = await ensureRole(guild, config.staffRoleName, {
    color: 0x5865f2,
    mentionable: true,
  });

  const publicCategory = await ensureCategory(guild, config.publicCategoryName, [
    { id: everyone.id, allow: [PermissionFlagsBits.ViewChannel] },
  ], ["boas vindas", "Entrada"]);

  const storeCategory = await ensureCategory(guild, config.storeCategoryName, [
    { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: verifiedRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
    { id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageMessages] },
  ], ["Iconics Store", "Loja"]);

  const ticketCategory = await ensureCategory(guild, config.ticketCategoryName, [
    { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
  ], ["Tickets"]);

  const welcomeChannel = await ensureTextChannel(guild, config.welcomeChannelName, publicCategory.id, [
    { id: everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
  ], ["boas-vindas"]);

  const connectChannel = await ensureTextChannel(guild, config.connectChannelName, publicCategory.id, [
    { id: everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
    { id: staffRole.id, allow: [PermissionFlagsBits.SendMessages] },
  ], ["connect"]);

  await ensureTextChannel(guild, config.partnershipsChannelName, publicCategory.id, [
    { id: everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
    { id: staffRole.id, allow: [PermissionFlagsBits.SendMessages] },
  ], ["parcerias"]);

  await ensureTextChannel(guild, config.infoChannelName, storeCategory.id, undefined, ["sobre-nos", "sobre-a-loja"]);
  const ticketPanelChannel = await ensureTextChannel(guild, config.ticketPanelChannelName, storeCategory.id, [
    { id: verifiedRole.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
    { id: staffRole.id, allow: [PermissionFlagsBits.SendMessages] },
  ], ["ticket", "atendimento"]);

  await ensureTextChannel(guild, config.ticketLogsChannelName, ticketCategory.id, [
    { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ], ["logs-tickets"]);

  await ensureTextChannel(guild, config.registrationLogsChannelName, ticketCategory.id, [
    { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ], ["logs-registros"]);

  return { welcomeChannel, connectChannel, ticketPanelChannel, ticketCategory, verifiedRole, staffRole };
}

async function ensureRole(guild, name, options = {}) {
  const existing = guild.roles.cache.find((role) => role.name === name);
  if (existing) return existing;
  return guild.roles.create({ name, reason: `Cargo criado para ${config.shopName}`, ...options });
}

async function ensureCategory(guild, name, permissionOverwrites = [], aliases = []) {
  const existing = findChannelByNames(guild, [name, ...aliases], ChannelType.GuildCategory);
  if (existing) {
    if (existing.name !== name) await existing.setName(name).catch(() => {});
    if (permissionOverwrites.length > 0) await existing.permissionOverwrites.set(permissionOverwrites);
    return existing;
  }

  return guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
    permissionOverwrites,
    reason: `Categoria criada para ${config.shopName}`,
  });
}

async function ensureTextChannel(guild, name, parentId, permissionOverwrites, aliases = []) {
  const existing = findChannelByNames(guild, [name, ...aliases], ChannelType.GuildText);
  if (existing) {
    const edits = {};
    if (existing.name !== name) edits.name = name;
    if (parentId && existing.parentId !== parentId) edits.parent = parentId;
    if (Object.keys(edits).length > 0) await existing.edit(edits);
    if (permissionOverwrites?.length > 0) await existing.permissionOverwrites.set(permissionOverwrites);
    return existing;
  }

  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: parentId,
    permissionOverwrites,
    reason: `Canal criado para ${config.shopName}`,
  });
}

function findChannelByNames(guild, names, type) {
  const normalizedNames = names.map(normalizeDiscordName);
  return guild.channels.cache.find((channel) => {
    return channel.type === type && normalizedNames.includes(normalizeDiscordName(channel.name));
  });
}

function normalizeDiscordName(name) {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/^[-\s]+|[-\s]+$/g, "");
}

async function sendVerificationPanel(channel) {
  await sendRegistrationPanel(channel);
}

async function sendRegistrationPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(0xf0a6ff)
    .setTitle(`Registro ${config.shopName}`)
    .setDescription(
      [
        "**Oi, seja bem-vindo(a).**",
        "Antes de acessar a loja, faca um registro rapidinho para a equipe te conhecer melhor.",
        "",
        "**Como funciona:**",
        "`1` Informe seu nome ou nickname.",
        "`2` Escolha o que voce busca na loja.",
        "`3` Conte como conheceu a gente ou quem te indicou.",
        "",
        "Depois disso eu libero seu acesso automaticamente.",
      ].join("\n")
    )
    .setFooter({ text: `${config.shopName} - registro de entrada` });

  if (config.logoUrl) embed.setThumbnail(config.logoUrl);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("start_registration")
      .setLabel("Fazer registro")
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({ embeds: [embed], components: [row] });
}

async function showNameRegistrationModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("registration_name")
    .setTitle("Registro Iconics Store");

  const nicknameInput = new TextInputBuilder()
    .setCustomId("registration_nickname")
    .setLabel("Qual nome ou nickname voce quer usar?")
    .setPlaceholder("Ex: Maou, Lua, Gabi...")
    .setMinLength(2)
    .setMaxLength(32)
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  modal.addComponents(new ActionRowBuilder().addComponents(nicknameInput));
  await interaction.showModal(modal);
}

async function showReferralRegistrationModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("registration_referral")
    .setTitle("Ultima perguntinha");

  const referralInput = new TextInputBuilder()
    .setCustomId("registration_referral_answer")
    .setLabel("Como voce conheceu nossa loja?")
    .setPlaceholder("Foi indicado por alguem? Informe o usuario. Se nao, conte onde encontrou a loja.")
    .setMinLength(2)
    .setMaxLength(300)
    .setRequired(true)
    .setStyle(TextInputStyle.Paragraph);

  modal.addComponents(new ActionRowBuilder().addComponents(referralInput));
  await interaction.showModal(modal);
}

async function showTicketSubjectModal(interaction, ticketType) {
  const modal = new ModalBuilder()
    .setCustomId("ticket_subject")
    .setTitle(`Ticket - ${ticketType.label}`);

  const subjectInput = new TextInputBuilder()
    .setCustomId("ticket_subject_text")
    .setLabel("O que voce busca nessa categoria?")
    .setPlaceholder("Conte seu pedido, duvida, referencia ou problema com detalhes.")
    .setMinLength(5)
    .setMaxLength(600)
    .setRequired(true)
    .setStyle(TextInputStyle.Paragraph);

  modal.addComponents(new ActionRowBuilder().addComponents(subjectInput));
  await interaction.showModal(modal);
}

async function sendTicketPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle("ATENDIMENTO ICONICS STORE")
    .setDescription(
      [
        "**Bem-vindo ao atendimento da Iconics Store.**",
        "Escolha abaixo a categoria que combina com o que voce precisa e nossa equipe ira te atender.",
        "",
        "> **LEIA ANTES DE ABRIR**",
        "",
        "**Nao abra ticket sem necessidade.**",
        "**Nao marque a equipe varias vezes.**",
        "**Envie detalhes, prints e referencias para agilizar.**",
        "",
        "**Categorias disponiveis**",
        "`Duvidas`  `Orcamentos`  `Cabelos`  `Roupas`",
        "`Pedidos`  `Site`  `Parcerias`",
      ].join("\n")
    )
    .setFooter({ text: `${config.shopName} © All rights reserved` });

  if (config.logoUrl) embed.setThumbnail(config.logoUrl);
  if (config.bannerUrl) embed.setImage(config.bannerUrl);

  await channel.send({
    embeds: [embed],
    components: [buildTicketMenuRow()],
  });
}

function buildTicketMenuRow() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("ticket_category")
    .setPlaceholder("Selecione uma opcao...")
    .addOptions(
      config.ticketTypes.map((type) => ({
        label: type.label,
        description: type.description,
        value: type.id,
        emoji: type.emoji,
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

async function createTicketChannel(interaction, ticketType, subject) {
  const guild = interaction.guild;
  const staffRole = await ensureRole(guild, config.staffRoleName);
  const category = await ensureCategory(guild, config.ticketCategoryName, [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
  ], ["Tickets"]);

  const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 16) || "cliente";
  const channel = await guild.channels.create({
    name: `${ticketType.channelPrefix}-${safeName}`,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `Dono: ${interaction.user.id} | Tipo: ${ticketType.id} | Status: aberto | Assumido: nenhum | Membros: nenhum`,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
        ],
      },
      {
        id: staffRole.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.ManageChannels,
        ],
      },
    ],
    reason: `Ticket ${ticketType.label} criado por ${interaction.user.tag}`,
  });

  const embed = buildStoreEmbed({ imageUrl: config.ticketHeaderImageUrl })
    .setColor(0x8b5cf6)
    .setTitle("Ticket aberto")
    .setDescription(
      [
        `${interaction.user}, obrigado por abrir um ticket.`,
        "A equipe vai analisar seu pedido e responder por aqui.",
      ].join("\n")
    )
    .addFields(
      { name: "Cliente", value: `${interaction.user}`, inline: true },
      { name: "Categoria", value: ticketType.label, inline: true },
      { name: "Status", value: "Aguardando atendimento", inline: true },
      { name: "Assunto", value: subject.slice(0, 1024), inline: false }
    )
    .setTimestamp();

  await channel.send({
    content: `${interaction.user} <@&${staffRole.id}>`,
    embeds: [embed],
  });

  await logTicketEvent(guild, "Ticket criado", `${interaction.user} abriu ${channel} em ${ticketType.label}.\nAssunto: ${subject}`);

  return channel;
}

async function handleAddTicketMemberCommand(message) {
  if (!message.channel.topic?.includes("Dono:")) {
    await sendTemporaryReply(message, "Use `!add @pessoa` dentro de um canal de ticket.");
    return;
  }

  if (!isStaffMember(message.member)) {
    await sendTemporaryReply(message, "Apenas a equipe pode adicionar pessoas ao ticket.");
    return;
  }

  const member = message.mentions.members.first();
  if (!member) {
    await sendTemporaryReply(message, "Use assim: `!add @pessoa`.");
    return;
  }

  await message.channel.permissionOverwrites.edit(member.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
  });

  message.channel.setTopic(addTicketMemberToTopic(message.channel.topic, member.id)).catch(() => {});

  await message.channel.send({
    embeds: [
      buildStoreEmbed()
        .setTitle("Pessoa adicionada")
        .setDescription(`${member} foi adicionado(a) a este ticket por ${message.author}.`),
    ],
  });

  await logTicketEvent(message.guild, "Pessoa adicionada ao ticket", `${message.author} adicionou ${member} em ${message.channel}.`);
  setTimeout(() => message.delete().catch(() => {}), TEMP_MESSAGE_MS);
}

async function handleClaimTicketCommand(message) {
  if (!message.channel.topic?.includes("Dono:")) {
    await sendTemporaryReply(message, "Use `!assumir` dentro de um canal de ticket.");
    return;
  }

  if (!isStaffMember(message.member)) {
    await sendTemporaryReply(message, "Apenas a equipe pode assumir tickets.");
    return;
  }

  let topic = updateTopicValue(message.channel.topic, "Assumido", message.author.id);
  topic = updateTopicValue(topic, "Status", "assumido");
  await message.channel.setTopic(topic);
  await message.channel.permissionOverwrites.edit(message.author.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
    ManageMessages: true,
  });
  await updateTicketHeaderStatus(message.channel, "Assumido", message.author);
  await logTicketEvent(message.guild, "Ticket assumido", `${message.author} assumiu ${message.channel}.`);
  setTimeout(() => message.delete().catch(() => {}), TEMP_MESSAGE_MS);
}

async function handleFinalizeTicketCommand(message, content) {
  if (!message.channel.topic?.includes("Dono:")) {
    await sendTemporaryReply(message, "Use `!finalizar motivo` dentro de um canal de ticket.");
    return;
  }

  if (!isStaffMember(message.member)) {
    await sendTemporaryReply(message, "Apenas a equipe pode finalizar tickets por comando.");
    return;
  }

  const reason = content.replace(/^!(finalizar|fechar)\s*/i, "").trim() || "Atendimento finalizado pela equipe";
  await message.channel.send("Ticket finalizado. Vou salvar os logs e apagar este canal em 8 segundos.");
  await finalizeTicket(message.channel, message.author, reason);
}

async function handleNotifyTicketCommand(message, content) {
  if (!message.channel.topic?.includes("Dono:")) {
    await sendTemporaryReply(message, "Use `!notificar mensagem` dentro de um canal de ticket.");
    return;
  }

  if (!isStaffMember(message.member)) {
    await sendTemporaryReply(message, "Apenas a equipe pode notificar participantes do ticket.");
    return;
  }

  const customMessage = content.replace(/^!(notify|notificar)\s*/i, "").trim();
  const description = customMessage || `A equipe respondeu seu ticket **#${message.channel.name}**. Da uma olhadinha quando puder.`;

  await notifyTicketParticipants(message.channel, "Ticket respondido", description);
  await sendTemporaryReply(message, "Participantes notificados no privado.");
  await logTicketEvent(message.guild, "Participantes notificados", `${message.author} notificou participantes de ${message.channel}.`);
}

async function handlePixPromptCommand(message, content) {
  if (!canGeneratePix(message.member)) {
    await message.reply("Apenas equipe/admin pode gerar Pix. Confira se voce tem `Equipe Loja`, `Gerenciar servidor` ou `Administrador`.");
    return;
  }

  if (!config.mercadoPagoAccessToken) {
    await message.reply("Pix automatico ainda nao esta configurado. Adicione `MERCADO_PAGO_ACCESS_TOKEN` nas variaveis do host e reinicie o bot.");
    return;
  }

  const inlineAmount = content.replace(/^!pix\s*/i, "").trim();
  if (inlineAmount) {
    await generatePixFromAmountMessage(message, inlineAmount);
    return;
  }

  pendingPixPrompts.set(message.author.id, {
    channelId: message.channel.id,
    guildId: message.guild.id,
    createdAt: Date.now(),
  });

  const reply = await message.reply("Qual valor voce quer cobrar? Responda somente com o valor. Exemplo: `25,50`");
  pendingPixPrompts.set(message.author.id, {
    channelId: message.channel.id,
    guildId: message.guild.id,
    promptMessageId: reply.id,
    commandMessageId: message.id,
    createdAt: Date.now(),
  });

  setTimeout(() => {
    const pending = pendingPixPrompts.get(message.author.id);
    if (pending?.channelId === message.channel.id && Date.now() - pending.createdAt >= 55_000) {
      pendingPixPrompts.delete(message.author.id);
      reply.delete().catch(() => {});
    }
  }, 60_000);
}

async function handlePixAmountResponse(message, content) {
  const pendingPix = pendingPixPrompts.get(message.author.id);
  pendingPixPrompts.delete(message.author.id);
  await generatePixFromAmountMessage(message, content, pendingPix);
}

async function generatePixFromAmountMessage(message, content, pendingPix = null) {
  const amount = parseMoneyAmount(content);
  if (!Number.isFinite(amount) || amount <= 0) {
    await message.reply("Valor invalido. Use `!pix` novamente e responda algo como `25,50`, ou use direto `!pix 25,50`.");
    return;
  }

  let payment;
  try {
    const ownerId = getTicketOwnerId(message.channel);
    console.log(`Gerando Pix de R$ ${amount.toFixed(2)} solicitado por ${message.author.tag}.`);
    payment = await createPixPayment({
      amount,
      description: `Pagamento ${config.shopName} - ${message.channel.name}`,
      payerEmail: config.mercadoPagoPayerEmail,
    });
    console.log(`Pix gerado com sucesso. Payment ID: ${payment.id}`);

    pendingPayments.set(String(payment.id), {
      id: String(payment.id),
      channelId: message.channel.id,
      guildId: message.guild.id,
      ownerId,
      amount,
    });

    await message.delete().catch(() => {});
    if (pendingPix?.promptMessageId) {
      const promptMessage = await message.channel.messages.fetch(pendingPix.promptMessageId).catch(() => null);
      await promptMessage?.delete().catch(() => {});
    }
    if (pendingPix?.commandMessageId) {
      const commandMessage = await message.channel.messages.fetch(pendingPix.commandMessageId).catch(() => null);
      await commandMessage?.delete().catch(() => {});
    }
    await sendPixPaymentMessage(message.channel, payment, amount, ownerId);
    await logTicketEvent(message.guild, "Pix gerado", `${message.author} gerou Pix de R$ ${amount.toFixed(2)} em ${message.channel}.`);
  } catch (error) {
    console.error(`Erro ao gerar Pix: ${error.message}`);
    await message.reply(`Nao consegui gerar o Pix: ${error.message.slice(0, 300)}`);
  }
}

async function handlePaymentCommand(message, content) {
  if (!message.channel.topic?.includes("Dono:")) {
    await message.reply("Use `!cobrar valor` dentro de um canal de ticket.");
    return;
  }

  if (!isStaffMember(message.member)) {
    await message.reply("Apenas a equipe pode gerar cobrancas Pix.");
    return;
  }

  if (!config.mercadoPagoAccessToken) {
    await message.reply("Pix automatico ainda nao esta configurado. Adicione `MERCADO_PAGO_ACCESS_TOKEN` nas variaveis do host.");
    return;
  }

  const rawValue = content.replace(/^!cobrar\s*/i, "").replace(",", ".").trim();
  const amount = Number(rawValue);
  if (!Number.isFinite(amount) || amount <= 0) {
    await message.reply("Use assim: `!cobrar 10,00`");
    return;
  }

  const ownerId = getTicketOwnerId(message.channel);
  const payment = await createPixPayment({
    amount,
    description: `Pagamento ${config.shopName} - ${message.channel.name}`,
    payerEmail: config.mercadoPagoPayerEmail,
  });

  pendingPayments.set(String(payment.id), {
    id: String(payment.id),
    channelId: message.channel.id,
    guildId: message.guild.id,
    ownerId,
    amount,
  });

  const transactionData = payment.point_of_interaction?.transaction_data || {};
  const qrCode = transactionData.qr_code || "Pix copia e cola indisponivel na resposta do Mercado Pago.";
  const ticketOwner = ownerId ? `<@${ownerId}>` : "Cliente";

  await message.channel.send({
    content: `${ticketOwner}, pagamento Pix gerado no valor de R$ ${amount.toFixed(2)}.`,
    embeds: [
      new EmbedBuilder()
        .setColor(0x2f33ff)
        .setTitle("Pagamento Pix")
        .setDescription("Copie o codigo Pix abaixo e pague no app do banco. Quando o pagamento for aprovado, a equipe sera avisada para continuar o atendimento.")
        .addFields(
          { name: "Valor", value: `R$ ${amount.toFixed(2)}`, inline: true },
          { name: "Pagamento", value: String(payment.id), inline: true },
          { name: "Pix copia e cola", value: `\`\`\`${qrCode.slice(0, 950)}\`\`\`` }
        ),
    ],
  });

  await logTicketEvent(message.guild, "Pix gerado", `${message.author} gerou Pix de R$ ${amount.toFixed(2)} em ${message.channel}.`);
}

async function sendPixPaymentMessage(channel, payment, amount, ownerId) {
  const transactionData = payment.point_of_interaction?.transaction_data || {};
  const qrCode = transactionData.qr_code || "Pix copia e cola indisponivel na resposta do Mercado Pago.";
  const qrCodeBase64 = transactionData.qr_code_base64;
  const ticketOwner = ownerId ? `<@${ownerId}>` : "Cliente";
  const files = [];
  const embed = buildStoreEmbed({ imageUrl: null })
    .setTitle("Pagamento Pix")
    .setDescription("Escaneie o QR Code ou copie o codigo Pix abaixo. Quando o pagamento for aprovado, a equipe sera avisada para continuar o atendimento.")
    .addFields(
      { name: "Valor", value: `R$ ${amount.toFixed(2)}`, inline: true },
      { name: "Pagamento", value: String(payment.id), inline: true },
      { name: "Pix copia e cola", value: `\`\`\`${qrCode.slice(0, 950)}\`\`\`` }
    );

  if (qrCodeBase64) {
    const qrBuffer = Buffer.from(qrCodeBase64, "base64");
    files.push(new AttachmentBuilder(qrBuffer, { name: "qrcode-pix.png" }));
    embed.setImage("attachment://qrcode-pix.png");
  }

  await channel.send({
    content: `${ticketOwner}, Pix gerado no valor de **R$ ${amount.toFixed(2)}**.`,
    embeds: [embed],
    files,
  });
}

function parseMoneyAmount(value) {
  const normalized = value
    .replace(/[^\d,.]/g, "")
    .replace(/\.(?=\d{3}(,|$))/g, "")
    .replace(",", ".");

  return Number(normalized);
}

async function createPixPayment({ amount, description, payerEmail }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  const response = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${config.mercadoPagoAccessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
    body: JSON.stringify({
      transaction_amount: amount,
      description,
      payment_method_id: "pix",
      payer: { email: payerEmail },
    }),
  }).finally(() => clearTimeout(timeout));

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Erro Mercado Pago: ${JSON.stringify(data)}`);
  }

  return data;
}

async function checkPendingPayments() {
  if (!config.mercadoPagoAccessToken || pendingPayments.size === 0) return;

  for (const [paymentId, payment] of pendingPayments.entries()) {
    try {
      const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${config.mercadoPagoAccessToken}` },
      });
      const data = await response.json();
      if (!response.ok) continue;

      if (data.status === "approved") {
        pendingPayments.delete(paymentId);
        const guild = await client.guilds.fetch(payment.guildId);
        const channel = await guild.channels.fetch(payment.channelId).catch(() => null);
        if (!channel) continue;

        await notifyPaymentApproved(guild, channel, paymentId, payment.amount);
      }
    } catch (error) {
      console.error("Erro ao verificar Pix pendente:", error);
    }
  }
}

async function notifyPaymentApproved(guild, channel, paymentId, amount) {
  const assigneeId = getTicketAssigneeId(channel);
  const staffRole = guild.roles.cache.find((role) => role.name === config.staffRoleName);
  const mentionTarget = assigneeId ? `<@${assigneeId}>` : staffRole ? `<@&${staffRole.id}>` : "Equipe";
  const amountText = `R$ ${amount.toFixed(2)}`;

  await logTicketEvent(
    guild,
    "Pix aprovado",
    [
      `Pagamento **${paymentId}** aprovado em ${channel}.`,
      `Valor: **${amountText}**`,
      `Aviso direcionado para: ${mentionTarget}`,
      "",
      "O ticket foi mantido aberto. A equipe deve conferir o pedido e finalizar manualmente com `!finalizar motivo`.",
    ].join("\n"),
    [],
    { content: mentionTarget }
  );

  if (!assigneeId) return;

  const assigneeUser = await client.users.fetch(assigneeId).catch(() => null);
  if (!assigneeUser) return;

  await sendTicketDm(
    assigneeUser,
    "Pix aprovado",
    [
      `O pagamento de **${amountText}** foi aprovado no ticket ${channel}.`,
      "",
      "O ticket permanece aberto para voce conferir o pedido e finalizar manualmente quando estiver tudo certo.",
    ].join("\n")
  );
}

function isStaffMember(member) {
  return member.permissions.has(PermissionFlagsBits.ManageChannels) || member.roles.cache.some((role) => role.name === config.staffRoleName);
}

function canGeneratePix(member) {
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    isStaffMember(member)
  );
}

function getTicketOwnerId(channel) {
  return channel.topic?.match(/Dono: (\d+)/)?.[1] || null;
}

function getTicketAssigneeId(channel) {
  const assignee = channel.topic?.match(/Assumido: ([^|]+)/)?.[1]?.trim();
  if (!assignee || assignee === "nenhum") return null;
  return assignee;
}

async function updateTicketHeaderStatus(channel, status, assigneeUser) {
  const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  if (!messages) return;

  const header = messages
    .filter((message) => message.author.id === client.user.id && message.embeds.length > 0)
    .find((message) => message.embeds[0]?.title === "Ticket aberto");

  if (!header) return;

  const oldEmbed = header.embeds[0];
  const fields = oldEmbed.fields.map((field) => {
    if (field.name === "Status") {
      return { name: "Status", value: status, inline: true };
    }
    return { name: field.name, value: field.value, inline: field.inline };
  });

  fields.splice(3, 0, { name: "Assumido por", value: `${assigneeUser}`, inline: true });

  const embed = EmbedBuilder.from(oldEmbed).setFields(fields).setColor(0x2da160);
  await header.edit({ embeds: [embed] }).catch(() => {});
}

function getTicketMemberIds(channel) {
  const ownerId = getTicketOwnerId(channel);
  const memberText = channel.topic?.match(/Membros: ([^|]+)/)?.[1]?.trim() || "";
  const extraIds = memberText === "nenhum" ? [] : memberText.split(",").map((id) => id.trim()).filter(Boolean);
  return [...new Set([ownerId, ...extraIds].filter(Boolean))];
}

function addTicketMemberToTopic(topic, memberId) {
  const current = topic || "";
  const memberText = current.match(/Membros: ([^|]+)/)?.[1]?.trim() || "nenhum";
  const ids = memberText === "nenhum" ? [] : memberText.split(",").map((id) => id.trim()).filter(Boolean);
  if (!ids.includes(memberId)) ids.push(memberId);
  return updateTopicValue(current, "Membros", ids.join(","));
}

function updateTopicValue(topic, key, value) {
  const current = topic || "";
  const pattern = new RegExp(`${key}: [^|]+`);
  if (pattern.test(current)) return current.replace(pattern, `${key}: ${value}`);
  return `${current} | ${key}: ${value}`.trim();
}

async function notifyTicketOwner(channel, message) {
  const ownerId = getTicketOwnerId(channel);
  if (!ownerId) return;
  const user = await client.users.fetch(ownerId).catch(() => null);
  if (!user) return;
  await sendTicketDm(user, "Atualizacao do ticket", message);
}

async function notifyTicketParticipants(channel, title, description, options = {}) {
  const ids = getTicketMemberIds(channel);
  await Promise.all(
    ids.map(async (id) => {
      const user = await client.users.fetch(id).catch(() => null);
      if (!user) return;
      await sendTicketDm(user, title, description, options);
    })
  );
}

async function sendTicketDm(user, title, description, options = {}) {
  const embed = buildStoreEmbed({ imageUrl: options.imageUrl })
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: `${config.shopName} - atendimento` });

  await user.send({ embeds: [embed] }).catch(() => {});
}

function buildStoreEmbed(options = {}) {
  const embed = new EmbedBuilder().setColor(0xf0a6ff).setTimestamp();
  const imageUrl = options.imageUrl === undefined ? config.bannerUrl : options.imageUrl;
  if (config.logoUrl) embed.setThumbnail(config.logoUrl);
  if (imageUrl) embed.setImage(imageUrl);
  return embed;
}

async function logTicketEvent(guild, title, description, files = [], options = {}) {
  const logChannel = guild.channels.cache.find((channel) => channel.name === config.ticketLogsChannelName && channel.type === ChannelType.GuildText);
  if (!logChannel) return;

  await logChannel.send({
    content: options.content,
    embeds: [
      new EmbedBuilder()
        .setColor(0x2528d8)
        .setTitle(title)
        .setDescription(description)
        .setTimestamp(),
    ],
    files,
  }).catch(() => {});
}

async function logRegistrationEvent(guild, title, description) {
  const logChannel = guild.channels.cache.find((channel) => channel.name === config.registrationLogsChannelName && channel.type === ChannelType.GuildText);
  if (!logChannel) return;

  await logChannel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xf0a6ff)
        .setTitle(title)
        .setDescription(description)
        .setTimestamp(),
    ],
  }).catch(() => {});
}

async function createTranscript(channel) {
  const messages = [];
  let before;

  while (messages.length < 1000) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || batch.size === 0) break;
    messages.push(...batch.values());
    before = batch.last().id;
  }

  const lines = messages
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map((message) => {
      const attachments = message.attachments.map((attachment) => attachment.url).join(" ");
      return `[${message.createdAt.toISOString()}] ${message.author.tag}: ${message.content || ""} ${attachments}`.trim();
    });

  return Buffer.from(lines.join("\n") || "Ticket sem mensagens.", "utf8");
}

async function finalizeTicket(channel, closedBy, reason) {
  const ownerId = getTicketOwnerId(channel);
  const ticketType = channel.topic?.match(/Tipo: ([^|]+)/)?.[1]?.trim() || "desconhecido";
  const transcript = await createTranscript(channel);
  const file = new AttachmentBuilder(transcript, { name: `transcript-${channel.name}.txt` });
  const logChannel = channel.guild.channels.cache.find((item) => item.name === config.ticketLogsChannelName && item.type === ChannelType.GuildText);

  if (logChannel) {
    const embed = new EmbedBuilder()
      .setColor(0x2da160)
      .setTitle("Ticket Encerrado")
      .addFields(
        { name: "Utilizador", value: ownerId ? `<@${ownerId}>` : "desconhecido", inline: false },
        { name: "Fechado por", value: `${closedBy}`, inline: false },
        { name: "Tipo", value: ticketType, inline: true },
        { name: "Motivo", value: reason, inline: true },
        { name: "Ticket ID", value: channel.id, inline: false }
      )
      .setTimestamp();

    await logChannel.send({
      embeds: [embed],
      files: [file],
    }).catch(() => {});
  }

  await notifyTicketParticipants(
    channel,
    "Ticket finalizado",
    [
      `O ticket **#${channel.name}** foi finalizado.`,
      "",
      `**Motivo:** ${reason}`,
      "Obrigadinho por entrar em contato com a gente. A Iconics Store fica feliz em te atender.",
    ].join("\n"),
    { imageUrl: config.ticketClosedImageUrl }
  );
  setTimeout(() => channel.delete(reason).catch(() => {}), 8000);
}

if (!config.token) {
  console.error("DISCORD_TOKEN nao foi configurado nas variaveis de ambiente.");
  process.exit(1);
}

client.login(config.token).catch((error) => {
  console.error("Nao foi possivel conectar ao Discord. Verifique DISCORD_TOKEN e intents do bot.");
  console.error(error);
  process.exit(1);
});

setInterval(checkPendingPayments, 60_000);
