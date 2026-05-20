const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { token, clientId, guildId } = require("./config");

const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Cria canais, cargos, painel de verificacao e painel de tickets da loja.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName("painel-tickets")
    .setDescription("Envia novamente o painel de atendimento no canal atual.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("painel-verificacao")
    .setDescription("Envia novamente o painel de verificacao no canal atual.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map((command) => command.toJSON());

async function main() {
  if (!token || !clientId || !guildId) {
    throw new Error("Preencha DISCORD_TOKEN, DISCORD_CLIENT_ID e DISCORD_GUILD_ID no arquivo .env.");
  }

  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  console.log("Comandos slash registrados com sucesso.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
