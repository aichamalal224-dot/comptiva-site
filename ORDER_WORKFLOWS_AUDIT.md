# COMPTIVA — Audit des workflows de commandes patron/vendeur et fournisseurs

Date : 28 novembre 2026  
Branche : `comptiva/monthly-stability-audit`  
Statut : contrat métier et prototype de validation ; aucune intégration dans `index.html`, aucune écriture Firebase et aucun envoi de notification.

## 1. Pourquoi trois workflows séparés

Le mot « commande » recouvre trois opérations différentes. Les réunir dans un même statut ou réutiliser le transfert de stock crée des ambiguïtés de responsabilité et des risques de stock :

1. **Mission / commande interne patron → vendeur** : le patron confie une tâche au vendeur d'un magasin (préparer, contrôler, compter, remettre ou traiter des articles). Le vendeur doit accepter ou refuser explicitement, puis signaler l'avancement et l'achèvement.
2. **Commande fournisseur** : le patron commande des articles à un fournisseur externe. Le patron consigne la réponse du fournisseur (acceptée/refusée), puis les réceptions partielles ou complètes. Une réception réelle doit alimenter le stock par le workflow de réception d'achat, pas par le simple changement de statut.
3. **Transfert inter-magasins** : déplacement physique d'articles entre deux magasins de la même organisation. Le workflow de transfert existant gère l'expédition, les quantités reçues/refusées/endommagées et les mouvements de stock. Il ne doit pas être utilisé pour représenter une commande fournisseur ou une mission vendeur.

## 2. États et transitions autorisées — mission patron/vendeur

| État précédent | Nouvel état | Acteur autorisé | Condition |
|---|---|---|---|
| draft | assigned | Patron | Vendeur actif affecté au magasin |
| assigned | accepted | Vendeur assigné | Confirmation explicite |
| assigned | refused | Vendeur assigné | Motif obligatoire |
| accepted | in_progress | Vendeur assigné | Début déclaré |
| accepted | completed | Vendeur assigné | Tâche terminée directement |
| in_progress | completed | Vendeur assigné | Confirmation d'achèvement |
| refused | assigned | Patron | Nouvelle affectation |
| État non terminal | cancelled | Patron | Annulation tracée |

Le vendeur ne peut pas accepter/refuser une mission destinée à un autre vendeur, ni intervenir dans un magasin auquel il n'est pas affecté. Une réaffectation ne peut être faite que par le patron lors d'une nouvelle transition de réaffectation. Le vendeur assigné reste immuable pendant l'exécution.

## 3. États et transitions — commande fournisseur

| État précédent | Nouvel état | Acteur autorisé | Condition |
|---|---|---|---|
| draft | submitted | Patron | Commande envoyée |
| submitted | supplier_accepted | Patron | Réponse du fournisseur consignée |
| submitted | supplier_refused | Patron | Motif du refus obligatoire |
| supplier_refused | submitted | Patron | Nouvelle soumission |
| supplier_accepted | partially_received | Patron | Réception partielle enregistrée |
| supplier_accepted | received | Patron | Réception complète enregistrée |
| partially_received | partially_received | Patron | Nouvelle réception partielle |
| partially_received | received | Patron | Solde reçu |

Le fournisseur est une partie externe : ce prototype ne prétend pas authentifier le fournisseur ni recevoir sa réponse automatiquement. Le patron enregistre la réponse reçue. Les quantités, produits, coûts et entrées de stock doivent être rapprochés dans une opération de réception d'achat transactionnelle et idempotente. Un statut `received` sans justificatif de réception ne doit pas modifier le stock.

## 4. Données de traçabilité minimales

Chaque commande doit conserver :
- `id`, `workflowType`, `organizationId`, `storeId` ;
- `createdBy`, `createdAt` immuables ;
- pour une mission interne : `assignedSellerUid` ;
- chaque transition : `transitionId`, `idempotencyKey`, `orderId`, `status`, `updatedBy`, `updatedAt` ;
- `reason` obligatoire pour un refus et recommandé pour une annulation ;
- la référence aux lignes/produits et aux réceptions, stockée dans les documents métier dédiés.

Le journal des transitions doit être append-only. Le statut courant est une projection reconstruisible depuis l'historique ou mis à jour atomiquement avec lui. Les clients ne doivent jamais pouvoir remplacer l'historique.

## 5. Notifications et relances

- À l'affectation : notification in-app au vendeur concerné.
- À l'acceptation ou au refus : notification in-app au patron ; un refus inclut son motif.
- À l'échéance dépassée sans réponse : proposer une relance au patron, puis au vendeur selon la politique définie.
- Après réception attendue non confirmée : préparer un message avec le numéro de commande, magasin, produits et retard.
- Les messages SMS, WhatsApp ou push ne sont pas actifs par ce prototype. Ils exigent un fournisseur réel, les consentements nécessaires, une gestion des échecs et une déduplication serveur.
- Une relance automatique doit re-vérifier côté serveur le statut, l'affectation et l'échéance au moment de l'envoi, et utiliser une clé de déduplication.

## 6. Contrôles ajoutés au prototype

`validateBusinessOrderTransition(...)` :
- distingue explicitement `patron_task` et `supplier_order` ;
- vérifie l'organisation, le magasin, l'identité de l'acteur et l'état précédent ;
- réserve la gestion des commandes fournisseurs au patron ;
- limite l'acceptation/refus d'une mission au vendeur actuellement assigné ;
- exige un motif de refus ;
- bloque les transitions hors séquence et les réutilisations de `transitionId` / `idempotencyKey` déjà présentes dans l'historique fourni ;
- interdit la modification du vendeur assigné pendant l'exécution ;
- autorise une affectation ou réaffectation seulement par le patron et seulement vers un vendeur actif affecté au magasin.

Ce validateur est une prévalidation pure. Le serveur doit charger lui-même l'état précédent et l'adhésion courante, vérifier les identifiants de transition dans la base et écrire transition + journal + projections dans une transaction. Ne jamais faire confiance à `previous`, aux droits ou à `existingTransitionIds` envoyés par le navigateur.

## 7. Tests et limites

Des scénarios automatisés ont été ajoutés au fichier `multi-store-model.test.js` pour l'acceptation/refus vendeur, l'isolement magasin, les motifs de refus, les rejeux, les affectations et les transitions fournisseur. Le compteur affiché par le fichier de test a été ajusté à 295 appels d'assertion présents dans le fichier, mais **l'exécution locale n'a pas été possible dans cette session** : ne pas considérer ce compteur comme un résultat de test exécuté.

Non réalisés :
- exécution Node du harnais ;
- tests Firebase Emulator et règles réelles ;
- intégration interface patron/vendeur ;
- notifications in-app, push, SMS ou WhatsApp ;
- transactions serveur et test multi-appareils.

## 8. Critères bloquants avant activation

- Récupérer le fichier complet des règles Firestore réellement utilisé et établir un test emulator reproductible.
- Implémenter les commandes comme documents dédiés avec journal append-only et transactions.
- Garantir que le patron voit toutes les missions, réponses, refus, retards, réceptions et historiques de tous ses magasins.
- Garantir que le vendeur ne voit que ses missions et les magasins affectés.
- Tester deux vendeurs simultanés, les retries réseau, les doubles réceptions et les notifications dupliquées.
- Ne pas activer les comptes vendeurs en production avant ces validations.

**Conclusion :** le prototype clarifie désormais les transitions et responsabilités des commandes internes et fournisseurs, sans les confondre avec les transferts de stock. Il ne constitue pas encore une fonctionnalité livrée ni une preuve de sécurité Firebase.
