import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['background.js', 'sidebar.js', 'settings.js'],
  bundle: true,
  outdir: 'dist',
  format: 'iife',
});

console.log('Build complete: dist/');
