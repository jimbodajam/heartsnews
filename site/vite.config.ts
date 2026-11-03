import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** The dev spike pages read public/spike (#65); the broadcast never does, so it stays out of the deployed site. */
function dropSpike(): Plugin {
  let out = 'dist';
  return {
    name: 'drop-spike',
    apply: 'build',
    configResolved: (config) => void (out = resolve(config.root, config.build.outDir)),
    closeBundle: () => rmSync(resolve(out, 'spike'), { recursive: true, force: true }),
  };
}

export default defineConfig({
  // Relative asset paths so the build works from a GitHub Pages sub-path.
  base: './',
  plugins: [dropSpike()],
  server: {
    port: 5173,
    // File-change events don't cross from Windows into WSL on /mnt/c, so poll there.
    watch: process.env.WSL_DISTRO_NAME ? { usePolling: true, interval: 300 } : undefined,
  },
});
