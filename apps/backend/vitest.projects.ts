import { globSync, readFileSync } from 'node:fs'

// vi.mock and friends register in the module graph of the worker that runs the file, and fake
// timers replace the worker's globals, so with isolation off either leaks into every file
// sharing that worker. Only files free of them can run in the shared, non-isolated project.
const WORKER_STATE = /\bvi\.(mock|doMock|unmock|resetModules|stubGlobal|stubEnv|hoisted|useFakeTimers)\(/

export const sharedWorkerUnitFiles = (root: string): string[] =>
  globSync('src/**/*.test.ts', { cwd: root, exclude: (path) => path.endsWith('.integration.test.ts') })
    .filter((path) => !WORKER_STATE.test(readFileSync(`${root}/${path}`, 'utf8')))
    .sort()
