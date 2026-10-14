# Architecture : bot, API, front et base séparés

Depuis la v2.0.0, le bot se compose de quatre morceaux qui peuvent tourner chacun sur sa machine ou dans son conteneur :

```
 Navigateur ──HTTPS──▶  FRONT  (src/front.js)
                         │  sert le panel React (web/dist)
                         │  transmet /api, ses websockets et /public
                         ▼
                        API  (src/api.js) ───────────────┐
                         │  API du panel + API publique   │ lit et écrit
                         │  sessions, clés, permissions   ▼
                         ▲                         POSTGRESQL (base partagée)
       liaison interne   │  (websocket ouvert par         ▲
       INTERNAL_TOKEN    │   le bot sur /internal/bot)    │ lit et écrit
                        BOT  (src/bot.js) ───────────────┘
                         │  connexion Discord, commandes, boutons, événements
                         │  tâches planifiées, musique, services à état
                         ▼
                      Discord
```

| Morceau | Fichier | Rôle | A besoin de |
|---|---|---|---|
| **Bot** | `src/bot.js` | Seul à parler à Discord (token). Fait tourner les tâches planifiées (giveaways, sondages, annonces, flux…) et les services qui gardent un état vivant (lecteur de musique, tickets ouverts, raids, salons automatiques, maintenance FiveM…). Se connecte à l'API (`API_URL`) et n'ouvre **aucun port**. | `TOKEN`, base, `INTERNAL_TOKEN`, `API_URL` |
| **API** | `src/api.js` | API REST et websockets du panel, API publique (`brl_…`), connexion Discord OAuth, sessions. Lit et écrit la base elle-même ; demande au bot tout ce qui touche à Discord. **N'a jamais le token du bot.** | base, `INTERNAL_TOKEN`, `CLIENT_SECRET` |
| **Front** | `src/front.js` | Sert le panel (fichiers de `web/dist`), le HTTPS (auto-signé ou certificat), et transmet `/api` à l'API. Seule adresse ouverte aux navigateurs (`WEB_PUBLIC_URL`). Aucune dépendance Node à part le code de la version. | `API_URL` (+ `INTERNAL_TOKEN` pour suivre les versions) |
| **Base** | PostgreSQL 14+ (17 conseillé) | Toutes les données, y compris les fichiers partagés (images envoyées depuis le panel, transcripts de tickets, archives de salons : table `files`). | — |

`src/index.js` garde le mode **tout-en-un** (bot + API + panel dans un seul processus) : pratique en développement et pour une petite installation. Il utilise aussi PostgreSQL.

## Comment l'API et le bot se parlent

- **Actions Discord** : l'API a un exécuteur « distant » (`src/api/link.js`) qui envoie chaque appel (`sendLog`, `addRole`, `listMembers`…) au bot (`src/bot/link.js`), qui l'exécute avec discord.js.
- **Services du bot** (`BOT_SERVICES` dans `src/core/context.js` : musique, tickets, MP, modèles, sauvegardes, anti-raid, anti-nuke, automod, salons automatiques, accueil, vérification, commandes perso, vocaux perso, FiveM, giveaways, sondages, flux, streams, Tebex, modération, horaires, réunions) : dans l'API, ces services sont des « doublures » dont chaque méthode s'exécute dans le bot, avec l'utilisateur du panel comme acteur (ses permissions voyagent avec l'appel ; une clé d'API reste nommée dans le journal). Les autres services travaillent directement sur la base, dans les deux processus.
- **Une seule connexion** : le bot ouvre un websocket vers l'API (`API_URL` + `/internal/bot`, `src/rpc/socket.js`) et le garde ouvert ; les appels de l'API et les événements passent dans les deux sens par ce websocket (`src/rpc/peer.js`). Le bot n'a donc besoin d'aucun port ouvert (sur webgune, un service « Bot Discord » n'en a pas).
- **Événements** (du bot vers l'API) : messages des tickets et des MP en direct, état du lecteur musique, notifications du panel, lignes de console du bot (marquées `bot │`), état du bot (connecté, ping, icônes des serveurs).
- **Changements** : chaque entrée du journal d'audit passe à l'autre processus, qui rafraîchit ses caches (serveurs du réseau, rangs) et réagit comme si le changement venait de lui (resynchronisation du staff, nouveau serveur dans le réseau…).
- **Sécurité** : la liaison exige `INTERNAL_TOKEN` (32 caractères ou plus, identique sur le bot, l'API et le front) ; elle est en HTTP simple, donc l'adresse `API_URL` du bot doit être une adresse privée (réseau Docker, DNS interne de webgune, IP interne de Pterodactyl). Le front ne relaie jamais `/internal`.
- **Bot redémarré** : l'API répond « Le bot ne répond pas pour le moment » (503) aux actions qui ont besoin de lui, le bot se reconnecte tout seul (1 s, 2 s, 5 s puis toutes les 10 s), et le reste du panel continue de marcher.

## Base de données

- Driver : `src/db/index.js` (`pg`). Les requêtes gardent la forme `db.prepare(sql).get/all/run(...)`, tout est asynchrone (`await`), les paramètres `?` / `@nom` deviennent `$1, $2…`. Transactions : `await db.transaction(async () => { … })()` (les requêtes faites dedans passent par la connexion de la transaction). `run()` renvoie `{ changes, lastInsertRowid }` (un `RETURNING id` est ajouté aux INSERT des tables à `id` auto). BIGINT et NUMERIC reviennent en nombres.
- Comparaisons sensibles à la casse ; les noms uniques sans casse ont un index unique sur `lower(name)`. Le MariaDB du jeu FiveM reste lu avec mysql2 (`fivemData`), en lecture seule.
- Migrations : `src/db/migrations/NNN_*.sql`, appliquées au démarrage par le premier processus (verrou `pg_advisory_lock` : le bot et l'API ne migrent jamais en même temps), chacune dans une transaction. `001_init.sql` reprend tout le schéma de la v1.11.0.
- **Sauvegardes** : avant chaque migration, le processus qui migre enregistre la base dans `data/backups/avant-migration-vN-….sql.gz` (10 dernières). Si une nouvelle version ne démarre pas, le lanceur revient au code précédent et demande la restauration de cette sauvegarde (`data/backups/restore-request.json`, lue au démarrage).
- Tests : chaque fichier de test a sa propre base PostgreSQL (`TEST_DATABASE_URL`, par défaut `postgres://postgres:root@127.0.0.1:5432/postgres`), vidée entre les tests (`TRUNCATE … RESTART IDENTITY`, `test/db.js`). `npm run db:test` lance un PostgreSQL de test dans Docker.

## Passer de la v1 (SQLite) à la v2 (PostgreSQL)

1. Mets à jour en **v1.11.0** et démarre-la une fois (la base SQLite doit être au schéma 43).
2. Crée une base PostgreSQL vide (base webgune, conteneur `db` de docker-compose, ou ton serveur PostgreSQL).
3. Arrête le bot, installe la v2 avec les variables de la base (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` ou `DATABASE_URL`).
4. Sur le serveur qui a l'ancien dossier `data/` : `node scripts/migrate-sqlite.mjs prod` (ou `--from chemin/bot.db --data chemin/data`). Le script recopie toutes les tables et les fichiers (images, transcripts, archives) dans PostgreSQL en une seule transaction, compte les lignes de chaque table (les lignes orphelines sont ignorées et comptées) et ne modifie jamais le fichier SQLite.
5. Démarre la v2. Garde `data/bot.db` quelque temps comme sauvegarde.

Les versions 1.x ne peuvent pas être réinstallées depuis le panel sur une base PostgreSQL (elles attendent un fichier SQLite) : la page Versions le refuse.

## Déployer

- **Docker** : `docker-compose.yml` (PostgreSQL + bot + API + front, seul le front est exposé). Voir `.env.docker.example`. Mise à jour : nouvelle image (`docker compose pull` ou `--build`) puis `docker compose up -d` ; la page Versions du panel montre les nouvelles versions mais n'installe rien sous Docker.
- **Pterodactyl** : un egg tout-en-un, ou trois eggs (bot, API, front) pour le déploiement séparé : voir `docs/pterodactyl.md`. Les mises à jour depuis le panel installent la version sur l'API et le bot ; le front la suit tout seul (il la lit sur l'API toutes les 2 minutes).
- **webgune** : une base PostgreSQL, un service web (API + panel + télémétrie, `APP_ROLE=api`) et un service Bot Discord (`APP_ROLE=bot`) : voir `docs/webgune.md`.
- **À la main** : `npm run start:bot`, `npm run start:api`, `npm run start:front` (chacun sous `launcher.js`), ou `npm start` pour le tout-en-un.

## Variables propres au déploiement séparé

| Variable | Où | Rôle |
|---|---|---|
| `DATABASE_URL` ou `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | bot, API (et tout-en-un) | Base PostgreSQL |
| `INTERNAL_TOKEN` | bot, API, front | Secret de la liaison interne (32+ caractères) |
| `SERVE_PANEL` | API | `false` : seul le front sert le panel |
| `TRUST_PROXY` | API | Adresse(s) du front, pour lire l'IP réelle des visiteurs (`X-Forwarded-For`) ; `true` si seul le front peut joindre l'API |
| `API_URL` | front, bot | Adresse privée de l'API (`http://api:3001`) : le front y relaie `/api`, le bot s'y connecte |
| `WEB_PUBLIC_URL`, `WEB_MODE`, `TLS_*` | front (et API/bot pour les liens) | Adresse publique du panel et HTTPS |
