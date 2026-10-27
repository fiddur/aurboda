import type { TestProject } from 'vitest/node'

import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { Client } from 'pg'

import { createTableStatements, tableCreationOrder } from '../schema.ts'

declare module 'vitest' {
  interface ProvidedContext {
    pgAdminUri?: string
    pgTemplateDb?: string
  }
}

const TEMPLATE_DB = 'aurboda_template'

const withClient = async (connectionString: string, fn: (client: Client) => Promise<unknown>) => {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    await fn(client)
  } finally {
    await client.end()
  }
}

export default async (project: TestProject) => {
  const container = await new PostgreSqlContainer('postgis/postgis:16-3.4-alpine')
    .withDatabase('test_db')
    .withUsername('test_user')
    .withPassword('test_pass')
    .start()

  // The admin connection stays off the template: CREATE DATABASE … TEMPLATE refuses a
  // source with open sessions. `template_postgis` carries the same extensions the image
  // installs into `test_db`, which the container's health check keeps connecting to.
  const adminUri = new URL(container.getConnectionUri())
  adminUri.pathname = '/postgres'
  const templateUri = new URL(adminUri)
  templateUri.pathname = `/${TEMPLATE_DB}`

  await withClient(adminUri.toString(), (admin) =>
    admin.query(`CREATE DATABASE ${TEMPLATE_DB} TEMPLATE template_postgis`),
  )
  await withClient(templateUri.toString(), async (template) => {
    for (const tableName of tableCreationOrder) {
      const statement = createTableStatements[tableName]
      if (statement) await template.query(statement)
    }
  })

  project.provide('pgAdminUri', adminUri.toString())
  project.provide('pgTemplateDb', TEMPLATE_DB)

  return async () => {
    await container.stop()
  }
}
