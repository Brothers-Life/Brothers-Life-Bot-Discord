# Lot « communauté » — conception

Ce lot s'ajoute aux modèles de serveur (`2026-09-30-modeles-entreprise-design.md`). Tout se règle serveur par serveur, depuis le panel. Chaque réglage peut être repris par un modèle, avec ses salons et rôles remappés.

## 1. Accueil : bienvenue, départ, rôles auto, règlement

Page « Accueil » (section Communauté), avec un sélecteur de serveur.

- **Message de bienvenue** : salon, texte et embed (même éditeur et même aperçu que les annonces), MP optionnel.
  - Variables : `{user}` (mention), `{user.name}`, `{server}`, `{memberCount}`, `{inviter}` (tiré du suivi d'invitations existant), `{account.age}`.
- **Carte image de bienvenue** (et de départ, optionnelle) : image PNG générée par le bot avec `@napi-rs/canvas` (binaires précompilés, rien à compiler), jointe au message ou placée dans l'embed.
  - **Éditeur visuel dans le panel** :
    - canevas de taille choisie (1024×450 par défaut) ;
    - fond : couleur, dégradé ou image envoyée depuis le panel ou prise sur une URL https, avec un voile d'assombrissement ;
    - calques déplaçables à la souris et réglables dans un inspecteur :
      - avatar du membre : position, taille, forme ronde ou arrondie, bordure (couleur, épaisseur) ;
      - textes : contenu avec variables, police parmi celles embarquées, taille, graisse, couleur, alignement, ombre, largeur maximale avec réduction auto ;
      - rectangles : couleur, opacité, arrondi ;
      - images : logo envoyé depuis le panel.
    - ordre des calques, duplication, suppression.
  - **Aperçu** : c'est le rendu réel du serveur (`POST /api/onboarding/:guildId/card/preview`, même moteur que le bot), avec un membre fictif ou choisi.
  - **Fichiers** : les images envoyées vont dans `data/uploads/` (PNG, JPEG ou WebP, 4 Mo max, dimensions vérifiées) et sont servies au panel seulement.
- **Message de départ** : même principe (sans MP).
- **Rôles automatiques** : rôles donnés à l'arrivée, avec une liste pour les humains et une autre pour les bots.
  - Si le règlement exige une validation, les rôles « humains » ne sont donnés qu'après l'acceptation.
- **Règlement** : salon et embed configurables, avec un bouton « J'accepte » dont le libellé est modifiable.
  - Le clic donne les rôles « validé » et retire les rôles « non validé ».
  - Un âge de compte minimum est possible ; en dessous, un message explique pourquoi c'est refusé.
  - Le message est publié, puis mis à jour sur place quand le texte change.
  - La page indique qu'il faut cacher les salons à @everyone et les ouvrir au rôle validé.

Table `onboarding_config (guild_id PK, config JSON, updated_at, updated_by)` et message du règlement mémorisé dans la config. Permissions `onboarding.view` et `onboarding.manage`. Journalisé dans l'audit sous `onboarding.*`.

## 2. Anti-raid

Page « Anti-raid » (section Modération), par serveur :

- **Détection** : N arrivées en S secondes. Par défaut 10 en 30 s. Le serveur passe alors en mode raid pour M minutes (15 par défaut), prolongé tant que les arrivées continuent.
- **Pendant un raid** :
  - action sur chaque nouvel arrivant : rien, expulsion, bannissement local ou bannissement réseau ;
  - option « appliquer aussi aux comptes arrivés dans la fenêtre de détection » ;
  - verrouillages optionnels : invitations suspendues (`disableInvites`) et niveau de vérification monté au maximum. Les deux sont restaurés à la fin.
  - alerte dans la catégorie de log `antiraid`, avec ping de rôles au choix.
- **Filtre permanent sur les comptes récents** : âge minimum en jours, avec l'action rien, expulsion, ou rôle de quarantaine.
- **Déclenchement manuel** : bouton du panel et commande `/raid on|off`.

État en mémoire, avec journal d'audit et log. Permissions `antiraid.view` et `antiraid.manage`.

## 3. Commandes de modération et permissions

Chaque commande vérifie une permission de rang (catégorie « Commandes » dans l'éditeur de rangs) :

| Commande | Permission |
|---|---|
| `/clear nombre [membre] [contient] [bots]` | `commands.clear` |
| `/lock [salon] [raison]`, `/unlock [salon]` | `commands.lock` |
| `/lockdown on/off` (tous les salons texte du serveur) | `commands.lockdown` |
| `/slowmode duree [salon]` | `commands.slowmode` |
| `/role ajouter/retirer membre role [duree] [raison]` | `commands.roles` |
| `/nick membre [surnom]` | `commands.nick` |
| `/voc deconnecter/deplacer/muet` | `commands.voice` |
| `/unwarn id`, `/sanction voir/annuler/raison id` | `sanctions.revoke`, `sanctions.view` |
| `/userinfo membre` | `commands.userinfo` |
| `/raid on/off` | `antiraid.manage` |

- `/role` refuse les rôles gérés, ceux au-dessus du bot et les rôles « dangereux » (sauf pour le propriétaire). Il refuse aussi un rôle placé au-dessus du plus haut rôle Discord de l'auteur.
- Les commandes et leur permission sont listées sur la page « Commandes » du panel, en lecture seule.

## 4. Rôles temporaires

- Un rôle donné à une personne pour une durée : `/role ajouter … duree:7j`, ou depuis la fiche de la personne dans le panel.
- Table `temp_roles` : id, guild_id, user_id, role_id, expires_at, reason, created_by, created_at, removed_at.
- Une tâche toutes les 30 s retire les rôles expirés. Si la personne a quitté le serveur, la ligne est simplement close.
- La fiche personne liste les rôles temporaires en cours, avec « Retirer maintenant » et « Prolonger ».
- Journalisé sous `temproles.*`, catégorie de log `roles`. Permission `commands.roles`.

## 5. Statistiques

**Collecte**, en mémoire puis écrite chaque minute :
- `stats_activity (guild_id, day, channel_id, user_id, messages, voice_seconds)` ;
- `stats_hourly (guild_id, hour, messages, voice_seconds, active_users)` pour la carte heure × jour ;
- `stats_members (guild_id, day, joins, leaves, member_count, voice_peak)`.

Règles de collecte :
- les bots sont exclus ;
- le vocal est compté hors salon AFK, en séparant le temps « seul » du temps « avec au moins une autre personne » ; seul le second est compté ;
- rétention de 400 jours.

**Page « Statistiques »** :
- Filtres : serveur ou tout le réseau, période (7, 30 ou 90 j, 12 mois, ou dates choisies), salon, membre, humains seulement, staff seulement.
- Onglets :
  - **Vue d'ensemble** : cartes (messages, heures de vocal, membres actifs, arrivées et départs, évolution des membres) et courbes.
  - **Activité** : carte de chaleur heure × jour.
  - **Membres** : classement messages et vocal, triable.
  - **Salons** : classement.
  - **Staff** : sanctions par modérateur et par type, tickets pris et fermés, temps moyen de résolution, activité des membres du staff.
- Export CSV.

**Commandes** : `/stats serveur [periode]`, `/stats membre membre [periode]`, `/stats top messages|vocal [periode]`.

**Salons compteurs** : salons vocaux verrouillés, renommés toutes les 10 min (limite Discord de 2 renommages par 10 min).
- Modèle de nom avec variables : `{members}`, `{humans}`, `{bots}`, `{voice}`, `{boosts}`, `{staff}`, `{fivem.players}`, `{fivem.max}`, `{fivem.status}`.
- Depuis le panel, on crée le salon (le bot le crée verrouillé) ou on en choisit un existant.

Permissions `stats.view` et `stats.manage` (compteurs).

## 6. FiveM

Page « FiveM » (section Réseau). Liste des serveurs FiveM : nom, adresse `ip:port`, code cfx.re optionnel pour le bouton « Se connecter ».

- **Interrogation** toutes les 60 s de `http://ip:port/dynamic.json` et `/players.json` (délai d'attente 5 s), avec mise en cache. Le panel affiche l'état en direct dans la liste.
- **Embeds de statut** : liste de salons par serveur FiveM. Le message est édité chaque minute : en ligne ou hors ligne, joueurs X/Y, liste des joueurs optionnelle, bouton lien `https://cfx.re/join/<code>`.
- **Statut du bot** : serveur(s) FiveM choisi(s), avec rotation toutes les 30 s s'il y en a plusieurs. Texte modifiable : « {players}/{max} joueurs sur {name} », et un texte distinct hors ligne.
- **Commande** `/fivem [serveur]` : statut et joueurs en ligne.

Permissions `fivem.view` et `fivem.manage`.

## 7. Tickets v2 (tout configurable)

Le sélecteur de serveur passe dans l'en-tête de la page, avec un libellé.

**Panneaux** (plusieurs par serveur) :
- salon, embed complet (éditeur des annonces) et liste des types de tickets proposés ;
- affichage en boutons (couleur par type) ou en menu déroulant.

**Types de tickets** (les anciennes « catégories ») :
- nom, émoji, description, couleur du bouton ;
- **Formulaire** : 0 à 5 étapes, chaque étape étant un modal de 1 à 5 questions. Une question a :
  - un libellé, un texte d'aide et une valeur par défaut ;
  - un style court ou paragraphe ;
  - une option « obligatoire » et des longueurs minimum et maximum.
  - Entre deux modals, le bot répond « Étape 2/3 — Continuer » : Discord n'autorise pas d'enchaîner deux modals.
  - Les réponses sont gardées sur le ticket (`answers`), affichées dans le message d'accueil et dans le panel, et reprises dans le transcript.
- **Nom du salon** : modèle avec variables `{number}`, `{user}`, `{type}`, `{status}`, `{claimer}`.
- **Staff** : rangs et rôles Discord. Ping à l'ouverture : staff, aucun, ou rôles au choix.
- **Message d'accueil** : texte et embed personnalisés, avec les variables et les réponses du formulaire.
- **Accès** :
  - rôles requis pour ouvrir et rôles interdits ;
  - maximum de tickets ouverts par personne, pour ce type et pour tout le serveur ;
  - délai minimum entre deux tickets ;
  - horaires d'ouverture par jour de la semaine, avec un message hors horaires.
- **Prise en charge** : une seule personne, avec une option « seul celui qui a pris le ticket peut écrire » (les autres membres du staff lisent seulement). Transfert possible.
- **Fermeture** :
  - raison obligatoire ou non ;
  - le membre peut fermer ou non ;
  - demande de confirmation ;
  - après fermeture, soit suppression après un délai réglable, soit archivage : déplacé dans la catégorie Discord d'archive, membre retiré, boutons « Rouvrir », « Supprimer » et « Transcript ».
- **Inactivité** : rappel après X heures sans message, puis fermeture automatique après Y heures.
- **Satisfaction** : note de 1 à 5 en MP après fermeture, avec commentaire optionnel. Visible dans le panel et dans les stats du staff.
- **Transcripts** : salon par type, envoi en MP au membre (oui ou non).

**Statuts personnalisés** (par serveur) :
- Chaque statut a une clé, un libellé, un émoji, une couleur et une catégorie Discord cible.
- Statuts intégrés : Ouvert, Pris en charge, Fermé. On en ajoute d'autres : En attente du membre, Urgent, Escaladé…
- Chaque type de ticket peut surcharger la catégorie Discord de chaque statut. Le ticket va dans une catégorie Discord selon son statut, et un préfixe émoji est ajouté au nom du salon (optionnel).
- Le staff change le statut avec un menu dans le ticket, avec `/ticket statut`, ou depuis le panel.

**Priorité** : basse, normale, haute ou urgente. Elle est affichée et sert à trier dans le panel.

**Commandes** : `/ticket ajouter|retirer|renommer|transferer|statut|priorite|fermer|rouvrir`.

**Tickets en direct dans le panel** :
- Les messages des salons de ticket sont enregistrés au fil de l'eau dans `ticket_messages` : auteur, contenu, pièces jointes, embeds, modifications et suppressions.
- Le panel affiche la conversation comme dans Discord et la met à jour en direct par WebSocket (`/api/tickets/live`) : nouveaux messages, modifications, statut, prise en charge.
- **Répondre depuis le panel** :
  - le message part par un webhook du salon, avec le nom et l'avatar du membre du panel (« Pedro · Panel ») ;
  - pièces jointes possibles ;
  - option « note interne », visible seulement dans le panel.
- Depuis la fiche : prendre en charge, changer le statut ou la priorité, ajouter un membre, fermer, rouvrir. Il faut `tickets.handle`.
- La liste des tickets ouverts se met à jour en direct, avec un badge de messages non lus par ticket et une notification sonore optionnelle.

**Panel** :
- liste filtrable par statut, type, priorité, pris par et membre ;
- fiche ticket : réponses du formulaire, historique des statuts, transcript et note.

**Base** : migration qui fait évoluer `ticket_categories` (config JSON), ajoute `ticket_panels` et `ticket_statuses`, et ajoute aux tickets les colonnes `answers`, `priority`, `status_key`, `last_activity_at`, `rating`, `rating_comment` et `status_history`.

## 8. Sondages

Page « Sondages » (section Communauté) et commande `/sondage creer`.

- **Question et message** : une question, de 2 à 25 choix (libellé, émoji, description), et un embed personnalisable (éditeur des annonces).
- **Où il est publié** : un ou plusieurs salons, sur un ou plusieurs serveurs, avec le même éditeur de cibles et de ping que les annonces. Les votes sont comptés ensemble sur tous les salons.
- **Mode de vote** : un seul choix ou plusieurs (minimum et maximum), en boutons ou en menu. On peut changer son vote, ou non.
- **Confidentialité** : vote anonyme (le panel ne montre pas les votants) ou public (« Qui a voté ? »).
- **Affichage des résultats** : en direct (barres dans l'embed, mise à jour groupée toutes les 5 s), à la fin seulement, ou jamais (seulement dans le panel).
- **Qui peut voter** : rôles autorisés et interdits, âge de compte minimum, ancienneté sur le serveur minimum.
- **Durée** : début programmé optionnel ; fin à une date, à la main, ou quand N votes sont atteints.
- **Fin du sondage** : message de résultats, épinglage optionnel, rôle donné aux votants d'un choix (optionnel).
- **Panel** : liste, détail (graphique, votes par serveur, export CSV), fermer, rouvrir, dupliquer, supprimer.

Tables `polls` et `poll_votes (poll_id, user_id, choice, guild_id, at)`. Permissions `polls.view` et `polls.manage`.

## 9. Giveaways

Page « Giveaways » et commande `/giveaway creer|finir|retirer|liste`.

**Création** :
- lot, nombre de gagnants, description, image et couleur (embed personnalisable) ;
- publication : un ou plusieurs salons ou serveurs, ping ;
- dates de début (programmable) et de fin ;
- bouton « Participer » (le recliquer retire la participation), avec un compteur de participants mis à jour régulièrement.

**Conditions d'entrée** (toutes cumulables) :
- rôles requis (tous ou au moins un) et rôles exclus ;
- âge de compte minimum et ancienneté sur le serveur minimum ;
- nombre de messages minimum sur le serveur sur une période (grâce aux stats) ;
- temps de vocal minimum (stats) ;
- présence sur un autre serveur du réseau ;
- pas de sanction active et aucun avertissement depuis X jours.

Si une condition manque, le message éphémère dit exactement laquelle.

**Chances** :
- bonus d'entrées par rôle (ex. Booster ×2, VIP ×3), cumulables ou au maximum ;
- plafond global d'entrées.

**Tirage** :
- tirage aléatoire cryptographique (`crypto.randomInt`), pondéré par les entrées, sans doublon ;
- vérification au moment du tirage que chaque gagnant est toujours membre et remplit les conditions ; sinon un autre est tiré ;
- annonce des gagnants avec ping et MP aux gagnants (texte personnalisable) ;
- rôle temporaire gagnant optionnel (rôles temporaires) ;
- délai de réclamation optionnel : bouton « Je réclame » dans le MP ou le salon, sinon relance automatique ;
- relance (`reroll`) de 1 ou N gagnants, depuis le panel ou la commande ;
- le staff ne peut pas participer (option), et on peut exclure les gagnants récents (X jours).

**Suivi** :
- journal : chaque tirage est enregistré (graine, liste des participants, poids) pour pouvoir le vérifier ;
- panel : liste (programmés, en cours, terminés), participants avec entrées et raison de l'exclusion éventuelle, gagnants, réclamé ou non, reroll, finir maintenant, annuler, dupliquer, export CSV ;
- logs : catégorie `giveaways`.

Tables `giveaways`, `giveaway_entries` et `giveaway_winners`. Permissions `giveaways.view`, `giveaways.manage` et `giveaways.join_exempt` (staff exclu).

## 10. Notifications de streams et vidéos

Page « Notifications » (section Communauté). Chaque abonnement associe une chaîne à un ou plusieurs salons du réseau.

**Plateformes** :
- **Twitch** : début de live (titre, jeu, miniature, viewers). API Helix avec l'ID client et le secret de l'app, saisis dans le panel et stockés côté serveur, le secret n'étant jamais renvoyé. Interrogation toutes les 60 s, jusqu'à 100 chaînes par requête.
- **YouTube** : nouvelles vidéos et Shorts via le flux RSS public (sans clé, toutes les 5 min). Lives via l'API YouTube Data si une clé est fournie ; sinon détection par la page `/live` de la chaîne.
- **Kick** : début de live, via l'API officielle (ID client et secret).

**Par abonnement** :
- message et embed personnalisables avec variables `{streamer}`, `{title}`, `{game}`, `{url}`, `{thumbnail}`, `{viewers}` ;
- ping (aucun, @everyone, @here, rôles) ;
- filtres : mots du titre requis ou exclus, Shorts inclus ou non ;
- en fin de live : message édité (« Live terminé », durée, pic de viewers) ou supprimé ;
- anti-doublon : un live n'est annoncé qu'une fois, même après un redémarrage (état en base) ;
- rôle « En live » optionnel pour un membre du Discord lié à la chaîne, retiré à la fin.

**Panel** :
- liste des abonnements, avec l'état en direct (en live ou non, dernière vidéo) ;
- bouton « Tester » qui envoie un exemple ;
- historique des notifications envoyées.

Tables `stream_subscriptions` et `stream_state`. Permissions `notifications.view` et `notifications.manage`.

## 11. Suggestions et reports de bug

Un seul moteur, deux « boîtes » par défaut : Suggestions et Bugs. On peut en créer d'autres (ex. « Idées d'events »). Page « Suggestions » (section Communauté).

**Chaque boîte (par serveur)** :
- salon de publication, et salon « staff » optionnel pour une validation avant publication ;
- formulaire modal personnalisable, avec le même éditeur que les tickets. Exemple pour les bugs : titre, description, étapes pour reproduire, gravité ;
- pièces jointes : le membre peut ajouter des captures dans le fil (thread) créé automatiquement ;
- dépôt par bouton sur un panneau (publiable), par `/suggestion` ou `/bug`, ou (option) par message dans un salon dédié, converti automatiquement ;
- votes : 👍/👎 en boutons, avec score et pourcentage dans l'embed. Un vote par personne, modifiable. Votes anonymes ;
- statuts personnalisables (En attente, En étude, Acceptée, Refusée, En cours, Faite, Doublon…), chacun avec une couleur et un émoji.
  - Le staff change le statut avec une raison : l'embed est mis à jour et l'auteur est prévenu en MP.
  - Option : déplacement vers un salon « acceptées » ou « refusées ».
- rôles autorisés, délai entre deux dépôts, anonymat possible (auteur caché publiquement, visible par le staff) ;
- fil de discussion automatique, verrouillé à la clôture.

**Panel** : liste filtrable (boîte, statut, auteur, score), fiche avec les votes, changement de statut avec raison, fusion de doublons, export CSV.

Tables `feedback_boxes`, `feedback_items` et `feedback_votes`. Permissions `feedback.view` et `feedback.manage`.

## 12. Annonces : programmation poussée et images

Ajouts au système d'annonces existant :
- **Images envoyées depuis le panel** (uploads, 8 Mo max chacune, 10 max) :
  - grande image ou miniature de l'embed ;
  - galerie : jusqu'à 4 images affichées ensemble grâce à plusieurs embeds qui partagent la même URL ;
  - pièces jointes.
- **Récurrence** : une fois, tous les jours, certains jours de la semaine à une heure donnée, tous les mois (jour N), ou tous les X heures ; avec une date de fin ou un nombre d'envois. Fuseau Europe/Paris par défaut.
- **Calendrier** : vue mois et semaine des envois à venir, dans le panel.
- **Options d'envoi** :
  - suppression automatique après X heures ;
  - épinglage ;
  - fil de discussion créé sous l'annonce ;
  - réactions ajoutées automatiquement ;
  - boutons liens (jusqu'à 5).
- **Modèles d'annonces** : enregistrer une annonce comme modèle et la réutiliser.
- **Variables** : `{date}`, `{server}`, `{memberCount}`.

## 13. Moteur de formulaires commun

Tickets, suggestions, bugs et recrutement partagent le même moteur (`src/core/forms.js`) et le même éditeur dans le panel.

- **Étapes** : un formulaire est une suite d'étapes, chaque étape étant un modal de 1 à 5 champs.
- **Types de champs** : texte court, paragraphe, et, dans les modals récents, menu de choix simple ou multiple, choix de rôle, de membre ou de salon, via `LabelBuilder` de discord.js 14.27.
- **Chaque champ** : libellé, aide, texte d'exemple, obligatoire, longueurs, valeur par défaut. Condition optionnelle : afficher une étape seulement si une réponse précédente vaut X.
- **Réponses** : validées côté serveur et stockées en JSON `[{id, label, value}]`.

## 14. Rôles de punition (restrictions)

Nouveau type de sanction `restrict`, avec un profil de restriction. Profils par défaut, modifiables dans le panel :
- **Muet écrit** : pas d'envoi de messages, de fils ni de réactions ;
- **Muet vocal** : pas de parole ni de vidéo ;
- **Pas de vocal** : ne peut pas se connecter ;
- **Pas d'images** : pas de fichiers ni d'embeds.

On peut aussi créer ses propres profils à partir d'une liste de permissions à interdire.

**Mise en œuvre** :
- Sur chaque serveur, le bot crée et entretient un rôle par profil (« Restreint · Muet écrit »…), placé juste sous son propre rôle.
- Il pose les surcharges d'interdiction sur toutes les catégories et tous les salons non synchronisés, y compris les salons créés plus tard (événement `channelCreate`).
- Réparation possible depuis le panel.

**Usage** : commande `/restreindre membre profil [duree] [raison] [local]`, et `/lever` pour retirer. Même circuit que les autres sanctions : réseau ou local, durée, historique, levée, logs. Si un restreint quitte le serveur puis revient, sa restriction est réappliquée.

## 15. Changelog

Page « Changelog » (section Communauté). Une entrée a une version ou un titre, une date, et des éléments typés : Ajout, Modification, Correction, Retrait, Sécurité, chacun avec son émoji. Elle a aussi une image optionnelle et un texte d'introduction.

- **Publication** dans des salons choisis sur le réseau. Modifier une entrée dans le panel met à jour le message partout, comme les messages synchronisés du §17.
- **Consultation** : `/changelog [version]` affiche une entrée ou la dernière, et une page publique en lecture seule n'est pas prévue.
- **Brouillons**, publication programmée et ping configurable.

## 16. Recrutement du staff

Page « Recrutement » (section Staff).

**Postes** (Modérateur, Helper, Dev…), chacun avec :
- un formulaire complet (moteur §13, plusieurs étapes, choix) ;
- l'état ouvert ou fermé, et une date de fermeture ;
- des conditions : âge du compte, ancienneté sur le serveur, aucune sanction depuis X jours, rôles requis, activité minimale (stats) ;
- une limite d'une candidature par X jours ;
- un panneau de candidature publiable (boutons ou menu).

**Traitement** :
- salon « candidatures » du staff : un embed par candidature, avec les réponses et un fil de discussion automatique ;
- votes du staff (pour, contre, neutre) avec commentaire, visibles dans le panel ;
- statuts : Reçue, En étude, Entretien, Acceptée, Refusée, Retirée ;
- MP au candidat à chaque changement de statut, avec un texte personnalisable par statut ;
- une candidature acceptée donne des rôles Discord et, en option, un rang du panel (dans la limite du niveau de celui qui accepte) ;
- entretien : création optionnelle d'un salon privé candidat + recruteurs, qui reprend les tickets.

**Panel** : tableau filtrable par poste, statut et candidat, fiche avec les réponses, votes, notes internes et historique, export CSV.

Permissions `recruitment.view`, `recruitment.vote` et `recruitment.manage`.

## 17. Messages dynamiques et synchronisés

Page « Messages » (section Communauté). Un message persistant a un contenu et un embed (éditeur des annonces, images comprises) et une liste de cibles (salons sur n'importe quels serveurs du réseau).

- **Modifier dans le panel** édite le message partout, sans le renvoyer. Un message supprimé à la main sur Discord est reposté, en option.
- **Dynamique** : variables rafraîchies automatiquement toutes les N minutes (1 à 60) :
  - `{members}`, `{humans}`, `{voice}`, `{boosts}`, `{online.staff}` ;
  - `{network.members}` ;
  - `{fivem.players}`, `{fivem.status}` ;
  - `{date}`, `{time}`, `{sanctions.today}` ;
  - `{tickets.open}` ;
  - variables libres définies dans le panel (clé → valeur, modifiables d'un clic).
- Les variables serveur sont calculées pour le serveur de chaque cible, ou pour tout le réseau avec `network.`.
- Seuls les changements réels provoquent une édition, pour rester sous les limites Discord.

Tables `live_messages` et `live_message_targets`. Permissions `messages.view` et `messages.manage`.

## 18. Vocaux personnels

Salons « Rejoindre pour créer » (plusieurs par serveur possibles, chacun avec sa configuration) :
- catégorie de création, modèle de nom (`Salon de {user}`, `{game}`…) ;
- limite, débit et région par défaut, et limite maximale de vocaux par personne ;
- rôles autorisés à créer.

**Panneau de contrôle** : dans le chat texte du vocal, le créateur (propriétaire) a :
- renommer, limite d'utilisateurs, verrouiller et déverrouiller, cacher et montrer ;
- autoriser ou bloquer des membres (menu), expulser ;
- mode lent du chat, débit, région ;
- salle d'attente optionnelle ;
- transférer la propriété, réclamer le salon si le propriétaire est parti ;
- réinitialiser.

Même chose avec `/voc-perso …`.

- **Mémoire** : les réglages de chaque créateur (nom, limite, liste blanche et liste noire) sont réappliqués à son prochain salon.
- **Suppression** : le salon est supprimé quand il est vide (après X secondes). Au démarrage du bot, les salons vides et les salons orphelins sont nettoyés.
- **Réglages du panel** : les salons créateurs, les options autorisées aux créateurs (ex. interdire « cacher »), et la liste des vocaux actifs.

Tables `voice_hubs`, `voice_rooms` et `voice_prefs`. Permissions `voice.view` et `voice.manage`.

## 19. Absences du staff

- **Déclaration** : `/absence declarer debut fin raison` ou un bouton sur un panneau (modal), et aussi depuis le panel. On peut déclarer pour quelqu'un d'autre avec la permission.
- **Validation** : optionnelle, selon un réglage. Un membre du staff de rang supérieur accepte ou refuse, et le déclarant reçoit un MP.
- **Pendant l'absence** :
  - rôle « Absent » optionnel sur tous les serveurs du réseau, retiré automatiquement au retour ;
  - pseudo préfixé en option (« [ABS] ») ;
  - la personne est exclue des pings de tickets et du tirage des prises en charge ;
  - elle est signalée dans les stats du staff.
- **Retour** : anticipé avec `/absence retour`, prolongation possible, rappel en MP la veille du retour.
- **Suivi** : salon d'annonce des absences, avec un message dynamique « Staff absent actuellement » (§17). Le panel a un calendrier des absences, une liste, et l'historique par personne.

Permissions `absences.view`, `absences.declare` et `absences.manage`.

## 20. Bugs internes du staff

C'est une boîte du moteur de suggestions (§11) en mode « staff » : visible seulement par le staff, sans vote public, avec des champs en plus.

- **Niveau d'urgence** : Basse, Moyenne, Haute ou Critique, chacun avec sa couleur, son ping (rôles différents par niveau) et son délai de prise en charge attendu.
  - Une alerte de relance est envoyée si le délai est dépassé sans prise en charge.
  - Un bug Critique est aussi mis en avant dans la vue d'ensemble du panel.
- **Suivi** : assignation à une personne, statuts (Nouveau, Assigné, En cours, En test, Résolu, Rejeté), fil de discussion et pièces jointes.
- **Panel** : tableau trié par urgence puis ancienneté, avec filtres et export.

## 21. Messages privés via le bot (boîte de réception)

Page « Messages privés » (section Communauté).

- **Écrire** : depuis le panel, on écrit en MP à n'importe quel membre du réseau (recherche par pseudo), avec du texte, un embed optionnel et des pièces jointes. Le message est signé « Équipe Brothers Life », ou par le nom de l'auteur si l'option est cochée.
- **Réponses** : ce que la personne répond au bot en MP arrive en direct dans le panel (WebSocket), dans une conversation par personne.
- **Suivi des conversations** :
  - non lues, assignation à un membre du staff, notes internes, fermeture et réouverture ;
  - modèles de réponses rapides.
- **Premier contact** : option pour qu'un membre qui écrit au bot le premier ouvre une conversation (façon modmail), avec un message d'accueil automatique et un salon de notification pour le staff.
- **Limites** : si les MP de la personne sont fermés, le panel l'indique clairement. Anti-abus : `/dm bloquer`, et liste noire dans le panel.
- **Journal** : chaque conversation est enregistrée ; catégorie de log `dm`.

Tables `dm_threads` et `dm_messages`. Permissions `dm.view`, `dm.send` et `dm.manage`. Il faut aussi l'intent `DirectMessages` avec le partial `Channel`.

## 22. Permissions et logs de tout le lot

- **Permissions** : chaque fonctionnalité déclare ses permissions `.view`, `.manage` et les permissions d'action. La liste complète apparaît dans l'éditeur de rangs, groupée par catégorie, avec des préréglages (« Modérateur », « Support », « Communication »).
- **Logs** : chaque fonctionnalité a sa catégorie de log (`tickets`, `antiraid`, `onboarding`, `polls`, `giveaways`, `feedback`, `recruitment`, `absences`, `voice`, `stream`, `dm`, `messages`, `templates`…), routable vers un salon, avec un résumé lisible dans le journal.

## 23. Refonte visuelle du panel

- **Palette** : couleurs sémantiques complètes (succès, avertissement, danger, info), en clair et en sombre, avec variantes de boutons `success`, `warning`, `danger` et `info` en plus de `default`, `outline` et `ghost`. Pastilles, badges et alertes assortis.
- **Mise en ordre** : navigation regroupée (Réseau, Modération, Communauté, Staff, Suivi, Système), en-têtes de pages homogènes, cartes de synthèse colorées sur chaque page (compteurs), et états vides illustrés.
- **Animations** : légères et utiles seulement, avec `prefers-reduced-motion` respecté :
  - apparition des pages et dialogues ;
  - transitions de liste (nouveau message de ticket, nouvelle entrée de console) ;
  - retour visuel sur les boutons (chargement, succès) ;
  - squelettes animés.

## 24. Audit final

Revue complète avant de pousser :
- **Sécurité** :
  - chaque route a sa permission ;
  - entrées validées côté serveur ;
  - pas de fuite d'ID ou de secret ;
  - CSRF, taille des uploads, SSRF (FiveM, images, flux RSS).
- **Robustesse** : erreurs Discord, limites de débit, redémarrage en plein travail, migrations sur une base existante.
- **Tests** : couverture de chaque service ; lint, typecheck et build.
- **Vérification visuelle** : chaque page avec Playwright en clair et en sombre.
- **Rapport** : ce qui a été vérifié, et ce qui reste à tester avec un vrai bot.

## Nitro boosts

Même système que la bienvenue (§1), pour les boosts :
- message et carte image quand un membre boost, avec les variables `{boosts}` et `{boost.tier}` ;
- message optionnel à la fin d'un boost ;
- rôles bonus donnés pendant le boost et retirés à la fin ;
- remerciement en MP optionnel.

## Ordre de réalisation

Un commit par étape, sans pousser :

1. tickets v2 (+ moteur de formulaires)
2. commandes de modération, rôles temporaires, restrictions
3. accueil, boosts et carte image
4. anti-raid
5. statistiques et compteurs
6. vocaux personnels
7. messages dynamiques et synchronisés, changelog
8. sondages
9. giveaways
10. suggestions, reports de bug, bugs internes du staff
11. recrutement, absences du staff
12. annonces poussées (images, récurrence, calendrier)
13. notifications de streams et vidéos
14. FiveM
15. messages privés via le bot
16. modèles de serveur, qui reprennent tout ce qui précède
17. refonte visuelle du panel et animations (§23)
18. audit final (§24)
