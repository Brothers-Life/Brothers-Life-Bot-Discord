# Installation sur Pterodactyl

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
2. **Import Egg** : envoie `pterodactyl/egg-brothers-life-bot.json` dans ce nest.

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
| Adresse publique du panel | `https://<IP publique>:<port>`, ou vide pour utiliser l'allocation |
| Dépôt GitHub | `Brothers-Life/Brothers-Life-Bot-Discord` (déjà rempli) |
| Token GitHub | Vide si le dépôt est public, sinon le token de l'étape 1 |
| Version à installer | `latest` |

5. Crée le serveur : l'installation se lance toute seule (environ une minute).
6. Discord Developer Portal > OAuth2 > **Redirects** : ajoute `https://<IP publique>:<port>/api/auth/callback`.
7. Démarre le serveur. Pterodactyl l'affiche comme « en marche » quand la console montre `[LAUNCHER] App ready`.

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
| Variables du serveur (onglet Startup) | Configuration |
| `data/bot.db` | Base de données |
| `data/backups/` | Sauvegardes faites avant chaque installation (10 dernières) |
| `data/tls/` | Certificat auto-signé du panel |
| `versions/` | Versions installées (3 dernières, plus l'actuelle et la précédente) |
| `current.json` | Version active |
| `logs/` | Logs texte par jour (30 jours) |

## Si le bot plante en boucle

Après 5 plantages en 10 minutes, le lanceur s'arrête avec le code 1 et Pterodactyl affiche le serveur comme arrêté. La cause est dans la console Pterodactyl.

Pour revenir de force à la version précédente : dans `current.json`, remets `version` sur la valeur de `previous`, puis redémarre.

Pour repartir d'une version précise (par exemple si le panel ne démarre plus du tout) : mets la variable « Version à installer » sur le tag voulu (par exemple `v1.0.0`), puis **Settings > Reinstall Server**. La réinstallation remplace le code, mais garde la base (`data/`) et les logs.
