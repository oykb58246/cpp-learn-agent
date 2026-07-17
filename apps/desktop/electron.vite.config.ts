import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

const workspacePackages = ['@cpp-pet/agent-runtime', '@cpp-pet/contracts', '@cpp-pet/cpp-local-tools', '@cpp-pet/cpp-local-tools/language-server', '@cpp-pet/cpp-local-tools/debugger', '@cpp-pet/database', '@cpp-pet/workspace-core', '@cpp-pet/ui-kit']
const workspaceAliases = [
  { find: /^@cpp-pet\/cpp-local-tools\/language-server$/, replacement: resolve(__dirname, '../../packages/cpp-local-tools/src/language-server.ts') },
  { find: /^@cpp-pet\/cpp-local-tools\/debugger$/, replacement: resolve(__dirname, '../../packages/cpp-local-tools/src/debugger.ts') },
  { find: /^@cpp-pet\/contracts\/ipc$/, replacement: resolve(__dirname, '../../packages/contracts/src/ipc.ts') },
  { find: /^@cpp-pet\/agent-runtime$/, replacement: resolve(__dirname, '../../packages/agent-runtime/src/index.ts') },
  { find: /^@cpp-pet\/contracts$/, replacement: resolve(__dirname, '../../packages/contracts/src/index.ts') },
  { find: /^@cpp-pet\/cpp-local-tools$/, replacement: resolve(__dirname, '../../packages/cpp-local-tools/src/index.ts') },
  { find: /^@cpp-pet\/database$/, replacement: resolve(__dirname, '../../packages/database/src/index.ts') },
  { find: /^@cpp-pet\/workspace-core$/, replacement: resolve(__dirname, '../../packages/workspace-core/src/index.ts') },
  { find: /^@cpp-pet\/ui-kit$/, replacement: resolve(__dirname, '../../packages/ui-kit/src/index.ts') }
]
export default defineConfig({
  main: {
    resolve: { alias: workspaceAliases },
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'mcp-worker': resolve(__dirname, 'src/main/mcp-worker.ts')
        }
      }
    }
  },
  preload: {
    resolve: { alias: workspaceAliases },
    plugins: [externalizeDepsPlugin({ exclude: ['@cpp-pet/contracts', '@cpp-pet/contracts/ipc'] })],
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } }
  },
  renderer: { plugins: [vue()], resolve: { alias: workspaceAliases } }
})
