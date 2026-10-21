import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works from a GitHub Pages sub-path.
  base: './',
  server: {
    port: 5173,
    // File-change events don't cross from Windows into WSL on /mnt/c, so poll there.
    watch: process.env.WSL_DISTRO_NAME ? { usePolling: true, interval: 300 } : undefined,
  },
});
