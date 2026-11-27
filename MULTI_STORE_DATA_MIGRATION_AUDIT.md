# COMPTIVA — Inventaire des écritures et prérequis de migration multi-magasins

Date de contrôle : 27 novembre 2026  
Branche : `comptiva/monthly-stability-audit`  
Base inspectée : `index.html` (blob `ffa1fe8481a77c8b46d550aeee1925f441cf0d3c` avant ajout de ce document).

## 1. Architecture d'écriture actuellement observée

- Le stockage local est sélectionné par UID : `comptiva_user_v1_<uid>`.
- La synchronisation cloud envoie le contenu complet de `db` dans un seul document : `users/{uid}/comptivaData/main`.
- `saveDB()` sérialise la base locale puis déclenche `krediQueueCloudSave()`.
- La file cloud écrit le snapshot complet de `db` avec `.set(...)`.
- Les données métier sont des tableaux locaux : `clients`, `sales`, `debts`, `payments`, `purchases`, `expenses`, `products`.

Ce modèle isole actuellement les comptes individuels, mais ne permet pas à plusieurs UID d'écrire de façon sûre dans une même base de magasin. Il ne faut donc pas simplement donner au vendeur l'UID du patron ou partager le document `main`.

## 2. Points d'écriture métier repérés

Le formulaire central `saveForm(e)` est le principal point d'ajout des opérations :
- produit : ajout à `db.products` ;
- client : ajout à `db.clients` ;
- vente : ajout à `db.sales`, éventuellement diminution de `db.products[].quantity` et création d'une dette dans `db.debts` ;
- achat : ajout à `db.purchases`, éventuellement augmentation de `db.products[].quantity` ;
- dépense : ajout à `db.expenses` ;
- dette indépendante : ajout à `db.debts` ;
- remboursement : ajout à `db.payments`.

Les remboursements sont reliés à une dette par `debtId). Les ventes à crédit relient une vente à une dette et à un client. Les ventes qui suivent un produit stocké utilisent `stockProductId`.

Les autres occurrences de `.filter()` dans les fonctions d'affichage et de calcul sont des lectures/filtrages, pas des écritures. Les suppressions visibles dans l'extrait audité ne constituent pas encore un workflow métier de suppression/annulation ; les `pop()` observés dans `saveForm` servent à annuler une ligne d'achat provisoire en cas de validation échouée.

## 3. Risque critique pour plusieurs vendeurs

La synchronisation actuelle est une synchronisation de base complète par compte :
`users/{uid}/comptivaData/main`.

Si plusieurs vendeurs partagent le même UID, ils partagent les identifiants et les sessions, ce qui est à proscrire. S'ils ont des UID distincts et écrivent dans un document commun, la logique actuelle de fusion locale/distante et de remplacement complet n'est pas une stratégie transactionnelle multi-écrivains. Deux vendeurs peuvent modifier des versions différentes de la base et provoquer des conflits, pertes ou doublons.

Le modèle actuel ne contient pas systématiquement les champs de contexte nécessaires à la traçabilité : organisation, magasin, auteur de création et auteur de modification. Il faut les introduire dans les opérations migrées et nouvelles.

## 4. Impacts métier à traiter dans la refonte

- Vente : la création de vente, la dette éventuelle et la décrémentation du stock doivent être cohérentes ensemble.
- Achat : achat et augmentation du stock doivent être reliés au même magasin.
- Remboursement : doit rester lié à une dette du même magasin / organisation, sauf règle de transfert explicitement conçue.
- Client : déterminer si les clients sont propres au magasin ou partagés au niveau de l'organisation ; prévoir les doublons éventuels sans fusion automatique.
- Produit : distinguer le catalogue éventuellement partagé de la quantité réellement détenue par chaque magasin. Une quantité unique sur une fiche produit ne suffit pas pour plusieurs stocks.
- Transfert : créer un mouvement source/destination avec identifiant unique et état de traitement ; ne pas faire deux mises à jour indépendantes non réconciliables.
- Rapports : agréger par organisation, magasin et vendeur à partir d'opérations portant des métadonnées fiables.

## 5. Stratégie recommandée

1. Ne pas modifier immédiatement `saveForm` pour ajouter un `storeId` arbitraire : cela ne résout ni les droits ni les conflits.
2. Concevoir le modèle de données séparant catalogue produit et stock par magasin.
3. Définir les permissions serveur par organisation, rôle et magasin.
4. Introduire un service métier central qui valide l'organisation, le magasin, l'acteur et l'opération avant écriture.
5. Écrire chaque opération dans un document indépendant avec ID stable et métadonnées d'audit ; utiliser transactions ou opérations idempotentes pour les changements de stock et les liens financiers.
6. Migrer les données existantes vers un magasin principal, en gardant les IDs historiques et en comparant les totaux et références avant/après.
7. Adapter ensuite chaque écran et rapport pour filtrer ou agréger selon le rôle et le magasin.
8. Tester au minimum deux vendeurs simultanés dans un magasin, deux magasins distincts, un patron multi-magasins, et un compte d'une autre organisation.

## 6. Décision sur la suite

Le chantier doit commencer par un prototype isolé du modèle de données et des règles d'accès, puis tests automatisés de scénarios de lecture/écriture. La base actuelle ne doit pas être migrée ni remplacée tant que ces tests ne passent pas.

Aucun code métier n'a été modifié dans cette étape. Aucune règle Firestore n'a été publiée, aucune donnée n'a été migrée, aucun déploiement ou merge n'a été effectué.
