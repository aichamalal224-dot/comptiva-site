# COMPTIVA — intégration multi-boutiques, rôles et sécurisation

## Statut

## Correction — génération du cycle vérifiée pendant la déconnexion — 26 novembre 2026

- `krediMarkSellerDisconnected()` capture désormais `krediPresenceRunEpoch` et l'inclut dans son contrôle `isCurrent()`.
- Une déconnexion différée qui attend une écriture précédente est donc abandonnée si le suivi de présence a été arrêté puis redémarré entre-temps, même pour le même compte et la même boutique.
- Cela ne peut pas annuler une écriture Firestore déjà soumise au serveur ; le heartbeat du cycle courant reste nécessaire pour rétablir le signal actif.
- Cette correction réduit une course locale, mais ne résout pas le document de présence partagé entre plusieurs appareils. La présence par session reste à implémenter et tester.

## Correction atomique — suspension/réactivation vendeur — 26 novembre 2026

- La fonction `krediSetSellerActive()` utilise maintenant un `WriteBatch` pour modifier ensemble le document membre, l'index privé et l'événement d'audit.
- La règle de l'index utilise `getAfter()` pour vérifier le statut final du document membre au sein de la même écriture groupée.
- Si une écriture est refusée, les trois opérations sont rejetées ensemble : plus de fenêtre où le membre est modifié sans index correspondant, ni de succès sans trace d'audit.
- La fonction continue de relire le magasin, le membre et l'index depuis le serveur avant d'autoriser l'action.
- Vérification effectuée ici : cohérence statique des trois écritures et compilation JavaScript. À confirmer avec Firebase Emulator/Firestore réel avant publication.


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


## Audit des données financières des produits — 26 novembre 2026

### Schéma produit actuellement utilisé

Inspection de `application.html` sur la branche de travail (blob `application.html` SHA `9e1a18c2b778f08a232f394f0a887bb4ee521713`) :

- Le formulaire de création de produit demande `name`, `category`, `sku`, `quantity`, `purchasePrice`, `salePrice` et `alertAt`.
- `saveForm()` enregistre `purchasePrice` et `salePrice` directement dans chaque objet de `db.products`, avec les métadonnées d'auteur.
- `renderStock()` affiche actuellement au même endroit le prix d'achat, le prix de vente et la marge théorique calculée comme `salePrice - purchasePrice`.
- Le modèle de données local et le document cloud historique conservent la base complète `db` ; les données historiques des produits peuvent donc contenir ces champs financiers.
- Les occurrences de `purchasePrice` et `salePrice` dans l'application examinée sont limitées au formulaire, à l'enregistrement du produit et à l'affichage du stock. Aucune migration de ces champs vers une collection privée n'est implémentée.

### Portée réelle de l'exposition

- Les données historiques sont enregistrées dans le document privé `users/{uid}/comptivaData/main`. La règle héritée du fichier `firestore.rules` limite sa lecture au compte dont l'UID correspond au chemin. L'audit statique ne révèle donc pas d'ouverture de ce document historique aux autres UID.
- Le nouveau modèle prévoit `shops/{shopId}/products/{productId}`. La règle actuelle `allow read: if canUseShop(shopId)` autorise le Patron et le Vendeur reconnu à lire le document produit entier ; Firestore Rules ne peut pas cacher `purchasePrice` ou d'autres champs à l'intérieur d'un document déjà lisible.
- Dans `application.html`, la lecture directe de `shops/{shopId}/products/{productId}` repérée appartient au contrôle de relation en lecture seule. L'audit n'a trouvé aucune écriture opérationnelle directe vers `shops/{shopId}/products`. Le modèle multi-boutiques demeure non migré et non démontré en production : l'exposition des champs financiers dans les collections partagées est donc un risque de conception à traiter avant l'activation, et non la preuve qu'un Vendeur les lit actuellement.
- Les produits restent aussi dans le magasin local et le document cloud historique propre à chaque UID. Ne pas confondre ces données privées historiques avec les futures collections partagées.

### Décision de sécurité et migration recommandée

Ne pas retirer ou renommer immédiatement `purchasePrice` dans la base historique : cela casserait l'affichage actuel de la marge et pourrait faire perdre l'information de coût nécessaire aux rapports du Patron.

Avant toute migration multi-boutiques :
1. Garder dans `shops/{shopId}/products/{productId}` uniquement les informations que le Vendeur est autorisé à lire : identifiant, nom, catégorie, référence, quantité, seuil d'alerte et prix de vente si la politique commerciale l'autorise.
2. Placer le coût d'achat unitaire, la marge, le bénéfice et toute autre donnée financière réservée au Patron dans un document séparé, par exemple `shops/{shopId}/productFinancials/{productId}`, avec lecture réservée au Patron. Ne jamais recopier ces champs dans le document produit partagé.
3. Ajouter des contrôles de rôle côté interface pour masquer les écrans et calculs financiers au Vendeur, sans considérer l'interface comme une protection suffisante.
4. Définir une migration idempotente qui conserve les valeurs historiques, vérifie les correspondances par ID produit et signale les données manquantes ou ambiguës sans inventer de coût.
5. Tester avec Firebase Emulator les lectures directes, listes et requêtes : Vendeur autorisé sur le document produit public mais refusé sur `productFinancials` ; Patron autorisé sur les deux ; compte extérieur refusé sur les deux.
6. Ne lancer aucune migration ni publication avant sauvegarde, tests Emulator et autorisation explicite.

### Vérifications réalisées pour cette passe

- Champs sensibles repérés dans le formulaire, l'objet enregistré et le rendu du stock.
- Règle de lecture des produits partagés vérifiée statiquement : `canUseShop(shopId)`.
- Aucune écriture applicative directe vers la collection partagée `products` trouvée ; la lecture directe observée est dans un contrôle de relation en lecture seule.
- Les trois blocs JavaScript de `application.html` compilent avec `new Function` : 3/3 réussis.
- Aucune donnée Firestore réelle consultée ou modifiée ; aucun test Emulator, test navigateur ou test avec comptes Patron/Vendeur réalisé.
- Aucun changement de code, aucune migration, aucun déploiement et aucun changement de `main` effectués pendant cette passe.

**Statut :** risque de conception identifié et documenté ; séparation financière non implémentée. La correction doit être intégrée au moment de la migration multi-boutiques, avec séparation physique des documents et validation Emulator.


## Audit des références financières et des règles multi-boutiques — 26 novembre 2026

### Contrôles déjà présents dans l'application locale

Inspection de `application.html` :

- La création locale d'une vente valide une quantité positive, un prix unitaire entier positif, un total entier positif et, pour un paiement mixte, l'égalité entre les parts espèces/mobile et le total.
- Une vente à crédit exige un client présent dans `db.clients`.
- La création d'une dette exige un client existant et un montant entier positif.
- La création d'un remboursement exige une dette active, une date valide, un montant entier positif et un montant qui ne dépasse pas le solde calculé.
- `krediDebtRelationIssue()` contrôle l'existence du client de la dette et, si elle est issue d'une vente, l'existence de cette vente, la cohérence du client, le montant du crédit et le statut de la vente.
- `krediPaymentActionCheck()` contrôle l'identifiant unique du remboursement, la date, le montant, la dette active, la relation client/vente et le total des remboursements.
- `saleFinancialAmounts()` vérifie les montants entiers, l'égalité encaissé + crédit = total, la cohérence quantité × prix unitaire et les parts d'un paiement mixte.
- Ces validations sont des contrôles applicatifs locaux. Elles ne remplacent pas les règles Firestore : un appel direct à l'API peut les contourner si les règles serveur n'imposent pas les mêmes invariants.

### Défauts constatés dans les règles Firestore du modèle partagé

Inspection de `firestore.rules` :

1. **Ventes — création insuffisamment validée :** la règle exige seulement un `shopId` égal au chemin et `createdBy == request.auth.uid`. Elle ne valide pas les types et bornes de `total`, `quantity`, `unitPrice`, `paidAmount`, `creditAmount`, les parts espèces/mobile, le client ou le produit référencé.
2. **Dettes — référence client non vérifiée :** la règle de création vérifie seulement `shopId`. Elle ne vérifie ni l'existence de `clientId` dans la même boutique, ni le montant positif entier, ni la cohérence éventuelle avec une vente d'origine.
3. **Paiements — dette non vérifiée :** la règle de création exige `shopId` et `createdBy`, mais ne vérifie pas l'existence de `debtId` dans la même boutique, le montant positif entier, la date, le solde restant ou l'absence de surpaiement.
4. **Mises à jour Patron trop larges :** les mises à jour de ventes, dettes et paiements préservent certains champs `shopId`/auteur, mais ne limitent pas les autres champs modifiables par `diff().affectedKeys().hasOnly(...)`. Les invariants financiers peuvent être contournés par une écriture directe.
5. **Références croisées :** les règles ne valident pas les références entre ventes, clients, dettes, paiements et produits dans le périmètre de la même boutique. Un document peut être créé avec une référence absente ou étrangère si les autres conditions minimales sont satisfaites.

### Incompatibilité importante entre le modèle applicatif et les règles partagées

- `krediActorStamp()` produit les champs `createdByUid`, `createdByName`, `createdAt` et `updatedAt`.
- La création de vente et de paiement dans `application.html` utilise ce tampon d'auteur ; l'audit n'a trouvé aucune affectation `createdBy:` dans le code.
- Les règles de création partagée de `sales` et `payments` exigent pourtant `request.resource.data.createdBy == request.auth.uid`.
- Les objets opérationnels locaux ne montrent pas non plus l'ajout systématique de `shopId` dans les ventes, dettes et paiements créés par `saveForm()`, alors que les règles partagées l'exigent.
- **Conséquence :** le code actuel et les règles du modèle partagé ne sont pas encore compatibles pour ces écritures. Cela constitue un blocage de migration à résoudre explicitement, pas une raison d'ajouter un champ auteur arbitraire ni de desserrer les règles.
- Le champ `createdBy` ne doit jamais être déduit du nom affiché ou attribué à l'auteur actuel lors d'une migration d'historique. Les UID d'auteur historiques manquants ou différents doivent rester signalés et faire l'objet d'une décision explicite.

### Correction d'architecture recommandée avant activation

1. Définir un schéma serveur exact par collection : champs obligatoires, champs optionnels, types, bornes, champs immuables et valeurs de statut autorisées.
2. Valider les relations avec les documents de la même boutique : vente → client/produit ; dette → client/vente ; paiement → dette. Vérifier aussi que la dette n'est pas annulée et que le total payé après opération ne dépasse pas son montant.
3. Pour garantir l'absence de surpaiement en cas de paiements simultanés, ne pas compter uniquement sur une somme lue côté client ou sur une règle isolée. Concevoir une opération atomique transactionnelle ou un backend de confiance avec contrôle de concurrence.
4. Limiter les mises à jour Patron à des champs précis et préserver les identifiants, l'auteur initial, la boutique, les relations et les preuves d'audit.
5. Définir un contrat de migration explicite pour `createdByUid` / `createdByName` et `shopId`. Aucun UID, boutique ou relation manquante ne doit être inventé.
6. Ajouter les tests Emulator FIN-01 à FIN-04 et des cas supplémentaires : paiement concurrent, dette annulée, client d'une autre boutique, vente étrangère, montant décimal/négatif/nul, tentative de modification du montant et de l'auteur par le Patron.
7. Conserver le fonctionnement historique `users/{uid}/comptivaData/main` jusqu'à validation complète du nouveau modèle.

### Vérifications et limites de cette passe

- Les fonctions locales de validation de vente, dette et remboursement ont été inspectées ; elles sont plus complètes que les règles du modèle partagé.
- Les règles de création et mise à jour de `sales`, `debts`, `payments` ont été relues.
- L'incompatibilité `createdByUid` (application) / `createdBy` (règles) et l'absence d'ajout systématique de `shopId` dans les objets locaux sont confirmées par lecture statique.
- Aucune règle, application ou donnée Firestore n'a été modifiée pendant cette passe.
- Aucun test Emulator, transaction concurrente, navigateur ou compte Patron/Vendeur réel n'a été exécuté.
- Aucun déploiement, migration ou changement de `main` effectué.

**Statut :** contrôles locaux utiles, mais validation serveur des références et montants insuffisante ; incompatibilité de contrat entre code actuel et règles multi-boutiques identifiée. La migration ne doit pas être activée avant définition du schéma, correction du contrat et tests Emulator.


## Audit des rôles Patron / Vendeur dans l’interface — 26 novembre 2026

### Périmètre relu

- application.html : navigation latérale et mobile, navigate(), rendu des pages, actions de modification/annulation des ventes, dettes, remboursements, achats et dépenses, export CSV, gestion des vendeurs et diagnostics de rôle.
- firestore.rules : règles du modèle historique par UID et du modèle partagé shops/{shopId}.
- Références relues : application.html blob SHA 9e1a18c2b778f08a232f394f0a887bb4ee521713 ; firestore.rules blob SHA f1ec4e215cd74b0ee82f21923f5fba276ed28906.

### Constat sur l’interface actuelle

1. Navigation sans séparation Patron/Vendeur : les menus présentent Ventes, Profil, Stock, Chiffres, Clients, Dettes, Remboursements, Achats, Dépenses et Rappels. navigate(page) bloque l’Espace Créateur pour les autres comptes et applique le verrou d’abonnement, mais ne résout pas le rôle Patron/Vendeur et n’interdit pas les pages réservées au Patron.
2. Aucun état de rôle global établi : l’application contient des contrôles ponctuels dans le diagnostic de boutique et la présence vendeur, mais l’audit n’a pas trouvé de rôle métier global exploité par la navigation et les actions de l’application.
3. Actions directement appelables : editSale, cancelSale, editDebt, cancelDebt, editPayment, cancelPayment, editPurchase, cancelPurchase, editExpense et cancelExpense ne montrent pas de contrôle explicite du rôle Patron avant leurs opérations locales. Elles contiennent des validations métier et certaines vérifications de session/sauvegarde, mais celles-ci ne constituent pas une autorisation par rôle.
4. Export de données : exportCSV() n’effectue pas de vérification de rôle visible et inclut ventes, dettes, achats et dépenses. Un vendeur qui disposerait de ces données dans son état local pourrait déclencher directement l’export.
5. Données financières dans l’interface : les vues des chiffres, achats, dépenses et stock ne sont pas filtrées par rôle dans la navigation actuelle. Le stock affiche aussi prix d’achat et marge théorique dans le modèle local.
6. Gestion des vendeurs : les fonctions d’affectation et de suspension vérifient plusieurs conditions de propriété Patron côté client. Ces contrôles utiles ne remplacent pas les règles Firestore et ne constituent pas un système général de permissions UI.

### Ce que les règles Firestore du modèle partagé imposent actuellement

- Vendeur actif : lecture des ventes, clients, dettes, paiements et produits ; création de ventes, clients, dettes et paiements selon les conditions actuelles.
- Patron uniquement : modification des ventes, dettes et paiements ; suppression des clients ; écriture des produits/stock ; lecture et écriture des achats et dépenses ; lecture des rapports ; lecture du journal d’audit.
- Les écritures de vente et de paiement restent soumises à des champs obligatoires shopId et/ou createdBy que le modèle local actuel ne renseigne pas systématiquement. Les défauts de validation financière et de références croisées sont documentés dans l’audit financier précédent.
- Les règles du modèle partagé ne protègent que les opérations réellement dirigées vers shops/{shopId}/... .

### Limite majeure : modèle partagé non activé dans l’application

Le document historique users/{uid}/comptivaData/main reste limité à son propre UID. Le code applicatif conserve son modèle de base local par compte ; l’audit n’a pas établi de parcours complet qui charge les données d’une boutique partagée selon le rôle du vendeur. Il ne faut donc ni conclure qu’un vendeur réel accède aux données du Patron, ni présenter la séparation multi-boutiques comme déjà opérationnelle. Un compte vendeur connecté avec son propre UID reste dans son périmètre historique tant qu’une migration partagée n’est pas effectivement réalisée.

### Décision et corrections nécessaires avant migration

1. Construire un résolveur de rôle serveur vérifié après connexion : Patron propriétaire ou Vendeur actif, avec vérification concordante de l’index, de la boutique et du document membre. En cas d’ambiguïté ou d’échec réseau, refuser par défaut les fonctions réservées au Patron.
2. Définir une matrice de permissions unique : le Vendeur ne voit pas les bénéfices/marges, achats, dépenses, rapports ni gestion des vendeurs ; il ne peut ni modifier/annuler une vente validée, ni modifier/annuler dette ou remboursement si la politique retenue les réserve au Patron. Les actions autorisées au Vendeur doivent être nommées précisément.
3. Appliquer ces permissions à la navigation, au rendu, aux boutons, à chaque fonction globale appelable directement et à chaque ouverture de formulaire. Le masquage visuel seul ne suffit pas.
4. Maintenir Firestore Rules comme autorité finale : tests négatifs directs sur les chemins partagés pour chaque collection, y compris get/list, création, update et delete.
5. Séparer les coûts, marges et bénéfices dans des documents Patron-only avant de partager les documents produits ; ne pas compter sur un filtrage JavaScript pour cacher les champs.
6. Ne pas changer le modèle historique UID ni migrer les données avant contrat de schéma, migration idempotente, sauvegarde et tests Emulator.

### Vérifications et limites de cette passe

- Contrôle statique des entrées de navigation, de navigate(), des actions métier et des règles Firestore.
- Les trois blocs JavaScript de application.html compilent avec new Function : 3/3 réussis.
- Aucun code applicatif ni règle Firestore modifié pendant cette passe ; seule cette note d’audit est ajoutée.
- Aucun test Firebase Emulator, navigateur, connexion réelle Patron/Vendeur ou appel direct Firestore exécuté.
- Aucune migration, écriture de données réelles, publication ou modification de main.

**Statut :** défaut d’autorisation par rôle dans l’interface confirmé par lecture statique. La séparation serveur du futur modèle partagé est partiellement décrite dans les règles, mais le contrat applicatif et la migration ne sont pas prêts. Ne pas activer le multi-boutiques avant la mise en place de la matrice de permissions et les tests Emulator.


## Première correction des contrôles Patron / Vendeur dans l’interface — 26 novembre 2026

### Modifications appliquées à application.html

- Ajout d’un état de rôle distinct de la session Firebase. Il reste inconnu tant que la lecture serveur des affectations n’a pas abouti.
- Ajout d’un résolveur serveur qui lit l’index privé userShopMemberships/{uid}/shops, puis vérifie la boutique et le document membre vendeur : UID, rôle seller, état actif, ownerUid/patronUid concordants et assignedBy égal au Patron propriétaire.
- Plusieurs affectations vendeur, affectation inactive, incohérence des documents, absence de Firestore ou échec de lecture ne donnent jamais les droits Patron. Les fonctions Patron restent bloquées en cas de rôle non confirmé.
- Les comptes sans affectation vendeur dans l’index serveur conservent le mode historique Patron, afin de ne pas casser les comptes commerçants existants. Le compte Créateur est traité séparément.
- Navigation réservée au Patron pour Profil du commerce (qui contient aussi la gestion des vendeurs), Chiffres, Achats et Dépenses.
- Contrôle ajouté à l’ouverture et à l’enregistrement des formulaires Produit, Achat et Dépense.
- Contrôle direct ajouté aux fonctions de modification/annulation des ventes, dettes, remboursements, achats et dépenses, ainsi qu’à l’export CSV. Les contrôles ne reposent donc pas uniquement sur la présence des boutons.
- Pour le rôle vendeur confirmé, le tableau Stock n’affiche plus le prix d’achat ni la marge théorique ; il conserve le nom, la catégorie, la quantité et le prix de vente.
- Le tableau de bord masque les montants d’achats, dépenses et l’indicateur CA − achats − dépenses pour les comptes qui ne disposent pas du rôle Patron confirmé.
- À la déconnexion, l’état du rôle est réinitialisé.

### Limites importantes

- Cette correction est une protection de l’interface et des fonctions JavaScript ; elle n’est pas une frontière de sécurité serveur. Le contrôle final des données du futur modèle partagé reste dans Firestore Rules.
- Le modèle partagé n’est toujours pas migré dans l’application : le vendeur n’accède pas encore au jeu de données commun de la boutique. Les opérations locales historiques restent stockées dans users/{uid}/comptivaData/main.
- Les règles Firestore du chemin historique autorisent le propriétaire de chaque UID à écrire dans son propre espace ; les guards de l’interface ne peuvent pas empêcher un utilisateur de modifier son propre stockage local ou d’appeler directement l’API sur son propre chemin.
- Les comptes sans affectation vendeur sont considérés Patron historique, selon le modèle actuel. Une migration vers un rôle Patron explicitement enregistré sera nécessaire avant activation complète des boutiques partagées.
- Les actions de création de vente, client, dette et remboursement restent possibles pour un vendeur ; les modifications/annulations sont Patron-only. Les opérations de stock liées à la vente restent dans l’ancien modèle local et devront être migrées vers une opération serveur/transaction atomique avant activation multi-boutiques.
- Une erreur de résolution de rôle bloque les actions Patron, mais le test réel de ce comportement exige Firebase Emulator et deux comptes de test.

### Vérifications effectuées

- Relecture du fichier après écriture et contrôle des guards présents sur les pages, formulaires et fonctions directes.
- Les trois blocs JavaScript de application.html compilent avec new Function : 3/3 réussis après correction d’une erreur de syntaxe détectée pendant la première vérification.
- Aucun test Firebase Emulator, test navigateur, compte réel Patron/Vendeur ou appel direct Firestore exécuté.
- Aucun changement des règles Firestore, aucune migration ni donnée réelle modifiée. Aucun déploiement et aucune modification de main.

**Statut :** première barrière UI Patron/Vendeur ajoutée. À valider ensuite avec Emulator et tests de non-régression ; ne pas considérer cette correction comme une autorisation serveur ni comme l’activation du multi-boutiques.

## Porte de sécurité avant séparation effective des coûts produits — 26 novembre 2026

### Décision technique après relecture du code et des règles

La séparation des coûts et marges ne doit pas être implémentée par une simple création de collection Firestore ou par un changement isolé de règle.

Constats vérifiés sur la branche de travail :

- Le formulaire Produit et `saveForm()` enregistrent actuellement `purchasePrice` et `salePrice` dans le même objet `db.products`.
- `db.products` est conservé dans le modèle local historique chargé depuis le stockage du compte ; l'application continue d'utiliser ce modèle pour le stock, les ventes, les achats et les contrôles de cohérence.
- Aucun parcours applicatif d'écriture vers `shops/{shopId}/products` ni vers `shops/{shopId}/productFinancials` n'a été trouvé.
- Les règles partagées actuelles autorisent la lecture des documents `shops/{shopId}/products/{productId}` à tout membre autorisé de la boutique. Firestore renvoie le document entier : il ne filtre pas les champs individuels.
- Les règles partagées bloquent déjà les écritures directes vendeur dans `products`, mais cela ne protège pas un champ financier qui serait présent dans un document produit lisible.
- Le modèle multi-boutiques reste explicitement non activé dans l'application. Les chemins historiques `users/{uid}/comptivaData/main` doivent être préservés.

### Pourquoi aucune règle partielle n'est ajoutée maintenant

1. Ajouter `productFinancials` sans écrire ni lire cette collection dans l'application créerait une séparation fictive : le coût continuerait à être enregistré dans l'objet produit historique.
2. Interdire immédiatement la lecture vendeur des documents produits qui contiennent un champ sensible pourrait rendre les lectures/listes de stock impossibles pour des documents existants. Les règles Firestore ne filtrent pas automatiquement les documents d'une requête.
3. Autoriser simplement la lecture vendeur des produits sans migration préalable laisserait fuiter les coûts si un document partagé contenait encore `purchasePrice` ou un autre champ financier.
4. Supprimer `purchasePrice` des objets historiques risquerait de casser les rapports Patron, les calculs de marge, les achats et les contrôles de stock ; aucune suppression ou conversion automatique n'est autorisée.

**Conclusion :** la modification isolée des règles serait soit insuffisante pour la confidentialité, soit susceptible de casser le stock vendeur. Aucune règle, aucun document Firestore et aucune donnée produit ne sont modifiés dans cette passe.

### Correction intégrée obligatoire avant activation du partage des produits

La prochaine implémentation doit former un seul ensemble cohérent :

1. Définir un document public `shops/{shopId}/products/{productId}` avec une liste blanche de champs non financiers : identifiant, nom, catégorie, référence, quantité, seuil d'alerte, prix de vente si la politique le permet, et métadonnées non sensibles strictement nécessaires.
2. Définir `shops/{shopId}/productFinancials/{productId}`, accessible au Patron uniquement, pour le coût d'achat et les autres données financières nécessaires. La marge doit être calculée à partir des valeurs autorisées plutôt que copiée dans le document public.
3. Adapter le formulaire Produit, `saveForm()`, le rendu Stock, les ventes, les achats, les corrections de stock, les rapports et les exports pour lire/écrire les deux documents selon le rôle. Le vendeur ne doit jamais recevoir le document financier.
4. Prévoir une migration idempotente par ID produit depuis les données historiques, avec sauvegarde, vérification des doublons et correspondances, conservation des valeurs d'origine et signalement des valeurs manquantes. Ne jamais inventer un coût.
5. Préserver le mode historique par UID jusqu'à validation de la migration et des tests ; ne pas basculer automatiquement les comptes existants.
6. Ajouter les tests Firebase Emulator : Patron lit/écrit les deux documents ; vendeur lit le document public mais reçoit un refus sur `productFinancials` ; vendeur ne peut pas injecter un champ financier dans le document public ; compte extérieur refusé ; documents historiques non migrés traités sans fuite ; requêtes de liste du stock autorisées uniquement sur le schéma public migré.
7. Rejouer les tests de non-régression sur ventes, achats, annulations, remboursements, stock, rapports, export et synchronisation hors ligne avant toute activation.

### Vérifications de cette passe

- Relecture de `application.html`, `firestore.rules` et de la documentation de migration sur la branche de travail.
- Champs `purchasePrice` / `salePrice`, écriture locale de produit et rendu stock identifiés.
- Aucune écriture applicative vers les collections partagées `products` ou `productFinancials` trouvée.
- Aucune modification de code ou de règles Firestore ; aucune migration, lecture ou écriture de données réelles, aucun test Emulator ou navigateur, aucun déploiement.
- `main` n'a pas été modifiée.

**Statut :** risque confirmé ; correction intégrée bloquée par l'absence du parcours applicatif multi-boutiques. Ne pas déclarer les coûts protégés côté serveur avant implémentation et tests de la séparation physique des documents.

## Cartographie des dépendances avant migration des produits — 26 novembre 2026

### Flux de création d'un produit

- `openForm('product')` présente nom, catégorie, référence, quantité initiale, `purchasePrice`, `salePrice` et seuil d'alerte.
- `saveForm()` valide les deux prix comme entiers GNF, puis ajoute un objet contenant les deux champs dans `db.products`.
- L'enregistrement passe par le mécanisme général `saveDB()` : stockage local du compte, puis synchronisation cloud historique selon l'état de session et de synchronisation.
- Aucun identifiant de boutique partagée n'est associé au produit dans ce flux historique.

### Flux de vente et lien produit

- La vente saisit un nom d'article, une quantité et un prix unitaire manuellement.
- Le total est calculé par quantité × prix unitaire ; les contrôles espèces/mobile/crédit s'appliquent au total.
- Le lien de stock est recherché par correspondance du nom normalisé du produit. Si trouvé, la quantité est décrémentée, `stockProductId`, la date et la quantité déduite sont inscrits dans la vente et un mouvement `sale_deduction` est ajouté au journal.
- Le prix de vente catalogue `product.salePrice` n'est pas automatiquement utilisé comme prix unitaire de la vente dans le flux inspecté. Il faut préserver ce comportement ou définir explicitement une future règle de prix avant toute refonte.
- La vente conserve son propre `unitPrice` et son total historique ; ces valeurs ne doivent jamais être recalculées depuis le prix catalogue courant lors d'une migration.

### Flux d'achat et coût unitaire

- L'achat saisit une description, une quantité et un montant total.
- Le lien vers un produit de stock se fait par égalité du nom de l'article (insensible à la casse) ; si trouvé et quantité positive, le stock est augmenté et le mouvement `purchase_addition` est journalisé.
- Le document d'achat conserve `amount` (montant total) et `quantity`, mais le flux inspecté ne calcule pas de coût unitaire moyen et ne met pas à jour `product.purchasePrice`.
- Par conséquent, `purchasePrice` du produit représente le coût renseigné lors de la création/édition du produit, et ne doit pas être interprété sans vérification comme le coût moyen réel du stock courant.
- Les achats, leurs montants et leurs traces de stock constituent un historique financier distinct ; ils ne doivent pas être déplacés ou fusionnés dans le document public du produit.

### Rapports, stock et journal

- `renderStock()` lit `db.products` ; le Patron voit `purchasePrice` et une marge théorique `salePrice - purchasePrice`, le vendeur ne voit pas ces colonnes dans l'interface.
- Cette marge est une différence entre deux valeurs catalogue actuelles, pas un bénéfice comptable réalisé sur les ventes.
- `renderPurchases()` agrège les montants des achats et conserve les détails d'achat ; les rapports de ventes utilisent les prix réellement saisis dans chaque vente.
- `krediStockConsistencyAudit()` contrôle les liens produit/vente/achat et les mouvements horodatés (déduction, ajout, ajustement, restauration et retrait à l'annulation). Les traces historiques absentes ne doivent pas être inventées ou reconstituées automatiquement.
- Les rapports financiers et exports doivent rester Patron-only et continuer à utiliser les montants historiques des ventes, achats et dépenses.

### Contrat de migration à respecter

1. Migrer les produits par identifiant stable et conserver `name`, `category`, `sku`, `quantity`, `alertAt` et le prix catalogue autorisé dans le document public.
2. Migrer `purchasePrice` dans le document financier Patron-only, avec provenance indiquant qu'il s'agit du coût catalogue historique, et non d'un coût moyen calculé.
3. Conserver `sales.unitPrice`, `sales.total`, `purchases.amount`, `purchases.quantity`, les IDs, les statuts et les références de stock historiques sans recalcul.
4. Conserver séparément le journal de mouvements de stock et les relations `stockProductId`, `relatedSaleId`, `relatedPurchaseId`. Les identifiants de produits doivent rester stables.
5. Ne pas recalculer `purchasePrice` à partir de `purchases.amount / purchases.quantity` sans décision métier explicite : l'achat peut concerner plusieurs articles, contenir des frais, ou ne pas être lié à un seul produit.
6. Prévoir une décision produit sur l'évolution future du coût : coût catalogue manuel, dernier coût d'achat, ou coût moyen pondéré. Aucun de ces modèles ne doit être choisi implicitement.
7. Tester qu'une migration répétée ne crée ni double produit ni double mouvement, et qu'une annulation de vente/achat après migration garde les mêmes invariants de stock.

### Vérifications et limites

- Relecture ciblée des flux `openForm`, `saveForm`, vente, achat, `renderStock`, `renderPurchases`, `renderReports` et audit de cohérence du stock dans `application.html`.
- Aucune modification de `application.html` ni de `firestore.rules` dans cette passe.
- Aucune donnée réelle consultée ou modifiée ; aucun test Emulator ou navigateur ; aucune migration ou publication.
- Cette cartographie est fondée sur le code actuel de la branche et ne prouve pas le comportement d'un compte Firebase réel.

**Statut :** dépendances principales identifiées. La séparation technique peut maintenant être conçue sans confondre coût catalogue, montant d'achat et prix réel d'une vente.


## Audit complémentaire des autorisations Firestore multi-boutiques — 26 novembre 2026

### Constats confirmés à la lecture de firestore.rules

1. **Accès Patron non conditionné à l'abonnement pour certaines lectures.** `canUseShop(shopId)` renvoie vrai pour `isShopPatron(shopId)` sans vérifier l'abonnement ni le statut actif de la boutique. Cette fonction protège notamment la lecture du document racine de boutique, des produits, des ventes, clients, dettes et paiements. En conséquence, un Patron dont l'abonnement a expiré, ou dont la boutique est suspendue, conserve certaines lectures. Les écritures Patron passent en revanche par `canWriteShop`, qui vérifie le statut actif et l'abonnement.
2. **Lectures de gestion accessibles au Patron même sans abonnement actif.** La lecture des membres et de la présence est autorisée avec `isShopPatron` seul. Il faut décider explicitement si l'accès aux données d'administration doit être maintenu après expiration/suspension, et appliquer une politique cohérente.
3. **Schéma des produits partagé non verrouillé.** Les créations et mises à jour de `shops/{shopId}/products/{productId}` sont réservées au Patron, mais les règles ne limitent pas les clés autorisées dans `request.resource.data`. Comme Patron et vendeur peuvent lire le document produit entier via `canUseShop`, un champ financier ajouté par erreur dans ce document serait lisible par le vendeur. La séparation physique des documents financiers et la liste blanche des champs publics restent indispensables.
4. **Validations métier insuffisantes sur les écritures partagées.** Les créations de ventes vérifient `shopId` et `createdBy`, mais pas une liste blanche de champs, les montants, les quantités, les modes de paiement ni les références client/produit. Les créations de dettes vérifient essentiellement `shopId`, sans valider montant, client ou vente source. Les créations de paiements vérifient `shopId` et `createdBy`, sans contrôler la dette, le montant, la date ni le solde restant.
5. **Mises à jour Patron trop larges.** Les règles de mise à jour des ventes, dettes et paiements ne définissent pas de liste blanche des champs modifiables ni les invariants financiers à préserver. Le fait de réserver ces écritures au Patron ne suffit pas à empêcher les incohérences accidentelles ou les modifications abusives depuis un client compromis.
6. **Achats et dépenses : schéma à durcir.** Les règles vérifient le rattachement au `shopId` et le rôle Patron, mais ne valident pas une liste blanche complète, les types, les montants, les dates ou les relations de stock.
7. **Journal d'audit : création insuffisamment contrainte.** La règle vérifie le `shopId` et `actorUid`, mais ne fixe pas une liste blanche d'événements, les types/champs obligatoires ni la cohérence de la cible. Les mises à jour et suppressions sont bien interdites.

### Points positifs conservés

- Les données historiques sous `users/{userId}/comptivaData/main` restent limitées au compte propriétaire.
- L'accès vendeur aux sous-collections partagées est borné par le chemin de la boutique et par une appartenance active, avec contrôle de l'abonnement du Patron.
- Les écritures vendeur dans les produits, achats, dépenses et rapports sont refusées par les règles actuelles.
- Les suppressions directes des ventes, dettes, paiements, achats et dépenses partagés sont refusées.
- Les documents d'audit partagés ne peuvent pas être modifiés ou supprimés après création.
- Aucun changement de règle n'est effectué pendant cet audit : la politique d'accès après expiration doit être décidée avant de corriger les conditions de lecture.

### Corrections prioritaires à planifier

1. Définir la politique d'accès après expiration et suspension, puis harmoniser `canUseShop`, les lectures Patron, les lectures de gestion et les écritures.
2. Définir des schémas stricts et des listes blanches de champs pour produits publics, documents financiers, ventes, dettes, paiements, achats, dépenses et événements d'audit.
3. Ajouter des validations de montants, dates, quantités, relations croisées et invariants financiers. Les paiements concurrents et les mutations de stock devront passer par un mécanisme atomique de confiance (transaction serveur ou backend).
4. Écrire des tests Firebase Emulator couvrant explicitement les cas autorisés et refusés, notamment abonnement expiré, boutique suspendue, vendeur actif/inactif, compte étranger, champs financiers injectés et incohérences de paiement.
5. Ne pas appliquer ces durcissements aux chemins historiques avant une stratégie de compatibilité et de migration vérifiée.

### Vérifications et limites de cette passe

- Relecture de la totalité du fichier `firestore.rules` de la branche de travail et rapprochement avec le modèle multi-boutiques documenté.
- Analyse statique uniquement : aucun test Firebase Emulator, aucun compte réel, aucune requête Firestore réelle et aucune migration exécutés.
- Aucune modification des règles Firestore, de l'application ou des données. Aucune publication et aucune modification de `main`.

**Statut :** audit statique des principales autorisations partagé complété pour cette passe. Les risques ci-dessus sont documentés et doivent être corrigés et testés avant activation du modèle multi-boutiques.


## Audit et garde-fous des affectations Patron/Vendeur — 26 novembre 2026

### Audit complémentaire des règles d'accès

- Le Créateur peut lire/écrire les documents `merchantSubscriptions` et lire/supprimer les entrées `merchantDirectory`. Ces droits sont concentrés sur l'UID Créateur fixé dans les règles.
- Le Créateur peut lire un document racine `shops/{shopId}` et les documents `members` explicitement autorisés, mais les règles ne lui donnent pas automatiquement accès à toutes les sous-collections opérationnelles (ventes, dettes, paiements, produits, achats, dépenses).
- Un commerçant peut lire uniquement son document d'abonnement par `get`; la lecture de liste n'est pas accordée. La création personnelle est limitée à un essai avec une durée maximale de 14 jours. La modification et la suppression sont réservées au Créateur.
- Les données historiques `users/{uid}/comptivaData/main` restent lisibles par le propriétaire même après expiration ; les écritures historiques sont bloquées si l'abonnement n'est pas actif, sauf compte Créateur. Ce comportement correspond à une conservation en lecture seule et doit être clairement expliqué dans l'interface.
- Le Patron conserve actuellement certaines lectures du modèle partagé même si l'abonnement est expiré ou si la boutique est suspendue. C'est une politique de lecture seule partielle à formaliser, pas une preuve d'accès complet : les vendeurs sont toujours contrôlés par l'appartenance active et l'abonnement Patron.
- Les règles de suspension du vendeur reposent sur deux documents synchronisés : `shops/{shopId}/members/{uid}` et `userShopMemberships/{uid}/shops/{shopId}`. Les deux doivent rester concordants.

### Défaut applicatif corrigé partiellement

- Les fonctions d'affectation et de suspension/réactivation vendeur sont désormais protégées dans l'interface par `krediRequirePatron(...)`, en plus des règles Firestore.
- L'affectation écrit encore le document membre puis l'index dans deux opérations séquentielles. La règle actuelle de l'index utilise `get(memberPath)` pour vérifier l'état du membre déjà persisté. Un lot atomique utilisant cette règle pourrait donc être refusé ; il ne faut pas le substituer à la séquence sans adapter la règle avec `getAfter()` et valider le comportement dans Emulator.
- La suspension/réactivation suit également une séquence membre puis index et signale explicitement si la seconde étape échoue. Dans ce cas, les documents peuvent temporairement diverger ; il faut contrôler/réparer les deux documents avant une nouvelle tentative.
- Une future correction robuste devra choisir entre une opération serveur de confiance et une écriture batch avec règles `getAfter()`, puis couvrir affectation, suspension, réactivation, rollback et reprise après échec dans Emulator.

### Vérifications de cette passe

- Relecture des règles d'abonnement, de l'index d'affectation, des documents membres et des fonctions applicatives d'affectation/suspension.
- Contrôle statique : garde Patron présente dans les deux fonctions ; ordre membre puis index conservé pour rester compatible avec les règles actuelles ; message d'erreur de désynchronisation conservé.
- Les trois blocs JavaScript de `application.html` compilent : 3/3.
- Aucun test Firebase Emulator, aucun test de comptes réels, aucune requête Firestore réelle, aucune migration et aucun déploiement.
- Les règles Firestore n'ont pas été modifiées ; les données réelles ne sont pas touchées ; `main` reste intacte.

**Statut :** garde UI Patron renforcée pour les affectations. La synchronisation des deux documents reste non atomique et constitue un risque connu, explicitement reporté jusqu'à adaptation des règles et tests Emulator.


## Correction de cohérence des affectations vendeurs — 26 novembre 2026

### Changement applicatif

- Avant suspension/réactivation, l'application lit maintenant côté serveur le document membre et l'index d'appartenance.
- Elle vérifie leur existence, leur UID, leur boutique, leur rôle, leur Patron assignant et la concordance de leur état `active`.
- Si les deux documents sont absents ou incohérents, l'opération s'arrête avant toute écriture et demande une réparation contrôlée.
- Après mise à jour du membre, si l'écriture de l'index échoue, l'application tente de restaurer l'état `active` initial du membre.
- Si le retour arrière échoue aussi, un message d'alerte explicite demande de ne pas réessayer et de vérifier les deux documents.
- Le garde de rôle Patron reste obligatoire.

### Limites

- Les écritures membre et index restent deux opérations distinctes, car la règle actuelle de l'index vérifie le membre déjà persisté via `get()`. Une solution atomique exige une adaptation de règle utilisant `getAfter()` ou un backend fiable, puis des tests Emulator.
- Le retour arrière est une compensation applicative, pas une transaction distribuée. Une panne réseau prolongée peut empêcher la compensation ; l'alerte et la vérification serveur restent nécessaires.
- L'écriture de l'événement d'audit se produit après la mise à jour des deux documents. Si elle échoue, le changement d'état reste appliqué et l'interface l'indique ; l'événement manquant devra être réconcilié.

### Vérifications

- Vérification statique du précontrôle des deux documents, de la concordance des champs et du retour arrière après échec de l'index.
- Compilation des trois blocs JavaScript de `application.html` après relecture : 3/3 réussie.
- Aucun test Firebase Emulator ou compte réel dans cette passe ; aucune règle Firestore ni donnée réelle modifiée ; aucun déploiement ; `main` intacte.


## Audit et correction des sessions Firebase et de la présence vendeur — 26 novembre 2026

### Risque identifié

Une initialisation asynchrone d'un compte pouvait se poursuivre après que l'utilisateur avait changé de compte ou s'était déconnecté. En particulier, la lecture de l'abonnement pouvait se terminer tardivement, puis l'ancien callback pouvait encore demander le démarrage du suivi de présence.

### Correction applicative

- Le callback d'authentification vérifie de nouveau son jeton de session (isCurrentSession) immédiatement après l'attente de la vérification d'abonnement, avant de démarrer la présence.
- Les erreurs de démarrage de présence ne sont journalisées que si le callback appartient toujours à la session courante.
- krediStartSellerPresence capture UID, instance Firestore et epoch de session dès son entrée.
- Après chaque lecture serveur asynchrone, la fonction vérifie que l'UID, l'instance Firestore et l'epoch sont toujours ceux de la session qui l'a lancée.
- Le suivi vendeur exige une résolution de rôle confirmée et le même shopId ; une présence ancienne ne peut pas installer un heartbeat après changement de session.
- Les lectures de boutique Patron vérifient aussi ownerUid et patronUid.
- Le heartbeat vérifie la session avant chaque écriture et ne se programme que si la session reste valide après le premier signal.

### Limites restantes

- Cette correction protège l'initialisation et les écritures de présence côté client, mais ne remplace pas les règles Firestore ni un contrôle serveur de chaque opération métier.
- Une présence déjà écrite peut rester visible jusqu'à expiration de sa fenêtre d'affichage si le navigateur est fermé brutalement ; le heartbeat s'arrête au prochain nettoyage local, mais aucune suppression serveur immédiate n'est garantie.
- L'authentification Firebase et la vérification d'abonnement ont été inspectées statiquement. Aucun test multi-compte réel, navigateur, Android/iOS, ni test Firebase Emulator n'a été exécuté dans cette passe.
- La déconnexion explicite continue de conserver les données locales et avertit lorsque la synchronisation n'est pas confirmée. Aucun changement au mécanisme de sauvegarde/déconnexion n'a été introduit ici.

### Vérifications après correction

- Compilation des trois blocs JavaScript de application.html après relecture du fichier final : 3/3 réussie.
- Règles Firestore non modifiées.
- Aucun compte réel, aucune donnée réelle, aucune migration et aucun déploiement modifiés.
- Branche de travail uniquement ; main reste intacte.


## Durcissement des règles : validation croisée membre + index vendeur — 26 novembre 2026

### Écart de sécurité identifié

La fonction Firestore isActiveShopMember vérifiait auparavant le document shops/{shopId}/members/{uid}, mais ne vérifiait pas le document d'index userShopMemberships/{uid}/shops/{shopId}. En cas de divergence, un index marqué inactif ou supprimé pouvait donc ne pas suffire à bloquer une requête directe si le document membre restait actif.

### Correction des règles dans la branche de travail

- isActiveShopMember exige désormais l'existence des deux documents.
- Le document membre doit confirmer UID, rôle seller, active=true et assignedBy égal au Patron propriétaire.
- L'index privé doit confirmer UID, shopId, rôle seller, active=true et patronUid égal au Patron propriétaire.
- Une absence, une suspension, un index obsolète ou un rattachement à un autre Patron fait échouer le contrôle d'accès vendeur.
- Les opérations partagées qui s'appuient sur canWriteShop ou canUseShop héritent de cette validation croisée.
- Les droits directs du Patron propriétaire restent séparés de ce contrôle vendeur.

### Conséquence pour les affectations

Pendant une réactivation séquentielle, le vendeur reste bloqué tant que les deux documents ne sont pas actifs et cohérents. Pendant une suspension, le passage du document membre à inactive suffit à bloquer le vendeur, même si l'index n'a pas encore été mis à jour. Cette règle réduit l'effet d'une divergence, sans rendre les deux écritures atomiques.

### Tests et publication

- Cette modification concerne le fichier de règles dans la branche GitHub uniquement.
- Elle n'a pas été déployée dans Firebase.
- Les tests Firebase Emulator doivent confirmer les cas : deux documents actifs cohérents, membre inactif/index actif, membre actif/index inactif, index absent, UID/shopId/patronUid incohérent, abonnement expiré, boutique suspendue, Patron propriétaire.
- Vérifier les limites de lectures d'accès Firestore et l'évaluation des règles avec l'Emulator avant toute publication.
- Aucun test Emulator ou compte réel exécuté dans cette passe.


## Contrat de données métier avant durcissement des règles partagées — 26 novembre 2026

### Schéma effectivement produit par l'application historique

La lecture du formulaire `saveForm()` confirme les champs suivants pour les nouvelles opérations locales. Ils sont donnés comme inventaire du modèle historique, et non comme schéma Firestore cible déjà validé.

- **Vente** : `id`, métadonnées `createdByUid`, `createdByName`, `createdAt`, `updatedAt`, `product`, `quantity`, `unitPrice`, `total`, `date`, `saleType`, `clientId`, `method`, `paidAmount`, `creditAmount`, `cashPart`, `mobilePart`; selon le lien stock : `stockProductId`, `stockDeductedAt`, `stockDeductedQuantity`.
- **Dette** : `id`, métadonnées d'auteur, `clientId`, `amount`, `date`, `due`, `description`, et `saleId` lorsqu'elle provient d'une vente à crédit.
- **Remboursement** : `id`, métadonnées d'auteur, `debtId`, `amount`, `date`, `method`.
- **Client** : `id`, métadonnées d'auteur, `name`, `phone`, `address`, `note`.
- **Achat** : `id`, métadonnées d'auteur, `item`, `supplier`, `quantity`, `amount`, `date`, `method`, `note`; selon le lien stock : `stockProductId`, `stockAddedAt`.
- **Dépense** : `id`, métadonnées d'auteur, `category`, `description`, `amount`, `date`, `method`, `note`.
- **Produit historique** : `id`, métadonnées d'auteur, `name`, `category`, `sku`, `quantity`, `purchasePrice`, `salePrice`, `alertAt`.
- **Journal de stock** : `id`, `entityType`, `entityId`, `action`, `relatedSaleId` ou `relatedPurchaseId`, `quantity`, `before`, `after`, `at`, `actor`, `actorName`.

### Écarts à résoudre avant toute règle de validation

1. Le modèle historique utilise `createdByUid`; les règles partagées exigent `createdBy`. Une conversion ne peut être faite qu'après vérification de l'appartenance du compte à la boutique.
2. Le modèle historique n'ajoute pas `shopId` à ces objets, car ils sont conservés dans `users/{uid}/comptivaData/main`. La règle d'appartenance au chemin partagé ne peut donc pas être simplement appliquée à ces données.
3. Le code local valide plusieurs invariants métier — entiers GNF, quantités positives, somme des paiements mixtes égale au total, remboursement inférieur ou égal au solde, relations client/vente/dette — mais ces contrôles JavaScript ne sont pas des protections serveur.
4. Les règles partagées autorisent actuellement des créations avec peu de validation de champs et des mises à jour Patron sans liste blanche complète. En cas de déploiement isolé, un client pourrait donc soumettre des documents incohérents ou modifier des champs métier non prévus.
5. Les opérations stock/vente et dette/remboursement doivent être traitées comme des ensembles cohérents. Une simple règle sur chaque document ne prouve pas que les soldes, quantités et traces ont été modifiés ensemble.

### Décision de correction sûre

- Ne pas recopier le schéma historique dans les règles partagées sans spécifier les champs obligatoires, optionnels et immuables du modèle cible.
- Ne pas transformer `createdByUid` en `createdBy` par simple renommage ; l'identité doit être validée contre le membre actif de la boutique.
- Avant migration, définir les listes blanches distinctes pour création et modification de chaque collection, les champs immuables (`id`, `shopId`, auteur initial, dates de création et références), les types numériques/date, les montants autorisés et les invariants relationnels.
- Définir ensuite les opérations atomiques vente + mouvement de stock + dette éventuelle, puis remboursement + solde, avec validation serveur/Firestore Emulator. Les tests doivent inclure des écritures partielles, des références croisées vers une autre boutique, des montants négatifs ou non entiers, des surpaiements, des quantités de stock insuffisantes et des modifications d'auteur.
- Garder le chemin historique et ses règles owner-only inchangés jusqu'à validation de la migration complète.

### Vérifications de cette passe

- Relecture de `firestore.rules`, de `application.html` et des sections de migration de cette documentation sur la branche de travail.
- Inventaire des objets créés par `saveForm()` effectué par lecture statique.
- Confirmation que le modèle historique et les chemins partagés ne sont pas encore raccordés pour les opérations métier.
- Aucun changement de `firestore.rules` ni de `application.html` dans cette passe : les validations serveur ne peuvent pas être fixées sûrement tant que le schéma cible et les opérations atomiques ne sont pas définis.
- Aucun test Firebase Emulator, test navigateur, test de compte réel, migration, déploiement ou publication effectué.
- `main` reste intacte.


## Revue ciblée des règles d'écriture multi-boutiques — 26 novembre 2026

### Défauts de validation confirmés dans la version actuelle de `firestore.rules`

Cette revue porte uniquement sur le modèle cible `shops/{shopId}/...`. Elle ne signifie pas que ces collections sont actuellement utilisées par le parcours historique de l'application.

| Collection | Contrôle présent | Lacune restante |
|---|---|---|
| `sales` | `shopId` et `createdBy` à la création ; auteur et boutique conservés à la modification | Pas de liste blanche, champs obligatoires, types, montants, quantités, méthode de paiement ni relations client/produit ; modification Patron trop large |
| `debts` | Boutique vérifiée à la création et modification ; modification Patron-only | Pas de validation du client, montant, date, dette source, auteur ni solde ; modification trop large |
| `payments` | Boutique et auteur à la création ; modification Patron-only | Pas de validation de dette, montant, date, méthode, solde ou unicité ; modification trop large |
| `clients` | Boutique vérifiée à la création et modification ; suppression Patron-only | Pas de liste blanche ni de validation des champs ; un document peut contenir des champs inattendus |
| `purchases` / `expenses` | Écriture Patron-only et `shopId` contrôlé | Pas de schéma strict, de validation des montants/dates/types ni de champs immuables |
| `products` | Écriture Patron-only | Aucune validation de schéma ; lecture intégrale par Vendeur via `canUseShop`, donc risque de divulgation de champs financiers |
| `auditLog` | Création avec `shopId` et `actorUid` ; modification/suppression interdites | Pas de liste blanche, type d'événement, cible, horodatage serveur ni validation des champs de trace |

### Autres observations d'autorisation

- `canUseShop` autorise toujours les lectures Patron sur une boutique existante, même si son statut est suspendu ou son abonnement expiré. Les règles de lecture des collections partagées héritent de cette politique.
- `shops` autorise le `list` au propriétaire sur la base de `ownerUid`, sans contrôle du statut ou de l'abonnement.
- Les créations/modifications de documents `members` sont Patron-only et exigent `uid`, rôle vendeur, booléen `active` et `assignedBy`, mais les champs de profil/date restent partiellement optionnels et la modification ne fige pas explicitement `createdAt`.
- Les règles d'index `userShopMemberships` permettent au Patron propriétaire de modifier/supprimer son index sans vérifier l'abonnement actif. L'accès effectif du vendeur reste néanmoins bloqué par le statut de boutique et la vérification d'abonnement dans `isActiveShopMember`.

### Priorités avant toute modification des règles

1. Décider explicitement si un Patron expiré/suspendu conserve la lecture de ses archives et si cette politique diffère pour les vendeurs.
2. Définir le schéma cible versionné et les champs autorisés pour chaque collection ; ne pas déduire le schéma partagé directement des objets legacy.
3. Séparer les documents produits publics des informations financières Patron-only avant de permettre la lecture vendeur.
4. Fixer les champs immuables et les listes blanches pour chaque opération create/update.
5. Définir les invariants transactionnels : vente + stock + dette éventuelle ; remboursement + solde ; achat + mouvement de stock.
6. Écrire les tests Emulator positifs et négatifs correspondant à chaque règle, y compris requêtes/listes, batchs et transactions.

### Vérifications et limites

- Relecture complète de `firestore.rules` sur la branche de travail.
- Chaque collection opérationnelle et chaque règle `allow` ci-dessus a été comparée au contrat des objets historiques documenté précédemment.
- Aucune modification de règle dans cette passe : le schéma cible et la politique d'accès post-expiration doivent être arrêtés avant d'écrire des conditions potentiellement incompatibles.
- Aucune exécution Firebase Emulator, aucun test navigateur ou compte réel, aucune migration, aucun déploiement ni publication.
- Le chemin legacy `users/{uid}/comptivaData/main` reste inchangé et owner-only.
- `main` reste intacte.


## Correction ciblée — présence vendeur, déconnexion et hors ligne — 26 novembre 2026

### Comportement retenu dans le code

- **Signal serveur (heartbeat) :** un vendeur affecté et vérifié envoie un signal Firestore toutes les 30 secondes, uniquement si sa session est toujours la session courante, si l'application est visible et si la session n'est pas verrouillée.
- **Actualisation de l'affichage :** la liste du Patron recalcule les statuts localement toutes les 1 seconde. Ce rafraîchissement ne déclenche pas une lecture Firestore chaque seconde.
- **Seuil hors ligne :** sans signal serveur récent depuis plus de 3 minutes (180 000 ms), le vendeur est affiché « Hors ligne ».
- **Connecté :** affectation active, signal récent dans la fenêtre de 3 minutes et dernier état différent de « disconnected ».
- **Déconnecté :** lors d'une déconnexion volontaire, le client tente d'écrire immédiatement `clientState: 'disconnected'` et un horodatage serveur avant l'appel Firebase Auth `signOut()`. Cette tentative est limitée à 1,5 seconde pour ne pas bloquer durablement la déconnexion.
- **Coupure réseau / fermeture brutale :** si l'application ne peut pas écrire l'état « Déconnecté », le dernier signal vieillit et le statut passe automatiquement à « Hors ligne » après le seuil de 3 minutes.
- **Suspendu :** l'état d'affectation désactivée reste distinct des états de connexion.
- **Retour d'Internet :** le heartbeat est relancé après la vérification de l'abonnement et la validation de la session.
- **Déverrouillage après inactivité :** le suivi de présence est relancé après réauthentification.
- **Perte d'Internet :** le heartbeat local est arrêté ; aucune fausse confirmation de présence n'est envoyée hors connexion.

### Règles Firestore

- Le vendeur ne peut toujours écrire que son propre document de présence.
- La règle autorise maintenant les états `active` et `disconnected`, avec `lastSeen == request.time`, et conserve l'exigence d'une affectation vendeur active et d'un abonnement valide.
- La lecture des présences reste réservée au Patron de la boutique.

### Points de vigilance et tests restant à exécuter

- Le seuil de 3 minutes est calculé dans l'interface à partir de l'horodatage serveur comparé à l'horloge de l'appareil ; un décalage important de l'horloge du téléphone peut décaler l'affichage. Les droits d'accès restent, eux, vérifiés par Firestore.
- Si le vendeur perd le réseau, ferme brutalement l'application ou si la tentative de déconnexion échoue, le statut « Déconnecté » immédiat ne peut pas être garanti ; le basculement « Hors ligne » après expiration du signal est le mécanisme de secours.
- Le délai de 1 seconde concerne uniquement le recalcul visuel ; le heartbeat réseau reste à 30 secondes afin d'éviter des écritures Firestore excessives.
- À tester dans Firebase Emulator et sur appareils réels : connexion, déconnexion volontaire, fermeture forcée, perte et retour du réseau, application en arrière-plan, verrouillage après inactivité, vendeur suspendu, abonnement expiré et changement rapide de compte.
- Vérifier aussi les coûts et limites Firestore, les écritures en attente au moment de `signOut()` et le comportement du timeout de 1,5 seconde.

### Vérifications statiques après correction

- Les trois blocs JavaScript de `application.html` compilent : 3/3.
- Les contrôles statiques confirment le heartbeat 30 s, le rafraîchissement visuel 1 s, le seuil 180 s, l'écriture de déconnexion, la reprise après reconnexion et la règle Firestore correspondante.
- Aucun test Firebase Emulator, navigateur ou appareil réel n'a été exécuté.
- Aucune donnée réelle, aucun compte réel, aucune migration ni aucun déploiement n'ont été modifiés ; `main` reste intacte.


## Présence réciproque Patron ↔ vendeur — 26 novembre 2026

### Correction applicative

- Le Patron démarre maintenant son propre heartbeat de présence dans le document shops/{shopId}/presence/{patronUid} après vérification serveur de sa boutique principale, de son UID propriétaire et du statut actif de la boutique.
- Le vendeur déjà vérifié par le rôle et les deux documents d'affectation peut afficher un encart « Présence de votre Patron » sur son tableau de bord.
- L'application écoute uniquement le document de présence du Patron correspondant à l'affectation confirmée ; elle ne charge pas la liste des présences de la boutique.
- Le statut est recalculé localement chaque seconde, avec heartbeat réseau toutes les 30 secondes et bascule « Hors ligne » après 3 minutes sans signal.
- Les états « Connecté », « Déconnecté » et « Hors ligne » sont présentés sans exposer les ventes, les finances, les actions ni l'activité privée du Patron.
- Le nettoyage du suivi retire aussi l'écoute temps réel du statut Patron lors d'un changement de session.

### Règles Firestore

- Le Patron conserve la lecture de la collection de présences de sa boutique.
- Un vendeur actif peut effectuer un get uniquement sur le document dont l'identifiant est le patronUid de sa boutique ; list reste interdit au vendeur.
- Le Patron peut écrire uniquement son propre document de présence si son abonnement est actif.
- Le vendeur peut toujours écrire uniquement son propre document, avec affectation active et abonnement Patron valide.
- Les champs autorisés restent strictement uid, lastSeen, clientState, avec horodatage serveur obligatoire ; suppression interdite.

### Limite connue à ne pas masquer

- Le modèle actuel utilise un document unique par UID et par boutique. Si le même compte Patron ouvre plusieurs appareils simultanément, la déconnexion d'un appareil peut marquer « Déconnecté » alors qu'un autre appareil est encore actif. Une présence multi-appareils exacte nécessitera des documents de session par appareil et un agrégat ; cette correction ne prétend pas résoudre ce cas.
- Si le réseau est coupé ou l'application arrêtée brutalement, le statut passe à « Hors ligne » après expiration du dernier signal ; la déconnexion immédiate ne peut pas être garantie.

### Vérifications

- Vérification statique des chemins de lecture/écriture, du contrôle UID/Patron, du heartbeat, de l'écoute limitée au document Patron et du nettoyage de l'écoute.
- Compilation JavaScript et tests Firebase Emulator à exécuter après écriture de la version finale ; aucune vérification sur compte réel ou appareil n'est revendiquée.
- Aucun déploiement Firebase, aucune migration de données, aucun changement de main.


### Vérification complémentaire — course entre heartbeat et déconnexion

- Le suivi vendeur est maintenu après l'ajout de l'écoute du Patron : le vendeur continue d'émettre son propre heartbeat.
- Les écritures de présence sont sérialisées côté client afin d'éviter qu'un heartbeat déjà lancé ne termine après l'écriture « Déconnecté ».
- Lors d'une déconnexion volontaire, l'intervalle heartbeat est arrêté avant l'écriture de l'état « Déconnecté ».
- Vérification statique des deux heartbeat, de leur sérialisation, de l'arrêt avant déconnexion et compilation des trois blocs JavaScript : 3/3 réussie après cette correction.
- Aucun test Firebase Emulator, navigateur, compte réel ou appareil n'a été exécuté ; aucun déploiement ni changement de main.


## Audit complémentaire — présence multi-appareils : défaut confirmé et migration à préparer — 26 novembre 2026

### Constat confirmé dans le code actuel

- Le chemin de présence est unique par utilisateur et boutique : `shops/{shopId}/presence/{uid}`.
- Le Patron et le vendeur utilisent chacun ce document unique, quel que soit le nombre d'appareils ou d'onglets ouverts avec le même compte.
- Tous les heartbeats d'un même UID écrivent le même champ `lastSeen` et le même `clientState`.
- Une déconnexion volontaire depuis un appareil écrit `clientState: 'disconnected'` dans ce document commun. Elle peut donc faire afficher « Déconnecté » alors qu'une autre session du même compte envoie encore des heartbeats.
- La liste du Patron lit actuellement la collection `presence` et interprète un document par vendeur ; l'encart du vendeur écoute un seul document Patron.
- Les règles actuelles autorisent le Patron à lister les documents de présence et le vendeur actif à faire un get uniquement sur le document Patron. Elles n'autorisent pas encore une sous-collection de sessions.

### Décision de sécurité

Ne pas activer une migration partielle des présences vers des sessions avant de corriger ensemble l'application et les règles. Ne pas ajouter une règle permissive de lecture globale pour simplifier les requêtes.

### Schéma cible à implémenter et tester

- Conserver un document de présence parent par UID pour la compatibilité et l'état agrégé : `shops/{shopId}/presence/{uid}`.
- Ajouter des documents de session distincts sous `shops/{shopId}/presence/{uid}/sessions/{sessionId}`.
- Chaque session doit être liée à l'UID authentifié et contenir uniquement les champs nécessaires : identifiant de compte, horodatage serveur du dernier signal et état de session.
- Chaque onglet/appareil génère son propre identifiant de session. Une déconnexion ne marque que sa session ; elle ne peut pas déclarer l'ensemble du compte déconnecté.
- Le statut agrégé est « Connecté » si au moins une session a un signal récent et un état actif ; « Déconnecté » si aucune session active n'existe mais qu'une déconnexion volontaire récente est confirmée ; « Hors ligne » si aucune session récente n'existe sans confirmation de déconnexion.
- Les sessions anciennes doivent être nettoyées selon une politique documentée et sécurisée. Ne pas compter sur une suppression automatique tant qu'une politique TTL réellement configurée côté Firebase n'a pas été vérifiée.
- La lecture vendeur doit rester limitée aux sessions du seul UID Patron confirmé par l'affectation. Le vendeur ne doit jamais pouvoir lister les sessions d'autres vendeurs ou d'autres boutiques.
- Le Patron ne doit pouvoir lire que les sessions appartenant aux membres de sa boutique. Les écritures doivent rester limitées aux sessions de l'UID authentifié.
- Les documents parents historiques doivent rester lisibles pendant une période de compatibilité ; l'application ne doit pas interpréter un parent absent comme une déconnexion certaine pendant la transition.

### Tests de sécurité et de fonctionnement obligatoires

1. Même compte sur deux appareils : les deux sessions apparaissent actives.
2. Déconnexion appareil A : appareil B reste affiché connecté.
3. Perte réseau appareil A : appareil B reste connecté ; A passe hors ligne après expiration de son signal.
4. Déconnexion des deux appareils : statut déconnecté après confirmation des deux sessions.
5. Fermeture forcée et onglet fermé : expiration du signal sans fausse déconnexion immédiate.
6. Changement rapide de compte dans un onglet : aucune écriture tardive de l'ancien UID dans la session du nouveau compte.
7. Deux vendeurs distincts : chaque vendeur ne peut lire que les sessions du Patron, jamais celles de l'autre vendeur.
8. Tentative de création/écriture dans une session portant l'UID d'un autre utilisateur : refusée par Firestore.
9. Vendeur suspendu ou abonnement Patron expiré : les accès et heartbeats suivent exactement la politique d'accès existante.
10. Vérifier le nombre d'écouteurs, de lectures et d'écritures Firestore avec plusieurs vendeurs et appareils.

### État de cette passe

- Défaut multi-appareils confirmé par lecture statique de `application.html` et `firestore.rules`.
- Aucun changement applicatif ni changement de règle effectué dans cette passe : le schéma de sessions, la politique de nettoyage et les règles de lecture doivent être mis en œuvre ensemble pour ne pas créer une faille ou une présence incohérente.
- Cette section documente le plan de correction ; elle ne signifie pas que les sessions multi-appareils sont déjà prises en charge.
- Aucun test Firebase Emulator, navigateur, compte réel ou appareil exécuté.
- Aucun déploiement, aucune migration de données et aucune publication.
- `main` reste intacte.


### Correction complémentaire — temporisation de déconnexion — 26 novembre 2026

- Le délai maximal de 1,5 seconde utilisé pour attendre la confirmation d'une déconnexion dispose maintenant d'un identifiant et est annulé dans un bloc `finally`, que l'écriture réussisse ou échoue.
- Cela évite de laisser un minuteur temporaire actif après la fin de l'attente.
- L'écriture Firestore déjà lancée n'est pas annulée si le délai expire ; le mécanisme de sérialisation des écritures et le contrôle de session restent en place.
- Vérification statique : modification retrouvée après relecture GitHub ; les trois blocs JavaScript compilent avec `new Function`.
- Cette correction ne résout pas le défaut d'un document partagé entre plusieurs appareils. Le schéma multi-sessions décrit ci-dessus reste à implémenter et à tester.


## Correction complémentaire — arrêt des signaux en attente lors de la déconnexion (26 novembre 2026)

- Une déconnexion pouvait arrêter l’intervalle de heartbeat alors qu’un ancien signal `active` attendait encore la fin d’une écriture Firestore précédente. Comme l’utilisateur restait authentifié pendant la confirmation de déconnexion, ce signal en attente pouvait théoriquement être écrit après le marqueur `disconnected`.
- Le code bloque désormais les nouvelles écritures `active` dès le début de la déconnexion, y compris après l’attente d’une écriture précédente. Le marqueur `disconnected` reste autorisé.
- La tentative de déconnexion est aussi liée à l’époque de session (`krediSessionEpoch`) capturée au départ : un changement de session invalide l’ancienne tentative.
- Cette correction réduit une course locale entre heartbeat et déconnexion. Elle ne résout pas le défaut multi-appareils dû au document unique `presence/{uid}` : les sous-documents `sessions/{sessionId}` restent à concevoir et implémenter avec leurs règles et leurs tests.
- Vérification statique uniquement ; aucun test Firebase Emulator, navigateur, téléphone ou multi-appareils n’a été exécuté.


## Correction complémentaire — confirmation réelle du signal de déconnexion (26 novembre 2026)

- `krediWritePresenceState` peut renvoyer `false` lorsque la session a changé ou que le contexte n'est plus valide. La fonction d'appel ignorait auparavant cette valeur et renvoyait tout de même `true` dès que la promesse se terminait sans exception.
- La fonction vérifie maintenant explicitement `confirmed === true`. Une écriture refusée ou abandonnée n'est donc plus présentée comme une déconnexion confirmée ; le délai de trois minutes sans signal reste le mécanisme de repli.
- Vérification statique et compilation JavaScript uniquement ; aucun test Firebase réel ou multi-appareils n'a été effectué.


## Correction ciblée — reprise de présence après échec de déconnexion — 26 novembre 2026

- Défaut confirmé par lecture du flux `krediSignOut()` : le suivi de présence était arrêté et l'état `disconnected` pouvait être écrit avant l'appel `Firebase Auth signOut()`. Si cet appel échouait, l'utilisateur restait potentiellement connecté, mais son heartbeat n'était pas relancé ; son Patron pouvait donc le voir comme déconnecté jusqu'à une nouvelle initialisation ou au vieillissement du signal.
- Correction : dans le bloc d'échec de déconnexion, si le même UID est toujours connecté et que le réseau est disponible, COMPTIVA relance `krediStartSellerPresence()`. Le démarrage revalide le rôle et l'affectation avant de réémettre un signal actif. L'erreur de reprise est journalisée sans masquer l'erreur de déconnexion.
- La correction ne prétend pas résoudre la présence multi-appareils : le document parent unique par UID reste une limite connue ; les sessions par onglet/appareil ne sont pas encore implémentées.
- Vérifications prévues dans cette passe : relecture du fichier modifié, compilation des trois blocs JavaScript, contrôle statique du nouveau chemin et comparaison avec `main`.
- Aucun test Firebase Emulator, navigateur, appareil réel ou compte réel ; aucun déploiement, aucune migration et aucune publication.
- `main` reste intacte.


## Audit complémentaire — cycle de vie de présence et verrouillage — 26 novembre 2026

### Comportements confirmés par lecture du code
- Le verrouillage après 2 minutes d'inactivité conserve la session Firebase : il ne s'agit pas d'une déconnexion du compte.
- Pendant le verrouillage, le heartbeat de présence ne transmet plus de signal, car l'envoi vérifie l'état verrouillé. Le statut distant passe donc à `Hors ligne` après 3 minutes sans signal serveur.
- Après réauthentification réussie au déverrouillage, le code relance le suivi de présence et reprogramme le verrouillage d'inactivité.
- Le retour d'Internet vérifie l'abonnement du commerçant avant de reprendre la synchronisation, puis relance le suivi de présence. La perte d'Internet arrête le heartbeat local ; le statut distant dépend du vieillissement du dernier signal serveur.
- Les callbacks du suivi du Patron vérifient l'UID, l'époque de session et la boutique active avant de modifier l'interface ; les écouteurs sont retirés lors de l'arrêt du suivi.
- Le suivi du Patron côté vendeur lit uniquement le document de présence du Patron affecté. Les règles Firestore inspectées limitent également le `get` du vendeur au Patron indiqué dans les données de la boutique et réservent le `list` des présences au Patron.

### Limites et tests encore nécessaires
- Ces conclusions sont des vérifications statiques du code et des règles ; elles ne prouvent pas le comportement réel du SDK Firebase dans un navigateur ou sur plusieurs appareils.
- Le document parent `presence/{uid}` reste partagé entre tous les onglets/appareils d'un même compte. Un appareil qui se déconnecte peut donc encore écraser l'état d'un autre appareil actif. C'est la priorité de correction suivante : sessions individuelles sous `presence/{uid}/sessions/{sessionId}`.
- Les scénarios à tester sur Firebase Emulator puis sur appareils réels restent : verrouillage/déverrouillage, onglet masqué puis visible, coupure réseau, reconnexion, déconnexion refusée, changement de compte pendant une écriture, deux appareils simultanés, et vérification qu'un vendeur ne peut lire aucune présence d'un autre vendeur.
- Aucun test Emulator, navigateur, appareil réel, ni compte Firebase réel n'a été exécuté dans cet audit. Aucun changement des règles Firestore n'a été fait dans cette passe.


## Correction ciblée — nettoyage des écouteurs de présence lors d'un changement de compte — 26 novembre 2026

### Défaut constaté
- Le suivi de présence des vendeurs dans l'espace Patron utilise deux écouteurs Firestore (liste des membres et collection de présence) ainsi qu'un minuteur de rendu local.
- Ces écouteurs étaient arrêtés lors d'une déconnexion complète et lors d'un nouvel appel manuel à l'actualisation, mais pas explicitement au début de chaque transition d'état Firebase Auth.
- En cas de passage direct d'un compte à un autre sans état intermédiaire déconnecté, les callbacks refusaient déjà de modifier l'interface si l'UID ne correspondait plus, mais les anciens écouteurs pouvaient rester actifs et continuer à consommer des lectures.

### Correction appliquée
- Au début de chaque callback onAuthStateChanged, après incrément de l'époque de session, COMPTIVA retire les écouteurs de membres et de présence et arrête le minuteur de rendu du suivi Patron.
- Les callbacks déjà en vol sont invalidés par le changement d'époque de session et les nouveaux écouteurs ne sont recréés qu'à la demande du compte actuellement authentifié.
- Le nettoyage existant lors de la déconnexion est conservé ; il devient simplement redondant et sans effet si les écouteurs ont déjà été retirés.
- Cette correction ne modifie ni les règles Firestore, ni les documents de présence, ni les données métier.

### Limites et vérifications
- Cette correction réduit les écouteurs abandonnés lors d'un changement direct de compte ; elle ne résout pas le défaut multi-appareils du document parent unique presence/{uid}.
- Vérifications statiques et compilation JavaScript à effectuer après relecture de la version enregistrée.
- Aucun test Firebase Emulator, navigateur, appareil réel ou compte réel exécuté ; aucun déploiement, migration ou publication.
- main reste intacte.

## Correction complémentaire — arrêt complet de la présence à chaque transition Auth — 26 novembre 2026

- Le nettoyage précédent retirait les écouteurs Patron, mais un heartbeat de l'ancien compte pouvait rester programmé lors d'un changement direct d'utilisateur Firebase sans état intermédiaire déconnecté.
- La transition Auth appelle désormais aussi `krediStopSellerPresence()` immédiatement après l'incrément de l'époque de session. Cela arrête l'intervalle heartbeat, retire l'écoute du Patron et efface le contexte local de présence de l'ancien compte.
- Le nouveau compte ne redémarre sa présence qu'après les vérifications habituelles de rôle, d'affectation, de boutique et d'abonnement.
- Cette correction ne marque pas artificiellement l'ancien compte comme déconnecté : si son signal de déconnexion n'a pas été confirmé, l'expiration des 3 minutes reste le mécanisme de repli.
- Elle ne résout toujours pas la collision entre deux appareils partageant le même document parent `presence/{uid}`. La solution par sessions individuelles reste à implémenter et à tester.
- Aucun test Firebase Emulator, navigateur, appareil réel ou compte réel exécuté ; aucun déploiement, migration ou publication ; `main` reste intacte.

## Audit complémentaire — architecture de présence multi-sessions et coût des lectures — 26 novembre 2026

### Vérifications statiques de la version actuelle

- Le suivi Patron utilise actuellement un écouteur sur `shops/{shopId}/members` et un écouteur sur toute la collection `shops/{shopId}/presence`. Le rendu local est recalculé chaque seconde ; cela ne signifie pas une lecture Firestore chaque seconde.
- Le suivi côté vendeur écoute un seul document : `shops/{shopId}/presence/{patronUid}`.
- Les écritures heartbeat Patron et vendeur ciblent le document parent unique `presence/{uid}`, avec `lastSeen` et `clientState`.
- Aucun identifiant de session par onglet/appareil n'est actuellement créé dans `sessionStorage` ou `localStorage` pour la présence.
- Les règles Firestore actuelles ne déclarent aucune règle imbriquée `presence/{memberUid}/sessions/{sessionId}`. Il ne faut donc pas commencer à écrire ces documents avant une mise à jour coordonnée des règles.

### Décision d'architecture avant implémentation

- Une sous-collection de sessions par UID est nécessaire pour éviter qu'une déconnexion sur un appareil écrase le statut d'un autre appareil actif.
- Le Patron peut suivre les sessions de ses vendeurs avec des écouteurs ciblés par UID de membre ; le nombre d'écouteurs et de documents lus dépendra donc du nombre de vendeurs et des sessions actives. Cette charge doit être mesurée et limitée, et les écouteurs doivent être retirés lors de toute transition Auth, suspension ou changement de boutique.
- Le vendeur ne doit écouter que les sessions de son Patron confirmé par l'affectation active. Aucune lecture globale de toutes les sessions de la boutique ne doit être accordée au vendeur.
- Un agrégat écrit directement par les clients ne doit pas être considéré comme une vérité fiable : plusieurs appareils peuvent écrire simultanément et un client ne peut pas prouver à lui seul qu'aucune autre session n'est active.
- Une agrégation serveur automatisée serait plus centralisée, mais elle dépendrait d'un service serveur et de son coût/configuration. Ne pas introduire de Cloud Function ni supposer qu'elle est disponible sur le projet Firebase actuel sans décision explicite sur le plan et les coûts.
- Les identifiants de session devront être propres à chaque onglet, non prédictibles et conservés uniquement dans `sessionStorage` pour éviter qu'un onglet copie l'identité d'un autre. Ils ne doivent contenir aucune donnée personnelle ni servir d'empreinte d'appareil.
- Pendant la transition, les documents parents existants devront rester compatibles. Un parent ancien ou absent ne doit pas être interprété comme une déconnexion volontaire certaine.

### Prochaine mise en œuvre requise

1. Ajouter la création et la validation locale d'un identifiant de session par onglet après vérification Auth, rôle et boutique.
2. Écrire les heartbeats et déconnexions uniquement dans le document de cette session ; ne plus laisser une session déclarer seule l'ensemble du compte déconnecté.
3. Ajouter des règles imbriquées strictes : écriture uniquement par l'UID propriétaire, lecture Patron limitée aux membres de sa boutique, lecture vendeur limitée au seul Patron affecté, champs autorisés minimaux et horodatage serveur obligatoire.
4. Adapter l'affichage Patron pour agréger les sessions de chaque vendeur, avec un nombre d'écouteurs borné et un nettoyage garanti.
5. Adapter l'encart vendeur pour agréger uniquement les sessions du Patron.
6. Définir le vieillissement des sessions abandonnées sans supposer qu'un TTL Firebase est configuré ; ne pas supprimer automatiquement les sessions sans politique vérifiée.
7. Exécuter les tests Emulator multi-appareils et d'isolation avant toute publication.

### Résultat de cette passe

- Le modèle parent unique, les lectures actuelles et l'absence de sessionId ont été vérifiés statiquement dans le code et les règles.
- Aucun code applicatif ni aucune règle Firestore n'a été modifié dans cette passe : la migration doit être coordonnée pour ne pas laisser l'application écrire dans un chemin refusé ou ouvrir une lecture trop large.
- La correction Auth précédente (arrêt des écouteurs et du heartbeat lors de chaque transition de compte) reste en place.
- Aucun test Firebase Emulator, navigateur, compte réel ou appareil exécuté ; aucun déploiement, aucune migration de données, aucune publication.
- La branche de travail reste distincte de `main` ; `main` n'est pas modifiée.


## Correction — invalidation des anciennes instances du suivi de présence — 26 novembre 2026

- Ajout d'un compteur de génération pour le suivi de présence du Patron. Chaque réouverture du suivi invalide les rappels et callbacks appartenant à l'instance précédente, même si le même UID reste connecté.
- Les callbacks des écouteurs membres et présences, leurs erreurs, le rendu périodique et le bloc de gestion d'erreur vérifient maintenant que leur génération est toujours courante avant de modifier l'interface.
- Chaque transition Auth invalide également la génération du suivi, en plus du nettoyage des écouteurs déjà en place.
- Correction ciblée sur l'interface du suivi des présences ; aucune règle Firestore, donnée métier, vente, stock ou abonnement n'a été modifié.
- Vérification statique : les trois blocs JavaScript de la version modifiée compilent. Aucun test Firebase Emulator, navigateur, appareil ou compte réel n'a été exécuté.


## Correction — contrôle du rôle et de l'abonnement avant le suivi Patron — 26 novembre 2026

- La fonction de rafraîchissement de la liste des présences retirait les anciens écouteurs, mais ne vérifiait pas elle-même le rôle Patron confirmé ni l'accès par abonnement avant d'en créer de nouveaux. Les règles Firestore protégeaient déjà les données et refusaient les lectures non autorisées ; il manquait néanmoins un contrôle préalable côté interface.
- La fonction invalide maintenant d'abord la génération précédente, retire les écouteurs et le minuteur existants, puis vérifie l'authentification, le rôle Patron confirmé et l'accès à l'application avant toute nouvelle souscription.
- Un vendeur ou un compte dont le rôle Patron n'est pas confirmé ne peut donc pas démarrer ce suivi depuis cette fonction. Un abonnement non confirmé bloque également la création des écouteurs, sauf compte Créateur.
- Les règles Firestore et les données de présence ne sont pas modifiées. Le défaut multi-appareils lié au document parent unique `presence/{uid}` demeure connu ; les sessions individuelles ne sont pas encore implémentées.
- Vérifications statiques et compilation JavaScript effectuées après relecture GitHub. Aucun test Firebase Emulator, navigateur, téléphone ou compte réel ; aucun déploiement, migration ou publication. `main` reste intacte.


## Correction — génération propre au cycle de présence vendeur/Patron — 26 novembre 2026

- Constat : le listener du document de présence du Patron et les opérations asynchrones du démarrage contrôlaient l'UID, la session Auth et la boutique, mais pas l'instance précise du cycle de présence. Un callback déjà mis en file pouvait donc survivre à un arrêt puis à un redémarrage rapide du suivi du même compte dans la même boutique.
- Ajout de `krediPresenceRunEpoch`, incrémenté à chaque arrêt du suivi. Chaque démarrage capture sa génération et sa fonction `isCurrent()` refuse désormais les callbacks et opérations de toute génération précédente.
- Le contrôle est local à l'interface : aucun nouveau document, champ Firestore, droit ou changement de règle n'est introduit. Les données de présence existantes restent inchangées.
- Cette correction complète la génération dédiée à la liste des vendeurs ; elle ne résout pas le problème distinct des appareils multiples qui partagent encore `presence/{uid}`. L'architecture de sessions individuelles reste à concevoir et tester avant migration.
- Compilation JavaScript statique et relecture GitHub effectuées après la modification. Aucun test Firebase Emulator, navigateur, téléphone ou compte réel ; aucun déploiement, migration ou publication. `main` reste intacte.


- La fonction `krediSetSellerActive()` utilise maintenant un `WriteBatch` pour modifier ensemble le document membre, l'index privé et l'événement d'audit.
- La règle de l'index utilise `getAfter()` pour vérifier le statut final du document membre au sein de la même écriture groupée.
- Si une écriture est refusée, les trois opérations sont rejetées ensemble : plus de fenêtre où le membre est modifié sans index correspondant, ni de succès sans trace d'audit.
- La fonction continue de relire le magasin, le membre et l'index depuis le serveur avant d'autoriser l'action.
- Vérification effectuée ici : cohérence statique des trois écritures et compilation JavaScript. À confirmer avec Firebase Emulator/Firestore réel avant publication.


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


## Audit des données financières des produits — 26 novembre 2026

### Schéma produit actuellement utilisé

Inspection de `application.html` sur la branche de travail (blob `application.html` SHA `9e1a18c2b778f08a232f394f0a887bb4ee521713`) :

- Le formulaire de création de produit demande `name`, `category`, `sku`, `quantity`, `purchasePrice`, `salePrice` et `alertAt`.
- `saveForm()` enregistre `purchasePrice` et `salePrice` directement dans chaque objet de `db.products`, avec les métadonnées d'auteur.
- `renderStock()` affiche actuellement au même endroit le prix d'achat, le prix de vente et la marge théorique calculée comme `salePrice - purchasePrice`.
- Le modèle de données local et le document cloud historique conservent la base complète `db` ; les données historiques des produits peuvent donc contenir ces champs financiers.
- Les occurrences de `purchasePrice` et `salePrice` dans l'application examinée sont limitées au formulaire, à l'enregistrement du produit et à l'affichage du stock. Aucune migration de ces champs vers une collection privée n'est implémentée.

### Portée réelle de l'exposition

- Les données historiques sont enregistrées dans le document privé `users/{uid}/comptivaData/main`. La règle héritée du fichier `firestore.rules` limite sa lecture au compte dont l'UID correspond au chemin. L'audit statique ne révèle donc pas d'ouverture de ce document historique aux autres UID.
- Le nouveau modèle prévoit `shops/{shopId}/products/{productId}`. La règle actuelle `allow read: if canUseShop(shopId)` autorise le Patron et le Vendeur reconnu à lire le document produit entier ; Firestore Rules ne peut pas cacher `purchasePrice` ou d'autres champs à l'intérieur d'un document déjà lisible.
- Dans `application.html`, la lecture directe de `shops/{shopId}/products/{productId}` repérée appartient au contrôle de relation en lecture seule. L'audit n'a trouvé aucune écriture opérationnelle directe vers `shops/{shopId}/products`. Le modèle multi-boutiques demeure non migré et non démontré en production : l'exposition des champs financiers dans les collections partagées est donc un risque de conception à traiter avant l'activation, et non la preuve qu'un Vendeur les lit actuellement.
- Les produits restent aussi dans le magasin local et le document cloud historique propre à chaque UID. Ne pas confondre ces données privées historiques avec les futures collections partagées.

### Décision de sécurité et migration recommandée

Ne pas retirer ou renommer immédiatement `purchasePrice` dans la base historique : cela casserait l'affichage actuel de la marge et pourrait faire perdre l'information de coût nécessaire aux rapports du Patron.

Avant toute migration multi-boutiques :
1. Garder dans `shops/{shopId}/products/{productId}` uniquement les informations que le Vendeur est autorisé à lire : identifiant, nom, catégorie, référence, quantité, seuil d'alerte et prix de vente si la politique commerciale l'autorise.
2. Placer le coût d'achat unitaire, la marge, le bénéfice et toute autre donnée financière réservée au Patron dans un document séparé, par exemple `shops/{shopId}/productFinancials/{productId}`, avec lecture réservée au Patron. Ne jamais recopier ces champs dans le document produit partagé.
3. Ajouter des contrôles de rôle côté interface pour masquer les écrans et calculs financiers au Vendeur, sans considérer l'interface comme une protection suffisante.
4. Définir une migration idempotente qui conserve les valeurs historiques, vérifie les correspondances par ID produit et signale les données manquantes ou ambiguës sans inventer de coût.
5. Tester avec Firebase Emulator les lectures directes, listes et requêtes : Vendeur autorisé sur le document produit public mais refusé sur `productFinancials` ; Patron autorisé sur les deux ; compte extérieur refusé sur les deux.
6. Ne lancer aucune migration ni publication avant sauvegarde, tests Emulator et autorisation explicite.

### Vérifications réalisées pour cette passe

- Champs sensibles repérés dans le formulaire, l'objet enregistré et le rendu du stock.
- Règle de lecture des produits partagés vérifiée statiquement : `canUseShop(shopId)`.
- Aucune écriture applicative directe vers la collection partagée `products` trouvée ; la lecture directe observée est dans un contrôle de relation en lecture seule.
- Les trois blocs JavaScript de `application.html` compilent avec `new Function` : 3/3 réussis.
- Aucune donnée Firestore réelle consultée ou modifiée ; aucun test Emulator, test navigateur ou test avec comptes Patron/Vendeur réalisé.
- Aucun changement de code, aucune migration, aucun déploiement et aucun changement de `main` effectués pendant cette passe.

**Statut :** risque de conception identifié et documenté ; séparation financière non implémentée. La correction doit être intégrée au moment de la migration multi-boutiques, avec séparation physique des documents et validation Emulator.


## Audit des références financières et des règles multi-boutiques — 26 novembre 2026

### Contrôles déjà présents dans l'application locale

Inspection de `application.html` :

- La création locale d'une vente valide une quantité positive, un prix unitaire entier positif, un total entier positif et, pour un paiement mixte, l'égalité entre les parts espèces/mobile et le total.
- Une vente à crédit exige un client présent dans `db.clients`.
- La création d'une dette exige un client existant et un montant entier positif.
- La création d'un remboursement exige une dette active, une date valide, un montant entier positif et un montant qui ne dépasse pas le solde calculé.
- `krediDebtRelationIssue()` contrôle l'existence du client de la dette et, si elle est issue d'une vente, l'existence de cette vente, la cohérence du client, le montant du crédit et le statut de la vente.
- `krediPaymentActionCheck()` contrôle l'identifiant unique du remboursement, la date, le montant, la dette active, la relation client/vente et le total des remboursements.
- `saleFinancialAmounts()` vérifie les montants entiers, l'égalité encaissé + crédit = total, la cohérence quantité × prix unitaire et les parts d'un paiement mixte.
- Ces validations sont des contrôles applicatifs locaux. Elles ne remplacent pas les règles Firestore : un appel direct à l'API peut les contourner si les règles serveur n'imposent pas les mêmes invariants.

### Défauts constatés dans les règles Firestore du modèle partagé

Inspection de `firestore.rules` :

1. **Ventes — création insuffisamment validée :** la règle exige seulement un `shopId` égal au chemin et `createdBy == request.auth.uid`. Elle ne valide pas les types et bornes de `total`, `quantity`, `unitPrice`, `paidAmount`, `creditAmount`, les parts espèces/mobile, le client ou le produit référencé.
2. **Dettes — référence client non vérifiée :** la règle de création vérifie seulement `shopId`. Elle ne vérifie ni l'existence de `clientId` dans la même boutique, ni le montant positif entier, ni la cohérence éventuelle avec une vente d'origine.
3. **Paiements — dette non vérifiée :** la règle de création exige `shopId` et `createdBy`, mais ne vérifie pas l'existence de `debtId` dans la même boutique, le montant positif entier, la date, le solde restant ou l'absence de surpaiement.
4. **Mises à jour Patron trop larges :** les mises à jour de ventes, dettes et paiements préservent certains champs `shopId`/auteur, mais ne limitent pas les autres champs modifiables par `diff().affectedKeys().hasOnly(...)`. Les invariants financiers peuvent être contournés par une écriture directe.
5. **Références croisées :** les règles ne valident pas les références entre ventes, clients, dettes, paiements et produits dans le périmètre de la même boutique. Un document peut être créé avec une référence absente ou étrangère si les autres conditions minimales sont satisfaites.

### Incompatibilité importante entre le modèle applicatif et les règles partagées

- `krediActorStamp()` produit les champs `createdByUid`, `createdByName`, `createdAt` et `updatedAt`.
- La création de vente et de paiement dans `application.html` utilise ce tampon d'auteur ; l'audit n'a trouvé aucune affectation `createdBy:` dans le code.
- Les règles de création partagée de `sales` et `payments` exigent pourtant `request.resource.data.createdBy == request.auth.uid`.
- Les objets opérationnels locaux ne montrent pas non plus l'ajout systématique de `shopId` dans les ventes, dettes et paiements créés par `saveForm()`, alors que les règles partagées l'exigent.
- **Conséquence :** le code actuel et les règles du modèle partagé ne sont pas encore compatibles pour ces écritures. Cela constitue un blocage de migration à résoudre explicitement, pas une raison d'ajouter un champ auteur arbitraire ni de desserrer les règles.
- Le champ `createdBy` ne doit jamais être déduit du nom affiché ou attribué à l'auteur actuel lors d'une migration d'historique. Les UID d'auteur historiques manquants ou différents doivent rester signalés et faire l'objet d'une décision explicite.

### Correction d'architecture recommandée avant activation

1. Définir un schéma serveur exact par collection : champs obligatoires, champs optionnels, types, bornes, champs immuables et valeurs de statut autorisées.
2. Valider les relations avec les documents de la même boutique : vente → client/produit ; dette → client/vente ; paiement → dette. Vérifier aussi que la dette n'est pas annulée et que le total payé après opération ne dépasse pas son montant.
3. Pour garantir l'absence de surpaiement en cas de paiements simultanés, ne pas compter uniquement sur une somme lue côté client ou sur une règle isolée. Concevoir une opération atomique transactionnelle ou un backend de confiance avec contrôle de concurrence.
4. Limiter les mises à jour Patron à des champs précis et préserver les identifiants, l'auteur initial, la boutique, les relations et les preuves d'audit.
5. Définir un contrat de migration explicite pour `createdByUid` / `createdByName` et `shopId`. Aucun UID, boutique ou relation manquante ne doit être inventé.
6. Ajouter les tests Emulator FIN-01 à FIN-04 et des cas supplémentaires : paiement concurrent, dette annulée, client d'une autre boutique, vente étrangère, montant décimal/négatif/nul, tentative de modification du montant et de l'auteur par le Patron.
7. Conserver le fonctionnement historique `users/{uid}/comptivaData/main` jusqu'à validation complète du nouveau modèle.

### Vérifications et limites de cette passe

- Les fonctions locales de validation de vente, dette et remboursement ont été inspectées ; elles sont plus complètes que les règles du modèle partagé.
- Les règles de création et mise à jour de `sales`, `debts`, `payments` ont été relues.
- L'incompatibilité `createdByUid` (application) / `createdBy` (règles) et l'absence d'ajout systématique de `shopId` dans les objets locaux sont confirmées par lecture statique.
- Aucune règle, application ou donnée Firestore n'a été modifiée pendant cette passe.
- Aucun test Emulator, transaction concurrente, navigateur ou compte Patron/Vendeur réel n'a été exécuté.
- Aucun déploiement, migration ou changement de `main` effectué.

**Statut :** contrôles locaux utiles, mais validation serveur des références et montants insuffisante ; incompatibilité de contrat entre code actuel et règles multi-boutiques identifiée. La migration ne doit pas être activée avant définition du schéma, correction du contrat et tests Emulator.


## Audit des rôles Patron / Vendeur dans l’interface — 26 novembre 2026

### Périmètre relu

- application.html : navigation latérale et mobile, navigate(), rendu des pages, actions de modification/annulation des ventes, dettes, remboursements, achats et dépenses, export CSV, gestion des vendeurs et diagnostics de rôle.
- firestore.rules : règles du modèle historique par UID et du modèle partagé shops/{shopId}.
- Références relues : application.html blob SHA 9e1a18c2b778f08a232f394f0a887bb4ee521713 ; firestore.rules blob SHA f1ec4e215cd74b0ee82f21923f5fba276ed28906.

### Constat sur l’interface actuelle

1. Navigation sans séparation Patron/Vendeur : les menus présentent Ventes, Profil, Stock, Chiffres, Clients, Dettes, Remboursements, Achats, Dépenses et Rappels. navigate(page) bloque l’Espace Créateur pour les autres comptes et applique le verrou d’abonnement, mais ne résout pas le rôle Patron/Vendeur et n’interdit pas les pages réservées au Patron.
2. Aucun état de rôle global établi : l’application contient des contrôles ponctuels dans le diagnostic de boutique et la présence vendeur, mais l’audit n’a pas trouvé de rôle métier global exploité par la navigation et les actions de l’application.
3. Actions directement appelables : editSale, cancelSale, editDebt, cancelDebt, editPayment, cancelPayment, editPurchase, cancelPurchase, editExpense et cancelExpense ne montrent pas de contrôle explicite du rôle Patron avant leurs opérations locales. Elles contiennent des validations métier et certaines vérifications de session/sauvegarde, mais celles-ci ne constituent pas une autorisation par rôle.
4. Export de données : exportCSV() n’effectue pas de vérification de rôle visible et inclut ventes, dettes, achats et dépenses. Un vendeur qui disposerait de ces données dans son état local pourrait déclencher directement l’export.
5. Données financières dans l’interface : les vues des chiffres, achats, dépenses et stock ne sont pas filtrées par rôle dans la navigation actuelle. Le stock affiche aussi prix d’achat et marge théorique dans le modèle local.
6. Gestion des vendeurs : les fonctions d’affectation et de suspension vérifient plusieurs conditions de propriété Patron côté client. Ces contrôles utiles ne remplacent pas les règles Firestore et ne constituent pas un système général de permissions UI.

### Ce que les règles Firestore du modèle partagé imposent actuellement

- Vendeur actif : lecture des ventes, clients, dettes, paiements et produits ; création de ventes, clients, dettes et paiements selon les conditions actuelles.
- Patron uniquement : modification des ventes, dettes et paiements ; suppression des clients ; écriture des produits/stock ; lecture et écriture des achats et dépenses ; lecture des rapports ; lecture du journal d’audit.
- Les écritures de vente et de paiement restent soumises à des champs obligatoires shopId et/ou createdBy que le modèle local actuel ne renseigne pas systématiquement. Les défauts de validation financière et de références croisées sont documentés dans l’audit financier précédent.
- Les règles du modèle partagé ne protègent que les opérations réellement dirigées vers shops/{shopId}/... .

### Limite majeure : modèle partagé non activé dans l’application

Le document historique users/{uid}/comptivaData/main reste limité à son propre UID. Le code applicatif conserve son modèle de base local par compte ; l’audit n’a pas établi de parcours complet qui charge les données d’une boutique partagée selon le rôle du vendeur. Il ne faut donc ni conclure qu’un vendeur réel accède aux données du Patron, ni présenter la séparation multi-boutiques comme déjà opérationnelle. Un compte vendeur connecté avec son propre UID reste dans son périmètre historique tant qu’une migration partagée n’est pas effectivement réalisée.

### Décision et corrections nécessaires avant migration

1. Construire un résolveur de rôle serveur vérifié après connexion : Patron propriétaire ou Vendeur actif, avec vérification concordante de l’index, de la boutique et du document membre. En cas d’ambiguïté ou d’échec réseau, refuser par défaut les fonctions réservées au Patron.
2. Définir une matrice de permissions unique : le Vendeur ne voit pas les bénéfices/marges, achats, dépenses, rapports ni gestion des vendeurs ; il ne peut ni modifier/annuler une vente validée, ni modifier/annuler dette ou remboursement si la politique retenue les réserve au Patron. Les actions autorisées au Vendeur doivent être nommées précisément.
3. Appliquer ces permissions à la navigation, au rendu, aux boutons, à chaque fonction globale appelable directement et à chaque ouverture de formulaire. Le masquage visuel seul ne suffit pas.
4. Maintenir Firestore Rules comme autorité finale : tests négatifs directs sur les chemins partagés pour chaque collection, y compris get/list, création, update et delete.
5. Séparer les coûts, marges et bénéfices dans des documents Patron-only avant de partager les documents produits ; ne pas compter sur un filtrage JavaScript pour cacher les champs.
6. Ne pas changer le modèle historique UID ni migrer les données avant contrat de schéma, migration idempotente, sauvegarde et tests Emulator.

### Vérifications et limites de cette passe

- Contrôle statique des entrées de navigation, de navigate(), des actions métier et des règles Firestore.
- Les trois blocs JavaScript de application.html compilent avec new Function : 3/3 réussis.
- Aucun code applicatif ni règle Firestore modifié pendant cette passe ; seule cette note d’audit est ajoutée.
- Aucun test Firebase Emulator, navigateur, connexion réelle Patron/Vendeur ou appel direct Firestore exécuté.
- Aucune migration, écriture de données réelles, publication ou modification de main.

**Statut :** défaut d’autorisation par rôle dans l’interface confirmé par lecture statique. La séparation serveur du futur modèle partagé est partiellement décrite dans les règles, mais le contrat applicatif et la migration ne sont pas prêts. Ne pas activer le multi-boutiques avant la mise en place de la matrice de permissions et les tests Emulator.


## Première correction des contrôles Patron / Vendeur dans l’interface — 26 novembre 2026

### Modifications appliquées à application.html

- Ajout d’un état de rôle distinct de la session Firebase. Il reste inconnu tant que la lecture serveur des affectations n’a pas abouti.
- Ajout d’un résolveur serveur qui lit l’index privé userShopMemberships/{uid}/shops, puis vérifie la boutique et le document membre vendeur : UID, rôle seller, état actif, ownerUid/patronUid concordants et assignedBy égal au Patron propriétaire.
- Plusieurs affectations vendeur, affectation inactive, incohérence des documents, absence de Firestore ou échec de lecture ne donnent jamais les droits Patron. Les fonctions Patron restent bloquées en cas de rôle non confirmé.
- Les comptes sans affectation vendeur dans l’index serveur conservent le mode historique Patron, afin de ne pas casser les comptes commerçants existants. Le compte Créateur est traité séparément.
- Navigation réservée au Patron pour Profil du commerce (qui contient aussi la gestion des vendeurs), Chiffres, Achats et Dépenses.
- Contrôle ajouté à l’ouverture et à l’enregistrement des formulaires Produit, Achat et Dépense.
- Contrôle direct ajouté aux fonctions de modification/annulation des ventes, dettes, remboursements, achats et dépenses, ainsi qu’à l’export CSV. Les contrôles ne reposent donc pas uniquement sur la présence des boutons.
- Pour le rôle vendeur confirmé, le tableau Stock n’affiche plus le prix d’achat ni la marge théorique ; il conserve le nom, la catégorie, la quantité et le prix de vente.
- Le tableau de bord masque les montants d’achats, dépenses et l’indicateur CA − achats − dépenses pour les comptes qui ne disposent pas du rôle Patron confirmé.
- À la déconnexion, l’état du rôle est réinitialisé.

### Limites importantes

- Cette correction est une protection de l’interface et des fonctions JavaScript ; elle n’est pas une frontière de sécurité serveur. Le contrôle final des données du futur modèle partagé reste dans Firestore Rules.
- Le modèle partagé n’est toujours pas migré dans l’application : le vendeur n’accède pas encore au jeu de données commun de la boutique. Les opérations locales historiques restent stockées dans users/{uid}/comptivaData/main.
- Les règles Firestore du chemin historique autorisent le propriétaire de chaque UID à écrire dans son propre espace ; les guards de l’interface ne peuvent pas empêcher un utilisateur de modifier son propre stockage local ou d’appeler directement l’API sur son propre chemin.
- Les comptes sans affectation vendeur sont considérés Patron historique, selon le modèle actuel. Une migration vers un rôle Patron explicitement enregistré sera nécessaire avant activation complète des boutiques partagées.
- Les actions de création de vente, client, dette et remboursement restent possibles pour un vendeur ; les modifications/annulations sont Patron-only. Les opérations de stock liées à la vente restent dans l’ancien modèle local et devront être migrées vers une opération serveur/transaction atomique avant activation multi-boutiques.
- Une erreur de résolution de rôle bloque les actions Patron, mais le test réel de ce comportement exige Firebase Emulator et deux comptes de test.

### Vérifications effectuées

- Relecture du fichier après écriture et contrôle des guards présents sur les pages, formulaires et fonctions directes.
- Les trois blocs JavaScript de application.html compilent avec new Function : 3/3 réussis après correction d’une erreur de syntaxe détectée pendant la première vérification.
- Aucun test Firebase Emulator, test navigateur, compte réel Patron/Vendeur ou appel direct Firestore exécuté.
- Aucun changement des règles Firestore, aucune migration ni donnée réelle modifiée. Aucun déploiement et aucune modification de main.

**Statut :** première barrière UI Patron/Vendeur ajoutée. À valider ensuite avec Emulator et tests de non-régression ; ne pas considérer cette correction comme une autorisation serveur ni comme l’activation du multi-boutiques.

## Porte de sécurité avant séparation effective des coûts produits — 26 novembre 2026

### Décision technique après relecture du code et des règles

La séparation des coûts et marges ne doit pas être implémentée par une simple création de collection Firestore ou par un changement isolé de règle.

Constats vérifiés sur la branche de travail :

- Le formulaire Produit et `saveForm()` enregistrent actuellement `purchasePrice` et `salePrice` dans le même objet `db.products`.
- `db.products` est conservé dans le modèle local historique chargé depuis le stockage du compte ; l'application continue d'utiliser ce modèle pour le stock, les ventes, les achats et les contrôles de cohérence.
- Aucun parcours applicatif d'écriture vers `shops/{shopId}/products` ni vers `shops/{shopId}/productFinancials` n'a été trouvé.
- Les règles partagées actuelles autorisent la lecture des documents `shops/{shopId}/products/{productId}` à tout membre autorisé de la boutique. Firestore renvoie le document entier : il ne filtre pas les champs individuels.
- Les règles partagées bloquent déjà les écritures directes vendeur dans `products`, mais cela ne protège pas un champ financier qui serait présent dans un document produit lisible.
- Le modèle multi-boutiques reste explicitement non activé dans l'application. Les chemins historiques `users/{uid}/comptivaData/main` doivent être préservés.

### Pourquoi aucune règle partielle n'est ajoutée maintenant

1. Ajouter `productFinancials` sans écrire ni lire cette collection dans l'application créerait une séparation fictive : le coût continuerait à être enregistré dans l'objet produit historique.
2. Interdire immédiatement la lecture vendeur des documents produits qui contiennent un champ sensible pourrait rendre les lectures/listes de stock impossibles pour des documents existants. Les règles Firestore ne filtrent pas automatiquement les documents d'une requête.
3. Autoriser simplement la lecture vendeur des produits sans migration préalable laisserait fuiter les coûts si un document partagé contenait encore `purchasePrice` ou un autre champ financier.
4. Supprimer `purchasePrice` des objets historiques risquerait de casser les rapports Patron, les calculs de marge, les achats et les contrôles de stock ; aucune suppression ou conversion automatique n'est autorisée.

**Conclusion :** la modification isolée des règles serait soit insuffisante pour la confidentialité, soit susceptible de casser le stock vendeur. Aucune règle, aucun document Firestore et aucune donnée produit ne sont modifiés dans cette passe.

### Correction intégrée obligatoire avant activation du partage des produits

La prochaine implémentation doit former un seul ensemble cohérent :

1. Définir un document public `shops/{shopId}/products/{productId}` avec une liste blanche de champs non financiers : identifiant, nom, catégorie, référence, quantité, seuil d'alerte, prix de vente si la politique le permet, et métadonnées non sensibles strictement nécessaires.
2. Définir `shops/{shopId}/productFinancials/{productId}`, accessible au Patron uniquement, pour le coût d'achat et les autres données financières nécessaires. La marge doit être calculée à partir des valeurs autorisées plutôt que copiée dans le document public.
3. Adapter le formulaire Produit, `saveForm()`, le rendu Stock, les ventes, les achats, les corrections de stock, les rapports et les exports pour lire/écrire les deux documents selon le rôle. Le vendeur ne doit jamais recevoir le document financier.
4. Prévoir une migration idempotente par ID produit depuis les données historiques, avec sauvegarde, vérification des doublons et correspondances, conservation des valeurs d'origine et signalement des valeurs manquantes. Ne jamais inventer un coût.
5. Préserver le mode historique par UID jusqu'à validation de la migration et des tests ; ne pas basculer automatiquement les comptes existants.
6. Ajouter les tests Firebase Emulator : Patron lit/écrit les deux documents ; vendeur lit le document public mais reçoit un refus sur `productFinancials` ; vendeur ne peut pas injecter un champ financier dans le document public ; compte extérieur refusé ; documents historiques non migrés traités sans fuite ; requêtes de liste du stock autorisées uniquement sur le schéma public migré.
7. Rejouer les tests de non-régression sur ventes, achats, annulations, remboursements, stock, rapports, export et synchronisation hors ligne avant toute activation.

### Vérifications de cette passe

- Relecture de `application.html`, `firestore.rules` et de la documentation de migration sur la branche de travail.
- Champs `purchasePrice` / `salePrice`, écriture locale de produit et rendu stock identifiés.
- Aucune écriture applicative vers les collections partagées `products` ou `productFinancials` trouvée.
- Aucune modification de code ou de règles Firestore ; aucune migration, lecture ou écriture de données réelles, aucun test Emulator ou navigateur, aucun déploiement.
- `main` n'a pas été modifiée.

**Statut :** risque confirmé ; correction intégrée bloquée par l'absence du parcours applicatif multi-boutiques. Ne pas déclarer les coûts protégés côté serveur avant implémentation et tests de la séparation physique des documents.

## Cartographie des dépendances avant migration des produits — 26 novembre 2026

### Flux de création d'un produit

- `openForm('product')` présente nom, catégorie, référence, quantité initiale, `purchasePrice`, `salePrice` et seuil d'alerte.
- `saveForm()` valide les deux prix comme entiers GNF, puis ajoute un objet contenant les deux champs dans `db.products`.
- L'enregistrement passe par le mécanisme général `saveDB()` : stockage local du compte, puis synchronisation cloud historique selon l'état de session et de synchronisation.
- Aucun identifiant de boutique partagée n'est associé au produit dans ce flux historique.

### Flux de vente et lien produit

- La vente saisit un nom d'article, une quantité et un prix unitaire manuellement.
- Le total est calculé par quantité × prix unitaire ; les contrôles espèces/mobile/crédit s'appliquent au total.
- Le lien de stock est recherché par correspondance du nom normalisé du produit. Si trouvé, la quantité est décrémentée, `stockProductId`, la date et la quantité déduite sont inscrits dans la vente et un mouvement `sale_deduction` est ajouté au journal.
- Le prix de vente catalogue `product.salePrice` n'est pas automatiquement utilisé comme prix unitaire de la vente dans le flux inspecté. Il faut préserver ce comportement ou définir explicitement une future règle de prix avant toute refonte.
- La vente conserve son propre `unitPrice` et son total historique ; ces valeurs ne doivent jamais être recalculées depuis le prix catalogue courant lors d'une migration.

### Flux d'achat et coût unitaire

- L'achat saisit une description, une quantité et un montant total.
- Le lien vers un produit de stock se fait par égalité du nom de l'article (insensible à la casse) ; si trouvé et quantité positive, le stock est augmenté et le mouvement `purchase_addition` est journalisé.
- Le document d'achat conserve `amount` (montant total) et `quantity`, mais le flux inspecté ne calcule pas de coût unitaire moyen et ne met pas à jour `product.purchasePrice`.
- Par conséquent, `purchasePrice` du produit représente le coût renseigné lors de la création/édition du produit, et ne doit pas être interprété sans vérification comme le coût moyen réel du stock courant.
- Les achats, leurs montants et leurs traces de stock constituent un historique financier distinct ; ils ne doivent pas être déplacés ou fusionnés dans le document public du produit.

### Rapports, stock et journal

- `renderStock()` lit `db.products` ; le Patron voit `purchasePrice` et une marge théorique `salePrice - purchasePrice`, le vendeur ne voit pas ces colonnes dans l'interface.
- Cette marge est une différence entre deux valeurs catalogue actuelles, pas un bénéfice comptable réalisé sur les ventes.
- `renderPurchases()` agrège les montants des achats et conserve les détails d'achat ; les rapports de ventes utilisent les prix réellement saisis dans chaque vente.
- `krediStockConsistencyAudit()` contrôle les liens produit/vente/achat et les mouvements horodatés (déduction, ajout, ajustement, restauration et retrait à l'annulation). Les traces historiques absentes ne doivent pas être inventées ou reconstituées automatiquement.
- Les rapports financiers et exports doivent rester Patron-only et continuer à utiliser les montants historiques des ventes, achats et dépenses.

### Contrat de migration à respecter

1. Migrer les produits par identifiant stable et conserver `name`, `category`, `sku`, `quantity`, `alertAt` et le prix catalogue autorisé dans le document public.
2. Migrer `purchasePrice` dans le document financier Patron-only, avec provenance indiquant qu'il s'agit du coût catalogue historique, et non d'un coût moyen calculé.
3. Conserver `sales.unitPrice`, `sales.total`, `purchases.amount`, `purchases.quantity`, les IDs, les statuts et les références de stock historiques sans recalcul.
4. Conserver séparément le journal de mouvements de stock et les relations `stockProductId`, `relatedSaleId`, `relatedPurchaseId`. Les identifiants de produits doivent rester stables.
5. Ne pas recalculer `purchasePrice` à partir de `purchases.amount / purchases.quantity` sans décision métier explicite : l'achat peut concerner plusieurs articles, contenir des frais, ou ne pas être lié à un seul produit.
6. Prévoir une décision produit sur l'évolution future du coût : coût catalogue manuel, dernier coût d'achat, ou coût moyen pondéré. Aucun de ces modèles ne doit être choisi implicitement.
7. Tester qu'une migration répétée ne crée ni double produit ni double mouvement, et qu'une annulation de vente/achat après migration garde les mêmes invariants de stock.

### Vérifications et limites

- Relecture ciblée des flux `openForm`, `saveForm`, vente, achat, `renderStock`, `renderPurchases`, `renderReports` et audit de cohérence du stock dans `application.html`.
- Aucune modification de `application.html` ni de `firestore.rules` dans cette passe.
- Aucune donnée réelle consultée ou modifiée ; aucun test Emulator ou navigateur ; aucune migration ou publication.
- Cette cartographie est fondée sur le code actuel de la branche et ne prouve pas le comportement d'un compte Firebase réel.

**Statut :** dépendances principales identifiées. La séparation technique peut maintenant être conçue sans confondre coût catalogue, montant d'achat et prix réel d'une vente.


## Audit complémentaire des autorisations Firestore multi-boutiques — 26 novembre 2026

### Constats confirmés à la lecture de firestore.rules

1. **Accès Patron non conditionné à l'abonnement pour certaines lectures.** `canUseShop(shopId)` renvoie vrai pour `isShopPatron(shopId)` sans vérifier l'abonnement ni le statut actif de la boutique. Cette fonction protège notamment la lecture du document racine de boutique, des produits, des ventes, clients, dettes et paiements. En conséquence, un Patron dont l'abonnement a expiré, ou dont la boutique est suspendue, conserve certaines lectures. Les écritures Patron passent en revanche par `canWriteShop`, qui vérifie le statut actif et l'abonnement.
2. **Lectures de gestion accessibles au Patron même sans abonnement actif.** La lecture des membres et de la présence est autorisée avec `isShopPatron` seul. Il faut décider explicitement si l'accès aux données d'administration doit être maintenu après expiration/suspension, et appliquer une politique cohérente.
3. **Schéma des produits partagé non verrouillé.** Les créations et mises à jour de `shops/{shopId}/products/{productId}` sont réservées au Patron, mais les règles ne limitent pas les clés autorisées dans `request.resource.data`. Comme Patron et vendeur peuvent lire le document produit entier via `canUseShop`, un champ financier ajouté par erreur dans ce document serait lisible par le vendeur. La séparation physique des documents financiers et la liste blanche des champs publics restent indispensables.
4. **Validations métier insuffisantes sur les écritures partagées.** Les créations de ventes vérifient `shopId` et `createdBy`, mais pas une liste blanche de champs, les montants, les quantités, les modes de paiement ni les références client/produit. Les créations de dettes vérifient essentiellement `shopId`, sans valider montant, client ou vente source. Les créations de paiements vérifient `shopId` et `createdBy`, sans contrôler la dette, le montant, la date ni le solde restant.
5. **Mises à jour Patron trop larges.** Les règles de mise à jour des ventes, dettes et paiements ne définissent pas de liste blanche des champs modifiables ni les invariants financiers à préserver. Le fait de réserver ces écritures au Patron ne suffit pas à empêcher les incohérences accidentelles ou les modifications abusives depuis un client compromis.
6. **Achats et dépenses : schéma à durcir.** Les règles vérifient le rattachement au `shopId` et le rôle Patron, mais ne valident pas une liste blanche complète, les types, les montants, les dates ou les relations de stock.
7. **Journal d'audit : création insuffisamment contrainte.** La règle vérifie le `shopId` et `actorUid`, mais ne fixe pas une liste blanche d'événements, les types/champs obligatoires ni la cohérence de la cible. Les mises à jour et suppressions sont bien interdites.

### Points positifs conservés

- Les données historiques sous `users/{userId}/comptivaData/main` restent limitées au compte propriétaire.
- L'accès vendeur aux sous-collections partagées est borné par le chemin de la boutique et par une appartenance active, avec contrôle de l'abonnement du Patron.
- Les écritures vendeur dans les produits, achats, dépenses et rapports sont refusées par les règles actuelles.
- Les suppressions directes des ventes, dettes, paiements, achats et dépenses partagés sont refusées.
- Les documents d'audit partagés ne peuvent pas être modifiés ou supprimés après création.
- Aucun changement de règle n'est effectué pendant cet audit : la politique d'accès après expiration doit être décidée avant de corriger les conditions de lecture.

### Corrections prioritaires à planifier

1. Définir la politique d'accès après expiration et suspension, puis harmoniser `canUseShop`, les lectures Patron, les lectures de gestion et les écritures.
2. Définir des schémas stricts et des listes blanches de champs pour produits publics, documents financiers, ventes, dettes, paiements, achats, dépenses et événements d'audit.
3. Ajouter des validations de montants, dates, quantités, relations croisées et invariants financiers. Les paiements concurrents et les mutations de stock devront passer par un mécanisme atomique de confiance (transaction serveur ou backend).
4. Écrire des tests Firebase Emulator couvrant explicitement les cas autorisés et refusés, notamment abonnement expiré, boutique suspendue, vendeur actif/inactif, compte étranger, champs financiers injectés et incohérences de paiement.
5. Ne pas appliquer ces durcissements aux chemins historiques avant une stratégie de compatibilité et de migration vérifiée.

### Vérifications et limites de cette passe

- Relecture de la totalité du fichier `firestore.rules` de la branche de travail et rapprochement avec le modèle multi-boutiques documenté.
- Analyse statique uniquement : aucun test Firebase Emulator, aucun compte réel, aucune requête Firestore réelle et aucune migration exécutés.
- Aucune modification des règles Firestore, de l'application ou des données. Aucune publication et aucune modification de `main`.

**Statut :** audit statique des principales autorisations partagé complété pour cette passe. Les risques ci-dessus sont documentés et doivent être corrigés et testés avant activation du modèle multi-boutiques.


## Audit et garde-fous des affectations Patron/Vendeur — 26 novembre 2026

### Audit complémentaire des règles d'accès

- Le Créateur peut lire/écrire les documents `merchantSubscriptions` et lire/supprimer les entrées `merchantDirectory`. Ces droits sont concentrés sur l'UID Créateur fixé dans les règles.
- Le Créateur peut lire un document racine `shops/{shopId}` et les documents `members` explicitement autorisés, mais les règles ne lui donnent pas automatiquement accès à toutes les sous-collections opérationnelles (ventes, dettes, paiements, produits, achats, dépenses).
- Un commerçant peut lire uniquement son document d'abonnement par `get`; la lecture de liste n'est pas accordée. La création personnelle est limitée à un essai avec une durée maximale de 14 jours. La modification et la suppression sont réservées au Créateur.
- Les données historiques `users/{uid}/comptivaData/main` restent lisibles par le propriétaire même après expiration ; les écritures historiques sont bloquées si l'abonnement n'est pas actif, sauf compte Créateur. Ce comportement correspond à une conservation en lecture seule et doit être clairement expliqué dans l'interface.
- Le Patron conserve actuellement certaines lectures du modèle partagé même si l'abonnement est expiré ou si la boutique est suspendue. C'est une politique de lecture seule partielle à formaliser, pas une preuve d'accès complet : les vendeurs sont toujours contrôlés par l'appartenance active et l'abonnement Patron.
- Les règles de suspension du vendeur reposent sur deux documents synchronisés : `shops/{shopId}/members/{uid}` et `userShopMemberships/{uid}/shops/{shopId}`. Les deux doivent rester concordants.

### Défaut applicatif corrigé partiellement

- Les fonctions d'affectation et de suspension/réactivation vendeur sont désormais protégées dans l'interface par `krediRequirePatron(...)`, en plus des règles Firestore.
- L'affectation écrit encore le document membre puis l'index dans deux opérations séquentielles. La règle actuelle de l'index utilise `get(memberPath)` pour vérifier l'état du membre déjà persisté. Un lot atomique utilisant cette règle pourrait donc être refusé ; il ne faut pas le substituer à la séquence sans adapter la règle avec `getAfter()` et valider le comportement dans Emulator.
- La suspension/réactivation suit également une séquence membre puis index et signale explicitement si la seconde étape échoue. Dans ce cas, les documents peuvent temporairement diverger ; il faut contrôler/réparer les deux documents avant une nouvelle tentative.
- Une future correction robuste devra choisir entre une opération serveur de confiance et une écriture batch avec règles `getAfter()`, puis couvrir affectation, suspension, réactivation, rollback et reprise après échec dans Emulator.

### Vérifications de cette passe

- Relecture des règles d'abonnement, de l'index d'affectation, des documents membres et des fonctions applicatives d'affectation/suspension.
- Contrôle statique : garde Patron présente dans les deux fonctions ; ordre membre puis index conservé pour rester compatible avec les règles actuelles ; message d'erreur de désynchronisation conservé.
- Les trois blocs JavaScript de `application.html` compilent : 3/3.
- Aucun test Firebase Emulator, aucun test de comptes réels, aucune requête Firestore réelle, aucune migration et aucun déploiement.
- Les règles Firestore n'ont pas été modifiées ; les données réelles ne sont pas touchées ; `main` reste intacte.

**Statut :** garde UI Patron renforcée pour les affectations. La synchronisation des deux documents reste non atomique et constitue un risque connu, explicitement reporté jusqu'à adaptation des règles et tests Emulator.


## Correction de cohérence des affectations vendeurs — 26 novembre 2026

### Changement applicatif

- Avant suspension/réactivation, l'application lit maintenant côté serveur le document membre et l'index d'appartenance.
- Elle vérifie leur existence, leur UID, leur boutique, leur rôle, leur Patron assignant et la concordance de leur état `active`.
- Si les deux documents sont absents ou incohérents, l'opération s'arrête avant toute écriture et demande une réparation contrôlée.
- Après mise à jour du membre, si l'écriture de l'index échoue, l'application tente de restaurer l'état `active` initial du membre.
- Si le retour arrière échoue aussi, un message d'alerte explicite demande de ne pas réessayer et de vérifier les deux documents.
- Le garde de rôle Patron reste obligatoire.

### Limites

- Les écritures membre et index restent deux opérations distinctes, car la règle actuelle de l'index vérifie le membre déjà persisté via `get()`. Une solution atomique exige une adaptation de règle utilisant `getAfter()` ou un backend fiable, puis des tests Emulator.
- Le retour arrière est une compensation applicative, pas une transaction distribuée. Une panne réseau prolongée peut empêcher la compensation ; l'alerte et la vérification serveur restent nécessaires.
- L'écriture de l'événement d'audit se produit après la mise à jour des deux documents. Si elle échoue, le changement d'état reste appliqué et l'interface l'indique ; l'événement manquant devra être réconcilié.

### Vérifications

- Vérification statique du précontrôle des deux documents, de la concordance des champs et du retour arrière après échec de l'index.
- Compilation des trois blocs JavaScript de `application.html` après relecture : 3/3 réussie.
- Aucun test Firebase Emulator ou compte réel dans cette passe ; aucune règle Firestore ni donnée réelle modifiée ; aucun déploiement ; `main` intacte.


## Audit et correction des sessions Firebase et de la présence vendeur — 26 novembre 2026

### Risque identifié

Une initialisation asynchrone d'un compte pouvait se poursuivre après que l'utilisateur avait changé de compte ou s'était déconnecté. En particulier, la lecture de l'abonnement pouvait se terminer tardivement, puis l'ancien callback pouvait encore demander le démarrage du suivi de présence.

### Correction applicative

- Le callback d'authentification vérifie de nouveau son jeton de session (isCurrentSession) immédiatement après l'attente de la vérification d'abonnement, avant de démarrer la présence.
- Les erreurs de démarrage de présence ne sont journalisées que si le callback appartient toujours à la session courante.
- krediStartSellerPresence capture UID, instance Firestore et epoch de session dès son entrée.
- Après chaque lecture serveur asynchrone, la fonction vérifie que l'UID, l'instance Firestore et l'epoch sont toujours ceux de la session qui l'a lancée.
- Le suivi vendeur exige une résolution de rôle confirmée et le même shopId ; une présence ancienne ne peut pas installer un heartbeat après changement de session.
- Les lectures de boutique Patron vérifient aussi ownerUid et patronUid.
- Le heartbeat vérifie la session avant chaque écriture et ne se programme que si la session reste valide après le premier signal.

### Limites restantes

- Cette correction protège l'initialisation et les écritures de présence côté client, mais ne remplace pas les règles Firestore ni un contrôle serveur de chaque opération métier.
- Une présence déjà écrite peut rester visible jusqu'à expiration de sa fenêtre d'affichage si le navigateur est fermé brutalement ; le heartbeat s'arrête au prochain nettoyage local, mais aucune suppression serveur immédiate n'est garantie.
- L'authentification Firebase et la vérification d'abonnement ont été inspectées statiquement. Aucun test multi-compte réel, navigateur, Android/iOS, ni test Firebase Emulator n'a été exécuté dans cette passe.
- La déconnexion explicite continue de conserver les données locales et avertit lorsque la synchronisation n'est pas confirmée. Aucun changement au mécanisme de sauvegarde/déconnexion n'a été introduit ici.

### Vérifications après correction

- Compilation des trois blocs JavaScript de application.html après relecture du fichier final : 3/3 réussie.
- Règles Firestore non modifiées.
- Aucun compte réel, aucune donnée réelle, aucune migration et aucun déploiement modifiés.
- Branche de travail uniquement ; main reste intacte.


## Durcissement des règles : validation croisée membre + index vendeur — 26 novembre 2026

### Écart de sécurité identifié

La fonction Firestore isActiveShopMember vérifiait auparavant le document shops/{shopId}/members/{uid}, mais ne vérifiait pas le document d'index userShopMemberships/{uid}/shops/{shopId}. En cas de divergence, un index marqué inactif ou supprimé pouvait donc ne pas suffire à bloquer une requête directe si le document membre restait actif.

### Correction des règles dans la branche de travail

- isActiveShopMember exige désormais l'existence des deux documents.
- Le document membre doit confirmer UID, rôle seller, active=true et assignedBy égal au Patron propriétaire.
- L'index privé doit confirmer UID, shopId, rôle seller, active=true et patronUid égal au Patron propriétaire.
- Une absence, une suspension, un index obsolète ou un rattachement à un autre Patron fait échouer le contrôle d'accès vendeur.
- Les opérations partagées qui s'appuient sur canWriteShop ou canUseShop héritent de cette validation croisée.
- Les droits directs du Patron propriétaire restent séparés de ce contrôle vendeur.

### Conséquence pour les affectations

Pendant une réactivation séquentielle, le vendeur reste bloqué tant que les deux documents ne sont pas actifs et cohérents. Pendant une suspension, le passage du document membre à inactive suffit à bloquer le vendeur, même si l'index n'a pas encore été mis à jour. Cette règle réduit l'effet d'une divergence, sans rendre les deux écritures atomiques.

### Tests et publication

- Cette modification concerne le fichier de règles dans la branche GitHub uniquement.
- Elle n'a pas été déployée dans Firebase.
- Les tests Firebase Emulator doivent confirmer les cas : deux documents actifs cohérents, membre inactif/index actif, membre actif/index inactif, index absent, UID/shopId/patronUid incohérent, abonnement expiré, boutique suspendue, Patron propriétaire.
- Vérifier les limites de lectures d'accès Firestore et l'évaluation des règles avec l'Emulator avant toute publication.
- Aucun test Emulator ou compte réel exécuté dans cette passe.


## Contrat de données métier avant durcissement des règles partagées — 26 novembre 2026

### Schéma effectivement produit par l'application historique

La lecture du formulaire `saveForm()` confirme les champs suivants pour les nouvelles opérations locales. Ils sont donnés comme inventaire du modèle historique, et non comme schéma Firestore cible déjà validé.

- **Vente** : `id`, métadonnées `createdByUid`, `createdByName`, `createdAt`, `updatedAt`, `product`, `quantity`, `unitPrice`, `total`, `date`, `saleType`, `clientId`, `method`, `paidAmount`, `creditAmount`, `cashPart`, `mobilePart`; selon le lien stock : `stockProductId`, `stockDeductedAt`, `stockDeductedQuantity`.
- **Dette** : `id`, métadonnées d'auteur, `clientId`, `amount`, `date`, `due`, `description`, et `saleId` lorsqu'elle provient d'une vente à crédit.
- **Remboursement** : `id`, métadonnées d'auteur, `debtId`, `amount`, `date`, `method`.
- **Client** : `id`, métadonnées d'auteur, `name`, `phone`, `address`, `note`.
- **Achat** : `id`, métadonnées d'auteur, `item`, `supplier`, `quantity`, `amount`, `date`, `method`, `note`; selon le lien stock : `stockProductId`, `stockAddedAt`.
- **Dépense** : `id`, métadonnées d'auteur, `category`, `description`, `amount`, `date`, `method`, `note`.
- **Produit historique** : `id`, métadonnées d'auteur, `name`, `category`, `sku`, `quantity`, `purchasePrice`, `salePrice`, `alertAt`.
- **Journal de stock** : `id`, `entityType`, `entityId`, `action`, `relatedSaleId` ou `relatedPurchaseId`, `quantity`, `before`, `after`, `at`, `actor`, `actorName`.

### Écarts à résoudre avant toute règle de validation

1. Le modèle historique utilise `createdByUid`; les règles partagées exigent `createdBy`. Une conversion ne peut être faite qu'après vérification de l'appartenance du compte à la boutique.
2. Le modèle historique n'ajoute pas `shopId` à ces objets, car ils sont conservés dans `users/{uid}/comptivaData/main`. La règle d'appartenance au chemin partagé ne peut donc pas être simplement appliquée à ces données.
3. Le code local valide plusieurs invariants métier — entiers GNF, quantités positives, somme des paiements mixtes égale au total, remboursement inférieur ou égal au solde, relations client/vente/dette — mais ces contrôles JavaScript ne sont pas des protections serveur.
4. Les règles partagées autorisent actuellement des créations avec peu de validation de champs et des mises à jour Patron sans liste blanche complète. En cas de déploiement isolé, un client pourrait donc soumettre des documents incohérents ou modifier des champs métier non prévus.
5. Les opérations stock/vente et dette/remboursement doivent être traitées comme des ensembles cohérents. Une simple règle sur chaque document ne prouve pas que les soldes, quantités et traces ont été modifiés ensemble.

### Décision de correction sûre

- Ne pas recopier le schéma historique dans les règles partagées sans spécifier les champs obligatoires, optionnels et immuables du modèle cible.
- Ne pas transformer `createdByUid` en `createdBy` par simple renommage ; l'identité doit être validée contre le membre actif de la boutique.
- Avant migration, définir les listes blanches distinctes pour création et modification de chaque collection, les champs immuables (`id`, `shopId`, auteur initial, dates de création et références), les types numériques/date, les montants autorisés et les invariants relationnels.
- Définir ensuite les opérations atomiques vente + mouvement de stock + dette éventuelle, puis remboursement + solde, avec validation serveur/Firestore Emulator. Les tests doivent inclure des écritures partielles, des références croisées vers une autre boutique, des montants négatifs ou non entiers, des surpaiements, des quantités de stock insuffisantes et des modifications d'auteur.
- Garder le chemin historique et ses règles owner-only inchangés jusqu'à validation de la migration complète.

### Vérifications de cette passe

- Relecture de `firestore.rules`, de `application.html` et des sections de migration de cette documentation sur la branche de travail.
- Inventaire des objets créés par `saveForm()` effectué par lecture statique.
- Confirmation que le modèle historique et les chemins partagés ne sont pas encore raccordés pour les opérations métier.
- Aucun changement de `firestore.rules` ni de `application.html` dans cette passe : les validations serveur ne peuvent pas être fixées sûrement tant que le schéma cible et les opérations atomiques ne sont pas définis.
- Aucun test Firebase Emulator, test navigateur, test de compte réel, migration, déploiement ou publication effectué.
- `main` reste intacte.


## Revue ciblée des règles d'écriture multi-boutiques — 26 novembre 2026

### Défauts de validation confirmés dans la version actuelle de `firestore.rules`

Cette revue porte uniquement sur le modèle cible `shops/{shopId}/...`. Elle ne signifie pas que ces collections sont actuellement utilisées par le parcours historique de l'application.

| Collection | Contrôle présent | Lacune restante |
|---|---|---|
| `sales` | `shopId` et `createdBy` à la création ; auteur et boutique conservés à la modification | Pas de liste blanche, champs obligatoires, types, montants, quantités, méthode de paiement ni relations client/produit ; modification Patron trop large |
| `debts` | Boutique vérifiée à la création et modification ; modification Patron-only | Pas de validation du client, montant, date, dette source, auteur ni solde ; modification trop large |
| `payments` | Boutique et auteur à la création ; modification Patron-only | Pas de validation de dette, montant, date, méthode, solde ou unicité ; modification trop large |
| `clients` | Boutique vérifiée à la création et modification ; suppression Patron-only | Pas de liste blanche ni de validation des champs ; un document peut contenir des champs inattendus |
| `purchases` / `expenses` | Écriture Patron-only et `shopId` contrôlé | Pas de schéma strict, de validation des montants/dates/types ni de champs immuables |
| `products` | Écriture Patron-only | Aucune validation de schéma ; lecture intégrale par Vendeur via `canUseShop`, donc risque de divulgation de champs financiers |
| `auditLog` | Création avec `shopId` et `actorUid` ; modification/suppression interdites | Pas de liste blanche, type d'événement, cible, horodatage serveur ni validation des champs de trace |

### Autres observations d'autorisation

- `canUseShop` autorise toujours les lectures Patron sur une boutique existante, même si son statut est suspendu ou son abonnement expiré. Les règles de lecture des collections partagées héritent de cette politique.
- `shops` autorise le `list` au propriétaire sur la base de `ownerUid`, sans contrôle du statut ou de l'abonnement.
- Les créations/modifications de documents `members` sont Patron-only et exigent `uid`, rôle vendeur, booléen `active` et `assignedBy`, mais les champs de profil/date restent partiellement optionnels et la modification ne fige pas explicitement `createdAt`.
- Les règles d'index `userShopMemberships` permettent au Patron propriétaire de modifier/supprimer son index sans vérifier l'abonnement actif. L'accès effectif du vendeur reste néanmoins bloqué par le statut de boutique et la vérification d'abonnement dans `isActiveShopMember`.

### Priorités avant toute modification des règles

1. Décider explicitement si un Patron expiré/suspendu conserve la lecture de ses archives et si cette politique diffère pour les vendeurs.
2. Définir le schéma cible versionné et les champs autorisés pour chaque collection ; ne pas déduire le schéma partagé directement des objets legacy.
3. Séparer les documents produits publics des informations financières Patron-only avant de permettre la lecture vendeur.
4. Fixer les champs immuables et les listes blanches pour chaque opération create/update.
5. Définir les invariants transactionnels : vente + stock + dette éventuelle ; remboursement + solde ; achat + mouvement de stock.
6. Écrire les tests Emulator positifs et négatifs correspondant à chaque règle, y compris requêtes/listes, batchs et transactions.

### Vérifications et limites

- Relecture complète de `firestore.rules` sur la branche de travail.
- Chaque collection opérationnelle et chaque règle `allow` ci-dessus a été comparée au contrat des objets historiques documenté précédemment.
- Aucune modification de règle dans cette passe : le schéma cible et la politique d'accès post-expiration doivent être arrêtés avant d'écrire des conditions potentiellement incompatibles.
- Aucune exécution Firebase Emulator, aucun test navigateur ou compte réel, aucune migration, aucun déploiement ni publication.
- Le chemin legacy `users/{uid}/comptivaData/main` reste inchangé et owner-only.
- `main` reste intacte.


## Correction ciblée — présence vendeur, déconnexion et hors ligne — 26 novembre 2026

### Comportement retenu dans le code

- **Signal serveur (heartbeat) :** un vendeur affecté et vérifié envoie un signal Firestore toutes les 30 secondes, uniquement si sa session est toujours la session courante, si l'application est visible et si la session n'est pas verrouillée.
- **Actualisation de l'affichage :** la liste du Patron recalcule les statuts localement toutes les 1 seconde. Ce rafraîchissement ne déclenche pas une lecture Firestore chaque seconde.
- **Seuil hors ligne :** sans signal serveur récent depuis plus de 3 minutes (180 000 ms), le vendeur est affiché « Hors ligne ».
- **Connecté :** affectation active, signal récent dans la fenêtre de 3 minutes et dernier état différent de « disconnected ».
- **Déconnecté :** lors d'une déconnexion volontaire, le client tente d'écrire immédiatement `clientState: 'disconnected'` et un horodatage serveur avant l'appel Firebase Auth `signOut()`. Cette tentative est limitée à 1,5 seconde pour ne pas bloquer durablement la déconnexion.
- **Coupure réseau / fermeture brutale :** si l'application ne peut pas écrire l'état « Déconnecté », le dernier signal vieillit et le statut passe automatiquement à « Hors ligne » après le seuil de 3 minutes.
- **Suspendu :** l'état d'affectation désactivée reste distinct des états de connexion.
- **Retour d'Internet :** le heartbeat est relancé après la vérification de l'abonnement et la validation de la session.
- **Déverrouillage après inactivité :** le suivi de présence est relancé après réauthentification.
- **Perte d'Internet :** le heartbeat local est arrêté ; aucune fausse confirmation de présence n'est envoyée hors connexion.

### Règles Firestore

- Le vendeur ne peut toujours écrire que son propre document de présence.
- La règle autorise maintenant les états `active` et `disconnected`, avec `lastSeen == request.time`, et conserve l'exigence d'une affectation vendeur active et d'un abonnement valide.
- La lecture des présences reste réservée au Patron de la boutique.

### Points de vigilance et tests restant à exécuter

- Le seuil de 3 minutes est calculé dans l'interface à partir de l'horodatage serveur comparé à l'horloge de l'appareil ; un décalage important de l'horloge du téléphone peut décaler l'affichage. Les droits d'accès restent, eux, vérifiés par Firestore.
- Si le vendeur perd le réseau, ferme brutalement l'application ou si la tentative de déconnexion échoue, le statut « Déconnecté » immédiat ne peut pas être garanti ; le basculement « Hors ligne » après expiration du signal est le mécanisme de secours.
- Le délai de 1 seconde concerne uniquement le recalcul visuel ; le heartbeat réseau reste à 30 secondes afin d'éviter des écritures Firestore excessives.
- À tester dans Firebase Emulator et sur appareils réels : connexion, déconnexion volontaire, fermeture forcée, perte et retour du réseau, application en arrière-plan, verrouillage après inactivité, vendeur suspendu, abonnement expiré et changement rapide de compte.
- Vérifier aussi les coûts et limites Firestore, les écritures en attente au moment de `signOut()` et le comportement du timeout de 1,5 seconde.

### Vérifications statiques après correction

- Les trois blocs JavaScript de `application.html` compilent : 3/3.
- Les contrôles statiques confirment le heartbeat 30 s, le rafraîchissement visuel 1 s, le seuil 180 s, l'écriture de déconnexion, la reprise après reconnexion et la règle Firestore correspondante.
- Aucun test Firebase Emulator, navigateur ou appareil réel n'a été exécuté.
- Aucune donnée réelle, aucun compte réel, aucune migration ni aucun déploiement n'ont été modifiés ; `main` reste intacte.


## Présence réciproque Patron ↔ vendeur — 26 novembre 2026

### Correction applicative

- Le Patron démarre maintenant son propre heartbeat de présence dans le document shops/{shopId}/presence/{patronUid} après vérification serveur de sa boutique principale, de son UID propriétaire et du statut actif de la boutique.
- Le vendeur déjà vérifié par le rôle et les deux documents d'affectation peut afficher un encart « Présence de votre Patron » sur son tableau de bord.
- L'application écoute uniquement le document de présence du Patron correspondant à l'affectation confirmée ; elle ne charge pas la liste des présences de la boutique.
- Le statut est recalculé localement chaque seconde, avec heartbeat réseau toutes les 30 secondes et bascule « Hors ligne » après 3 minutes sans signal.
- Les états « Connecté », « Déconnecté » et « Hors ligne » sont présentés sans exposer les ventes, les finances, les actions ni l'activité privée du Patron.
- Le nettoyage du suivi retire aussi l'écoute temps réel du statut Patron lors d'un changement de session.

### Règles Firestore

- Le Patron conserve la lecture de la collection de présences de sa boutique.
- Un vendeur actif peut effectuer un get uniquement sur le document dont l'identifiant est le patronUid de sa boutique ; list reste interdit au vendeur.
- Le Patron peut écrire uniquement son propre document de présence si son abonnement est actif.
- Le vendeur peut toujours écrire uniquement son propre document, avec affectation active et abonnement Patron valide.
- Les champs autorisés restent strictement uid, lastSeen, clientState, avec horodatage serveur obligatoire ; suppression interdite.

### Limite connue à ne pas masquer

- Le modèle actuel utilise un document unique par UID et par boutique. Si le même compte Patron ouvre plusieurs appareils simultanément, la déconnexion d'un appareil peut marquer « Déconnecté » alors qu'un autre appareil est encore actif. Une présence multi-appareils exacte nécessitera des documents de session par appareil et un agrégat ; cette correction ne prétend pas résoudre ce cas.
- Si le réseau est coupé ou l'application arrêtée brutalement, le statut passe à « Hors ligne » après expiration du dernier signal ; la déconnexion immédiate ne peut pas être garantie.

### Vérifications

- Vérification statique des chemins de lecture/écriture, du contrôle UID/Patron, du heartbeat, de l'écoute limitée au document Patron et du nettoyage de l'écoute.
- Compilation JavaScript et tests Firebase Emulator à exécuter après écriture de la version finale ; aucune vérification sur compte réel ou appareil n'est revendiquée.
- Aucun déploiement Firebase, aucune migration de données, aucun changement de main.


### Vérification complémentaire — course entre heartbeat et déconnexion

- Le suivi vendeur est maintenu après l'ajout de l'écoute du Patron : le vendeur continue d'émettre son propre heartbeat.
- Les écritures de présence sont sérialisées côté client afin d'éviter qu'un heartbeat déjà lancé ne termine après l'écriture « Déconnecté ».
- Lors d'une déconnexion volontaire, l'intervalle heartbeat est arrêté avant l'écriture de l'état « Déconnecté ».
- Vérification statique des deux heartbeat, de leur sérialisation, de l'arrêt avant déconnexion et compilation des trois blocs JavaScript : 3/3 réussie après cette correction.
- Aucun test Firebase Emulator, navigateur, compte réel ou appareil n'a été exécuté ; aucun déploiement ni changement de main.


## Audit complémentaire — présence multi-appareils : défaut confirmé et migration à préparer — 26 novembre 2026

### Constat confirmé dans le code actuel

- Le chemin de présence est unique par utilisateur et boutique : `shops/{shopId}/presence/{uid}`.
- Le Patron et le vendeur utilisent chacun ce document unique, quel que soit le nombre d'appareils ou d'onglets ouverts avec le même compte.
- Tous les heartbeats d'un même UID écrivent le même champ `lastSeen` et le même `clientState`.
- Une déconnexion volontaire depuis un appareil écrit `clientState: 'disconnected'` dans ce document commun. Elle peut donc faire afficher « Déconnecté » alors qu'une autre session du même compte envoie encore des heartbeats.
- La liste du Patron lit actuellement la collection `presence` et interprète un document par vendeur ; l'encart du vendeur écoute un seul document Patron.
- Les règles actuelles autorisent le Patron à lister les documents de présence et le vendeur actif à faire un get uniquement sur le document Patron. Elles n'autorisent pas encore une sous-collection de sessions.

### Décision de sécurité

Ne pas activer une migration partielle des présences vers des sessions avant de corriger ensemble l'application et les règles. Ne pas ajouter une règle permissive de lecture globale pour simplifier les requêtes.

### Schéma cible à implémenter et tester

- Conserver un document de présence parent par UID pour la compatibilité et l'état agrégé : `shops/{shopId}/presence/{uid}`.
- Ajouter des documents de session distincts sous `shops/{shopId}/presence/{uid}/sessions/{sessionId}`.
- Chaque session doit être liée à l'UID authentifié et contenir uniquement les champs nécessaires : identifiant de compte, horodatage serveur du dernier signal et état de session.
- Chaque onglet/appareil génère son propre identifiant de session. Une déconnexion ne marque que sa session ; elle ne peut pas déclarer l'ensemble du compte déconnecté.
- Le statut agrégé est « Connecté » si au moins une session a un signal récent et un état actif ; « Déconnecté » si aucune session active n'existe mais qu'une déconnexion volontaire récente est confirmée ; « Hors ligne » si aucune session récente n'existe sans confirmation de déconnexion.
- Les sessions anciennes doivent être nettoyées selon une politique documentée et sécurisée. Ne pas compter sur une suppression automatique tant qu'une politique TTL réellement configurée côté Firebase n'a pas été vérifiée.
- La lecture vendeur doit rester limitée aux sessions du seul UID Patron confirmé par l'affectation. Le vendeur ne doit jamais pouvoir lister les sessions d'autres vendeurs ou d'autres boutiques.
- Le Patron ne doit pouvoir lire que les sessions appartenant aux membres de sa boutique. Les écritures doivent rester limitées aux sessions de l'UID authentifié.
- Les documents parents historiques doivent rester lisibles pendant une période de compatibilité ; l'application ne doit pas interpréter un parent absent comme une déconnexion certaine pendant la transition.

### Tests de sécurité et de fonctionnement obligatoires

1. Même compte sur deux appareils : les deux sessions apparaissent actives.
2. Déconnexion appareil A : appareil B reste affiché connecté.
3. Perte réseau appareil A : appareil B reste connecté ; A passe hors ligne après expiration de son signal.
4. Déconnexion des deux appareils : statut déconnecté après confirmation des deux sessions.
5. Fermeture forcée et onglet fermé : expiration du signal sans fausse déconnexion immédiate.
6. Changement rapide de compte dans un onglet : aucune écriture tardive de l'ancien UID dans la session du nouveau compte.
7. Deux vendeurs distincts : chaque vendeur ne peut lire que les sessions du Patron, jamais celles de l'autre vendeur.
8. Tentative de création/écriture dans une session portant l'UID d'un autre utilisateur : refusée par Firestore.
9. Vendeur suspendu ou abonnement Patron expiré : les accès et heartbeats suivent exactement la politique d'accès existante.
10. Vérifier le nombre d'écouteurs, de lectures et d'écritures Firestore avec plusieurs vendeurs et appareils.

### État de cette passe

- Défaut multi-appareils confirmé par lecture statique de `application.html` et `firestore.rules`.
- Aucun changement applicatif ni changement de règle effectué dans cette passe : le schéma de sessions, la politique de nettoyage et les règles de lecture doivent être mis en œuvre ensemble pour ne pas créer une faille ou une présence incohérente.
- Cette section documente le plan de correction ; elle ne signifie pas que les sessions multi-appareils sont déjà prises en charge.
- Aucun test Firebase Emulator, navigateur, compte réel ou appareil exécuté.
- Aucun déploiement, aucune migration de données et aucune publication.
- `main` reste intacte.


### Correction complémentaire — temporisation de déconnexion — 26 novembre 2026

- Le délai maximal de 1,5 seconde utilisé pour attendre la confirmation d'une déconnexion dispose maintenant d'un identifiant et est annulé dans un bloc `finally`, que l'écriture réussisse ou échoue.
- Cela évite de laisser un minuteur temporaire actif après la fin de l'attente.
- L'écriture Firestore déjà lancée n'est pas annulée si le délai expire ; le mécanisme de sérialisation des écritures et le contrôle de session restent en place.
- Vérification statique : modification retrouvée après relecture GitHub ; les trois blocs JavaScript compilent avec `new Function`.
- Cette correction ne résout pas le défaut d'un document partagé entre plusieurs appareils. Le schéma multi-sessions décrit ci-dessus reste à implémenter et à tester.


## Correction complémentaire — arrêt des signaux en attente lors de la déconnexion (26 novembre 2026)

- Une déconnexion pouvait arrêter l’intervalle de heartbeat alors qu’un ancien signal `active` attendait encore la fin d’une écriture Firestore précédente. Comme l’utilisateur restait authentifié pendant la confirmation de déconnexion, ce signal en attente pouvait théoriquement être écrit après le marqueur `disconnected`.
- Le code bloque désormais les nouvelles écritures `active` dès le début de la déconnexion, y compris après l’attente d’une écriture précédente. Le marqueur `disconnected` reste autorisé.
- La tentative de déconnexion est aussi liée à l’époque de session (`krediSessionEpoch`) capturée au départ : un changement de session invalide l’ancienne tentative.
- Cette correction réduit une course locale entre heartbeat et déconnexion. Elle ne résout pas le défaut multi-appareils dû au document unique `presence/{uid}` : les sous-documents `sessions/{sessionId}` restent à concevoir et implémenter avec leurs règles et leurs tests.
- Vérification statique uniquement ; aucun test Firebase Emulator, navigateur, téléphone ou multi-appareils n’a été exécuté.


## Correction complémentaire — confirmation réelle du signal de déconnexion (26 novembre 2026)

- `krediWritePresenceState` peut renvoyer `false` lorsque la session a changé ou que le contexte n'est plus valide. La fonction d'appel ignorait auparavant cette valeur et renvoyait tout de même `true` dès que la promesse se terminait sans exception.
- La fonction vérifie maintenant explicitement `confirmed === true`. Une écriture refusée ou abandonnée n'est donc plus présentée comme une déconnexion confirmée ; le délai de trois minutes sans signal reste le mécanisme de repli.
- Vérification statique et compilation JavaScript uniquement ; aucun test Firebase réel ou multi-appareils n'a été effectué.


## Correction ciblée — reprise de présence après échec de déconnexion — 26 novembre 2026

- Défaut confirmé par lecture du flux `krediSignOut()` : le suivi de présence était arrêté et l'état `disconnected` pouvait être écrit avant l'appel `Firebase Auth signOut()`. Si cet appel échouait, l'utilisateur restait potentiellement connecté, mais son heartbeat n'était pas relancé ; son Patron pouvait donc le voir comme déconnecté jusqu'à une nouvelle initialisation ou au vieillissement du signal.
- Correction : dans le bloc d'échec de déconnexion, si le même UID est toujours connecté et que le réseau est disponible, COMPTIVA relance `krediStartSellerPresence()`. Le démarrage revalide le rôle et l'affectation avant de réémettre un signal actif. L'erreur de reprise est journalisée sans masquer l'erreur de déconnexion.
- La correction ne prétend pas résoudre la présence multi-appareils : le document parent unique par UID reste une limite connue ; les sessions par onglet/appareil ne sont pas encore implémentées.
- Vérifications prévues dans cette passe : relecture du fichier modifié, compilation des trois blocs JavaScript, contrôle statique du nouveau chemin et comparaison avec `main`.
- Aucun test Firebase Emulator, navigateur, appareil réel ou compte réel ; aucun déploiement, aucune migration et aucune publication.
- `main` reste intacte.


## Audit complémentaire — cycle de vie de présence et verrouillage — 26 novembre 2026

### Comportements confirmés par lecture du code
- Le verrouillage après 2 minutes d'inactivité conserve la session Firebase : il ne s'agit pas d'une déconnexion du compte.
- Pendant le verrouillage, le heartbeat de présence ne transmet plus de signal, car l'envoi vérifie l'état verrouillé. Le statut distant passe donc à `Hors ligne` après 3 minutes sans signal serveur.
- Après réauthentification réussie au déverrouillage, le code relance le suivi de présence et reprogramme le verrouillage d'inactivité.
- Le retour d'Internet vérifie l'abonnement du commerçant avant de reprendre la synchronisation, puis relance le suivi de présence. La perte d'Internet arrête le heartbeat local ; le statut distant dépend du vieillissement du dernier signal serveur.
- Les callbacks du suivi du Patron vérifient l'UID, l'époque de session et la boutique active avant de modifier l'interface ; les écouteurs sont retirés lors de l'arrêt du suivi.
- Le suivi du Patron côté vendeur lit uniquement le document de présence du Patron affecté. Les règles Firestore inspectées limitent également le `get` du vendeur au Patron indiqué dans les données de la boutique et réservent le `list` des présences au Patron.

### Limites et tests encore nécessaires
- Ces conclusions sont des vérifications statiques du code et des règles ; elles ne prouvent pas le comportement réel du SDK Firebase dans un navigateur ou sur plusieurs appareils.
- Le document parent `presence/{uid}` reste partagé entre tous les onglets/appareils d'un même compte. Un appareil qui se déconnecte peut donc encore écraser l'état d'un autre appareil actif. C'est la priorité de correction suivante : sessions individuelles sous `presence/{uid}/sessions/{sessionId}`.
- Les scénarios à tester sur Firebase Emulator puis sur appareils réels restent : verrouillage/déverrouillage, onglet masqué puis visible, coupure réseau, reconnexion, déconnexion refusée, changement de compte pendant une écriture, deux appareils simultanés, et vérification qu'un vendeur ne peut lire aucune présence d'un autre vendeur.
- Aucun test Emulator, navigateur, appareil réel, ni compte Firebase réel n'a été exécuté dans cet audit. Aucun changement des règles Firestore n'a été fait dans cette passe.


## Correction ciblée — nettoyage des écouteurs de présence lors d'un changement de compte — 26 novembre 2026

### Défaut constaté
- Le suivi de présence des vendeurs dans l'espace Patron utilise deux écouteurs Firestore (liste des membres et collection de présence) ainsi qu'un minuteur de rendu local.
- Ces écouteurs étaient arrêtés lors d'une déconnexion complète et lors d'un nouvel appel manuel à l'actualisation, mais pas explicitement au début de chaque transition d'état Firebase Auth.
- En cas de passage direct d'un compte à un autre sans état intermédiaire déconnecté, les callbacks refusaient déjà de modifier l'interface si l'UID ne correspondait plus, mais les anciens écouteurs pouvaient rester actifs et continuer à consommer des lectures.

### Correction appliquée
- Au début de chaque callback onAuthStateChanged, après incrément de l'époque de session, COMPTIVA retire les écouteurs de membres et de présence et arrête le minuteur de rendu du suivi Patron.
- Les callbacks déjà en vol sont invalidés par le changement d'époque de session et les nouveaux écouteurs ne sont recréés qu'à la demande du compte actuellement authentifié.
- Le nettoyage existant lors de la déconnexion est conservé ; il devient simplement redondant et sans effet si les écouteurs ont déjà été retirés.
- Cette correction ne modifie ni les règles Firestore, ni les documents de présence, ni les données métier.

### Limites et vérifications
- Cette correction réduit les écouteurs abandonnés lors d'un changement direct de compte ; elle ne résout pas le défaut multi-appareils du document parent unique presence/{uid}.
- Vérifications statiques et compilation JavaScript à effectuer après relecture de la version enregistrée.
- Aucun test Firebase Emulator, navigateur, appareil réel ou compte réel exécuté ; aucun déploiement, migration ou publication.
- main reste intacte.

## Correction complémentaire — arrêt complet de la présence à chaque transition Auth — 26 novembre 2026

- Le nettoyage précédent retirait les écouteurs Patron, mais un heartbeat de l'ancien compte pouvait rester programmé lors d'un changement direct d'utilisateur Firebase sans état intermédiaire déconnecté.
- La transition Auth appelle désormais aussi `krediStopSellerPresence()` immédiatement après l'incrément de l'époque de session. Cela arrête l'intervalle heartbeat, retire l'écoute du Patron et efface le contexte local de présence de l'ancien compte.
- Le nouveau compte ne redémarre sa présence qu'après les vérifications habituelles de rôle, d'affectation, de boutique et d'abonnement.
- Cette correction ne marque pas artificiellement l'ancien compte comme déconnecté : si son signal de déconnexion n'a pas été confirmé, l'expiration des 3 minutes reste le mécanisme de repli.
- Elle ne résout toujours pas la collision entre deux appareils partageant le même document parent `presence/{uid}`. La solution par sessions individuelles reste à implémenter et à tester.
- Aucun test Firebase Emulator, navigateur, appareil réel ou compte réel exécuté ; aucun déploiement, migration ou publication ; `main` reste intacte.

## Audit complémentaire — architecture de présence multi-sessions et coût des lectures — 26 novembre 2026

### Vérifications statiques de la version actuelle

- Le suivi Patron utilise actuellement un écouteur sur `shops/{shopId}/members` et un écouteur sur toute la collection `shops/{shopId}/presence`. Le rendu local est recalculé chaque seconde ; cela ne signifie pas une lecture Firestore chaque seconde.
- Le suivi côté vendeur écoute un seul document : `shops/{shopId}/presence/{patronUid}`.
- Les écritures heartbeat Patron et vendeur ciblent le document parent unique `presence/{uid}`, avec `lastSeen` et `clientState`.
- Aucun identifiant de session par onglet/appareil n'est actuellement créé dans `sessionStorage` ou `localStorage` pour la présence.
- Les règles Firestore actuelles ne déclarent aucune règle imbriquée `presence/{memberUid}/sessions/{sessionId}`. Il ne faut donc pas commencer à écrire ces documents avant une mise à jour coordonnée des règles.

### Décision d'architecture avant implémentation

- Une sous-collection de sessions par UID est nécessaire pour éviter qu'une déconnexion sur un appareil écrase le statut d'un autre appareil actif.
- Le Patron peut suivre les sessions de ses vendeurs avec des écouteurs ciblés par UID de membre ; le nombre d'écouteurs et de documents lus dépendra donc du nombre de vendeurs et des sessions actives. Cette charge doit être mesurée et limitée, et les écouteurs doivent être retirés lors de toute transition Auth, suspension ou changement de boutique.
- Le vendeur ne doit écouter que les sessions de son Patron confirmé par l'affectation active. Aucune lecture globale de toutes les sessions de la boutique ne doit être accordée au vendeur.
- Un agrégat écrit directement par les clients ne doit pas être considéré comme une vérité fiable : plusieurs appareils peuvent écrire simultanément et un client ne peut pas prouver à lui seul qu'aucune autre session n'est active.
- Une agrégation serveur automatisée serait plus centralisée, mais elle dépendrait d'un service serveur et de son coût/configuration. Ne pas introduire de Cloud Function ni supposer qu'elle est disponible sur le projet Firebase actuel sans décision explicite sur le plan et les coûts.
- Les identifiants de session devront être propres à chaque onglet, non prédictibles et conservés uniquement dans `sessionStorage` pour éviter qu'un onglet copie l'identité d'un autre. Ils ne doivent contenir aucune donnée personnelle ni servir d'empreinte d'appareil.
- Pendant la transition, les documents parents existants devront rester compatibles. Un parent ancien ou absent ne doit pas être interprété comme une déconnexion volontaire certaine.

### Prochaine mise en œuvre requise

1. Ajouter la création et la validation locale d'un identifiant de session par onglet après vérification Auth, rôle et boutique.
2. Écrire les heartbeats et déconnexions uniquement dans le document de cette session ; ne plus laisser une session déclarer seule l'ensemble du compte déconnecté.
3. Ajouter des règles imbriquées strictes : écriture uniquement par l'UID propriétaire, lecture Patron limitée aux membres de sa boutique, lecture vendeur limitée au seul Patron affecté, champs autorisés minimaux et horodatage serveur obligatoire.
4. Adapter l'affichage Patron pour agréger les sessions de chaque vendeur, avec un nombre d'écouteurs borné et un nettoyage garanti.
5. Adapter l'encart vendeur pour agréger uniquement les sessions du Patron.
6. Définir le vieillissement des sessions abandonnées sans supposer qu'un TTL Firebase est configuré ; ne pas supprimer automatiquement les sessions sans politique vérifiée.
7. Exécuter les tests Emulator multi-appareils et d'isolation avant toute publication.

### Résultat de cette passe

- Le modèle parent unique, les lectures actuelles et l'absence de sessionId ont été vérifiés statiquement dans le code et les règles.
- Aucun code applicatif ni aucune règle Firestore n'a été modifié dans cette passe : la migration doit être coordonnée pour ne pas laisser l'application écrire dans un chemin refusé ou ouvrir une lecture trop large.
- La correction Auth précédente (arrêt des écouteurs et du heartbeat lors de chaque transition de compte) reste en place.
- Aucun test Firebase Emulator, navigateur, compte réel ou appareil exécuté ; aucun déploiement, aucune migration de données, aucune publication.
- La branche de travail reste distincte de `main` ; `main` n'est pas modifiée.


## Correction — invalidation des anciennes instances du suivi de présence — 26 novembre 2026

- Ajout d'un compteur de génération pour le suivi de présence du Patron. Chaque réouverture du suivi invalide les rappels et callbacks appartenant à l'instance précédente, même si le même UID reste connecté.
- Les callbacks des écouteurs membres et présences, leurs erreurs, le rendu périodique et le bloc de gestion d'erreur vérifient maintenant que leur génération est toujours courante avant de modifier l'interface.
- Chaque transition Auth invalide également la génération du suivi, en plus du nettoyage des écouteurs déjà en place.
- Correction ciblée sur l'interface du suivi des présences ; aucune règle Firestore, donnée métier, vente, stock ou abonnement n'a été modifié.
- Vérification statique : les trois blocs JavaScript de la version modifiée compilent. Aucun test Firebase Emulator, navigateur, appareil ou compte réel n'a été exécuté.


## Correction — contrôle du rôle et de l'abonnement avant le suivi Patron — 26 novembre 2026

- La fonction de rafraîchissement de la liste des présences retirait les anciens écouteurs, mais ne vérifiait pas elle-même le rôle Patron confirmé ni l'accès par abonnement avant d'en créer de nouveaux. Les règles Firestore protégeaient déjà les données et refusaient les lectures non autorisées ; il manquait néanmoins un contrôle préalable côté interface.
- La fonction invalide maintenant d'abord la génération précédente, retire les écouteurs et le minuteur existants, puis vérifie l'authentification, le rôle Patron confirmé et l'accès à l'application avant toute nouvelle souscription.
- Un vendeur ou un compte dont le rôle Patron n'est pas confirmé ne peut donc pas démarrer ce suivi depuis cette fonction. Un abonnement non confirmé bloque également la création des écouteurs, sauf compte Créateur.
- Les règles Firestore et les données de présence ne sont pas modifiées. Le défaut multi-appareils lié au document parent unique `presence/{uid}` demeure connu ; les sessions individuelles ne sont pas encore implémentées.
- Vérifications statiques et compilation JavaScript effectuées après relecture GitHub. Aucun test Firebase Emulator, navigateur, téléphone ou compte réel ; aucun déploiement, migration ou publication. `main` reste intacte.


## Correction — génération propre au cycle de présence vendeur/Patron — 26 novembre 2026

- Constat : le listener du document de présence du Patron et les opérations asynchrones du démarrage contrôlaient l'UID, la session Auth et la boutique, mais pas l'instance précise du cycle de présence. Un callback déjà mis en file pouvait donc survivre à un arrêt puis à un redémarrage rapide du suivi du même compte dans la même boutique.
- Ajout de `krediPresenceRunEpoch`, incrémenté à chaque arrêt du suivi. Chaque démarrage capture sa génération et sa fonction `isCurrent()` refuse désormais les callbacks et opérations de toute génération précédente.
- Le contrôle est local à l'interface : aucun nouveau document, champ Firestore, droit ou changement de règle n'est introduit. Les données de présence existantes restent inchangées.
- Cette correction complète la génération dédiée à la liste des vendeurs ; elle ne résout pas le problème distinct des appareils multiples qui partagent encore `presence/{uid}`. L'architecture de sessions individuelles reste à concevoir et tester avant migration.
- Compilation JavaScript statique et relecture GitHub effectuées après la modification. Aucun test Firebase Emulator, navigateur, téléphone ou compte réel ; aucun déploiement, migration ou publication. `main` reste intacte.


## Correction — isolation des écritures de présence par compte et boutique — 26 novembre 2026

- Défaut constaté : un verrou global unique sérialisait toutes les écritures de présence de l'application. Une écriture Firestore lente ou encore en attente pour un ancien compte pouvait retarder les signaux d'un autre compte, même lorsque celui-ci utilisait une autre boutique.
- Correction : le verrou est maintenant une table de promesses indexée par le couple boutique/UID. Les écritures du même compte dans la même boutique restent ordonnées ; les comptes ou boutiques distincts ne se bloquent plus mutuellement.
- Le verrou d'une clé est libéré uniquement si la promesse terminée est toujours celle enregistrée pour cette clé, afin de ne pas effacer le verrou d'une écriture plus récente.
- Limite : une écriture Firestore déjà soumise n'est pas annulée. Une écriture précédente du même UID et de la même boutique peut encore retarder l'écriture suivante tant qu'elle n'est pas résolue. La séparation par session individuelle et les tests multi-appareils restent nécessaires.
- Vérifications : relecture GitHub, contrôle statique de l'absence de l'ancien verrou global, compilation des trois blocs JavaScript et comparaison de branche. Aucun test Firebase Emulator, navigateur, appareil ou compte réel n'est revendiqué.
- Aucun changement des règles Firestore, aucune migration, aucun déploiement ni publication ; main reste intacte.


## Correction — aucune initialisation de présence pendant le verrouillage d'inactivité — 26 novembre 2026

- Défaut constaté : lors du retour d'Internet pendant que l'écran restait verrouillé après 2 minutes d'inactivité, le gestionnaire réseau pouvait relancer le démarrage de présence et effectuer la lecture serveur de l'index des boutiques, même si les signaux actifs étaient ensuite ignorés par le contrôle du verrou.
- Correction : `krediStartSellerPresence()` quitte maintenant immédiatement si `window.comptivaIsIdleLocked()` indique que l'écran est verrouillé. Aucun chargement de l'index ni écouteur de présence n'est démarré dans cet état. Le déverrouillage réussi appelle déjà `krediStartSellerPresence()` et reprend le suivi.
- Comportement conservé : le verrouillage reste local à l'appareil ; l'absence de heartbeat fait vieillir le dernier signal et le statut distant devient « Hors ligne » après 3 minutes. Aucune déconnexion Firebase n'est provoquée.
- Limite : la présence multi-appareils partage toujours un document par UID et doit faire l'objet de la correction par sessions individuelles. Les transitions réelles doivent être testées sur navigateur et Firebase Emulator avant production.
- Vérifications : relecture du fichier enregistré, contrôle de la condition de verrouillage, compilation des trois blocs JavaScript et comparaison de branche. Aucun test Firebase Emulator, navigateur, téléphone ou compte réel n'est revendiqué.
- Aucun changement des règles Firestore, aucune migration, aucun déploiement ni publication ; `main` reste intacte.


## Correction — génération de session vérifiée après les attentes Auth et réseau — 26 novembre 2026

- Défaut constaté : le déverrouillage après réauthentification et la reprise après retour d'Internet vérifiaient principalement l'UID. Si une session changeait puis revenait rapidement au même UID, une opération asynchrone ancienne pouvait encore sembler concerner le compte courant.
- Déverrouillage : capture de `krediSessionEpoch` au début de la demande ; après la réauthentification, vérification de la génération, de l'UID courant, de `krediAuth.currentUser` et du maintien du verrou. Le gestionnaire d'erreur vérifie aussi que la demande appartient encore à l'écran verrouillé courant avant de modifier son message.
- Retour réseau : capture de la génération au démarrage de l'événement `online`, puis contrôle de génération, UID et correspondance du stockage après la vérification d'abonnement et avant la reprise de synchronisation/présence.
- Ces gardes empêchent une ancienne continuation de poursuivre son travail après un changement de session. Elles ne remplacent pas les tests réels ni le modèle de présence multi-appareils par sessions.
- Vérifications : relecture GitHub, contrôle des deux gardes, compilation des trois blocs JavaScript et comparaison de branche. Aucun test Firebase Emulator, navigateur, appareil ou compte réel n'est revendiqué.
- Aucun changement des règles Firestore, aucune migration, aucun déploiement ni publication ; `main` reste intacte.


## Correction — garde de session à l'intérieur des transactions cloud — 26 novembre 2026

- Audit : les appels de transaction vérifiaient la session après la résolution de la transaction, mais le callback Firestore pouvait attendre une lecture serveur avant de préparer `transaction.set`.
- Correction : `krediWriteCloudIfUnchanged` exige désormais une fonction `isCurrent`, vérifie la session avant de démarrer la transaction et la revérifie immédiatement après `transaction.get`, avant toute préparation d'écriture. Les deux chemins (fusion initiale après lecture du snapshot et sauvegarde différée) transmettent leur garde de session propre.
- Une session devenue obsolète pendant la lecture transactionnelle interrompt le callback avec le code `comptiva/stale-session`. Les gestionnaires existants ignorent alors la continuation si leur session n'est plus courante.
- Limite importante : une écriture déjà envoyée au serveur ne peut pas être annulée par JavaScript ; cette garde réduit la fenêtre de course mais ne constitue pas une garantie d'annulation atomique en cas de changement intervenant après la préparation du commit. Les règles Firestore restent la barrière d'autorisation côté serveur.
- Vérifications : relecture, confirmation des trois occurrences (définition + deux appels), compilation des trois blocs JavaScript et comparaison de branche. Aucun test Firebase Emulator, navigateur, appareil ou compte réel n'est revendiqué.
- Aucun changement des règles Firestore, aucune migration, aucun déploiement ni publication ; `main` reste intacte.


### Garde-fou supplémentaire entre Firebase Auth et l'espace local — 26 novembre 2026

L'audit a identifié une fenêtre de course : Firebase peut déjà avoir changé `currentUser` alors que le rappel `onAuthStateChanged` n'a pas encore terminé de basculer `krediUser` et `STORE`. Un contrôle basé uniquement sur l'UID mémorisé et le nom de l'espace local pouvait donc laisser une courte possibilité d'enregistrer ou de programmer une sauvegarde pour l'ancienne session. La vérification centrale `krediStoreMatchesActiveUser()` exige maintenant que l'utilisateur Firebase courant corresponde exactement à `krediUser` (et qu'il n'existe pas d'utilisateur Firebase lorsqu'on est en mode invité). Les gardes de l'initialisation Auth, de la sauvegarde différée et de la reconnexion contrôlent aussi explicitement `krediAuth.currentUser.uid`.

Cette barrière bloque les opérations locales et cloud dès que l'identité Auth courante ne correspond plus à l'identité applicative, même avant la fin du rappel de transition. Elle ne peut pas annuler une écriture Firestore déjà envoyée au serveur ; les règles Firestore restent indispensables.

Vérifications prévues après modification : compilation des trois scripts intégrés, recherche des gardes modifiées et comparaison de la branche avec `main`. Aucun test navigateur, appareil, Firebase Emulator, compte réel, ni déploiement n'est couvert par cette correction.


### Marqueur durable avant déconnexion avec synchronisation non confirmée — 26 novembre 2026

L'audit de `krediSignOut()` a relevé qu'une déconnexion pouvait être considérée comme risquée (modifications locales, sauvegarde différée/en cours, synchronisation cloud non confirmée) sans garantir que le marqueur `comptiva_pending_{uid}` soit présent. Or ce marqueur permet à la prochaine session du même compte de traiter la base locale comme des données en attente et d'appliquer les protections de conflit au lieu de considérer trop tôt la copie cloud comme seule référence.

Avant la déconnexion, l'application tente maintenant d'écrire durablement ce marqueur lorsque `cloudPending` est vrai. Si l'écriture échoue, elle affiche un avertissement distinct demandant de ne pas changer de compte sur cet appareil et de faire une copie de récupération avant reprise. La copie locale de la base reste effectuée avant l'appel à Firebase Auth, comme auparavant. Cette correction ne garantit pas que le serveur ait reçu les opérations ; elle préserve explicitement leur état d'attente pour la prochaine connexion lorsque le stockage local accepte l'écriture.

Contrôles statiques : présence du marqueur avant `signOut()`, message d'avertissement adapté à l'échec du marqueur et compilation des trois scripts intégrés. Aucun test réel navigateur, stockage saturé, Firebase Emulator ou compte Firebase n'a été effectué.


### Marqueur d'attente écrit avant la sauvegarde locale — 26 novembre 2026

L'audit a examiné la séquence de `saveDB()`. Le marqueur `comptiva_pending_{uid}` était écrit dans `krediQueueCloudSave()`, appelée immédiatement après la sauvegarde locale, mais seulement après le retour de `localStorage.setItem(STORE, ...)`. Pour réduire la fenêtre de crash entre ces deux opérations, `saveDB()` tente désormais d'écrire le marqueur du compte authentifié avant d'écrire la base locale. La file de synchronisation conserve sa propre tentative et ses contrôles existants. Si le marqueur initial échoue, la sauvegarde locale n'est pas supprimée ; un avertissement est journalisé et la file retente immédiatement l'écriture. Si l'enregistrement local échoue après l'écriture du marqueur, celui-ci reste présent : au prochain démarrage, le traitement prudent de conflit est préférable à une fusion silencieuse.

Vérifications statiques après modification : compilation des trois blocs JavaScript intégrés, présence du marqueur avant `localStorage.setItem(STORE, ...)`, relecture GitHub après commit et comparaison de branche. Aucun test de crash réel, navigateur, appareil, Firebase Emulator ou compte réel n'est revendiqué. Aucun déploiement ni publication ; `main` reste intacte.


### Recontrôle de la sauvegarde au dernier instant avant déconnexion Auth — 26 novembre 2026

L'audit a relevé que `krediSignOut()` calculait l'état de synchronisation en attente et sauvegardait la base avant `krediMarkSellerDisconnected()`, opération asynchrone pouvant attendre jusqu'à son délai réseau. Une modification déclenchée pendant cette attente pouvait donc survenir après la dernière sauvegarde prise en compte. La déconnexion recalcule maintenant l'état d'attente après la fermeture de présence, vérifie que Firebase Auth correspond toujours au compte initial, réenregistre le snapshot local le plus récent, puis retente le marqueur si nécessaire, avant `krediAuth.signOut()`. Si l'identité a changé pendant l'attente, la déconnexion est interrompue plutôt que de déconnecter une autre session.

Vérifications statiques : compilation des trois scripts, contrôle de la garde d'UID et de l'ordre sauvegarde/marqueur/signOut, relecture après commit et comparaison avec `main`. Aucun test de course réel, navigateur, appareil, Firebase Emulator ou compte réel n'est revendiqué. Aucun déploiement ni publication ; `main` reste intacte.


### Protection du cache local d'abonnement corrompu — 26 novembre 2026

L'audit des espaces de stockage par compte a identifié un angle mort distinct de la base commerciale : `loadSubscription()` remplaçait silencieusement un cache d'abonnement illisible par des valeurs par défaut, sans conserver le contenu brut. Le cache est désormais validé comme objet JSON ; en cas de JSON invalide ou de forme racine incorrecte, l'application tente d'enregistrer le contenu original sous `comptiva_subscription_v1_{uid}_corrupt_backup_{timestamp}`, consigne le problème et retourne des valeurs neutres. La vérification d'abonnement côté serveur reste la source de vérité ; ce correctif ne donne aucun droit d'accès supplémentaire et ne transforme pas un cache local en preuve de paiement.

Contrôles statiques : validation de la modification ciblée, compilation des trois blocs JavaScript intégrés, relecture des deux fichiers après commit et comparaison de la branche avec `main`. Aucun test de corruption réelle du stockage, navigateur, appareil, Firebase Emulator ou compte réel n'est revendiqué. Aucun déploiement ni publication ; `main` reste intacte.


### Protection des coûts produits dans les règles Firestore — 26 novembre 2026

L'audit des règles du modèle multi-boutiques a confirmé que les vendeurs actifs pouvaient lire les documents `shops/{shopId}/products/{productId}`. Or les produits contiennent notamment `purchasePrice`, et Firestore ne fournit pas de filtrage champ par champ à la lecture d'un document : autoriser la lecture du document complet expose aussi ses champs de coût et de marge. La règle `products` est donc resserrée à `isShopPatron(shopId)` pour toutes les lectures. Les écritures étaient déjà Patron uniquement.

Conséquence volontaire : le catalogue produit partagé ne doit pas encore être activé côté vendeur. Avant migration, il faudra séparer les données visibles du catalogue (nom, référence, quantité nécessaire à la vente, prix de vente) des coûts privés (prix d'achat, marge et données financières), puis ajouter des règles et des tests Emulator adaptés. Le diagnostic de collision de migration peut lire les produits pour le Patron ; aucun usage vendeur de cette collection n'a été identifié dans le code applicatif inspecté. Les ventes restent lisibles par les vendeurs car leur structure actuelle ne contient pas de champ de coût produit ; cette hypothèse devra être revalidée lors de la migration.

Contrôles statiques : modification exacte de la règle, compilation des trois blocs JavaScript intégrés, relecture GitHub après commit et comparaison de branche. Les règles Firestore n'ont pas été déployées ni testées dans Firebase Emulator ou sur un compte réel. Aucun déploiement ni publication ; `main` reste intacte.



### Audit des droits d'écriture sur les opérations commerciales — 26 novembre 2026

L'examen croisé de `firestore.rules` et du schéma réellement produit par `saveForm()` révèle plusieurs autorisations trop larges dans le modèle multi-boutiques préparatoire :

- **Ventes :** la création vérifie `shopId` et `createdBy`, mais ne limite pas les champs acceptés ni ne valide les valeurs métier. Le modèle local actuel utilise `createdByUid`, `createdByName`, `createdAt` et `updatedAt` ; il ne faut donc pas confondre ces noms avec le champ cible `createdBy` sans une conversion explicite et contrôlée.
- **Clients :** la création ne vérifie que `shopId`. La mise à jour permet actuellement de modifier tout le document, y compris potentiellement l'identifiant d'auteur et les dates de création. Le modèle local connu contient `id`, les quatre métadonnées d'auteur, `name`, `phone`, `address` et `note`.
- **Dettes :** la création ne vérifie que `shopId`, sans auteur ni liste de champs autorisés. Le modèle local connu contient `id`, les métadonnées d'auteur, `clientId`, `amount`, `date`, `due`, `description` et, pour une dette issue d'une vente, `saleId`.
- **Remboursements :** la création vérifie `shopId` et `createdBy`, mais n'impose pas de liste de champs, de montant positif, ni de relation vérifiée avec une dette de la même boutique. Le modèle local connu contient `id`, les métadonnées d'auteur, `debtId`, `amount`, `date` et `method`. La mise à jour reste réservée au Patron et la suppression est interdite.

Le code applicatif inspecté utilise ces chemins de boutique pour des lectures de diagnostic, de contrôle de doublons et de relations ; aucune procédure d'écriture/migration de ces collections vers le modèle partagé n'a été identifiée dans les blocs examinés. L'application continue d'enregistrer les opérations dans la base locale historique du compte. Les règles multi-boutiques restent donc préparatoires et ne sont pas une protection déjà activée pour les opérations quotidiennes.

**Décision de sécurité :** ne pas ajouter maintenant des listes de champs ou validations supposées aux règles en se basant uniquement sur le schéma local. La conversion vers le schéma partagé doit d'abord être définie pour chaque collection, notamment les noms d'auteur, les champs de statut/annulation et les métadonnées d'audit. Une restriction improvisée pourrait bloquer des documents valides ou laisser une faille sous un autre nom de champ.

**Corrections obligatoires avant activation de la migration :**
1. Définir un schéma partagé versionné et une liste blanche de champs par collection.
2. Pour les créations, imposer un auteur UID égal à `request.auth.uid`, un `shopId` égal au chemin et des montants/dates/types valides.
3. Pour les clients, rendre immuables l'identifiant, l'auteur initial et la date de création ; n'autoriser au vendeur que les champs de contact explicitement nécessaires.
4. Pour les dettes et remboursements, vérifier côté serveur les références client/dette/vente dans la même boutique. Interdire au vendeur de modifier ou supprimer un remboursement validé ; toute correction Patron doit être traçable.
5. Pour les ventes, conserver l'interdiction de modification vendeur et de suppression ; valider les montants, les parts de paiement, l'auteur et les relations avant création.
6. Écrire les tests Firebase Emulator couvrant les champs ajoutés, les UID falsifiés, les montants négatifs, les références hors boutique, les modifications d'auteur et les tentatives d'annulation/suppression.

**Contrôles de cet audit :** lecture des règles et des structures de création locales ; vérification des occurrences d'accès aux collections partagées dans `application.html`. Aucun changement des règles Firestore, aucune migration, aucun test Firebase Emulator, aucun déploiement ni publication. `main` reste intacte.



### Audit de la traçabilité et de l'historique des corrections — 26 novembre 2026

L'examen des règles `auditLog`, `sales`, `debts`, `payments` et `clients` fait ressortir deux limites importantes du modèle multi-boutiques préparatoire :

1. **Un événement d'audit peut être déclaré par son auteur sans validation de son contenu.** La création dans `shops/{shopId}/auditLog/{eventId}` vérifie `shopId` et `actorUid == request.auth.uid`, mais ne limite pas les champs, ne valide pas les types/valeurs et ne vérifie pas que l'événement correspond à une opération réellement créée ou modifiée dans la même écriture atomique. Un utilisateur authentifié peut donc tenter de produire un événement trompeur en attribuant à sa propre identité une action ou des valeurs non vérifiées. La règle interdit bien la modification et la suppression des événements après création, mais cela ne garantit pas la véracité de leur contenu initial.
2. **Les modifications autorisées au Patron ne sont pas conditionnées à une trace d'audit atomique.** Les règles autorisent au Patron la mise à jour de ventes, clients, dettes et remboursements (selon les restrictions propres à chaque collection), sans exiger qu'un événement correspondant soit créé dans le même commit Firestore. L'historique append-only ne suffit donc pas, à lui seul, à garantir qu'une correction métier est toujours journalisée.

La création d'un événement par le vendeur peut être nécessaire pour tracer ses opérations, mais le client ne doit pas pouvoir fabriquer une preuve d'encaissement, d'annulation ou de correction. Un simple contrôle de `actorUid` prouve seulement l'identité du compte qui a soumis l'événement, pas que l'action décrite a effectivement eu lieu.

**Mesures obligatoires avant activation :**
- Définir un schéma d'événement versionné et une liste blanche stricte de champs : identifiant, boutique, acteur, type d'entité, identifiant de l'entité, action autorisée, horodatage serveur et références de l'opération.
- Imposer `actorUid == request.auth.uid`, `shopId` égal au chemin, et utiliser `request.time` pour l'horodatage d'écriture plutôt qu'une date libre fournie par le client.
- Ne pas permettre au client de déclarer arbitrairement des valeurs financières « avant/après » comme preuve. Les valeurs doivent être vérifiables par rapport aux documents concernés, ou l'événement doit être produit par un environnement serveur de confiance.
- Pour chaque correction Patron, utiliser une transaction ou un batch qui met à jour le document métier et crée l'événement d'audit correspondant dans la même écriture atomique ; les règles doivent vérifier cette relation avec `getAfter()` lorsque le schéma le permet.
- Pour les événements sensibles (annulation, remboursement, correction de montant, stock), privilégier une écriture serveur de confiance avec validation des relations et du solde. Les règles Firestore seules ne peuvent pas garantir une logique comptable complète ou calculer de manière fiable un historique global de paiements.
- Conserver l'interdiction de modifier/supprimer les événements d'audit après création et prévoir un accès de lecture adapté, sans exposer les données financières au vendeur.

**Décision de sécurité :** aucune modification improvisée des règles n'est appliquée. Le code applicatif inspecté n'a pas encore de flux d'écriture partagé pour les opérations commerciales ni de flux de correction multi-boutiques ; le format des événements et la transaction correspondante doivent être définis avec la migration. Modifier maintenant les règles sans ce contrat pourrait créer de faux événements, bloquer les opérations ou donner une fausse assurance d'audit.

**Contrôles effectués :** lecture des règles actuelles et examen des autorisations d'écriture des collections concernées. Aucun test Firebase Emulator, aucune transaction réelle, aucun déploiement de règles et aucune publication. `main` reste intacte.


### Audit des annulations de ventes encaissées et de la preuve de remboursement — 26 novembre 2026

L'examen de `cancelSale()`, des mouvements de stock et des écritures de caisse a révélé une distinction comptable à préserver :

- La fonction réserve l'annulation au Patron, vérifie les dettes liées, bloque l'annulation lorsqu'un remboursement actif est déjà enregistré sur la dette, demande un motif et conserve la vente avec le statut `cancelled`.
- Si le produit est relié au stock, la fonction réintègre la quantité et écrit un mouvement `sale_cancellation_restoration`. L'audit de stock contrôle ensuite les indicateurs, la quantité réintégrée et l'existence d'une trace unique.
- En revanche, pour une vente déjà encaissée (espèces ou Mobile Money), l'annulation marque la vente comme annulée et les indicateurs de chiffre d'affaires l'excluent. Dans le flux inspecté, elle ne crée pas d'opération distincte de remboursement au client, ne précise pas si l'argent a réellement été rendu et ne relie pas un éventuel remboursement externe à la vente annulée.

**Risque :** le chiffre d'affaires peut être corrigé alors que la trésorerie réelle n'a pas été remboursée, ou qu'un remboursement a été fait hors application sans preuve. Le stock réintégré ne prouve pas le remboursement de l'argent. Il faut distinguer au minimum : (1) annulation commerciale, (2) retour/réintégration du stock, (3) remboursement financier effectué, partiel ou total, avec mode, date, montant, acteur et référence de transaction lorsqu'elle existe.

**Décision :** aucune modification fonctionnelle n'est appliquée dans cet audit. Le modèle actuel ne possède pas de journal de trésorerie/remboursement de vente suffisamment défini pour ajouter un champ ou une opération sans risque de double comptabilisation, notamment pour les paiements mixtes et les remboursements partiels. Avant activation, définir un registre de remboursements de vente distinct des remboursements de dettes clients, calculer le montant effectivement encaissé à l'origine, empêcher les remboursements cumulés de dépasser ce montant, et lier chaque mouvement à la vente et à l'acteur. Les annulations de ventes à crédit doivent rester coordonnées avec la dette liée et ses remboursements ; les règles existantes qui bloquent une annulation en présence de remboursements actifs doivent être conservées tant qu'une procédure de régularisation contrôlée n'est pas définie.

**Autres contrôles constatés :** la correction d'une vente avec stock ajuste la quantité et journalise l'écart ; elle bloque le changement de nom du produit lié au stock. La correction d'une vente à crédit refuse les dettes liées ayant déjà reçu des remboursements actifs ou incohérents. Ces contrôles restent des protections côté application locale : le journal local n'est pas une preuve inviolable et les règles Firestore multi-boutiques ne gouvernent pas encore les écritures commerciales quotidiennes.

**Vérifications :** lecture de `editSale()`, `cancelSale()`, des mouvements de stock et de `krediStockConsistencyAudit()`. Compilation statique des blocs JavaScript intégrés et comparaison de branche à effectuer après l'enregistrement de cette note. Aucun test navigateur, appareil, Firebase Emulator, compte réel ou remboursement réel n'est revendiqué. Aucun changement des règles Firestore, aucune migration, aucun déploiement ni publication ; `main` reste intacte.


### Audit des achats et de la cohérence chronologique des mouvements de stock — 26 novembre 2026

**Contrôles examinés :** enregistrement d'un achat, `editPurchase()`, `cancelPurchase()`, création/modification des produits et `krediStockConsistencyAudit()`.

**Protections constatées :**
- Les achats sont réservés au Patron dans l'interface ; montant entier positif, quantité non négative et date validée par le contrôle commun du formulaire.
- Un achat augmente le stock uniquement si le nom correspond à un produit existant ; l'écriture enregistre le produit lié, l'heure, la quantité et les valeurs avant/après.
- La correction exige une preuve unique de l'ajout initial lorsque l'achat avait déjà augmenté le stock. Elle conserve le lien produit, refuse de renommer l'article lié, calcule l'écart entre ancienne et nouvelle quantité et bloque un stock négatif.
- L'annulation exige une preuve unique de l'ajout initial pour les achats liés, refuse un retrait qui rendrait le stock négatif, marque l'achat annulé et ajoute un mouvement de retrait. Une seconde annulation est refusée.
- Les achats historiques sans lien fiable avec un produit ne déclenchent pas de correction automatique du stock ; c'est une précaution utile contre les rapprochements hasardeux.

**Limites et risques restants :**
1. Le contrôle de cohérence vérifie l'arithmétique individuelle de nombreux mouvements (avant + quantité, ou avant + delta = après), mais ne vérifie pas encore systématiquement que le `after` d'un mouvement est égal au `before` du mouvement suivant pour un même produit, dans l'ordre chronologique. Une suite de mouvements localement cohérents mais discontinus peut donc échapper au contrôle.
2. Le contrôle vérifie les achats à partir de leurs mouvements attendus, mais il ne vérifie pas systématiquement, dans le sens inverse, que chaque mouvement d'achat ou d'annulation référence un achat existant et cohérent. Un mouvement orphelin peut ne pas être détecté par les vérifications centrées sur les achats.
3. Le stock courant est contrôlé pour être numérique et non négatif, mais il n'est pas recalculé à partir d'un solde d'ouverture fiable et de l'intégralité du journal. Les stocks historiques ou les ajustements manuels non journalisés empêchent de certifier un solde global uniquement à partir des traces actuelles.
4. L'annulation d'un achat retire la quantité du stock courant si le solde le permet. Cela maintient une quantité totale non négative, mais ne constitue pas une preuve physique que les unités provenant de cet achat sont encore présentes ; le stock étant fongible, un contrôle d'inventaire reste nécessaire.

**Décision de correction :** aucune modification fonctionnelle ou des règles Firestore n'est faite dans cette étape. Avant de renforcer le vérificateur, il faut définir comment ordonner les mouvements (horodatage serveur, séquence monotone ou identifiant d'opération), comment traiter les égalités d'horodatage, les corrections manuelles et les anciens historiques incomplets. Sans cette base, une règle de continuité naïve pourrait signaler de fausses anomalies ou valider un ordre incorrect. Ajouter ensuite un contrôle bidirectionnel des références (mouvement vers achat/vente, achat/vente vers mouvements), un rapprochement par produit à partir d'un solde d'ouverture explicite, et une procédure d'inventaire physique documentée.

**Portée et tests :** audit statique du code de formulaire achat, des fonctions de modification/annulation et du vérificateur de stock. Ces protections sont côté application locale ; elles ne rendent pas le journal inviolable et ne remplacent pas les règles serveur. Compilation statique et relecture du document après commit ; aucun test de scénario dans navigateur/appareil, Firebase Emulator, compte réel ou inventaire physique n'est revendiqué. Aucune donnée métier n'a été modifiée ; aucune règle Firestore, migration, fusion, publication ou déploiement n'a été effectué ; `main` reste intacte.


### Audit des dépenses, remboursements de dettes et indicateurs financiers — 26 novembre 2026

**Contrôles examinés :** création, modification et annulation des dépenses ; création, modification et annulation des remboursements de dettes ; calcul des soldes clients ; agrégats du tableau de bord et rapport par période.

**Protections constatées :**
- Dépenses : montant entier strictement positif, date valide, modification/annulation réservées au Patron, motif obligatoire et historique conservé ; l'annulation les exclut des totaux sans supprimer la ligne.
- Remboursements de dettes : montant entier positif, dette et client vérifiés, montant plafonné au solde restant ; modification recalcule les autres paiements de la dette avant validation ; annulation est marquée sans effacer la trace et recalcule le solde.
- Le rapport du registre des dettes vérifie les identifiants uniques, les dates, les montants, les relations dette/client/vente et interdit un total de remboursements supérieur à la dette. En cas d'incohérence, il renvoie un résultat non exploitable au lieu de fabriquer un total.
- L'indicateur du tableau de bord est explicitement nommé « CA − achats − dépenses (indicateur simple) » et le texte d'avertissement précise qu'il ne s'agit ni d'un solde de trésorerie ni d'un bénéfice comptable.

**Limites et risques restants :**
1. Les achats peuvent porter un mode « Crédit fournisseur », mais l'indicateur simplifié déduit le montant total de l'achat, même si celui-ci n'a pas encore été payé. Il mesure donc une marge simplifiée de période sur achats enregistrés, pas les sorties de caisse réelles. Il faut un registre séparé des dettes fournisseurs et des paiements fournisseurs avant de présenter une trésorerie.
2. Le tableau de bord affiche les ventes encaissées et à crédit séparément pour la journée, mais le résultat simplifié soustrait le total du CA, sans calcul du coût des seuls articles effectivement vendus. Il ne constitue donc pas une marge brute ou un bénéfice ; le libellé et l'avertissement actuels réduisent le risque de confusion.
3. Le registre `payments` concerne les remboursements de dettes clients. Il ne représente pas un journal complet de tous les encaissements de ventes, des remboursements de ventes annulées, des paiements fournisseurs ou des transferts entre caisses. Ne pas additionner ce total aux ventes encaissées pour prétendre obtenir une trésorerie globale.
4. Les corrections et annulations sont journalisées localement, mais le stockage local et son journal ne sont pas inviolables. La synchronisation cloud et les règles Firestore préparatoires ne constituent pas encore un grand livre serveur transactionnel des mouvements de trésorerie.
5. Les fonctions de totalisation des achats/dépenses renvoient `NaN` lorsqu'une date ou un montant actif est invalide ; c'est préférable à un chiffre silencieusement faux, mais le tableau de bord n'affiche pas toujours un message explicatif spécifique à la donnée fautive.

**Décision de correction :** aucune modification du code financier dans cette étape. Les libellés et avertissements actuels décrivent déjà l'indicateur comme simplifié. Changer sa formule sans comptabilité des paiements fournisseurs, des encaissements, des remboursements de ventes et du coût des articles vendus créerait un chiffre potentiellement trompeur. Les prochaines évolutions devront créer un registre de trésorerie avec types d'opération distincts, modes de paiement, caisse/compte, références liées, annulations compensatoires et rapprochement, puis recalculer les indicateurs à partir de ce registre.

**Portée et tests :** audit statique des fonctions et des libellés du tableau de bord. Les protections décrites sont principalement côté application locale ; aucune preuve de test réel de paiement ou de rapprochement bancaire/mobile-money. Compilation statique et relecture du document après commit ; aucun test navigateur/appareil, Firebase Emulator, compte réel ou test de trésorerie n'est revendiqué. Aucune donnée métier modifiée, aucune règle Firestore, migration, fusion, publication ou déploiement ; `main` reste intacte.


### Correction de sécurité — conflits de fusion sur les mêmes enregistrements — 26 novembre 2026

**Risque identifié :** la fusion par identifiant de la base locale et de la base Firestore remplaçait silencieusement une fiche par l'autre lorsque les deux appareils avaient modifié le même identifiant avec des contenus divergents. Le mécanisme de conflit précédent couvrait surtout les modifications locales en attente par rapport à une version cloud de référence ; il ne suffisait pas à détecter tous les cas de divergence sur une même fiche.

**Correction appliquée dans `application.html` :** avant toute fusion, COMPTIVA compare désormais les fiches locales et cloud portant le même identifiant, ainsi que les propriétés communes du profil du commerce. Si un même enregistrement ou champ de profil diffère, la synchronisation est suspendue, le conflit est signalé, les deux instantanés sont conservés dans l'enveloppe de récupération lorsque le stockage local l'autorise, et aucun choix automatique local/cloud n'est effectué. Les enregistrements distincts peuvent toujours être fusionnés par identifiant lorsque la structure est valide.

**Limites restantes :** cette protection détecte les divergences, mais ne fournit pas encore d'interface de résolution champ par champ. Les conflits doivent être sauvegardés puis examinés avant reprise. La sauvegarde locale des instantanés dépend toujours de la capacité du navigateur à écrire dans `localStorage`. Les données déjà perdues avant cette version ne peuvent pas être recréées par ce contrôle.

**Vérifications :** compilation statique des trois blocs JavaScript, relecture du fichier modifié, relecture de cette note après commit et comparaison de la branche de travail avec `main`. Aucun test multi-appareils réel, navigateur, Firebase Emulator ou compte Firebase n'a été exécuté. Aucun déploiement ni fusion ; `main` reste intacte.


### Audit des sauvegardes et restaurations locales — 26 novembre 2026

**Défaut corrigé :** lorsque `loadDB()` détecte une base locale illisible, il conserve un indicateur d'erreur et renvoie une structure vide en mémoire pour empêcher les écritures ordinaires. La fonction `backupData()` ne contrôlait pas cet indicateur et pouvait donc exporter cette structure vide comme si elle représentait les données du compte.

**Correction appliquée dans `application.html` :**
- La sauvegarde est maintenant refusée si l'indicateur `krediDBStorageIssue` concerne le magasin actif.
- Avant export, la structure de la base en mémoire est contrôlée par `krediDatabaseShapeIssue()`.
- Les données sérialisées sont relues en JSON et leur structure est contrôlée une seconde fois avant la création du fichier.
- Le message de refus avertit que la copie brute de secours, si elle a pu être créée, doit être récupérée avant tout export. Aucun fichier vide ne doit être présenté comme une sauvegarde valide dans ce cas.

**Protections de restauration constatées :** compte propriétaire obligatoire, contrôle de l'identifiant propriétaire et de la version de schéma, validation des collections et identifiants, confirmation explicite du remplacement local, vérification de session avant écriture et copie préalable du contenu local brut avec relecture de cette copie.

**Risques restants à traiter avant de considérer la restauration comme sûre sur plusieurs appareils :**
1. La restauration remplace la base locale entière. Le message de confirmation parle du remplacement sur cet appareil, mais `saveDB()` déclenche ensuite la synchronisation cloud. Il faut une étape distincte qui compare la sauvegarde, la base locale, l'état des modifications en attente et la version cloud, puis demande une confirmation explicite avant tout remplacement cloud. Tant que cette séparation n'est pas implémentée et testée, ne pas considérer une restauration comme une opération de fusion sans perte.
2. Le fichier de sauvegarde ne contient pas encore de mécanisme cryptographique d'intégrité ou de signature. La validation de structure ne prouve pas que son contenu est authentique ou complet.
3. Les copies de secours `localStorage` restent soumises aux limites de quota, à l'effacement des données du navigateur et à la disponibilité du stockage. Elles ne remplacent pas une sauvegarde externe vérifiée.
4. Aucun test de restauration avec sauvegarde ancienne, sauvegarde modifiée, fichier volumineux, stockage saturé, synchronisation en attente ou second appareil n'a été exécuté.

**Portée et tests :** correction du seul chemin d'export de sauvegarde ; le chemin de restauration n'a pas été modifié dans cette étape, car la politique de remplacement cloud doit être conçue séparément pour éviter une écriture destructive. Relecture du code et compilation statique après commit ; aucun test navigateur/appareil, Firebase Emulator ou compte réel n'est revendiqué. Aucune donnée métier modifiée, aucune règle Firestore, migration, fusion, publication ou déploiement ; `main` reste intacte.


### Garde-fou de restauration avant remplacement cloud — 26 novembre 2026

**Correction appliquée dans `restoreData()` :**
- La restauration est refusée si la synchronisation cloud n'est pas confirmée prête, si la base locale est marquée modifiée, si une écriture est en cours, si un conflit cloud est ouvert, si la version cloud de référence est inconnue ou si le marqueur de synchronisation en attente est présent (ou illisible).
- La confirmation prévient explicitement que la restauration remplace les données locales et demande aussi le remplacement de la base cloud.
- L'état de session et de synchronisation est revérifié après la confirmation et avant la sauvegarde locale.
- L'écriture cloud conserve la transaction existante `krediWriteCloudIfUnchanged()`, qui compare la version cloud actuelle à la dernière référence connue et bloque si elle a changé.

**Limites restantes :** ce garde-fou réduit le risque d'écraser des modifications locales en attente, mais ne constitue pas une comparaison sémantique entre les dates de la sauvegarde et les transactions cloud. Le marqueur local peut être absent après effacement du stockage ; dans ce cas, le contrôle `krediCloudReady`, `krediLocalDirty`, `krediLastWrite` et la transaction cloud restent essentiels. La procédure ne réalise pas de fusion automatique. Aucun test réel de restauration, de concurrence multi-appareils, de stockage effacé ou de course réseau n'a été exécuté.

**Tests statiques après commit :** relecture des fichiers modifiés et compilation des trois blocs JavaScript. Aucune modification de règles Firestore, migration, fusion, déploiement ou publication ; `main` reste intacte.


### Audit des suppressions hors connexion et des identifiants dupliqués — 26 novembre 2026

**Constat important :** la fusion actuelle combine les enregistrements présents dans les deux bases par identifiant. Elle n'a pas de registre de suppressions (tombstones) ni de version de suppression. Une fiche supprimée sur un appareil hors connexion peut donc réapparaître si elle est encore présente dans la copie distante ou dans la copie d'un autre appareil. Il ne faut pas considérer la synchronisation hors connexion comme sûre pour les suppressions tant que ce mécanisme n'existe pas.

**Correction de sécurité appliquée :** `krediFindSyncMergeConflicts()` détecte maintenant les identifiants répétés dans une même collection locale ou cloud et les signale comme conflits. La fusion déjà existante suspend alors la synchronisation et conserve les copies de récupération au lieu de laisser la Map remplacer silencieusement un enregistrement par un autre portant le même identifiant.

**Architecture nécessaire avant de corriger la réapparition des suppressions :**
- Introduire des marqueurs de suppression durables avec identifiant, collection, horodatage serveur, acteur et version.
- Fusionner ces marqueurs comme des événements de données, sans les supprimer lors d'une fusion.
- Appliquer la suppression seulement si sa version est plus récente que la dernière modification connue de la fiche ; en cas d'ordre incertain, bloquer et demander une résolution.
- Prévoir une politique de rétention et de migration des anciennes données qui ne possèdent aucun marqueur de suppression.
- Tester suppression hors ligne, reconnexion tardive, suppression simultanée avec modification, restauration de sauvegarde et multi-appareils.

**Tests :** relecture après modification et compilation statique des trois blocs JavaScript ; aucun test de scénarios multi-appareils, émulateur Firebase ou compte réel n'a été exécuté. Aucune migration ni modification des règles Firestore ; aucun déploiement ou fusion. `main` reste intacte.


### Garde-fou temporaire contre la réapparition des suppressions — 26 novembre 2026

Une protection intermédiaire a été ajoutée avant la fusion locale/cloud. Lorsque `krediLastWrite` fournit une base de référence lisible, COMPTIVA compare les identifiants de chaque collection avec cette base. Si une fiche de référence manque d'un côté alors que l'autre côté la conserve sans modification, la synchronisation est suspendue et une copie de récupération locale/distante est demandée. Aucune fiche n'est alors réintroduite automatiquement par la fusion.

Cette mesure **ne constitue pas encore un système de suppression synchronisée** : elle bloque les suppressions unilatérales non versionnées plutôt que de les propager. Les suppressions cohérentes des deux côtés ne sont pas signalées par cette règle. Si la base de référence est absente ou illisible, ce contrôle spécifique ne peut pas conclure ; le mécanisme existant de conflit et de validation de structure reste en place. La création de tombstones durables, leur propagation et leur politique de rétention restent nécessaires.

**Vérifications :** code relu après écriture ; compilation statique des trois blocs JavaScript ; documentation relue. Aucun test d'exécution multi-appareils, Firebase Emulator, compte réel, réseau hors connexion ou concurrence n'a été exécuté. Aucune migration, modification des règles Firestore, fusion, publication ou déploiement. `main` reste intacte.


### Audit des relations clients, ventes, dettes, remboursements et stock — 26 novembre 2026

**Contrôles déjà présents dans le code :**
- L'aperçu de migration compte les références client/vente/produit absentes, les dettes orphelines, les dettes liées à une vente annulée ou à un autre client, les ventes à crédit sans dette unique et les incohérences de montants.
- Le contrôle relationnel des données partagées vérifie notamment les clients et produits référencés par les ventes, les ventes référencées par les dettes et les dettes référencées par les remboursements.
- L'annulation d'une vente vérifie les dettes actives et bloque si des remboursements sont déjà enregistrés ou si la preuve de mouvement de stock est insuffisante.

**Limite et risque :** ces vérifications d'intégrité sont concentrées dans l'analyse/migration et certains flux de vente. Elles ne prouvent pas que chaque action de suppression de l'interface passe par un contrôle global des dépendances. L'inspection de cette version n'a pas permis d'identifier de manière fiable un ensemble complet de gestionnaires de suppression pour toutes les collections ; aucune suppression globale ni aucun changement de schéma n'a donc été introduit.

**Règle de protection retenue :** ne pas supprimer physiquement un client, produit, vente, dette ou remboursement tant que les dépendances et l'historique ne sont pas vérifiés. La correction durable devra privilégier l'archivage/désactivation, conserver les identifiants et les reçus, et empêcher la suppression d'une fiche encore référencée. Les ventes annulées et les remboursements réels doivent rester des événements financiers distincts.

**Tests :** relecture du code et de la documentation uniquement pour cet audit. Aucun test fonctionnel de suppression, aucune base réelle, aucun émulateur Firebase ni appareil secondaire n'a été utilisé. Aucun changement de règles Firestore, migration, publication ou déploiement.

### Garde-fou d'affichage des dettes incohérentes — 26 novembre 2026

**Constat :** le calcul du solde renvoie déjà une valeur non exploitable (NaN) lorsqu'un montant, un remboursement ou un total est incohérent. Toutefois, l'ancien rendu du statut testait uniquement « solde inférieur ou égal à zéro » puis affichait par défaut « En cours ». En JavaScript, les comparaisons avec NaN sont fausses : une dette dont le solde ne pouvait pas être calculé pouvait donc apparaître comme normalement « En cours », même si les colonnes de montant affichaient « À vérifier ».

**Correction appliquée dans application.html :** le statut d'une dette affiche maintenant « À vérifier » si sa relation client/vente est invalide, si son solde n'est pas un entier sûr ou si le solde est négatif. Le statut « Soldé » n'est attribué qu'à un solde exactement égal à zéro. Les statuts « En retard » et « En cours » ne sont affichés qu'après ces contrôles.

**Portée et limites :** correction d'affichage uniquement ; aucun montant, remboursement, statut métier ou historique n'est modifié. Le registre des rapports avait déjà son propre contrôle strict et renvoie un résultat non exploitable en cas d'incohérence. Le tableau de bord global doit encore être audité pour s'assurer qu'il signale explicitement les dettes invalides au lieu de les omettre des agrégats.

**Vérifications :** relecture du code et compilation statique des trois blocs JavaScript après modification ; relecture de la documentation après commit et comparaison de la branche avec main. Aucun test fonctionnel navigateur/appareil, Firebase Emulator, compte réel ou scénario de remboursement n'a été exécuté. Aucune règle Firestore, migration, donnée métier, fusion, publication ou déploiement n'a été modifié ; main reste intacte.
### Audit des agrégats de dettes du tableau de bord — 26 novembre 2026

**Constat :** le tableau de bord construisait le total des dettes uniquement à partir des lignes pour lesquelles `balance(d) > 0`. Une dette dont le solde renvoyait une valeur non exploitable pouvait donc être écartée du total et des compteurs, donnant potentiellement un montant inférieur à la réalité. Le rapport financier disposait déjà d'un contrôle global du registre des dettes et remboursements (`reportDebtLedger`).

**Correction appliquée :** le tableau de bord utilise maintenant ce contrôle global avant d'afficher les agrégats. Si le registre comporte une dette ou un remboursement incohérent, le total dû, le nombre de débiteurs, le nombre de dettes en cours et le nombre de dettes soldées affichent « À vérifier » au lieu d'un chiffre potentiellement incomplet. Les lignes individuelles restent consultables et le statut « À vérifier » permet de repérer les dossiers concernés.

**Limites restantes :** le compteur simple de remboursements reste un décompte de lignes actives, pas une validation comptable indépendante. Les soldes affichés dans les fiches clients et les rappels nécessitent encore une revue spécifique pour éviter toute présentation trop affirmative lorsqu'un registre global est incohérent. Aucun remboursement, dette ou montant historique n'a été modifié.

**Vérifications :** contrôle du contenu modifié, compilation statique des trois blocs JavaScript et comparaison de la branche avec `main`. Aucun test navigateur/appareil, Firebase Emulator, compte réel, jeu de données de test ni scénario de concurrence n'a été exécuté. Aucune règle Firestore, migration, fusion, publication ou mise en production ; `main` reste intacte.
### Audit des rappels de paiement et des soldes clients — 26 novembre 2026

**Constat :** les rappels pouvaient proposer une dette à partir du seul test `balance(d) > 0`, sans vérifier explicitement la relation entre la dette, son client et sa vente d'origine. Un dossier avec un solde arithmétique positif mais une relation incohérente pouvait donc être proposé dans le message de rappel.

**Correction appliquée :** la liste des dettes proposées dans les rappels exclut désormais les dettes annulées, les relations client/vente invalides et les soldes qui ne sont pas des entiers sûrs strictement positifs. `updateReminder()` effectue également un second contrôle avant de composer le message ; si la dette sélectionnée n'est pas vérifiable, aucun montant de solde n'est présenté et un avertissement est affiché en français ou en anglais.

**Autres éléments examinés :** le relevé de dette vérifie déjà la relation et le total payé avant d'afficher un solde confirmé ; le reçu de remboursement distingue les remboursements annulés et bloque l'affichage d'un cumul confirmé si le registre est incohérent. Le total client devient non exploitable si une des dettes de ce client fait remonter un solde invalide. Une revue plus approfondie des reçus de vente et des règles de remboursement reste nécessaire.

**Vérifications :** modification ciblée du générateur de rappels, relecture du code et compilation statique des trois blocs JavaScript ; documentation relue après commit et comparaison de la branche avec main. Aucun test navigateur/appareil, Firebase Emulator, compte réel, ni envoi effectif de SMS/WhatsApp n'a été exécuté. Aucune donnée métier, règle Firestore, migration, fusion, publication ou déploiement n'a été modifié ; main reste intacte.

### Audit des reçus de vente et de remboursement — 26 novembre 2026

**Constat :** les fonctions d'impression sélectionnaient une vente ou un remboursement avec `find()` sur son identifiant. Si des données importées ou corrompues contenaient plusieurs enregistrements avec le même identifiant, le reçu pouvait être établi à partir du premier enregistrement trouvé, sans signaler l'ambiguïté.

**Correction appliquée :** l'impression d'un reçu de vente et d'un reçu de remboursement exige désormais qu'un seul enregistrement corresponde à l'identifiant demandé. Si l'enregistrement est absent ou si l'identifiant est dupliqué, l'impression est bloquée et l'utilisateur est invité à vérifier le registre. Aucune donnée historique n'est modifiée.

**Contrôles déjà présents confirmés :** les montants de vente sont validés par `saleFinancialAmounts()` (total = encaissé + crédit, et répartition espèces/mobile pour le paiement mixte) ; le relevé de dette vérifie le lien avec la vente et le solde ; le reçu de remboursement distingue une opération annulée et n'affiche les cumuls confirmés que si le registre le permet. Les remboursements restent des paiements de dettes distincts des encaissements initiaux de vente.

**Limites à traiter dans un audit ultérieur :** un reçu de vente annulée doit être compris comme une trace historique, pas comme une preuve de remboursement financier. Le registre actuel ne démontre pas à lui seul qu'un remboursement au client a effectivement été exécuté. Il faudra un événement de remboursement séparé (montant, date, moyen, référence, motif et preuve), sans le confondre avec l'annulation commerciale ou la restitution de stock. Les scénarios de ventes mixtes et de remboursements partiels nécessitent encore des essais fonctionnels avec des jeux de données contrôlés.

**Vérifications :** relecture du code, compilation statique des trois blocs JavaScript et comparaison de la branche avec `main`. Aucun test navigateur/appareil, Firebase Emulator, compte réel, impression réelle ni transaction Mobile Money n'a été exécuté. Aucune donnée métier, règle Firestore, migration, fusion, publication ou déploiement n'a été modifié ; `main` reste intacte.

### Garde-fou des indicateurs de ventes du tableau de bord — 26 novembre 2026

**Constat :** les rapports vérifiaient déjà globalement les dates des ventes actives. Le tableau de bord, lui, filtrait directement les ventes par date avant le calcul. Une vente active avec une date invalide pouvait donc être exclue des périodes jour/semaine/mois sans rendre les indicateurs manifestement incomplets.

**Correction appliquée dans `application.html` :** le tableau de bord contrôle désormais toutes les dates des ventes actives avant de présenter les indicateurs de chiffre d'affaires, le nombre de ventes du jour, les encaissements du jour, le crédit du jour et le résultat simplifié du mois. Si une date de vente active est invalide, les montants concernés affichent « À vérifier » et le compteur du jour signale explicitement le problème au lieu de donner un chiffre potentiellement incomplet. Les ventes et leurs dates ne sont pas modifiées.

**Limites restantes :** les listes de clients récents et d'échéances du tableau de bord utilisent encore des agrégations individuelles qui méritent un contrôle dédié des dettes incohérentes. Cette correction ne constitue pas un registre de remboursement financier des ventes annulées ; un remboursement réel au client doit rester distinct de l'annulation commerciale et du retour de stock.

**Vérifications :** relecture du bloc modifié et compilation statique des trois blocs JavaScript (3/3). Aucun test navigateur/appareil, jeu de données contrôlé, Firebase Emulator, compte réel, impression ou scénario multi-appareils n'a été exécuté. Aucune donnée métier, règle Firestore, migration, fusion, publication ou déploiement n'a été modifié ; `main` reste intacte.

### Audit des listes de dettes et des soldes clients — 26 novembre 2026
- Constat : la liste des clients additionnait les soldes dette par dette sans exiger la validation globale du registre. Des identifiants de dettes dupliqués ou des remboursements orphelins pouvaient donc rendre le total affiché trompeur.
- Correction : le solde total d’un client est désormais affiché « À vérifier » tant que reportDebtLedger ne valide pas l’ensemble du registre actif. Les dettes annulées restent exclues du solde.
- Correction : les actions financières (ajout de paiement, modification et annulation) dans la liste des dettes sont suspendues lorsque le registre global ou la dette concernée est incohérent. L’impression du relevé reste disponible pour inspection, mais refuse désormais un identifiant de dette absent ou dupliqué.
- Limite : la suspension est volontairement conservatrice et peut bloquer les actions sur des dettes saines tant qu’une anomalie ailleurs dans le registre n’est pas corrigée. Aucune donnée historique n’a été modifiée.
- Tests statiques requis après commit : compilation des trois blocs JavaScript, relecture des fonctions et comparaison de la branche avec main. Aucun test réel navigateur, appareil, Firebase Emulator ou compte marchand n’est réputé effectué.

### Audit de l’enregistrement des remboursements — 26 novembre 2026
- Constat : l’ajout contrôlait déjà le montant positif et le plafond du solde de la dette, mais ne contrôlait pas explicitement la date, le mode, l’unicité de l’identifiant de dette sélectionné ni l’intégrité globale des registres avant écriture.
- Correction : avant tout nouveau remboursement, le registre global est validé par reportDebtLedger ; la dette sélectionnée doit exister une seule fois ; la date doit être une date ISO valide ; le mode doit appartenir aux choix autorisés ; l’identifiant de paiement généré doit être non vide et unique.
- Les contrôles antérieurs restent actifs : dette active, relation client/vente valide, montant entier positif et montant inférieur ou égal au solde restant.
- Limite : le stockage reste celui du mécanisme local/cloud existant ; cette validation applicative n’est pas une transaction atomique entre plusieurs appareils. Les tests de concurrence multi-appareils et de double soumission restent à réaliser en environnement de test.
- Aucune donnée existante, règle Firebase, branche main ou déploiement n’a été modifié.


## Audit de l’historique et des reçus de remboursement — 26 novembre 2026
- La liste des remboursements compte désormais les identifiants sur l’ensemble du registre : si un identifiant est absent ou dupliqué, toutes les lignes concernées affichent « À vérifier » et leurs actions financières sont suspendues.
- L’affichage du client exige une dette liée présente une seule fois et une relation client/vente valide ; les remboursements rattachés à une dette annulée ne sont pas présentés comme des opérations actives valides.
- Le contrôle partagé avant modification ou annulation d’un remboursement exige maintenant une dette liée unique, en plus de l’unicité du remboursement, de sa date, de son montant et de l’intégrité du registre.
- L’impression d’un reçu de remboursement refuse une dette liée absente ou dupliquée ; elle refuse également de présenter comme actif un remboursement rattaché à une dette annulée. Les reçus d’opérations annulées restent identifiés comme non valables lorsqu’ils peuvent être reliés sans ambiguïté.
- Vérification statique : les trois blocs JavaScript de `application.html` compilent avec `new Function` après les modifications. Il ne s’agit pas d’un test navigateur, d’impression réelle, Firebase, ni d’un test de données corrompues.
- Limite : aucune transaction atomique multi-appareils n’a été ajoutée ; les modifications restent soumises au mécanisme de synchronisation existant et aux conflits de concurrence déjà documentés.
- Aucune donnée existante, règle Firebase, branche `main`, fusion ou publication n’a été modifiée.
