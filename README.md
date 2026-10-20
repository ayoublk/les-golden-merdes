# Les Golden Merdes · Le Septième Stream

Jeu d’Halloween en français pour 2 à 20 joueurs, animé depuis une régie. L’animateur ne joue pas et ne vote pas. Interface adaptative, mode stream, démo locale et backend Firebase préparé.

## Essayer immédiatement

Node.js 22 ou supérieur. Aucune dépendance pour l’interface.

```powershell
node build.mjs
node server.mjs
```

Ouvrir http://127.0.0.1:4173, puis **Essayer la démo**. Lancer le timer, tester le formulaire avec **Passer joueur**, revenir à l’animateur et **Simuler les réponses des joueurs**. Révéler chaque réponse, ouvrir les votes, les simuler, les clôturer et passer à la question suivante. Après les neuf questions, présenter les trois films, ouvrir le vote final et dévoiler le vainqueur.

La démo conserve sa partie uniquement en mémoire et utilise une affiche illustrée générique et des emplacements de scènes, explicitement identifiés. Elle ne simule pas un service IA réel et n’effectue aucun appel payant. Les brouillons des joueurs sont enregistrés sur leur appareil.

## Connecter Firebase

Le projet Firebase n’a pas encore été créé : le multijoueur et les images réelles sont **non configurés**. Aucune clé IA n’a été ajoutée. La publication Sites est une prévisualisation privée ; Firebase Hosting est prévu pour l’accès des invités.

1. Créer un projet Firebase, une application Web, une base **Cloud Firestore** et un bucket **Storage**. Choisir une région européenne compatible (le code Functions utilise `europe-west1`). Activer **Authentication → Anonymous**. Les Cloud Functions et le stockage demandent un projet avec facturation activée ; la génération d’images est facturée par le fournisseur IA selon l’usage.
2. Copier la configuration **publique** de l’application Web dans `dist/config.js` en suivant `dist/config.example.js`. Garder `region = 'europe-west1'`. Ne jamais mettre une clé IA dans ces fichiers.
3. Installer Firebase CLI, se connecter et sélectionner le projet dans ce dossier :

```powershell
npm install -g firebase-tools
firebase login
firebase use --add
npm install --prefix functions
firebase functions:secrets:set OPENAI_API_KEY
node build.mjs
node --test tests/game.test.mjs
firebase deploy --only functions,firestore:rules,storage,hosting
```

Le CLI demande le secret de manière interactive ; ne pas le passer dans une commande, un fichier partagé ou le chat. `IMAGE_MODEL` est un paramètre Functions (`gpt-image-1` par défaut). Pour le modifier, utiliser un modèle de génération compatible avec les paramètres de `functions/index.mjs`. Les noms de modèles, tailles et accès doivent être vérifiés auprès du fournisseur avant le stream.

4. Dans Firebase Authentication, ajouter le domaine d’hébergement aux domaines autorisés si nécessaire. Ouvrir le site Firebase Hosting sur l’ordinateur de l’animateur, créer un salon, partager l’invitation, puis faire rejoindre deux appareils distincts pour une répétition.
5. Vérifier une génération réelle, sa durée et le budget avant l’émission. App Check est recommandé avant une ouverture au grand public ; les fonctions callable demandent une identité anonyme, mais ne sont pas actuellement configurées pour imposer App Check.

## Déroulement et score

- Le code de salon comporte six caractères. Les pseudos sont uniques sans distinction de casse. Les inscriptions sont fermées au lancement ; un joueur déjà inscrit peut retrouver son accès avec son identité anonyme.
- Les neuf questions fournies sont dans `functions/core.mjs`. `node build.mjs` les copie avec le moteur partagé vers l’interface. Le genre est un choix parmi les cinq propositions de la question 4. Chaque réponse accepte 500 caractères maximum.
- Le compte à rebours est synchronisé sur une date de départ serveur. Vert, puis orange à cinq minutes, puis rouge pulsé à une minute. Le mouvement respecte la préférence « réduire les animations ». À zéro, aucune soumission, aucun verrouillage. Les réponses peuvent être corrigées jusqu’au lancement des révélations.
- Envoyer une nouvelle version déclenche une nouvelle génération, sauf si les réponses sont identiques. Les anciennes tâches ne peuvent pas remplacer les images d’une version plus récente. Les corrections peuvent donc déclencher de nouveaux appels IA.
- L’animateur démarre les révélations une fois tous les films envoyés. Chaque clic révèle une réponse de plus. Aucune réponse à venir n’est livrée aux autres clients : les soumissions privées sont lues par les fonctions serveur.
- Après toutes les réponses d’une question, le vote s’ouvre. Une seule voix par joueur, modifiable jusqu’à la clôture, sans auto-vote. **Une voix reçue = un point.** Les votes ne sont pas ventilés publiquement avant clôture. L’animateur peut clôturer sans tous les votes après un avertissement.
- Les images se préparent pendant cette phase : une affiche et deux scènes. Deux tâches de films au maximum tournent en parallèle. Les générations peuvent prendre plusieurs minutes selon le nombre de joueurs et les limites du fournisseur. Les échecs sont visibles ; l’animateur peut les relancer jusqu’à trois tentatives par version. Une tâche bloquée devient relançable après vingt minutes. Un film en échec peut être présenté avec un remplacement et ses éventuelles images déjà produites.
- Après la question 9, les images sont révélées film par film. Le vote final porte sur le film complet. Le ou les premiers reçoivent **cinq points chacun**, sans multiplier le bonus par les voix. Sans vote final, aucun bonus. Le score total détermine le ou les vainqueurs, affichés avec leurs films et images. Le palmarès peut être exporté en JSON.

## Architecture

`dist/` : interface statique sans compilation ni framework. Les SDK Firebase sont chargés depuis le CDN officiel uniquement lorsque Firebase est configuré. Les polices Google disposent de polices de repli.

`functions/core.mjs` : transitions et calcul du score, partagés avec le mode démo. `functions/index.mjs` : callable `gameAction` avec transactions Firestore, rôle animateur vérifié sur le serveur, validation des votes, puis déclencheur `generateFilm` sur la collection privée `generationJobs`.

Les documents `rooms/{code}` contiennent uniquement l’état visible du salon, ses participants et les réponses déjà révélées. Les réponses complètes restent dans `submissions/{uid}`, lisibles uniquement par leur propriétaire côté client. Les votes sont privés et accessibles uniquement par le serveur. Toute écriture directe Firestore depuis le navigateur est interdite. Storage est écrit uniquement par Admin SDK ; les URL de téléchargement à jeton sont partagées via les films quand ils sont révélés. Les réponses et images sont conservées sans purge automatique ; elles peuvent être supprimées depuis le projet Firebase après l’événement.

L’accès animateur appartient à l’identité Firebase du navigateur créateur. Ne pas effacer ses données de navigation avant le stream. Il n’y a pas encore de transfert d’animateur ni de connexion par mot de passe. Recharger la page retrouve la dernière partie dans le même onglet via `sessionStorage`.

## Vérifications

```powershell
node --test tests/game.test.mjs
node --check dist/app.js
node --check functions/index.mjs
```

Neuf tests couvrent les transitions, l’expiration non bloquante, le vote pour soi, les points par voix, le bonus final, les égalités, l’absence de voix et les images indisponibles. Le parcours démo complet a aussi été testé au navigateur. Le backend réel, les règles dans l’émulateur et les appels IA doivent encore être vérifiés avec un projet Firebase configuré.

Références : [fonctions callable Firebase](https://firebase.google.com/docs/functions/callable), [transactions Firestore](https://firebase.google.com/docs/firestore/manage-data/transactions), [authentification anonyme](https://firebase.google.com/docs/auth/web/anonymous-auth), [API de génération d’images OpenAI](https://developers.openai.com/api/reference/resources/images/methods/generate).
