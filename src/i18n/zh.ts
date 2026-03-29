import type { Locale } from './en';

const zh: Locale = {
  app: { name: 'Lokl', tagline: '你的本地知识库' },
  welcome: {
    title: '欢迎使用 Lokl',
    subtitle: '基于浏览器的知识库，直接使用本地文件。',
    openButton: '打开文件夹',
    reopenButton: '重新打开',
    dragHint: '或将文件夹拖放到此处',
    privacyNote: '文件永远不会离开你的设备。不会上传任何内容。',
    features: { offline: '离线可用', wikilinks: '[[维基链接]] 和反向链接', search: '即时全文搜索', privacy: '100% 隐私 — 无需服务器' },
    unsupported: '你的浏览器支持有限。请使用 Chrome 或 Edge 获得最佳体验。',
  },
  sidebar: { openFolder: '打开文件夹', newFile: '新建文件', search: '搜索…', noFiles: '未找到 Markdown 文件', files: '文件', sortName: '按名称排序', sortModified: '按修改时间排序' },
  tabs: { close: '关闭标签页', closeOthers: '关闭其他', closeAll: '关闭全部' },
  editor: { unsaved: '未保存', saving: '保存中…', saved: '已保存', readOnly: '只读' },
  preview: { empty: '无内容可预览' },
  search: { placeholder: '搜索笔记…', shortcut: '⌘K', noResults: '未找到结果', hint: '搜索文件名和内容' },
  quickOpen: { placeholder: '转到文件…', noResults: '未找到文件' },
  backlinks: { title: '反向链接', none: '无反向链接', linkedFrom: '链接自' },
  toolbar: { toggleSidebar: '切换侧边栏', togglePreview: '切换预览', toggleBacklinks: '切换反向链接', toggleGraph: '图谱视图', themeLight: '切换到浅色模式', themeDark: '切换到深色模式', settings: '设置', dailyNote: '每日笔记', viewEdit: '编辑', viewSplit: '分屏', viewPreview: '预览' },
  graph: { title: '图谱视图', noData: '未找到连接', close: '关闭' },
  tags: { title: '标签', none: '无标签', clearFilter: '清除筛选' },
  contextMenu: { rename: '重命名', delete: '删除', duplicateFile: '复制', copyPath: '复制路径', newFileHere: '在此新建文件' },
  settings: { title: '设置', fontSize: '字体大小', sortBy: '文件排序', sortName: '名称', sortModified: '修改时间', lineNumbers: '行号', language: '语言', close: '关闭' },
  dailyNote: { created: '已创建每日笔记' },
  common: { cancel: '取消', confirm: '确认', close: '关闭', delete: '删除', rename: '重命名', create: '创建' },
};

export default zh;
