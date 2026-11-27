# COMPTIVA — Audit des règles Firestore archivées et préparation multi-magasins

Date : 27 novembre 2026  
Branche : `comptiva/monthly-stability-audit`  
Statut : **reconstruction documentaire et audit de conception — non publiable telle quelle**.

## 1. Provenance et limites

Ce document reconstitue les règles COMPTIVA à partir des échanges archivés du 22 novembre 2026 et du patch d'abonnement conservé dans ce dépôt. Ce n'est pas une copie certifiée des règles actuellement actives dans Firebase. Le dépôt ne contient pas le fichier complet `firestore.rules`, ni `firebase.json`, ni configuration d'émulateur. Il faut donc récupérer la version réellement publiée avant toute modification de production.

Le fichier `Regles_Firestore_KrediGuinee_a_verifier.rules` retrouvé dans la bibliothèque concerne **KrediGuinée**, pas COMPTIVA ; il ne doit pas être réutilisé comme base COMPTIVA.

## 2. Base COMPTIVA retrouvée dans les archives

L'UID Créateur utilisé dans les échanges archivés est `ELopCSbMMrSTDEMCzNhchqonGci2`.

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn(){return request.auth != null;}
    function isCreator(){return signedIn() && request.auth.uid == "ELopCSbMMrSTDEMCzNhchqonGci2";}

    match /users/{userId}/{document=**} {
      allow read, write: if signedIn() && request.auth.uid == userId;
    }

    match /merchantDirectory/{merchantUid} {
      allow read, delete: if isCreator();

      allow create: if signedIn()
        && request.auth.uid == merchantUid
        && request.resource.data.keys().hasOnly(['uid','email','displayName','createdAt','updatedAt'])
        && request.resource.data.uid == merchantUid;

      allow update: if signedIn()
        && request.auth.uid == merchantUid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['email','displayName','updatedAt'])
        && request.resource.data.uid == merchantUid;
    }
  }
}
```

Attention : ce bloc est un extrait historique retrouvé, pas une preuve de l'état de production. Il n'inclut pas nécessairement les autres blocs présents dans Firebase.

## 3. Bloc d'abonnement archivé

Le patch `FIRESTORE_SUBSCRIPTION_RULES_PATCH.txt` propose de remplacer uniquement `match /merchantSubscriptions/{merchantUid}` par le bloc suivant :

```javascript
match /merchantSubscriptions/{merchantUid} {
  allow read, write: if isCreator();

  allow get: if signedIn() &&
    (request.auth.uid == merchantUid || isCreator());

  allow create: if signedIn() &&
    request.auth.uid == merchantUid &&
    request.resource.data.keys().hasOnly([
      'uid', 'status', 'trialStart', 'trialEnd',
      'createdAt', 'updatedAt'
    ]) &&
    request.resource.data.keys().hasAll([
      'uid', 'status', 'trialStart', 'trialEnd',
      'createdAt', 'updatedAt'
    ]) &&
    request.resource.data.uid == merchantUid &&
    request.resource.data.status == 'trial' &&
    request.resource.data.trialStart == request.time &&
    request.resource.data.createdAt == request.time &&
    request.resource.data.updatedAt == request.time &&
    request.resource.data.trialEnd > request.time &&
    request.resource.data.trialEnd <= request.time + duration.value(14, 'd');

  allow update, delete: if isCreator();
}
```

Les autorisations Firestore qui correspondent à plusieurs règles sont combinées par OR. Ici, les droits complets du Créateur sont intentionnels ; les autres clauses permettent au commerçant de lire sa fiche et de créer une seule fiche d'essai, sans pouvoir la prolonger lui-même. Ce bloc ne réalise aucun paiement et ne constitue pas un système d'activation automatique Mobile Money.

## 4. Audit des règles retrouvées

### Ce que la base protège déjà, si elle est bien celle publiée

- Les données sous `users/{uid}/...` sont accessibles uniquement au compte Firebase dont l'UID correspond.
- Le commerçant ne peut pas lire l'annuaire `merchantDirectory` ; le Créateur peut le lire et le supprimer.
- Le commerçant peut créer ou mettre à jour sa propre fiche d'annuaire, avec des champs de mise à jour limités.
- Le patch abonnement empêche le navigateur du commerçant de modifier ou supprimer sa fiche d'essai après création.

### Pourquoi ces règles ne suffisent pas pour patrons, vendeurs et magasins

- Le chemin `users/{uid}/...` sépare les comptes individuels ; il ne donne pas à un vendeur distinct le droit d'accéder au magasin de son patron.
- Aucun droit ni schéma Firestore n'est encore défini ici pour `organizations`, `stores`, `members`, affectations, transferts, mouvements de stock ou journaux d'audit.
- Ajouter un champ `role`, `ownerUid` ou `storeId` envoyé par le navigateur ne prouve pas l'appartenance. Les règles doivent lire une adhésion protégée et vérifier le rôle et l'affectation à chaque accès.
- Les règles historiques n'imposent pas de limite de type/longueur sur tous les champs de l'annuaire ; ce durcissement peut être traité séparément sans casser le flux V28.
- Le comportement V28 retrouvé dans les archives évite que le commerçant lise son document `merchantDirectory` : il écrit sa fiche avec fusion, tandis que la lecture reste réservée au Créateur. Toute refonte doit préserver ce fonctionnement jusqu'à remplacement testé.

## 5. Architecture de sécurité cible à valider

S'appuyer sur `MULTI_STORE_ARCHITECTURE.md` et le prototype existant. Le modèle proposé est :

- `organizations/{orgId}` : propriétaire et état de l'organisation ;
- `organizations/{orgId}/members/{uid}` : rôle, statut, affectations de magasins et permissions ;
- `organizations/{orgId}/stores/{storeId}` : magasins de cette organisation ;
- données métier isolées par magasin ;
- journal d'audit protégé au niveau de l'organisation.

Principes obligatoires pour les futures règles :

1. L'identité provient de `request.auth.uid`, jamais d'un UID fourni par le client.
2. L'adhésion, le rôle et les affectations sont lus depuis des documents que le membre ne peut pas s'auto-attribuer ni modifier.
3. Un patron propriétaire actif peut accéder aux magasins de son organisation.
4. Un vendeur actif ne peut accéder qu'aux magasins qui lui sont affectés et aux actions permises pour son rôle.
5. Les champs initiaux `organizationId`, `storeId`, `createdBy` et `createdAt` sont immuables.
6. Les événements d'audit sensibles sont créés par un serveur de confiance ou protégés contre l'usurpation.
7. Les ventes avec décrément de stock, remboursements et transferts doivent être atomiques ou suivre un protocole idempotent testé. Des règles Firestore seules ne remplacent pas la logique transactionnelle.

Ne pas publier de règles multi-magasins avant d'avoir défini précisément les chemins, les requêtes réelles de l'application et les contrôles d'appartenance. Une règle de refus générale n'annule pas une autorisation positive présente dans un autre bloc correspondant : chaque bloc doit être audité.

## 6. Étapes de réalisation restantes

1. Obtenir et archiver le texte complet des règles actuellement publiées, sans le remplacer.
2. Définir les permissions métier finales patron/vendeur, notamment corrections, retours, caisse, dépenses, achats, remboursements et clôtures.
3. Écrire un fichier candidat complet de règles Firestore et les tests Emulator correspondants.
4. Ajouter l'organisation, le magasin principal et les adhésions dans un environnement de test.
5. Brancher l'authentification individuelle des vendeurs et l'invitation sécurisée.
6. Migrer une copie de données vers un magasin principal et comparer les totaux/références.
7. Brancher progressivement les opérations par magasin, transactions de stock, transferts et journal d'audit.
8. Tester deux vendeurs simultanés, deux magasins, deux organisations, mode hors ligne et restauration.
9. Seulement après validation et autorisation explicite : préparer la mise en production.

## 7. État de cette étape

- Archives COMPTIVA des règles retrouvées et rapprochées du patch présent dans le dépôt.
- Différence KrediGuinée / COMPTIVA explicitement identifiée.
- Prototype multi-magasins : 34 assertions réussies dans l'environnement JavaScript isolé de l'audit.
- Aucun fichier de règles complet actif, aucun test Firebase Emulator et aucune preuve d'accès réel multi-comptes disponibles.
- Aucune modification de données, règle Firebase de production, déploiement ou fusion effectuée.

**Conclusion :** la séparation des comptes individuels est le socle historique, mais elle ne permet pas à elle seule de réaliser le partage sécurisé patron-vendeur. La suite doit construire et tester la nouvelle frontière d'organisation/magasin avant de connecter l'interface et de migrer les données.
