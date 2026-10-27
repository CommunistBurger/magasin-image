import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  // Dossier source = racine du projet (index.html est à la racine)
  root: '.',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
})
