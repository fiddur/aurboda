import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: './generated/openapi.yaml',
  output: {
    format: 'prettier',
    path: './generated/typescript',
  },
  plugins: ['@hey-api/typescript'],
})
