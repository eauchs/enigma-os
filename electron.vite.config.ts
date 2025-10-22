import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path' // <- CET IMPORT EST ESSENTIEL

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: 'electron/main.ts'
      }
    }
  },
  preload: {
    build: {
      lib: {
        entry: 'electron/preload.ts'
      }
    }
  },
  renderer: {
    // 1. On dit que la racine est le dossier du projet
    root: '.', 

    // 2. On dit où est le dossier public (pour v86.js)
    publicDir: 'public',

    // 3. On dit où est le fichier HTML (pour corriger l'erreur du terminal)
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'index.html') 
      }
    },

    plugins: [react()]
  }
})