# Installation sur Pterodactyl

Deux façons d'installer le bot :

- **Un seul serveur** (egg « Brothers Life Bot ») : le bot et le panel ensemble. C'est le plus simple, et ce que décrivent les sections 1 à 4.
- **Trois serveurs** (eggs « Bot », « API » et « Front ») : chaque morceau séparé, voir la section « Déploiement séparé » plus bas et `docs/architecture.md`.

Dans les deux cas, les données sont dans une base **PostgreSQL**. L'onglet *Databases* de Pterodactyl ne crée que des bases MySQL : il faut un PostgreSQL à part (un serveur Pterodactyl avec l'egg PostgreSQL, un conteneur `postgres:17` sur la machine, ou un PostgreSQL hébergé).

## 1. Préparer GitHub

**Dépôt public** : rien à faire, laisse la variable « Token GitHub » vide.

**Dépôt privé** : le bot a besoin d'un token en lecture seule pour voir et télécharger les versions.

1. GitHub > Settings > Developer settings > **Fine-grained tokens** > Generate new token.
2. Connecté avec le compte `Brothers-Life` (propriétaire du dépôt), Resource owner : `Brothers-Life`. Repository access : **Only select repositories**, puis `Brothers-Life-Bot-Discord`.
3. Permissions > Repository permissions > **Contents : Read-only**. Rien d'autre.
4. Garde le token : c'est `GITHUB_TOKEN`.

Une version doit avoir été publiée (la v1.0.0 l’est déjà ; pour les suivantes, voir le README : `npm version`, puis `git push --follow-tags`).

## 2. Importer l'egg

Il faut être administrateur du panel Pterodactyl.

1. **Admin > Nests** : crée un nest (par exemple « Bots Discord ») ou prends un nest existant.
2. **Import Egg** : envoie `pterodactyl/egg-brothers-life-bot.json` dans ce nest (et, pour le déploiement séparé, `egg-brothers-life-bot-bot.json`, `-api.json` et `-front.json`).

L'egg contient :
- les images Docker (Node.js 22 ou 24) et le démarrage `node launcher.js prod` ;
- le script d'installation, qui télécharge la Release choisie depuis le dépôt privé et installe les dépendances sans rien compiler ;
- toutes les variables de configuration : plus besoin de fichier `.env.prod`.

Si l'egg change (`npm run egg` le régénère), ré-importe-le par-dessus l'ancien.

## 3. Créer le serveur

1. **Admin > Servers > Create New**, egg « Brothers Life Bot ».
2. Une allocation (IP et port) : le panel écoutera sur ce port.
3. 512 Mo de RAM suffisent pour quelques serveurs Discord ; prévois 1 Go si le réseau est gros.
4. Remplis les variables :

| Variable | Valeur |
|---|---|
| Token du bot | Developer Portal > Bot > Reset Token |
| ID de l'application | Developer Portal > General Information |
| Client Secret | Developer Portal > OAuth2 |
| Chef du réseau | Ton ID Discord (déjà rempli) |
| Mode du panel | `https-selfsigned` |
| Adresse publique du panel | `https://<IP publique>:<port>` : **obligatoire**, le certificat HTTPS est fait pour cette adresse |
| Dépôt GitHub | `Brothers-Life/Brothers-Life-Bot-Discord` (déjà rempli) |
| Token GitHub | Vide si le dépôt est public, sinon le token de l'étape 1 |
| Version à installer | `latest` |

5. Crée le serveur : l'installation se lance toute seule (environ une minute).
6. Onglet **Databases** du serveur > **New Database** (il faut qu'un administrateur ait ajouté un hôte de bases dans *Admin > Databases*). Recopie dans les variables du serveur : l'hôte de l'*Endpoint* (sans le port) dans « Base de données : hôte », le port, le nom (*Database*), l'utilisateur (*Username*) et le mot de passe (l'œil à côté).
7. Discord Developer Portal > OAuth2 > **Redirects** : ajoute `https://<IP publique>:<port>/api/auth/callback`.
8. Démarre le serveur. Pterodactyl l'affiche comme « en marche » quand la console montre `[LAUNCHER] App ready`. Au premier démarrage, le bot crée toutes les tables dans la base.

## 4. Premier accès au panel

1. Ouvre `https://<IP>:<port>`.
2. Le certificat est auto-signé : le navigateur affiche « Votre connexion n'est pas privée » (`NET::ERR_CERT_AUTHORITY_INVALID`). C'est normal. Avant d'accepter, compare l'empreinte SHA-256 du certificat (clic sur l'avertissement dans la barre d'adresse > certificat) avec celle écrite dans la console Pterodactyl au démarrage (`Panel TLS certificate SHA-256 fingerprint`). Si elles sont identiques : **Paramètres avancés** > **Continuer vers le site**.
   - `ERR_CERT_COMMON_NAME_INVALID` : l'adresse tapée n'est pas celle de la variable « Adresse publique du panel ». Corrige la variable et redémarre : le certificat est régénéré tout seul.
   - `ERR_SSL_PROTOCOL_ERROR` : tu es passé en `http://`, ou « Mode du panel » vaut `http`.
   - Le certificat dure 397 jours (maximum accepté par les navigateurs) et se renouvelle tout seul 30 jours avant la fin ; l'avertissement réapparaît alors une fois.
3. Connecte-toi avec le compte `OWNER_ID`.
4. **Serveurs** : choisis le serveur principal, puis ajoute les autres serveurs au réseau.
5. **Rangs** : crée tes rangs et lie-les aux rôles du serveur principal.
6. **Rôles du staff** : lie chaque rang au rôle correspondant sur chaque serveur.
7. **Salons de logs** : choisis les salons de chaque catégorie, sur chaque serveur.
8. **Automod**, **Tickets** et **Permissions Discord** : règle-les selon tes besoins.

Les commandes slash (`/ban`, `/warn`…) sont enregistrées automatiquement au premier démarrage, et à nouveau quand une version les modifie. Sur tous les serveurs, Discord peut mettre jusqu'à une heure à les afficher.

## Mises à jour

Panel > **Versions** > « Mettre à jour ». Le lanceur :

1. télécharge et prépare la version (`npm ci`) sans toucher au bot en marche ;
2. arrête le bot et démarre la nouvelle version ; si elle change le schéma de la base, elle l'enregistre d'abord dans `data/backups/avant-migration-….sql.gz` ;
3. si elle n'est pas prête en 60 secondes, relance l'ancienne version, qui restaure cette sauvegarde au démarrage.

En déploiement séparé, « Mettre à jour » installe la version sur l'API et sur le bot ; le front l'installe de lui-même dans les 2 minutes.

Revenir à une version plus ancienne se fait depuis la même page. Si l'ancienne version ne connaît pas la base actuelle, le panel propose de restaurer la sauvegarde correspondante, en indiquant ce qui sera perdu.

## Fichiers sur le serveur

| Chemin | Contenu |
|---|---|
| Variables du serveur (onglet Startup) | Configuration |
| Base PostgreSQL | Toutes les données, images et transcripts compris |
| `data/backups/` | Sauvegardes de la base faites avant chaque migration (10 dernières, `.sql.gz`) |
| `data/bin/` | yt-dlp et ffmpeg téléchargés par le bot (musique) |
| `data/tls/` | Certificat auto-signé du panel |
| `versions/` | Versions installées (3 dernières, plus l'actuelle et la précédente) |
| `current.json` | Version active |
| `logs/` | Logs texte par jour (30 jours) |

## Si le bot plante en boucle

Après 5 plantages en 10 minutes, le lanceur s'arrête avec le code 1 et Pterodactyl affiche le serveur comme arrêté. La cause est dans la console Pterodactyl.

Pour revenir de force à la version précédente : dans `current.json`, remets `version` sur la valeur de `previous`, puis redémarre.

Pour repartir d'une version précise (par exemple si le panel ne démarre plus du tout) : mets la variable « Version à installer » sur le tag voulu (par exemple `v1.0.0`), puis **Settings > Reinstall Server**. La réinstallation remplace le code, mais garde la base (`data/`) et les logs.

## Déploiement séparé (trois serveurs)

Le bot, l'API et le front tournent chacun sur leur serveur Pterodactyl (même nœud conseillé). Une seule base PostgreSQL pour les deux premiers.

1. Importe les eggs `egg-brothers-life-bot-bot.json`, `-api.json` et `-front.json`.
2. Choisis une **clé de liaison** : 32 caractères ou plus (`openssl rand -hex 32`). La même va dans la variable « Clé de liaison interne » des trois serveurs.
3. **Serveur API** (egg « Brothers Life — API ») : 256 à 512 Mo. Variables de la base PostgreSQL. « Adresses du front » : l'IP d'où le front joint l'API (souvent `172.18.0.1`). Son allocation ne doit être joignable que par le front et le bot (pare-feu).
4. **Serveur Bot** (egg « Brothers Life — Bot ») : 512 Mo à 1 Go. Mêmes variables de base que l'API (même base). « Adresse de l'API » : `http://<IP>:<port du serveur API>` ; sur le même nœud, l'IP interne de Pterodactyl (souvent `172.18.0.1`). Le bot se connecte à l'API : son allocation ne sert à rien d'autre, ne l'ouvre pas.
5. **Serveur Front** (egg « Brothers Life — Front ») : 128 Mo. C'est lui que les navigateurs ouvrent : « Adresse publique du panel » = `https://<IP publique>:<port du serveur Front>`, et le mode HTTPS se règle ici. « Adresse de l'API » : `http://<IP>:<port du serveur API>`.
6. « Adresse publique du panel » est la même sur les trois serveurs (celle du front). Ajoute `<adresse>/api/auth/callback` dans Discord > OAuth2 > Redirects.
7. Démarre l'API, puis le bot et le front (le bot réessaie tout seul tant que l'API n'est pas prête). La console du panel montre les lignes de l'API et celles du bot (préfixe `bot │`). Les boutons « Redémarrer » et « Arrêter » de la console agissent sur le bot.

Seul le serveur Bot a le token Discord. Si le bot redémarre, le panel reste ouvert et affiche « Le bot ne répond pas pour le moment » pour les actions qui ont besoin de lui.

## Passer de la v1 (SQLite) à la v2

Voir `docs/architecture.md`, section « Passer de la v1 (SQLite) à la v2 (PostgreSQL) » : base vide, installation de la v2, puis `node scripts/migrate-sqlite.mjs prod` dans la console du serveur qui a l'ancien `data/bot.db` (Pterodactyl : onglet *Startup*, ou un serveur temporaire), avant le premier démarrage du bot.
