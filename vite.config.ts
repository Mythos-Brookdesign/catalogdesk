import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [
    react(),
    {
      name: 'catalogdesk-csp',
      transformIndexHtml() {
        const policy =
          command === 'serve'
            ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://127.0.0.1:5178; worker-src 'self' blob:; object-src 'none'; base-uri 'self'"
            : "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; worker-src 'self'; object-src 'none'; base-uri 'self'"
        return [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
            injectTo: 'head-prepend',
          },
        ]
      },
    },
  ],
}))
