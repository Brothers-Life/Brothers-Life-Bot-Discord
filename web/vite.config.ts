import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

// Built files also written as .br and .gz: the server sends them as they are (no compression work per request)
function precompress(): Plugin {
  return {
    name: 'brl-precompress',
    apply: 'build',
    closeBundle() {
      const dir = path.resolve(__dirname, 'dist')
      const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
      for (const file of walk(dir)) {
        if (!/\.(js|css|html|svg|json|txt|webmanifest)$/.test(file)) continue
        const data = fs.readFileSync(file)
        if (data.length < 1024) continue
        fs.writeFileSync(`${file}.br`, zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } }))
        fs.writeFileSync(`${file}.gz`, zlib.gzipSync(data, { level: 9 }))
      }
    },
  }
}

// In dev, the bot runs on :3000 and Vite proxies the API (and the console WebSocket) to it
export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    precompress(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
  },
})
