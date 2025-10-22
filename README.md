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

Le projet est actuellement au stade de **preuve de concept de l'Hôte**. Il s'agit d'une application web (non encore packagée avec Electron) qui charge et exécute une machine virtuelle graphique **v86** à partir d'un fichier d'état sauvegardé (`arch_state-v3.bin.zst`).

### 6. Installation & Lancement

1.  **Clone the repository:**
    ```bash
    cd enigma-shell
    ```
2.  **Placez le fichier d'état de la VM :**
    Assurez-vous que le fichier `arch_state-v3.bin.zst` est présent dans le dossier `public/images/`.
3.  **Install dependencies:**
    ```bash
    npm install
    ```
4.  **Run the application:**
    ```bash
    npm run dev
    ```
5.  Open your browser to the provided address (usually `http://localhost:5173`).

### 7. Prochaines Étapes (Roadmap)

1.  **Intégration d'Electron :** Transformer l'application web en une application de bureau (L'Hôte).
2.  **Boucle de Contrôle IA :**
    -   Capturer l'écran de la VM.
    -   Envoyer l'image et un objectif à un VLM (Ollama/LLaVA).
    -   Recevoir et exécuter les commandes de souris/clavier.
3.  **Persistance de l'État :** Implémenter la sauvegarde (`emulator.save_state()`) et la synchronisation avec le Coffre-Fort.

### 8. Licence

Ce projet est distribué sous la licence MIT.

