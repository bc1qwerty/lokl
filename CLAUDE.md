# Lokl

## Language
- Respond in Korean (한국어로 응답)

## Description
Browser-based, offline-first personal knowledge base. PWA with full-text search, Markdown editing via CodeMirror 6, and PouchDB for local storage.

## Tech Stack
- **UI**: Preact 10, @preact/signals
- **Editor**: CodeMirror 6 (Markdown mode, autocomplete, one-dark theme)
- **Storage**: PouchDB (IndexedDB-backed, offline-first)
- **Search**: MiniSearch (full-text search)
- **Rendering**: Marked (Markdown to HTML), DOMPurify (sanitization)
- **Build**: Vite 6, TypeScript 5, vite-plugin-pwa (Workbox)
- **Node**: >=22.0.0

## Key Files
- `src/app.tsx` -- Main application entry
- `src/components/` -- UI components
- `src/i18n/` -- Internationalization
- `src/lib/` -- Core logic (PouchDB, search, etc.)
- `src/styles/` -- Stylesheets
- `src/types/` -- TypeScript type definitions
- `index.html` -- SPA entry point

## Build & Run
```bash
npm run dev       # Vite dev server
npm run build     # Type-check + production build
npm run preview   # Preview production build
npm run deploy    # Build + deploy to GitHub Pages
```

## Deployment
- **정본 = lokl.txid.uk** (VPS `/home/ubuntu/lokl.txid.uk`, Caddy 정적 서빙).
  배포는 GHA `deploy.yml`(tags `v*` 또는 workflow_dispatch)이 dist 를 rsync.
- ⚠ **GitHub Pages 미러(bc1qwerty.github.io/lokl)는 2026-09-05 은퇴.** 그 origin
  이 api.txid.uk CORS 밖이라 라이트닝 로그인·동기화가 CORS 로 차단됐다. 이제
  gh-pages 브랜치엔 lokl.txid.uk 로 가는 리다이렉트 스텁만 있다. 미러에 앱을
  되살리려면 그 전에 api CORS 에 `https://bc1qwerty.github.io` 를 추가해야 한다.

## Status
- Development complete
