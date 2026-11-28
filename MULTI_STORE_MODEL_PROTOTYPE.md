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

Résultat du prototype exécuté dans un environnement JavaScript isolé avec assertions simulées compatibles Node.js : **185 assertions réussies à cette étape historique**, plus vérification syntaxique des deux fichiers. Les contrôles supplémentaires vérifient qu'une mise à jour ne peut pas réécrire l'ID, l'organisation, le magasin, l'auteur ou la date de création, qu'un vendeur ne peut pas modifier une vente validée, qu'une création ne peut pas prétendre avoir déjà été modifiée, que le validateur de mise à jour refuse une action de création et que les vendeurs n'accèdent pas aux rapports financiers, achats ou dépenses réservés au patron.

Scénarios couverts : modèle valide, accès patron aux deux magasins, vendeur dans son magasin, stock partagé dans son magasin, refus d'un autre magasin, refus d'annulation vendeur, utilisateur inconnu, membre suspendu, magasin d'une autre organisation, ID magasin dupliqué, propriétaire absent et permissions vendeur restreintes, auteur falsifié, organisation incorrecte, horodatage invalide, métadonnées de modification incomplètes, opération hors magasin affecté, organisation suspendue, action inconnue, élévation de rôle par permissions vendeur et gestion de membres interdite au vendeur, et validité des invitations vendeur (identité du patron, email normalisé, organisation, magasins, permissions et expiration), ainsi que la projection des fiches produits sans données de coût.

## Limites impératives

- Ce prototype n'est pas branché à `index.html`, Firebase Auth, Firestore ou Cloudflare Worker.
- Il ne protège aucune donnée réelle à ce stade. Une décision JavaScript côté client n'est jamais une frontière de sécurité.
- Les règles Firestore devront appliquer et tester indépendamment les mêmes contraintes avec l'identité authentifiée, l'appartenance, le rôle et l'affectation magasin.
- Les invitations disposent d'une validation de brouillon uniquement : l'envoi, le jeton à usage unique, l'acceptation Firebase et la révocation serveur restent à construire. Les validateurs de suspension, réactivation et affectation magasin sont également des contrats de prévalidation uniquement ; leur effet immédiat dépend d'une lecture serveur de l'adhésion courante à chaque opération protégée, et d'une transaction qui enregistre la modification et l'événement d'audit. Le prototype contient désormais des prévalidations de transferts et de réception, mais les transactions de stock, le journal d'audit immuable côté serveur, le mode hors ligne, la résolution des conflits multi-écrivains et la migration restent à construire.
- `projectSellerProduct` n'est qu'une projection JavaScript. Les règles Firestore ne masquent pas des champs d'un document autorisé : les données de coût doivent être séparées dans des documents/collections protégés, ou fournies via une projection serveur dédiée. Tant que ce découpage n'existe pas, donner au vendeur une lecture directe des documents produits contenant `purchasePrice` serait dangereux. Les champs d'auteur/date restent un contrat à imposer par un serveur de confiance : un navigateur ne peut pas garantir seul leur authenticité.
- Aucune donnée existante n'a été migrée ou modifiée. Aucune règle Firebase n'a été publiée. Aucun déploiement ni merge n'a été effectué.

## Étape suivante

Écrire les tests de règles Firestore exécutables dans l'émulateur, définir le contrôle serveur de l'adhésion courante et le protocole de migration. L'intégration aux opérations existantes ne doit commencer qu'après validation de ces contrôles.


## Complément — réception partielle des achats

Le prototype expose désormais `validatePurchaseStockReceipt` pour prévalider les réceptions successives d'un achat lié à un `productId` stable. Le cumul reçu ne peut pas dépasser la quantité commandée ; les IDs et clés d'idempotence sont contrôlés, et le helper calcule le reliquat et le stock théorique après réception. Ce contrôle reste une prévalidation pure : une transaction serveur doit relire les documents, ajouter le mouvement et incrémenter le stock atomiquement. Les achats non liés à un identifiant produit stable ne peuvent pas recevoir du stock par ce chemin.


## Retours clients

Le prototype expose `validateSaleReturn` et réserve `sales:return` au patron. Les retours cumulés sont bornés par les quantités et montants de la vente d'origine. Le remboursement d'une vente payée est limité au montant encaissé ; un retour sur vente à crédit sans remboursement antérieur réduit le crédit dû. Les quantités revendables et endommagées sont distinguées afin de ne remettre en stock que les unités revendables. Les ventes déjà remboursées via des règlements de dette sont bloquées jusqu'à un workflow spécifique. Toute écriture réelle doit être atomique côté serveur.


## Extension — confirmation vendeur, réception partielle et rappels

Le patron conserve la lecture et le contrôle de tous les magasins de son organisation, y compris les stocks, ventes, dettes, commandes/transferts, acceptations, refus, retards et historiques. Le vendeur ne reçoit que les droits opérationnels de son magasin affecté et ne voit pas les coûts d'achat ni le bénéfice réel.

Les droits vendeur `transfers:read` et `transfers:receive` permettent au vendeur affecté au magasin destinataire de consulter le transfert qui le concerne et de confirmer la livraison. Le patron peut lire les transferts de tous ses magasins. Le droit `transfers:receive` permet au vendeur affecté au magasin destinataire de confirmer une livraison. Il ne lui donne pas le droit de créer ou modifier le transfert initial. Chaque événement de réception distingue les quantités acceptées, refusées et endommagées ; seules les unités acceptées augmentent le stock du magasin destinataire. Les événements partiels s'additionnent jusqu'à la quantité expédiée. Les unités refusées ou endommagées ne sont pas ajoutées au stock et nécessitent une traçabilité dédiée pour tout retour physique.

`validateStockTransferReceiptEvent` est une prévalidation pure. Le backend doit, dans une transaction atomique, relire l'adhésion courante, le transfert, l'historique des réceptions et le stock ; empêcher les doublons ; ajouter l'événement ; créditer uniquement les unités acceptées ; actualiser le statut et enregistrer l'audit. Le patron doit pouvoir consulter l'ensemble des événements et motifs.

`buildStockTransferReminderSuggestion` prépare un message lorsque la date attendue (`expectedAt`) plus le délai de grâce est dépassée. Il ne l'envoie pas : un traitement planifié de confiance devra relire le transfert et l'adhésion, éviter les rappels en double et envoyer la notification au vendeur destinataire. L'envoi automatique réel n'est pas encore intégré ni testé.


**Dernière vérification locale du prototype (28 novembre 2026) :** 269 assertions réussies dans le harnais JavaScript isolé. Ce résultat porte uniquement sur les fonctions pures du prototype, pas sur l'application COMPTIVA connectée à Firebase.


## Extension — alertes de stock et présence des vendeurs

`classifyStoreStockAlert` renvoie un état rouge si le stock est nul ou inférieur/égal au seuil d'alerte du produit dans ce magasin, vert s'il est supérieur au seuil, et inconnu si les données sont invalides. Le patron doit consulter les alertes agrégées de tous ses magasins ; le vendeur ne consulte que les alertes du ou des magasins qui lui sont affectés. Le seuil doit être paramétrable par le patron et par produit/magasin. Cette fonction classe l'état mais n'envoie pas de notification.

`projectOwnerSellerPresence` prépare la vue patron de présence des vendeurs : connecté si un heartbeat serveur récent confirme une session active ; déconnecté uniquement après une déconnexion explicite ; sinon « connexion non confirmée » ou « présence inconnue ». Cela évite de confondre une perte de réseau, une fermeture brutale de l'application ou un téléphone éteint avec une déconnexion volontaire. Le serveur doit maintenir les heartbeats et l'heure de dernière activité, sécuriser les écritures et gérer les sessions multi-appareils. Ces fonctions restent des prévalidations/projections pures, non intégrées à l'application.
