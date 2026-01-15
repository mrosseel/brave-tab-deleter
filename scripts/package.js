/**
 * Package the extension for Chrome Web Store submission
 *
 * Usage: node scripts/package.js
 *
 * This script:
 * 1. Runs the build to ensure dist/ is up to date
 * 2. Creates a ZIP file with only the necessary files for the store
 */

import { execSync } from 'child_process';
import { createWriteStream, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Get version from manifest
const manifest = JSON.parse(readFileSync(join(rootDir, 'manifest.json'), 'utf8'));
const version = manifest.version;

// Files and folders to include in the ZIP
const includeFiles = [
  'manifest.json',
  'sidebar.html',
  'sidebar.css',
  'settings.html',
  'settings.css',
  'dist/background.js',
  'dist/sidebar.js',
  'dist/settings.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

async function build() {
  console.log('Building extension...');
  execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });
}

async function createZip() {
  const outputPath = join(rootDir, `tab-deleter-${version}.zip`);
  const output = createWriteStream(outputPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      console.log(`\nCreated: tab-deleter-${version}.zip (${archive.pointer()} bytes)`);
      resolve();
    });

    archive.on('error', reject);
    archive.pipe(output);

    for (const file of includeFiles) {
      archive.file(join(rootDir, file), { name: file });
    }

    archive.finalize();
  });
}

async function main() {
  console.log(`Packaging Tab Deleter v${version} for Chrome Web Store\n`);

  await build();
  console.log('\nCreating ZIP archive...');
  await createZip();

  console.log('\n--- Ready for Chrome Web Store ---');
  console.log('Upload the ZIP file at: https://chrome.google.com/webstore/devconsole');
}

main().catch(console.error);
