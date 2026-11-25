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
