import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import Prerender from '@prerenderer/rollup-plugin'
import PuppeteerRenderer from '@prerenderer/renderer-puppeteer'
import prerenderRoutes from './prerender-routes.json'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // Base plugins for all modes
  const plugins: any[] = [react()];
  
  // Only add prerenderer during production build (skip if SKIP_PRERENDER=1 to avoid statuses module resolution issues)
  const skipPrerender = process.env.SKIP_PRERENDER === '1';
  if (command === 'build' && mode === 'production' && !skipPrerender) {
    plugins.push(
      // Pre-render blog pages and static pages for SEO/LLEO
      Prerender({
        routes: prerenderRoutes.routes,
        renderer: new PuppeteerRenderer({
          // Wait for network to be idle before capturing
          renderAfterDocumentEvent: 'DOMContentLoaded',
          // Wait for React to render
          renderAfterTime: 2000,
          // Puppeteer launch options
          headless: true,
        }),
        // Post-process the rendered HTML
        postProcess(renderedRoute) {
          // Add prerendered indicator for debugging
          renderedRoute.html = renderedRoute.html.replace(
            '</head>',
            '<meta name="prerendered" content="true"></head>'
          );
        },
      })
    );
  }

  return {
    plugins,
    resolve: {
      alias: {
        // No alias needed - using spacetimedb package directly
      },
    },
    server: {
      port: 3008,
      // Rust builds and the local database contain locked, rapidly changing files;
      // neither belongs in the client hot-reload watcher.
      watch: { ignored: ['**/server/target/**', '**/.local-spacetimedb/**', '**/.cache/**'] },
      // Prefer 3008; if busy (e.g. another dev server), use the next free port (3009, …).
      strictPort: false,
      hmr: {
        // Omit clientPort so HMR matches whichever port Vite actually binds (important when port increments).
        host: 'localhost',
      },
    },
    root: '.',
    publicDir: 'public',
    build: {
      outDir: 'dist',
      rollupOptions: {
        output: {
          assetFileNames: '[name]-[hash][extname]',
        }
      },
      // Disable asset inlining to prevent base64 data URL strings from bloating JS heap
      // (~20MB of retained strings with 950+ PNG imports when inlined at 4KB threshold)
      assetsInlineLimit: 0,
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
      // Remove console logs in production for better performance
      // This strips ALL console.* calls and debugger statements from production builds
      drop: mode === 'production' ? ['console', 'debugger'] : [],
    }
  };
})
