# Brothers Life — Bot Discord

Bot qui gère plusieurs serveurs Discord comme un seul **réseau**, piloté depuis un **panel web**.

Ce qui existe aujourd'hui (chantier 1, le socle) :

- **Réseau de serveurs** : un serveur principal et des serveurs ajoutés au réseau depuis le panel. Inviter le bot ne suffit jamais.
- **Permissions fines** : des rangs regroupent des permissions. On obtient un rang par un rôle du serveur principal, ou par attribution directe dans le panel. Un utilisateur ne peut pas donner plus de droits qu'il n'en a.
- **Panel web** : connexion via Discord, vue d'ensemble, serveurs, rangs, membres, salons de logs, journal, sessions, console en direct, versions.
- **Salons de logs** : chaque catégorie de logs peut aller dans son propre salon, sur chaque serveur, avec en option un miroir vers le serveur principal.
- **Versions** : les versions sont publiées sur GitHub par la CI. Depuis le panel, on installe n'importe quelle version ; la base est sauvegardée avant, et en cas d'échec la version précédente revient toute seule.

Prévu ensuite : sanctions synchronisées, logs complets des serveurs, automod (anti-spam, anti-arnaque, anti-envoi massif), gestion des rôles et des membres, tickets, synchronisation des permissions.

La conception détaillée est dans `docs/superpowers/specs/`.

## Prérequis

- Node.js 22 ou plus
- Une application Discord ([Developer Portal](https://discord.com/developers/applications)) :
  - **Bot** : activer les intents *Server Members* et *Message Content*.
  - **OAuth2 > Redirects** : ajouter `<WEB_PUBLIC_URL>/api/auth/callback` (par exemple `http://localhost:3000/api/auth/callback`).

## Développement en local

```bash
npm install
cp .env.example .env.dev      # puis remplir TOKEN, APP_ID, CLIENT_SECRET, OWNER_ID
npm run deploy:dev            # commandes slash sur DEV_GUILD_ID
npm run dev                   # bot + API sur http://localhost:3000
```

Pour travailler sur le panel avec rechargement à chaud :

```bash
npm --prefix web install
npm run dev:web               # http://localhost:5173 (l'API est relayée vers :3000)
```

Pour servir le panel compilé directement par le bot : `npm run build:web`.

La première connexion au panel se fait avec le compte `OWNER_ID`. Choisis ensuite le serveur principal dans « Serveurs ».

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | Bot en local avec rechargement (config `.env.dev`) |
| `npm start` | Lanceur de production (`launcher.js`, config `.env.prod`) |
| `npm test` | Tests (`node --test`) |
| `npm run lint` | ESLint |
| `npm run deploy:dev` | Commandes slash sur le serveur de test |
| `npm run deploy:global` | Commandes slash sur tous les serveurs (config prod) |
| `npm run dev:web` / `build:web` | Panel : développement / compilation |

## Configuration

Tout passe par `.env.dev` / `.env.prod` (modèle : `.env.example`). Les variables d'environnement réelles, par exemple les variables de démarrage Pterodactyl, passent avant le fichier.

`OWNER_ID` est le **seul** compte qui a toutes les permissions. Il ne peut pas être modifié depuis le panel : pour changer de chef, on modifie le `.env` et on redémarre.

## Publier une version

```bash
npm version minor             # ou patch / major : met à jour package.json et crée le tag
git push --follow-tags
```

La CI vérifie le lint et les tests, compile le panel et publie la Release GitHub. La version apparaît ensuite dans le panel, page **Versions**.

## Production

Voir [docs/pterodactyl.md](docs/pterodactyl.md).

## Structure

```
launcher.js, launcher/   superviseur de production : redémarrage, versions, retour arrière
src/index.js             démarrage : config, base, core, bot, web
src/core/                logique métier (réseau, rangs, permissions, logs, audit, sessions, versions)
src/db/                  SQLite et migrations
src/bot/                 discord.js : événements, commandes, exécuteur Discord
src/web/                 Fastify : OAuth2, API, console WebSocket
web/                     panel React (basé sur satnaing/shadcn-admin, MIT)
test/                    tests
```

Basé sur [arthurcorberes/discordjs-bot-template](https://github.com/arthurcorberes/discordjs-bot-template) (MIT).
