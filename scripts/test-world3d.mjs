import { build } from 'esbuild';
import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Bundle TS exactly as Vite does, without adding a second test/transpile stack.
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'broth-world3d-'));
const target = join(temporaryDirectory, 'world3d.test.mjs');
try {
  const result = await build({ entryPoints: [resolve('scripts/world3d.test.mjs')], bundle: true,
    platform: 'node', format: 'esm', write: false, logLevel: 'warning' });
  await writeFile(target, result.outputFiles[0].contents);
  const run = spawnSync(process.execPath, ['--test', target], { stdio: 'inherit' });
  process.exitCode = run.status ?? 1;
} finally {
  // The only removed path is the exact file created above, never a recursive target.
  await rm(target, { force: true });
  await rmdir(temporaryDirectory);
}
