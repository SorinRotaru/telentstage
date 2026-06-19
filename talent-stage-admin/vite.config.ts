import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  build: {
    copyPublicDir: false,
  },
  plugins: [
    react(),
    {
      name: 'copy-public-dir-sync',
      closeBundle() {
        const publicDir = resolve(import.meta.dirname, 'public')
        const distDir = resolve(import.meta.dirname, 'dist')

        if (existsSync(publicDir)) {
          copyPublicDir(publicDir, distDir)
        }
      },
    },
  ],
  base: '/',
  server: {
    host: '0.0.0.0',
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})

function copyPublicDir(from: string, to: string) {
  mkdirSync(to, { recursive: true })

  for (const entry of readdirSync(from)) {
    const source = join(from, entry)
    const target = join(to, entry)

    if (statSync(source).isDirectory()) {
      copyPublicDir(source, target)
    } else {
      writeFileSync(target, readFileSync(source))
    }
  }
}
