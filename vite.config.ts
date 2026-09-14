import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';

// Published to lokl.txid.uk, served from the domain root. The gh-pages mirror
// was retired 2026-09-05 (deploy.yml now pushes only a redirect stub) because
// that origin is outside api.txid.uk's CORS allowlist. VITE_BASE stays only in
// case a subpath deployment is ever revived — which would need the api CORS
// change first (see CLAUDE.md).
const base = process.env.VITE_BASE || '/';

export default defineConfig({
  base,
  plugins: [
    preact(),
    VitePWA({
      // 'prompt' so main.tsx's onNeedRefresh confirm actually runs — autoUpdate
      // reloaded unconditionally on SW activation, discarding unsaved edits.
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Lokl — Local Knowledge Base',
        short_name: 'Lokl',
        description: 'Browser-based, offline-first personal knowledge base. Your files never leave your device.',
        theme_color: '#0d1117',
        background_color: '#0d1117',
        display: 'standalone',
        // Absolute icon paths point outside the app when it is served from a
        // subpath, so they follow the base too.
        icons: [
          { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png' },
          { src: `${base}icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // og-image.png is for social crawlers only — keep it out of the SW precache
        globIgnores: ['og-image.png'],
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
