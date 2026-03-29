import type { Locale } from './en';

const ko: Locale = {
  app: {
    name: 'Lokl',
    tagline: '나만의 로컬 지식 베이스',
  },
  welcome: {
    title: 'Lokl에 오신 것을 환영합니다',
    subtitle: '로컬 파일과 함께 작동하는 브라우저 기반 지식 베이스입니다.',
    openButton: '폴더 열기',
    reopenButton: '다시 열기',
    dragHint: '또는 폴더를 여기에 드래그',
    privacyNote: '파일은 기기를 떠나지 않습니다. 아무것도 업로드되지 않습니다.',
    features: {
      offline: '오프라인 작동',
      wikilinks: '[[위키링크]] & 백링크',
      search: '즉시 전문 검색',
      privacy: '100% 비공개 — 서버 없음',
    },
    unsupported: '브라우저 지원이 제한적입니다. Chrome 또는 Edge를 사용해 주세요.',
  },
  sidebar: {
    openFolder: '폴더 열기',
    newFile: '새 파일',
    search: '검색…',
    noFiles: '마크다운 파일이 없습니다',
    files: '파일',
    sortName: '이름순 정렬',
    sortModified: '수정일순 정렬',
  },
  tabs: {
    close: '탭 닫기',
    closeOthers: '다른 탭 닫기',
    closeAll: '모두 닫기',
  },
  editor: {
    unsaved: '저장 안 됨',
    saving: '저장 중…',
    saved: '저장됨',
    readOnly: '읽기 전용',
  },
  preview: {
    empty: '미리볼 내용이 없습니다',
  },
  search: {
    placeholder: '노트 검색…',
    shortcut: '⌘K',
    noResults: '결과가 없습니다',
    hint: '파일명과 내용을 검색합니다',
  },
  quickOpen: {
    placeholder: '파일로 이동…',
    noResults: '파일을 찾을 수 없습니다',
  },
  backlinks: {
    title: '백링크',
    none: '백링크 없음',
    linkedFrom: '연결된 출처',
  },
  toolbar: {
    toggleSidebar: '사이드바 토글',
    togglePreview: '미리보기 토글',
    toggleBacklinks: '백링크 토글',
    toggleGraph: '그래프 뷰',
    themeLight: '라이트 모드로 전환',
    themeDark: '다크 모드로 전환',
    settings: '설정',
    dailyNote: '오늘의 노트',
    viewEdit: '편집',
    viewSplit: '분할',
    viewPreview: '미리보기',
  },
  graph: {
    title: '그래프 뷰',
    noData: '연결이 없습니다',
    close: '닫기',
  },
  tags: {
    title: '태그',
    none: '태그 없음',
    clearFilter: '필터 해제',
  },
  contextMenu: {
    rename: '이름 변경',
    delete: '삭제',
    duplicateFile: '복제',
    copyPath: '경로 복사',
    newFileHere: '여기에 새 파일',
  },
  settings: {
    title: '설정',
    fontSize: '글꼴 크기',
    sortBy: '파일 정렬',
    sortName: '이름',
    sortModified: '수정일',
    lineNumbers: '줄 번호',
    language: '언어',
    close: '닫기',
  },
  dailyNote: {
    created: '오늘의 노트가 생성되었습니다',
  },
  common: {
    cancel: '취소',
    confirm: '확인',
    close: '닫기',
    delete: '삭제',
    rename: '이름 변경',
    create: '만들기',
  },
};

export default ko;
