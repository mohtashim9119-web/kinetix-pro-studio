/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { ws3LivenessMiddleware } from './src/dev/exportLivenessProbe/viteMiddleware';

export default defineConfig({
  plugins: [react(), tailwindcss(), ws3LivenessMiddleware()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    watch: {
      ignored: ['**/src-tauri/target/**']
    }
  },
  test: {
    // Vitest's own default exclude is just node_modules + .git (vitest v4
    // `configDefaults.exclude`) — setting `test.exclude` OVERRIDES that
    // default entirely rather than appending to it, so both defaults are
    // restated here alongside the addition. `.claude/worktrees/**` stops a
    // future git worktree (a full nested checkout, including its own
    // node_modules-adjacent source tree) from having its test files picked
    // up by a plain `vitest run`'s glob — the stray-worktree incident
    // closed in WS2 Step 17 Part 0.
    exclude: ['**/node_modules/**', '**/.git/**', '.claude/worktrees/**', '.work-phase4/**'],
    reporters: ['default', './scripts/vitest-failure-record.ts'],
  },
});
