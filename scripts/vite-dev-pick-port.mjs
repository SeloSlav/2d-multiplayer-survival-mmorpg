/**
 * Picks the first TCP port >= START where neither IPv4 nor IPv6 loopback is in use,
 * then execs Vite with --strictPort. Avoids Windows/macOS cases where one stack is
 * busy but Vite quietly binds the other and still prints :3008.
 */
import net from 'node:net';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const LOOPBACK_HOSTS = ['127.0.0.1', '::1'];
const START_PORT = Number.parseInt(process.env.DEV_PORT ?? '3009', 10);
// Keep the advertised game URL stable. Port scanning is an explicit opt-in.
const MAX_TRIES = Number.parseInt(process.env.DEV_PORT_TRIES ?? '1', 10);

function tryListen(port, host) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', (err) => {
      srv.close();
      if (err.code === 'EADDRINUSE') resolve(false);
      else reject(err);
    });
    srv.listen(port, host, () => {
      srv.close(() => resolve(true));
    });
  });
}

/** Port is free only if we can bind it on every loopback address we probe. */
async function isLoopbackPortFree(port) {
  for (const host of LOOPBACK_HOSTS) {
    try {
      const ok = await tryListen(port, host);
      if (!ok) return false;
    } catch (err) {
      if (err.code === 'EADDRNOTAVAIL' || err.code === 'EINVAL') {
        // IPv6 may be disabled; skip that probe.
        continue;
      }
      throw err;
    }
  }
  return true;
}

async function pickPort() {
  for (let i = 0; i < MAX_TRIES; i++) {
    const port = START_PORT + i;
    if (await isLoopbackPortFree(port)) return port;
  }
  throw new Error(
    `No free dev port found between ${START_PORT} and ${START_PORT + MAX_TRIES - 1}`
  );
}

const port = await pickPort();
if (port !== START_PORT) {
  console.info(`[dev] Port ${START_PORT} is in use; starting Vite on ${port}`);
}
const viteJs = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
let child, stopping=false, restarts=0;
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{stopping=true;child?.kill(signal);});
while(!stopping) {
  const started=Date.now();
  child=spawn(process.execPath,[viteJs,'--port',String(port),'--strictPort'],
    {stdio:'inherit',cwd:process.cwd(),env:process.env});
  const {code,signal}=await new Promise((resolve,reject)=>{
    child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));
  });
  if(stopping||signal||code===0){process.exitCode=code??0;break;}
  if(Date.now()-started>60000)restarts=0;
  if(++restarts>5){process.exitCode=code??1;break;}
  const delay=Math.min(1000*2**(restarts-1),10000);
  console.error(`[dev] Web server exited (${code}); restarting on the same port ${port} in ${delay/1000}s (${restarts}/5).`);
  await new Promise(resolve=>setTimeout(resolve,delay));
}
