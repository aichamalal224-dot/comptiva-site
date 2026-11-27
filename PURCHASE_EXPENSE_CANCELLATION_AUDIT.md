# COMPTIVA — Audit des achats, dépenses et annulations

Date : 28 novembre 2026  
Branche : `comptiva/monthly-stability-audit`

## Vérifications du code principal

Lecture de `index.html` sur la branche :

- **Achats :** le formulaire valide un montant positif et une quantité non négative. Le produit est rapproché par nom normalisé, et non par identifiant stable. Si plusieurs produits ont le même nom, l'achat est annulé ; si aucun produit n'est trouvé, l'achat est enregistré sans mouvement de stock. La provenance organisation/magasin/auteur n'est pas ajoutée.
- **Dépenses :** le formulaire valide la description et un montant positif, puis enregistre la dépense localement. Il ne lui ajoute pas de provenance normalisée ni d'écriture immuable de caisse.
- **Annulation de vente :** aucune fonction `cancelSale` ou `deleteSale` n'a été trouvée dans la zone de code inspectée ; la table des ventes affiche l'impression du reçu, sans action d'annulation. Il n'y a donc pas encore de flux complet d'annulation et de contre-écriture.

Ces constats ne prouvent pas l'absence absolue de tout autre mécanisme dans chaque partie de l'application, mais les opérations examinées ne démontrent pas une gestion multi-magasins auditable.

## Contrôles ajoutés au prototype isolé

- `validatePurchaseRecord` : achats réservés au patron, montant entier GNF positif, quantité non négative, référence produit stable facultative et provenance obligatoire.
- `validateExpenseRecord` : dépenses réservées au patron, description/catégorie/moyen de paiement, montant entier GNF positif et provenance obligatoire.
- `validateSaleCancellation` : annulation patron uniquement, vente persistée cohérente, motif et clé d'idempotence obligatoires, refus des annulations répétées. Si des remboursements sont déjà associés à la vente, le helper bloque l'annulation simple et exige un parcours explicite de remboursement.

Pour une annulation, le résultat indique les montants/quantités à contre-passer. Il ne réalise pas ces écritures. Le backend devra effectuer en une transaction la modification du statut, la restauration éventuelle du stock, l'annulation de dette et les écritures de caisse. Les mouvements d'origine ne doivent jamais être supprimés ou réécrits.

## Tests

Le harnais JavaScript isolé a exécuté **130 assertions** avec succès. Les tests ajoutés couvrent notamment les permissions patron/vendeur, les montants invalides, les références produit, les dépenses, les motifs d'annulation, les rejouements et les ventes avec remboursements préexistants.

Ce sont des tests de fonctions pures. Aucun test Firebase Emulator, navigateur, transaction concurrente ou multi-appareils n'a été exécuté.

## Conditions avant activation

1. Associer les achats à un `productId` stable, pas au seul nom du produit.
2. Enregistrer chaque achat, entrée de stock, dépense, vente et remboursement comme opérations séparées avec auteur, organisation, magasin et horodatage serveur.
3. Calculer la caisse depuis un journal de mouvements immuable ou un agrégat transactionnel, et non par modification silencieuse d'un total.
4. Mettre les achats, la réception de stock et le mouvement de stock dans une transaction cohérente.
5. Pour annuler une vente, créer une contre-écriture ; ne jamais supprimer la vente originale. Si un paiement ou remboursement existe déjà, imposer un workflow financier distinct.
6. Écrire et exécuter les règles Firestore et les tests Emulator qui interdisent les accès vendeur aux achats, dépenses, coûts d'achat et marges.

**État :** améliorations du contrat de validation uniquement. Le modèle reste non intégré à `index.html`, les règles Firestore réelles n'ont pas été modifiées et rien n'a été publié ou fusionné dans `main`.
