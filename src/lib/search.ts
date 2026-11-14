import MiniSearch from 'minisearch';
import { nfc } from './note-path';

const index = new MiniSearch<{ id: string; title: string; path: string; content: string }>({
  fields: ['title', 'content'],
  storeFields: ['title', 'path'],
  // The default vacuum rests between batches; a clearIndex() landing in one of those rests swaps
  // the tree under it and it throws (uncaught). One uninterrupted pass cannot be interleaved.
  autoVacuum: { batchSize: Number.MAX_SAFE_INTEGER },
  searchOptions: {
    boost: { title: 3 },
    fuzzy: 0.2,
    prefix: true,
  },
});

export function indexFile(path: string, content: string) {
  // Indexed text is NFC so a typed query finds a title or body that arrived decomposed (Mac file names).
  const title = nfc(path.split('/').pop()?.replace(/\.md$/, '') || path);
  const id = path;
  content = nfc(content);
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
  return index.search(nfc(query)).slice(0, limit);
}

export function clearIndex() {
  index.removeAll();
}
