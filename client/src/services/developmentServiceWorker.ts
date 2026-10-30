/** Remove only this game's local worker; production asset caching stays enabled. */
export async function clearDevelopmentServiceWorker():Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registrations=await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.filter(registration=>{
    const worker=registration.active??registration.waiting??registration.installing;
    if(!worker)return false;
    const url=new URL(worker.scriptURL);
    return url.origin===window.location.origin&&url.pathname==='/sw.js';
  }).map(registration=>registration.unregister()));
  if('caches' in window) {
    const names=await caches.keys();
    await Promise.all(names.filter(name=>name.startsWith('game-assets-')).map(name=>caches.delete(name)));
  }
}
