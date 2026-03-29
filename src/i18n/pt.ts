import type { Locale } from './en';

const pt: Locale = {
  app: { name: 'Lokl', tagline: 'Sua base de conhecimento local' },
  welcome: {
    title: 'Bem-vindo ao Lokl',
    subtitle: 'Uma base de conhecimento no navegador que trabalha com seus arquivos locais.',
    openButton: 'Abrir pasta',
    reopenButton: 'Reabrir',
    dragHint: 'ou arraste uma pasta aqui',
    privacyNote: 'Seus arquivos nunca saem do seu dispositivo. Nada é enviado.',
    features: { offline: 'Funciona offline', wikilinks: '[[Wiki-links]] e backlinks', search: 'Busca instantânea', privacy: '100% privado — sem servidor' },
    unsupported: 'Seu navegador tem suporte limitado. Use Chrome ou Edge para a melhor experiência.',
  },
  sidebar: { openFolder: 'Abrir pasta', newFile: 'Novo arquivo', search: 'Buscar…', noFiles: 'Nenhum arquivo Markdown encontrado', files: 'Arquivos', sortName: 'Ordenar por nome', sortModified: 'Ordenar por data' },
  tabs: { close: 'Fechar aba', closeOthers: 'Fechar outras', closeAll: 'Fechar todas' },
  editor: { unsaved: 'Não salvo', saving: 'Salvando…', saved: 'Salvo', readOnly: 'Somente leitura' },
  preview: { empty: 'Nada para visualizar' },
  search: { placeholder: 'Buscar notas…', shortcut: '⌘K', noResults: 'Nenhum resultado', hint: 'Buscar por nome e conteúdo' },
  quickOpen: { placeholder: 'Ir para arquivo…', noResults: 'Nenhum arquivo encontrado' },
  backlinks: { title: 'Backlinks', none: 'Sem backlinks', linkedFrom: 'Linkado de' },
  toolbar: { toggleSidebar: 'Alternar barra lateral', togglePreview: 'Alternar visualização', toggleBacklinks: 'Alternar backlinks', toggleGraph: 'Visão de grafo', themeLight: 'Mudar para modo claro', themeDark: 'Mudar para modo escuro', settings: 'Configurações', dailyNote: 'Nota diária', viewEdit: 'Editar', viewSplit: 'Dividir', viewPreview: 'Visualizar' },
  graph: { title: 'Visão de Grafo', noData: 'Nenhuma conexão encontrada', close: 'Fechar' },
  tags: { title: 'Tags', none: 'Sem tags', clearFilter: 'Limpar filtro' },
  contextMenu: { rename: 'Renomear', delete: 'Excluir', duplicateFile: 'Duplicar', copyPath: 'Copiar caminho', newFileHere: 'Novo arquivo aqui' },
  settings: { title: 'Configurações', fontSize: 'Tamanho da fonte', sortBy: 'Ordenar arquivos', sortName: 'Nome', sortModified: 'Modificado', lineNumbers: 'Números de linha', language: 'Idioma', close: 'Fechar' },
  dailyNote: { created: 'Nota diária criada' },
  common: { cancel: 'Cancelar', confirm: 'Confirmar', close: 'Fechar', delete: 'Excluir', rename: 'Renomear', create: 'Criar' },
};

export default pt;
