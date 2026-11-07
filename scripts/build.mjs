// Bundles the app's code into www/ (the folder Capacitor packs into the APK).
import { build } from 'esbuild';
import fs from 'node:fs';

fs.rmSync('www', { recursive: true, force: true });
fs.mkdirSync('www', { recursive: true });

await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  outfile: 'www/app.js',
  format: 'iife',
  target: ['chrome100'],
  minify: true,
  logLevel: 'info',
});

for (const f of ['index.html', 'style.css']) fs.copyFileSync(`web/${f}`, `www/${f}`);
console.log('Built www/ ok');
