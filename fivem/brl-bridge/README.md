# brl-bridge — pont txAdmin → bot Discord

Petite ressource **serveur** FiveM qui écoute les événements de txAdmin et les envoie au bot Brothers Life (`POST /api/fivem/events`). Le bot les annonce sur Discord selon les réglages du panel, page **Annonces FiveM** :

| Événement txAdmin | Ce que le bot peut en faire |
| --- | --- |
| *(démarrage de la ressource)* `serverStarted` | Annonce « serveur en ligne » |
| `txAdmin:events:scheduledRestart` | Compte à rebours du redémarrage (rappels choisis parmi 30, 15, 10, 5, 4, 3, 2, 1 min) |
| `txAdmin:events:scheduledRestartSkipped` | Annonce « redémarrage annulé » |
| `txAdmin:events:serverShuttingDown` | Annonce d’arrêt / de redémarrage |
| `txAdmin:events:announcement` | Recopie des annonces txAdmin sur Discord |
| `txAdmin:events:playerKicked` / `playerBanned` / `playerWarned` / `playerDirectMessage` / `playerHealed` / `actionRevoked` | Logs du staff (catégorie « Événements FiveM »), jamais en public |

Noms et champs : [docs/events.md de txAdmin](https://github.com/citizenfx/txAdmin/blob/master/docs/events.md).

**Données envoyées** : noms, raisons, messages, et seulement l’ID Discord du joueur visé quand il est connu. Aucune licence, IP, token ni HWID ne quitte le serveur FiveM.

## Installation

1. **Panel du bot → API** : crée une clé nommée « Pont txAdmin » et coche **uniquement** la permission `fivem.events` (« Envoyer les événements du serveur FiveM au bot »). Ton rang doit avoir cette permission. Copie la clé `brl_…` (elle n’est affichée qu’une fois).
2. Copie le dossier `brl-bridge` dans `resources/` du serveur FiveM.
3. Dans `server.cfg` :

   ```cfg
   set brl_bridge_url "https://IP_DU_BOT:PORT"
   set brl_bridge_key "brl_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
   set brl_bridge_server "Brothers Life"
   ensure brl-bridge
   ```

   Utilise bien `set` (et non `setr` ni `sets`) : la clé ne doit être ni envoyée aux joueurs ni publiée dans les infos du serveur.
4. Redémarre le serveur, puis tape `brlbridge_test` dans la console du serveur : une annonce de test doit apparaître dans **Annonces FiveM → Derniers événements reçus** (statut « Désactivé » tant que l’événement « Annonce txAdmin » n’est pas activé : c’est normal, la connexion marche).
5. Dans le panel, active les événements voulus, choisis les salons, les messages (variables `{txadmin.*}`) et les rôles à mentionner.

Les autres réglages (événements envoyés, nouvelles tentatives, logs de debug) sont dans `config.lua`.

## Joindre le bot : HTTPS et certificat

Le pont passe par `PerformHttpRequest` de FXServer, qui s’appuie sur libcurl **avec vérification du certificat**. Conséquence :

- **Panel en `https-selfsigned` (cas de la prod Pterodactyl)** : le certificat auto-signé sera très probablement refusé. Dans la console FiveM, ça donne `non transmis (HTTP 0)`. Il n’existe pas d’option pour désactiver la vérification depuis Lua.
- **Solutions** :
  1. **Certificat valide** (recommandé) : un nom de domaine pointant vers le bot, puis un certificat Let’s Encrypt, soit via `WEB_MODE=https-custom` (`TLS_CERT` / `TLS_KEY`), soit via un reverse proxy (Caddy, Nginx) devant le panel.
  2. **Réseau privé** : si le serveur FiveM et le bot sont sur la même machine ou le même réseau local, un panel en `WEB_MODE=http` fonctionne (`set brl_bridge_url "http://IP_LOCALE:PORT"`). La clé circule alors en clair : à éviter sur Internet.
- La clé est limitée par le bot à 240 requêtes par minute, largement assez pour txAdmin.

> Non testé sur un vrai serveur FiveM : la logique côté bot est couverte par des tests, mais la partie Lua et le comportement exact de `PerformHttpRequest` avec un certificat auto-signé sont à vérifier à l’installation (commande `brlbridge_test`).

## Limites

- txAdmin prévient lui-même que ses événements peuvent être émis serveur éteint (ex. un ban depuis l’interface web pendant un arrêt) : dans ce cas la ressource ne tourne pas et rien n’est envoyé.
- `serverStarted` n’est envoyé que si la ressource démarre dans les 5 premières minutes du serveur (pas lors d’un simple `restart brl-bridge`).
- Le bot ignore un même événement reçu deux fois en moins de 15 s, et ne publie chaque rappel de redémarrage qu’une fois.
- Pendant une maintenance (panel ou `/fivem maintenance`), les annonces de démarrage, redémarrage et arrêt peuvent être coupées (réglage de la maintenance).
