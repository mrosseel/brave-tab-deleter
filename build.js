import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['background.js', 'sidebar.js', 'settings.js'],
  bundle: true,
  outdir: 'dist',
  format: 'iife',
});

await esbuild.build({
  entryPoints: ['content/youtube-progress.js'],
  bundle: true,
  outdir: 'dist/content',
  format: 'iife',
});

console.log('Build complete: dist/');
