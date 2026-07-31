import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // 单元/集成测试里把 electron 替换成轻量 mock（只提供 app.getPath）
      electron: path.resolve(__dirname, 'tests/mocks/electron.ts'),
      '@shared': path.resolve(__dirname, 'shared'),
      '@electron': path.resolve(__dirname, 'electron'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
    // 集成测试起真实端口，串行更稳
    pool: 'forks',
    fileParallelism: false,
  },
});
