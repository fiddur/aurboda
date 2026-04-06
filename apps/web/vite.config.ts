import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  envDir: '../..',
  plugins: [preact()],
  build: {
    sourcemap: true,
  },
})
