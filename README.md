# Enigma Shell 🔮

## Agent souverain, expérience raffinée
Enigma Shell donne vie à l'« Agent Souverain Nomade » : une IA persistante encapsulée dans sa propre machine virtuelle v86. La nouvelle interface web orchestre l'intégralité du cycle de boot et de sauvegarde pour offrir une expérience premium dès l'ouverture :

- **Profils d'OS dynamiques** – sélectionne la distribution à charger (par défaut Damn Small Linux 2024) et expose le manifeste d'assets attendu pour préparer rapidement d'autres systèmes.
- **Coffre d'Âmes avancé** – import, capture, renommage, export et suppression de plusieurs snapshots stockés dans IndexedDB, avec sélection rapide et tri automatique par profil.
- **Capture instantanée** – un clic « Capture from VM » déclenche `save_state()` côté hôte, sauvegarde l'Âme et relance la VM sur le nouvel état.
- **Indicateurs de boot riches** – timeline interactive, journal série en direct et statut de téléchargement des assets v86 pour diagnostiquer immédiatement tout blocage.
- **Guidage manuel clair** – checklist pas-à-pas, rappels des commandes (`root`, `cd /root && ./startx.sh`) et badges d’état pour réussir le premier boot sans snapshot.

L’objectif reste de livrer un agent autonome capable d’exécuter une boucle perception‑action pilotée par un VLM (LM Studio/Ollama) directement dans la VM, tout en garantissant la souveraineté des données.

## Architecture (rappel)
1. **Hôte — corps** : application React/Vite (future application Electron) qui exécute v86 et orchestre les entrées.
2. **Âme — état** : snapshots binaires `save_state()` qui capturent mémoire + disque.
3. **Coffre-fort — persistance** : aujourd’hui IndexedDB, demain stockage distant (S3/R2, Mega, solution blockchain) signé avec l’identité de l’utilisateur.
4. **Télécommande — interface** : l’UI web expose statut, console et formulaire d’objectifs (future PWA/WebRTC).
5. **Clé — identité** : intégration MetaMask prévue pour signer les accès et lier chaque Âme à une identité souveraine.

## Installation & lancement
1. **Cloner & installer**
   ```bash
   git clone <repo>
   cd enigma-os
   npm install
   ```
2. **Fournir les assets v86** (non versionnés pour des raisons de taille) :
   - `public/images/dsl_disk.img`
   - `public/images/dsl-2024.rc7.iso`

   Ces chemins sont configurables dans `src/config/agentProfiles.ts` si vous préparez une autre distribution.
3. **Démarrer en développement**
   ```bash
   npm run dev
   ```
   Ouvrez `http://localhost:5173` pour accéder à l’hôte.
4. **Build de production**
   ```bash
   npm run build
   ```

## Tests

L’outillage de test couvre les types, les hooks/services, l’intégration de l’hôte et un parcours E2E Playwright.

```bash
# assertions de types + Vitest en mode run
npm run test

# surveillance continue
npm run test:watch

# rapport de couverture (seuil 85 %)
npm run test:cov

# lint complet des sources et des tests
npm run lint

# scénario Playwright avec serveur preview
npm run e2e
```

Avant votre toute première exécution E2E, installez le navigateur et ses dépendances système :

```bash
npx playwright install --with-deps chromium
```

Vitest initialise automatiquement MSW (`src/setupTests.ts`) et polyfill IndexedDB via `fake-indexeddb`, ce qui permet de rejouer toutes les interactions du coffre d’Âmes sans navigateur réel.

## Utiliser le coffre d’Âmes
- **Import** : bouton « Import Âme » (snapshots `.bin` non compressés) → stockage dans IndexedDB → relance automatique.
- **Capture** : une fois votre VM configurée, cliquez sur « Capture from VM » pour figer l’état courant. Un nouveau snapshot daté est ajouté au coffre et utilisé immédiatement.
- **Renommer / Exporter / Supprimer** : actions disponibles pour chaque entrée. Les snapshots sont triés du plus récent au plus ancien et associés au profil ayant servi à la capture.
- **Sélection multi-profils** : si vous changez d’OS, seules les Âmes compatibles sont proposées en priorité, tout en gardant accès aux autres pour des tests ponctuels.

Tous les snapshots restent locaux tant qu’une intégration avec un stockage distant n’est pas configurée. Cela prépare l’étape « Coffre-fort distribué » du projet (upload chiffré + signature MetaMask).

## Adapter l’OS chargé
Le fichier [`src/config/agentProfiles.ts`](src/config/agentProfiles.ts) décrit les profils disponibles :
- chemins des disques (HDA/CDROM), taille mémoire, boot order,
- prompts à détecter sur la console série, commandes automatiques (login, lancement du GUI),
- libellés UI (timeline, checklist, manifeste d’assets).

Pour ajouter une nouvelle distribution :
1. Dupliquer le profil `dsl-2024` en lui attribuant un `id` unique.
2. Ajuster les URLs d’assets (`/images/…`), la mémoire, les commandes (`loginPrompts`, `guiCommand`, etc.).
3. Placer les fichiers correspondants dans `public/images/` (ou servez-les depuis un CDN interne).
4. Redémarrez l’application et sélectionnez le nouveau profil dans le sélecteur.

## Prochaines étapes
- **Stockage distant** : synchroniser le coffre local avec un fournisseur chiffré (S3/R2, Mega) ou une solution décentralisée, signé via MetaMask.
- **Boucle VLM** : intégrer LM Studio dans la VM, capturer le framebuffer, générer les actions clavier/souris depuis un modèle visuel et rejouer ces actions via l’API exposée (`runCommand`, `runSerialCommand`, `runKeyboardCommand`).
- **Electron** : empaqueter l’hôte pour offrir un runtime portable, connecté à la future télécommande PWA.

## Licence
Projet distribué sous licence MIT.
