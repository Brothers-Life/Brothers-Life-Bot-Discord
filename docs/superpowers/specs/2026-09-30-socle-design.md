# Chantier 1 — Socle : conception

Date : 2026-09-30
Statut : validé en brainstorming, en attente de relecture

## Contexte et but

Bot Discord personnel qui gère plusieurs serveurs appartenant au même propriétaire comme un **réseau** : sanctions, staff, rôles, permissions, logs, automod et tickets synchronisés, pilotés depuis un **panel web**.

Le projet est découpé en chantiers, chacun avec sa conception, son plan et son implémentation :

| # | Chantier | Contenu |
|---|---|---|
| **1** | **Socle (ce document)** | Lanceur et versions, base de données, réseau, rangs et permissions, panel web minimal, console en direct, routage des logs |
| 2 | Sanctions | Ban, kick, timeout et warn synchronisés, détection des actions natives, historique commun |
| 3 | Logs ultra complets | Tous les événements serveur, recherche et filtres dans le panel |
| 4 | Automod | Anti-spam, anti-arnaque crypto, anti-envoi massif, seuils par serveur |
| 5 | Rôles et membres | Synchronisation des rangs staff, gestion depuis le panel |
| 6 | Tickets | Ouverture par bouton, catégories, transcripts |
| 7 | Permissions | Synchronisation des permissions des rôles et des salons |

Base de code : fork corrigé de `arthurcorberes/discordjs-bot-template` (discord.js v14, ESM, JavaScript).

## Décisions prises

| Sujet | Décision |
|---|---|
| Qui décide | Les sanctions peuvent partir de n'importe quel serveur du réseau ; le staff et les permissions ne se gèrent que depuis le serveur principal |
| Droits | **Tout passe par des permissions fines** attribuées à des rangs, configurées dans le panel : aucune page ni action n'est réservée en dur, sauf `OWNER_ID`, qui a tout (protection contre le verrouillage) |
| Actions natives Discord (hors bot) | Détectées via le journal d'audit et propagées si le rang de l'auteur l'autorise, sinon locales. Même règle pour les débans. *(chantier 2)* |
| Nouveau serveur | Rattrapage automatique : les bans réseau actifs y sont appliqués, et ses bans locaux importés dans l'historique sans propagation. *(chantier 2)* |
| Warns | Historique commun, sans palier automatique. *(chantier 2)* |
| Panel | Site web : React, Vite et TypeScript, sur la base du template **satnaing/shadcn-admin** (MIT) |
| Hébergement | Prod : Pterodactyl (un seul port, pas de domaine, accès par l'IP de l'hébergeur). Dev : local |
| HTTP | Trois modes : `http`, `https-selfsigned` (défaut en prod) et `https-custom` |
| Versions | Publiées par la CI sur les tags `vX.Y.Z` ; installation et choix de n'importe quelle version depuis le panel |
| Base de données | SQLite (`better-sqlite3`), fichier stocké sur le disque persistant du serveur |
| Repo | Développement en local ; le lien du repo GitHub sera fourni plus tard |

## Architecture

Un seul process parent (contrainte Pterodactyl) : le **lanceur**, qui fait tourner l'application dans un process enfant.

```
launcher.js             # point d'entrée Pterodactyl : supervise, installe les versions, capture la console
src/
├── index.js            # application : DB, puis bot, puis web
├── core/               # logique métier, sans dépendance à Discord ni à HTTP
│   ├── network.js      # serveurs, serveur principal, ajout et retrait
│   ├── permissions.js  # registre des permissions, permissions effectives, anti-escalade
│   ├── ranks.js        # rangs, liaisons aux rôles, rangs directs
│   ├── audit.js        # journal des actions
│   └── logRouting.js   # catégorie de log → salon, par serveur
├── db/                 # connexion, migrations SQL numérotées
├── bot/                # discord.js : commandes, events, exécuteur Discord
├── web/                # Fastify : OAuth2, sessions, API JSON, WebSocket console, sert web/dist
└── utils/              # logger, config (.env), i18n (repris du template corrigé)
web/                    # interface React (shadcn-admin), compilée dans web/dist par la CI
data/                   # bot.db, backups/, certificat auto-signé (non versionné)
versions/               # versions installées (non versionné)
```

**Règle centrale** : le bot et le panel ne contiennent pas de logique métier. Ils appellent `core/`. Les actions Discord sont exécutées par un **exécuteur** injecté dans `core/`, qu'on remplace par un faux exécuteur dans les tests.

Communication entre le lanceur et l'application : IPC Node (`process.send`) pour l'état, le signal « prêt », et les commandes de redémarrage, d'arrêt et d'installation ; les flux stdout et stderr pour la console.

## Données

Migrations `src/db/migrations/NNN_nom.sql`, appliquées au démarrage dans une transaction. La version du schéma est stockée dans `PRAGMA user_version`.

| Table | Colonnes principales |
|---|---|
| `guilds` | `id`, `name`, `status` (`pending` \| `active` \| `removed`), `is_main` (un seul à 1), `joined_network_at` |
| `ranks` | `id`, `name`, `level` (0 à 100, sert à la hiérarchie), `color` |
| `rank_permissions` | `rank_id`, `permission` (chaîne du registre de permissions) |
| `rank_roles` | `rank_id`, `guild_id`, `role_id` (au chantier 1, uniquement des rôles du serveur principal) |
| `user_ranks` | `discord_id`, `rank_id`, `added_by`, `added_at` (rang attribué directement, sans rôle Discord) |
| `sessions` | `id` (aléatoire, 256 bits), `discord_id`, `created_at`, `last_seen_at`, `expires_at`, `ip`, `user_agent` |
| `audit_log` | `id`, `at`, `actor_id` (ou `system`), `source` (`bot` \| `panel` \| `native` \| `system`), `action`, `target`, `details` (JSON), `results` (JSON : résultat par serveur) |
| `log_routes` | `guild_id`, `category`, `channel_id`, `enabled` |
| `settings` | `key`, `value` (JSON) |

### Permissions

Tout ce que fait le panel ou le bot est contrôlé par une **permission** : une chaîne déclarée dans un registre (`core/permissions.js`), avec un libellé et une catégorie pour l'affichage. Chaque chantier ajoute les siennes.

Permissions du chantier 1 :

| Permission | Donne accès à |
|---|---|
| `panel.access` | Se connecter au panel, page Accueil |
| `network.view` / `network.manage` | Voir les serveurs / ajouter, retirer, changer le serveur principal |
| `ranks.view` / `ranks.manage` | Voir / créer, éditer et supprimer des rangs, leurs permissions et leurs liaisons |
| `members.assign` | Attribuer ou retirer des rangs directs (`user_ranks`) |
| `logs.manage` | Configurer le routage des logs |
| `audit.view` | Consulter le journal |
| `sessions.manage` | Voir et révoquer les sessions des autres |
| `console.view` / `console.control` | Voir la console / redémarrer et arrêter le bot |
| `versions.view` / `versions.install` | Voir les versions / installer une version, restaurer une sauvegarde |

Exemples de permissions ajoutées plus tard : `sanctions.warn`, `sanctions.ban`, `tickets.view`, `automod.manage`…

### Permissions effectives

- Les **rangs** d'un utilisateur sont l'union de :
  - les rangs liés (via `rank_roles`) aux rôles qu'il a **sur le serveur principal** ;
  - ses rangs directs (`user_ranks`), qui permettent de donner l'accès au panel à quelqu'un sans lui donner de rôle Discord.
- Ses **permissions effectives** sont l'union des permissions de tous ses rangs. Son **niveau** est le `level` le plus haut parmi ses rangs.
- Recalcul quand les rôles changent (`GuildMemberUpdate`) ou quand un rang est modifié. Le résultat est gardé en cache mémoire. Une session ouverte perd immédiatement les permissions retirées.
- `OWNER_ID` (`.env`) a **toutes** les permissions, y compris celles des chantiers futurs, et ne peut pas être restreint depuis le panel. C'est la garantie qu'on ne se verrouille jamais dehors.

### Anti-escalade

- Un utilisateur ne peut pas accorder une permission qu'il n'a pas lui-même.
- Il ne peut pas créer, modifier, attribuer ou supprimer un rang de niveau supérieur ou égal au sien.
- Il ne peut pas modifier ses propres rangs.
- `OWNER_ID` échappe à ces règles.

### Cycle de vie d'un serveur

1. Le bot rejoint un serveur : il est créé en `pending` et rien n'y est synchronisé.
2. « Ajouter au réseau » dans le panel : passage en `active` et `joined_network_at` renseigné. Le rattrapage des bans sera ajouté au chantier 2.
3. « Retirer du réseau » : passage en `removed`, les données sont conservées et le bot reste sur le serveur.
4. Le bot est expulsé du serveur : passage en `removed` et alerte.

Premier démarrage : aucun serveur principal, aucun rang. Le panel (accessible au seul `OWNER_ID`) demande de le choisir parmi les serveurs `pending`.

## Routage des logs

Chaque log a une **catégorie**. Pour chaque serveur, chaque catégorie peut être envoyée dans son propre salon, ou désactivée. Plusieurs catégories peuvent partager un salon.

- Configuration dans le panel, par serveur : un tableau catégorie → sélecteur de salon, avec un interrupteur.
- **Miroir réseau** : chaque catégorie peut aussi être dupliquée dans un salon du serveur principal, avec un préfixe indiquant le serveur d'origine.
- Catégories du chantier 1 : `network` (ajout et retrait de serveurs, changement de serveur principal), `ranks` (rangs et liaisons), `panel` (connexions, échecs, accès), `system` (démarrage, crash, versions installées).
- Les chantiers suivants ajoutent leurs catégories (`sanctions`, `messages`, `members`, `roles`, `channels`, `voice`, `invites`, `automod`, `tickets`…) sans modifier le mécanisme : une catégorie est une simple chaîne déclarée dans un registre.
- `core/logRouting.js` expose `log(guildId, category, embed)`. L'envoi passe par une file par salon (limites de débit Discord). Si un salon est supprimé ou devient inaccessible, la route passe en `enabled = 0` et une alerte `system` est émise.

## Panel web

### Serveur HTTP

- Fastify, sur le port `WEB_PORT` (en prod, le port alloué par Pterodactyl).
- `WEB_MODE` :
  - `http` : dev local ;
  - `https-selfsigned` : un certificat est généré au premier démarrage dans `data/tls/` et valable 10 ans. Son empreinte SHA-256 est affichée dans la console pour vérification ;
  - `https-custom` : chemins `TLS_CERT` et `TLS_KEY` dans le `.env`.
- Sert `/api/*` et le WebSocket `/api/console`. Tout le reste renvoie `web/dist/index.html` (routage côté client).

### Authentification

- Discord OAuth2 (code grant), scope `identify` uniquement. L'URL de retour vient de `WEB_PUBLIC_URL` dans le `.env`. Un paramètre `state` aléatoire, lié à un cookie temporaire, protège contre le CSRF de connexion.
- Au retour, l'utilisateur doit avoir `panel.access` (ou être `OWNER_ID`). En cas de refus, on affiche une page d'erreur et on écrit `panel.login_denied` dans le journal.
- Sessions côté serveur (table `sessions`), avec un cookie `sid` `HttpOnly`, `SameSite=Strict`, et `Secure` si HTTPS.
- Durée de vie de 12h, et expiration après 2h d'inactivité. Page « Sessions » : liste et révocation.
- Limitation de fréquence : 10 tentatives de connexion par IP toutes les 15 minutes.
- Les requêtes qui modifient des données doivent porter l'en-tête `X-Requested-With`, en plus de `SameSite=Strict`.

### API

- Chaque route déclare sa permission requise. Un hook Fastify la vérifie à partir des permissions effectives. L'interface masque les actions interdites, mais seul le serveur fait foi.
- Les actions sensibles exigent `confirm: true` dans le corps de la requête. Liste : installer une version, arrêter le bot, retirer un serveur, changer de serveur principal, restaurer une sauvegarde.
- Format d'erreur unique : `{ "error": { "code": "FORBIDDEN", "message": "..." } }`. Le détail technique n'apparaît que dans les logs.

### Pages du chantier 1

| Page | Contenu | Permission requise |
|---|---|---|
| Connexion | Bouton « Se connecter avec Discord » | Aucune |
| Accueil | État du bot, ping, uptime, version, nombre de serveurs, dernières actions | `panel.access` |
| Réseau | Serveurs par statut, ajout et retrait, choix du serveur principal | `network.view` / `network.manage` |
| Rangs | CRUD des rangs, cases à cocher des permissions groupées par catégorie, liaison aux rôles du serveur principal | `ranks.view` / `ranks.manage` |
| Membres du panel | Qui a accès et par quel rang, attribution de rangs directs | `ranks.view` / `members.assign` |
| Logs | Routage catégorie → salon par serveur, miroir réseau | `logs.manage` |
| Journal | `audit_log` filtrable par auteur, action, serveur et date | `audit.view` |
| Sessions | Ses propres sessions (toujours visibles), celles des autres | `sessions.manage` |
| Console | Console en direct | `console.view` / `console.control` |
| Versions | Version actuelle, versions disponibles, changelogs, installation | `versions.view` / `versions.install` |

Toutes les pages sont visibles dans le menu uniquement si l'utilisateur a la permission correspondante. Chaque route de l'API déclare sa permission (`requires: 'network.manage'`), et le serveur la vérifie à chaque requête.

### Console en direct

- Le lanceur garde un buffer circulaire des 5 000 dernières lignes de stdout et stderr de l'application.
- WebSocket `/api/console` : à la connexion, envoi du buffer, puis des nouvelles lignes au fil de l'eau. Authentification par le cookie de session et permission `console.view`, vérifiées à l'ouverture ; la connexion est fermée si la permission est retirée.
- Interface : couleurs par niveau (préfixe du logger), filtre par niveau, recherche, pause du défilement, boutons « Redémarrer » et « Arrêter » (confirmation requise).
- **Pas de saisie de commandes**, par choix de sécurité.

## Versions et mises à jour

### Publication (CI GitHub Actions)

- À chaque push : `npm ci`, lint et tests.
- Sur un tag `vX.Y.Z` : lint et tests, compilation de `web/`, puis création d'une Release GitHub avec l'archive `bot-vX.Y.Z.tar.gz` (sources, `web/dist`, `package.json`, `package-lock.json`, sans `node_modules`) et le changelog (corps du tag annoté ou commits depuis le tag précédent).

### Lanceur (`launcher.js`)

- Seul fichier lancé par Pterodactyl (`node launcher.js`). Il est volontairement minimal et n'utilise que des modules intégrés à Node, pour ne jamais casser.
- Disque :
  - `versions/vX.Y.Z/` ;
  - `current.json` (`{ "version": "vX.Y.Z", "previous": "vA.B.C" }`) ;
  - `data/` partagé entre les versions.
- **Premier démarrage** (pas de `current.json`) : lance le code présent à la racine du dépôt. C'est le mode dev, où le lanceur est facultatif et `npm run dev` lance directement l'application.
- **Supervision** : l'application envoie `ready` par IPC une fois le bot connecté et le web en écoute. En cas de crash, redémarrage avec des délais croissants (1s, 5s, 30s, 5 min au maximum). Au-delà de 5 crashs en 10 minutes : état `crashed`, plus de redémarrage automatique, alerte `system`.

### Installation d'une version (depuis le panel)

1. Liste des versions via l'API GitHub Releases (`GITHUB_REPO`, et `GITHUB_TOKEN` en lecture seule si le repo est privé). Mise en cache pendant 10 minutes.
2. Téléchargement de l'archive dans `versions/vX.Y.Z.tmp/`, puis `npm ci --omit=dev`, puis renommage en `versions/vX.Y.Z/`. En cas d'échec, rien ne change et l'erreur s'affiche dans le panel.
3. Sauvegarde de la base : `data/backups/avant-vX.Y.Z-<horodatage>.db`, via l'API de sauvegarde SQLite.
4. Mise à jour de `current.json`, arrêt propre de l'application actuelle, démarrage de la nouvelle, qui applique ses migrations.
5. **Retour automatique** : sans `ready` dans les 60 secondes, ou en cas de crash avant `ready`, le lanceur restaure la sauvegarde, rétablit la version précédente dans `current.json` et relance. Alerte `system`.

### Détection des nouvelles versions

- Vérification toutes les 6 heures, et à la demande depuis le panel.
- Nouvelle version : bannière dans le panel et message dans le salon de la catégorie `system` du serveur principal. Une version ignorée n'est plus signalée.

### Retour à une version plus ancienne

Chaque archive contient `schema_version` (le numéro de la dernière migration).
- Si le `schema_version` de la cible est supérieur ou égal au `user_version` de la base, l'installation est directe.
- Sinon, le panel propose de restaurer la sauvegarde la plus récente compatible avec cette version (`user_version` inférieur ou égal au `schema_version` cible), en affichant « Les données modifiées depuis le JJ/MM HH:MM seront perdues ». Il faut confirmer. Sans sauvegarde compatible, le retour est refusé.
- Les 10 dernières sauvegardes sont conservées.

## Configuration

Toute la configuration passe par des fichiers `.env`, qui remplacent les `config.<env>.json` du template : `.env.dev` en local, `.env.prod` en prod. Le fichier est choisi par l'argument `dev` ou `prod`, et chargé avec `process.loadEnvFile` (intégré à Node, aucune dépendance). Sur Pterodactyl, les mêmes clés peuvent être définies comme variables de démarrage, qui passent alors avant le fichier. Seul `.env.example` est versionné.

```dotenv
# Discord
TOKEN=
APP_ID=
CLIENT_SECRET=
DEV_GUILD_ID=

# Chef du réseau : seul compte qui a TOUTES les permissions, non modifiable depuis le panel
OWNER_ID=267235400467218432

# Panel web
WEB_PORT=3000
WEB_MODE=http                 # http | https-selfsigned | https-custom
WEB_PUBLIC_URL=http://localhost:3000
TLS_CERT=
TLS_KEY=

# Versions
GITHUB_REPO=                  # owner/repo
GITHUB_TOKEN=                 # lecture seule, seulement si le repo est privé

USE_TRANSLATION_CACHE=true
```

`OWNER_ID` contient **un seul ID**. C'est la seule source des pleins pouvoirs : ni le panel ni la base ne peuvent en créer un second ou le modifier. Pour changer de chef, on modifie le `.env` et on redémarre.

Au démarrage, `startupChecks` vérifie en plus `CLIENT_SECRET`, `OWNER_ID` (un ID Discord valide : 17 à 20 chiffres), `WEB_PUBLIC_URL`, et la cohérence de `WEB_MODE` avec le protocole de `WEB_PUBLIC_URL`.

Intents Discord : `Guilds`, `GuildMembers` (privilégié) et `GuildModeration`. `MessageContent` et `GuildMessages` arriveront aux chantiers 3 et 4.

## Gestion des erreurs

- **Actions multi-serveurs** : chaque serveur est traité indépendamment. Le résultat par serveur (`ok` ou `error` avec le code Discord) est enregistré dans `audit_log.results` et affiché dans le panel, avec un bouton « Réessayer » sur les échecs.
- **Limites de débit Discord** : gérées par `@discordjs/rest`. Les opérations en masse passent par une file séquentielle, avec la progression visible dans le panel.
- **Application** : `unhandledRejection` et `uncaughtException` sont logués. `uncaughtException` provoque un arrêt, puis un redémarrage par le lanceur.
- **API** : handler d'erreur Fastify unique, sans stack ni message interne dans la réponse.

## Tests

- `node --test` sur `core/` et `db/` : base SQLite `:memory:` et faux exécuteur Discord. Cas couverts :
  - permissions effectives (union des rangs, OWNER_ID) ;
  - règles anti-escalade ;
  - cycle de vie des serveurs ;
  - routage des logs ;
  - migrations ;
  - compatibilité des versions pour un retour arrière.
- Lanceur : tests avec une fausse application (un script qui envoie `ready`, plante ou ne répond pas) pour la supervision et le retour automatique.
- Web : `fastify.inject` pour le flux OAuth (Discord simulé), les sessions, les permissions par route, le refus sans `panel.access` et le format d'erreur.
- CI : lint et tests à chaque push.

## Hors périmètre du chantier 1

Sanctions (chantier 2), logs d'événements Discord au-delà des catégories système (3), automod (4), synchronisation des rôles sur les autres serveurs (5), tickets (6), permissions (7), saisie de commandes dans la console.
