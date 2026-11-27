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

Le prototype impose une seule adhésion propriétaire correspondant à `organization.ownerUid`, des identifiants uniques, des magasins rattachés à la bonne organisation et des affectations vendeurs vers des magasins existants. Un vendeur doit être affecté à au moins un magasin.

## Matrice provisoire des droits

- Patron propriétaire actif : lecture de tous les magasins de son organisation et droits de gestion prévus dans le prototype.
- Vendeur actif : lecture et opérations courantes uniquement dans ses magasins affectés, avec permissions par défaut limitées.
- Un vendeur ne peut pas annuler une vente validée par défaut, gérer les membres ou accéder à un autre magasin.
- Une liste `permissions` explicite sur un membre vendeur réduit les droits par défaut ; elle ne peut pas élargir les actions autorisées par le rôle.

Les droits métier exacts restent à valider avant intégration. En particulier, les règles de suppression, correction, retour, inventaire et clôture de caisse doivent être précisées par action.

## Vérification exécutée

Commande prévue : `node multi-store-model.test.js`

Résultat du prototype exécuté dans un environnement Node.js : **13 assertions réussies**, plus vérification syntaxique des deux fichiers.

Scénarios couverts : modèle valide, accès patron aux deux magasins, vendeur dans son magasin, stock partagé dans son magasin, refus d'un autre magasin, refus d'annulation vendeur, utilisateur inconnu, membre suspendu, magasin d'une autre organisation, ID magasin dupliqué, propriétaire absent et permissions vendeur restreintes.

## Limites impératives

- Ce prototype n'est pas branché à `index.html`, Firebase Auth, Firestore ou Cloudflare Worker.
- Il ne protège aucune donnée réelle à ce stade. Une décision JavaScript côté client n'est jamais une frontière de sécurité.
- Les règles Firestore devront appliquer et tester indépendamment les mêmes contraintes avec l'identité authentifiée, l'appartenance, le rôle et l'affectation magasin.
- Le prototype ne gère pas encore les invitations, transferts, transactions de stock, journal d'audit, mode hors ligne, conflits multi-écrivains ni migration.
- Aucune donnée existante n'a été migrée ou modifiée. Aucune règle Firebase n'a été publiée. Aucun déploiement ni merge n'a été effectué.

## Étape suivante

Faire une revue de la matrice des permissions, puis écrire les tests de règles Firestore et le protocole de migration. L'intégration aux opérations existantes ne doit commencer qu'après validation de ces contrôles.
