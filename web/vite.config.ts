import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base` is the public path the built assets are served from.
//  - standalone (default): '/'  → served by our own Express at the site root.
//  - embedded in TerraFlow: set VITE_BASE=/static/sales-dashboard/ at build time
//    so asset URLs resolve under Django's static path.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  build: {
    outDir: 'dist',
  },
});
