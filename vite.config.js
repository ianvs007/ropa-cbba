import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { localDiskDbPlugin } from './src/server/localDiskDbPlugin.js'

export default defineConfig({
  plugins: [react(), localDiskDbPlugin()],
  server: {
    host: true,
    port: 3001,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 3001,
    strictPort: true,
  },
})

