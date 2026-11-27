# COMPTIVA — Matrice de tests de sécurité Firestore multi-magasins

Statut : spécification de tests, non exécutée. Date : 27 novembre 2026.

## État constaté dans le dépôt

- Aucun fichier `firestore.rules`, `firebase.json`, configuration d'émulateur Firestore ou suite de tests de règles n'a été trouvé à la racine de la branche audit.
- `FIRESTORE_SUBSCRIPTION_RULES_PATCH.txt` est un texte de consignes pour un bloc d'abonnement. Ce n'est pas le fichier complet des règles et il ne prouve pas que ces règles sont publiées dans le projet Firebase.
- Il est donc impossible de certifier les règles actuellement actives ou de les remplacer sans risque. Ne pas publier de règles construites à partir de cette seule matrice.

## Frontière de confiance obligatoire

1. L'identité de l'acteur vient exclusivement de `request.auth.uid` / du jeton Firebase vérifié.
2. L'organisation, le rôle et les magasins affectés doivent être lus depuis des documents d'adhésion protégés, pas acceptés depuis les champs du formulaire ou un objet envoyé par le navigateur.
3. Un client ne peut ni s'ajouter comme propriétaire, ni s'attribuer un rôle, ni changer son affectation, ni écrire un événement d'audit au nom d'un autre utilisateur.
4. Les champs initiaux `id`, `organizationId`, `storeId`, `createdBy` et `createdAt` sont immuables après création.
5. Les dates d'écriture doivent être validées côté règles avec `request.time` ou générées par un serveur de confiance. Les champs d'audit sensibles ne doivent pas être laissés au choix du client.
6. Les écritures touchant plusieurs documents (vente + stock, remboursement + dette, transfert entre magasins) doivent utiliser des transactions/batches validés côté serveur ou un protocole idempotent. Les règles seules ne garantissent pas la cohérence métier d'un flux mal conçu.

## Comptes de test requis

- Patron actif de l'organisation A.
- Vendeur actif affecté uniquement au magasin A1.
- Vendeur actif affecté uniquement au magasin A2.
- Vendeur suspendu de l'organisation A.
- Patron/propriétaire d'une organisation B.
- Utilisateur authentifié sans adhésion.
- Utilisateur non authentifié.

Les identifiants de ces comptes doivent être des UID de test, jamais des UID de production.

## Matrice lecture / écriture

| # | Scénario | Résultat attendu |
|---|---|---|
| 1 | Patron A lit l'organisation A | Autorisé |
| 2 | Patron A lit les magasins A1 et A2 | Autorisé |
| 3 | Vendeur A1 lit les données de A1 | Autorisé selon permissions |
| 4 | Vendeur A1 lit les données de A2 | Refusé |
| 5 | Vendeur A1 lit une organisation B | Refusé |
| 6 | Patron B lit l'organisation A | Refusé |
| 7 | Utilisateur sans adhésion lit A1 | Refusé |
| 8 | Utilisateur non connecté lit des données privées | Refusé |
| 9 | Vendeur suspendu lit A1 | Refusé |
| 10 | Vendeur A1 crée une vente attribuée à son propre UID dans A1 | Autorisé si action permise |
| 11 | Vendeur A1 crée une vente avec `createdBy` égal à l'UID d'un autre compte | Refusé |
| 12 | Vendeur A1 écrit une vente avec `organizationId` B ou `storeId` A2 | Refusé |
| 13 | Vendeur tente de modifier son rôle, son statut ou ses magasins affectés | Refusé |
| 14 | Vendeur tente de créer/modifier l'adhésion d'un autre membre | Refusé |
| 15 | Vendeur tente de supprimer ou annuler une vente validée | Refusé par défaut |
| 16 | Vendeur tente de modifier `createdBy`, `createdAt`, `storeId` ou `organizationId` d'une opération existante | Refusé |
| 17 | Patron modifie une opération de son organisation avec auteur de modification vérifiable | Autorisé selon action |
| 18 | Vendeur tente d'écrire dans le journal d'audit protégé | Refusé |
| 19 | Client tente de créer un faux événement d'audit avec un autre acteur | Refusé |
| 20 | Vendeur tente une lecture par requête qui pourrait retourner des documents d'un magasin non affecté | Refusé par les règles, pas seulement filtré par l'interface |
| 21 | Une opération est rejouée avec le même identifiant/idempotency key | Aucun doublon financier ou de stock |
| 22 | Deux vendeurs vendent simultanément le dernier article disponible | Pas de stock négatif ni de vente perdue silencieusement |
| 23 | Transfert A1 vers A2 : tentative de réception sans expédition valide | Refusé |
| 24 | Transfert rejoué deux fois | Un seul mouvement net de stock |
| 25 | Échec réseau au milieu d'une opération | État récupérable, sans double débit/crédit |

## Conditions d'acceptation avant activation

- Les tests 1 à 20 doivent être exécutés avec Firebase Emulator Suite et les règles réelles candidates.
- Les tests 21 à 25 exigent en plus des tests d'intégration transactionnels et multi-clients ; ils ne sont pas prouvés par un test de règles isolé.
- Tester les requêtes réelles utilisées par l'application : Firestore peut refuser une requête si ses contraintes ne garantissent pas que tous les résultats respectent les règles.
- Conserver les tests de régression de l'accès commerçant existant et du compte Créateur.
- Exécuter un test négatif inter-organisation avec les comptes séparés, puis vérifier qu'aucune donnée privée n'est retournée.
- Ne migrer aucune donnée réelle tant que ces tests ne passent pas et qu'une sauvegarde restaurable n'a pas été vérifiée.

## Bloqueurs actuels

- Règles Firestore complètes manquantes dans le dépôt.
- Configuration Firebase/émulateur et dépendances de test absentes de la racine auditée.
- Schéma multi-magasins non intégré à l'application.
- Aucune preuve de tests avec de vrais comptes Firebase ni de synchronisation multi-appareils.

**Conclusion :** cette matrice rend les exigences de sécurité vérifiables, mais elle n'active aucun droit et ne constitue pas une règle Firestore à copier-coller. La prochaine étape sûre est de récupérer le fichier complet des règles réellement utilisé par le projet et sa configuration, puis de construire les tests Emulator sur cette base.
