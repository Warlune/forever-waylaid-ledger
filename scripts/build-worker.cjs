// Build a self-contained Cloudflare Worker from the existing static site.
// No package install or network access is needed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const project = path.resolve(__dirname, '..');
const staticRoot = path.join(project, 'dist');
const outputRoot = path.join(staticRoot, 'server');
const source = path.join(project, 'worker', 'index.js');
const hosting = path.join(project, '.openai', 'hosting.json');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function filesInside(directory, relative = '') {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!relative && (entry.name === 'server' || entry.name === '.openai')) continue;
    const full = path.join(directory, entry.name);
    const name = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    const type = fs.lstatSync(full);
    if (type.isSymbolicLink()) throw new Error(`Static asset is a symlink: ${name}`);
    if (type.isDirectory()) result.push(...filesInside(full, name));
    else if (type.isFile()) result.push({ full, name });
    else throw new Error(`Unsupported static asset: ${name}`);
  }
  return result;
}

const manifest = JSON.parse(fs.readFileSync(hosting, 'utf8'));
if (manifest.static || manifest.r2 !== 'BUCKET') {
  throw new Error('The Site must be configured as a Worker with the BUCKET R2 binding.');
}
const assets = {};
for (const { full, name } of filesInside(staticRoot)) {
  const bytes = fs.readFileSync(full);
  if (bytes.length > 10 * 1024 * 1024) throw new Error(`Static asset is too large: ${name}`);
  const ext = path.extname(name).toLowerCase();
  assets[`/${name}`] = {
    type: MIME[ext] || 'application/octet-stream',
    body: bytes.toString('base64'),
    etag: `"${crypto.createHash('sha256').update(bytes).digest('hex')}"`
  };
}
if (!assets['/index.html']) throw new Error('dist/index.html is missing.');
const placeholder = 'const ASSETS = __WAYLAID_ASSETS__;';
const worker = fs.readFileSync(source, 'utf8');
if (!worker.includes(placeholder)) throw new Error('Worker asset placeholder was not found.');
const bundled = worker.replace(placeholder, `const ASSETS = ${JSON.stringify(assets)};`);
fs.mkdirSync(outputRoot, { recursive: true });
fs.writeFileSync(path.join(outputRoot, 'index.js'), bundled);
fs.rmSync(path.join(outputRoot, 'wrangler.json'), { force: true });
fs.mkdirSync(path.join(staticRoot, '.openai'), { recursive: true });
fs.copyFileSync(hosting, path.join(staticRoot, '.openai', 'hosting.json'));
console.log(`Built Worker with ${Object.keys(assets).length} static assets.`);
