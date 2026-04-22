import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// ui/ lives inside packages/core/ — resolve node_modules from the package root
const pkgRoot = path.resolve(__dirname, '..')

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname),
  resolve: {
    // Ensure React & friends are found in packages/core/node_modules
    alias: {
      react: path.resolve(pkgRoot, 'node_modules/react'),
      'react-dom': path.resolve(pkgRoot, 'node_modules/react-dom'),
      'react/jsx-runtime': path.resolve(pkgRoot, 'node_modules/react/jsx-runtime'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../dist/ui'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3741',
        changeOrigin: true,
      },
    },
  },
})
