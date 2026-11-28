# COMPTIVA — Audit de cohérence ventes, caisse et remboursements

Date : 28 novembre 2026  
Branche : `comptiva/monthly-stability-audit`

## Constat sur l'application principale

La revue du code actuel de `index.html` confirme plusieurs limites à traiter avant l'ouverture des comptes vendeurs :

- Une vente à crédit crée une vente et une dette dans la même sauvegarde locale, mais ces deux enregistrements sont ensuite synchronisés comme un instantané global. Il n'y a pas de transaction multi-documents Firestore.
- Les remboursements partiels sont contrôlés par calcul local (`paidFor`) puis ajoutés à `db.payments`. Deux appareils peuvent donc vérifier le même solde restant avant d'enregistrer des paiements concurrents.
- Les opérations de vente et de remboursement ne possèdent pas de clé d'idempotence durable dédiée. Une reprise après une coupure réseau peut donc être difficile à distinguer d'une nouvelle opération.
- Le schéma actuel n'impose pas de provenance normalisée `organizationId`, `storeId`, `createdBy` et horodatage serveur pour ces opérations.
- Les données financières et le stock sont synchronisés dans le document global `users/{uid}/comptivaData/main`. Ce modèle ne convient pas à plusieurs vendeurs qui écrivent simultanément.

Ces constats proviennent de la lecture du code de la branche. Aucun test multi-appareils n'a été exécuté.

## Contrôles ajoutés au prototype isolé

Deux fonctions pures ont été ajoutées :

- `validateSaleSettlement(sale)` vérifie que le total correspond exactement à la somme encaissée et du crédit, que les ventes crédit ont un client et que le paiement mixte se réconcilie avec le montant encaissé. Les montants sont traités comme des entiers GNF sûrs.
- `validateDebtPayment(...)` vérifie le rattachement paiement/dette/client/organisation/magasin, l'identité de l'acteur, la clé d'idempotence, l'unicité des IDs de paiements historiques, l'absence de dépassement du solde et la fraîcheur de la proposition.

Les contrôles s'ajoutent aux validations de rôles, invitations, transferts et décrément de stock déjà présentes.

## Tests

Le décompte de 109 assertions correspond à l'étape initiale de cet audit. Le harnais consolidé du prototype multi-magasins exécute maintenant **178 assertions** avec succès, dont les contrôles financiers et d'accès vendeur. Les nouveaux cas couvrent ventes réglées, ventes à crédit, paiement mixte, incohérence de totaux, dépassement de solde, rejeu de paiement, mauvais client/magasin, auteur falsifié, historique de paiement corrompu et horodatage trop ancien.

Il s'agit de tests de fonctions pures. Ce ne sont ni des tests Firebase Emulator, ni des tests de transaction concurrente, ni des tests navigateur.

## Transaction serveur obligatoire

Un remboursement doit être appliqué dans une transaction de confiance :

1. Authentifier l'acteur et vérifier son appartenance active et son accès au magasin.
2. Lire la dette depuis Firestore, pas depuis les valeurs envoyées par le navigateur.
3. Lire le document d'idempotence du remboursement.
4. Lire l'historique ou un solde agrégé maintenu de façon transactionnelle.
5. Refuser un rejeu, une référence incohérente ou un montant supérieur au solde.
6. Créer le remboursement et mettre à jour le solde/la dette dans la même transaction.
7. Utiliser une clé d'idempotence stable réutilisée lors des reprises réseau.
8. Conserver un mouvement financier immuable avec auteur, magasin, montant, moyen de paiement et horodatage serveur.

Pour une vente à crédit, la création de la vente, de la dette, du mouvement de stock et de l'écriture de caisse éventuelle doit également être atomique. Les règles Firestore doivent interdire les écritures client directes qui contournent ces opérations de confiance.

## Décision et limites

Ne pas activer les vendeurs multi-appareils tant que le backend transactionnel, les règles Firestore et les tests Emulator/multi-client ne sont pas terminés. Les helpers ne sont pas branchés à `index.html` et ne protègent pas les données réelles.

Aucune donnée utilisateur, règle Firebase, branche `main` ou publication n'a été modifiée pendant cet audit.


## Complément — projections vendeur des opérations financières

Le prototype ajoute des projections par liste blanche pour les ventes, dettes et remboursements. Elles exposent uniquement les données nécessaires aux opérations du magasin (montants encaissés, solde de dette, moyen de paiement, rattachements et provenance minimale) et excluent les coûts, marges, bénéfices et notes internes. Un validateur récursif rejette aussi les champs financiers sensibles dans les structures imbriquées.

Cette protection reste une spécification côté modèle. Les documents lus par les vendeurs devront être physiquement dépourvus de ces champs dans Firestore ; aucune règle ne peut masquer quelques champs d'un document déjà lisible. Le harnais consolidé exécuté après ces ajouts rapporte **185 assertions réussies** ; il ne remplace pas les tests de règles, transactions et accès multi-comptes dans Firebase Emulator.


## Complément — ventilation des contre-écritures d'annulation (28 novembre 2026)

Le validateur d'annulation renvoie maintenant, en plus du montant total encaissé à contre-passer, le moyen de paiement d'origine. Pour une vente en paiement mixte, il restitue séparément les parts espèces et mobile, validées par `validateSaleSettlement`. Le montant de dette à contre-passer est désormais strictement le `creditAmount` validé, sans valeur de repli implicite. Cinq assertions supplémentaires couvrent la conservation de la ventilation mixte. Cela ne réalise pas les remboursements : la contre-écriture et le mouvement de caisse doivent encore être créés atomiquement par un backend de confiance, sans modifier l'historique original.


## Complément — intégrité de l'historique des remboursements de dette (28 novembre 2026)

Le contrôle des remboursements vérifie maintenant chaque mouvement historique : auteur obligatoire, date valide et non future, auteur toujours autorisé sur le magasin concerné, et absence de marqueur de contre-passation non réconcilié. Un historique contenant un remboursement marqué comme annulé/contre-passé est bloqué plutôt que de risquer de calculer le solde en comptant ou en ignorant ce mouvement de façon ambiguë. Quatre assertions supplémentaires couvrent auteur non autorisé, date future, absence d'auteur et mouvement contre-passé. Une procédure dédiée de contre-passation avec écritures immuables et transaction serveur reste à construire ; cette validation ne réalise pas de remboursement inverse.

## Complément — fiabilité des remboursements dans les rapports (28 novembre 2026)

Le calcul des remboursements du jour ne doit pas additionner aveuglément les lignes de paiement. La fonction `paymentLedgerSummary(dateFilter)` vérifie maintenant que chaque remboursement possède un identifiant unique, référence exactement une dette existante et appartient à un historique de dette cohérent avant de produire un total. En cas de ligne orpheline, de doublon ou d'historique invalide, le total des remboursements du rapport devient « — » au lieu d'un montant potentiellement faux. Le total des dettes dans le rapport affiche également « À vérifier » si au moins un registre de dette est invalide.

Cette correction est locale à l'affichage du rapport. Elle ne modifie ni les enregistrements ni le mécanisme de synchronisation. Les contre-passations de remboursements ne sont toujours pas intégrées aux calculs de soldes, et les transactions multi-appareils restent à construire. Aucun test navigateur ou Firebase n'a été exécuté pour cette modification.

## Complément — export CSV des remboursements (28 novembre 2026)

L'export CSV inclut maintenant une ligne distincte pour chaque remboursement, avec le client, le montant, le moyen de paiement et la date. Avant de générer le fichier, l'application contrôle les registres de dette et l'ensemble des remboursements ; si une dette est incohérente, si un remboursement est orphelin ou si l'historique présente un doublon, l'export est interrompu avec un message explicite plutôt que de produire un relevé financier incomplet ou trompeur. Les remboursements restent des lignes d'événements séparées des ventes : ils ne sont pas ajoutés au chiffre d'affaires des ventes.

Vérification effectuée : relecture du code GitHub après écriture et contrôle statique de la présence des gardes et des lignes de remboursement. Aucun export réel dans un navigateur, test automatisé, test Firebase ou test multi-appareils n'a été exécuté.
