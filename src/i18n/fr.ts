import type { Locale } from './en';

const fr: Locale = {
  app: { name: 'Lokl', tagline: 'Votre base de connaissances locale' },
  welcome: {
    title: 'Bienvenue sur Lokl',
    subtitle: 'Une base de connaissances dans le navigateur qui fonctionne avec vos fichiers locaux.',
    openButton: 'Ouvrir un dossier',
    reopenButton: 'Rouvrir',
    dragHint: 'ou glissez un dossier ici',
    privacyNote: 'Vos fichiers ne quittent jamais votre appareil. Rien n\'est téléchargé.',
    features: { offline: 'Fonctionne hors ligne', wikilinks: '[[Wiki-liens]] et rétroliens', search: 'Recherche instantanée', privacy: '100% privé — aucun serveur' },
    unsupported: 'Votre navigateur a un support limité. Utilisez Chrome ou Edge pour une meilleure expérience.',
  },
  sidebar: { openFolder: 'Ouvrir un dossier', newFile: 'Nouveau fichier', search: 'Rechercher…', noFiles: 'Aucun fichier Markdown trouvé', files: 'Fichiers', sortName: 'Trier par nom', sortModified: 'Trier par date' },
  tabs: { close: 'Fermer l\'onglet', closeOthers: 'Fermer les autres', closeAll: 'Tout fermer' },
  editor: { unsaved: 'Non enregistré', saving: 'Enregistrement…', saved: 'Enregistré', readOnly: 'Lecture seule' },
  preview: { empty: 'Rien à prévisualiser' },
  search: { placeholder: 'Rechercher des notes…', shortcut: '⌘K', noResults: 'Aucun résultat', hint: 'Rechercher par nom et contenu' },
  quickOpen: { placeholder: 'Aller au fichier…', noResults: 'Aucun fichier trouvé' },
  backlinks: { title: 'Rétroliens', none: 'Aucun rétrolien', linkedFrom: 'Lié depuis' },
  toolbar: { toggleSidebar: 'Basculer la barre latérale', togglePreview: 'Basculer l\'aperçu', toggleBacklinks: 'Basculer les rétroliens', toggleGraph: 'Vue graphe', themeLight: 'Passer au mode clair', themeDark: 'Passer au mode sombre', settings: 'Paramètres', dailyNote: 'Note du jour', viewEdit: 'Éditer', viewSplit: 'Diviser', viewPreview: 'Aperçu' },
  graph: { title: 'Vue Graphe', noData: 'Aucune connexion trouvée', close: 'Fermer' },
  tags: { title: 'Tags', none: 'Aucun tag', clearFilter: 'Effacer le filtre' },
  contextMenu: { rename: 'Renommer', delete: 'Supprimer', duplicateFile: 'Dupliquer', copyPath: 'Copier le chemin', newFileHere: 'Nouveau fichier ici' },
  settings: { title: 'Paramètres', fontSize: 'Taille de police', sortBy: 'Trier les fichiers', sortName: 'Nom', sortModified: 'Modifié', lineNumbers: 'Numéros de ligne', language: 'Langue', close: 'Fermer' },
  dailyNote: { created: 'Note du jour créée' },
  common: { cancel: 'Annuler', confirm: 'Confirmer', close: 'Fermer', delete: 'Supprimer', rename: 'Renommer', create: 'Créer' },
};

export default fr;
