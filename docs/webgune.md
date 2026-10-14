# Héberger sur webgune

Tout le projet tient dans un projet webgune (« Brothers Life Panel ») : **une base PostgreSQL**, **un service web** (API + panel + télémétrie FiveM) et **un service Bot Discord**. Les deux services sont construits depuis ce dépôt avec le `Dockerfile` ; la variable `APP_ROLE` choisit la partie lancée.

```
 Navigateur ─HTTPS─▶ brl-panel (web, APP_ROLE=api, SERVE_PANEL=true)  ◀── bl_telemetry (POST /v1/batch)
                        ▲   panel React + API + /v1 télémétrie
     websocket interne  │   (http://brl-panel.<namespace>.svc.cluster.local:3000/internal/bot)
                        │
                     brl-bot (Bot Discord, APP_ROLE=bot, aucun port)
                        │
            les deux ──▶ brl-db (PostgreSQL)
```

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

**brl-bot** : `APP_ROLE=bot`, `TOKEN` (token du bot), `API_URL=http://brl-panel.<namespace>.svc.cluster.local:3000`. Le bot se connecte à l'API par websocket : il n'a besoin d'aucun port.

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
