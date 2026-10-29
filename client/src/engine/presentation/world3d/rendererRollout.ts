// A new key prevents the previous migration experiment's stored legacy choice
// from silently selecting the old renderer on the plain address.
const SESSION_KEY = 'broth:world-presentation-choice-v2';

/** WebGPU is the default; the old world is available only by explicit choice. */
export function resolveWorldRenderer(search: string, storage: Pick<Storage, 'getItem' | 'setItem'>): 'webgpu' | 'legacy' {
  const requested = new URLSearchParams(search).get('worldRenderer');
  if (requested === 'webgpu' || requested === 'legacy') {
    try { storage.setItem(SESSION_KEY, requested); } catch { /* Session storage can be unavailable. */ }
    return requested;
  }
  try { return storage.getItem(SESSION_KEY) === 'legacy' ? 'legacy' : 'webgpu'; }
  catch { return 'webgpu'; }
}

/** Engine-owned selection; UI components and the app entry stay intact. */
export function isWebGpuWorldEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try { return resolveWorldRenderer(window.location.search, window.sessionStorage) === 'webgpu'; }
  catch { return new URLSearchParams(window.location.search).get('worldRenderer') !== 'legacy'; }
}

// Remember a choice before an authentication redirect changes the URL.
isWebGpuWorldEnabled();
