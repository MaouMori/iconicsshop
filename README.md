# Bot de loja para Discord

Bot em `discord.js` com:

- Liberacao de membros por botao.
- Quem nao se liberar ve apenas `boas-vindas` e `parcerias`.
- Painel de atendimento no estilo da imagem, com embed e menu.
- Tickets separados por categoria: tirar duvida/pergunta, orcamentos, cabelos, roupas, ped, site e parcerias.
- Botao para fechar ticket.

## Como configurar

1. Instale as dependencias:

```bash
npm install
```

2. Copie `.env.example` para `.env` e preencha:

```env
DISCORD_TOKEN=token_do_bot
DISCORD_CLIENT_ID=id_da_aplicacao
DISCORD_GUILD_ID=id_do_servidor
SHOP_NAME=Elyra Shop
SHOP_LOGO_URL=https://link-da-logo.png
SHOP_BANNER_URL=https://link-do-banner.png
```

3. Registre os comandos slash:

```bash
npm run deploy
```

4. Ligue o bot:

```bash
npm start
```

5. No Discord, use `/setup` em qualquer canal. O bot vai criar:

- Cargo `Cliente`.
- Cargo `Equipe Loja`.
- Categoria `Entrada` com `boas-vindas` e `parcerias`.
- Categoria `Loja` visivel apenas para clientes liberados.
- Canal `atendimento` com o painel de tickets.
- Categoria `Tickets` para os tickets abertos.

## Permissoes importantes

O bot precisa estar acima dos cargos `Cliente` e `Equipe Loja` na lista de cargos do servidor.

Convide o bot com estas permissoes:

- `Manage Roles`
- `Manage Channels`
- `Send Messages`
- `Embed Links`
- `Read Message History`
- `Use Slash Commands`

Se quiser que a equipe receba notificacao nos tickets, coloque as pessoas da loja no cargo `Equipe Loja`.

## Atualizar online pelo GitHub

O arquivo `.env` nao deve ir para o GitHub. Configure as variaveis de ambiente direto no painel da hospedagem.

### Subir para um repositorio

```bash
git init
git add .
git commit -m "Primeira versao do bot"
git branch -M main
git remote add origin https://github.com/seu-usuario/seu-repositorio.git
git push -u origin main
```

### Usando Discloud

Na Discloud, conecte o repositorio do GitHub no painel ou pela integracao oficial. Depois configure estas variaveis no painel:

```env
DISCORD_TOKEN=token_do_bot
DISCORD_CLIENT_ID=id_da_aplicacao
DISCORD_GUILD_ID=id_do_servidor
SHOP_NAME=Iconics Shop
SHOP_LOGO_URL=
SHOP_BANNER_URL=
```

Depois disso, cada `git push` para a branch configurada atualiza o bot online.

Se os comandos slash mudarem, rode tambem:

```bash
npm run deploy
```
