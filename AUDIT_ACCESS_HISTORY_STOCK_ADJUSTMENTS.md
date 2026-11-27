# COMPTIVA — Audit des historiques, permissions et corrections de stock

Date : 28 novembre 2026  
Branche : `comptiva/monthly-stability-audit`

## 1. Constat sur l'application actuelle

Lecture de `index.html` sur la branche :

- La vente diminue directement `stockProduct.quantity` dans le tableau local.
- L'achat augmente directement la quantité du produit retrouvé par son nom.
- La création de dépense ajoute une ligne à `db.expenses`.
- Les lignes affichées dans ventes, achats, dépenses et stock ne montrent pas un historique normalisé de l'auteur, du magasin et de l'opération.
- Le code consulté ne montre pas de journal append-only de mouvements de stock ni de journal d'audit complet.
- Les droits patron/vendeur/magasins ne sont pas encore reliés à ces opérations dans le modèle principal.

Le stockage local et la sauvegarde globale déjà audités ne permettent pas, à eux seuls, de garantir une piste d'audit fiable ni une concurrence multi-vendeurs.

## 2. Contrôles ajoutés au prototype isolé

### `validateAuditEvent`
Vérifie l'enveloppe d'un événement : organisation, magasin, acteur, type et identifiant de cible, opération d'origine, action autorisée et horodatage récent. Les événements doivent être append-only : le serveur doit refuser toute modification ou suppression après création.

### `validateStockAdjustment`
Réserve les corrections de stock au patron, exige un motif et une clé d'idempotence, contrôle l'identité produit/magasin et refuse un résultat négatif ou un mouvement déjà appliqué.

## 3. Tests

Le harnais JavaScript isolé exécute **144 assertions réussies**. Les nouveaux tests couvrent les corrections de stock, les tentatives vendeur, les événements falsifiés, les événements hors magasin, les actions inconnues et les dates invalides.

Ces assertions ne sont pas des tests Firebase Emulator, ne prouvent pas les règles Firestore et ne testent pas plusieurs appareils simultanément.

## 4. Architecture requise avant production

1. Chaque opération métier doit être écrite avec `organizationId`, `storeId`, `actorUid`, `createdAt` serveur et un `operationId` unique.
2. Chaque vente, achat, correction et transfert de stock doit créer un mouvement de stock immuable, lié à l'opération source.
3. Les événements d'audit doivent être créés côté serveur ou dans une transaction fiable ; le client ne doit pas pouvoir choisir librement son acteur ou son horodatage.
4. Le vendeur ne doit pas pouvoir lire les coûts, marges, achats, dépenses ou rapports patron. Les données sensibles doivent être séparées dans des documents sécurisés, pas seulement masquées par l'interface.
5. Les règles Firestore doivent interdire update/delete sur les journaux d'audit et mouvements historiques, et contrôler les rôles/magasins côté serveur.
6. La suspension d'un vendeur doit être vérifiée à chaque opération sensible côté serveur ; retirer un bouton dans l'interface n'est pas suffisant.
7. Le patron doit pouvoir consulter un historique filtrable par magasin, période, vendeur et type d'opération.

## 5. État de livraison

- Prototype de validation : renforcé, non branché à l'application principale.
- `index.html` : non modifié pendant cette étape.
- Règles Firestore réelles : non modifiées et non vérifiées en production.
- Firebase Emulator / tests multi-comptes / multi-appareils : non exécutés.
- Fusion dans `main` : non effectuée.
- Publication : non effectuée.

**Conclusion :** la spécification des droits et de la traçabilité progresse, mais les comptes patron/vendeur et les magasins ne peuvent pas encore être déclarés opérationnels en production.
