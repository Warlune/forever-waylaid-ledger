// Copy the browser app into GitHub Pages' /docs publishing directory.
import { copyFileSync, lstatSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'dist');
const target = join(root, 'docs');
const staticExtensions = new Set(['.html', '.css', '.js', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.woff2']);
const files = readdirSync(source, { withFileTypes: true })
  .filter(entry => entry.isFile() && staticExtensions.has(extname(entry.name).toLowerCase()))
  .map(entry => entry.name);
if (!files.includes('index.html')) throw new Error('dist/index.html is missing.');

mkdirSync(target, { recursive: true });
const current = new Set(files);
for (const entry of readdirSync(target, { withFileTypes: true })) {
  if (entry.isFile() && staticExtensions.has(extname(entry.name).toLowerCase()) && !current.has(entry.name)) {
    unlinkSync(join(target, entry.name));
  }
}
for (const name of files) {
  if (!lstatSync(join(source, name)).isFile()) throw new Error(`Not a regular static file: ${name}`);
  copyFileSync(join(source, name), join(target, name));
}
writeFileSync(join(target, '.nojekyll'), '');
console.log(`Exported ${files.length} static files to docs/.`);
