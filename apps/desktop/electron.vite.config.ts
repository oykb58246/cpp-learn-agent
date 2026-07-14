import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

const workspacePackages = ['@cpp-pet/contracts', '@cpp-pet/database', '@cpp-pet/workspace-core', '@cpp-pet/ui-kit']
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin({ exclude: workspacePackages })] },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@cpp-pet/contracts', '@cpp-pet/contracts/ipc'] })],
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } }
  },
  renderer: { plugins: [vue()] }
})
