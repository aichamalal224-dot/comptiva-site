# COMPTIVA — Audit des achats, dépenses et annulations

Date : 28 novembre 2026  
Branche : `comptiva/monthly-stability-audit`

## Vérifications du code principal

Lecture de `index.html` sur la branche :

- **Achats :** le formulaire valide un montant positif et une quantité entière strictement positive. Le produit est rapproché par nom normalisé, et non par identifiant stable. Si plusieurs produits ont le même nom, l'achat est annulé ; si aucun produit n'est trouvé, l'achat est enregistré sans mouvement de stock. La provenance organisation/magasin/auteur n'est pas ajoutée.
- **Dépenses :** le formulaire valide la description et un montant positif, puis enregistre la dépense localement. Il ne lui ajoute pas de provenance normalisée ni d'écriture immuable de caisse.
- **Annulation de vente :** aucune fonction `cancelSale` ou `deleteSale` n'a été trouvée dans la zone de code inspectée ; la table des ventes affiche l'impression du reçu, sans action d'annulation. Il n'y a donc pas encore de flux complet d'annulation et de contre-écriture.

Ces constats ne prouvent pas l'absence absolue de tout autre mécanisme dans chaque partie de l'application, mais les opérations examinées ne démontrent pas une gestion multi-magasins auditable.

## Contrôles ajoutés au prototype isolé

- `validatePurchaseRecord` : achats réservés au patron, montant entier GNF positif, quantité non négative, référence produit stable facultative et provenance obligatoire.
- `validateExpenseRecord` : dépenses réservées au patron, description/catégorie/moyen de paiement, montant entier GNF positif et provenance obligatoire.
- `validateSaleCancellation` : annulation patron uniquement, vente persistée avec quantité entière et règlement financier cohérent, motif et clé d'idempotence obligatoires, refus des annulations répétées. Si des remboursements sont déjà associés à la vente, le helper bloque l'annulation simple et exige un parcours explicite de remboursement.

Pour une annulation, le résultat indique les montants/quantités à contre-passer. Il ne réalise pas ces écritures. Le backend devra effectuer en une transaction la modification du statut, la restauration éventuelle du stock, l'annulation de dette et les écritures de caisse. Les mouvements d'origine ne doivent jamais être supprimés ou réécrits.

## Tests

Le harnais JavaScript isolé a exécuté **240 assertions** avec succès. Les tests ajoutés couvrent notamment les permissions patron/vendeur, les montants invalides, les références produit, les dépenses, les motifs d'annulation, les rejouements et les ventes avec remboursements préexistants.

Ce sont des tests de fonctions pures. Aucun test Firebase Emulator, navigateur, transaction concurrente ou multi-appareils n'a été exécuté.

## Conditions avant activation

1. Associer les achats à un `productId` stable, pas au seul nom du produit.
2. Enregistrer chaque achat, entrée de stock, dépense, vente et remboursement comme opérations séparées avec auteur, organisation, magasin et horodatage serveur.
3. Calculer la caisse depuis un journal de mouvements immuable ou un agrégat transactionnel, et non par modification silencieuse d'un total.
4. Mettre les achats, la réception de stock et le mouvement de stock dans une transaction cohérente.
5. Pour annuler une vente, créer une contre-écriture ; ne jamais supprimer la vente originale. Si un paiement ou remboursement existe déjà, imposer un workflow financier distinct.
6. Écrire et exécuter les règles Firestore et les tests Emulator qui interdisent les accès vendeur aux achats, dépenses, coûts d'achat et marges.

**État :** améliorations du contrat de validation uniquement. Le modèle reste non intégré à `index.html`, les règles Firestore réelles n'ont pas été modifiées et rien n'a été publié ou fusionné dans `main`.


## Complément — intégrité des quantités d'achat et annulations (28 novembre 2026)

Le validateur d'achat refuse désormais les quantités nulles, négatives ou fractionnaires : une réception d'articles doit porter une quantité entière strictement positive. Le validateur d'annulation exige aussi une quantité entière sur la vente d'origine et vérifie la cohérence du règlement avant d'autoriser une contre-écriture. Une vente payée dont les montants encaissés/crédités ne correspondent plus au total est bloquée plutôt que de produire une annulation financière erronée.

Cinq scénarios supplémentaires vérifient les quantités d'achat nulles/fractionnaires, les quantités de vente fractionnaires et deux incohérences de règlement. Le harnais isolé passe avec **240 assertions**. Il ne réalise toujours aucune écriture de stock ou de caisse : ces contre-écritures doivent être atomiques côté serveur.


## Complément — réception partielle des achats (28 novembre 2026)

Ajout de `validatePurchaseStockReceipt` au prototype isolé. Le contrôle lie chaque réception à un achat stocké, à un produit par identifiant stable, à une organisation et à un magasin. Il cumule les réceptions antérieures, refuse les quantités fractionnaires, les doublons (ID/clé d'idempotence), les dépassements de la quantité commandée, les stocks incohérents et les réceptions par un vendeur. Il calcule la quantité reçue, le reliquat et le stock résultant sans effectuer lui-même d'écriture. Dix assertions couvrent une livraison en deux fois (12 puis 8 unités sur 20) et les refus associés. Le harnais isolé passe avec **240 assertions**.

Limite : les achats historiques sans `productId` stable ne peuvent pas utiliser ce parcours de réception de stock. En production, la lecture de l'achat, de l'historique des réceptions et du stock, l'ajout de la réception, l'incrément de stock et la mise à jour du cumul devront être atomiques dans une transaction serveur. Aucune intégration ni écriture réelle n'a été effectuée.

Le contrôle des réceptions vérifie aussi la cohérence minimale des dates et auteurs des réceptions antérieures et bloque un dépassement de la plage entière sûre lors de l'incrément du stock. Deux tests supplémentaires couvrent ces cas.


## Complément — retours clients et remise en stock (28 novembre 2026)

Ajout de `validateSaleReturn` et de l'action patron `sales:return`. Le helper vérifie le rattachement à la vente, au produit, au magasin et à l'organisation ; cumule les quantités et valeurs déjà retournées ; borne le remboursement au montant effectivement payé et la réduction de crédit au montant dû ; distingue les unités revendables des unités endommagées ; refuse les doublons, les ventes annulées, les remboursements hors allocation et les retours sur ventes ayant déjà des remboursements de dette. Les ventes à crédit sans remboursement antérieur réduisent le crédit dû au lieu de créer un paiement en espèces. Les vendeurs sont refusés par défaut. Les assertions couvrent retours partiels/finals, article endommagé, crédit client, rejets et overflow. Harnais isolé : **240 assertions**.

Limite : les ventes à crédit avec remboursements antérieurs exigent un flux de remboursement/réduction de dette dédié et restent bloquées. Le montant de retour est fourni par l'opération autorisée ; aucune politique de prorata/remise n'est inventée ici. Le helper ne modifie ni stock ni caisse : le serveur doit exécuter atomiquement retour, remboursement/réduction de dette, stock et journal d'audit.

Le dernier durcissement contrôle aussi les allocations, l'identité de l'auteur, la date et les cumuls de l'historique des retours déjà enregistrés. Trois tests couvrent un historique antérieur incohérent.
