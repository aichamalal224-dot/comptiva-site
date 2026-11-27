# COMPTIVA — Prototype isolé du modèle multi-magasins

Date : 27 novembre 2026  
Branche : `comptiva/monthly-stability-audit`

## Fichiers

- `multi-store-model.js` : fonctions pures de validation du modèle d'organisation et de décision d'accès à un magasin.
- `multi-store-model.test.js` : tests Node.js sans dépendance externe.

## Structure attendue

- Organisation : `id`, `ownerUid`, `status`.
- Magasin : `id`, `organizationId`, `status`.
- Membre : `uid`, `organizationId`, `role` (`owner` ou `seller`), `status`, `storeIds`, et permissions facultatives.

Le prototype impose une seule adhésion propriétaire correspondant à `organization.ownerUid`, des identifiants uniques, des magasins rattachés à la bonne organisation et des affectations vendeurs vers des magasins existants. Un vendeur doit être affecté à au moins un magasin. Il ajoute `validateOperationRecord` : chaque opération métier doit porter un ID, l'organisation, le magasin, l'auteur initial et une date de création valide. Une modification doit aussi porter ensemble `updatedBy` et `updatedAt`, et l'auteur de l'action doit correspondre à l'acteur authentifié fourni au contrôle.

## Matrice provisoire des droits

- Patron propriétaire actif : lecture de tous les magasins de son organisation et droits de gestion prévus dans le prototype.
- Vendeur actif : opérations quotidiennes dans ses magasins affectés (clients, produits/stock en lecture, ventes, dettes et remboursements), selon les permissions attribuées.
- Par défaut, le vendeur ne voit pas le tableau de bord financier, les rapports, les achats, les dépenses ni les indicateurs de bénéfice. Ces accès restent au patron.
- Un vendeur ne peut pas annuler une vente validée par défaut, gérer les membres ou accéder à un autre magasin.
- Les permissions personnalisées d'un vendeur ne peuvent que retirer des droits du socle vendeur ; elles ne peuvent jamais lui accorder une capacité réservée au patron.
- Une liste `permissions` explicite sur un membre vendeur réduit les droits par défaut ; elle ne peut pas élargir les actions autorisées par le rôle.

Les droits métier exacts restent à valider avant intégration. En particulier, les règles de suppression, correction, retour, inventaire et clôture de caisse doivent être précisées par action.

## Vérification exécutée

Commande prévue : `node multi-store-model.test.js`

Résultat du prototype exécuté dans un environnement JavaScript isolé avec assertions simulées compatibles Node.js : **185 assertions réussies**, plus vérification syntaxique des deux fichiers. Les contrôles supplémentaires vérifient qu'une mise à jour ne peut pas réécrire l'ID, l'organisation, le magasin, l'auteur ou la date de création, qu'un vendeur ne peut pas modifier une vente validée, qu'une création ne peut pas prétendre avoir déjà été modifiée, que le validateur de mise à jour refuse une action de création et que les vendeurs n'accèdent pas aux rapports financiers, achats ou dépenses réservés au patron.

Scénarios couverts : modèle valide, accès patron aux deux magasins, vendeur dans son magasin, stock partagé dans son magasin, refus d'un autre magasin, refus d'annulation vendeur, utilisateur inconnu, membre suspendu, magasin d'une autre organisation, ID magasin dupliqué, propriétaire absent et permissions vendeur restreintes, auteur falsifié, organisation incorrecte, horodatage invalide, métadonnées de modification incomplètes, opération hors magasin affecté, organisation suspendue, action inconnue, élévation de rôle par permissions vendeur et gestion de membres interdite au vendeur, et validité des invitations vendeur (identité du patron, email normalisé, organisation, magasins, permissions et expiration), ainsi que la projection des fiches produits sans données de coût.

## Limites impératives

- Ce prototype n'est pas branché à `index.html`, Firebase Auth, Firestore ou Cloudflare Worker.
- Il ne protège aucune donnée réelle à ce stade. Une décision JavaScript côté client n'est jamais une frontière de sécurité.
- Les règles Firestore devront appliquer et tester indépendamment les mêmes contraintes avec l'identité authentifiée, l'appartenance, le rôle et l'affectation magasin.
- Les invitations disposent d'une validation de brouillon uniquement : l'envoi, le jeton à usage unique, l'acceptation Firebase et la révocation serveur restent à construire. Les validateurs de suspension, réactivation et affectation magasin sont également des contrats de prévalidation uniquement ; leur effet immédiat dépend d'une lecture serveur de l'adhésion courante à chaque opération protégée, et d'une transaction qui enregistre la modification et l'événement d'audit. Le prototype ne gère pas encore les transferts, transactions de stock, journal d'audit immuable côté serveur, mode hors ligne, conflits multi-écrivains ni migration.
- `projectSellerProduct` n'est qu'une projection JavaScript. Les règles Firestore ne masquent pas des champs d'un document autorisé : les données de coût doivent être séparées dans des documents/collections protégés, ou fournies via une projection serveur dédiée. Tant que ce découpage n'existe pas, donner au vendeur une lecture directe des documents produits contenant `purchasePrice` serait dangereux. Les champs d'auteur/date restent un contrat à imposer par un serveur de confiance : un navigateur ne peut pas garantir seul leur authenticité.
- Aucune donnée existante n'a été migrée ou modifiée. Aucune règle Firebase n'a été publiée. Aucun déploiement ni merge n'a été effectué.

## Étape suivante

Écrire les tests de règles Firestore exécutables dans l'émulateur, définir le contrôle serveur de l'adhésion courante et le protocole de migration. L'intégration aux opérations existantes ne doit commencer qu'après validation de ces contrôles.
