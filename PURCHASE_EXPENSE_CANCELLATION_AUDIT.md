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


## Complément — annulation après transfert ultérieur du stock (28 novembre 2026)

Ajout de `validateSaleCancellationStock`. Lorsqu'une vente est annulée après un transfert ultérieur d'autres unités du même produit, le mouvement de restauration est rattaché au magasin d'origine de la vente, jamais automatiquement au magasin destinataire du transfert. Le helper vérifie l'organisation, le magasin, le produit, la provenance patron, l'existence d'un mouvement déjà appliqué et le risque de dépassement numérique. Cinq assertions couvrent restauration dans le magasin initial, double restauration, magasin falsifié, vendeur non autorisé et overflow. Harnais isolé : **247 assertions**.

Limite : ce helper suppose que les unités annulées reviennent physiquement au magasin de la vente. Si le retour physique se fait dans un autre magasin, il faudra enregistrer un transfert/retour de stock distinct et autorisé plutôt que de créditer arbitrairement le stock initial. L'annulation financière, la restauration de stock et le journal doivent être atomiques côté serveur.


## Audit complémentaire — historique des réceptions d'achats (28 novembre 2026)

Le validateur des réceptions partielles d'achats vérifie désormais que la date de chaque réception antérieure n'est pas postérieure à l'heure de référence de l'opération et que l'identité de son auteur correspond à un membre actuellement autorisé à enregistrer une réception d'achat dans le magasin concerné. Une date de référence invalide est refusée avant le calcul des quantités cumulées.

Deux tests de non-régression couvrent l'événement antérieur daté dans le futur et l'auteur vendeur non autorisé. Le test complet n'a pas été exécuté dans cet environnement. En production, la vérification d'appartenance actuelle doit être complétée par un historique d'audit serveur immuable : le validateur pur ne prouve pas à lui seul qu'un événement historique n'a jamais été falsifié.


## Audit complémentaire — historique des retours clients (28 novembre 2026)

Le contrôle des retours refuse désormais les événements antérieurs datés après l'heure de référence et vérifie que chaque auteur historique disposait de l'autorisation patronale `sales:return` pour le magasin concerné. L'heure de référence invalide est rejetée dès l'entrée du validateur. Trois tests de non-régression couvrent ces cas. Le validateur reste une prévalidation pure : l'historique doit provenir du stockage serveur de confiance et être vérifié dans la même transaction que le retour, le remboursement et la remise en stock.


## Audit complémentaire — cohérence annulation/stock (28 novembre 2026)

Correction d'une divergence entre les deux validateurs d'annulation : le calcul financier de la quantité à restaurer utilisait uniquement `stockProductId`, tandis que le validateur de stock acceptait aussi `productId`. Le calcul utilise maintenant la même référence de repli (`productId || stockProductId`). Le validateur de stock refuse aussi explicitement une vente déjà marquée annulée, même si aucun mouvement n'est fourni au helper. Deux tests de non-régression couvrent ces cas. Cela ne remplace pas la transaction serveur ni la recherche des mouvements existants par identifiant de vente/clé d'idempotence.



## Audit complémentaire — canal de remboursement et paiements mobiles/mixte (28 novembre 2026)

Un contrôle croisé entre le formulaire de vente de `index.html` et `validateSaleReturn` révèle un point bloquant avant toute intégration du retour client :

- L'application accepte les ventes réglées en espèces, Orange Money, Mobile Money ou en paiement mixte espèces + mobile money.
- Le contrat actuel du retour ne comporte que `cashRefundAmount` et `creditReductionAmount`. Pour toute vente de type `paid`, il impose que la totalité du retour soit comptabilisée comme remboursement en espèces.
- Il ne permet donc pas de décrire correctement un remboursement effectué par Orange Money/Mobile Money, ni de ventiler un remboursement mixte. Il pourrait produire un historique de caisse trompeur si on l'intégrait tel quel.
- Le montant remboursé reste une valeur fournie par l'opération autorisée ; aucune règle de prorata ou de remise commerciale n'est actuellement définie. Il ne faut pas inventer automatiquement un prix de retour à partir de la quantité.

**Correction de conception requise avant intégration :** chaque retour payé doit enregistrer explicitement le canal réellement utilisé pour rembourser (espèces, Orange Money, Mobile Money ou ventilation mixte), avec les montants séparés par canal et une égalité stricte entre ces montants et le total remboursé. La réduction de crédit doit rester distincte d'un remboursement encaissé. Le backend devra vérifier les plafonds cumulés, la vente d'origine et les remboursements déjà enregistrés dans une transaction. Si le commerçant rembourse par un canal différent de celui de l'encaissement initial, ce choix doit être explicite et auditable, jamais déduit silencieusement.

**État :** anomalie identifiée et documentée ; aucun changement de logique n'est fait sans contrat de remboursement explicite. Le retour client n'est pas intégré à l'application principale. Aucun test Firebase, paiement réel ou remboursement n'a été exécuté.


## Correction — plafonnement du remboursement par quantité retournée (28 novembre 2026)

Le contrôle cumulatif plafonnait déjà le remboursement à la valeur totale de la vente, mais ne reliait pas assez strictement le montant retourné à la quantité effectivement retournée. Une demande pouvait ainsi déclarer le retour d'une seule unité tout en demandant un remboursement correspondant à plusieurs unités, tant que le total de vente n'était pas dépassé.

Le précontrôle du prototype impose désormais :
- un prix unitaire de vente entier, positif et exploitable, avec une multiplication quantité × prix unitaire sans dépassement de l'entier sûr ;
- pour chaque retour historique, un montant qui ne dépasse pas la valeur unitaire maximale des quantités retournées ;
- pour le nouveau retour, le même plafond individuel et le plafond cumulé quantité × prix unitaire, en plus du plafond global de la vente et des plafonds espèces/crédit ;
- le rejet d'un historique incohérent, plutôt que son recalcul silencieux.

Trois assertions supplémentaires couvrent le retour d'une unité surévalué, un retour historique trop élevé par unité et l'incohérence quantité/montant dans l'historique.

**Limites :** ce plafond utilise le prix unitaire enregistré sur la vente. Les remises globales, taxes, prix négociés ou règles d'allocation au prorata ne sont pas définis dans le modèle actuel ; il faut les formaliser avant d'autoriser ces cas. Ce helper reste une prévalidation pure : le backend devra relire vente, retours, stock et clé d'idempotence dans une transaction atomique avant toute écriture. Aucun mouvement de stock ni remboursement réel n'a été exécuté.


## Correction — empêcher l'annulation après un retour client (28 novembre 2026)

**Risque trouvé :** le validateur d'annulation d'une vente refusait les remboursements de dettes déjà effectués, mais ne recevait pas l'historique des retours clients. Une vente partiellement retournée pouvait donc encore être annulée, et le helper d'annulation pouvait proposer de restaurer la quantité totale initialement vendue. Les unités déjà remises en stock lors du retour risquaient alors d'être comptées une seconde fois.

**Correction conservatrice :** `validateSaleCancellation` accepte désormais l'historique des retours antérieurs et refuse toute annulation lorsqu'un retour existe, avec `sale_has_returns_requires_return_reversal_workflow`. `validateSaleCancellationStock` applique le même verrou avant tout calcul de restauration. Un tableau d'historique valide est exigé.

**Règle métier retenue provisoirement :** après un retour client, l'annulation globale de la vente est bloquée jusqu'à la création d'un flux explicite d'annulation du retour et de ses effets financiers/stock. Il vaut mieux bloquer que restaurer des unités en double. Les ventes sans retour conservent leur chemin d'annulation existant.

Quatre assertions supplémentaires couvrent le blocage dans les deux helpers et le rejet d'un historique absent/invalide. Le libellé statique du harnais passe de 346 à **350 assertions** ; les tests ne sont pas déclarés exécutés.

Le backend doit toujours charger lui-même tous les retours associés à la vente, sans accepter une liste fournie par le client, puis vérifier ces données et les mouvements de stock dans une transaction atomique.
