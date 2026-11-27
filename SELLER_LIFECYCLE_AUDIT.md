# COMPTIVA — Audit du cycle de vie des comptes vendeurs

Date : 28 novembre 2026  
Branche : `comptiva/monthly-stability-audit`

## Périmètre vérifié

Revue du prototype `multi-store-model.js` et de ses tests. Les fonctions suivantes sont maintenant présentes :

- `validateSellerInvitation` : validation d'une invitation créée par le patron, email normalisé, magasins valides, droits limités au rôle vendeur et expiration maximale de sept jours.
- `validateSellerInvitationAcceptance` : vérification de l'identité Firebase fournie au backend, de l'email, du jeton et de l'état pending.
- `validateSellerInvitationRevocation` : révocation d'une invitation encore pending par le patron.
- `validateSellerSuspension` : suspension d'un vendeur actif par le patron avec motif.
- `validateSellerReactivation` : réactivation d'un vendeur suspendu, à condition que ses magasins affectés restent valides.
- `validateSellerStoreAssignment` : affectation à plusieurs magasins actifs, sans doublons ni affectation vide.
- `authorizeWithCurrentMembership` : refuse un bundle local différent de l'adhésion courante fournie au contrôle.

## Règles de comportement à conserver

1. Chaque vendeur doit posséder son propre compte Firebase Auth et son propre UID ; ne jamais communiquer au vendeur le compte ou le mot de passe du patron.
2. Le patron est le seul à inviter, suspendre, réactiver et modifier les magasins affectés.
3. Un vendeur actif ne peut agir que dans les magasins actuellement affectés à son adhésion.
4. La suspension doit bloquer les opérations protégées suivantes, même si l'application du vendeur est encore ouverte.
5. Une modification d'affectation doit invalider les anciennes autorisations et ne pas attendre une reconnexion volontaire du vendeur.
6. La révocation d'une invitation pending doit empêcher son acceptation ultérieure.
7. Chaque changement de membre doit produire un événement d'audit non modifiable, horodaté côté serveur.

## Tests exécutés

Le fichier `multi-store-model.test.js` contient maintenant **178 assertions**. L'exécution isolée a retourné :

`PASS: 178 assertions exécutées dans le harnais JavaScript isolé`

Les nouveaux cas couvrent notamment : suspension autorisée et refusée, motif obligatoire, interdiction de suspendre le patron comme vendeur, réactivation réservée au patron, refus d'une réactivation en double, validation des affectations multi-magasins, rejet des magasins inconnus/dupliqués, interdiction de retirer toutes les affectations, et refus d'un ancien instantané d'adhésion.

Cette exécution a été réalisée dans un environnement JavaScript isolé avec assertions simulées compatibles Node.js. Elle ne constitue pas un lancement de Firebase Emulator, un test Auth réel, ni un test multi-appareils.

## Bloqueurs de production

**Le cycle de vie vendeur n'est pas encore intégré à l'application COMPTIVA.** Aucun écran patron, invitation email réelle, création de compte Auth, suspension serveur ou affectation magasin n'a été livré par ces fonctions.

Pour rendre la révocation immédiate et fiable, le backend doit :

- charger l'adhésion courante depuis Firestore avec l'identité Firebase vérifiée à chaque opération protégée (ou utiliser un mécanisme de révocation équivalent, démontré et testé) ;
- ne jamais se fier à un rôle, un UID, un statut ou une liste de magasins envoyés par le navigateur ;
- accepter l'invitation et consommer son jeton à usage unique dans une seule transaction atomique ;
- écrire le changement d'adhésion et son événement d'audit dans une transaction serveur ;
- incrémenter une version d'adhésion lors d'une suspension ou d'un changement d'affectation, et rejeter les anciennes versions ;
- refuser par règles Firestore toute auto-promotion, modification par un vendeur de son rôle/statut/permissions, lecture hors organisation et écriture hors magasin affecté ;
- tester les accès avec patron A, vendeurs A1/A2, vendeur suspendu, patron B, compte sans adhésion et utilisateur non authentifié.

Aucun jeu complet de règles Firestore COMPTIVA ni configuration d'émulateur n'est actuellement présent à la racine du dépôt examiné. Les règles historiques archivées ne prouvent pas quelles règles sont actuellement publiées.

## Critères de sortie avant déclaration « terminé »

- [ ] Création/invitation vendeur réelle, email vérifié et acceptation à usage unique.
- [ ] Affectation initiale et modification de plusieurs magasins.
- [ ] Suspension testée pendant qu'une session vendeur est déjà ouverte.
- [ ] Réactivation et révocation d'invitation testées.
- [ ] Tests Firestore Emulator d'autorisation et de refus sur toutes les collections.
- [ ] Tests multi-clients simultanés et changement d'affectation en cours de session.
- [ ] Journal d'audit serveur append-only.
- [ ] Tests de non-régression du compte patron et des données marchandes existantes.
- [ ] Sauvegarde et migration contrôlée avant toute activation sur les données existantes.

## Conclusion

Le modèle de règles et ses validations progressent, mais le chantier reste substantiel : il faut encore construire le flux serveur et l'interface, intégrer le schéma multi-magasins, écrire les règles Firestore effectives, exécuter les tests émulateur et préparer la migration. Ne pas annoncer la fonctionnalité patron/vendeur/multi-magasins comme terminée avant ces preuves.


## Contrôle complémentaire — invitation à l'acceptation et révocation

Une revue complémentaire a identifié qu'un appel direct au validateur d'acceptation ne revalidait pas tous les attributs de l'invitation (organisation, rôle vendeur, auteur patron, magasins, liste de permissions et durée maximale). Les contrôles ont été renforcés pour revalider ces champs au moment de l'acceptation, et la révocation vérifie désormais aussi l'organisation, le rôle et l'auteur d'origine.

Les nouveaux tests négatifs couvrent une invitation d'une autre organisation, une tentative de rôle propriétaire, un créateur falsifié, un magasin inconnu, une permission propriétaire, une durée excessive et une révocation d'une invitation étrangère ou dont l'auteur est falsifié.

Cela reste une prévalidation : le backend doit charger le document d'invitation depuis Firestore, consommer le jeton et créer l'adhésion dans une transaction atomique.
