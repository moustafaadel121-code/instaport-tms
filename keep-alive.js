/**
 * InstaPort TMS — keep-alive supervisor
 *
 * Runs the server and restarts it whenever it stops: a crash, an unhandled
 * error, a killed process, a machine that went to sleep. Backs off if it is
 * failing repeatedly so a broken build does not spin the CPU, and writes
 * what happened to server.log so a restart at 3am is explainable.
 *
 *   node keep-alive.js
 *
 * To have it start with Windows, run install-autostart.ps1 once.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');

const ROOT     = __dirname;
const ENTRY    = path.join(ROOT, 'server.js');
const LOG      = path.join(ROOT, 'server.log');
const PORT     = process.env.PORT || 7434;

const MIN_WAIT = 1000;      // first retry
const MAX_WAIT = 30000;     // never wait longer than this
const HEALTHY  = 60000;     // ran this long => treat the next crash as fresh

let wait = MIN_WAIT;
let child = null;
let stopping = false;

function log(line) {
  const stamp = new Date().toISOString();
  const text  = `[${stamp}] ${line}\n`;
  process.stdout.write(text);
  try { fs.appendFileSync(LOG, text); } catch (e) { /* logging must never kill us */ }
}

function rotateLogIfBig() {
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 5 * 1024 * 1024) {
      fs.renameSync(LOG, LOG.replace(/\.log$/, '.1.log'));
    }
  } catch (e) { /* ignore */ }
}

// Whatever is already holding the port is a leftover from a previous run —
// two servers on one port means neither serves reliably, so clear it first.
function freePort(cb) {
  if (process.platform !== 'win32') return cb();
  const { exec } = require('child_process');
  exec('netstat -ano -p tcp | findstr :' + PORT + ' | findstr LISTENING', (err, out) => {
    const pids = new Set();
    String(out || '').split('\n').forEach(line => {
      const m = line.trim().match(/(\d+)\s*$/);
      if (m && +m[1] !== process.pid) pids.add(m[1]);
    });
    if (!pids.size) return cb();
    const list = [...pids];
    log('port ' + PORT + ' held by pid(s) ' + list.join(',') + ' — clearing');
    exec('taskkill /F ' + list.map(p => '/PID ' + p).join(' '), () => setTimeout(cb, 900));
  });
}

function start() {
  if (stopping) return;
  rotateLogIfBig();
  freePort(function () { if (!stopping) spawnServer(); });
}

function spawnServer() {
  const startedAt = Date.now();

  child = spawn(process.execPath, [ENTRY], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  log(`server started (pid ${child.pid}) on port ${PORT}`);

  child.stdout.on('data', d => { try { fs.appendFileSync(LOG, d); } catch (e) {} });
  child.stderr.on('data', d => { try { fs.appendFileSync(LOG, d); } catch (e) {} });

  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) return;
    const ranFor = Date.now() - startedAt;
    // A server that stayed up is allowed a fast restart; one that dies
    // immediately is probably broken, so back off before trying again.
    if (ranFor > HEALTHY) wait = MIN_WAIT;
    log(`server exited (code ${code}${signal ? ', signal ' + signal : ''}) after ${Math.round(ranFor / 1000)}s — restarting in ${wait}ms`);
    setTimeout(start, wait);
    wait = Math.min(wait * 2, MAX_WAIT);
  });

  child.on('error', err => {
    log(`failed to spawn server: ${err.message}`);
  });
}

// Ctrl+C and service stop should take the server down with us, once.
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(sig => {
  process.on(sig, () => {
    stopping = true;
    log(`supervisor received ${sig} — shutting down`);
    if (child) { try { child.kill(); } catch (e) {} }
    process.exit(0);
  });
});

// The supervisor itself must never die on an unexpected error.
process.on('uncaughtException', err => log(`supervisor error: ${err && err.stack || err}`));
process.on('unhandledRejection', err => log(`supervisor rejection: ${err}`));

log('─────────────────────────────────────────────');
log(`keep-alive supervising ${ENTRY}`);
start();
