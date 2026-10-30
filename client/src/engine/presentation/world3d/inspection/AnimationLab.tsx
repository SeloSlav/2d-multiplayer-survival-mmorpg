import React, { useEffect, useRef, useState } from 'react';
import { WebGpuWorldRenderer } from '../WebGpuWorldRenderer';
import { createInspectionWorld, INSPECTION_WEAPONS } from '../inspectionWorld';
import type { InspectionScene } from '../inspectionWorld';
import type { PresentationEntity as Row } from '../presentationEntity';
import type { PresentationStatus, VisualDebugMode } from '../visualContract';
import { clearActorInteraction, recordActorInteraction } from '../interactionAnimation';
import { recordWorldExplosion } from '../presentationEffectEvents';
import { recordPredictedRangedShot } from '../actorAnimation';
import type { InteractionKind } from '../actorAnimation';
import './EngineLab.css';

const ACTIONS = ['idle', 'fire', 'reload', 'bow-draw', 'gather', 'eat', 'drink', 'bandage', 'fish-cast', 'fish-reel', 'knockdown', 'recover', 'death', 'walk', 'sprint', 'snow-steps', 'jump', 'enter-water', 'animal-idle', 'animal-alert', 'animal-attack', 'projectiles', 'explosive-fuse', 'explosion', 'player-corpse'];
const SCENES: InspectionScene[] = ['equipment', 'world', 'trees-1', 'trees-2', 'plants-crops', 'plants-herbs', 'wildlife-1', 'wildlife-2', 'terrain'];
const timestamp = (ms: number) => ({ microsSinceUnixEpoch: BigInt(Math.floor(ms)) * 1000n });

/** Independent development entry. Every mesh, pose and effect comes from the
 * production renderer; only the authoritative event fixture is synthetic. */
export default function AnimationLab() {
  const query = new URLSearchParams(window.location.search), canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<PresentationStatus>({ phase: 'initializing', message: 'Starting WebGPU…' });
  const [action, setAction] = useState(query.get('action') ?? 'idle');
  const [weapon, setWeapon] = useState(query.get('weapon') ?? 'PP-91 KEDR');
  const [scene, setScene] = useState<InspectionScene>((query.get('scene') ?? 'equipment') as InspectionScene);
  const [fixed, setFixed] = useState(query.has('frameMs'));
  const [frameMs, setFrameMs] = useState(Number(query.get('frameMs') ?? 350));
  const [zoom, setZoom] = useState(Number(query.get('zoom') ?? 1.6));
  const [seed, setSeed] = useState(Number(query.get('seed') ?? 73021));
  const [storm, setStorm] = useState(query.has('storm'));
  const [view, setView] = useState<VisualDebugMode>('lit');
  const [metrics, setMetrics] = useState('');
  const settings = useRef({ action, weapon, fixed, frameMs, zoom, storm, view });
  settings.current = { action, weapon, fixed, frameMs, zoom, storm, view };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new WebGpuWorldRenderer(canvas, setStatus);
    const tables = createInspectionWorld(seed, scene), id = 'inspection-survivor';
    const player = tables.players.get(id)! as Row;
    const equipment = tables.activeEquipments.get(id)! as Row;
    const extras = { activeConsumableEffects: new Map<string, Row>(), fishingSessions: new Map<string, Row>(), rangedWeaponStats: new Map<string, Row>(), chunkWeather: new Map(),
      projectiles: new Map<string, unknown>(), placedExplosives: new Map<string, Row>(), playerCorpses: new Map<string, Row>() };
    const originalTerrain = new Map([...tables.visibleWorldTiles].map(([key, tile]) => [key, tile.tileType]));
    const baseX = player.positionX ?? 960, baseY = player.positionY ?? 792;
    let raf = 0, previous = performance.now(), time = 0, metricsAt = 0, previousAction = '', recoveryFrames = 0;
    const tick = (now: number) => {
      const options = settings.current, dt = Math.min(.05, (now - previous) / 1000); previous = now;
      time += dt;
      const elapsed = options.fixed ? options.frameMs : time * 1000 % 4000;
      const epoch = 1800000000000 + (options.fixed ? options.frameMs : time * 1000);
      if (previousAction !== options.action) {
        clearActorInteraction(id); recoveryFrames = 0; delete canvas.dataset.localPose;
        for (const [key, tile] of tables.visibleWorldTiles) tile.tileType = options.action === 'snow-steps' ? { tag: 'Alpine' }
          : options.action === 'enter-water' || options.action.startsWith('fish')
            ? { tag: (tile.worldX ?? 0) >= (options.action === 'enter-water' ? 20 : 22) ? 'Sea' : 'Beach' } : originalTerrain.get(key);
        previousAction = options.action;
      }
      const selected = options.action === 'bow-draw' ? 'Hunting Bow' : options.action.startsWith('fish') ? 'Primitive Reed Fishing Rod' : options.weapon;
      const itemId = INSPECTION_WEAPONS.indexOf(selected) + 1;
      equipment.equippedItemDefId = BigInt(Math.max(1, itemId));
      equipment.loadedAmmoCount = 1; equipment.isReadyToFire = true;
      equipment.swingStartTimeMs = options.action === 'fire' ? BigInt(Math.floor(epoch - elapsed % 500)) : 0n;
      if (options.action === 'fire') recordPredictedRangedShot(id, `fixture-shot-${equipment.swingStartTimeMs}`, Number(equipment.swingStartTimeMs));
      equipment.reloadStartTimeMs = options.action === 'reload' || options.action === 'bow-draw' ? BigInt(Math.floor(epoch - elapsed)) : 0n;
      extras.rangedWeaponStats.set(selected, { itemName: selected, reloadTimeSecs: 2, magazineReloadTimeSecs: 2 });
      extras.activeConsumableEffects.clear(); extras.fishingSessions.clear(); extras.chunkWeather.clear(); extras.projectiles.clear(); extras.placedExplosives.clear(); extras.playerCorpses.clear();
      if (options.storm) extras.chunkWeather.set('fixture', { rainIntensity: 1, currentWeather: { tag: 'HeavyStorm' } });
      player.positionX = baseX; player.positionY = baseY; player.direction = 'right'; player.isCrouching = false;
      player.isDead = options.action === 'death';
      player.isKnockedOut = options.action === 'knockdown' || options.action === 'recover' && (options.fixed ? recoveryFrames === 0 : time % 4 < .8);
      player.deathTimestamp = timestamp(epoch - elapsed); player.knockedOutAt = timestamp(epoch - (options.action === 'recover' ? 2000 : elapsed));
      const jumpElapsed = options.fixed && options.action === 'jump' && recoveryFrames === 0 ? 200 : elapsed % 1800;
      player.jumpStartTimeMs = options.action === 'jump' ? BigInt(Math.floor(epoch - jumpElapsed)) : 0n;
      player.isOnWater = options.action === 'enter-water' && elapsed > 700 && (!options.fixed || recoveryFrames > 0);
      player.isSprinting = options.action === 'sprint';
      if (['walk', 'sprint', 'snow-steps'].includes(options.action)) player.positionX = baseX + Math.sin((options.fixed ? elapsed / 1000 : time) * .6) * (options.action === 'sprint' ? 480 : 180);
      if (options.action === 'enter-water') player.positionX = baseX + (elapsed / 1000 - .7) * 90;
      if (['gather', 'eat', 'drink', 'bandage'].includes(options.action)) recordActorInteraction(id, options.action as InteractionKind, epoch - elapsed, 1800);
      if (options.action.startsWith('fish')) extras.fishingSessions.set(id, {
        isActive: true, castTime: timestamp(epoch - (options.action === 'fish-reel' ? 2000 : elapsed)), hasBite: options.action === 'fish-reel', fishingRod: selected,
        targetX: baseX + 180, targetY: baseY + 40,
      });
      for (const animal of tables.wildAnimals.values()) {
        animal.state = { tag: options.action === 'animal-alert' ? 'Investigating' : options.action === 'animal-attack' ? 'Attacking' : 'Idle' };
        animal.lastAttackTime = options.action === 'animal-attack' ? timestamp(epoch - elapsed % 1600) : undefined;
        const row = animal as unknown as Row; row.stateChangeTime = timestamp(epoch - 1000); row.investigationX = player.positionX; row.investigationY = player.positionY;
      }
      if (options.action === 'projectiles') {
        const defs = [{ name: 'Makarov PM' }, { name: 'Hunting Bow' }, { name: 'Fire Arrow' }, { name: 'Grenade' }];
        defs.forEach((definition, index) => tables.itemDefinitions.set(String(1000 + index), definition));
        for (let i = 0; i < 7; i++) extras.projectiles.set(`projectile-${i}`, {
          id: BigInt(i), clientShotId: `fixture-${i}`, ownerId: { toHexString: () => '' }, itemDefId: BigInt(i === 0 ? 1000 : i === 2 ? 1003 : 1001), ammoDefId: BigInt(i === 2 ? 1003 : 1002),
          sourceType: i > 2 ? 2 : 0, npcProjectileType: i > 2 ? (i - 3) % 3 + 1 : 0, startTime: timestamp(epoch - elapsed % 1600),
          startPosX: baseX - 180, startPosY: baseY - 180 + i * 48, velocityX: 250, velocityY: 0, maxRange: 800,
        });
      }
      if (options.action === 'explosive-fuse') for (let i = 0; i < 2; i++) extras.placedExplosives.set(`bomb-${i}`, {
        posX: baseX + (i ? 100 : -100), posY: baseY, explosiveType: { tag: i ? 'MatriarchWrath' : 'BabushkaSurprise' },
        armedAt: timestamp(epoch - 2000), detonatesAt: timestamp(epoch + 3000), isDud: false,
      });
      if (options.action === 'explosion') recordWorldExplosion(`fixture-explosion-${options.fixed ? options.frameMs : Math.floor(time / 4)}`, baseX + 80, baseY, 180, true, epoch - elapsed);
      if (options.action === 'player-corpse') extras.playerCorpses.set('fixture-corpse', { posX: baseX + 100, posY: baseY, playerIdentity: 'fixture-dead-owner', health: 100, deathTime: timestamp(epoch - elapsed) });
      renderer.render({ width: window.innerWidth, height: window.innerHeight, tables: { ...tables, ...extras },
        cameraOffset: { x: window.innerWidth / 2 - (scene === 'equipment' ? baseX : 960), y: window.innerHeight / 2 - (scene === 'equipment' ? baseY - 30 : 792) },
        localPlayerId: id, predictedPosition: { x: player.positionX!, y: player.positionY! }, facing: 'right', nowMs: epoch,
        timeSeconds: options.action === 'recover' && options.fixed ? recoveryFrames === 0 ? 0 : recoveryFrames === 1 ? 1 : 1 + options.frameMs / 1000
          : options.action === 'enter-water' && options.fixed ? recoveryFrames === 0 ? .5 : recoveryFrames === 1 ? .7 : Math.max(.7, options.frameMs / 1000)
          : options.action === 'jump' && options.fixed ? recoveryFrames === 0 ? .2 : recoveryFrames === 1 ? .5 : options.frameMs / 1000
          : options.fixed ? options.frameMs / 1000 : time, zoom: options.zoom, debug: options.view, profile: true });
      if (canvas.dataset.localPose) recoveryFrames++;
      canvas.dataset.animationAction = options.action; canvas.dataset.animationFrameMs = String(elapsed);
      if (now - metricsAt > 500) {
        const stats = JSON.parse(canvas.dataset.metrics ?? '{}');
        setMetrics(`WebGPU · CPU ${stats.cpuFrameMs ?? '…'} ms · GPU ${stats.profile?.gpuMs?.toFixed(2) ?? '…'} ms · ${stats.drawCalls ?? '…'} draws · ${stats.entities ?? '…'} entities`);
        metricsAt = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); clearActorInteraction(id); void renderer.dispose(); };
  }, [scene, seed]);

  return <main className="engine-lab">
    <canvas ref={canvasRef} aria-label="Production animation inspection" />
    <header className="engine-lab-header"><div><span className="engine-lab-eyebrow">BROTH & BULLETS · ANIMATION INSPECTION</span><h1>Motion & feedback.</h1><p>Production models · deterministic event fixtures.</p></div><span className={`engine-lab-backend ${status.phase}`}>{status.phase}</span></header>
    {status.phase === 'error' && <div className="engine-lab-status" role="alert">{status.message}</div>}
    <aside className="engine-lab-controls">
      <label>SCENE <select aria-label="Animation scene" value={scene} onChange={e => setScene(e.target.value as InspectionScene)}>{SCENES.map(name => <option key={name}>{name}</option>)}</select></label>
      <label>ACTION <select aria-label="Animation action" value={action} onChange={e => setAction(e.target.value)}>{ACTIONS.map(name => <option key={name}>{name}</option>)}</select></label>
      <label>WEAPON <select aria-label="Animation weapon" value={weapon} onChange={e => setWeapon(e.target.value)}>{INSPECTION_WEAPONS.map(name => <option key={name}>{name}</option>)}</select></label>
      <label>FRAME <input aria-label="Animation frame milliseconds" type="range" min="0" max="2500" step="10" value={frameMs} onChange={e => { setFrameMs(Number(e.target.value)); setFixed(true); }} /></label>
      <button onClick={() => setFixed(value => !value)}>{fixed ? 'Play timeline' : 'Freeze timeline'}</button>
      <button onClick={() => setStorm(value => !value)}>{storm ? 'Storm' : 'Calm'}</button>
      <label>SCALE <select aria-label="Animation scale" value={zoom} onChange={e => setZoom(Number(e.target.value))}><option value=".7">Far</option><option value="1">Design</option><option value="1.6">Near</option><option value="2">Detail</option></select></label>
      <label>VIEW <select aria-label="Animation diagnostic" value={view} onChange={e => setView(e.target.value as VisualDebugMode)}>{['lit', 'unlit', 'wireframe', 'fields'].map(name => <option key={name}>{name}</option>)}</select></label>
      <label>SEED <select aria-label="Animation seed" value={seed} onChange={e => setSeed(Number(e.target.value))}>{[73021, 147, 4294967295].map(value => <option key={value}>{value}</option>)}</select></label>
    </aside><footer className="engine-lab-footer"><small>{metrics}</small></footer>
  </main>;
}

