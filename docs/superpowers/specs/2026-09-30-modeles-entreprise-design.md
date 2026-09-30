# Modèles de serveur (entreprises) — conception

## But

Un ou plusieurs Discord « modèles » (ex. modèle Entreprise, modèle Gang) sont montés à la main. Depuis le panel, le bot en prend une photo, puis la recrée sur n'importe quel serveur du réseau, sauf le principal. Plus tard, le même serveur peut être réparé (remis d'aplomb sans rien perdre) ou réinitialisé (reconstruit à l'identique).

## Vocabulaire

- **Modèle** : une photo (snapshot JSON) d'un serveur source, avec un nom choisi dans le panel. Il peut y en avoir plusieurs. On peut reprendre la photo à tout moment (« Mettre à jour depuis le Discord modèle »).
- **Serveur cible** : un serveur actif du réseau, avec le bot présent, qui n'est ni le principal ni la source d'un modèle.
- **Application** : ce qui est retenu pour chaque cible : modèle appliqué, date, et table de correspondance entre les ID du modèle et les ID de la cible, pour les rôles et les salons.

## Contenu d'un modèle

Discord :
- **Rôles** : sauf @everyone (seulement ses permissions), les rôles gérés (bots, boost) et les rôles au-dessus du bot. On garde nom, couleur, séparé, mentionnable, permissions et ordre.
- **Catégories et salons** :
  - types texte, vocal, annonces, forum, scène ;
  - attributs copiés : nom, sujet, NSFW, mode lent, débit, limite d'utilisateurs, région, archivage auto, tags de forum, ordre et parent ;
  - permissions des rôles (surcharges). Les surcharges par membre sont ignorées.
- **Réglages du serveur** : niveau de vérification, notifications par défaut, filtre de contenu explicite, salon et délai AFK, salon système et ses options, salons règles et mises à jour (serveurs Communauté uniquement), langue.
  - Le nom et l'icône ne sont pas copiés : chaque entreprise garde les siens.

Panel, lu depuis la base au moment de la photo, pour le serveur source :
- **Tickets** : réglages du panneau et catégories. Les salons et rôles sont remappés ; les rangs du réseau sont gardés tels quels.
- **Automod** : la configuration, avec les salons et rôles exemptés remappés.
- **Salons de logs** : les routes par catégorie, remappées.
- **Rôles du staff** : les liens rang → rôle du serveur source deviennent rang → rôle correspondant sur la cible.

## Deux actions sur une cible

**Réinitialiser.** C'est aussi l'action de la première application.
1. Les rôles existants de même nom qu'un rôle du modèle sont modifiés sur place : les membres les gardent. Les autres rôles modifiables sont supprimés, et les rôles manquants sont créés.
2. Tous les salons sont recréés ; les messages sont perdus. Pour ne jamais laisser le serveur vide ni bloquer sur les salons obligatoires d'un serveur Communauté, l'ordre est :
   1. créer les nouveaux salons ;
   2. basculer les réglages (AFK, système, règles) sur les nouveaux salons ;
   3. supprimer les anciens.
3. La configuration du panel de la cible (tickets, automod, logs, rôles du staff) est remplacée par celle du modèle. Le panneau de tickets est republié si le modèle en avait un.

**Réparer.**
- Via la table de correspondance, sinon par nom :
  - ce qui manque est recréé ;
  - ce qui existe est remis comme dans le modèle (nom, permissions, surcharges, ordre, parent, réglages).
- Rien n'est supprimé : les salons et rôles en plus sont conservés, et les messages restent.
- La configuration du panel est complétée (remappée), sans rien écraser d'autre.

## Déroulement

- Le travail est une tâche de fond, une seule à la fois pour tout le bot (limites de débit Discord). Le panel suit l'avancement (étape, x/y, avertissements) en interrogeant l'API toutes les 2 s.
- Pendant la tâche, les actions du bot sur ce serveur ne sont pas envoyées dans les logs d'événements (sinon des centaines d'entrées). Un seul résumé est journalisé : audit `templates.apply`, catégorie de log `templates`.
- Un rôle ou un salon qui échoue (hiérarchie, fonctionnalité Communauté manquante, limite) n'arrête pas la tâche : il devient un avertissement dans le rapport. Un salon d'annonces ou de scène sur une cible non Communauté est créé en salon texte ou vocal.
- Refusé sur le serveur principal et sur un serveur source de modèle.

## Permissions du panel

- `templates.view` : voir les modèles et les applications.
- `templates.manage` : créer, reprendre la photo, renommer, supprimer un modèle.
- `templates.apply` : réparer ou réinitialiser une cible.
  - Il faut `confirm: true`.
  - Pour une réinitialisation, il faut aussi taper le nom du serveur cible.

## Code

- **`src/core/templates/snapshot.js`** : photo d'une guilde (données Discord fournies par l'exécuteur) et de sa configuration du panel.
- **`src/core/templates/plan.js`** : fonction pure qui prend le modèle, l'état de la cible, la correspondance et le mode (`reset` | `repair`), et produit une liste ordonnée d'opérations. Testée à part.
- **`src/core/templates/index.js`** :
  - service `createTemplates()` : CRUD, lancement de la tâche, exécution des opérations via l'exécuteur, remappage de la configuration du panel, suivi, garde-fous ;
  - exécuteur :
    - `snapshotGuild(guildId)` ;
    - `createRole` / `editRole` / `deleteRole` / `setRolePositions` ;
    - `createChannel` / `editChannel` / `deleteChannel` ;
    - `editGuildSettings`.
- **Migration 009** :
  - `server_templates` : id, name, source_guild_id, snapshot, captured_at, created_by, created_at ;
  - `template_applications` : guild_id PK, template_id, mapping, mode, status, report, applied_at, applied_by.
- **Routes `/api/templates`** :
  - liste, création `{name, sourceGuildId}`, `/:id/capture`, renommer, supprimer ;
  - `/targets` ;
  - `POST /api/templates/:id/apply {guildId, mode, confirm, confirmName}` ;
  - `GET /api/templates/job`.
- **Page panel « Modèles de serveur »** (section Réseau) :
  - cartes de modèles : source, date de la photo, nombre de rôles et salons ;
  - tableau des serveurs cibles : modèle appliqué, date, et boutons « Réparer » / « Réinitialiser » ;
  - dialogue d'application avec résumé et confirmation ;
  - barre d'avancement et rapport.

## Tickets : visibilité

Le sélecteur de serveur passe dans l'en-tête de la page, avec un libellé « Serveur » et l'icône du serveur. Il reste visible sur les deux onglets.
