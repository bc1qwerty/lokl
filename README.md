# Lokl

**Browser-based, offline-first personal knowledge base.**

Your files never leave your device. No server, no account, no sync fees.

## Features

- **Local Files** — Open any folder of markdown files directly from your browser
- **Markdown Editor** — CodeMirror 6 with syntax highlighting and live preview
- **[[Wiki-links]]** — Link between notes with `[[note-name]]` syntax
- **Backlinks** — See every note that links to the current one
- **Full-text Search** — Instant fuzzy search across all your notes (Cmd+K)
- **Quick Open** — Jump to any file instantly (Cmd+P)
- **Tags** — `#tag` extraction from content and YAML frontmatter
- **Graph View** — Visualize connections between your notes
- **Daily Notes** — One-click daily journal entry
- **Tabs** — Work with multiple files simultaneously
- **Dark / Light Theme** — Automatic or manual toggle
- **PWA** — Install as a desktop app, works offline
- **i18n** — English, Korean, Japanese

## How It Works

Lokl uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) to read and write files directly on your device. No data is ever uploaded to any server.

| | Obsidian | Notion | **Lokl** |
|---|---|---|---|
| Install required | Yes (Electron) | No | **No (browser)** |
| Works offline | Yes | Limited | **Yes (PWA)** |
| File ownership | Local | Cloud | **Local** |
| Sync | $8/mo | Built-in | **Your choice** |
| Wiki-links | Yes | No | **Yes** |
| Open source | No | No | **Yes** |

## Quick Start

**Try it now:** [https://bc1qwerty.github.io/lokl/](https://bc1qwerty.github.io/lokl/)

Or run locally:

```bash
git clone https://github.com/bc1qwerty/lokl.git
cd lokl
npm install
npm run dev
```

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + K` | Search notes |
| `Cmd/Ctrl + P` | Quick open file |
| `Cmd/Ctrl + N` | New file |
| `Cmd/Ctrl + S` | Save |
| `Cmd/Ctrl + \` | Toggle sidebar |
| `Cmd/Ctrl + =/-` | Increase/decrease font size |
| `Esc` | Close dialog |

## Browser Support

| Browser | Support |
|---|---|
| Chrome / Edge / Arc / Brave | Full (read + write) |
| Firefox / Safari | Read-only (file import) |

The File System Access API is required for full read/write support. Firefox and Safari fall back to a read-only file import mode.

## Tech Stack

- [Preact](https://preactjs.com/) + [Preact Signals](https://preactjs.com/guide/v10/signals/)
- [Vite](https://vite.dev/)
- [CodeMirror 6](https://codemirror.net/)
- [MiniSearch](https://lucaong.github.io/minisearch/)
- [marked](https://marked.js.org/)

## License

MIT
