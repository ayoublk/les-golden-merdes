# Récupération du backend — 23 octobre 2026

La récupération initiale utilisait le code du commit `576c1e2`. Une publication ultérieure du 23 octobre ajoute les protections pour le direct (réponses vides, variantes après refus, réparation des images manquantes et resynchronisation). Le script de restauration cible désormais cette dernière version, validée sur une partie réelle complète et sur la chaîne de génération sans appel IA payant.

## Diagnostic constaté

- Les sources étaient chargées et les images construites ; le blocage survenait au démarrage Cloud Run, avant l’ouverture du port 8080. Les appels recevaient une page HTML HTTP 500.
- L’image utilisée lors du test réel réussi avait le socle Google `nodejs22_20260929_22_23_2_RC00`. Les images en échec mentionnaient `nodejs22_20261022_22_23_4_RC01`.
- Les services utilisaient les mises à jour automatiques du socle. Une ancienne révision pouvait donc utiliser un socle plus récent : changer seulement le trafic ne rétablissait pas le service.
- Une relance Firebase a été signalée comme réussie alors que le trafic restait épinglé à l’ancienne révision lors de la tentative de retour arrière. Le routage normal a été rétabli.
- Le réassemblage du **code actuel** avec le socle complet Google Node 22.23.2, puis sa publication en image complète, a rétabli les quatre fonctions. Cela désigne le runtime Google ou son assemblage automatique ; ce test ne distingue pas une régression du binaire Node d’une régression du mécanisme d’assemblage.

La base Firestore et l’authentification restaient accessibles. Aucune modification de la logique de jeu n’a été nécessaire pour ce rétablissement. Les permissions IAM et les références Secret Manager sont conservées.

## Récupération manuelle de la version validée

Depuis le dossier du projet, avec Firebase CLI installé sous Windows et déjà connecté :

```powershell
node scripts/restore-stable-backend.mjs
```

Cette commande inspecte les services sans les modifier. Pour restaurer les images exactes validées le 23 octobre :

```powershell
node scripts/restore-stable-backend.mjs --apply
```

Ce script **restaure une version connue**, il ne publie pas les modifications du dossier de travail. Il préserve la configuration des services, leurs comptes de service et leurs secrets, et conserve la signature CloudEvent du déclencheur Firestore. Il ne fait aucun appel de génération IA. Les images doivent encore être présentes dans Artifact Registry.

## Prochains déploiements de code

Le runtime de cette récupération est temporairement figé : les correctifs du socle nécessitent désormais une reconstruction volontaire. Un déploiement Firebase classique peut réactiver le socle automatique récent. Avant de reprendre ce flux, valider le runtime cible et les appels réels, pas seulement le statut du déploiement. La récupération ci-dessus remet la version validée si nécessaire.

Pour conserver un nouveau code tout en réparant le socle, reconstruire une image complète à partir de la nouvelle image applicative Firebase et d’un socle Google validé, selon la [procédure officielle de réassemblage](https://docs.cloud.google.com/run/docs/configuring/services/automatic-base-image-updates#reassemble_container_images_to_run_locally). La source d’image applicative est conservée dans `service.buildConfig.imageUri`. Le socle utilisé pour cette récupération est :

```text
europe-west1-docker.pkg.dev/serverless-runtimes/google-22-full/runtimes/nodejs22@sha256:d6db8febb674b3d0c8145776643b3a178337814e67905350348ddb735b8cb08e
```

Les trois fonctions de génération partagent le même paquet source. Leur image complète est commune, avec une variable `FUNCTION_TARGET` propre à chaque service et `FUNCTION_SIGNATURE_TYPE=cloudevent` pour `generateFilm`, `http` pour les autres. Cela ne change pas leurs déclencheurs ni leur politique d’accès.

## Vérifications après récupération

- Les quatre services ont atteint l’état `Ready` et le trafic vise les révisions de récupération.
- L’API répond HTTP 401 JSON à un appel sans authentification, au lieu d’une erreur 500 HTML.
- Création réelle d’un salon depuis le site publié, puis arrêt de ce salon de test vide : réussis.
- `node scripts/test-skip-missing-live.mjs` : commande réservée à l’animateur, départ forcé sans tous les questionnaires, spectateurs autorisés à lire le salon, envoi tardif et votes des absents refusés, votes des participants préservés : réussis.
- `node scripts/test-queue-live.mjs` : Firestore → Cloud Tasks → worker privé → garde d’arrêt : réussi.
- Aucun appel IA payant lors de ces vérifications. Les comptes et documents temporaires des scripts ont été nettoyés.


## Publication des protections pour le direct

`node scripts/deploy-stable-backend.mjs --apply` conserve les images complètes du runtime validé et remplace uniquement les modules applicatifs, sans nouvelle installation de dépendances. Les nouvelles images ont été construites avec Cloud Build `0a22c9ae-9629-4cfc-a608-b626c2de1c15` ; les quatre services ont atteint `Ready`. Une partie complète (`scripts/test-failsafe-live.mjs`) et le contrôle de file (`scripts/test-queue-live.mjs`) ont réussi sans génération IA payante. Les digests de cette version sont enregistrés dans `scripts/restore-stable-backend.mjs` : ce secours préserve maintenant les nouvelles fonctions.

Le mode `--resume=artifacts/releases/<identifiant>.json --apply` du script de publication reprend la surveillance d'une construction déjà demandée. Le fichier est local et ignoré par Git. Ne pas relancer une construction pour une simple interruption de la surveillance.
