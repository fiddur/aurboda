import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const generatedDir = join(__dirname, '..', 'generated')

// Ensure generated directory exists
if (!existsSync(generatedDir)) {
  mkdirSync(generatedDir, { recursive: true })
}

// Read the OpenAPI spec
const openapiJson = readFileSync(join(generatedDir, 'openapi.json'), 'utf-8')

// Generate HTML with embedded Scalar API Reference
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aurboda Health API Documentation</title>
  <style>
    body { margin: 0; padding: 0; }
  </style>
</head>
<body>
  <script id="api-reference" type="application/json">
${openapiJson}
  </script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>
`

writeFileSync(join(generatedDir, 'api-docs.html'), html)
console.log('Generated API documentation: generated/api-docs.html')
