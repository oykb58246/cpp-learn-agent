import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@cpp-pet/agent-runtime': resolve(__dirname, '../../packages/agent-runtime/src/index.ts'),
      '@cpp-pet/contracts': resolve(__dirname, '../../packages/contracts/src/index.ts'),
      '@cpp-pet/database': resolve(__dirname, '../../packages/database/src/index.ts'),
      '@cpp-pet/workspace-core': resolve(__dirname, '../../packages/workspace-core/src/index.ts')
    }
  }
})
