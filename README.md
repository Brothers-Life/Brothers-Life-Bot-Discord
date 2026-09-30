# Brothers Life — Bot Discord

Bot qui gère plusieurs serveurs Discord comme un seul **réseau**, piloté depuis un **panel web**.

Fonctionnalités :

| Domaine | Contenu |
|---|---|
| **Réseau** | Un serveur principal et des serveurs ajoutés au réseau depuis le panel (inviter le bot ne suffit jamais) |
| **Permissions** | Des rangs regroupent des permissions ; on les obtient par un rôle du serveur principal ou par attribution directe. Personne ne peut donner plus de droits qu'il n'en a. `OWNER_ID` a tout. |
| **Sanctions** | Ban, kick, timeout et warn sur tout le réseau ou un seul serveur, avec un résultat par serveur. Les bans, kicks et timeouts faits directement dans Discord sont détectés et propagés si le rang de l'auteur l'autorise. Bans temporaires. Un serveur ajouté au réseau reçoit les bans existants. |
| **Logs** | Messages modifiés ou supprimés, arrivées et départs (avec l'invitation utilisée), pseudos, rôles, salons, vocal, invitations, serveur. Chaque catégorie va dans le salon de ton choix, par serveur, avec un miroir vers le serveur principal en option. Recherche dans le panel. |
| **Automod** | Anti-arnaque (domaines connus, faux liens Discord ou Steam, appâts « nitro gratuit » ou crypto), anti-spam, anti-envoi massif, invitations. Réglage réseau et réglages par serveur, avec exemptions. |
| **Staff** | Chaque rang peut être lié à un rôle sur chaque serveur : le bot donne et retire ces rôles tout seul. Recherche d'un membre sur tout le réseau, avec gestion de ses rôles et de ses pseudos. |
| **Tickets** | Panneau avec un bouton par catégorie, salon privé avec le staff concerné, prise en charge, transcript à la fermeture (dans les logs et en MP). |
| **Permissions Discord** | Un profil de permissions par rang, appliqué aux rôles liés sur tous les serveurs, avec un signalement des écarts toutes les 6 heures. |
| **Panel web** | Connexion Discord, toutes les pages ci-dessus, journal, sessions, console en direct, versions. |
| **Versions** | Publiées sur GitHub par la CI, installables depuis le panel, avec une sauvegarde de la base avant et un retour automatique en cas d'échec. |

Commandes slash : `/ban`, `/unban`, `/kick`, `/timeout`, `/untimeout`, `/warn`, `/historique`. Elles sont enregistrées automatiquement au démarrage quand elles changent.

La conception détaillée est dans `docs/superpowers/specs/`.

## Prérequis

- Node.js 22 ou plus
- Une application Discord ([Developer Portal](https://discord.com/developers/applications)) :
  - **Bot** : activer les intents privilégiés *Server Members* et *Message Content*.
  - **OAuth2 > Redirects** : ajouter `<WEB_PUBLIC_URL>/api/auth/callback` (par exemple `http://localhost:3000/api/auth/callback`).
  - Inviter le bot sur chaque serveur avec la permission **Administrateur** : bouton « Inviter le bot sur un serveur » de la page **Serveurs** du panel.
  - Dans chaque serveur, placer le rôle du bot **au-dessus** des rôles du staff qu'il doit gérer.

## Développement en local

```bash
npm install
cp .env.example .env.dev      # puis remplir TOKEN, APP_ID, CLIENT_SECRET, OWNER_ID
npm run dev                   # bot + API sur http://localhost:3000 (commandes slash enregistrées sur DEV_GUILD_ID)
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
| `npm run deploy:dev` / `deploy:global` | Forcer l'enregistrement des commandes slash (normalement automatique au démarrage) |
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
src/core/                logique métier : réseau, rangs, sanctions, événements, automod,
                         staff, tickets, permissions Discord, audit, sessions, versions
src/db/                  SQLite et migrations
src/bot/                 discord.js : événements, commandes, boutons, exécuteur Discord
src/web/                 Fastify : OAuth2, API, console WebSocket
web/                     panel React (basé sur satnaing/shadcn-admin, MIT)
test/                    tests
```

Basé sur [arthurcorberes/discordjs-bot-template](https://github.com/arthurcorberes/discordjs-bot-template) (MIT).
