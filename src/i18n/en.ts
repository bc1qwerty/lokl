export const en = {
  app: {
    name: 'Lokl',
    tagline: 'Your local knowledge base',
  },
  welcome: {
    title: 'Welcome to Lokl',
    subtitle: 'A browser-based knowledge base that works with your local files.',
    openButton: 'Open Folder',
    reopenButton: 'Reopen',
    dragHint: 'or drag a folder here',
    privacyNote: 'Your files never leave your device. Nothing is uploaded.',
    features: {
      offline: 'Works offline',
      wikilinks: '[[Wiki-links]] & backlinks',
      search: 'Instant full-text search',
      privacy: '100% private — no server',
    },
    unsupported: 'Your browser has limited support. Use Chrome or Edge for the best experience.',
  },
  sidebar: {
    openFolder: 'Open folder',
    newFile: 'New file',
    search: 'Search…',
    noFiles: 'No markdown files found',
    files: 'Files',
  },
  editor: {
    unsaved: 'Unsaved',
    saving: 'Saving…',
    saved: 'Saved',
    readOnly: 'Read-only',
  },
  preview: {
    empty: 'Nothing to preview',
  },
  search: {
    placeholder: 'Search notes…',
    shortcut: '⌘K',
    noResults: 'No results found',
    hint: 'Type to search file names and content',
  },
  backlinks: {
    title: 'Backlinks',
    none: 'No backlinks',
    linkedFrom: 'Linked from',
  },
  toolbar: {
    toggleSidebar: 'Toggle sidebar',
    togglePreview: 'Toggle preview',
    toggleBacklinks: 'Toggle backlinks',
    themeLight: 'Switch to light mode',
    themeDark: 'Switch to dark mode',
    viewEdit: 'Edit',
    viewSplit: 'Split',
    viewPreview: 'Preview',
  },
  common: {
    cancel: 'Cancel',
    confirm: 'Confirm',
    close: 'Close',
    delete: 'Delete',
    rename: 'Rename',
  },
} as const;

export type Locale = typeof en;
