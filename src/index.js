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
const config = require("./config");

const pendingPayments = new Map();
const pendingRegistrations = new Map();
const pendingTicketRequests = new Map();
const TEMP_MESSAGE_MS = 10_000;

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
  const welcomeChannel = member.guild.channels.cache.find((channel) => channel.name === config.welcomeChannelName && channel.type === ChannelType.GuildText);
  if (!welcomeChannel) return;

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

  await welcomeChannel.send({ content: `${member}`, embeds: [embed] }).catch(() => {});
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
  const embed = new EmbedBuilder()
    .setColor(0x2528d8)
    .setTitle(`Ajuda - ${config.shopName}`)
    .setDescription("Comandos e funcoes principais do bot da loja.")
    .addFields(
      {
        name: "Comandos",
        value: [
          "`!help` - Mostra esta mensagem.",
          "`!setup` - Cria cargos, canais, logs e paineis.",
          "`!painel-tickets` - Envia o painel de tickets.",
          "`!painel-verificacao` - Envia o painel de liberacao.",
          "`!add @pessoa` - Adiciona alguem ao ticket.",
          "`!assumir` - Marca que voce assumiu o ticket.",
          "`!notificar mensagem` - Envia DM estilizada para participantes do ticket.",
          "`!finalizar motivo` - Finaliza o ticket e envia avisos.",
          "`!cobrar 10,00` - Gera Pix dentro de um ticket.",
        ].join("\n"),
      },
      {
        name: "Registro",
        value: [
          "Novos membros entram pelo canal `connect`.",
          "O registro troca o nickname, pergunta o que a pessoa busca e registra indicacao.",
          "Depois do registro, o cargo `Cliente` libera a loja.",
        ].join("\n"),
      },
      {
        name: "Tickets",
        value: [
          "Tickets sao privados para o cliente e a equipe.",
          "A equipe pode assumir, notificar o cliente e finalizar.",
          "Ao finalizar, o bot salva um transcript em `logs-tickets`.",
        ].join("\n"),
      },
      {
        name: "Pagamento",
        value: [
          "O Pix automatico usa Mercado Pago.",
          "Configure `MERCADO_PAGO_ACCESS_TOKEN` no host.",
          "Quando o pagamento for aprovado, o ticket fecha automaticamente.",
        ].join("\n"),
      }
    )
    .setFooter({ text: `${config.shopName} - atendimento da loja` });

  if (config.logoUrl) embed.setThumbnail(config.logoUrl);
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

    const role = await ensureRole(interaction.guild, config.verifiedRoleName);
    await interaction.member.roles.add(role);
    pendingRegistrations.delete(interaction.user.id);

    await sendTemporaryInteractionReply(interaction, {
      content: `Registro concluido. Bem-vindo(a) a **${config.shopName}**, ${registration.nickname}.`,
      ephemeral: true,
    });

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

async function setupGuild(guild) {
  const everyone = guild.roles.everyone;
  const verifiedRole = await ensureRole(guild, config.verifiedRoleName);
  const staffRole = await ensureRole(guild, config.staffRoleName, {
    color: 0x5865f2,
    mentionable: true,
  });

  const publicCategory = await ensureCategory(guild, config.publicCategoryName, [
    { id: everyone.id, allow: [PermissionFlagsBits.ViewChannel] },
  ]);

  const storeCategory = await ensureCategory(guild, config.storeCategoryName, [
    { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: verifiedRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
    { id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageMessages] },
  ]);

  const ticketCategory = await ensureCategory(guild, config.ticketCategoryName, [
    { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
  ]);

  const welcomeChannel = await ensureTextChannel(guild, config.welcomeChannelName, publicCategory.id, [
    { id: everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
  ]);

  const connectChannel = await ensureTextChannel(guild, config.connectChannelName, publicCategory.id, [
    { id: everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
    { id: staffRole.id, allow: [PermissionFlagsBits.SendMessages] },
  ]);

  await ensureTextChannel(guild, config.partnershipsChannelName, publicCategory.id, [
    { id: everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
    { id: staffRole.id, allow: [PermissionFlagsBits.SendMessages] },
  ]);

  await ensureTextChannel(guild, config.infoChannelName, storeCategory.id);
  const ticketPanelChannel = await ensureTextChannel(guild, config.ticketPanelChannelName, storeCategory.id, [
    { id: verifiedRole.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.SendMessages] },
    { id: staffRole.id, allow: [PermissionFlagsBits.SendMessages] },
  ]);

  await ensureTextChannel(guild, config.ticketLogsChannelName, ticketCategory.id, [
    { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ]);

  await ensureTextChannel(guild, config.registrationLogsChannelName, ticketCategory.id, [
    { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: staffRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ]);

  return { welcomeChannel, connectChannel, ticketPanelChannel, ticketCategory, verifiedRole, staffRole };
}

async function ensureRole(guild, name, options = {}) {
  const existing = guild.roles.cache.find((role) => role.name === name);
  if (existing) return existing;
  return guild.roles.create({ name, reason: `Cargo criado para ${config.shopName}`, ...options });
}

async function ensureCategory(guild, name, permissionOverwrites = []) {
  const existing = guild.channels.cache.find((channel) => channel.name === name && channel.type === ChannelType.GuildCategory);
  if (existing) {
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

async function ensureTextChannel(guild, name, parentId, permissionOverwrites) {
  const existing = guild.channels.cache.find((channel) => channel.name === name && channel.type === ChannelType.GuildText);
  if (existing) {
    const edits = {};
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
  ]);

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
    payerEmail: `${ownerId || message.author.id}@discord.local`,
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
        .setDescription("Copie o codigo Pix abaixo e pague no app do banco. Quando o pagamento for aprovado, o ticket sera finalizado automaticamente.")
        .addFields(
          { name: "Valor", value: `R$ ${amount.toFixed(2)}`, inline: true },
          { name: "Pagamento", value: String(payment.id), inline: true },
          { name: "Pix copia e cola", value: `\`\`\`${qrCode.slice(0, 950)}\`\`\`` }
        ),
    ],
  });

  await logTicketEvent(message.guild, "Pix gerado", `${message.author} gerou Pix de R$ ${amount.toFixed(2)} em ${message.channel}.`);
}

async function createPixPayment({ amount, description, payerEmail }) {
  const response = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
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
  });

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

        await channel.send("Pagamento aprovado. Vou finalizar este ticket automaticamente.");
        await logTicketEvent(guild, "Pix aprovado", `Pagamento ${paymentId} aprovado em ${channel}.`);
        await finalizeTicket(channel, client.user, `Pagamento Pix aprovado: ${paymentId}`);
      }
    } catch (error) {
      console.error("Erro ao verificar Pix pendente:", error);
    }
  }
}

function isStaffMember(member) {
  return member.permissions.has(PermissionFlagsBits.ManageChannels) || member.roles.cache.some((role) => role.name === config.staffRoleName);
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

async function logTicketEvent(guild, title, description, files = []) {
  const logChannel = guild.channels.cache.find((channel) => channel.name === config.ticketLogsChannelName && channel.type === ChannelType.GuildText);
  if (!logChannel) return;

  await logChannel.send({
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
