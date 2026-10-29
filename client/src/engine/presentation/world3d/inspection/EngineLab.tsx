import React, { useEffect, useRef, useState } from 'react';
import { WebGpuWorldRenderer } from '../WebGpuWorldRenderer';
import { createInspectionWorld, INSPECTION_WEAPONS } from '../inspectionWorld';
import type { InspectionScene } from '../inspectionWorld';
import type { PresentationStatus, VisualDebugMode } from '../visualContract';
import { WORLD_3D } from '../visualContract';
import './EngineLab.css';

/** Inspection shares the production presentation path and needs no account/server. */
export default function EngineLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<PresentationStatus>({ phase: 'initializing', message: 'Starting WebGPU…' });
  const [metrics, setMetrics] = useState('');
  const [debug, setDebug] = useState<VisualDebugMode>('lit');
  const [day, setDay] = useState(0.43);
  const [weapon, setWeapon] = useState(() => Math.max(1, INSPECTION_WEAPONS.indexOf(new URLSearchParams(window.location.search).get('weapon') ?? '') + 1));
  const [paused, setPaused] = useState(false);
  const [animalMotion, setAnimalMotion] = useState('walk');
  const [zoom, setZoom] = useState(1);
  const [seed, setSeed] = useState(73021);
  const [reset, setReset] = useState(0);
  const [scene, setScene] = useState<InspectionScene>(() => {
    const requested = new URLSearchParams(window.location.search).get('scene');
    return ['world', 'construction', 'storage', 'camp', 'plants-crops', 'plants-herbs', 'plants-forage', 'plants-piles', 'equipment', 'weapons-1', 'weapons-2', 'weapons-3', 'weapons-4', 'trees-1', 'trees-2', 'wildlife-1', 'wildlife-2', 'corpses-1', 'corpses-2', 'natural', 'reef', 'terrain', 'shelters', 'shore-drops', 'villages-fishing', 'villages-hunting', 'villages-alpine', 'villages-other', 'weather-station'].includes(requested ?? '') ? requested as InspectionScene : 'world';
  });
  const [burning, setBurning] = useState(true);
  const [inside, setInside] = useState(false);
  const settings = useRef({ debug, day, weapon, paused, zoom, burning, inside, animalMotion });
  settings.current = { debug, day, weapon, paused, zoom, burning, inside, animalMotion };

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Broth & Bullets · WebGPU Engine Study';
    return () => { document.title = previousTitle; };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new WebGpuWorldRenderer(canvas, setStatus);
    const tables = createInspectionWorld(seed, scene);
    const streamed = new URLSearchParams(window.location.search).has('streamed');
    const chunks = new Map<string,{chunkSize:number;tileTypes:Uint8Array}>();
    if(streamed){
      const kinds=['Grass','Dirt','DirtRoad','Sea','Beach','Sand','HotSpringWater','Quarry','Asphalt','Forest','Tundra','Alpine','TundraGrass','Tilled','DeepSea'];
      // Extend only this dev fixture so large-view streaming includes a full
      // terrain window rather than the small composition's clipped boundary.
      for(let y=0;y<12;y++)for(let x=0;x<12;x++)chunks.set(`${x},${y}`,{chunkSize:8,tileTypes:new Uint8Array(64).fill(x>=5?14:x>=4?3:4)});
      for(const tile of tables.visibleWorldTiles.values()){
        const x=tile.worldX??0,y=tile.worldY??0,key=`${Math.floor(x/8)},${Math.floor(y/8)}`;
        let chunk=chunks.get(key);if(!chunk){chunk={chunkSize:8,tileTypes:new Uint8Array(64)};chunks.set(key,chunk);}
        chunk.tileTypes[y%8*8+x%8]=Math.max(0,kinds.indexOf((tile.tileType as {tag:string}).tag));
      }
    }
    const renderTables=streamed?{...tables,worldChunkDataMap:chunks}:tables;
    const player = tables.players.get('inspection-survivor')!;
    if ((scene === 'reef' || scene === 'terrain') && new URLSearchParams(window.location.search).has('dive')) {
      player.isSnorkeling = true; player.isOnWater = true;
    }
    const equipment = tables.activeEquipments.get('inspection-survivor')!;
    const animals = tables.wildAnimals;
    const keys = new Set<string>();
    let raf = 0;
    let last = performance.now();
    let time = 0;
    let metricsAt = 0;
    let rollStart = -10;
    const epochMs = Date.now();
    const fallParam = new URLSearchParams(window.location.search).get('fallMs');
    const liveFall = fallParam === 'live';
    const fallMs = fallParam === null ? null : Math.max(0, Number(fallParam) || 0);
    const fixtureTree = scene.startsWith('trees-') && fallMs !== null ? [...tables.trees.entries()][1] : undefined;
    if(fixtureTree)fixtureTree[1].health=0;
    if (scene !== 'world') player.positionY = 21 * 48;
    if (scene === 'reef') player.positionY = 16.5 * 48;
    if (scene.startsWith('plants-') || scene.startsWith('weapons-')) player.positionX = 11 * 48;
    if (scene === 'equipment') player.positionY = 16.5 * 48;
    let wasInside = !settings.current.inside;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement || event.target instanceof HTMLSelectElement) return;
      const key = event.key.toLowerCase();
      keys.add(key);
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) event.preventDefault();
      if (key === ' ' && !event.repeat) player.jumpStartTimeMs = BigInt(Math.floor(epochMs + time * 1000));
      if (key === 'r' && !event.repeat) rollStart = time;
      if (key === 'e' && !event.repeat) for (const door of tables.doors.values()) {
        if (Math.hypot(player.positionX - (door.posX ?? 0), player.positionY - (door.posY ?? 0)) < 140) door.isOpen = !door.isOpen;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
    const onBlur = () => keys.clear();
    const onAttack = () => { equipment.swingStartTimeMs = BigInt(Math.floor(epochMs + time * 1000)); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    canvas.addEventListener('pointerdown', onAttack);
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const options = settings.current;
      if (scene === 'construction' && wasInside !== options.inside) {
        player.positionX = options.inside ? 21 * 48 : 20 * 48;
        player.positionY = options.inside ? 11.7 * 48 : 21 * 48;
        wasInside = options.inside;
      }
      if(scene==='shelters'&&wasInside!==options.inside){
        player.positionX=13*48;player.positionY=(options.inside?14:18)*48;wasInside=options.inside;
      }
      if (!options.paused) {
        time += dt;
        let dx = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
        let dy = Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup'));
        const length = Math.hypot(dx, dy);
        if (length) { dx /= length; dy /= length; }
        player.isSprinting = keys.has('shift');
        player.isCrouching = keys.has('c');
        const speed = player.isSprinting ? 220 : player.isCrouching ? 65 : 130;
        player.positionX = Math.max(48, Math.min(42 * 48, player.positionX + dx * dt * speed));
        player.positionY = Math.max(48, Math.min(28 * 48, player.positionY + dy * dt * speed));
        if (length) player.direction = `${dy < 0 ? 'up' : dy > 0 ? 'down' : ''}${dx < 0 ? 'left' : dx > 0 ? 'right' : ''}`;
        for (const animal of animals.values()) {
          const reviewing = scene.startsWith('wildlife-');
          const rate = reviewing ? options.animalMotion === 'run' ? 3.8 : options.animalMotion === 'walk' ? 1.2 : 0 : .16;
          const t = time * rate + animal.phase;
          animal.posX = animal.spawnX + Math.sin(t) * 35;
          animal.posY = animal.spawnY + Math.cos(t) * 25;
          animal.directionX = Math.cos(t);
          animal.directionY = -Math.sin(t);
          animal.lastAttackTime = reviewing && options.animalMotion === 'attack' ? { microsSinceUnixEpoch: BigInt(Math.floor((epochMs + Math.floor(time / 1.6) * 1600) * 1000)) } : undefined;
        }
      }
      equipment.equippedItemDefId = BigInt(options.weapon);
      for (const survivor of tables.players.values()) survivor.isTorchLit = options.burning;
      tables.worldState.cycleProgress = options.day;
      for (const sources of [tables.campfires, tables.furnaces, tables.barbecues, tables.lanterns]) {
        for (const source of sources.values()) source.isBurning = options.burning;
      }
      const elapsed=liveFall ? time*1000 : fallMs ?? 0, linear=Math.min(elapsed/2500,1);
      const eased=linear<.5?2*linear*linear:1-Math.pow(-2*linear+2,2)/2;
      const sceneTables=fixtureTree?{...renderTables,isTreeFalling:(id:string)=>id===fixtureTree[0]&&elapsed<4000,
        getFallProgress:()=>eased,fallingTrees:new Map([[fixtureTree[0],{startTime:epochMs+time*1000-elapsed}]])}:renderTables;
      const width = window.innerWidth;
      const height = window.innerHeight;
      renderer.render({ width, height, cameraOffset: { x: width / 2 - (scene === 'world' || scene === 'equipment' ? player.positionX : 20 * 48), y: height / 2 - (scene === 'world' || scene === 'equipment' ? player.positionY : 16.5 * 48) },
        tables:sceneTables, localPlayerId: 'inspection-survivor', predictedPosition: { x: player.positionX, y: player.positionY },
        facing: player.direction, rollProgress: time - rollStart >= 0 && time - rollStart < 0.5 ? (time - rollStart) / 0.5 : 0,
        timeSeconds: time, nowMs: epochMs + time * 1000, debug: options.debug, zoom: options.zoom, profile:true });
      canvas.dataset.playerPosition = JSON.stringify({ x: player.positionX, y: player.positionY, direction: player.direction });
      canvas.dataset.doorStates = JSON.stringify([...tables.doors].map(([id, door]) => ({ id, open: Boolean(door.isOpen) })));
      canvas.dataset.inspectionScene = scene;
      canvas.dataset.inspectedPlants = JSON.stringify([...tables.harvestableResources.values()].map(row => (row.plantType as { tag: string }).tag));
      canvas.dataset.inspectedWeapons = JSON.stringify([...tables.activeEquipments.values()].map(row => tables.itemDefinitions.get(String(row.equippedItemDefId))?.name));
      if (now - metricsAt > 1000) { setMetrics(canvas.dataset.metrics ?? ''); metricsAt = now; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointerdown', onAttack);
      void renderer.dispose();
    };
  }, [seed, reset, scene]);

  let stats: { drawCalls?: number; entities?: number; cpuFrameMs?: number; triangles?: number } = {};
  try { stats = metrics ? JSON.parse(metrics) : {}; } catch { /* Initialization state. */ }

  return <main className="engine-lab">
    <canvas ref={canvasRef} tabIndex={0} aria-label="Interactive Three.js WebGPU inspection world" />
    <header className="engine-lab-header">
      <div><span className="engine-lab-eyebrow">BROTH & BULLETS · ENGINE STUDY 01</span><h1>A world with depth.</h1><p>Real geometry. A familiar perspective.</p></div>
      <span className={`engine-lab-backend ${status.phase}`}>{status.phase === 'ready' ? '● WEBGPU' : status.phase === 'error' ? 'WEBGPU REQUIRED' : 'INITIALIZING'}</span>
    </header>
    {status.phase !== 'ready' && <div className="engine-lab-status" role={status.phase === 'error' ? 'alert' : 'status'}>
      <h2>{status.phase === 'error' ? 'WebGPU is required' : 'Opening the world'}</h2><p>{status.message}</p>
      {status.phase === 'error' && <button onClick={() => window.location.reload()}>Try again</button>}
    </div>}
    <aside className="engine-lab-controls" aria-label="World inspection controls">
      <label>SCENE <select aria-label="Inspection scene" value={scene} onChange={e => setScene(e.target.value as InspectionScene)}><option value="world">World</option><option value="construction">Construction</option><option value="storage">Storage & workshops</option><option value="camp">Camp & utilities</option><option value="equipment">Equipment</option><option value="plants-crops">Plants · 1</option><option value="plants-herbs">Plants · 2</option><option value="plants-forage">Plants · 3</option><option value="plants-piles">Plants · 4</option><option value="weapons-1">Weapons · 1</option><option value="weapons-2">Weapons · 2</option><option value="weapons-3">Weapons · 3</option><option value="weapons-4">Weapons · 4</option><option value="trees-1">Trees · 1</option><option value="trees-2">Trees · 2</option><option value="wildlife-1">Wildlife · 1</option><option value="wildlife-2">Wildlife · 2</option><option value="corpses-1">Corpses · 1</option><option value="corpses-2">Corpses · 2</option><option value="natural">Natural objects</option><option value="reef">Reef & swimming depth</option><option value="terrain">All terrain materials</option><option value="shelters">Biome shelters</option><option value="shore-drops">Shore loot</option><option value="villages-fishing">Fishing village</option><option value="villages-hunting">Hunting village</option><option value="villages-alpine">Alpine village</option><option value="villages-other">Hermit and hot spring</option><option value="weather-station">Weather station</option></select></label>
      {scene.startsWith('wildlife-') && <label>MOTION <select aria-label="Animal motion" value={animalMotion} onChange={e => setAnimalMotion(e.target.value)}><option value="idle">Idle</option><option value="walk">Walk</option><option value="run">Run</option><option value="attack">Attack</option></select></label>}<label>LIGHT <input aria-label="Time of day" type="range" min="0" max="1" step="0.01" value={day} onChange={e => setDay(Number(e.target.value))} /></label>
      <label>VIEW <select aria-label="Render diagnostic" value={debug} onChange={e => setDebug(e.target.value as VisualDebugMode)}><option value="lit">Lit</option><option value="unlit">Unlit baseline</option><option value="wireframe">Geometry</option><option value="fields">Terrain blend / wetness</option></select></label>
      <label>HELD <select aria-label="Held weapon" value={weapon} onChange={e => setWeapon(Number(e.target.value))}>{INSPECTION_WEAPONS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label>
      <label>SCALE <select aria-label="Camera scale" value={zoom} onChange={e => setZoom(Number(e.target.value))}><option value="1.6">Near</option><option value="1">Design</option><option value="0.7">Far</option></select></label>
      <label>SEED <select aria-label="World seed" value={seed} onChange={e => setSeed(Number(e.target.value))}><option value="73021">73021</option><option value="147">147</option><option value="4294967295">Stress</option></select></label>
      <button onClick={() => setPaused(value => !value)}>{paused ? 'Resume' : 'Freeze'}</button>
      {(scene === 'camp' || INSPECTION_WEAPONS[weapon - 1] === 'Torch') && <button onClick={() => setBurning(value => !value)}>{burning ? 'Extinguish' : 'Ignite'}</button>}
      {(scene === 'construction' || scene === 'shelters') && <button onClick={() => setInside(value => !value)}>{inside ? 'Leave room' : 'Enter room'}</button>}
      <button onClick={() => setReset(value => value + 1)}>Reset</button>
    </aside>
    <footer className="engine-lab-footer"><div><strong>WASD</strong> walk <span>·</span> <strong>SHIFT</strong> sprint <span>·</span> <strong>C</strong> crouch <span>·</span> <strong>SPACE</strong> jump <span>·</span> <strong>R</strong> roll <span>·</span> <strong>E</strong> door <span>·</span> click to swing</div>
      <small>SEED {seed} · ORTHOGRAPHIC {Math.round(WORLD_3D.elevationRadians * 180 / Math.PI)}° · {stats.entities ?? '—'} objects · {stats.drawCalls ?? '—'} draws · {stats.cpuFrameMs ?? '—'} ms CPU</small></footer>
  </main>;
}
