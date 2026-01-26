import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: './generated/openapi.yaml',
  output: {
    path: './generated/typescript',
    format: 'prettier',
  },
  plugins: ['@hey-api/typescript'],
})
