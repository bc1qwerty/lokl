import type { Locale } from './en';

const ja: Locale = {
  app: {
    name: 'Lokl',
    tagline: 'あなたのローカルナレッジベース',
  },
  welcome: {
    title: 'Loklへようこそ',
    subtitle: 'ローカルファイルと連携するブラウザベースのナレッジベースです。',
    openButton: 'フォルダを開く',
    reopenButton: '再度開く',
    dragHint: 'またはフォルダをここにドラッグ',
    privacyNote: 'ファイルはデバイスから離れません。何もアップロードされません。',
    features: {
      offline: 'オフライン対応',
      wikilinks: '[[ウィキリンク]] & バックリンク',
      search: '即時全文検索',
      privacy: '100%プライベート — サーバー不要',
    },
    unsupported: 'ブラウザのサポートが限定的です。ChromeまたはEdgeをご使用ください。',
  },
  sidebar: {
    openFolder: 'フォルダを開く',
    newFile: '新規ファイル',
    search: '検索…',
    noFiles: 'マークダウンファイルが見つかりません',
    files: 'ファイル',
    sortName: '名前順',
    sortModified: '更新日順',
  },
  tabs: {
    close: 'タブを閉じる',
    closeOthers: '他を閉じる',
    closeAll: 'すべて閉じる',
  },
  editor: {
    unsaved: '未保存',
    saving: '保存中…',
    saved: '保存済み',
    readOnly: '読み取り専用',
  },
  preview: {
    empty: 'プレビューする内容がありません',
  },
  search: {
    placeholder: 'ノートを検索…',
    shortcut: '⌘K',
    noResults: '結果が見つかりません',
    hint: 'ファイル名と内容を検索します',
  },
  quickOpen: {
    placeholder: 'ファイルに移動…',
    noResults: 'ファイルが見つかりません',
  },
  backlinks: {
    title: 'バックリンク',
    none: 'バックリンクなし',
    linkedFrom: 'リンク元',
  },
  toolbar: {
    toggleSidebar: 'サイドバー切替',
    togglePreview: 'プレビュー切替',
    toggleBacklinks: 'バックリンク切替',
    toggleGraph: 'グラフビュー',
    themeLight: 'ライトモードに切替',
    themeDark: 'ダークモードに切替',
    settings: '設定',
    dailyNote: '今日のノート',
    viewEdit: '編集',
    viewSplit: '分割',
    viewPreview: 'プレビュー',
  },
  graph: {
    title: 'グラフビュー',
    noData: '接続が見つかりません',
    close: '閉じる',
  },
  tags: {
    title: 'タグ',
    none: 'タグなし',
    clearFilter: 'フィルタ解除',
  },
  contextMenu: {
    rename: '名前変更',
    delete: '削除',
    duplicateFile: '複製',
    copyPath: 'パスをコピー',
    newFileHere: 'ここに新規ファイル',
  },
  settings: {
    title: '設定',
    fontSize: 'フォントサイズ',
    sortBy: 'ファイル並び替え',
    sortName: '名前',
    sortModified: '更新日',
    lineNumbers: '行番号',
    language: '言語',
    close: '閉じる',
  },
  dailyNote: {
    created: '今日のノートを作成しました',
  },
  common: {
    cancel: 'キャンセル',
    confirm: '確認',
    close: '閉じる',
    delete: '削除',
    rename: '名前変更',
    create: '作成',
  },
};

export default ja;
