# COMPTIVA — Architecture cible patrons, vendeurs et multi-magasins

Statut : spécification de conception issue de l'audit du 27 novembre 2026. **Ce document ne signifie pas que la fonctionnalité est déjà implémentée.**

## 1. Constat sur la branche audit

La version auditée utilise actuellement :
- une base locale `db` par UID Firebase (`comptiva_user_v1_<uid>`) ;
- un seul document cloud par UID : `users/{uid}/comptivaData/main` ;
- les tables clients, ventes, dettes, remboursements, achats, dépenses et produits dans ce document ;
- aucune structure métier explicite d'organisation, de magasin, de membre, d'affectation vendeur ou de rôle patron/vendeur.

Les recherches dans `index.html` n'ont pas trouvé de modèle `organizationId`, `storeId`, `ownerUid`, `members` ou d'équivalent fonctionnel. La séparation actuelle est donc principalement par compte Firebase, pas par entreprise et magasin partagés. Ajouter simplement un bouton « magasin » ou un champ de rôle côté interface ne serait pas une sécurité suffisante.

## 2. Modèle métier cible

- Une organisation commerciale appartient à un patron (propriétaire).
- Une organisation possède un ou plusieurs magasins.
- Un magasin possède son propre stock et ses propres opérations.
- Le patron peut consulter tous les magasins de son organisation, les vues globales et les vues par magasin et vendeur.
- Un vendeur est membre de l'organisation et est affecté à un ou plusieurs magasins autorisés. Par défaut, il ne voit et n'utilise que les magasins qui lui sont affectés.
- Dans un magasin, patron et vendeurs autorisés travaillent sur le même stock.
- Les stocks de deux magasins restent distincts. Un transfert est une opération tracée qui diminue le stock source et augmente le stock destination.
- Les données d'organisations différentes ne sont jamais accessibles entre elles.

## 3. Modèle de données logique

Collections proposées (noms indicatifs à valider avec les règles Firestore et les limites de requêtes) :

- `organizations/{organizationId}` : propriétaire, nom commercial, état, dates.
- `organizations/{organizationId}/members/{uid}` : rôle, état d'invitation/adhésion, magasins autorisés, permissions.
- `organizations/{organizationId}/stores/{storeId}` : nom, adresse, état, dates.
- `organizations/{organizationId}/stores/{storeId}/products/{productId}` : fiche produit et stock propre à ce magasin.
- `organizations/{organizationId}/stores/{storeId}/sales/{saleId}` : vente, vendeur, date, client et détails.
- Collections équivalentes par magasin pour clients, dettes, remboursements, achats, dépenses et mouvements de stock, selon le schéma final.
- `organizations/{organizationId}/auditLogs/{eventId}` : journal d'audit non modifiable par un vendeur, avec acteur, action, magasin, objet, date et données de traçabilité minimales.

Chaque opération doit contenir au minimum `organizationId`, `storeId`, `createdBy`, `createdAt` et, lorsqu'elle est modifiée, `updatedBy` / `updatedAt`. Les annulations et corrections financières doivent créer une trace explicite plutôt que faire disparaître silencieusement l'opération initiale.

## 4. Autorisations

Les contrôles doivent être appliqués côté serveur / règles Firestore, pas uniquement en masquant les boutons :
- patron propriétaire : lecture de tous les magasins et opérations de son organisation ; gestion des magasins, membres et affectations ;
- vendeur : accès seulement aux magasins affectés et aux actions explicitement autorisées ;
- vendeur : aucune possibilité de consulter les autres organisations ou magasins non affectés ;
- opérations sensibles (suppression, annulation, modification d'une vente validée, changement de stock) : permissions distinctes et journalisation ;
- validation de l'identité et de l'appartenance à l'organisation sur chaque lecture/écriture.

Le modèle final des règles doit être testé avec des comptes de test patron, vendeur autorisé, vendeur non autorisé et utilisateur d'une autre organisation. Les règles actuellement publiées dans Firebase ne sont pas visibles dans ce dépôt ; leur état réel ne peut donc pas être certifié depuis cet audit.

## 4 bis. Séparation des données confidentielles du patron

Les fiches produits actuelles contiennent `purchasePrice` dans le même objet que le nom, la quantité et le prix de vente. Les règles Firestore ne savent pas masquer ce champ à un vendeur qui peut lire le document. La cible doit donc séparer le document opérationnel du produit et son document financier réservé au patron. Les achats, dépenses, coûts d'achat, marges, bénéfices et valorisations restent dans des documents accessibles uniquement au patron. Les projections vendeur doivent être construites par liste blanche, et les écritures vers les documents opérationnels doivent refuser tout champ financier, y compris dans les objets imbriqués. Voir `STORE_DATA_ACCESS_AUDIT.md`.

## 5. Migration sans perte

1. Sauvegarder et vérifier les données existantes de chaque compte.
2. Créer une organisation initiale pour chaque compte commerçant existant et un magasin principal.
3. Migrer ses données actuelles vers ce magasin en conservant les IDs et références historiques.
4. Vérifier les totaux, les liens ventes/dettes/remboursements/clients/produits et le nombre d'enregistrements avant/après.
5. Garder une stratégie de retour arrière et ne supprimer l'ancien chemin de données qu'après validation.
6. Ne jamais fusionner automatiquement les données de deux comptes parce qu'ils partagent un nom, une adresse ou une boutique.

## 6. Synchronisation et cohérence

La synchronisation actuelle écrit un document complet `users/{uid}/comptivaData/main`. Ce modèle ne doit pas être réutilisé tel quel pour plusieurs vendeurs qui écrivent simultanément dans le même magasin : deux appareils pourraient écraser les opérations de l'autre.

La cible doit privilégier des documents/opérations indépendants par magasin, des IDs uniques, des écritures transactionnelles lorsque plusieurs stocks ou soldes sont concernés, une gestion de conflits explicite et une reprise hors ligne qui ne remplace jamais silencieusement une opération plus récente. Les transferts inter-magasins doivent être atomiques ou suivre un protocole d'état (en préparation, expédié, reçu, annulé) empêchant les doubles mouvements.

## 7. Ordre de réalisation

1. Finaliser le schéma, les rôles et les permissions.
2. Ajouter le modèle d'organisation, magasins et membres, sans toucher aux données existantes.
3. Construire la migration contrôlée du compte existant vers son magasin principal.
4. Construire l'interface patron : liste des magasins, vue consolidée et détail par magasin/vendeur.
5. Construire l'invitation et l'affectation des vendeurs avec validation d'accès.
6. Faire partager le stock au sein d'un magasin et isoler les stocks entre magasins.
7. Ajouter transferts, journal d'audit et historique des actions.
8. Tester les accès interdits, écritures simultanées, synchronisation multi-appareils, restauration et non-régression.

## 8. Critères d'acceptation obligatoires

- Le patron voit toutes les opérations de ses magasins et peut filtrer par magasin et vendeur.
- Un vendeur voit uniquement les magasins qui lui sont affectés.
- Deux vendeurs du même magasin voient le même stock après synchronisation.
- Une vente du magasin A ne diminue jamais le stock du magasin B.
- Un transfert A vers B est visible dans l'historique des deux magasins et n'est compté qu'une fois.
- Un utilisateur d'une autre organisation ne peut lire ni modifier aucune donnée.
- Chaque opération est attribuable à un utilisateur et un magasin.
- Une panne réseau ou une écriture concurrente ne fait pas disparaître silencieusement des ventes, dettes ou remboursements.
- La migration conserve les données et références existantes.

## 9. Hors périmètre de ce document

Aucune règle Firebase n'a été publiée ou modifiée, aucune donnée Firestore n'a été migrée, aucun déploiement n'a été effectué et aucun accès vendeur n'a été activé. La présente spécification est un préalable de conception, pas une preuve de fonctionnement.
