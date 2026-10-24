# Héberger sur webgune

Tout le projet tient dans un projet webgune (« Brothers Life Panel ») : **une base PostgreSQL**, **un service web** (API + panel + télémétrie FiveM) et **un service Bot Discord**. Les deux services sont construits depuis ce dépôt avec le `Dockerfile` ; la variable `APP_ROLE` choisit la partie lancée.

```
 Navigateur ─HTTPS─▶ brl-panel (web, APP_ROLE=api, SERVE_PANEL=true)  ◀── bl_telemetry (POST /v1/batch)
                        ▲   panel React + API + /v1 télémétrie
  websocket (INTERNAL_TOKEN) │   (wss://<domaine du panel>/internal/bot)
                        │
                     brl-bot (Bot Discord, APP_ROLE=bot, aucun port)
                        │
            les deux ──▶ brl-db (PostgreSQL)
```

## Installation en une commande

`scripts/webgune-setup.mjs` lit les anciens services du projet (`panel-api`, `panel`, `panel-db`) et crée `brl-db` et `brl-panel` avec les anciens réglages déjà remplis. Le bot n'est créé qu'avec `--with-bot`.

```bash
# Simulation (une clé en lecture suffit) : montre tout ce qui sera créé, secrets masqués
WEBGUNE_API_KEY=wgk_… node scripts/webgune-setup.mjs --branch claude/determined-wozniak-qisgw1 --dry-run
# Pour de vrai (clé avec services:write et projects:write)
WEBGUNE_API_KEY=wgk_… node scripts/webgune-setup.mjs --branch claude/determined-wozniak-qisgw1
# Plus tard, une fois l'ancien bot arrêté et ses données reprises
WEBGUNE_API_KEY=wgk_… BOT_TOKEN=… APP_ID=<id de l'appli du bot> node scripts/webgune-setup.mjs --branch … --with-bot
```

Ce qui est repris de l'ancien panel, sans rien retaper :
- **Réglages de télémétrie** : jeton d'ingestion (`INGEST_TOKEN`, bl_telemetry n'a rien à changer à part l'adresse), adresse du serveur FiveM, seuils d'alerte, durées de conservation, fuseau horaire.
- **Historique** : toutes les tables de l'ancienne base, copiées une fois au premier démarrage (`TELEMETRY_IMPORT_FROM`).
- **Accès** : les webmasters (`WEBMASTER_DISCORD_IDS`) reçoivent le rang « FiveM — webmaster » (tout, réglages compris), les comptes autorisés à la main le rang « FiveM — ancien panel » (lecture), que donnent aussi les rôles `DISCORD_ALLOWED_ROLE_IDS` du serveur `DISCORD_GUILD_ID`. Les comptes retirés ne reçoivent rien.
- **Connexion Discord** : l'application OAuth de l'ancien panel (`DISCORD_CLIENT_ID` / `SECRET`) sert à se connecter au panel tant que `APP_ID` / `CLIENT_SECRET` ne sont pas donnés.
- **Chef du réseau** : `OWNER_ID` = le premier webmaster de l'ancien panel, sauf si tu le donnes.

Chaque reprise ne se fait qu'une fois et n'écrase jamais ce qui a été changé depuis le panel. La reprise des données de la v1 (`migrate-sqlite.mjs`) garde la télémétrie et ses réglages.

## Services

| Service | Type webgune | Variables |
|---|---|---|
| `brl-db` | Base de données PostgreSQL | mot de passe choisi à la création |
| `brl-panel` | Web, GitHub, build **Dockerfile**, port 3000 | voir ci-dessous |
| `brl-bot` | Bot Discord, GitHub, build **Dockerfile** | voir ci-dessous |

**Communes aux deux** : `DATABASE_URL=postgresql://<user>:<mot de passe>@brl-db.<namespace>.svc.cluster.local:5432/<base>`, `INTERNAL_TOKEN` (32+ caractères, `openssl rand -hex 32`, le même sur les deux), `OWNER_ID`, `APP_ID`, `WEB_PUBLIC_URL=https://<domaine du panel>`, `GITHUB_REPO`.

**brl-panel** : `APP_ROLE=api`, `SERVE_PANEL=true`, `WEB_MODE=http` (le HTTPS est fait par webgune), `TRUST_PROXY=true`, `CLIENT_SECRET`, et pour la télémétrie :
- `TELEMETRY_INGEST_TOKEN` : le jeton que bl_telemetry envoie déjà (`telemetry_token`), pour ne rien changer côté jeu ; il peut ensuite être remplacé depuis le panel.
- `TELEMETRY_FIVEM_BASE` : `http://<ip>:30120` du serveur FiveM (statut et console).
- `TELEMETRY_IMPORT_FROM` (une seule fois) : l'URL interne de l'ancienne base `panel-db`. Au premier démarrage, l'API recopie l'historique dans les tables `tel_*` (identifiants des joueurs retirés), puis ne le refait plus jamais. La variable peut être retirée ensuite.

**brl-bot** : `APP_ROLE=bot`, `TOKEN` (token du bot), `API_URL=https://<domaine du panel>`. Le bot se connecte à l'API par websocket : il n'a besoin d'aucun port. L'adresse interne du cluster (`…svc.cluster.local:3000`) n'est pas joignable depuis un service Bot Discord (le websocket n'aboutit jamais) : le bot passe par l'adresse publique, en TLS, protégée par `INTERNAL_TOKEN`.

Dans Discord > OAuth2 > Redirects : `https://<domaine du panel>/api/auth/callback`.

## Basculer depuis l'ancienne installation

1. **Télémétrie** : sur le serveur FiveM, `set telemetry_url "https://<domaine du panel>"` (le jeton ne change pas), puis `restart bl_telemetry`. Les anciens services `panel` / `panel-api` peuvent ensuite être arrêtés ; garde `panel-db` tant que l'import n'est pas vérifié (page Télémétrie du panel).
2. **Bot (données de la v1)** : arrête le bot sur Pterodactyl (jamais deux bots avec le même token), expose temporairement `brl-db` (onglet Database > Exposer publiquement), puis depuis la machine qui a l'ancien `data/` :
   `DATABASE_URL=<URL publique de brl-db> node scripts/migrate-sqlite.mjs prod --from data/bot.db --data data`
   Retire l'exposition publique, puis démarre `brl-bot`.
3. **Accès au panel** : l'ancienne liste d'accès (`panel_users`) n'est pas reprise : les accès se donnent par les **rangs** du bot (permissions « Télémétrie FiveM » : `telemetry.view`, `.economy`, `.logs`, `.announce`, `.manage`).

## À savoir

- Le disque des services est éphémère : tout (images, transcripts, sauvegardes d'avant migration) est en base. Les sauvegardes planifiées de `brl-db` se règlent dans son onglet Sauvegardes.
- Les mises à jour se font par push sur la branche suivie (redéploiement automatique) ; la page Versions du panel n'installe rien sur webgune.
- La musique télécharge yt-dlp et ffmpeg au démarrage du bot (dans `data/bin`, à chaque redémarrage).
