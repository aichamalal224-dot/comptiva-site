# COMPTIVA — Contrat métier des commandes, livraisons et confirmations

Date : 28 novembre 2026  
Branche de travail : `comptiva/monthly-stability-audit`  
Statut : spécification de conception et critères d'acceptation. **Aucun de ces flux n'est déclaré intégré à l'application ou connecté à Firebase.**

## 1. Décision fondamentale : trois flux distincts

Le mot « commande » recouvre des opérations différentes. Elles ne doivent pas partager un même statut ni déclencher les mêmes mouvements de stock.

1. **Instruction / demande du patron à un vendeur** : le patron demande une action à un vendeur (préparer une livraison, compter un stock, réceptionner un lot, traiter une demande client, etc.). Le vendeur accepte ou refuse. Cette instruction ne modifie pas automatiquement le stock.
2. **Commande fournisseur** : le commerce commande des articles à un fournisseur. Le fournisseur peut accepter/refuser, puis expédier et livrer tout ou partie. Le stock augmente uniquement à la réception physique confirmée et validée.
3. **Transfert inter-magasins** : le patron organise le déplacement d'articles d'un magasin source vers un magasin destinataire. Le stock source est réservé/décrémenté selon le protocole retenu ; le stock destinataire n'augmente qu'à la réception acceptée. Chaque mouvement est lié au transfert et idempotent.

Ne jamais transformer une acceptation d'instruction en réception de marchandise. Ne jamais augmenter le stock au seul motif qu'une commande fournisseur a été acceptée.

## 2. Instruction du patron à un vendeur

### Cycle de vie proposé

`draft` → `sent` → `accepted` ou `refused`  
Après acceptation : `in_progress` → `completed`  
Branches possibles : `cancelled`, `overdue`.

- Le patron crée l'instruction, choisit le magasin et le ou les vendeurs affectés, décrit l'action et fixe éventuellement une échéance.
- Le vendeur affecté reçoit l'instruction et peut l'accepter ou la refuser avec un motif obligatoire en cas de refus.
- Le vendeur peut signaler le début, ajouter un commentaire et déclarer l'action terminée avec preuve ou détail si nécessaire.
- Le patron voit immédiatement le statut, l'auteur, les dates, les motifs et l'historique.
- Seul le patron peut annuler une instruction envoyée ; l'annulation est tracée et ne supprime pas l'historique.
- Une instruction en retard est signalée sans être marquée comme terminée automatiquement.

Une instruction ne crée pas de vente, ne change pas le stock et ne valide pas une réception par elle-même.

## 3. Commande fournisseur

### Cycle de vie proposé

`draft` → `submitted` → `accepted` / `refused`  
Après acceptation : `partially_shipped` / `shipped` → `partially_received` / `received`  
Branches : `overdue`, `cancelled`, `received_with_issues`.

- La commande contient fournisseur, magasin destinataire, lignes produits, quantités, prix/coûts réservés au patron, dates et référence.
- L'acceptation fournisseur ne crédite pas le stock.
- À chaque livraison, le vendeur autorisé ou le patron confirme les quantités reçues, refusées et endommagées, ligne par ligne.
- Une réception partielle conserve le reliquat attendu.
- Seules les unités acceptées et conformes créditent le stock du magasin destinataire.
- Les unités refusées ou endommagées sont consignées avec motif et ne sont pas ajoutées au stock disponible.
- La somme des réceptions ne peut jamais dépasser les quantités commandées/expédiées autorisées.
- Toute correction après validation passe par un événement compensatoire tracé, jamais par l'effacement de l'événement initial.

Les coûts d'achat, prix fournisseurs, dépenses et marges sont réservés au patron. Un vendeur peut recevoir les informations opérationnelles minimales nécessaires à la réception, sans voir les coûts confidentiels.

## 4. Transfert inter-magasins

Le transfert reste un flux séparé avec les statuts de préparation, expédition, réception partielle, réception complète, refus/incident et annulation. Le vendeur destinataire peut confirmer uniquement les quantités de son magasin affecté. Les quantités acceptées créditent le magasin destinataire ; les quantités refusées ou endommagées n'y entrent pas. Le patron voit les deux côtés, les deux magasins, les écarts et tous les événements.

Le protocole de stock doit être transactionnel ou explicitement réconciliable : pas de débit/crédit indépendant susceptible de créer ou perdre des unités en cas de panne. Chaque expédition et réception utilise une clé d'idempotence stable.

## 5. Vue de transparence patron

Le patron doit disposer d'une vue consolidée et de filtres par magasin, vendeur, type de flux, statut et période. Il voit :
- toutes les instructions envoyées, acceptées, refusées, en cours, terminées, annulées ou en retard ;
- toutes les commandes fournisseurs, leurs lignes, montants, acceptations/refus, expéditions, réceptions partielles, écarts et reliquats ;
- tous les transferts, magasins source/destination, confirmations et anomalies ;
- l'auteur de chaque action, date/heure serveur, motif, ancienne/nouvelle valeur et historique ;
- les stocks, ventes, dettes, remboursements et alertes de chaque magasin, ainsi que les totaux de l'organisation.

Un vendeur ne voit que les instructions qui lui sont affectées, les opérations autorisées de son magasin et les réceptions qui le concernent. Il ne voit ni les autres magasins ni les coûts, achats financiers, dépenses, marges ou bénéfices réservés au patron.

## 6. Alertes de stock rouge / vert

Le seuil d'alerte est configurable par le patron pour chaque produit et magasin.

- **Rouge — rupture** : quantité disponible égale à zéro.
- **Rouge — stock faible** : quantité disponible positive mais inférieure ou égale au seuil.
- **Vert — stock suffisant** : quantité disponible supérieure au seuil.
- **Inconnu** : quantité ou seuil absent/invalide ; ne jamais afficher du vert par défaut.

Le patron voit les alertes de tous ses magasins et peut filtrer par magasin/produit. Le vendeur voit uniquement celles de ses magasins affectés. Le statut doit être recalculé après chaque mouvement validé et synchronisé. Une notification est distincte du simple badge de couleur ; elle doit être dédupliquée pour éviter les alertes répétées à chaque synchronisation.

## 7. Présence des vendeurs

La vue patron distingue :
- **Connecté** : au moins une session valide avec heartbeat serveur récent.
- **Déconnecté** : événement de déconnexion explicite pour la session, ou toutes les sessions terminées explicitement.
- **Connexion non confirmée** : heartbeat expiré, perte réseau, application fermée brutalement ou appareil injoignable.
- **Inconnu** : aucune présence fiable disponible.

Gérer plusieurs appareils par vendeur : une déconnexion sur un appareil ne doit pas marquer le vendeur déconnecté si une autre session reste active. Les heartbeats sont écrits par un mécanisme de confiance ; l'heure système du navigateur n'est pas une preuve. Le patron voit la dernière activité connue et les magasins affectés.

## 8. Notifications et rappels

La première version doit privilégier une notification interne COMPTIVA avec état lu/non lu. Les rappels d'échéance doivent être préparés par un traitement serveur planifié, qui relit le statut et les droits avant envoi et déduplique chaque rappel.

SMS, WhatsApp ou notifications push externes ne sont considérés actifs qu'après intégration réelle, consentement et tests du fournisseur. En l'absence de connecteur opérationnel, COMPTIVA peut préparer un texte à envoyer, mais ne doit jamais prétendre l'avoir envoyé automatiquement.

## 9. Sécurité, cohérence et audit

- L'identité vient de Firebase Auth ; rôle, statut et affectations sont relus depuis une source serveur de confiance.
- Chaque instruction, commande, réception et transfert porte organisation, magasin(s), créateur, dates serveur et identifiants stables.
- Chaque transition est validée par une machine d'états : transitions interdites refusées, motif obligatoire pour refus/incident.
- Les journaux d'événements sont append-only ; aucune modification silencieuse de l'historique.
- Stock, réception, vente, dette et remboursement nécessitant plusieurs écritures sont appliqués par transaction serveur ou protocole idempotent.
- Les droits du patron couvrent tous les magasins de son organisation ; ceux du vendeur restent limités à ses magasins affectés.
- Les documents contenant coûts et bénéfices doivent être séparés des documents opérationnels lisibles par les vendeurs.
- Les règles Firestore et les tests Emulator doivent vérifier les refus, pas seulement l'interface.

## 10. Tests d'acceptation indispensables

1. Un vendeur accepte ou refuse une instruction qui lui est assignée ; un autre vendeur ne peut pas répondre.
2. Un refus exige un motif et reste visible au patron.
3. Une instruction terminée ne modifie pas le stock sans opération de stock distincte.
4. L'acceptation d'une commande fournisseur ne modifie pas le stock.
5. Une réception partielle crédite uniquement la quantité acceptée ; le reliquat reste attendu.
6. Les quantités refusées/endommagees ne créditent pas le stock.
7. Un rejeu de réception ne crédite jamais deux fois le stock.
8. Un transfert est visible dans les magasins source et destination et ne crée qu'un mouvement net.
9. Le patron voit tous les magasins et toutes les transitions ; le vendeur ne voit que son périmètre.
10. Un coût fournisseur ou un bénéfice ne fuit pas dans les données accessibles au vendeur, y compris les objets imbriqués.
11. Une quantité nulle/faible affiche rouge ; une quantité suffisante affiche vert ; une donnée invalide affiche inconnu.
12. Un heartbeat expiré affiche « connexion non confirmée », pas une déconnexion volontaire.
13. Deux sessions du même vendeur sont gérées indépendamment.
14. Une notification en retard n'est envoyée qu'une fois et seulement si l'objet est toujours en retard.
15. Une panne réseau, un double clic ou une reprise hors ligne ne provoque ni double stock ni perte d'événement.

## 11. État de réalisation et prérequis

Ce document formalise les règles métier à implémenter. Les validateurs de transferts, réception, alertes et présence du prototype restent des fonctions pures non intégrées. Les workflows instruction-vendeur et commande fournisseur décrits ici ne sont pas encore implémentés. Il manque toujours le schéma final, les règles Firestore complètes réellement utilisées, le backend transactionnel, les tests Emulator, la migration contrôlée et l'intégration UI.

**Interdiction de mise en production** : ne pas activer les comptes vendeurs multi-magasins ni migrer les données tant que les règles serveur, transactions, tests d'accès négatifs et tests multi-appareils ne sont pas validés. Aucune règle Firebase, donnée réelle, branche principale ou publication n'est modifiée par ce document.
