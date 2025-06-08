import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3008,
  },
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          // Separate assets by type for better caching
          if (assetInfo.name?.endsWith('.png') || assetInfo.name?.endsWith('.jpg') || assetInfo.name?.endsWith('.webp')) {
            return 'assets/images/[name]-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        }
      }
    },
    // Enable asset inlining for small images (4KB threshold)
    assetsInlineLimit: 4096,
    // Improve build performance
    target: 'esnext',
    minify: 'esbuild',
  },
  // Optimize dependencies for faster loading
  optimizeDeps: {
    include: [
      '@fortawesome/fontawesome-svg-core', 
      '@fortawesome/react-fontawesome',
      '@fortawesome/free-brands-svg-icons'
    ]
  },
  // Enable experimental features for better performance
  esbuild: {
    // Remove console.log in production
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
  }
})
