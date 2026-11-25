# COMPTIVA — intégration multi-boutiques, rôles et sécurisation

## Statut

- Travail préparatoire sur la branche `comptiva/automatic-subscription-expiry`.
- `firestore.rules` contient une **proposition de règles** pour la future architecture multi-boutiques.
- Ces règles ne sont pas publiées dans Firebase et ne doivent pas être copiées en production avant la migration de l'application et les tests Firebase Emulator.
- Aucun document Firestore existant n'est déplacé ou supprimé par ces commits.
- L'application utilise encore le document historique `users/{uid}/comptivaData/main` contenant l'ensemble des collections d'un commerçant.

## Constat du code actuel

Le document historique contient les tableaux suivants :

- `clients`
- `debts`
- `payments`
- `sales`
- `purchases`
- `expenses`
- `products`
- `auditLog`
- `businessProfile`

Les données sont sauvegardées ensemble dans `users/{uid}/comptivaData/main`. Cette organisation isole les commerçants entre eux, mais ne permet pas de donner des droits Firestore différents à un Patron et à un Vendeur dans une même entreprise.

Les champs relationnels déjà repérés dans les opérations actuelles comprennent notamment :

- Vente : `clientId`, `stockProductId`
- Dette : `clientId`, `saleId`
- Remboursement : `debtId`
- Achat : `stockProductId`

Les opérations de modification/annulation des ventes, achats, dépenses et remboursements ne comportent pas encore de vérification de rôle. Les protections de cohérence métier existantes doivent être conservées et complétées.

Aucun champ opérationnel `shopId`, `sellerUid` ou `patronUid` n'a été trouvé dans le modèle actuel.

## Modèle cible

### Compte et boutique

- Un compte Patron possède un abonnement et gère de 2 à 5 boutiques selon l'offre retenue.
- Chaque boutique a un identifiant stable, un nom, un Patron propriétaire et un statut.
- Une boutique ne doit jamais être supprimée par une simple action d'interface : archivage contrôlé et traçable.
- Les tarifs connus à conserver : 2 boutiques = 100 000 GNF / 30 jours ; 3 = 125 000 GNF ; 4 = 150 000 GNF ; 5 = 175 000 GNF. Offre de base commerçant : 75 000 GNF / 30 jours. Essai : 14 jours.

### Vendeur

- Un Vendeur est un compte Firebase Auth distinct.
- Son appartenance à une boutique est enregistrée dans `shops/{shopId}/members/{sellerUid}`.
- Le document contient au minimum UID, rôle, état actif, prénom, nom, e-mail, auteur de l'affectation et dates.
- Un Vendeur ne peut accéder qu'aux boutiques qui lui sont explicitement attribuées.
- Le Patron peut suspendre ou retirer l'affectation sans effacer l'historique commercial.
- Le nom et prénom du Vendeur doivent rester visibles au Patron dans l'historique des opérations.

### Collections séparées par boutique

Chemins cibles :

- `shops/{shopId}`
- `shops/{shopId}/members/{uid}`
- `shops/{shopId}/sales/{saleId}`
- `shops/{shopId}/clients/{clientId}`
- `shops/{shopId}/debts/{debtId}`
- `shops/{shopId}/payments/{paymentId}`
- `shops/{shopId}/products/{productId}`
- `shops/{shopId}/purchases/{purchaseId}`
- `shops/{shopId}/expenses/{expenseId}`
- `shops/{shopId}/auditLog/{eventId}`
- `shops/{shopId}/reports/{reportId}`

Chaque document métier doit inclure un `shopId` cohérent avec son chemin, un identifiant stable, les dates utiles et les informations d'auteur.

## Matrice de permissions cible

| Action | Patron | Vendeur |
|---|---:|---:|
| Lire les ventes et clients de sa boutique | Oui | Oui |
| Enregistrer une vente | Oui | Oui, selon les règles de stock |
| Modifier/annuler une vente validée | Oui, avec motif et trace | Non |
| Lire les dettes et encaisser un remboursement | Oui | Oui |
| Modifier/annuler un remboursement | Oui, avec motif et trace | Non |
| Lire et modifier les produits | Oui | Lecture ; mouvements de stock encadrés |
| Voir les achats et dépenses | Oui | Non |
| Créer/modifier les achats et dépenses | Oui | Non |
| Voir bénéfice réel, marges et rapports financiers | Oui | Non |
| Gérer les Vendeurs et les boutiques | Oui | Non |
| Lire l'historique des opérations | Oui | Limité à ses opérations si nécessaire |
| Effacer l'historique | Non | Non |

## Traçabilité Patron / Vendeur — état vérifié

- Les nouvelles opérations du modèle historique utilisent `createdByUid`, `createdByName`, `createdAt` et `updatedAt` via `krediActorStamp()`. Les écrans Ventes, Dettes, Remboursements, Achats et Dépenses affichent déjà le nom enregistré lorsque disponible.
- Le pré-contrôle de migration compte les métadonnées d'auteur complètes, partielles ou absentes et ajoute un contrôle dédié aux ventes : UID présent, UID égal au compte propriétaire, UID différent, UID absent et nom absent. Un UID différent n'est pas automatiquement considéré comme vendeur autorisé : son appartenance à la boutique devra être vérifiée côté serveur avant toute conversion vers le champ Firestore `createdBy`. Les données historiques sans auteur restent explicitement inconnues : aucun UID ni nom n'est reconstitué par supposition.
- Limite bloquante : le vendeur est actuellement connecté avec son propre UID et le document historique qu'il sauvegarde est `users/{sellerUid}/comptivaData/main`. Le Patron consulte encore `users/{patronUid}/comptivaData/main`. Les deux espaces restent séparés ; le fait d'inscrire le bon UID dans une vente ne la rend donc pas automatiquement visible dans la base du Patron.
- La présence et l'affectation du vendeur sont suivies dans `shops/{shopId}/members`, `presence` et `userShopMemberships`, mais les écrans opérationnels ne lisent/écrivent pas encore les collections métier `shops/{shopId}/sales`, `clients`, `debts` et `payments`.
- Blocage précis pour les ventes : les objets créés dans l'application portent `createdByUid` et `createdByName` via `krediActorStamp()`, mais pas le champ `createdBy` exigé par la règle de création de `shops/{shopId}/sales/{saleId}`. Il est interdit de remplir automatiquement `createdBy` sans avoir vérifié que l'UID correspond à un membre autorisé de la boutique.
- Le contrôle complémentaire vérifie aussi, par lots de 20 et pour chaque dette et remboursement local connu, que son document partagé existe, que ses références `saleId`, `clientId` et `debtId` correspondent aux valeurs locales, et que les documents liés existent dans la même boutique. Toute anomalie bloque la vérification. Ce contrôle ciblé ne balaie pas toutes les collections : il ne peut donc pas découvrir les documents distants inconnus de la base locale (orphelins distants sans équivalent local). Les produits non référencés ne sont pas considérés comme orphelins, car ils peuvent représenter du stock valide. Un audit exhaustif paginé supplémentaire parcourt ensuite toutes les pages serveur des collections `sales`, `debts`, `payments`, `clients`, `products` et `purchases` (200 documents par page, triés par identifiant Firestore). Il vérifie les `shopId`, les références vente-client-produit, dette-vente-client, remboursement-dette et achat-produit. Le contrôle n'est considéré complet qu'après lecture de la dernière page de chaque collection ; une erreur de lecture interrompt la vérification et bloque la migration. Cet audit peut occasionner des lectures Firestore proportionnelles au volume des six collections. La vérification de sauvegarde contrôle chaque ID historique de vente dans `shops/shop-{uid}/sales`, côté serveur et par lots de 20. Pour chaque collision, elle compare les champs métier connus (produit, quantité, prix unitaire, total, date, type, mode de paiement, client, ventilation des paiements, état et métadonnées de mouvement de stock lorsqu'elles existent). Les champs techniques ajoutés par la migration ne sont pas confondus avec les champs métier. Le résultat classe chaque collision comme contenu concordant, différent ou comparaison incomplète ; un `shopId` distant incohérent est un écart. Pour chaque vente déjà partagée, le contrôle vérifie aussi l'existence et l'appartenance à la boutique du client et du produit référencés, compare les ID des dettes liées, contrôle le lien `saleId`/`clientId` des dettes et vérifie les références `debtId` des remboursements. Toute relation absente ou incohérente bloque également la migration. Dans les trois cas, la migration reste bloquée : même une vente concordante n'est ni ignorée automatiquement ni écrasée. Les exemples affichent les champs en écart ou impossibles à comparer. Si la boutique n'existe pas encore, le contrôle le signale sans la créer. Cette étape est strictement en lecture seule. Les contrôles ciblés supplémentaires sur dettes et remboursements sont également limités aux IDs connus localement ; aucun balayage exhaustif des collections n'est prétendu.
- Ne pas tenter de contourner cette limite en copiant le document complet du vendeur dans celui du Patron ou en ouvrant les règles `users/{uid}` à d'autres comptes : cela créerait un risque de fuite inter-commerçants et d'écrasement de données.

**Conséquence :** l'affichage fiable des ventes du Vendeur dans l'espace Patron exige la migration vers les collections par boutique, avec attribution serveur vérifiée et règles Firestore testées. Jusqu'à cette migration, le suivi de présence peut fonctionner, mais le partage des opérations commerciales n'est pas encore opérationnel.

## Diagnostic d'accès partagé — ajout préparatoire

- Un bouton « Tester l’accès à la boutique partagée » exécute désormais un contrôle **strictement en lecture seule** depuis l'application.
- Pour un Vendeur, il lit côté serveur l'ensemble de son index `userShopMemberships/{uid}/shops` (sans limite arbitraire), vérifie qu'une seule affectation active existe, puis compare l'identité du Patron, le statut actif de la boutique et la fiche membre.
- Pour un Patron, il vérifie l'existence, le statut actif et la propriété de `shops/shop-{uid}`.
- Dans les deux cas, il tente ensuite de lire au maximum cinq documents de `shops/{shopId}/sales`, vérifie le `shopId` des documents lus et compte ceux qui portent un UID d'auteur.
- Le diagnostic ne crée, ne modifie, ne déplace et ne supprime aucun document. Il ne crée pas non plus une boutique manquante.
- Une erreur de permission, une appartenance ambiguë ou une incohérence interrompt le test et affiche un résultat non validé.
- **Limite :** la lecture réussie d'un échantillon prouve seulement que le compte peut lire cette collection au moment du test. Elle ne prouve ni que toutes les ventes sont migrées, ni que les écritures, les règles de stock, les dettes et les remboursements sont sûrs. Aucun test Firebase Emulator ni test réel de production n'a été effectué par ce changement.

## Migration sans perte — étapes obligatoires

1. Inventorier les documents locaux et cloud et vérifier leur propriétaire UID.
2. Créer une sauvegarde vérifiée avant toute transformation.
3. Créer la boutique principale de chaque compte existant avec un identifiant stable.
4. Copier chaque tableau historique dans la collection de la boutique principale, en conservant les IDs et tous les champs.
5. Ajouter `shopId`, `createdBy`, `updatedBy` et les métadonnées d'audit uniquement lorsque leur valeur est connue ; ne jamais inventer l'auteur historique.
6. Vérifier les relations : vente-client, vente-dette, dette-remboursement, vente-produit et achat-produit.
7. Comparer les nombres d'enregistrements et les totaux financiers/quantités avant et après copie.
8. Marquer la migration comme vérifiée seulement après comparaison et lecture de contrôle.
9. Basculer l'application vers les chemins par boutique.
10. Conserver temporairement l'ancien document en lecture seule/archives après validation. Ne le supprimer qu'après une décision explicite et une sauvegarde indépendante.

La migration doit être idempotente : la relancer ne doit ni dupliquer les enregistrements ni modifier les totaux.

## Sécurité et limites techniques à traiter

- Le modèle historique monodocument ne peut pas garantir des permissions par rôle à l'intérieur de ses tableaux. Les contrôles JavaScript seuls ne suffisent pas.
- Les règles proposées dans `firestore.rules` protègent les futurs chemins séparés, mais ne rendent pas encore l'application compatible avec ces chemins.
- Les vendeurs ne doivent pas pouvoir modifier directement les quantités de stock. La vente avec décrément de stock doit devenir une opération atomique vérifiée (transaction Firestore et règles `getAfter` correctement testées, ou service serveur autorisé). Tant que ce mécanisme n'est pas prêt, il ne faut pas ouvrir une écriture de stock au Vendeur.
- Les règles doivent être validées avec Firebase Emulator et des tests positifs/négatifs pour Patron, Vendeur, compte non membre, compte expiré et Créateur.
- La création et l'activation d'un abonnement payant doivent rester contrôlées par un service de confiance. Une validation côté navigateur n'est pas une preuve de paiement.
- Le calcul d'expiration de l'essai ne doit pas dépendre uniquement de l'horloge du téléphone.
- Les règles existantes publiées dans Firebase doivent être récupérées et comparées avant tout remplacement. La proposition actuelle n'est pas une preuve de l'état des règles en production.

## Diagnostic de concurrence — synchronisation et stock

### Protection actuellement présente

- Les sauvegardes du document historique sont sérialisées dans une même session navigateur.
- Avant une écriture, une transaction Firestore relit le document et compare son contenu à la dernière version cloud connue.
- Si un autre appareil a modifié le document, l'écriture est refusée avec un conflit de version. Cela évite l'écrasement silencieux, mais ne fusionne pas les opérations.
- La seconde session conserve sa copie locale et doit passer par la récupération de conflit. Il ne faut pas ajouter de nouvelle tentative automatique aveugle : elle pourrait réécrire une ancienne base ou écraser des opérations concurrentes.

### Limite importante

Le stock est encore modifié dans le tableau local `db.products`, puis envoyé avec tout le document `users/{uid}/comptivaData/main`. Cette méthode ne constitue pas une réservation atomique par produit entre plusieurs vendeurs. Les protections actuelles sont une barrière anti-écrasement, pas une garantie de débit simultané sans conflit.

### Conception obligatoire avant ouverture du stock aux Vendeurs

1. Migrer les produits et opérations vers les chemins `shops/{shopId}/products/{productId}`, `sales` et `auditLog`, sans supprimer l'ancien document.
2. Donner à chaque commande un `operationId` unique et stable, réutilisé lors d'une reprise réseau ; le serveur doit refuser de traiter deux fois le même identifiant.
3. Dans une transaction Firestore unique, lire le produit, vérifier le membre actif et le stock disponible, puis écrire le nouveau stock, la vente et l'événement d'audit. Toutes les lectures doivent précéder les écritures.
4. Vérifier côté règles Firestore que le mouvement est autorisé, lié au bon `shopId`, à l'auteur connecté et à l'opération ; les règles doivent aussi empêcher les modifications directes de quantité hors de ce flux.
5. Traiter les annulations et corrections comme des opérations compensatoires idempotentes, avec contrôle de l'état initial et trace liée à l'opération d'origine.
6. Ajouter des tests Emulator concurrents : deux vendeurs tentent de vendre la dernière unité ; une seule vente doit réussir. Tester aussi double clic, reprise après coupure réseau, annulation répétée, vendeur suspendu pendant l'opération et tentative d'écriture directe du stock.
7. Tant que ces étapes ne sont pas terminées et testées, conserver le stock en écriture Patron uniquement dans le futur modèle multi-boutiques. Ne pas annoncer la gestion simultanée du stock comme opérationnelle.

## Plan d'intégration

### Phase A — modèle et autorisations
- Finaliser les règles Firestore et les tests Emulator.
- Ajouter les services de boutique, membres, rôles et permissions.
- Ajouter le contexte de boutique active et les contrôles d'accès à chaque écran/action.

### Phase B — migration et synchronisation
- Ajouter la sauvegarde/migration idempotente avec vérification des totaux.
- Adapter lecture, écriture, synchronisation multi-appareils et résolution de conflits à l'identifiant de boutique.
- Préserver l'isolation UID actuelle pendant la transition.

### Phase C — opérations métier
- Rendre ventes, stock, dettes et remboursements atomiques.
- Bloquer modification/annulation par Vendeur des ventes validées.
- Réserver achats, dépenses, marges et rapports financiers au Patron.
- Compléter la traçabilité des opérations.

### Phase D — interface et abonnement
- Écrans Patron, boutiques, affectation/suspension des Vendeurs.
- Affichage du prénom/nom du Vendeur dans l'historique.
- Offres multi-boutiques et contrôle du nombre de boutiques selon abonnement.
- Paiement Mobile Money automatisé uniquement après intégration d'un fournisseur et d'une confirmation serveur fiable.

### Phase E — audit final
- Tests de non-régression des fonctions existantes.
- Tests d'isolation entre deux commerçants et entre deux boutiques.
- Tests de contournement des permissions directement via Firestore.
- Tests Android, iOS et ordinateur, en ligne et hors ligne.
- Déploiement uniquement après accord explicite.

## Critères d'acceptation

La fonctionnalité ne sera considérée comme terminée que si :

- deux commerçants ne peuvent jamais lire ou modifier les données l'un de l'autre ;
- un Vendeur ne peut accéder qu'à sa boutique affectée ;
- un Vendeur ne peut pas consulter les achats, dépenses, bénéfices ou rapports privés ;
- un Vendeur ne peut pas effacer ni modifier une vente validée ;
- le stock ne peut pas être altéré en dehors d'un mouvement autorisé ;
- chaque opération nouvelle est attribuée à son auteur ;
- les anciennes données et totaux sont conservés après migration ;
- les règles Firestore passent les tests Emulator ;
- les fonctions de base restent opérationnelles après migration.


L'audit de cohérence du stock vérifie désormais aussi les quantités actuelles de chaque produit, le lien vente-produit, l'égalité entre quantité vendue et quantité déduite, les indicateurs et la quantité de réintégration lors d'une annulation, ainsi que les traces de retrait lors de l'annulation d'un achat. Les ajustements de vente et d'achat sont contrôlés séparément à partir de leurs quantités précédente/nouvelle et de leur delta. L'audit reste consultatif et en lecture seule : il signale les écarts sans recalculer ni modifier les quantités, car les historiques anciens peuvent ne pas contenir de stock initial.


## Revue complémentaire de sécurité et de cohérence — 25 novembre 2026

### Protection des ventes historiques et du stock

Les opérations de modification et d'annulation d'une vente qui porte un `stockProductId` sont désormais bloquées si la vente ne contient pas une preuve fiable de déduction initiale (`stockDeductedAt` et `stockDeductedQuantity` strictement positive et égale à la quantité vendue). Cela évite de réintégrer artificiellement une quantité qui n'aurait peut-être jamais été retirée. L'audit de stock signale aussi ces ventes sous le code `sale_deduction_unproven`, ainsi que les déductions sans identifiant de produit. Aucun stock n'est corrigé automatiquement.

### Blocages de migration multi-boutiques identifiés — ne pas activer en l'état

- L'application utilise toujours le document legacy `users/{uid}/comptivaData/main` pour la synchronisation principale. La transaction compare et remplace le document global `db` ; elle ne réalise pas encore les écritures métier dans les sous-collections `shops/{shopId}/sales`, `clients`, `debts`, `payments`, `products`, `purchases` et `auditLog`.
- Les règles des ventes et paiements partagés exigent `createdBy == request.auth.uid`, alors que le tampon d'auteur actuellement utilisé par les opérations métier fournit `createdByUid` et `createdByName`. Les règles des événements d'audit exigent `shopId` et `actorUid`, alors que les entrées locales existantes utilisent notamment `actor` et `actorName`. Les objets clients, dettes, produits et achats ne sont pas encore systématiquement estampillés avec le `shopId` requis par les règles.
- La transaction actuelle protège contre l'écrasement concurrent du document global, mais ne fournit pas une transaction métier par produit, vente ou mouvement partagé. Les opérations multi-vendeurs ne doivent donc pas être présentées comme atomiques.
- En conséquence, les règles multi-boutiques et les contrôles d'audit associés restent une préparation de sécurité, pas une migration opérationnelle achevée. Ne pas déployer/activer ces règles ni migrer les données avant alignement des schémas, des auteurs, des chemins d'écriture et des transactions, puis tests Firestore Emulator et tests réels autorisés.

### Vérifications de cette revue

- Les trois scripts JavaScript intégrés compilent après les modifications.
- Un scénario synthétique de vente liée à un produit sans preuve de déduction déclenche bien l'anomalie `sale_deduction_unproven`.
- Les protections de modification et d'annulation refusent ce cas avant toute réintégration automatique.
- Les écarts entre le modèle legacy de l'application et les prérequis des règles multi-boutiques ont été confirmés par lecture du code et des règles de la branche.
- Aucun test Firebase réel, test Emulator, test navigateur multi-appareils, déploiement de règles, migration de données, fusion ou publication n'a été effectué.


### Contrôle complémentaire des achats et des retraits de stock — 25 novembre 2026

La correction et l’annulation d’un achat qui augmente le stock exigent désormais une preuve vérifiable de l’ajout initial : horodatage `stockAddedAt` et exactement une trace `purchase_addition` associée au même achat et au même produit, avec une quantité identique à celle de l’achat. Si cette preuve manque, est dupliquée ou présente une quantité différente, l’opération est bloquée avant toute modification du stock. Cela évite de retirer ou de recalculer une quantité qui n’a peut-être jamais été ajoutée. Les achats sans quantité suivie (`quantity` nulle) ne sont pas concernés par cette barrière.

Vérifications synthétiques du contrôle : preuve correcte acceptée ; horodatage absent, trace absente, trace dupliquée et quantité divergente refusés. Les trois blocs JavaScript de l’application compilent après modification. Ces tests ne remplacent pas un essai dans le navigateur ni un test Firebase Emulator.


### Correction de la preuve d'ajout lors de la modification d'un achat historique — 25 novembre 2026

La modification d'un achat historique dont la quantité suivie était nulle pouvait retrouver silencieusement le premier produit portant le même nom, augmenter son stock, mais ne pas créer la preuve `purchase_addition` attendue ensuite par les fonctions de correction/annulation. La correspondance automatique bloque désormais le cas où plusieurs produits ont le même nom. Lorsqu'un seul produit correspond et que la modification ajoute une quantité positive à partir d'une ancienne quantité nulle, l'application enregistre explicitement `stockProductId`, `stockAddedAt` et une trace `purchase_addition` avec les valeurs avant/après. Les modifications d'achats déjà suivis conservent leur trace `purchase_edit_adjustment`. Cette correction ne résout pas l'ambiguïté métier d'un nom identique à un produit différent ; elle bloque les doublons exacts et rend la preuve nécessaire aux opérations suivantes.

Vérifications prévues : compilation JavaScript et tests synthétiques du chemin quantité initiale nulle, correspondance unique et doublon de noms. Aucun test réel Firestore ou navigateur n'est couvert par ces vérifications.


### Protection contre plusieurs dettes actives sur une vente — 25 novembre 2026

L'audit a relevé une asymétrie : la modification d'une vente bloquait déjà plusieurs dettes actives liées à la même vente, mais son annulation ne le faisait pas. L'annulation bloque désormais également ce cas ambigu avant toute modification du stock, de la vente ou des dettes. Une seule dette active liée reste traitée selon les contrôles de remboursement existants ; plusieurs dettes nécessitent une régularisation manuelle.


### Contrôle d'intégrité des dettes et remboursements — 25 novembre 2026

Les calculs de remboursements actifs et de solde refusent désormais de produire un montant exploitable lorsque le registre d'une dette contient un remboursement non entier, nul/négatif, un identifiant de remboursement absent ou dupliqué, un total qui dépasse la capacité entière sûre de JavaScript, une dette avec montant invalide ou un total remboursé supérieur au montant de la dette. La création d'un remboursement vérifie explicitement que le solde est un entier sûr non négatif avant de comparer le montant saisi. La correction d'un remboursement contrôle les autres remboursements actifs et le montant initial de la dette. La modification et l'annulation d'une dette, ainsi que la modification/annulation d'une vente liée à une dette, bloquent en présence d'un registre financier incohérent au lieu de traiter une valeur invalide comme zéro.

Vérifications synthétiques du calcul : registre valide (30 payés sur 100, solde 70) accepté ; montant négatif, valeur non numérique, identifiant dupliqué et surpaiement refusés (résultat non exploitable). Les trois blocs JavaScript intégrés compilent après les changements. Ces contrôles ne constituent pas encore un audit exhaustif de toutes les relations client/vente/dette ni un test navigateur/Firebase Emulator. Aucune donnée historique n'est corrigée automatiquement.


### Intégrité des relations client–vente–dette–remboursement — 25 novembre 2026

Ajout d'un contrôle de cohérence des dettes avant les opérations financières : le client référencé doit exister ; pour une dette liée à une vente, la vente source doit exister, le client de la dette doit correspondre au client de la vente, le montant de crédit de la vente doit correspondre au montant de la dette, et une dette ne peut rester active si la vente source est annulée. La création et la correction/annulation de remboursements, ainsi que la modification/annulation de dettes et de ventes associées, bloquent lorsque ces relations sont incohérentes. Aucun rapprochement automatique ni changement de client n'est effectué.

Tests synthétiques du contrôle de relation : relation cohérente acceptée ; client absent, vente source absente, client différent, montant différent et dette active liée à une vente annulée détectés. Les trois blocs JavaScript compilent. Ces tests ne remplacent pas les tests réels du navigateur et de Firebase Emulator ; les données historiques ne sont pas réparées automatiquement.


### Validation des calculs financiers des ventes — 25 novembre 2026

Les fonctions de calcul du chiffre d'affaires, des encaissements à la vente et du crédit valident maintenant chaque vente active : le total doit être un entier sûr strictement positif, les parts encaissée et à crédit doivent être des entiers sûrs non négatifs, et leur somme doit être exactement égale au total. Les ventes annulées restent exclues. Une vente incohérente rend le calcul de la période non exploitable au lieu d'injecter une valeur fausse dans les totaux. L'affichage monétaire ne convertit plus silencieusement une valeur non entière sûre ou non numérique en « 0 GNF » : il indique « À vérifier ».

Tests synthétiques exécutés : vente espèces, vente entièrement à crédit, paiement mixte 40/60 et vente annulée acceptés avec les totaux attendus ; surpaiement, montant textuel et montant négatif refusés comme données non calculables. Ces tests portent sur les fonctions isolées et ne remplacent pas une compilation complète du fichier, un test navigateur ou Firebase Emulator.

Limites encore à auditer : validation des montants des remboursements et achats/dépenses dans les agrégats de période ; traitement des dates invalides ; distinction entre achats de marchandises, variation de stock et coût des marchandises effectivement vendues. L'indicateur CA − achats − dépenses reste une estimation simplifiée, pas un bénéfice net comptable.


### Contrôle des agrégats datés — remboursements, achats et dépenses — 25 novembre 2026

Ajout de `sumValidDatedAmounts` pour les agrégats de période du tableau de bord et du rapport : les remboursements reçus le jour choisi ainsi que les achats et dépenses du mois vérifient désormais chaque enregistrement actif. La date doit être une date ISO réelle et le montant un entier sûr strictement positif. Les opérations annulées sont exclues. Une date ou un montant incohérent rend l'agrégat non calculable (« À vérifier » via l'affichage monétaire), au lieu d'être silencieusement ignoré ou converti en zéro.

Tests synthétiques exécutés : remboursement valide, opération annulée, achat mensuel, date impossible, montant textuel, montant négatif et opération hors période — 7/7 résultats attendus. Les trois blocs JavaScript du fichier ont été compilés avec `new Function` — 3/3 réussis. Aucun test navigateur, multi-appareil ou Firebase Emulator n'a été réalisé.


### Vérification renforcée de la chaîne des achats et du stock — 25 novembre 2026

L'audit en lecture seule contrôle désormais, pour chaque achat relié au stock, l'existence et l'unicité de la trace initiale `purchase_addition`, sa quantité, la continuité des corrections successives `purchase_edit_adjustment`, la concordance entre la quantité finale tracée et celle enregistrée sur l'achat, ainsi que les retraits d'annulation. Il signale également un retrait d'annulation présent sur un achat encore actif. Les achats historiques suivis sans preuve initiale sont signalés comme non vérifiables ; aucune quantité n'est recalculée ni modifiée automatiquement.

Cette vérification ne constitue pas un inventaire physique et ne prouve pas le stock disponible réel : elle contrôle uniquement la cohérence des traces présentes dans la base locale. Les achats sans lien exact avec un produit restent hors de ce contrôle ciblé.


### Totaux des achats et distinction entre marge théorique et coût réel — 25 novembre 2026

Les totaux des achats du jour et du mois dans la rubrique Achats réutilisent désormais `sumValidDatedAmounts`, comme les autres agrégats datés : les achats annulés sont exclus, et une date ou un montant invalide empêche l'affichage d'un total apparemment fiable (affichage « À vérifier »). Cela évite les conversions permissives de montants textuels ou invalides en valeurs numériques dans ces deux indicateurs.

La colonne de stock est renommée « Marge théorique au prix d’achat actuel ». Elle compare le prix de vente catalogue au prix d'achat actuellement enregistré sur la fiche produit. Elle ne représente pas la marge historique des ventes : le modèle ne conserve pas encore de coût unitaire figé sur chaque vente ni de méthode de valorisation des lots (FIFO ou coût moyen). Il est donc impossible de calculer honnêtement le coût réel des marchandises vendues et le bénéfice réel à partir de ces seuls champs. Aucun coût historique n'a été inventé ou réattribué.

Le suivi des dettes fournisseurs reste également incomplet : le mode « Crédit fournisseur » ne suffit pas à constituer un registre de factures fournisseurs, échéances, règlements partiels et soldes. Cette fonctionnalité doit faire l'objet d'un développement séparé avant de présenter un passif fournisseur fiable.

### Clarification de l'indicateur financier et du crédit fournisseur — 25 novembre 2026

Le formulaire d'achat enregistre un fournisseur, un montant total, une date, une note et un mode de paiement (dont « Crédit fournisseur »). Le modèle ne crée toutefois aucun compte fournisseur ni dette fournisseur associée : il n'enregistre ni échéance, ni montant déjà réglé, ni règlement partiel, ni solde restant dû, ni historique de paiements au fournisseur. Le mode « Crédit fournisseur » est donc une étiquette descriptive, pas un mécanisme de comptabilité fournisseur.

Les totaux des achats du jour/mois et l'indicateur simplifié « CA − achats − dépenses » prennent en compte le montant total de l'achat actif, sans distinguer le paiement immédiat du crédit fournisseur. L'indicateur ne représente donc ni la trésorerie disponible, ni les sorties de caisse, ni le bénéfice comptable. Le texte explicatif du tableau de bord a été précisé pour éviter cette interprétation. Aucun registre fournisseur incomplet n'a été simulé et aucune dette client n'a été détournée pour représenter une dette fournisseur.

Vérification effectuée : lecture des formulaires, de `saveForm`, des fonctions de modification/annulation des achats, du rendu des achats, des agrégats du tableau de bord et des règles Firestore multi-boutiques. Aucune fonctionnalité de paiement fournisseur n'existe dans ces chemins. Aucun test navigateur, Firebase Emulator ou paiement réel n'a été effectué.

### Cohérence des totaux de dépenses — 25 novembre 2026

Les totaux des dépenses du jour et du mois dans la rubrique Dépenses utilisaient auparavant des additions permissives (`Number(amount || 0)`) et un filtrage de date partiel. Ils réutilisent désormais `sumValidDatedAmounts`, déjà employé par le tableau de bord : chaque dépense active doit porter une date ISO réelle et un montant entier sûr strictement positif ; les dépenses annulées sont exclues ; une donnée active invalide fait afficher « À vérifier » au lieu d'un total silencieusement faussé. La création et la modification contrôlent déjà le montant, la date et le mode de paiement ; l'annulation conserve l'enregistrement dans l'historique et l'exclut des totaux.

Tests synthétiques ciblés : dépense valide du jour, cumul mensuel, dépense annulée, montant textuel, date impossible et dépense hors période — résultats vérifiés. Les trois blocs JavaScript ont été recompilés après correction. Aucun test navigateur, Firebase Emulator, multi-appareil ou rapprochement bancaire réel n'a été effectué.


### Audit des rapports financiers — 25 novembre 2026

Le rapport distingue le chiffre d'affaires des ventes, les montants encaissés immédiatement à la vente, les ventes à crédit et les remboursements reçus sur les dettes. Le total restant dû est un indicateur global et non un total limité à la date sélectionnée.

Le calcul du solde global et des remboursements du jour s'appuie désormais sur un contrôle commun du registre des dettes et paiements actifs : identifiants uniques, dette active existante, relation client/vente cohérente, dates ISO réelles, montants entiers positifs et remboursements cumulés qui ne dépassent pas le montant de la dette. Si une incohérence est détectée, les montants concernés affichent « À vérifier » au lieu d'inclure un paiement orphelin ou un doublon. Les remboursements annulés restent exclus.

Le rapport valide également la date choisie et détecte toute vente active portant une date invalide. Dans ce cas, les totaux de ventes des périodes ne sont pas présentés comme fiables ; les lignes détaillées ne retiennent que les ventes dont la date est valide.

Tests synthétiques ciblés : dette sans paiement, remboursement partiel, remboursement annulé, paiement orphelin, identifiant de paiement dupliqué, surpaiement, date de paiement impossible et identifiant de dette dupliqué — 10/10 résultats attendus, avec rejet supplémentaire des enregistrements dette/paiement nuls. Les compteurs de périodes signalent également la présence d'une vente active à date invalide. Les trois blocs JavaScript intégrés compilent après modification.

Limites : ces contrôles sont exécutés sur les données locales chargées dans l'application. Aucun test navigateur, Firebase Emulator, multi-appareil, rapprochement de caisse ou vérification de transactions Mobile Money réelles n'a été effectué. Les anomalies historiques ne sont pas corrigées automatiquement.
