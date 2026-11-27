# COMPTIVA — Audit de séparation des données vendeur / patron

Date : 28 novembre 2026  
Branche : `comptiva/monthly-stability-audit`

## 1. Résultat de l'inspection du code actuel

L'inspection de `index.html` confirme que la fiche produit créée par l'application contient actuellement les champs suivants :

- `id`, `name`, `category`, `sku`, `quantity`, `purchasePrice`, `salePrice`, `alertAt`.

Le champ `purchasePrice` est le coût d'achat unitaire. Il ne doit pas être exposé au compte vendeur si le patron veut garder ses coûts, marges et bénéfices confidentiels.

La vente actuellement enregistrée contient notamment `product`, `quantity`, `unitPrice`, `total`, `date`, `saleType`, `clientId`, `method`, `paidAmount`, `creditAmount`, `cashPart`, `mobilePart` et éventuellement `stockProductId`. Le schéma actuel n'enregistre pas de coût d'achat ou de bénéfice dans cette vente. Il ne faut donc pas calculer ou afficher un bénéfice vendeur à partir d'une simple différence supposée.

Les achats et dépenses sont des tableaux distincts dans la base locale actuelle. Dans le prototype multi-magasins, leurs actions de lecture et d'écriture restent réservées au patron.

## 2. Risque critique confirmé

Firestore autorise ou refuse la lecture d'un document ; ses règles ne retirent pas certains champs d'un document que le vendeur a le droit de lire. Par conséquent, si un vendeur peut lire directement une fiche produit contenant `purchasePrice`, il peut aussi récupérer ce coût en interrogeant Firestore ou en inspectant les données réseau, même si l'interface masque ce champ.

Une simple condition JavaScript ou un champ masqué dans l'écran n'est pas une protection.

## 3. Correction apportée au prototype isolé

Le fichier `multi-store-model.js` expose maintenant deux contrôles complémentaires :

- `projectSellerProduct(product)` construit une projection positive par liste blanche : seuls l'identifiant, le nom, la catégorie, la référence, la quantité, le prix de vente et le seuil d'alerte peuvent être retournés.
- `validateSellerOperationalProduct(product)` refuse qu'un document destiné à être directement lisible par un vendeur contienne des champs sensibles de coût, d'achat, de marge, de bénéfice ou de valorisation. Le contrôle inspecte également les objets et tableaux imbriqués et reconnaît plusieurs variantes de noms de champs.

Les tests couvrent les fuites directes et imbriquées, y compris les variantes `purchasePrice`, `unit_cost`, `grossProfit`, `profit_margin`, `purchase_cost` et l'objet `financials`.

Ces fonctions sont des contrôles de modèle et de validation de schéma. Elles ne filtrent pas les documents déjà présents dans Firestore et ne remplacent pas les règles d'accès serveur.

## 4. Schéma de stockage à imposer avant ouverture des comptes vendeurs

Séparer physiquement les données opérationnelles et les données financières confidentielles :

- Document produit opérationnel, lisible par les vendeurs affectés : `id`, `organizationId`, `storeId`, `name`, `category`, `sku`, `quantity`, `salePrice`, `alertAt`, provenance et dates.
- Document financier produit, accessible uniquement au patron : `purchasePrice`, historique des coûts, coût moyen, valorisation du stock, marges et bénéfices calculés.
- Achats, dépenses, rapports financiers et journal des coûts : lecture réservée au patron.
- Ventes, dettes et remboursements : accès limité aux magasins affectés et aux actions du rôle ; aucune donnée de coût ou de bénéfice ne doit être copiée dans une projection vendeur.
- Les mouvements de stock doivent être conservés séparément des documents financiers, avec organisation, magasin, produit, quantité, auteur, date serveur et clé d'idempotence.

Les chemins exacts Firestore restent à valider avec les règles et les requêtes. Le principe non négociable est que le document vendeur ne contienne jamais les champs confidentiels.

## 5. Contrôles de droits du prototype

Le rôle vendeur est limité aux opérations quotidiennes du magasin affecté. Le rôle patron conserve les achats, dépenses, rapports, tableau de bord financier, gestion des magasins et des membres, ajustements de stock, annulations et audit.

Les permissions vendeurs personnalisées peuvent réduire les actions quotidiennes autorisées, jamais ajouter une action patron.

## 6. État de réalisation et limites

- [x] Inspection des champs produit et vente actuellement écrits par `index.html`.
- [x] Confirmation du risque lié à `purchasePrice` dans une fiche produit lisible.
- [x] Projection vendeur par liste blanche dans le prototype.
- [x] Validation récursive contre les champs sensibles dans le prototype.
- [x] Tests négatifs pour champs directs, imbriqués et variantes de noms.
- [ ] Séparation effective des documents opérationnels et financiers dans Firestore.
- [ ] Règles Firestore complètes limitant les lectures financières au patron.
- [ ] Adaptation des écrans et services de l'application à ces projections.
- [ ] Migration contrôlée des fiches produits existantes sans perte de coûts.
- [ ] Tests Firebase Emulator et tests de lecture réelle avec comptes patron/vendeur.

**Conclusion :** le prototype de validation est renforcé, mais le risque réel ne sera éliminé qu'après séparation des documents et application de règles Firestore testées. Ne pas activer les vendeurs sur les fiches produits actuelles contenant `purchasePrice` tant que cette séparation n'est pas faite.
