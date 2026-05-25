import PouchDB from 'pouchdb-browser';
// @ts-expect-error - no types for adapter
import memoryAdapter from 'pouchdb-adapter-memory';

let counter = 0;
PouchDB.plugin(memoryAdapter);

export function freshDB(name?: string) {
  const dbName = name ?? `lokl-test-${++counter}-${Date.now()}`;
  return new PouchDB(dbName, { adapter: 'memory' });
}
