import preact from '@preact/preset-vite'
import { defineConfig } from 'vitest/config'

// https://vitejs.dev/config/
export default defineConfig({
  envDir: '../..',
  plugins: [preact()],
  build: {
    sourcemap: true,
  },
  test: {
    // Pin the test timezone so date-formatting cases (same-day vs cross-day
    // windows) are deterministic on any machine, without individual test files
    // mutating the worker-shared `process.env.TZ` (#1014).
    env: { TZ: 'UTC' },
  },
})
