import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const lockPath = '.webgpu-ui-lock.local';
const uiPainters = /\/(labelRenderingUtils|healthBarUtils|healthBarOverlayUtils|interactionIndicatorRenderingUtils|playerRenderingUtils|healthOverlayUtils|brothEffectsOverlayUtils|insanityOverlayUtils|mobileRenderingUtils)\.ts$/;
const protectedPath = path => /\.(tsx|css)$/.test(path)
  || /^client\/src\/(components|contexts|common|blog)\//.test(path)
  || /^client\/src\/assets\/(ui|items|fonts)\//.test(path) || uiPainters.test(path);
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const gitHash = data => crypto.createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
const rows = execFileSync('git', ['ls-tree', '-r', '-z', 'HEAD', 'client/src'], { maxBuffer: 16 * 1024 * 1024 }).toString().split('\0');
const current = {};
const mismatches = [];
for (const row of rows) {
  if (!row) continue;
  const [metadata, path] = row.split('\t');
  if (!protectedPath(path)) continue;
  const data = fs.readFileSync(path);
  // Verify unchanged source against Git, then lock the actual mixed-EOL
  // workspace bytes without normalizing or rewriting any protected file.
  const canonical = /\.(tsx?|jsx?|css|md|json|html|svg)$/.test(path) ? Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n')) : data;
  if (gitHash(canonical) !== metadata.split(' ')[2]) mismatches.push(path);
  current[path] = sha256(data);
}
const workspacePaths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', 'client/src'], { maxBuffer: 16 * 1024 * 1024 }).toString().split('\0');
const addedUi = workspacePaths.filter(path => path && protectedPath(path) && !(path in current)
  && !path.startsWith('client/src/engine/presentation/world3d/inspection/'));
if (addedUi.length) throw new Error(`New UI source must stay in the isolated development inspection entry:\n${addedUi.join('\n')}`);
if (mismatches.length) throw new Error(`Existing UI differs from the Git baseline:\n${mismatches.join('\n')}`);
if (process.argv.includes('--capture')) fs.writeFileSync(lockPath, JSON.stringify({ files: current }, null, 2), { flag: 'wx' });
if (fs.existsSync(lockPath)) {
  const locked = JSON.parse(fs.readFileSync(lockPath, 'utf8')).files;
  for (const [path, hash] of Object.entries(locked)) if (current[path] !== hash) mismatches.push(path);
}
if (mismatches.length) throw new Error(`Protected UI bytes changed:\n${mismatches.join('\n')}`);
process.stdout.write(`Verified ${Object.keys(current).length} existing UI source/assets against Git${fs.existsSync(lockPath) ? ' and the byte-for-byte workspace lock' : ''}.\n`);
