import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 8088,
    open: false
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
});
