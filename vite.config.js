import process from 'node:process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { localDiskDbPlugin } from './src/server/localDiskDbPlugin.js'

// POS_HOST=127.0.0.1 → solo la propia máquina (una sola PC, sin otras PCs en red).
// Por defecto escucha en la red local para que otras PCs usen la BD central; el acceso a
// /__local_db/* exige token para peticiones que no vienen de la propia máquina.
const host = process.env.POS_HOST || true

export default defineConfig({
  plugins: [react(), localDiskDbPlugin()],
  server: {
    host,
    port: 3001,
    strictPort: true,
  },
  preview: {
    host,
    port: 3001,
    strictPort: true,
  },
})

