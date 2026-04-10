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
- GitHub Pages via `gh-pages` package

## Status
- Development complete
