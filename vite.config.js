import { defineConfig } from 'vite';

export default defineConfig({
  // Относительный base — сборку можно положить в любую подпапку (например, GitHub Pages).
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
  server: {
    host: true,
    port: 5173,
  },
});
