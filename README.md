# Enigma Shell 🔮

## Projet : L'Agent Souverain Nomade

### 1. Concept Central

L'Agent Souverain Nomade est une **entité IA personnelle et persistante**, dotée de son propre ordinateur virtuel graphique. Il est conçu pour être une extension numérique de son utilisateur, capable d'exécuter des tâches autonomes 24/7. Sa conception garantit une **souveraineté totale des données** et une **indépendance matérielle**, permettant à l'agent de "déménager" d'un ordinateur à un autre sans jamais perdre sa mémoire ou son contexte.

### 2. La Vision

À l'ère des IA centralisées (ChatGPT, Gemini, etc.), ce projet propose une rupture radicale : redonner le contrôle total à l'utilisateur. La vision est de créer un **agent IA qui vous appartient vraiment**, non pas en tant que service, mais en tant que "bien" numérique.

*   **Souveraineté :** Vos données, vos prompts et les opérations de votre agent ne quittent jamais votre sphère de contrôle.
*   **Persistance :** L'agent n'est pas une session qui se termine. Il vit, apprend et évolue en continu.
*   **Portabilité :** L'agent n'est pas prisonnier d'une machine. Son existence est contenue dans un fichier, lui permettant d'être réveillé sur n'importe quel ordinateur autorisé.

### 3. Les Piliers de l'Architecture

Le système est distribué et repose sur cinq piliers conceptuels :

**a) L'Hôte (Le Corps)**
*   **Technologie :** Une application de bureau **Electron**.
*   **Rôle :** C'est l'environnement d'exécution qui donne vie à l'agent. Il fait tourner la VM **v86** et se connecte à **Ollama**.

**b) L'Âme (L'État de Sauvegarde)**
*   **Technologie :** Un fichier binaire (`session.bin`) généré par `emulator.save_state()`.
*   **Rôle :** C'est l'essence numérique de l'agent, contenant sa mémoire et son état. C'est l'agent lui-même, rendu portable.

**c) Le Coffre-Fort (La Mémoire Externe)**
*   **Technologie :** Un service de stockage de fichiers (Cloudflare R2, S3, NAS...).
*   **Rôle :** C'est le lieu de repos sécurisé pour l'Âme de l'agent, permettant sa migration.

**d) La Télécommande (L'Interface de Contrôle)**
*   **Technologie :** Une application web (PWA) utilisant **WebRTC**.
*   **Rôle :** C'est votre fenêtre sur le monde de l'agent, se connectant en P2P à l'Hôte.

**e) La Clé (L'Identité Souveraine)**
*   **Technologie :** Une signature de portefeuille crypto (MetaMask, via Ethers.js).
*   **Rôle :** C'est le système d'authentification unique et sécurisé pour accéder à l'agent.

### 4. Pile Technologique Principale

*   **Hôte :** Electron, Node.js, TypeScript.
*   **Interface :** React, Vite.
*   **Machine Virtuelle :** v86, avec un OS léger (ex: Arch Linux, Tiny Core).
*   **IA Locale :** Ollama (avec un modèle VLM comme LLaVA).
*   **Réseau P2P :** WebRTC.
*   **Authentification :** Ethers.js / Viem.

### 5. État Actuel du Projet

Le prototype d'hôte évolue désormais comme une **console de pilotage complète** autour de v86. À l'ouverture, l'application :

* vérifie automatiquement la présence d'une Âme dans IndexedDB, relance la VM depuis cette sauvegarde et suit chaque étape du boot ;
* propose une expérience guidée quand aucun snapshot n'est trouvé (détection des invites, temporisations de secours, timeline d'état, journal série, suivi des téléchargements) ;
* expose un gestionnaire d'Âme avancé : import local, récupération via URL (coffre externe), capture instantanée via `save_state()`, téléchargement ou purge de la sauvegarde.

Un **playbook d'actions** est livré pour préparer l'intégration VLM : chaque macro décrit une séquence clavier/série/commandes que l'on peut exécuter en un clic ou copier en JSON pour l'agent. Le champ "Objective" reste synchronisé avec l'état de la VM pour éviter tout envoi prématuré.

### 6. Installation & Lancement

1. **Cloner le dépôt**
   ```bash
   git clone https://github.com/<votre-compte>/enigma-os.git
   cd enigma-os
   ```
2. **Préparer les assets v86**
   * Placez `dsl_disk.img` et `dsl-2024.rc7.iso` dans `public/images/` (les chemins par défaut référencés par l'hôte).
   * Les assets v86 (`public/v86/*.bin`, `v86.wasm`) sont déjà inclus.
3. **Installer les dépendances**
   ```bash
   npm install
   ```
4. **Lancer l'application**
   ```bash
   npm run dev
   ```
5. Ouvrez le navigateur sur l'URL fournie (généralement `http://localhost:5173`).

Une fois l'interface chargée, importez une Âme (`.bin`), collez une URL de snapshot distant ou effectuez la première installation manuelle avant de capturer un état persistant.

### 7. Fonctionnalités actuelles de l'hôte

* **Gestionnaire d'Âme complet** : import local, fetch HTTP(s), capture en direct, téléchargement et suppression avec suivi visuel et métadonnées (nom, taille, date, provenance).
* **Supervision du boot** : timeline contextuelle, journaux série, états de téléchargement des assets, overlay de progression et garde-fous automatiques (login root, lancement du GUI).
* **Playbook d'actions pour le VLM** : macros typées (clavier, commandes, délais) exécutables côté hôte ou exportables en JSON pour nourrir la boucle perception→action.
* **Objectifs orchestrés** : le champ d'objectifs ne s'active qu'une fois le bureau opérationnel afin d'éviter les commandes perdues.

### 8. Prochaines Étapes (Roadmap)

1. **Emballeur Electron** : transformer l'interface web en application native (Hôte) avec distribution multi-plateforme.
2. **Coffre-fort distant** : brancher un stockage sécurisé (S3/R2/Mega ou couche blockchain) pour synchroniser les captures `save_state()` signées via MetaMask.
3. **Boucle de contrôle IA** :
   - capturer le framebuffer de la VM ;
   - invoquer un VLM local (LM Studio/Ollama) depuis la VM ;
   - convertir ses décisions en actions (clavier, série, souris) en s'appuyant sur le playbook.

### 9. Licence

Ce projet est distribué sous la licence MIT.

