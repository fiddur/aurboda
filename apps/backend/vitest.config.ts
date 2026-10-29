import { configDefaults, defineConfig } from 'vitest/config'

import { sharedWorkerUnitFiles } from './vitest.projects.ts'

const sharedFiles = sharedWorkerUnitFiles(import.meta.dirname)

export default defineConfig({
  // Vite's esbuild does not know tsconfig's `es2025` target and warns once per file;
  // these fields are merged over the loaded tsconfig, not replacing it.
  esbuild: { tsconfigRaw: { compilerOptions: { target: 'esnext' } } },
  test: {
    projects: [
      {
        extends: true,
        test: { include: sharedFiles, isolate: false, name: 'unit-shared' },
      },
      {
        extends: true,
        test: {
          exclude: [...configDefaults.exclude, '**/*.integration.test.ts', ...sharedFiles],
          include: ['src/**/*.test.ts'],
          name: 'unit-isolated',
        },
      },
      {
        extends: true,
        test: {
          globalSetup: ['src/test/global-setup.ts'],
          include: ['src/**/*.integration.test.ts'],
          name: 'integration',
        },
      },
    ],
    setupFiles: ['src/test/setup.ts'],
  },
})
