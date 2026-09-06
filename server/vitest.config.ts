import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      
    },
  },
  test: { include: ['src/**/*.test.ts'] },
});
