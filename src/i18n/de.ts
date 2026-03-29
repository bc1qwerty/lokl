import type { Locale } from './en';

const de: Locale = {
  app: { name: 'Lokl', tagline: 'Deine lokale Wissensdatenbank' },
  welcome: {
    title: 'Willkommen bei Lokl',
    subtitle: 'Eine browserbasierte Wissensdatenbank, die mit deinen lokalen Dateien arbeitet.',
    openButton: 'Ordner öffnen',
    reopenButton: 'Erneut öffnen',
    dragHint: 'oder ziehe einen Ordner hierher',
    privacyNote: 'Deine Dateien verlassen niemals dein Gerät. Nichts wird hochgeladen.',
    features: { offline: 'Funktioniert offline', wikilinks: '[[Wiki-Links]] & Rückverweise', search: 'Sofortige Volltextsuche', privacy: '100% privat — kein Server' },
    unsupported: 'Dein Browser hat eingeschränkte Unterstützung. Verwende Chrome oder Edge für das beste Erlebnis.',
  },
  sidebar: { openFolder: 'Ordner öffnen', newFile: 'Neue Datei', search: 'Suchen…', noFiles: 'Keine Markdown-Dateien gefunden', files: 'Dateien', sortName: 'Nach Name sortieren', sortModified: 'Nach Datum sortieren' },
  tabs: { close: 'Tab schließen', closeOthers: 'Andere schließen', closeAll: 'Alle schließen' },
  editor: { unsaved: 'Nicht gespeichert', saving: 'Speichern…', saved: 'Gespeichert', readOnly: 'Nur lesen' },
  preview: { empty: 'Keine Vorschau verfügbar' },
  search: { placeholder: 'Notizen suchen…', shortcut: '⌘K', noResults: 'Keine Ergebnisse', hint: 'Dateinamen und Inhalte durchsuchen' },
  quickOpen: { placeholder: 'Datei öffnen…', noResults: 'Keine Dateien gefunden' },
  backlinks: { title: 'Rückverweise', none: 'Keine Rückverweise', linkedFrom: 'Verlinkt von' },
  toolbar: { toggleSidebar: 'Seitenleiste umschalten', togglePreview: 'Vorschau umschalten', toggleBacklinks: 'Rückverweise umschalten', toggleGraph: 'Graphansicht', themeLight: 'Zum hellen Modus wechseln', themeDark: 'Zum dunklen Modus wechseln', settings: 'Einstellungen', dailyNote: 'Tagesnotiz', viewEdit: 'Bearbeiten', viewSplit: 'Teilen', viewPreview: 'Vorschau' },
  graph: { title: 'Graphansicht', noData: 'Keine Verbindungen gefunden', close: 'Schließen' },
  tags: { title: 'Tags', none: 'Keine Tags', clearFilter: 'Filter löschen' },
  contextMenu: { rename: 'Umbenennen', delete: 'Löschen', duplicateFile: 'Duplizieren', copyPath: 'Pfad kopieren', newFileHere: 'Neue Datei hier' },
  settings: { title: 'Einstellungen', fontSize: 'Schriftgröße', sortBy: 'Dateien sortieren', sortName: 'Name', sortModified: 'Geändert', lineNumbers: 'Zeilennummern', language: 'Sprache', close: 'Schließen' },
  dailyNote: { created: 'Tagesnotiz erstellt' },
  common: { cancel: 'Abbrechen', confirm: 'Bestätigen', close: 'Schließen', delete: 'Löschen', rename: 'Umbenennen', create: 'Erstellen' },
};

export default de;
