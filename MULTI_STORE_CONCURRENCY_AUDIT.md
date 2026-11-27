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
