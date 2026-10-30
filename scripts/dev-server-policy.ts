import type { Plugin } from 'vite';

/** Chokidar can report native Windows paths as well as normalized paths. */
export function isDevWatchIgnored(path:string):boolean {
  return /(^|[\\/])(?:target|\.local-spacetimedb|\.cache|\.venv|__pycache__)([\\/]|$)/.test(path);
}

/** A failed file watch must not take the HTTP and WebSocket servers down. */
export function resilientDevWatcher():Plugin {
  return {
    name:'resilient-local-file-watcher',
    apply:'serve',
    configureServer(server) {
      server.watcher.on('error',(error:Error)=>{
        const failure=error as Error & {code?:string;path?:string;filename?:string};
        const path=failure.path??failure.filename;
        if(path&&isDevWatchIgnored(path)) {
          server.watcher.unwatch(path);
          server.config.logger.warn(`[dev] Ignoring locked build output (${failure.code??'watch error'}): ${path}`);
        } else {
          server.config.logger.error(`[dev] File watcher error; web server remains available: ${failure.message}`);
        }
      });
    },
  };
}
