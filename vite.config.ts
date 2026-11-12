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
        description: 'Browser-based, offline-first personal knowledge base. Your files stay on your device unless you turn on sync.',
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
        // 함수 형태로 node_modules 경로만 본다. 객체 형태일 때는 Vite 의 preload 헬퍼가 codemirror-langs
        // 묶음에 들어가, 메인이 그 묶음(→ codemirror)을 정적으로 끌어와 편집기를 지연 로딩해도 첫 화면이
        // CodeMirror ~500KB 를 modulepreload 했다(2026-11-12).
        manualChunks(id) {
          // preload 헬퍼는 메인·편집기·언어 묶음이 함께 쓴다 — 따로 두지 않으면 codemirror-langs 에 들어간다.
          if (id.includes('vite/preload-helper')) return 'preload-helper';
          if (!id.includes('/node_modules/')) return undefined;
          if (id.includes('/@codemirror/language-data/')) return 'codemirror-langs';
          if (id.includes('/@codemirror/') || id.includes('/@lezer/') || id.includes('/crelt/') || id.includes('/style-mod/') || id.includes('/w3c-keyname/')) return 'codemirror';
          if (id.includes('/marked/')) return 'marked';
          if (id.includes('/minisearch/')) return 'minisearch';
          return undefined;
        },
      },
    },
  },
});
