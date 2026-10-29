import { build } from 'esbuild';
import { mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Repeatable CPU-only benchmark. This deliberately makes no GPU timing claim.
const directory = await mkdtemp(join(tmpdir(), 'broth-terrain-profile-'));
const target = join(directory, 'terrain.mjs');
try {
  const result = await build({ stdin: { contents: `export {createTerrainField} from './client/src/engine/presentation/world3d/terrainMaterials.ts'; export {ModelKit} from './client/src/engine/presentation/world3d/modelKit.ts'; export {createTree} from './client/src/engine/presentation/world3d/treeModels.ts'; export {buildTerrain} from './client/src/engine/presentation/world3d/terrainBuild.ts';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'warning' });
  await writeFile(target, result.outputFiles[0].contents);
  const { createTerrainField, ModelKit, createTree, buildTerrain } = await import(pathToFileURL(target).href);
  const tiles = [];
  for (let y = 0; y < 40; y++) for (let x = 0; x < 56; x++) tiles.push({worldX:x, worldY:y, tileType:{tag:x < 22 + Math.sin(y * .3) * 4 ? 'Beach' : x < 38 ? 'Sea' : 'DeepSea'}});
  const timings = [];
  for (let i = 0; i < 15; i++) {
    const start = performance.now(); createTerrainField(tiles);
    if (i >= 5) timings.push(performance.now() - start);
  }
  timings.sort((a,b) => a-b);
  console.log(JSON.stringify({kind:'CPU terrain field', tiles:tiles.length, samples:timings.length, medianMs:+timings[5].toFixed(2), maxMs:+timings.at(-1).toFixed(2)}));
  const models=[];
  for(let i=0;i<12;i++){
    const kit=new ModelKit(),start=performance.now();createTree(kit,'SitkaAlder',i%8);
    if(i>=2)models.push(performance.now()-start);kit.dispose();
  }
  models.sort((a,b)=>a-b);
  console.log(JSON.stringify({kind:'CPU fresh alder model',samples:models.length,medianMs:+models[5].toFixed(2),maxMs:+models.at(-1).toFixed(2)}));
  const full=[];for(let i=0;i<12;i++){const r=buildTerrain(tiles);if(i>=2)full.push(r.buildMs);}full.sort((a,b)=>a-b);
  console.log(JSON.stringify({kind:'CPU complete worker terrain build',tiles:tiles.length,medianMs:+full[5].toFixed(2),maxMs:+full.at(-1).toFixed(2)}));
} finally {
  await rm(target, {force:true}); await rmdir(directory);
}
