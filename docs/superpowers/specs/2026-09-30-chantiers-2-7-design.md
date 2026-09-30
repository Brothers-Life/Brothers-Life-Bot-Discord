# Chantiers 2 à 7 : conception

Date : 2026-09-30. Complète `2026-09-30-socle-design.md`. Les décisions marquées **(validé)** viennent du brainstorming avec l'utilisateur. Les autres sont des choix par défaut que j'ai pris seul, à relire.

Principes communs, repris du socle :
- La logique métier est dans `src/core/`. Le bot et le panel l'appellent.
- Chaque action est enregistrée dans le journal (`audit_log`), avec une catégorie de logs.
- Chaque fonctionnalité déclare ses permissions dans le registre et ses catégories de logs.
- Les actions sur plusieurs serveurs sont traitées serveur par serveur, avec un résultat pour chacun.

---

## Chantier 2 — Sanctions

### Règles
- Une sanction peut partir de n'importe quel serveur du réseau. **(validé)**
- Droits par action, via les permissions `sanctions.warn`, `sanctions.kick`, `sanctions.timeout`, `sanctions.ban`, et `sanctions.revoke` pour débannir, lever un timeout ou supprimer un warn. **(validé)**
- Consulter l'historique demande `sanctions.view`.
- **Protection du staff** : on ne peut pas sanctionner quelqu'un dont le niveau est supérieur ou égal au sien, ni `OWNER_ID`.
- **Portée** : `network` par défaut (tous les serveurs actifs), ou `local` (seulement le serveur d'origine).
- **Actions natives** (bannir, expulser ou mettre en timeout directement avec Discord) : détectées par le journal d'audit Discord. Si le rang de l'auteur l'autorise, l'action est propagée au réseau ; sinon elle reste locale et est enregistrée comme telle. Même règle pour les débans. **(validé)**
- Les actions faites par le bot lui-même sont ignorées par la détection, pour éviter les boucles.
- **Nouveau serveur dans le réseau** : les bans réseau actifs y sont appliqués, et ses bans locaux importés dans l'historique sans propagation. **(validé)**
- **Warns** : historique commun, sans palier automatique. **(validé)**
- **Bans temporaires** : durée optionnelle. Un planificateur vérifie toutes les 30 secondes et débannit à l'échéance, sur le réseau.
- **Timeout** : 28 jours au maximum (limite de Discord). Appliqué sur chaque serveur où la personne est membre.
- **Kick réseau** : expulse la personne de chaque serveur actif où elle est présente.
- **Message privé** envoyé à la personne sanctionnée (type, raison, durée). Un échec, par exemple des MP fermés, est ignoré.

### Données
`sanctions` : `id`, `type` (ban|kick|timeout|warn), `user_id`, `user_name`, `moderator_id`, `source` (bot|panel|native|automod), `origin_guild_id`, `scope`, `reason`, `created_at`, `expires_at`, `revoked_at`, `revoked_by`, `revoke_reason`, `results` (JSON : résultat par serveur).

### Interfaces
- Commandes slash : `/ban`, `/unban`, `/kick`, `/timeout`, `/untimeout`, `/warn`, `/historique`. L'option `local` donne une sanction limitée au serveur.
- Page panel « Sanctions » : liste filtrable, formulaire de sanction, révocation, fiche d'un utilisateur.
- Catégorie de logs `sanctions`.

---

## Chantier 3 — Logs complets

### Événements journalisés, par catégorie
| Catégorie | Événements |
|---|---|
| `messages` | Message modifié (avant et après), supprimé (contenu si en cache, pièces jointes), suppression en masse |
| `members` | Arrivée (âge du compte, invitation utilisée), départ (rôles qu'il avait), pseudo changé |
| `member_roles` | Rôles ajoutés ou retirés à un membre, avec l'auteur |
| `roles` | Rôle créé, supprimé ou modifié, avec l'auteur |
| `channels` | Salon créé, supprimé ou modifié, avec l'auteur |
| `voice` | Arrivée, départ ou changement de salon vocal |
| `invites` | Invitation créée ou supprimée |
| `server` | Serveur modifié, émojis |

- L'auteur des changements de rôles, de salons et de membres vient du journal d'audit Discord (`GuildAuditLogEntryCreate`), ce qui évite un appel API par événement.
- Le suivi des invitations garde en cache les invitations de chaque serveur et compare leurs compteurs à chaque arrivée.
- **Stockage** : table `events` (serveur, catégorie, type, utilisateur, salon, résumé, détails JSON, date), consultable dans le panel.
- **Rétention** configurable, 30 jours par défaut, avec une purge quotidienne.
- Les messages ne sont **pas** tous stockés : le contenu d'un message supprimé vient du cache de discord.js (les messages récents). Un message ancien et hors cache s'affiche « contenu inconnu ».
- Page panel « Événements » : recherche plein texte, filtres (serveur, catégorie, utilisateur, période). Permission `events.view`.
- Seuls les serveurs actifs du réseau sont journalisés.

---

## Chantier 4 — Automod

Configuration par serveur. Le réglage « réseau » sert de valeur par défaut, et chaque serveur peut le surcharger.

| Filtre | Réglages par défaut |
|---|---|
| **Anti-spam** | 6 messages en 5 s ; 4 messages identiques en 30 s ; 6 mentions par message |
| **Anti-envoi massif** | 4 fichiers par message ; 8 fichiers en 30 s |
| **Anti-arnaque** | Liens vers des domaines connus d'arnaque (liste intégrée et liste personnalisée) ; motifs « nitro gratuit », « steam gift », « airdrop », « claim your reward », faux Discord (sosies du type `disc0rd`) ; `@everyone` avec un lien |
| **Invitations Discord** | Désactivé par défaut |

- **Actions**, au choix par filtre : supprimer le message, avertir (warn), timeout (durée), expulser, bannir, bannir du réseau. Elles passent par le service de sanctions du chantier 2, avec la source `automod`.
- **Arnaque** : par défaut, suppression et ban réseau, car les comptes piratés propagent les arnaques sur tous les serveurs.
- **Exemptions** : salons, rôles, et toute personne ayant `automod.bypass` (le staff).
- Une personne ne peut être sanctionnée qu'une fois toutes les 10 secondes par l'automod, pour éviter une rafale de sanctions.
- Le moteur est une fonction pure (règles, message, historique récent → verdict), testable sans Discord.
- Page panel « Automod ». Permissions `automod.view` et `automod.manage`. Catégorie de logs `automod`.

---

## Chantier 5 — Rôles et membres

- **Synchronisation du staff** : un rang peut être lié à un rôle **sur chaque serveur** du réseau. Quand quelqu'un a un rang (par les rôles du serveur principal), le bot lui donne le rôle lié sur chaque autre serveur où il est membre, et le retire quand il perd le rang. Cela s'applique à son arrivée sur un serveur, quand ses rôles changent sur le serveur principal, et lors d'une resynchronisation complète déclenchée depuis le panel.
- Seuls les rôles liés à un rang sont touchés. Les autres rôles ne sont jamais modifiés.
- **Page « Membres »** : recherche d'une personne sur tout le réseau (serveurs où elle est, rôles par serveur, rangs, sanctions). Actions possibles :
  - ajouter ou retirer un rôle sur un serveur (`members.manage`, uniquement des rôles sous le rôle du bot) ;
  - changer le pseudo ;
  - raccourcis de sanction.
- **Page « Rôles »** : rôles de chaque serveur, et liaison rôle ↔ rang par serveur (`ranks.manage`).
- Catégorie de logs `staff_sync`.

---

## Chantier 6 — Tickets

- **Configuration par serveur** :
  - catégories de tickets (nom, émoji, description, catégorie Discord où créer les salons, rangs ou rôles du staff qui les voient) ;
  - salon et message du panneau d'ouverture ;
  - nombre maximal de tickets ouverts par personne (1 par défaut).
- **Ouverture** : un bouton par catégorie, puis un formulaire (sujet). Le bot crée un salon privé `ticket-0042-pseudo` visible par la personne et le staff concerné.
- **Dans le ticket** : boutons « Prendre en charge », « Fermer » (avec une raison) et « Ajouter un membre ».
- **Fermeture** : le transcript texte est enregistré en base, envoyé en fichier dans le salon de logs `tickets` et en MP à la personne ; le salon est supprimé 10 secondes après.
- **Page panel « Tickets »** : liste filtrable, lecture des transcripts, fermeture à distance, configuration.
- Permissions `tickets.view`, `tickets.manage` (configuration) et `tickets.handle` (traiter les tickets depuis Discord et le panel).

---

## Chantier 7 — Permissions

- Pour chaque rôle lié à un rang (chantier 5), on définit un **profil de permissions Discord** (les cases de permissions d'un rôle).
- **Aperçu** : pour chaque serveur, la différence entre les permissions actuelles du rôle et le profil.
- **Application** : le bot applique le profil sur chaque serveur, avec un résultat par serveur. Échec si le rôle est au-dessus de celui du bot, ou si le bot n'a pas lui-même la permission à donner.
- **Détection des écarts** : une vérification toutes les 6 heures signale les différences dans la catégorie de logs `permissions`, sans corriger automatiquement.
- Les permissions des salons ne sont pas touchées : chaque serveur a ses propres salons.
- Permissions `permsync.view` et `permsync.manage`. La permission `Administrator` ne peut être donnée que par `OWNER_ID`.

---

## Décisions ajoutées pendant l'implémentation

- **Sécurité** : les rôles Discord qui donnent des permissions de modération ou d'administration ne peuvent être liés à un rang (chantier 5), ni donnés à la main depuis le panel, que par `OWNER_ID`. Même règle pour les permissions correspondantes dans les profils du chantier 7. Sans cette règle, quelqu'un qui gère les rangs et possède aussi un rang inférieur pourrait se donner ces droits par la synchronisation.
- **Commandes slash** : enregistrées automatiquement au démarrage quand elles changent. En prod, elles sont globales ; en dev, elles vont sur `DEV_GUILD_ID`.
- **Détection des sosies (automod)** : une distance d'édition entre le domaine et les noms de marque (discord, steamcommunity, steampowered), en ignorant les domaines qui contiennent le nom exact (discordjs.guide, steamcommunity-fans.net…).
- **Actions de l'automod** : enregistrées dans le journal avec l'auteur `automod` et la source `system`.
