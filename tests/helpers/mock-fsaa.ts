// In-memory FileSystemDirectoryHandle substitute for tests.
// Implements only what src/lib/migrate.ts touches.

type FileNode = { kind: 'file'; name: string; content: string; failClose?: boolean; failWrite?: boolean };
type DirNode  = { kind: 'directory'; name: string; children: Map<string, FileNode | DirNode> };

export function createMockDir(name = 'root'): DirNode {
  return { kind: 'directory', name, children: new Map() };
}

export function wrapAsFSAA(node: DirNode): any {
  return {
    kind: 'directory',
    name: node.name,

    async *entries(): AsyncIterable<[string, any]> {
      for (const [n, child] of node.children) {
        yield [n, child.kind === 'directory' ? wrapAsFSAA(child) : wrapAsFile(child, node.children)];
      }
    },

    async *values(): AsyncIterable<any> {
      for (const child of node.children.values()) {
        yield child.kind === 'directory' ? wrapAsFSAA(child) : wrapAsFile(child, node.children);
      }
    },

    async getDirectoryHandle(n: string, opts?: { create?: boolean }) {
      let child = node.children.get(n);
      if (!child && opts?.create) {
        child = createMockDir(n);
        node.children.set(n, child);
      }
      if (!child) {
        const err: any = new Error('NotFoundError');
        err.name = 'NotFoundError';
        throw err;
      }
      if (child.kind !== 'directory') throw new Error('not a directory');
      return wrapAsFSAA(child);
    },

    async getFileHandle(n: string, opts?: { create?: boolean }) {
      let child = node.children.get(n);
      if (!child && opts?.create) {
        child = { kind: 'file', name: n, content: '' };
        node.children.set(n, child);
      }
      if (!child) {
        const err: any = new Error('NotFoundError');
        err.name = 'NotFoundError';
        throw err;
      }
      if (child.kind !== 'file') throw new Error('not a file');
      return wrapAsFile(child, node.children);
    },

    async removeEntry(n: string) {
      node.children.delete(n);
    },
  };
}

function wrapAsFile(f: FileNode, parentMap?: Map<string, FileNode | DirNode>): any {
  return {
    kind: 'file',
    name: f.name,
    async getFile() {
      return {
        name: f.name,
        async text() { return f.content; },
      };
    },
    async createWritable() {
      let buf = '';
      return {
        write: async (data: any) => {
          if (f.failWrite) throw new Error('simulated write failure');
          buf += typeof data === 'string' ? data : String(data);
        },
        close: async () => {
          if (f.failClose) throw new Error('simulated close failure');
          f.content = buf;
        },
      };
    },
    async move(newName: string) {
      const oldName = f.name;
      f.name = newName;
      if (parentMap) {
        parentMap.delete(oldName);
        parentMap.set(newName, f);
      }
    },
  };
}
