# Enigma OS 🔧

## Agent souverain, cockpit contrôlé
Cette version d’Enigma Shell sert d’hôte à l’**Agent Souverain Nomade** : une IA persistante qui s’exécute dans sa propre machine virtuelle v86, capturable et réhydratable à volonté. L’interface « Control Room » fournit une vision synthétique de l’état de l’agent :

- **Navigation latérale minimaliste** : synthèse du boot en cours, statut de l’Âme active, sélection du profil d’OS et actions rapides (import/capture/playbook).
- **Portail VM** : rendu v86, timeline de boot (Idle → Login → Shell → GUI) et console série holographique pour déboguer en direct.
- **Âme Hall** : liste des snapshots (import/capture/rename/export/delete) triés par profil, bascule instantanée et accès aux Âmes « externes ».
- **Matrice d’assets** : suivi des fichiers indispensables (disk/ISO), téléchargement guidé ou import manuel, indicateurs de progression et d’erreurs.
- **Playbook séquentiel** : routines prêtes à l’emploi (relancer Fluxbox, démarrer LM Studio, capture express) avec suivi d’exécution.
- **Checklist manuelle** : rappels succincts pour réussir le premier boot sans snapshot.
- **Objectifs** : champ d’input prêt à recevoir les commandes/intentions qui seront, demain, traduites par le VLM embarqué.

## Flux de travail
1. **Choisir le profil** (`Damn Small Linux 2024` par défaut) — définit les assets attendus, la mémoire, les prompts série et les commandes auto (login + GUI).
2. **Fournir les assets** :
   - Téléchargés via le bouton « Télécharger » (ouvre directement la ressource copy.sh dans un nouvel onglet si le CORS bloque),
   - ou importés depuis votre machine (« Importer ») pour injecter un `.img`/`.iso` local dans la session courante.
3. **Importer ou capturer une Âme** :
   - `Import` (snapshot `.bin`) → réhydratation instantanée,
   - `Capture` / `Capture instantanée` → `save_state()` sur le v86 courant, nouvel instantané daté.
4. **Superviser le boot** : timeline + console série vous indiquent précisément l’étape atteinte. En cas de blocage, la checklist rappelle les commandes à rejouer.
5. **Déployer un playbook** (ex. redémarrer Fluxbox) puis saisir un objectif ; la commande est envoyée dans la VM en attendant l’intégration VLM.

## Installation rapide
```bash
# 1. Cloner et installer les dépendances
npm install

# 2. Lancer l’hôte en mode développement
npm run dev
```
Accédez ensuite à `http://localhost:5173`.

### Assets nécessaires
Les images ne sont pas versionnées. Placez-les dans `public/images/` ou utilisez l’import manuel :
- `dsl_disk.img` (disque persistant)
- `dsl-2024.rc7.iso` (ISO live)

Le manifeste se configure dans [`src/config/agentProfiles.ts`](src/config/agentProfiles.ts). Ajoutez vos propres profils en dupliquant `dsl-2024`, en changeant `id`, `emulator.hda/cdrom`, prompts et commandes.

### Packaging macOS (DMG)
Un raccourci Electron Builder est fourni pour générer un DMG signé localement :
```bash
npm run package:mac
```
Le livrable se trouve dans `dist/`. Adaptez vos paramètres (icône, codesigning) via `electron-builder` si nécessaire.

## Tests
```bash
npm run lint         # ESLint (sources + tests)
npm run test         # tsd + Vitest (MSW + fake-indexeddb)
npm run test:watch   # surveillance continue
npm run test:cov     # couverture Istanbul
npm run e2e          # scénario Playwright (penser à npx playwright install)
```

## Détails d’implémentation
- **Stockage** : snapshots persistés dans IndexedDB via `idb-keyval`. L’UI interagit via `useSnapshotVault` pour gérer concurrence, annulation et progress.
- **Playbook** : `useActionRunner` orchestre les commandes clavier/série, traite la capture (`saveState`) et relaie les messages d’état vers l’UI.
- **Gestion des assets** : import local ou téléchargement tampon (`ArrayBuffer`) directement injecté dans la config v86 (support `buffer` côté `Emulator.tsx`).
- **Audio** : désactivé côté Electron et v86 (`disable-audio-output`, `disable_audio: true`) pour éviter les erreurs sur les hôtes sans carte son.

## Feuille de route
- **Coffre-fort distribué** : synchroniser les Âmes avec un stockage externe chiffré (S3/R2, B2, NAS personnel) + signature MetaMask pour tracer l’identité souveraine.
- **Boucle VLM** : brancher LM Studio/ModelBits dans la VM, capturer le framebuffer, inférer les actions et les rejouer via l’API hôte.
- **Télécommande PWA + WebRTC** : visualiser l’écran, pousser les objectifs et suivre les logs depuis mobile.

Ce travail prépare l’étape suivante : intégrer réellement le modèle visuel et automatiser la boucle d’objectifs. L’interface et le coffre d’Âmes sont désormais prêts à accueillir cette couche VLM.
