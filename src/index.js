const {
  ActionRowBuilder,
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
  if (message.author.bot || !message.guild) return;
  if (message.content.trim().toLowerCase() !== "!help") return;

  const embed = new EmbedBuilder()
    .setColor(0x2528d8)
    .setTitle(`Ajuda - ${config.shopName}`)
    .setDescription("Veja abaixo os comandos e funcoes principais do bot da loja.")
    .addFields(
      {
        name: "Cliente",
        value: [
          "`!help` - Mostra esta mensagem.",
          "Botao `Liberar acesso` - Libera os canais da loja.",
          "Menu de atendimento - Abre ticket na categoria escolhida.",
        ].join("\n"),
      },
      {
        name: "Tickets",
        value: [
          "Categorias: duvidas, orcamentos, cabelos, roupas, ped, site e parcerias.",
          "Cada atendimento abre um canal privado para voce e a equipe.",
          "Use o botao `Fechar ticket` quando terminar.",
        ].join("\n"),
      },
      {
        name: "Equipe/Admin",
        value: [
          "`/setup` - Cria cargos, canais, permissoes e paineis.",
          "`/painel-tickets` - Envia novamente o painel de atendimento.",
          "`/painel-verificacao` - Envia novamente o painel de liberacao.",
        ].join("\n"),
      }
    )
    .setFooter({ text: `${config.shopName} - atendimento da loja` });

  if (config.logoUrl) embed.setThumbnail(config.logoUrl);

  await message.reply({ embeds: [embed] });
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

  if (interaction.customId === "close_ticket") {
    const isStaff = interaction.member.permissions.has(PermissionFlagsBits.ManageChannels);
    const ownsTicket = interaction.channel.topic?.includes(`Dono: ${interaction.user.id}`);

    if (!isStaff && !ownsTicket) {
      await interaction.reply({ content: "Apenas o dono do ticket ou a equipe pode fechar este ticket.", ephemeral: true });
      return;
    }

    await interaction.reply("Ticket fechado. Este canal sera apagado em 5 segundos.");
    setTimeout(() => interaction.channel.delete("Ticket fechado").catch(() => {}), 5000);
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
    if (permissionOverwrites.length > 0) {
      await existing.permissionOverwrites.set(permissionOverwrites);
    }
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
    if (permissionOverwrites?.length > 0) {
      await existing.permissionOverwrites.set(permissionOverwrites);
    }
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
      .setEmoji("✅")
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
        emoji: type.emoji,
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
    topic: `Dono: ${interaction.user.id} | Tipo: ${ticketType.id}`,
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
    .setTitle(`${ticketType.emoji} ${ticketType.label}`)
    .setDescription(
      [
        `${interaction.user}, obrigado por abrir um ticket.`,
        "Explique o que voce precisa com o maximo de detalhes possivel para a equipe agilizar o atendimento.",
      ].join("\n")
    )
    .addFields(
      { name: "Cliente", value: `${interaction.user}`, inline: true },
      { name: "Categoria", value: ticketType.label, inline: true }
    )
    .setTimestamp();

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("close_ticket")
      .setLabel("Fechar ticket")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("🔒")
  );

  await channel.send({
    content: `${interaction.user} <@&${staffRole.id}>`,
    embeds: [embed],
    components: [closeRow],
  });

  return channel;
}

client.login(config.token);
