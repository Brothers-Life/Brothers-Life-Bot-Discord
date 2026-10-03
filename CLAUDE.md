# Bot Discord Brothers Life — notes de reprise

Bot Discord multi-serveurs pour la communauté RP **Brothers Life** (serveur FiveM Qbox) : il gère plusieurs serveurs Discord comme un seul réseau et s'administre depuis un panel web React en français. Tout le texte visible (Discord, panel, commits) est en **français** ; le code et ses commentaires en anglais.

État au 2026-10-03 : **v1.8.1 publiée**, tout est poussé, 324 tests verts.

## Commandes

```bash
npm run dev            # bot + panel API avec nodemon (lit .env)
npm run dev:web        # panel Vite seul (web/)
npm test               # node --test "test/**/*.test.js"
npm run lint           # eslint src/ test/ launcher.js launcher/
npm run build:web      # npm ci + tsc -b + vite build du panel (web/dist servi par le bot)
cd web && npx tsc -b && npx eslint src   # vérif du panel
npm run deploy:dev     # enregistre les commandes slash sur le serveur de dev
npm run egg            # régénère l'egg Pterodactyl
npm run bruno          # régénère la collection Bruno de l'API (bruno/)
```

Avant tout commit : `npm run lint`, `npm test`, et pour le panel `npx tsc -b` + `npx vite build` dans `web/`. La CI (`.github/workflows/ci.yml`) refait lint + tests + build du panel.

## Architecture

- **Node ESM**, discord.js 14, **better-sqlite3** (migrations numérotées `src/db/migrations/NNN_*.sql`, dernière : `036_api_keys.sql`), **Fastify** pour l'API du panel.
- **Panel** (`web/`) : React 19, Vite, TanStack Router (routes fichiers dans `web/src/routes/_authenticated/`, `routeTree.gen.ts` généré par Vite) + TanStack Query, shadcn/ui, Tailwind v4, recharts. Composants maison dans `web/src/components/app/ui.tsx` (`Page`, `Section`, `StatCards`, `Pill`, `EmptyState`, `Notice`, `UserAvatar`…) et `pickers.tsx`.
- `src/core/` : toute la logique, **sans discord.js**. Chaque service est créé dans `src/core/context.js` (`createCore`) et reçoit `executor` (accès Discord), `audit`, `settings`, `logs`, `network`, `ranks`…
- `src/bot/executor.js` : la seule couche qui parle à Discord (envoyer, rôles, membres, vocal, messages de log…). Dans les tests, `test/helpers.js` fournit un **faux exécuteur** (`createTestCore`, `withNetwork`).
- `src/bot/commands/<catégorie>/*.js` : commandes slash (`data` + `execute` + `autocomplete`). **Toute commande doit être listée dans `src/core/commandCatalog.js`** (un test le vérifie).
- `src/bot/components/*.js` : boutons/menus/modales, routés par le **préfixe du customId** (`export const prefix = 'mu'` → `mu:action:…`).
- `src/bot/events/*.js` : événements Discord. `src/bot/eventLog.js` transforme les événements en logs.
- `src/web/routes/*.js` : routes API, chacune avec `config: { permission: 'x.y' }`. Enregistrées dans `src/web/server.js`.
- Tâches périodiques : `setInterval` dans `src/index.js` (ticks des services).

## Conventions à respecter

- **Permissions** : `definePermission('cat.verbe', { label, category })` dans le service ; un acteur a `actor.can('…')`. Les services vérifient eux-mêmes (`ForbiddenError`).
- **Erreurs** : `ValidationError`, `ForbiddenError`, `NotFoundError` (`src/core/errors.js`) → messages affichés tels quels à l'utilisateur, donc en français clair.
- **Audit et logs** : `audit.record({ actorId, source, action: 'categorie.verbe', guildId, target, details })`. La partie avant le point est la **catégorie de log** : il faut `logs.registerCategory(key, label)` pour qu'elle soit routable vers un salon Discord. Les titres lisibles sont dans `TITLES` de `src/core/describe.js`.
- **Variables de modèles** : service commun `src/core/variables.js` (`variables.member(guildId, userId, { fivem })`, `.server(guildId)`, `.catalog(scope)`) pour membre/serveur/date/compte FiveM (`{fivem.*}` seulement si le texte les utilise, délai max 4 s). Chaque module ajoute les siennes. Panel : `VariableButton` (`web/src/components/app/variable-picker.tsx`) insère dans le dernier champ cliqué du conteneur.
- **Émojis** : `EmojiField`/`EmojiPicker` (`web/src/components/app/emoji-picker.tsx`), valeurs unicode ou `<:nom:id>` ; autocollants : `StickerPicker`.
- **Messages de log** (`logs.log(guildId, category, message, type)`) : objet `{ title, description, fields, color, author, authorId, thumbnail, thumbnailUserId, image, url, footer }`. `color` = nom (`info`, `success`, `warning`, `danger`, `neutral`, `brand`, `purple`, `pink`, `teal`) ou hex. L'exécuteur ajoute l'émoji de catégorie, résout `authorId`/`thumbnailUserId` en avatar.
- **Données FiveM dans les messages** : ajouter une variable `{fivem.*}` exige `fivemdata.view` (`assertFivemAllowed` dans les `save`), ne garder que les clés utilisées (`fivemKeysIn`), ne jamais renvoyer `ticket.vars` au panel ni mettre les notes internes dans ce qui part sur Discord.
- **Panel** : grilles avec `grid-cols-[minmax(0,1fr)]` (sinon débordement mobile), `TabsList` qui passe à la ligne : `h-auto flex-wrap [&>button]:h-8 [&>button]:flex-none`. Vérifier au navigateur (Playwright) desktop **et** 390 px.
- **DA** : ambre `#ff9628`, noir chaud, Bahnschrift/Barlow, coins « brackets » (`brackets`, `live-dot` dans `web/src/styles/index.css`).
- Pour une fonctionnalité : service core + tests (`test/core/*.test.js`) → câblage `context.js` → routes → page panel + entrée de nav (`web/src/components/layout/nav.ts`) → commande/composants bot → catalogue → titres d'audit.

## Fonctionnalités (ce qui existe)

Réseau de serveurs, rangs et permissions synchronisés, staff sync, sanctions (modèles, appels de sanction, restrictions, rôles temporaires), automod, anti-raid, tickets v2 (formulaires, statuts, variables, transcripts HTML style Discord : `src/core/transcript.js`, copie staff avec notes internes dans `data/transcripts/`, copie membre en MP), logs par catégorie/type avec packs et miroir réseau, annonces, embeds (créateur), messages privés, onboarding/bienvenue, vérification (bouton/captcha), salons automatiques (compteur, un mot, sticky, auto-publication, médias seuls), horaires d'ouverture de salons, archives HTML de salons, sondages, giveaways, suggestions/bugs, candidatures, absences (embed Valider/Refuser), événements RP, activité staff, réunions staff (convocation, présence vocale, compte rendu), salons vocaux perso, stats Discord (messages/vocal, carte de chaleur), fiches membres réseau, commandes perso, sauvegardes, modèles de serveur, streams, musique, FiveM (statut + données), API publique à clés (+ collection Bruno).

### Musique (`src/core/music/`, `src/bot/music/`)
- yt-dlp (zip **onedir** sous Linux, décompressé par `src/bot/music/unzip.js`, car le `/tmp` du conteneur est trop petit) et ffmpeg **téléchargés dans `data/bin`** au démarrage (`.npmrc` a `ignore-scripts=true`, donc pas de binaire ffmpeg-static).
- Le son passe par `yt-dlp -o -` → ffmpeg (les URL audio directes de YouTube renvoient 403).
- `opusscript` est **épinglé en ^0.0.8** (pair de prism-media ; 0.1.x casse `npm ci`).
- Le lecteur (embed + boutons `mu:`) est posté dans le **salon écrit du vocal** ; bouton « Gérer sur le panel » (URL = `WEB_PUBLIC_URL`, `setPanelUrl` dans `src/index.js`). `/musique jouer` sans recherche fait venir le bot avec son lecteur (`music.join`).
- Discord : une seule connexion vocale par serveur et par bot.

### FiveM — base de données du serveur (`src/core/fivemData.js`, `src/core/fivem/`)
- **Lecture seule** de la base Qbox (MariaDB, `mysql2`), connexion réglée dans le panel (Données FiveM → Connexion), mot de passe jamais renvoyé au panel. Les tables absentes sont ignorées (`when(table, …)`).
- Jointures : `users.discord = 'discord:<id>'`, `players.userId = users.userid`, `admindash_sanctions.target_dbid = users.userid`, `bl_mc_sessions.user_id = users.userid`, `xt_prison.identifier = citizenid`, identifiants téléphone = citizenid, staff `admindash_staff_sessions.license` = `license:…` (comparer sans préfixe), `management_groups.grades` JSON `{ "0": { name, payment } }`.
- Page panel `/fivem-players` (« Données FiveM ») : joueurs + fiche complète, **Statistiques** croisées (`fivem/insights.js` : fréquentation, rétention, jeu × activité Discord du bot, couverture staff, justice, économie/Gini, cryptos), activité, métiers et gangs, véhicules, justice, carte, staff, économie, **Rôles Discord** (`fivemRoles.js` : liaisons métier/gang/rôle staff → rôle Discord, check des écarts + correction), **logs du jeu** (26 sources unifiées, `fivem/logSources.js`).
- Le rôle staff en jeu = dernier rôle vu en session du menu admin (pas de table d'attribution, c'est dans l'ACE du serveur).
- Bot : `/joueur` (fiche éphémère + boutons `fd:`).
- Permissions : `fivemdata.view`, `.economy`, `.inventory`, `.logs`, `.roles`, `.manage`.

### API publique (`src/core/apiKeys.js`, `src/web/apiDocs.js`, `src/web/routes/api.js`)
- Toutes les routes `/api/*` du panel acceptent `Authorization: Bearer brl_…` (clé stockée en SHA-256, affichée une fois). La clé agit **au nom de son créateur**, limitée à ses permissions choisies (`null` = toutes, suit le rang) ; `panel.access` + `api.use` exigés. Pas de contrôle CSRF pour le Bearer, 240 req/min par clé.
- `config: { apiKey: false }` réserve une route au panel (clés, sessions) ; les websockets le sont d'office.
- Audit : la source reste `panel` (CHECK SQL sur `source` dans audit/sanctions) ; `requestContext` (AsyncLocalStorage) ajoute le champ « Clé d’API » aux détails.
- Doc générée depuis le registre des routes du guard (`registerGuard` le renvoie) : `/api/api-docs`, `/api/openapi.json`, `/api/bruno.zip` ; page panel `/developer` (« API »). Le nom de route `/api*` est réservé côté serveur (404 JSON), d'où `/developer`.
- Piège Ajv : dans un `anyOf`, mettre `{ type: 'null' }` **en premier**, sinon la coercition change `null` en `0`.

## Sécurité — à ne jamais faire

- Écrire des identifiants (BDD, tokens) dans le repo : ils passent par le panel ou des variables d'environnement.
- Lire ou exposer **IP et tokens des joueurs** (`bl_mc_sessions.ip`, `.tokens`) ou la table **`sky_phone_accounts`** (emails + mots de passe en clair).
- Écrire dans la base FiveM : uniquement des `SELECT` (un test du faux pool le vérifie).
- Conseillé à l'utilisateur : utilisateur MariaDB dédié avec SELECT seul ; le mot de passe actuel a circulé dans une conversation et doit être changé.

## Tests et vérification visuelle

- Tests unitaires : `node --test`, faux exécuteur et faux pool MySQL (`test/core/fivemData.test.js` montre le modèle : réponses par regex de SQL).
- **Jamais testé avec un vrai token Discord** : tout est validé par les tests et par un **panel de démo** (serveur Fastify réel + faux exécuteur + fausses données FiveM) lancé avec `NODE_TEST_CONTEXT=1 node demo-panel.mjs`, qui affiche `SID=…` à mettre en cookie `sid` sur `http://127.0.0.1:3001`. Ces scripts vivaient dans le scratchpad de session ; les recréer au besoin à partir de `test/helpers.js`.
- Scripts ponctuels sur la vraie base FiveM : lecture seule, identifiants en variables d'environnement, n'afficher que des formes/comptages (pas de données perso).
- Piège : les heredocs bash cassent les antislashs dans du Python/JS → écrire les scripts avec un fichier plutôt qu'un heredoc.

## Release et production

- Release : `npm version X.Y.Z --no-git-tag-version`, commit `chore: vX.Y.Z`, push `main`, puis tag `vX.Y.Z` (doit correspondre à `package.json`) et push du tag. Le workflow `release.yml` construit `bot-vX.Y.Z.tar.gz` (installable depuis le panel). Vérifier `npx -y npm@10 ci --dry-run` avant.
- Ne **pousser / publier que sur demande explicite** de l'utilisateur.
- Repo : https://github.com/Brothers-Life/Brothers-Life-Bot-Discord (privé), compte `Brothers-Life` via Git Credential Manager. `gh` n'est pas installé ; l'état d'une release se suit avec l'API GitHub (token de `git credential fill`).
- Prod : **Pterodactyl/Pelican**, accès panel par IP:port, HTTPS auto-signé, lanceur `launcher.js` (mises à jour, redémarrages), egg dans `pterodactyl/`, doc `docs/pterodactyl.md`. Les commandes slash se réenregistrent au démarrage.

## Historique des versions

- **v1.0.x** : socle (réseau, rangs, panel, logs, sanctions…) + 7 premiers chantiers (specs dans `docs/superpowers/specs/`).
- **v1.1.0** : transcripts, import de rôles, annonces, tickets v2, lot communauté.
- **v1.2.x** : commandes perso, sauvegardes, activité staff, événements RP, rangs v2, absences, logs par type, modèles de sanctions, musique (v1.2.1 : yt-dlp onedir).
- **v1.3.0** : musique v2 + playlists, fiches membres enrichies, salons auto, vérification, créateur d'embeds, navbar repliable + favoris + Ctrl+K, appels de sanction, horaires de salons, archives, /info, réunions staff.
- **v1.4.0** : FiveM — fiches joueurs, page Données FiveM, logs du jeu, check des rôles Discord, bouton panel du lecteur musique.
- **v1.5.0** : statistiques FiveM croisées, `/musique jouer` sans recherche.
- **v1.5.1** : logs Discord enrichis (avatars, images supprimées, dates, couleurs, durées).
- **v1.6.0** : sélecteur d'émojis façon Discord, variables communes (membre, serveur, compte FiveM lié) partout, émojis perso et autocollants, transcripts de tickets en page web style Discord.
- **v1.7.0** : molette dans les popovers des fenêtres, sélecteur de couleur libre + styles de bouton Discord, dupliquer partout, copie du système de tickets vers un autre serveur, `{fivem.*}` réservé à `fivemdata.view` (audit).
- **v1.8.0** : API publique à clés (Bearer `brl_…`, permissions limitées, 240 req/min), page « API » du panel, OpenAPI + collection Bruno (`bruno/`).
- **v1.8.1** : émojis validés (`src/core/emoji.js`) : un émoji invalide est ignoré au lieu de faire refuser la modale/le message par Discord.

## Pistes proposées, pas encore faites

- FiveM : synchro **automatique** des rôles Discord selon les métiers, signalements et logs du jeu envoyés sur Discord, sanctions/bans unifiés jeu ↔ Discord, service staff en jeu compté dans le score d'activité staff, mode maintenance FiveM.
- Autres : entreprises/factions, tâches staff, évaluations staff, notifications du panel (PWA), niveaux/XP, anti-alt, page publique, rappels perso.
