import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'queueglow-google-oauth-config',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'queueglow-google-oauth.json',
          source: JSON.stringify({ clientId: process.env.QUEUEGLOW_GOOGLE_CLIENT_ID || '' }),
        });
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    rolldownOptions: {
      input: {
        island: fileURLToPath(new URL('./index.html', import.meta.url)),
        settings: fileURLToPath(new URL('./settings.html', import.meta.url)),
      },
    },
  },
});

