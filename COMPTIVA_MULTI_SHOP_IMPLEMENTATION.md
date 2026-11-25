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


### Audit arithmétique des ventes — 25 novembre 2026

Le calcul de saisie d'une vente utilise déjà `Math.round(quantité × prix unitaire)`, vérifie une quantité finie strictement positive, un prix unitaire entier positif et un total entier sûr. Une vente mixte est acceptée uniquement si les parts espèces et Mobile Money sont des entiers non négatifs dont la somme égale le total. Les ventes à crédit créent une dette liée à la vente ; la correction et l'annulation contrôlent les remboursements, les dettes liées et les preuves de mouvement de stock.

Un point de contrôle a été renforcé dans `saleFinancialAmounts` : lorsque quantité et prix unitaire sont présents, ils doivent être tous deux valides et reproduire exactement le total selon le même arrondi que la saisie. Les ventes historiques dépourvues de ces champs restent évaluables à partir de leurs montants enregistrés, afin de ne pas invalider automatiquement les anciennes données. Les paiements mixtes sont également contrôlés au niveau du calcul financier central, et pas seulement sur le reçu.

L'historique de correction d'une vente conserve un instantané `before`, les champs `after`, le motif, la date et l'auteur ; l'annulation conserve une trace dédiée. Cela ne constitue pas un historique complet des changements de chaque champ avant la correction initiale, et les anciennes opérations sans trace ne sont pas reconstituées.

Tests synthétiques ciblés : vente cohérente, total différent du produit quantité/prix, quantité ou prix invalide, vente historique sans ces deux champs, champ manquant isolé, paiement mixte cohérent/incohérent, vente annulée. Les trois blocs JavaScript intégrés compilent après correction.

Limites : aucun rapprochement sur les données réelles du compte commerçant, aucun test navigateur, Firebase Emulator, multi-appareil, impression ou paiement Mobile Money réel n'a été effectué. Les anomalies de données ne sont pas corrigées automatiquement.

### Audit ventes et reçus — 25 novembre 2026

Le reçu de vente distingue désormais le crédit initial accordé au moment de la vente du solde actuel de la dette. Pour afficher le solde actuel, l'application exige une dette active unique liée à cette vente, une relation client/vente cohérente et un solde calculable ; sinon le montant est marqué « À vérifier » au lieu de présenter le crédit initial comme un solde courant. Les ventes annulées conservent leur marqueur d'annulation.

La ventilation d'un paiement mixte (espèces / Mobile Money) n'est affichée que si les deux parts sont des entiers non négatifs et si leur somme correspond exactement au montant encaissé à la vente. Une ventilation incohérente est signalée « À vérifier ».

Tests synthétiques : dette partiellement remboursée, dette absente, dettes multiples, vente sans crédit et ventilation mixte valide/invalide. Les trois blocs JavaScript intégrés compilent.

Limites : aucun test d'impression réel sur Android, navigateur ou imprimante thermique n'a été effectué. Aucun contrôle de paiement Mobile Money réel ou synchronisation Firebase multi-appareil n'a été réalisé.


### Audit des remboursements et du registre des dettes — 25 novembre 2026

L'audit a confirmé que la saisie d'un remboursement vérifie la dette active, le lien client/vente, le montant entier positif et le solde disponible. La modification d'un remboursement vérifie aussi les autres paiements et empêche un cumul supérieur à la dette. L'annulation conserve le remboursement dans l'historique avec son statut annulé et un motif ; elle ne le compte plus dans le solde.

Un renforcement a été appliqué à `paidFor` : les identifiants des remboursements actifs doivent être uniques à l'échelle du registre complet, et chaque remboursement actif lié à la dette doit porter une date ISO réelle et un montant entier strictement positif. Une anomalie entraîne un solde « À vérifier » au lieu d'un calcul silencieusement permissif. Les remboursements annulés sont exclus du calcul.

Tests synthétiques ciblés : cumul partiel valide, paiement annulé exclu, date absente ou impossible, montant invalide, doublon d'identifiant sur la même dette, doublon d'identifiant entre deux dettes, surpaiement et dette soldée. Les trois blocs JavaScript intégrés compilent après correction.

Limites : pas de rapprochement sur les comptes réels, pas de test navigateur ou Firebase Emulator, et pas de test d'impression physique. Les anomalies historiques ne sont pas corrigées automatiquement.



### Cohérence des reçus de remboursement et relevés de dettes — 25 novembre 2026

Le reçu d'un remboursement actif vérifie désormais la relation de la dette, son montant, l'identifiant/date/montant du remboursement, le registre actif via `paidFor`, la présence du paiement dans l'ordre chronologique et l'absence de dépassement. Si une condition échoue, les totaux affichent « À vérifier » et le reçu ne prétend plus que le crédit est partiellement ou entièrement remboursé. Le reçu d'un remboursement annulé reste explicitement non valable comme preuve de paiement. Le tri reste sûr même si une date est absente, puis le registre invalide est signalé au lieu de provoquer une exception ; la date imprimée est également signalée comme à vérifier.

Le relevé de dette valide également la relation client/vente et le registre des remboursements avant d'afficher un total payé ou un solde confirmé. En cas d'anomalie, les montants affichent « À vérifier » avec un avertissement. Les lignes historiques annulées sont conservées ; les dates non valides sont signalées. Aucune donnée historique n'est modifiée ou supprimée.

Tests synthétiques ciblés du calcul du reçu : deux remboursements chronologiques, relation incohérente, date impossible, date absente, identifiant dupliqué entre dettes, surpaiement, paiement absent du registre et remboursement annulé — 9/9 résultats attendus. Les trois blocs JavaScript intégrés compilent après correction. Aucun test d'impression réel dans un navigateur, sur Android ou avec une imprimante thermique, ni test Firebase Emulator ou multi-appareil n'a été effectué.


### Traçabilité et sauvegarde des remboursements — 25 novembre 2026

Les actions de modification et d'annulation des remboursements passent maintenant par un contrôle commun avant toute opération : identifiant présent et unique dans tout le registre (y compris face à un doublon avec une ligne annulée), date ISO réelle, montant entier strictement positif, dette active, relation dette/client/vente cohérente et registre actif non surpayé. Les opérations sont bloquées si l'un de ces contrôles échoue.

Le journal d'audit conserve pour ces actions l'état `before` et `after`, le motif, l'horodatage, l'identifiant du remboursement et l'auteur (`actorUid`/`actorName`, avec les champs historiques conservés). En cas d'échec de sauvegarde locale, l'application restaure l'état précédent en mémoire. Les messages de succès précisent désormais que l'opération est enregistrée sur cet appareil et que la synchronisation cloud peut être en cours ou en attente.

Tests synthétiques du contrôle commun : registre valide, doublon actif, doublon avec une ligne annulée, date impossible, montant nul, relation dette invalide, surpaiement et remboursement déjà annulé — 8/8 résultats attendus. Les trois blocs JavaScript compilent. L'examen du code confirme que `saveDB()` écrit d'abord dans `localStorage`, puis déclenche une synchronisation différée ; la transaction Firestore compare la version distante attendue avant d'écrire et suspend l'envoi en cas de conflit. Ce comportement a été inspecté dans le code, pas testé sur un projet Firebase réel.

Limite de sécurité à conserver dans la feuille de route : `auditLog` est stocké dans le même document de base que les données métier et est écrit par le client. Les contrôles et snapshots améliorent la traçabilité fonctionnelle, mais ne rendent pas le journal inviolable : un client autorisé ayant accès en écriture au document pourrait modifier l'historique. Une vraie piste d'audit append-only et vérifiable nécessitera un backend de confiance et des règles adaptées, à concevoir et tester avant mise en production. Aucun essai réel navigateur, Android, multi-appareil ou Firebase Emulator n'a été effectué dans cet audit.


### Audit de la synchronisation multi-appareils et de la reprise réseau — 25 novembre 2026

L'examen de `saveDB()`, de `krediQueueCloudSave()`, de `krediWriteCloudIfUnchanged()`, de l'écoute Firestore `onSnapshot` et des événements `online/offline` confirme que la sauvegarde locale précède l'envoi cloud. Un marqueur `comptiva_pending_{uid}` conserve l'état d'attente ; au retour du réseau, l'application revalide l'abonnement du commerçant puis relance la file d'envoi. Une seule écriture cloud est autorisée à la fois par le verrou d'opération et son jeton de session. La transaction relit le document et compare son contenu à la version de référence avant tout remplacement ; une divergence bloque l'écriture.

La fusion des collections est une union par identifiant : des enregistrements distincts peuvent être conservés ensemble, tandis qu'un identifiant commun est remplacé par la version prioritaire. Le contrôle de conflit suspend normalement la fusion automatique lorsqu'une modification locale est en attente et que la version distante diffère à la fois de la base connue et de la base locale. Les copies de récupération locales conservent alors les instantanés disponibles. Le mécanisme est volontairement conservateur : il ne réalise pas de fusion champ par champ de deux modifications concurrentes du même enregistrement.

Limite importante : la file d'attente n'est pas un journal d'opérations autonome ; elle repose sur le snapshot complet en localStorage et un marqueur. Une perte, un effacement ou une corruption du stockage local avant la reprise réseau peut donc faire perdre les modifications qui n'ont pas encore été envoyées. Il faut conserver l'appareil et son stockage jusqu'à confirmation explicite de la synchronisation. Les modifications locales ne sont pas automatiquement sauvegardées sur un second appareil tant que le cloud ne les a pas reçues.

Tests synthétiques isolés du comportement de fusion/conflit : union de deux opérations distinctes, priorité locale sur un même identifiant, priorité distante sur un même identifiant, blocage de versions concurrentes divergentes, autorisation lorsque le cloud correspond à la base connue et autorisation lorsque le cloud correspond déjà au local — 6/6 résultats attendus. Les trois blocs JavaScript intégrés compilent avec `new Function` — 3/3 réussis.

Ces vérifications portent sur le code et des scénarios synthétiques. Aucun test réel avec deux navigateurs/appareils, coupure réseau effective, Firebase Emulator, Firestore de production, effacement du stockage ou restauration d'une copie de conflit n'a été effectué. Aucune modification du code applicatif n'a été nécessaire dans cette étape ; la prochaine amélioration à concevoir est une boîte d'envoi durable et vérifiable, sans compromettre la stratégie actuelle de blocage des conflits.


### Audit du cache PWA et des mises à jour — 25 novembre 2026

Le service worker `service-worker.js` met en cache uniquement le shell déclaré : `application.html`, `manifest.webmanifest` et `icons/comptiva.svg`. Il ignore les requêtes qui ne sont pas GET et celles dont l'origine diffère de celle du site. La navigation vers l'application utilise une stratégie réseau d'abord avec secours sur le document en cache ; les autres ressources explicitement listées dans le shell utilisent le cache en priorité. Le worker ne contient pas de route Firebase/Firestore, de cache de réponses API ni de copie des données métier. Le cache porte le nom versionné `comptiva-pwa-shell-v2` ; à l'activation d'un nouveau worker, les anciens caches préfixés `comptiva-pwa-` sont supprimés.

Le manifeste est un JSON valide, avec `start_url` et `id` sur `./application.html`, portée `./` et affichage `standalone`. L'enregistrement du worker est effectué depuis `application.html` sur HTTP(S), avec portée relative et `updateViaCache: 'none'`. Le contrôle des mises à jour est relancé à l'enregistrement et au retour de visibilité. Le nouveau worker attend une action explicite de l'utilisateur via le message `COMPTIVA_SKIP_WAITING`, puis le client recharge la page à `controllerchange`.

Point de vigilance : l'avertissement de mise à jour demande de terminer les opérations et de vérifier la sauvegarde, mais aucun verrou technique ne vérifie les formulaires ou les saisies non enregistrées avant l'action. Une saisie présente uniquement dans un formulaire peut donc être perdue lors du rechargement. Les modifications déjà enregistrées via `saveDB()` sont écrites localement avant l'envoi cloud, mais cela ne protège pas les champs de formulaire encore non validés.

Limite hors connexion : le worker peut servir le document HTML de l'application déjà mis en cache, mais il ne met pas en cache les SDK ou services Firebase externes. L'ouverture de l'interface hors connexion ne garantit donc ni une nouvelle authentification, ni l'accès à Firestore, ni toutes les fonctions qui dépendent du réseau. Les fonctions locales peuvent rester disponibles selon les ressources déjà chargées ; cela n'a pas été validé sur un navigateur réel.

Le worker est indépendant de la page publique `index.html`, qui ne l'enregistre pas : la page marketing n'est donc pas couverte par ce cache hors connexion. Le démarrage PWA déclaré par le manifeste vise directement `application.html`.

Vérifications statiques : syntaxe JavaScript du worker, JSON du manifeste, liste explicite du shell, stratégie réseau d'abord pour la navigation, filtrage des requêtes, absence de références Firebase/données métier dans le worker, déclenchement utilisateur de `skipWaiting` et rechargement à `controllerchange`. Ces vérifications ne sont pas des essais de cache réels. Aucun test de première installation, mise à jour en conditions réelles, Android/iOS, mode avion, formulaire ouvert, nettoyage de cache ou récupération après fermeture forcée n'a été effectué. Aucun fichier applicatif n'a été modifié lors de cet audit ; seule cette documentation a été complétée.


### Audit des sessions, déconnexion et séparation des comptes — 25 novembre 2026

L'examen de l'authentification et du stockage local confirme que chaque compte commerçant utilise un espace distinct construit à partir de son UID Firebase (comptiva_user_v1_{uid}), avec un cache d'abonnement également séparé (comptiva_subscription_v1_{uid}). Lors d'un changement d'état Auth, l'application incrémente krediSessionEpoch, remplace l'utilisateur actif et l'espace de stockage, puis désabonne l'ancien écouteur Firestore. La déconnexion remet la base en mémoire sur une base invité vide, réinitialise les abonnements locaux invités, arrête les écouteurs de présence et masque l'interface commerciale.

Les opérations asynchrones de synchronisation capturent l'UID, l'espace de stockage attendu et l'époque de session. Elles vérifient ces éléments avant l'écriture et après le retour de la transaction Firestore ; un ancien résultat ne doit donc pas actualiser l'interface ou marquer comme synchronisées les données d'un compte qui n'est plus actif. Le verrou d'écriture conserve aussi un jeton de propriétaire afin qu'une ancienne opération ne libère pas le verrou d'une opération plus récente. Les sauvegardes locales et la file cloud refusent de travailler si l'espace courant ne correspond pas à l'UID connecté.

La déconnexion avertit l'utilisateur lorsque des données peuvent être en attente ou non confirmées sur Firebase. Elle tente une dernière sauvegarde locale avant signOut() et conserve les données dans la clé propre au compte. Le verrouillage automatique intervient après deux minutes d'inactivité et au passage de l'onglet en arrière-plan ; le déverrouillage exige une réauthentification du compte courant.

Tests synthétiques du garde de session reproduisant les conditions du code : ancien écouteur A après passage à B, sauvegarde A après déconnexion, sauvegarde B dans son propre espace et session A toujours active — 4/4 résultats attendus. Les trois blocs JavaScript intégrés à application.html compilent avec new Function — 3/3 réussis.

Limites et points de durcissement : ces résultats sont une inspection statique et des tests synthétiques, pas une preuve de test réel. Aucun essai dans deux navigateurs, sur Android, avec deux comptes Firebase réels, ni avec des transactions Firestore retardées n'a été effectué. Les opérations de présence vendeur sont asynchrones ; leurs écritures vérifient l'UID avant l'envoi, mais un résultat tardif peut encore laisser un intervalle inactif jusqu'au prochain nettoyage. Le verrou d'inactivité est une protection d'interface côté client, pas une frontière de sécurité contre un appareil compromis. La séparation réelle des données dépend toujours des règles Firestore côté serveur. Aucun code applicatif n'a été modifié dans cet audit ; seule cette documentation est complétée.


### Audit des rôles Patron / Vendeur et des opérations commerciales — 25 novembre 2026

L'application contient une première gestion d'affectation des vendeurs : création/vérification d'une boutique principale, écriture d'une fiche membre avec role=seller et active=true, création d'un index userShopMemberships, suspension/réactivation d'une affectation et suivi de présence. Le diagnostic d'accès à la boutique partagée lit les appartenances et un petit échantillon de ventes côté serveur ; il est explicitement en lecture seule et ne valide pas les opérations d'écriture.

Constat critique : dans le code commercial actuellement inspecté, les fonctions editSale et cancelSale ne vérifient pas le rôle Patron/Vendeur ni l'appartenance active avant de modifier ou annuler une vente. renderSales affiche les actions Modifier et Annuler pour toute vente non annulée, sans filtrage par rôle. renderDashboard et renderReports calculent et exposent les chiffres de vente et l'indicateur financier sans filtrage visible par rôle. Cette inspection ne démontre donc pas que les restrictions demandées pour les vendeurs (interdiction de supprimer/modifier une vente validée, accès interdit aux bénéfices, restrictions sur stock/achats/dépenses) sont effectivement appliquées.

Autre point d'architecture : le stockage métier principal reste chargé depuis users/{uid}/comptivaData/main et le stockage local est propre à chaque UID. L'affectation dans shops/{shopId}/members et userShopMemberships ne prouve pas, à elle seule, que les vendeurs et le Patron travaillent sur une base commerciale partagée. Le diagnostic de boutique partagée est en lecture seule ; il ne constitue pas une migration ni un mécanisme de partage des opérations courantes.

Contrôles statiques ciblés : absence de contrôle de rôle détectée dans editSale, cancelSale, renderSales, renderDashboard et renderReports — 5/5 constats. Les trois blocs JavaScript intégrés à application.html compilent avec new Function — 3/3 réussis. Aucun code applicatif n'a été modifié dans cette étape.

Priorité de correction avant activation commerciale du mode multi-boutiques : définir une matrice de permissions explicite ; appliquer les contrôles dans les fonctions d'interface pour l'expérience utilisateur ; surtout, faire respecter les mêmes droits par les règles Firestore ou un backend de confiance, sans faire confiance à un rôle fourni par le navigateur. Les ventes validées doivent être immuables pour un vendeur, les annulations/corrections réservées au Patron avec motif et journal d'audit, et les achats, dépenses, coûts et indicateurs de marge/profit doivent être filtrés côté serveur selon le rôle. Vérifier également l'accès direct aux documents Firestore, pas seulement les boutons masqués.

Limites : les règles Firestore déployées et le comportement réel des comptes vendeur/Patron n'ont pas été testés dans cette étape. Aucun test Firebase Emulator, aucune tentative d'écriture directe avec un compte vendeur et aucun essai multi-appareil n'ont été exécutés. Ne pas activer ni présenter le mode multi-boutiques comme sécurisé tant que ces vérifications ne sont pas terminées.


### Audit des règles Firestore et des accès directs — 25 novembre 2026

Périmètre réellement inspecté : fichier `firestore.rules` de cette branche (SHA `fe5d434957a8e49b1d583a165b4371a8c64394bc`), proposition documentaire `FIRESTORE_SUBSCRIPTION_RULES_PATCH.txt` et références d'accès Firestore dans `application.html`. Cet examen porte sur les fichiers du dépôt ; il ne prouve pas que ces règles sont celles actuellement publiées dans la console Firebase.

**Séparation historique des comptes**
- Le chemin historique `users/{userId}/{document=**}` autorise la lecture uniquement si l'UID connecté correspond à `userId`. L'écriture est également limitée à ce même UID et exige un abonnement/essai valide, sauf pour le Créateur écrivant dans son propre chemin. Le Créateur n'obtient donc pas, par cette règle, un accès général aux données privées des autres commerçants.
- Le document principal utilisé par l'application reste `users/{uid}/comptivaData/main`. La règle historique protège donc bien le périmètre d'un compte contre un autre compte, sous réserve que cette version soit effectivement déployée.
- `merchantDirectory` limite la fiche d'annuaire du commerçant à ses propres champs autorisés ; lecture et suppression sont réservées au Créateur.
- `merchantSubscriptions` autorise au commerçant la lecture de son document et la création initiale d'un essai de 14 jours ; les modifications/suppressions sont réservées au Créateur. Le Créateur dispose d'un accès global en lecture/écriture à cette collection, pas à la collection métier historique `users`.

**Modèle multi-boutiques dans les règles**
- Le Patron est reconnu par concordance de `ownerUid` et `patronUid` avec l'UID connecté. La boutique doit être active pour les écritures ; le Patron doit avoir un abonnement valide pour écrire. Un vendeur actif dépend du statut actif de la boutique, de son document membre et de l'abonnement du Patron.
- Les règles limitent les ventes, dettes, remboursements, clients et produits à une boutique donnée par le chemin `shops/{shopId}/...` et par le champ `shopId` exigé sur les écritures correspondantes. Les ventes et remboursements ne peuvent pas être supprimés ; leur modification est réservée au Patron. Les produits/stock, achats, dépenses et rapports sont réservés au Patron en lecture ou écriture selon la collection. Les vendeurs n'ont pas de lecture sur achats, dépenses et rapports.
- Les vendeurs peuvent lire ventes, clients, dettes, remboursements et documents produits ; ils peuvent créer des ventes, clients, dettes et remboursements. Ils peuvent aussi mettre à jour des fiches clients. Ce périmètre doit être confirmé par rapport aux tâches réellement attendues d'un vendeur.
- Le document de présence est lisible par le Patron ; un utilisateur ne peut écrire que son propre heartbeat, avec un statut actif et une date serveur.
- Les écritures de membres sont réservées au Patron et imposent le rôle `seller`, l'UID du membre et l'auteur de l'affectation. L'index `userShopMemberships` est lisible par son propre UID et géré par le Patron.

**Anomalies et durcissements à traiter avant activation**
1. La fonction `isShopSeller(shopId)` vérifie le rôle `seller`, mais les fonctions `isActiveShopMember`, `canUseShop` et `canWriteShop` ne l'utilisent pas. Elles se fondent sur `active == true` sans exiger explicitement `role == 'seller'`. Les règles de création de membre imposent actuellement seller, mais le contrôle de rôle devrait être centralisé dans la condition d'appartenance active afin d'éviter qu'un document membre actif d'un autre rôle obtienne les droits vendeur.
2. La lecture des documents `products` est autorisée aux vendeurs sans filtrage champ par champ. Firestore Rules ne masquent pas certains champs d'un document : si un produit contient un coût d'achat, une marge ou une donnée de valorisation, le vendeur peut la lire avec le document complet. Il faudra séparer les données sensibles ou utiliser une projection/backend dédié avant d'y stocker ces champs.
3. Les règles de création/modification des documents partagés contrôlent principalement `shopId` et, pour ventes/remboursements, certains champs d'auteur. Elles ne valident pas encore une liste stricte de champs métier, les montants, quantités, relations client/dette/vente, ni l'immutabilité des champs de validation. Les créations de clients/dettes ne contrôlent pas l'auteur ; les mises à jour de clients laissent le vendeur modifier tous les champs sauf le changement de shopId. Les créations de ventes/remboursements acceptent des champs additionnels arbitraires. Définir des schémas stricts et des invariants serveur avant d'exposer ces écritures.
4. La règle `auditLog` impose boutique et `actorUid`, et interdit update/delete, ce qui constitue une base append-only côté règles. Elle ne valide toutefois pas le schéma complet, l'horodatage, le type d'événement ni les champs d'auteur complémentaires. Un client autorisé peut donc encore soumettre un événement incomplet ou trompeur ; ce journal n'est pas une preuve inviolable sans backend de confiance.
5. `canUseShop` autorise le Patron à lire sa boutique même lorsque l'abonnement est expiré ou que la boutique est inactive ; les écritures sont séparément bloquées par `canWriteShop`. Cela peut être intentionnel pour permettre la consultation après expiration, mais le comportement de lecture après suspension doit être une décision produit explicite.
6. Les règles ne garantissent pas à elles seules que les données liées d'une vente, d'une dette, d'un remboursement ou d'un client appartiennent toutes à la même boutique. Les champs `shopId` sont contrôlés, mais les références croisées et les montants doivent aussi être validés au niveau serveur.

**Écart majeur entre les règles et l'application actuelle**
L'application crée/vérifie la boutique principale, gère les documents membres et l'index d'affectation, envoie la présence et effectue des diagnostics/lectures sur les collections partagées. En revanche, le stockage métier et la synchronisation principale restent sur `users/{uid}/comptivaData/main`. L'inspection des références Firestore dans `application.html` n'a pas mis en évidence de mécanisme opérationnel qui synchronise les ventes, clients, dettes, remboursements, produits, achats et dépenses courants vers les collections partagées `shops/{shopId}/...`. Le diagnostic partagé est explicitement en lecture seule. Les règles multi-boutiques sont donc une préparation de sécurité pour un modèle de données qui n'est pas encore démontré comme migré et opérationnel ; les affectations de vendeurs ne prouvent pas que Patron et Vendeur travaillent sur les mêmes données commerciales.

**État des tests et publication**
- Les trois blocs JavaScript de `application.html` compilent avec `new Function` — 3/3 réussis.
- Vérification statique des chemins et des fonctions d'accès effectuée ; aucun test d'autorisation Firebase Emulator, aucune tentative réelle de lecture/écriture directe avec un compte vendeur, aucun test avec deux comptes réels et aucun test multi-appareil n'ont été réalisés.
- Le fichier `FIRESTORE_SUBSCRIPTION_RULES_PATCH.txt` se présente explicitement comme une proposition à publier manuellement. Aucun `firebase.json` n'a été trouvé à la racine de cette branche lors de l'inspection. Le statut exact des règles déployées dans le projet Firebase reste donc inconnu.
- Aucune règle ni aucun code applicatif n'a été modifié pendant cet audit. Ne pas publier ces règles, ne pas activer le multi-boutiques et ne pas présenter les permissions comme validées avant correction des points ci-dessus et tests Emulator couvrant au minimum Patron, vendeur actif, vendeur suspendu, autre commerçant et utilisateur non connecté.


### Audit complémentaire des scénarios d'accès directs Firestore — 25 novembre 2026

Deuxième passe ciblée sur les autorisations effectives des règles, en raisonnant opération par opération et sans passer par les boutons de l'application. Fichier contrôlé : `firestore.rules`, SHA inchangé `fe5d434957a8e49b1d583a165b4371a8c64394bc`. Il s'agit d'une analyse statique des conditions écrites, pas d'un test d'exécution dans Firebase Emulator.

**Matrice d'accès déduite des règles du dépôt**
- Non connecté : aucune autorisation explicite de lecture/écriture sur les chemins métier ; les conditions d'accès nécessitent une authentification.
- Commerçant historique A : lecture de `users/A/**` autorisée pour A ; lecture de `users/B/**` refusée. Les écritures dans son propre chemin sont soumises à l'abonnement, sauf exception Créateur dans son propre UID.
- Patron de la boutique : lecture de sa boutique et de ses collections selon les règles ; écritures métier soumises au statut actif et à l'abonnement. Il peut gérer membres, produits, achats, dépenses et rapports.
- Vendeur actif reconnu par un document membre actif : accès lecture aux ventes, clients, dettes, paiements et produits ; création possible de ventes, clients, dettes et paiements ; modification de clients possible ; pas de modification/suppression des ventes, pas de mutation de produits/stock, pas d'accès aux achats, dépenses et rapports. Attention : le code des règles ne vérifie pas assez strictement le rôle vendeur avant d'accorder ces droits.
- Vendeur suspendu : le document membre doit avoir `active == true` pour être reconnu ; une affectation suspendue doit donc perdre les droits partagés. Cela reste à vérifier dans l'Emulator et sur un compte réel.
- Autre commerçant : il ne devient pas membre simplement en connaissant le `shopId` ; les règles exigent un document membre actif côté boutique. Aucune tentative réelle avec un deuxième compte n'a été effectuée.
- Créateur : accès de lecture au document racine de n'importe quelle boutique et accès global à `merchantSubscriptions`, mais les règles ne lui accordent pas automatiquement la lecture des sous-collections commerciales de toutes les boutiques.

**Constats directs supplémentaires**
1. La fonction `isShopSeller(shopId)` est définie mais n'est appelée par aucune autre condition d'autorisation du fichier. La fonction réellement utilisée, `isActiveShopMember(shopId)`, vérifie l'existence du document membre, `active == true`, le statut actif de la boutique et l'abonnement du Patron, mais ne vérifie ni `role == 'seller'`, ni `member.uid == request.auth.uid`, ni la concordance du Patron dans la fiche membre. Les permissions accordées à un membre actif sont donc plus larges que le rôle explicitement attendu. C'est un défaut de contrôle d'autorisation à corriger en priorité.
2. L'index `userShopMemberships` n'est pas exigé par `isActiveShopMember`. Il sert à retrouver l'affectation côté application, mais la frontière d'autorisation est le document `shops/{shopId}/members/{uid}`. Il faut éviter que l'index et la fiche membre divergent ; les écritures des deux documents ne sont pas atomiques dans le code examiné.
3. La lecture des produits est `canUseShop(shopId)`, et non `isShopPatron(shopId)`. Un vendeur actif peut donc lire le document produit entier. Aucun masquage de champs n'est possible dans une règle Firestore document classique : les coûts, marges ou valeurs d'achat présents dans ce document seraient visibles. Séparer les données publiques du stock et les données financières privées avant d'ajouter ces champs.
4. Les règles de création de vente et de remboursement vérifient `shopId` et `createdBy`, mais ne vérifient pas que le `clientId`, `debtId`, `saleId` ou `productId` lié existe et appartient à la même boutique. Un vendeur autorisé pourrait donc envoyer directement des documents incohérents ou des montants arbitraires, même sans pouvoir modifier le stock. Les règles de dette/client ne valident pas non plus tous les champs métier.
5. Les règles d'update de vente et de paiement réservent la modification au Patron et préservent `shopId`/auteur, mais ne limitent pas la liste des autres champs modifiables. Le Patron peut donc remplacer des champs de validation ou des valeurs financières par un appel direct ; cela peut contourner les contrôles métier du navigateur.
6. La mise à jour du document racine de boutique autorise le Patron à changer `status` uniquement si `canWriteShop` est déjà vrai, et `canWriteShop` exige que le statut actuel soit `active`. Si le Patron passe le statut à `suspended` ou à une autre valeur, il ne satisfait plus ensuite `canWriteShop` et ne peut plus réactiver la boutique par cette règle. Prévoir un chemin de réactivation explicitement contrôlé, ou un changement de statut réservé au Créateur/backend.
7. Le journal `auditLog` est append-only au niveau des règles, mais un membre autorisé peut créer un événement avec des champs additionnels, une date ou un type non contrôlé. Il ne doit pas être considéré comme un registre probant avant validation stricte ou écriture via un backend de confiance.
8. Les règles des collections partagées s'appuient sur le chemin `shops/{shopId}/...` ; elles ne valident pas systématiquement que le champ `shopId` des documents lus correspond au paramètre du chemin. Les contrôles de cohérence existants dans l'application sont des diagnostics, pas une barrière serveur sur chaque lecture.

**Priorité de correction proposée**
P0 — centraliser la validation d'appartenance : authentification, boutique active, abonnement Patron, rôle exactement `seller`, UID membre égal à l'UID connecté et patron de la fiche membre égal au propriétaire de la boutique. Vérifier les opérations d'affectation/suspension de manière cohérente.

P0 — séparer les champs produits visibles du vendeur des coûts/marges et autres données financières ; ne pas compter sur le masquage de l'interface.

P1 — définir des schémas `keys().hasOnly/hasAll`, types, bornes, champs immuables et invariants de relations pour chaque création/mise à jour. Pour les opérations financières et les relations croisées, privilégier des transactions/backend de confiance plutôt que des règles trop complexes ou des données fournies par le client.

P1 — définir la procédure de suspension/réactivation de boutique afin d'éviter le verrouillage définitif du Patron.

P1 — renforcer le journal d'audit (auteur, date serveur, type d'événement, champs autorisés) et préciser qu'un journal client n'est pas inviolable.

**Scénarios Emulator obligatoires avant toute publication**
1. Utilisateur non connecté : lire et écrire chaque chemin privé et partagé — refus.
2. Patron A : accès autorisé à sa boutique, refusé à la boutique B ; tenter des changements de champs interdits et de statut.
3. Vendeur actif A : lire uniquement les collections prévues ; tenter de lire achats/dépenses/rapports, modifier une vente validée, supprimer une vente, modifier un produit, forger un auteur ou créer un remboursement lié à une dette étrangère — refus selon la politique attendue.
4. Vendeur suspendu A : toutes les lectures/écritures partagées interdites après suspension, y compris présence et index incohérent.
5. Compte B non membre : connaître le shopId de A ne doit donner aucun accès.
6. Document membre avec rôle différent de seller, UID incohérent ou patron incohérent : accès refusé.
7. Patron : impossible de modifier auteur, statut de validation ou données financières en contournant les invariants ; test de suspension puis réactivation contrôlée.
8. Tests de requêtes de liste/collectionGroup et de chaque sous-collection, pas seulement de lectures document par document.

**État de cette passe**
Aucune règle Firestore et aucun code applicatif n'ont été modifiés. Les constats et scénarios ont été ajoutés à cette documentation uniquement. Pas d'Emulator, pas de test réel de comptes, pas de déploiement, pas de changement de `main`. La migration vers les collections partagées reste non démontrée ; cette matrice décrit les autorisations prévues par le fichier du dépôt, pas le fonctionnement réel d'un mode multi-boutiques en production.



## Plan de tests de sécurité Firebase Emulator — 25 novembre 2026

### État de l'environnement

- Vérification de la branche : aucun `firebase.json`, `.firebaserc`, `package.json`, fichier de verrouillage npm/yarn/pnpm, fichier de test Firestore aux emplacements usuels, ni workflow GitHub Actions Firebase Emulator n'a été trouvé aux chemins examinés.
- Le dépôt ne fournit donc pas encore de configuration reproductible pour lancer les tests de règles.
- Aucun SDK, dépendance, fichier de configuration ou workflow n'a été ajouté automatiquement : il faut d'abord choisir et valider l'environnement de test.
- Les règles actuelles sont une proposition préparatoire. Aucun test Emulator ni test sur Firebase réel n'est déclaré comme exécuté.

### Environnement de test à préparer

1. Projet Firebase Emulator isolé, sans identifiants de production et sans connexion à la base réelle.
2. Émulateurs Authentication et Firestore démarrés localement.
3. Chargement explicite de `firestore.rules` dans l'émulateur.
4. Jeu de données synthétique : Patron A, Vendeur A1, compte étranger B, boutique A, boutique B, abonnement actif, abonnement expiré et boutique suspendue.
5. Tests automatisés avec le SDK de tests des règles Firestore (`@firebase/rules-unit-testing`) et le SDK Firebase compatible.
6. Chaque test doit vérifier à la fois les lectures individuelles, les requêtes/listes et les écritures directes. Les tests doivent repartir d'un état de base propre.

### Matrice minimale obligatoire

| ID | Identité / état | Opération directe | Résultat attendu |
|---|---|---|---|
| AUTH-01 | Non authentifié | Lire/écrire `users/A/comptivaData/main` | Refus |
| ISO-01 | Compte A | Lire ses propres données historiques | Autorisé si abonnement conforme aux règles d'écriture |
| ISO-02 | Compte B | Lire/écrire les données historiques de A | Refus |
| SHOP-01 | Patron A | Lire sa boutique A et ses collections | Autorisé |
| SHOP-02 | Compte B non membre | Lire boutique A avec son identifiant connu | Refus |
| SHOP-03 | Patron A | Lire ou modifier boutique B | Refus |
| SELL-01 | Vendeur A1 actif | Lire ventes, clients, dettes et paiements de A | Autorisé selon la matrice métier |
| SELL-02 | Vendeur A1 actif | Lire achats, dépenses et rapports de A | Refus |
| SELL-03 | Vendeur A1 actif | Modifier/supprimer une vente validée | Refus |
| SELL-04 | Vendeur A1 actif | Modifier/supprimer un produit ou son stock | Refus |
| SELL-05 | Vendeur A1 actif | Créer une vente ou un remboursement avec un auteur falsifié | Refus |
| SELL-06 | Vendeur suspendu | Lire et écrire les collections partagées | Refus |
| SELL-07 | Membre actif dont le rôle n'est pas `seller` | Accéder aux données métier | Refus |
| SELL-08 | Fiche membre dont `uid` ne correspond pas au chemin | Accéder aux données métier | Refus |
| SELL-09 | Membre rattaché à un autre Patron | Accéder à la boutique A | Refus |
| FIN-01 | Vendeur A1 actif | Créer dette avec client/vente d'une autre boutique | Refus |
| FIN-02 | Vendeur A1 actif | Créer paiement sur dette inexistante ou étrangère | Refus |
| FIN-03 | Vendeur A1 actif | Envoyer montant négatif, nul, texte ou montant incohérent | Refus |
| FIN-04 | Vendeur A1 actif | Lire un produit contenant coût/marge/prix d'achat | À bloquer ou données privées séparées |
| PATRON-01 | Patron A | Suspendre sa boutique | Autorisé selon procédure explicite |
| PATRON-02 | Patron A après suspension | Réactiver sa boutique par une procédure sûre | À définir et tester ; ne pas laisser le Patron bloqué |
| QUERY-01 | Compte non membre | Lister les documents d'une collection de A | Refus |
| QUERY-02 | Vendeur A1 | Lister les données d'une autre boutique ou via collectionGroup | Refus |
| AUDIT-01 | Vendeur A1 | Modifier/supprimer un événement d'audit | Refus |
| AUDIT-02 | Vendeur A1 | Créer un événement avec acteur ou boutique falsifié | Refus |

### Défauts connus que les tests doivent mettre en évidence

- `isActiveShopMember(shopId)` ne vérifie pas explicitement le rôle `seller`, l'égalité entre l'UID du membre et l'UID authentifié, ni la concordance du Patron dans la fiche membre.
- `isShopSeller(shopId)` existe mais n'est pas utilisé par `canUseShop` et `canWriteShop`.
- Les règles autorisent la lecture complète des documents produits pour les membres actifs : les règles Firestore ne masquent pas certains champs d'un document. Les coûts et marges doivent être séparés dans des documents/collections réservés au Patron.
- La création des ventes, dettes, clients et paiements ne vérifie pas encore toutes les références croisées ni les invariants financiers.
- Les mises à jour Patron des ventes et paiements ne disposent pas encore d'une liste stricte de champs modifiables et de contrôles financiers complets.
- La suspension de la boutique peut empêcher le Patron de la réactiver avec la règle de mise à jour actuelle, car `canWriteShop` exige déjà le statut actif.
- Le journal d'audit est protégé contre modification/suppression, mais sa création n'est pas encore strictement validée et reste initiée par le client.

### Critères d'acceptation avant activation

- Tous les tests AUTH, ISO, SHOP, SELL, FIN, PATRON, QUERY et AUDIT passent dans l'émulateur.
- Les tests négatifs échouent bien avec `permission-denied`, et aucun test ne passe simplement parce que les données de test sont absentes.
- Les règles vérifient l'identité, le rôle, le statut, le Patron et les références métier depuis les documents faisant autorité.
- Les documents contenant coûts, marges et informations financières réservées au Patron ne sont pas lisibles par un Vendeur.
- Les lectures de listes, requêtes et sous-collections sont testées, pas seulement les lectures par identifiant.
- La migration des données et le parcours opérationnel de l'application sont testés séparément des règles.
- Aucun déploiement de règles en production avant validation complète et autorisation explicite.

**Statut :** plan préparatoire documenté ; tests non exécutés ; règles non modifiées ; aucun déploiement.


## Correction des contrôles d'appartenance Patron / Vendeur — 26 novembre 2026

- Correction apportée à `firestore.rules`, fonction `isActiveShopMember(shopId)`.
- Un membre n'est désormais reconnu comme Vendeur actif que si son document contient les champs requis `uid`, `role`, `active`, `assignedBy`, avec `uid == request.auth.uid`, `role == 'seller'`, `active == true` et `assignedBy == shopData(shopId).patronUid`.
- Le statut de la boutique doit rester actif et l'abonnement du Patron doit être valide.
- Cette fonction est utilisée par les contrôles d'accès partagé : la correction renforce donc les lectures/écritures déléguées aux membres actifs sans ouvrir les données aux autres comptes.
- Les documents d'affectation historiques incomplets ou dont l'auteur n'est pas le Patron seront refusés jusqu'à correction contrôlée de leurs données. Ne pas les réécrire automatiquement.
- Limite restante : `isShopSeller(shopId)` est conservée et doit être vérifiée dans l'ensemble des règles; les autres défauts recensés (champs financiers produits lisibles, références croisées, validation des montants, réactivation après suspension) ne sont pas corrigés par ce changement.
- Vérifications effectuées après relecture des fichiers : présence statique des quatre contrôles d'identité/rôle/état/Patron ; compilation des scripts de `application.html` ; comparaison de branche avec `main`.
- Aucun test Firebase Emulator, aucune écriture Firestore réelle, aucun déploiement de règles et aucun test navigateur n'ont été exécutés.

**Statut :** correction source enregistrée sur la branche de travail uniquement ; à valider dans Firebase Emulator avant toute publication.
