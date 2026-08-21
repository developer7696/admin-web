import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Firebase and Recharts are the two heavyweights and change far less
        // often than app code, so splitting them keeps the app chunk small and
        // lets the vendor chunks stay cached across deploys. Recharts now loads
        // only when a pane that draws a chart is opened.
        //
        // `ui` exists because the panes are lazy: without it Rollup emits a
        // separate 400-byte chunk per shared icon and primitive, and a pane that
        // uses twenty of them pays twenty request round trips to render. One
        // shared chunk is downloaded once and then cached for every pane.
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('firebase') || id.includes('@firebase')) return 'firebase';
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory'))
            return 'charts';
          if (id.includes('lucide-react') || id.includes('@radix-ui')) return 'ui';
          if (
            id.includes('react-router') ||
            id.includes('@tanstack') ||
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('scheduler')
          ) {
            return 'vendor';
          }
          return undefined;
        },
      },
    },
  },
});
