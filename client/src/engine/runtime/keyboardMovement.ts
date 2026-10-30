/** Keyboard sprint is held, including while auto-walking. */
export function keyboardMovement(keys: ReadonlySet<string>, autoDirection: {x: number; y: number} | null) {
  let x=Number(keys.has('KeyD') || keys.has('ArrowRight'))-Number(keys.has('KeyA') || keys.has('ArrowLeft'));
  let y=Number(keys.has('KeyS') || keys.has('ArrowDown'))-Number(keys.has('KeyW') || keys.has('ArrowUp'));
  const hasMovementKeys=['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].some(key=>keys.has(key));
  if (!hasMovementKeys && autoDirection) { x=autoDirection.x; y=autoDirection.y; }
  else if (x && y) { const magnitude=Math.hypot(x,y); x/=magnitude; y/=magnitude; }
  return { direction:{x:Math.abs(x)<.001?0:Number(x.toFixed(3)),y:Math.abs(y)<.001?0:Number(y.toFixed(3))},
    sprinting:keys.has('ShiftLeft') || keys.has('ShiftRight') };
}
