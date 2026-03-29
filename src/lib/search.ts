import MiniSearch from 'minisearch';

const index = new MiniSearch<{ id: string; title: string; path: string; content: string }>({
  fields: ['title', 'content'],
  storeFields: ['title', 'path'],
  searchOptions: {
    boost: { title: 3 },
    fuzzy: 0.2,
    prefix: true,
  },
});

export function indexFile(path: string, content: string) {
  const title = path.split('/').pop()?.replace(/\.md$/, '') || path;
  const id = path;
  if (index.has(id)) {
    index.replace({ id, title, path, content });
  } else {
    index.add({ id, title, path, content });
  }
}

export function removeFromIndex(path: string) {
  if (index.has(path)) {
    index.discard(path);
  }
}

export function search(query: string, limit = 20) {
  if (!query.trim()) return [];
  return index.search(query).slice(0, limit);
}

export function suggest(query: string, limit = 5) {
  if (!query.trim()) return [];
  return index.autoSuggest(query).slice(0, limit);
}

export function clearIndex() {
  index.removeAll();
}
