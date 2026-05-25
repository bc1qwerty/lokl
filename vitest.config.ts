import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [preact()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      // fs.ts uses the File System Access API (showDirectoryPicker etc.) which
      // is unavailable in jsdom — it will be tested in task C4/C5 with a real
      // browser harness.  Excluding it keeps the gate honest for what we have.
      exclude: ['src/lib/fs.ts'],
      // Thresholds set just below actuals (floor(actual)-1) to catch regressions.
      // Phase 1 actuals (2026-05-25, fs.ts excluded): stmts=64%, branches=53%, fns=58%, lines=68%.
      // Target (Phase 2+): statements=80, branches=70, functions=80, lines=80.
      thresholds: { statements: 63, branches: 52, functions: 57, lines: 66 },
    },
  },
});
