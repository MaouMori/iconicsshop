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
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} = require("discord.js");
const config = require("./config");

const pendingPayments = new Map();

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
        await message.reply("Apenas administradores podem usar este comando.");
        return;
      }

      const result = await setupGuild(message.guild);
      await sendVerificationPanel(result.welcomeChannel);
      await sendTicketPanel(result.ticketPanelChannel);
      await message.reply("Servidor configurado. Criei/ajustei cargos, canais, permissoes e paineis.");
      return;
    }

    if (command === "!painel-tickets") {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        await message.reply("Voce precisa da permissao `Gerenciar servidor` para enviar este painel.");
        return;
      }

      await sendTicketPanel(message.channel);
      await message.reply("Painel de tickets enviado.");
      return;
    }

    if (command === "!painel-verificacao") {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        await message.reply("Voce precisa da permissao `Gerenciar servidor` para enviar este painel.");
        return;
      }

      await sendVerificationPanel(message.channel);
      await message.reply("Painel de verificacao enviado.");
      return;
    }

    if (command === "!cobrar") {
      await handlePaymentCommand(message, content);
      return;
    }
  } catch (error) {
    console.error(error);
    await message.reply("Algo deu errado ao executar esse comando. Veja os logs do bot.").catch(() => {});
  }
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
    }
  } catch (error) {
    console.error(error);
    const payload = {
      content: "Algo deu errado ao executar essa acao. Confira minhas permissoes e tente novamente.",
      ephemeral: true,
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
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
          "`!cobrar 10,00` - Gera Pix dentro de um ticket.",
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

async function handleCommand(interaction) {
  if (interaction.commandName === "setup") {
    await interaction.deferReply({ ephemeral: true });
    const result = await setupGuild(interaction.guild);
    await sendVerificationPanel(result.welcomeChannel);
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
  if (interaction.customId === "verify_member") {
    const role = await ensureRole(interaction.guild, config.verifiedRoleName);
    await interaction.member.roles.add(role);
    await interaction.reply({
      content: `Voce foi liberado para ver os canais da ${config.shopName}.`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "claim_ticket") {
    if (!isStaffMember(interaction.member)) {
      await interaction.reply({ content: "Apenas a equipe pode assumir tickets.", ephemeral: true });
      return;
    }

    await interaction.channel.setTopic(updateTopicValue(interaction.channel.topic, "Assumido", interaction.user.id));
    await interaction.reply(`${interaction.user} assumiu este ticket.`);
    await notifyTicketOwner(interaction.channel, `Seu ticket foi assumido por ${interaction.user.tag}.`);
    await logTicketEvent(interaction.guild, "Ticket assumido", `${interaction.user} assumiu ${interaction.channel}.`);
    return;
  }

  if (interaction.customId === "notify_ticket_owner") {
    if (!isStaffMember(interaction.member)) {
      await interaction.reply({ content: "Apenas a equipe pode notificar clientes.", ephemeral: true });
      return;
    }

    await notifyTicketOwner(interaction.channel, `A equipe respondeu seu ticket em #${interaction.channel.name}.`);
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
  if (interaction.customId !== "ticket_category") return;

  await interaction.deferReply({ ephemeral: true });
  const ticketType = config.ticketTypes.find((type) => type.id === interaction.values[0]);
  if (!ticketType) {
    await interaction.editReply("Categoria de ticket invalida.");
    return;
  }

  const existingTicket = interaction.guild.channels.cache.find((channel) => {
    return channel.topic?.includes(`Dono: ${interaction.user.id}`) && channel.topic?.includes(`Tipo: ${ticketType.id}`);
  });

  if (existingTicket) {
    await interaction.editReply(`Voce ja tem um ticket aberto para essa categoria: ${existingTicket}.`);
    return;
  }

  const ticketChannel = await createTicketChannel(interaction, ticketType);
  await interaction.editReply(`Ticket criado: ${ticketChannel}`);
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

  return { welcomeChannel, ticketPanelChannel, ticketCategory, verifiedRole, staffRole };
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
  const embed = new EmbedBuilder()
    .setColor(0x2f33ff)
    .setTitle(`Bem-vindo(a) a ${config.shopName}`)
    .setDescription(
      [
        "Para acessar os canais da loja, clique no botao abaixo.",
        "Quem ainda nao se liberar vera apenas boas-vindas e parcerias.",
      ].join("\n")
    );

  if (config.logoUrl) embed.setThumbnail(config.logoUrl);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("verify_member")
      .setLabel("Liberar acesso")
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({ embeds: [embed], components: [row] });
}

async function sendTicketPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(0x2528d8)
    .setTitle(`ATENDIMENTO ${config.shopName.toUpperCase()}`)
    .setDescription(
      [
        `Seja bem-vindo ao sistema de atendimento ${config.shopName}, use o menu abaixo para abrir um ticket e aguarde ser atendido.`,
        "",
        "**Nao abra um ticket sem necessidade.**",
        "**Nao marque excessivamente a equipe.**",
        "**Agilize o atendimento fornecendo o maximo de informacoes possiveis.**",
      ].join("\n")
    );

  if (config.logoUrl) embed.setThumbnail(config.logoUrl);
  if (config.bannerUrl) embed.setImage(config.bannerUrl);

  const menu = new StringSelectMenuBuilder()
    .setCustomId("ticket_category")
    .setPlaceholder("Selecione a categoria de atendimento.")
    .addOptions(
      config.ticketTypes.map((type) => ({
        label: type.label,
        description: type.description,
        value: type.id,
      }))
    );

  await channel.send({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

async function createTicketChannel(interaction, ticketType) {
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
    topic: `Dono: ${interaction.user.id} | Tipo: ${ticketType.id} | Status: aberto | Assumido: nenhum`,
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

  const embed = new EmbedBuilder()
    .setColor(0x2f33ff)
    .setTitle(ticketType.label)
    .setDescription(
      [
        `${interaction.user}, obrigado por abrir um ticket.`,
        "Explique o que voce precisa com o maximo de detalhes possivel para a equipe agilizar o atendimento.",
      ].join("\n")
    )
    .addFields(
      { name: "Cliente", value: `${interaction.user}`, inline: true },
      { name: "Categoria", value: ticketType.label, inline: true },
      { name: "Status", value: "Aguardando atendimento", inline: true }
    )
    .setTimestamp();

  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("claim_ticket").setLabel("Assumir").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("notify_ticket_owner").setLabel("Notificar cliente").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("close_ticket").setLabel("Finalizar").setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: `${interaction.user} <@&${staffRole.id}>`,
    embeds: [embed],
    components: [actions],
  });

  await logTicketEvent(guild, "Ticket criado", `${interaction.user} abriu ${channel} em ${ticketType.label}.`);
  await notifyTicketOwner(channel, `Seu ticket foi criado: #${channel.name}.`);

  return channel;
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
        await notifyTicketOwner(channel, `Seu pagamento de R$ ${payment.amount.toFixed(2)} foi aprovado e o ticket sera finalizado.`);
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
  await user.send(message).catch(() => {});
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
  const transcript = await createTranscript(channel);
  const file = new AttachmentBuilder(transcript, { name: `transcript-${channel.name}.txt` });

  await logTicketEvent(
    channel.guild,
    "Ticket finalizado",
    `Canal: #${channel.name}\nCliente: ${ownerId ? `<@${ownerId}>` : "desconhecido"}\nFinalizado por: ${closedBy}\nMotivo: ${reason}`,
    [file]
  );

  await notifyTicketOwner(channel, `Seu ticket #${channel.name} foi finalizado. Obrigado por entrar em contato com a ${config.shopName}.`);
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
