# Audit des reçus clients — partage et impression

Date : 28 novembre 2026  
Branche : `comptiva/monthly-stability-audit`

## Fonctionnalités présentes après correction

- Impression : la fonction existante `printReceipt(saleId)` ouvre le reçu de vente et lance la boîte de dialogue d'impression du navigateur. Le navigateur et l'appareil doivent autoriser les fenêtres contextuelles et disposer d'une imprimante ou d'une option PDF.
- WhatsApp : depuis chaque ligne de vente, l'action WhatsApp prépare un message contenant les données essentielles du reçu et ouvre le lien WhatsApp du numéro du client. Le commerçant doit vérifier puis appuyer lui-même sur Envoyer.
- E-mail : depuis chaque ligne de vente, l'action E-mail prépare un message `mailto:` adressé à l'e-mail enregistré sur la fiche client. Le commerçant doit vérifier puis envoyer depuis son application de messagerie.
- Fiche client : ajout d'un champ e-mail facultatif avec validation de format. Les anciennes fiches sans e-mail restent compatibles.
- Liste clients : affichage de l'e-mail lorsqu'il est renseigné.

## Contenu partagé

Le texte partagé comprend le numéro de reçu, la date, le client, l'article, la quantité, le prix unitaire, le total, le mode de paiement, le montant encaissé et le solde restant.

## Limites importantes non masquées

- Aucun e-mail n'est envoyé automatiquement par COMPTIVA : `mailto:` ouvre l'application de messagerie de l'appareil. Il n'y a pas de serveur SMTP ni de fournisseur d'e-mail connecté.
- Aucun message WhatsApp n'est envoyé automatiquement : WhatsApp s'ouvre avec un texte prérempli et l'utilisateur doit confirmer l'envoi.
- Le partage actuel est un reçu textuel, pas une pièce jointe PDF. L'impression reste disponible via la page de reçu.
- Le modèle actuel ne comporte pas de profil de commerce complet exploitable dans le reçu. Le reçu imprimé et le texte partagé affichent COMPTIVA, mais le nom personnalisé de la boutique, son adresse et son téléphone restent à intégrer depuis un profil commerçant vérifié. Ne pas inventer ces coordonnées.
- Les actions de partage nécessitent que la vente soit associée à une fiche client. WhatsApp exige un numéro guinéen valide au format +224 ; l'e-mail exige une adresse valide.
- Aucun test réel sur Android, iOS, navigateur de bureau, application WhatsApp ou client e-mail n'a été exécuté dans cette étape.

## Contrôles de sécurité et compatibilité

- Les données du reçu sont encodées dans les paramètres URL.
- L'adresse e-mail est validée avant la construction du lien `mailto:`.
- Le numéro WhatsApp est normalisé et contrôlé avant ouverture.
- Les anciennes fiches clients sans champ `email` restent acceptées.
- Aucun envoi en arrière-plan, aucune intégration externe et aucune modification Firebase n'ont été ajoutés.

## Suite nécessaire

1. Ajouter un profil de commerce (nom, téléphone, adresse, éventuellement logo) et l'utiliser dans les reçus.
2. Ajouter un vrai export PDF partageable en pièce jointe, sans dépendre de l'impression.
3. Si l'envoi automatique est demandé plus tard, connecter un fournisseur e-mail et une API WhatsApp Business officielle, avec consentement, journal d'envoi et gestion des erreurs.
4. Tester les trois parcours sur appareils et navigateurs réels avant publication.

Ces fonctions ont été ajoutées à la branche d'audit uniquement. Elles ne sont pas publiées sur `main`.
