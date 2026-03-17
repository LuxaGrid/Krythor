import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 47210,
    proxy: {
      '/api': 'http://127.0.0.1:47200',
      '/ws':  { target: 'ws://127.0.0.1:47200', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
