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
    sortName: 'Sort by name',
    sortModified: 'Sort by modified',
  },
  tabs: {
    close: 'Close tab',
    closeOthers: 'Close others',
    closeAll: 'Close all',
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
  quickOpen: {
    placeholder: 'Go to file…',
    noResults: 'No files found',
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
    toggleGraph: 'Graph view',
    themeLight: 'Switch to light mode',
    themeDark: 'Switch to dark mode',
    settings: 'Settings',
    dailyNote: 'Daily note',
    viewEdit: 'Edit',
    viewSplit: 'Split',
    viewPreview: 'Preview',
  },
  graph: {
    title: 'Graph View',
    noData: 'No connections found',
    close: 'Close',
  },
  tags: {
    title: 'Tags',
    none: 'No tags found',
    clearFilter: 'Clear filter',
  },
  contextMenu: {
    rename: 'Rename',
    delete: 'Delete',
    duplicateFile: 'Duplicate',
    copyPath: 'Copy path',
    newFileHere: 'New file here',
  },
  settings: {
    title: 'Settings',
    fontSize: 'Font size',
    sortBy: 'Sort files by',
    sortName: 'Name',
    sortModified: 'Modified',
    lineNumbers: 'Line numbers',
    language: 'Language',
    close: 'Close',
  },
  dailyNote: {
    created: 'Daily note created',
  },
  common: {
    cancel: 'Cancel',
    confirm: 'Confirm',
    close: 'Close',
    delete: 'Delete',
    rename: 'Rename',
    create: 'Create',
  },
} as const;

type DeepString<T> = { [K in keyof T]: T[K] extends string ? string : DeepString<T[K]> };
export type Locale = DeepString<typeof en>;
