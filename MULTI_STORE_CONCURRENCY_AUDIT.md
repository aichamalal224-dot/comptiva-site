# COMPTIVA — Audit de concurrence et décrément du stock

Date : 27 novembre 2026  
Branche : `comptiva/monthly-stability-audit`

## Risque identifié

Le modèle actuel de l'application principale sauvegarde le stock dans une base locale puis synchronise un instantané global du commerce dans un document Firestore unique. Deux vendeurs peuvent donc lire la même quantité, enregistrer chacun une vente et écraser ou désynchroniser les changements de l'autre. Une validation JavaScript avant l'écriture ne résout pas cette course : elle peut devenir fausse dès qu'un autre appareil écrit.

## Correction de contrat ajoutée au prototype

`validateSaleStockDecrement(bundle, actorUid, sale, stock, existingMovement, now)` contrôle désormais :

- l'organisation, le magasin et le produit concordants ;
- l'identité de l'auteur et le droit `sales:create` dans le magasin affecté ;
- une quantité strictement positive et un stock existant non négatif ;
- un stock suffisant pour la vente ;
- une clé d'idempotence obligatoire et l'absence d'un mouvement déjà enregistré ;
- une date de vente récente et valide.

Le helper calcule une quantité restante indicative. Il ne fait aucune écriture et ne constitue pas une protection contre deux transactions simultanées.

## Transaction serveur obligatoire avant mise en production

Pour chaque vente, le backend de confiance devra exécuter une transaction Firestore atomique, avec des lectures avant les écritures :

1. Vérifier le jeton Firebase Auth et retrouver le membre, son rôle et son affectation au magasin depuis des documents de confiance.
2. Lire le document stock du produit dans le magasin ciblé.
3. Lire le document de mouvement portant la clé d'idempotence de la vente.
4. Refuser si le mouvement existe déjà, si le magasin/organisation ne correspondent pas, ou si la quantité disponible est insuffisante.
5. Lire/vérifier les références de vente et de dette nécessaires, selon les règles métier.
6. Dans la même transaction, créer la vente, décrémenter le stock, créer un mouvement de stock immuable et enregistrer les métadonnées d'auteur/horodatage.
7. Utiliser une clé d'idempotence stable générée avant la première tentative et réutilisée lors des reprises réseau. Une nouvelle clé ne doit pas être créée automatiquement à chaque retry.
8. En cas de conflit, laisser Firestore réessayer la transaction ; si le stock est devenu insuffisant ou si la clé est déjà consommée, refuser proprement sans appliquer une deuxième décrémentation.

Schéma logique indicatif :

- `organizations/{orgId}/stores/{storeId}/inventory/{productId}`
- `organizations/{orgId}/stores/{storeId}/sales/{saleId}`
- `organizations/{orgId}/stores/{storeId}/stockMovements/{idempotencyKey}`

Les chemins exacts sont à arrêter avec les règles Firestore et les requêtes réellement retenues. Les clients ne doivent jamais pouvoir écrire directement une quantité de stock arbitraire ou fabriquer un mouvement de vente déjà validé.

## Tests ajoutés et résultat

Dix scénarios supplémentaires couvrent : vente autorisée, calcul de stock restant, rejeu, stock insuffisant, magasin non affecté, auteur falsifié, clé d'idempotence absente, quantité nulle, organisation étrangère, stock négatif et proposition trop ancienne.

Le fichier de test affiche **90 assertions** réussies dans le harnais JavaScript isolé. Ce résultat valide les fonctions pures et les cas simulés uniquement. Il ne prouve pas le comportement de Firestore en concurrence réelle.

## Bloqueurs non levés

- Aucun backend transactionnel n'a encore été implémenté.
- Aucun test Firebase Emulator ou multi-appareils n'a été exécuté.
- Les règles Firestore complètes et actuellement publiées ne sont pas présentes dans le dépôt audité.
- Le schéma multi-magasins n'est pas encore intégré à l'application principale.
- Le modèle actuel de synchronisation par instantané global ne doit pas être réutilisé tel quel pour des vendeurs simultanés.

**Décision de sécurité :** ne pas activer les comptes vendeurs multi-magasins en production avant l'implémentation des transactions, les règles serveur et les tests de concurrence. Aucune donnée, règle Firebase, branche principale ou publication n'a été modifiée par cette étape.


## Complément — intégrité de l'historique des remboursements (28 novembre 2026)

Le validateur des remboursements vérifie maintenant que chaque paiement historique appartient à la même dette, au même client, à la même organisation et au même magasin. Chaque paiement historique doit également posséder un identifiant et une clé d'idempotence uniques ; la clé du nouveau remboursement ne peut pas réutiliser une clé déjà consommée. Un historique croisé entre organisations/magasins, incomplet ou rejoué bloque le nouveau remboursement. Cinq tests négatifs couvrent ces cas.

Résultat rejoué après correction : **190 assertions réussies** dans le harnais JavaScript isolé. Ce contrôle reste une prévalidation : le backend devra relire dette, paiements et clé d'idempotence dans une transaction Firestore avant toute écriture.


## Complément — idempotence des transferts et quantités de stock (28 novembre 2026)

Le contrôle des ventes exige maintenant des quantités entières sûres pour la vente et le stock. La création d'un transfert exige une clé d'idempotence stable et refuse une opération déjà présente ; la quantité transférée doit être un entier sûr strictement positif. La réception vérifie aussi l'identité des deux magasins par rapport au transfert persistant, exige son propre identifiant et sa clé d'idempotence, et refuse une réception déjà enregistrée même si le client présente encore un ancien état « en transit ».

Six cas négatifs supplémentaires couvrent l'absence de clé, le rejeu de création, la quantité fractionnaire, la falsification du magasin source, l'absence de clé de réception et le rejeu de réception. Le fichier contient **196 appels d'assertion** et le harnais JavaScript isolé passe. Ces validations restent préliminaires : seule une transaction Firestore serveur peut garantir l'absence de double débit/crédit en concurrence réelle.


## Correction — contrôle du stock source avant expédition d'un transfert (28 novembre 2026)

L'audit a relevé une lacune dans le contrat : la création d'un transfert vérifiait les magasins et la quantité demandée, mais ne prévalidait pas le stock disponible dans le magasin source. Une opération pouvait donc être déclarée « en transit » sans preuve que le magasin expéditeur détenait les unités à transférer.

Ajout de `validateStockTransferDispatch`, distinct de la création du transfert. Avant toute expédition, ce contrôle exige :
- un transfert persistant cohérent, en état `in_transit`, avec organisation, produit et magasins source/destination valides et distincts ;
- l'identité du patron authentifié comme auteur du transfert et son droit de créer un transfert depuis le magasin source ;
- un instantané de stock appartenant exactement à l'organisation, au magasin source et au produit du transfert ;
- des quantités entières sûres, un stock suffisant, une proposition récente et l'absence du mouvement d'expédition déjà enregistré ;
- le calcul de la quantité restant au magasin source après débit.

Huit assertions supplémentaires couvrent l'expédition autorisée et le stock restant, le stock insuffisant, le mauvais magasin, le mouvement déjà présent, le refus du vendeur, la quantité fractionnaire, l'organisation étrangère et une proposition périmée. Le libellé statique du harnais passe de 322 à **330 assertions** ; ce nombre n'est pas une preuve d'exécution. Le test complet n'a pas été exécuté dans cette étape.

**Condition impérative de production :** le serveur doit, dans une seule transaction Firestore, relire le transfert et l'adhésion patronale courante, le stock source et le mouvement d'expédition identifié par une clé stable ; puis débiter le stock, créer le mouvement immuable et confirmer l'expédition. La réception au magasin destinataire doit rester une transaction distincte, protégée par sa propre clé d'idempotence. La prévalidation JavaScript ne protège pas contre deux expéditions simultanées et n'est pas intégrée à l'application principale.


## Correction — cohérence entre état du transfert et historique des réceptions (28 novembre 2026)

Le contrôle des réceptions partielles cumulait correctement les quantités déclarées, mais ne rapprochait pas assez strictement cet historique de l'état persistant du transfert. Cela laissait passer deux instantanés incohérents : un transfert encore marqué `in_transit` avec des réceptions déjà enregistrées, ou un transfert marqué `partially_received` sans aucun événement de réception antérieur.

Le validateur `validateStockTransferReceiptEvent` refuse maintenant ces deux incohérences :
- `in_transit` exige un historique antérieur vide ;
- `partially_received` exige au moins une réception antérieure validée.

Deux assertions négatives supplémentaires couvrent ces états divergents. Le libellé statique du harnais passe de 330 à **332 assertions**. Les tests ne sont pas déclarés exécutés dans cette étape.

Cette vérification améliore la cohérence du modèle, mais ne remplace pas le contrôle serveur : dans une transaction Firestore, le backend doit relire l'état courant du transfert et l'ensemble des événements de réception, vérifier leur cohérence et écrire le nouvel événement, le stock accepté et le nouvel état ensemble. Les événements de réception doivent être immuables et leur identifiant/idempotency key uniques au niveau de la base.


## Correction — provenance et calcul sûr des ajustements de stock (28 novembre 2026)

Le validateur d'ajustement de stock contrôlait l'autorisation du patron et le motif, mais ne faisait pas appliquer le contrat commun de provenance (identifiant, organisation, magasin, auteur, date de création). Il acceptait aussi un calcul résultant qui pouvait dépasser la limite des entiers sûrs JavaScript.

Le contrôle `validateStockAdjustment` utilise désormais `validateOperationRecord` pour imposer la provenance et le droit d'action, exige un horodatage de création valide et récent (pas dans le futur, fenêtre de cinq minutes), et refuse tout résultat qui n'est pas un entier sûr ou qui rendrait le stock négatif.

Trois assertions supplémentaires couvrent la date invalide, la date future et le dépassement arithmétique. Le libellé statique du harnais passe de 332 à **335 assertions**. Il ne s'agit pas d'une confirmation d'exécution des tests.

Le journal de stock en production devra conserver chaque ajustement comme mouvement immuable avec un identifiant et une clé d'idempotence uniques, lier ce mouvement à l'opération source, puis mettre à jour le stock dans la même transaction serveur. Une correction ne doit jamais écraser l'historique ou modifier directement une quantité sans mouvement explicatif.


## Correction — contrat du journal immuable des mouvements de stock (28 novembre 2026)

Ajout de `validateStockMovementRecord`, validateur commun pour les événements du grand livre de stock. Il impose :
- un identifiant de mouvement, une clé d'idempotence et une référence à l'opération source ;
- l'organisation, le magasin, le produit, l'auteur et la date ;
- un type de mouvement autorisé et un sens cohérent du delta (sortie négative pour vente/expédition, entrée positive pour retour/annulation/réception ; ajustement signé) ;
- l'autorisation de l'acteur dans le magasin concerné ;
- l'unicité de l'identifiant et de la clé d'idempotence par organisation, contrôlée contre l'historique fourni ;
- une date récente, non future, pour une nouvelle écriture.

Onze assertions couvrent le sens des mouvements, les doublons, les permissions, les organisations, les dates et l'historique corrompu. Le libellé statique du harnais indique maintenant **346 assertions** ; les tests n'ont pas été exécutés.

**Limite importante :** ce validateur ne crée pas le journal, ne prouve pas qu'un historique transmis est complet et ne verrouille pas les écritures concurrentes. En production, le backend doit interroger le journal autoritatif, imposer une contrainte d'unicité réelle sur `(organizationId, idempotencyKey)` et sur l'identifiant, relire l'inventaire et l'opération source, puis écrire mouvement + nouvelle quantité + état métier dans une transaction atomique. Les mouvements doivent être append-only, non modifiables et non supprimables par les clients. Les mouvements de réception/retour dont la quantité réellement ajoutée est nulle ne doivent pas créer de mouvement de stock nul.


## Correction — un transfert partiellement reçu ne peut pas être déjà entièrement comptabilisé (28 novembre 2026)

L'audit a trouvé un état impossible que le contrôle précédent laissait subsister : un transfert encore marqué `partially_received` pouvait présenter un historique dont les quantités cumulées atteignaient déjà la quantité totale expédiée. Le transfert aurait alors dû être clôturé (`received`, `received_with_issues` ou `refused`) ; toute nouvelle réception était ensuite bloquée par dépassement, mais l'état restait trompeur pour le patron et le vendeur.

Le contrôle d'état de `validateStockTransferReceiptEvent` exige désormais, pour `partially_received`, que le cumul historique soit strictement supérieur à zéro et strictement inférieur à la quantité expédiée. Un historique déjà complet est refusé avec `transfer_status_receipt_history_mismatch`.

Une assertion négative supplémentaire couvre ce cas. Le libellé statique du harnais passe de **365 à 366 assertions** ; les tests ne sont pas déclarés exécutés.

**Limite de production :** le backend doit toujours relire le transfert et l'intégralité des événements de réception dans une transaction, calculer le statut depuis les quantités cumulées, et persister le statut final avec le dernier événement et le crédit de stock. Cette correction ne résout pas encore l'ambiguïté de cycle de vie entre la création du transfert (qui utilise déjà `in_transit`) et l'étape distincte de débit d'expédition ; ce contrat doit être clarifié avant intégration afin d'éviter un transfert présenté comme expédié avant le débit réel.


## Correction — séparer préparation et expédition effective des transferts (28 novembre 2026)

L'audit a confirmé une ambiguïté de cycle de vie : la création d'un transfert et son expédition exigeaient toutes deux le statut `in_transit`. Le modèle pouvait donc présenter comme déjà expédiée une opération dont le débit du stock source n'avait pas encore été effectué.

Le contrat est maintenant séparé en deux étapes :
- **Création :** le transfert doit être au statut `pending_dispatch`. Cela signifie qu'il est préparé/en attente d'expédition ; aucune quantité ne doit encore être retirée du stock.
- **Expédition :** `validateStockTransferDispatch` n'accepte que `pending_dispatch`, contrôle le stock source et retourne le statut suivant `in_transit` avec l'horodatage de dispatch fourni par l'appelant. Le backend doit persister ensemble le débit du stock, le mouvement immuable et ce changement d'état dans une seule transaction.
- **Réception :** les validateurs de réception continuent d'exiger `in_transit` ou `partially_received` ; une réception ne peut donc pas précéder l'expédition.

Autre correction : une demande d'expédition ne devient plus invalide simplement parce que le transfert a attendu plus de cinq minutes. Le contrôle exige une date de création valide et non future, puis s'appuie sur le statut persistant et la transaction serveur pour empêcher le rejeu. Une date future reste refusée.

Six assertions supplémentaires couvrent le statut obtenu après expédition, l'horodatage, le refus d'une seconde expédition, l'autorisation d'une expédition tardive et le rejet d'une date future. Le libellé statique du harnais passe de **366 à 372 assertions** ; les tests ne sont pas déclarés exécutés.

**Migration et compatibilité :** les documents existants marqués `in_transit` doivent être considérés comme déjà expédiés uniquement si un mouvement `transfer_dispatch` correspondant existe dans le journal autoritatif. Ne pas les convertir automatiquement depuis le navigateur. Les anciens transferts sans mouvement correspondant nécessitent une réconciliation contrôlée avant intégration.


## Correction — liaison stricte des mouvements de transfert (28 novembre 2026)

L'audit a ajouté deux contrôles de rapprochement entre le transfert persistant et le journal immuable :
- validateStockTransferDispatchMovementLink exige un mouvement transfer_dispatch référant exactement l'identifiant du transfert, l'organisation, le magasin source, le produit, le patron auteur et un delta négatif égal à toute la quantité expédiée.
- validateStockTransferReceiptMovementLink exige, pour chaque réception, un mouvement transfer_receipt référant exactement l'événement de réception, le magasin destinataire, le produit, l'auteur et le delta positif égal aux seules unités acceptées. Si aucune unité n'est acceptée, aucun mouvement de stock n'est permis.

Dix assertions supplémentaires couvrent les liens exacts, les quantités, le sens du mouvement, les magasins et l'absence de crédit en cas de refus total. Le libellé statique du harnais passe de 373 à 383 assertions ; ce nombre n'est pas une preuve d'exécution.

L'audit a également corrigé l'horodatage manquant dans validateStockTransferReceipt, qui pouvait provoquer une erreur d'exécution lors du contrôle de la date. La fonction valide maintenant explicitement l'heure de référence avant de comparer l'heure de réception.

Limite de production : ces fonctions ne créent ni ne verrouillent les mouvements. Le serveur doit encore imposer l'unicité des clés, relire transfert, réception, stock et journal autoritatifs, puis effectuer le débit/crédit, l'écriture du mouvement et le changement d'état dans une transaction atomique. Aucune intégration dans l'application principale ni opération Firebase n'a été effectuée.
