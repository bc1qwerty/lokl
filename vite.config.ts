import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';

export default defineConfig({
  base: '/',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Lokl — Local Knowledge Base',
        short_name: 'Lokl',
        description: 'Browser-based, offline-first personal knowledge base. Your files never leave your device.',
        theme_color: '#0d1117',
        background_color: '#0d1117',
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  optimizeDeps: {
    include: ['pouchdb-browser'],
  },
  build: {
    target: 'es2022',
    commonjsOptions: {
      include: [/pouchdb/, /node_modules/],
      transformMixedEsModules: true,
    },
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          codemirror: [
            '@codemirror/view',
            '@codemirror/state',
            '@codemirror/commands',
            '@codemirror/language',
            '@codemirror/lang-markdown',
            '@codemirror/autocomplete',
            '@codemirror/theme-one-dark',
          ],
          'codemirror-langs': ['@codemirror/language-data'],
          marked: ['marked'],
          minisearch: ['minisearch'],
        },
      },
    },
  },
});
