import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [svelte()],
  server: {
    port: 5174,
    strictPort: true
  },
  build: {
    outDir: 'dist'
  }
});
