# Installation sur Pterodactyl

## 1. Préparer GitHub

Le repo est privé : le bot a besoin d'un token en lecture seule pour voir et télécharger les versions.

1. GitHub > Settings > Developer settings > **Fine-grained tokens** > Generate new token.
2. Resource owner : l'organisation `Brothers-Life`. Repository access : **Only select repositories**, puis `Brothers-Life-Bot-Discord`.
3. Permissions > Repository permissions > **Contents : Read-only**. Rien d'autre.
4. Garde le token : c'est `GITHUB_TOKEN`.

Publie au moins une version (voir le README : `npm version`, puis `git push --follow-tags`).

## 2. Créer le serveur

- Egg : **Node.js** (générique), Node 22 ou plus.
- Une allocation (port) : c'est `WEB_PORT`.
- Dans **Startup** :
  - `MAIN_FILE` (ou fichier de démarrage) : `launcher.js`
  - `AUTO_UPDATE` : **désactivé** (les mises à jour passent par le panel, pas par `git pull`)
  - Pas de dépôt Git à cloner.

## 3. Première installation

1. Télécharge l'archive `bot-vX.Y.Z.tar.gz` de la dernière Release GitHub.
2. Dans Pterodactyl > **Files** : envoie l'archive, puis clic droit > **Unarchive**.
3. Crée le fichier `.env.prod` (modèle : `.env.example`) :

```dotenv
TOKEN=...
APP_ID=...
CLIENT_SECRET=...
OWNER_ID=267235400467218432

WEB_PORT=<port alloué>
WEB_MODE=https-selfsigned
WEB_PUBLIC_URL=https://<IP de l'hébergeur>:<port alloué>

GITHUB_REPO=Brothers-Life/Brothers-Life-Bot-Discord
GITHUB_TOKEN=<token de l'étape 1>
```

   Plutôt que de laisser le token dans un fichier, tu peux définir `TOKEN`, `CLIENT_SECRET` et `GITHUB_TOKEN` comme variables d'environnement du serveur : elles passent avant le fichier.

4. Discord Developer Portal > OAuth2 > **Redirects** : ajoute `https://<IP>:<port>/api/auth/callback`.
5. Démarre le serveur. L'egg lance `npm install`, puis `node launcher.js`.

## 4. Premier accès au panel

1. Ouvre `https://<IP>:<port>`.
2. Le certificat est auto-signé : le navigateur affiche un avertissement. Avant d'accepter, compare l'empreinte SHA-256 affichée par le navigateur avec celle écrite dans la console Pterodactyl au démarrage (`Panel TLS certificate SHA-256 fingerprint`). Si elles sont identiques, accepte.
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
2. arrête le bot et sauvegarde la base dans `data/backups/` ;
3. démarre la nouvelle version ;
4. si elle n'est pas prête en 60 secondes, restaure la sauvegarde et relance l'ancienne version.

Revenir à une version plus ancienne se fait depuis la même page. Si l'ancienne version ne connaît pas la base actuelle, le panel propose de restaurer la sauvegarde correspondante, en indiquant ce qui sera perdu.

## Fichiers sur le serveur

| Chemin | Contenu |
|---|---|
| `.env.prod` | Configuration (à sauvegarder toi-même) |
| `data/bot.db` | Base de données |
| `data/backups/` | Sauvegardes faites avant chaque installation (10 dernières) |
| `data/tls/` | Certificat auto-signé du panel |
| `versions/` | Versions installées (3 dernières, plus l'actuelle et la précédente) |
| `current.json` | Version active |
| `logs/` | Logs texte par jour (30 jours) |

## Si le bot plante en boucle

Après 5 plantages en 10 minutes, le lanceur s'arrête avec le code 1 et Pterodactyl affiche le serveur comme arrêté. La cause est dans la console Pterodactyl.

Pour revenir de force à la version précédente : dans `current.json`, remets `version` sur la valeur de `previous`, puis redémarre.
