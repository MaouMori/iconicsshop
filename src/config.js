require("dotenv").config();

const shopName = process.env.SHOP_NAME || "Elyra Shop";

const ticketTypes = [
  {
    id: "duvidas",
    label: "Tirar duvida / pergunta",
    description: "Perguntas gerais sobre a loja.",
    emoji: "❔",
    channelPrefix: "duvida",
  },
  {
    id: "orcamentos",
    label: "Orcamentos",
    description: "Pedir orcamentos e valores.",
    emoji: "💰",
    channelPrefix: "orcamento",
  },
  {
    id: "cabelos",
    label: "Cabelos",
    description: "Atendimento sobre cabelos.",
    emoji: "💇",
    channelPrefix: "cabelos",
  },
  {
    id: "roupas",
    label: "Roupas",
    description: "Atendimento sobre roupas.",
    emoji: "👕",
    channelPrefix: "roupas",
  },
  {
    id: "ped",
    label: "Ped",
    description: "Atendimento sobre pedidos.",
    emoji: "📦",
    channelPrefix: "ped",
  },
  {
    id: "site",
    label: "Site",
    description: "Suporte e pedidos pelo site.",
    emoji: "🌐",
    channelPrefix: "site",
  },
  {
    id: "parcerias",
    label: "Parcerias",
    description: "Abrir atendimento para parceria.",
    emoji: "🤝",
    channelPrefix: "parceria",
  },
];

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID,
  shopName,
  logoUrl: process.env.SHOP_LOGO_URL || null,
  bannerUrl: process.env.SHOP_BANNER_URL || null,
  verifiedRoleName: "Cliente",
  staffRoleName: "Equipe Loja",
  welcomeChannelName: "boas-vindas",
  partnershipsChannelName: "parcerias",
  infoChannelName: "sobre-a-loja",
  ticketPanelChannelName: "atendimento",
  ticketCategoryName: "Tickets",
  storeCategoryName: "Loja",
  publicCategoryName: "Entrada",
  ticketTypes,
};
