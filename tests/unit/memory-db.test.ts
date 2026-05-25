import { describe, it, expect } from 'vitest';
import { freshDB } from '../helpers/memory-db';

describe('memory-db helper smoke', () => {
  it('creates a memory-adapter PouchDB', async () => {
    const db = freshDB();
    await db.put({ _id: 'x', value: 1 });
    const doc = await db.get('x');
    expect((doc as any).value).toBe(1);
  });
});
