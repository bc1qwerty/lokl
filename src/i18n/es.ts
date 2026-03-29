import type { Locale } from './en';

const es: Locale = {
  app: { name: 'Lokl', tagline: 'Tu base de conocimiento local' },
  welcome: {
    title: 'Bienvenido a Lokl',
    subtitle: 'Una base de conocimiento en el navegador que trabaja con tus archivos locales.',
    openButton: 'Abrir carpeta',
    reopenButton: 'Reabrir',
    dragHint: 'o arrastra una carpeta aquí',
    privacyNote: 'Tus archivos nunca salen de tu dispositivo. No se sube nada.',
    features: { offline: 'Funciona sin conexión', wikilinks: '[[Wiki-links]] y backlinks', search: 'Búsqueda instantánea', privacy: '100% privado — sin servidor' },
    unsupported: 'Tu navegador tiene soporte limitado. Usa Chrome o Edge para la mejor experiencia.',
  },
  sidebar: { openFolder: 'Abrir carpeta', newFile: 'Nuevo archivo', search: 'Buscar…', noFiles: 'No se encontraron archivos Markdown', files: 'Archivos', sortName: 'Ordenar por nombre', sortModified: 'Ordenar por fecha' },
  tabs: { close: 'Cerrar pestaña', closeOthers: 'Cerrar otras', closeAll: 'Cerrar todas' },
  editor: { unsaved: 'Sin guardar', saving: 'Guardando…', saved: 'Guardado', readOnly: 'Solo lectura' },
  preview: { empty: 'Nada que previsualizar' },
  search: { placeholder: 'Buscar notas…', shortcut: '⌘K', noResults: 'Sin resultados', hint: 'Buscar por nombre y contenido' },
  quickOpen: { placeholder: 'Ir al archivo…', noResults: 'No se encontraron archivos' },
  backlinks: { title: 'Backlinks', none: 'Sin backlinks', linkedFrom: 'Enlazado desde' },
  toolbar: { toggleSidebar: 'Alternar barra lateral', togglePreview: 'Alternar vista previa', toggleBacklinks: 'Alternar backlinks', toggleGraph: 'Vista de grafo', themeLight: 'Cambiar a modo claro', themeDark: 'Cambiar a modo oscuro', settings: 'Ajustes', dailyNote: 'Nota diaria', viewEdit: 'Editar', viewSplit: 'Dividir', viewPreview: 'Vista previa' },
  graph: { title: 'Vista de Grafo', noData: 'No se encontraron conexiones', close: 'Cerrar' },
  tags: { title: 'Etiquetas', none: 'Sin etiquetas', clearFilter: 'Limpiar filtro' },
  contextMenu: { rename: 'Renombrar', delete: 'Eliminar', duplicateFile: 'Duplicar', copyPath: 'Copiar ruta', newFileHere: 'Nuevo archivo aquí' },
  settings: { title: 'Ajustes', fontSize: 'Tamaño de fuente', sortBy: 'Ordenar archivos', sortName: 'Nombre', sortModified: 'Modificado', lineNumbers: 'Números de línea', language: 'Idioma', close: 'Cerrar' },
  dailyNote: { created: 'Nota diaria creada' },
  common: { cancel: 'Cancelar', confirm: 'Confirmar', close: 'Cerrar', delete: 'Eliminar', rename: 'Renombrar', create: 'Crear' },
};

export default es;
