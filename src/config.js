require("dotenv").config();

const shopName = process.env.SHOP_NAME || "Iconics Store";

const ticketTypes = [
  {
    id: "duvidas",
    label: "Tirar duvida",
    description: "Perguntas, informacoes e ajuda geral.",
    emoji: "❔",
    channelPrefix: "duvida",
  },
  {
    id: "orcamentos",
    label: "Orcamentos",
    description: "Valores, pacotes e combinados.",
    emoji: "💸",
    channelPrefix: "orcamento",
  },
  {
    id: "cabelos",
    label: "Cabelos",
    description: "Atendimento para cabelos e aparencias.",
    emoji: "💇",
    channelPrefix: "cabelos",
  },
  {
    id: "roupas",
    label: "Roupas",
    description: "Looks, pecas, combos e encomendas.",
    emoji: "👕",
    channelPrefix: "roupas",
  },
  {
    id: "ped",
    label: "Pedidos",
    description: "Acompanhar ou resolver um pedido.",
    emoji: "📦",
    channelPrefix: "ped",
  },
  {
    id: "site",
    label: "Site",
    description: "Ajuda com compras e acesso ao site.",
    emoji: "🌐",
    channelPrefix: "site",
  },
  {
    id: "parcerias",
    label: "Parcerias",
    description: "Propostas, collabs e divulgacoes.",
    emoji: "🤝",
    channelPrefix: "parceria",
  },
];

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID,
  mercadoPagoAccessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN || null,
  shopName,
  logoUrl: process.env.SHOP_LOGO_URL || null,
  bannerUrl: process.env.SHOP_BANNER_URL || null,
  verifiedRoleName: "Cliente",
  staffRoleName: "Equipe Loja",
  welcomeChannelName: "boas-vindas",
  connectChannelName: "connect",
  partnershipsChannelName: "parcerias",
  infoChannelName: "sobre-a-loja",
  ticketPanelChannelName: "atendimento",
  ticketLogsChannelName: "logs-tickets",
  registrationLogsChannelName: "logs-registros",
  ticketCategoryName: "Tickets",
  storeCategoryName: "Loja",
  publicCategoryName: "Entrada",
  ticketTypes,
};
