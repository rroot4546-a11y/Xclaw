#!/usr/bin/env node
/*
 * Xclaw gateway
 * Serves the Xclaw web UI, exposes agent + update APIs. Runs inside the
 * Termux prefix env.
 *
 * Endpoints:
 *   GET  /                     Xclaw web UI (RTL, dark)
 *   GET  /api/status           installed versions + cached update info
 *   POST /api/check            check npm/GitHub for tool updates (SSE-ish JSON)
 *   POST /api/agent/run        run an agent CLI, streaming output (SSE)
 *   POST /api/update           npm install -g <pkg>@latest, streaming (SSE)
 */
'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

const args = JSON.parse(JSON.stringify(process.argv.slice(2)));
const portIdx = args.indexOf('--port');
const PORT = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : 18925;

const PREFIX = process.env.PREFIX || '/data/user/0/com.xclaw.app/files/usr';
const HOME = process.env.HOME || '/data/user/0/com.xclaw.app/files/home';
const WEB_DIR = path.join(__dirname, process.env.XCLAW_WEB_DIR || 'xclaw-web');
const CACHE_DIR = path.join(HOME, '.xclaw');
const CACHE_FILE = path.join(CACHE_DIR, 'updates.json');

const AGENTS = [
  { key: 'opencode', label: 'OpenCode',  cmd: 'opencode', pkg: 'opencode-ai',           args: (p) => ['run', p] },
  { key: 'claude',   label: 'Claude',    cmd: 'claude',   pkg: '@anthropic-ai/claude-code', args: (p) => ['-p', p] },
  { key: 'openclaw', label: 'OpenClaw',  cmd: 'claw',     pkg: 'openclaw',              args: (p) => ['exec', p] },
];

const NPM = path.join(PREFIX, 'lib/node_modules/npm/bin/npm-cli.js');

function out(ev) {
  return `data: ${JSON.stringify(ev)}\n\n`;
}

/**
 * Resolve an agent's entry so we run it with `node <pkg-entry>` instead of
 * relying on npm bin links (npm bin shebangs often break on Android).
 */
function resolveEntry(agent) {
  try {
    const pkgDir = path.join(PREFIX, 'lib/node_modules', agent.pkg);
    const pj = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    let bin = pj.bin;
    let file = null;
    if (typeof bin === 'string') file = bin;
    else if (bin) file = bin[agent.key] || bin[agent.cmd] || Object.values(bin)[0];
    if (file) {
      const abs = path.join(pkgDir, file);
      if (fs.existsSync(abs)) {
        return { via: 'node', node: path.join(PREFIX, 'bin/node'), args: [abs], dir: pkgDir };
      }
    }
  } catch {}
  return { via: 'path', node: agent.cmd, args: [], dir: HOME };
}

function runCmd(agent, cliArgs, timeoutMs = 8000) {
  const e = resolveEntry(agent);
  try {
    const r = spawnSync(e.node, e.args.concat(cliArgs), {
      env: process.env,
      encoding: 'utf8',
      timeout: timeoutMs,
      cwd: e.dir,
    });
    if (r.error) return { ok: false, version: null, error: r.error.message };
    const text = (r.stdout || '').trim();
    return { ok: r.status === 0, version: text || null, error: null };
  } catch (err) {
    return { ok: false, version: null, error: err.message };
  }
}

function installedVersion(agent) {
  const r = runCmd(agent, ['--version']);
  return r.ok ? r.version : null;
}

async function latestNpm(pkg) {
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
      headers: { 'User-Agent': 'Xclaw' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.version || null;
  } catch {
    return null;
  }
}

async function latestOpenClaw() {
  try {
    const res = await fetch(
      'https://api.github.com/repos/openclaw/openclaw/releases/latest',
      { headers: { 'User-Agent': 'Xclaw' } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data.tag_name || data.name || '').replace(/^v/, '') || null;
  } catch {
    return null;
  }
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeCache(cache) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {}
}

async function checkUpdates() {
  const cache = readCache();
  cache.checkedAt = new Date().toISOString();
  const results = {};
  for (const a of AGENTS) {
    results[a.key] = a.key === 'openclaw' ? await latestOpenClaw() : await latestNpm(a.pkg);
  }
  cache.latest = results;
  writeCache(cache);
  return results;
}

function semverCompare(a, b) {
  const pa = (String(a || '').match(/\d+(\.\d+)*/) || ['0'])[0].split('.').map(Number);
  const pb = (String(b || '').match(/\d+(\.\d+)*/) || ['0'])[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

function statusPayload() {
  const cache = readCache();
  const agents = AGENTS.map((a) => ({
    key: a.key,
    label: a.label,
    pkg: a.pkg,
    installed: installedVersion(a),
  }));
  const updates = [];
  for (const a of AGENTS) {
    const cur = (agents.find((x) => x.key === a.key) || {}).installed;
    const latest = cache.latest ? cache.latest[a.key] : null;
    const available = latest && cur && semverCompare(cur, latest) < 0;
    updates.push({ key: a.key, label: a.label, pkg: a.pkg, current: cur, latest, available });
  }
  return {
    app: { name: 'Xclaw', version: process.env.XCLAW_APP_VERSION || '1.0.0' },
    checkedAt: cache.checkedAt || null,
    agents,
    updates,
  };
}

async function handleAgentRun(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    res.writeHead(400); res.end('{"error":"bad json"}'); return;
  }
  const agent = AGENTS.find((x) => x.key === payload.tool);
  if (!agent) {
    res.writeHead(404); res.end('{"error":"unknown tool"}'); return;
  }
  const prompt = String(payload.prompt || '').trim();
  if (!prompt) {
    res.writeHead(400); res.end('{"error":"empty prompt"}'); return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(out({ type: 'start', tool: agent.key }));

  const spawnCmd = (function () { const r = resolveEntry(agent); return r.node; })();
  const spawnArgs = (function () { const r = resolveEntry(agent); return r.args.concat(agent.args(prompt)); })();
  const child = spawn(spawnCmd, spawnArgs, { env: process.env, cwd: HOME });
  let killed = false;

  const send = (ev) => { if (!res.writableEnded && !killed) res.write(out(ev)); };

  child.stdout.on('data', (d) => send({ type: 'out', text: d.toString() }));
  child.stderr.on('data', (d) => send({ type: 'out', text: d.toString() }));
  child.on('error', (e) => send({ type: 'error', text: e.message }));

  res.on('close', () => {
    killed = true;
    try { child.kill('SIGKILL'); } catch {}
  });

  child.on('close', (code) => send({ type: 'done', code }));
}

async function handleUpdate(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    res.writeHead(400); res.end('{"error":"bad json"}'); return;
  }
  const pkg = String(payload.pkg || '');
  if (!pkg) {
    res.writeHead(400); res.end('{"error":"missing pkg"}'); return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(out({ type: 'start', pkg }));

  const child = spawn(process.env.PREFIX ? path.join(PREFIX, 'bin/node') : 'node', [NPM, 'install', '-g', `${pkg}@latest`], {
    env: process.env,
    cwd: HOME,
  });
  let killed = false;
  const send = (ev) => { if (!res.writableEnded && !killed) res.write(out(ev)); };
  child.stdout.on('data', (d) => send({ type: 'out', text: d.toString() }));
  child.stderr.on('data', (d) => send({ type: 'out', text: d.toString() }));
  child.on('error', (e) => send({ type: 'error', text: e.message }));
  res.on('close', () => { killed = true; try { child.kill('SIGKILL'); } catch {} });
  child.on('close', (code) => send({ type: 'done', code }));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(WEB_DIR, safe);
  if (!file.startsWith(WEB_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('404'); return;
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;

  try {
    if (p === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(statusPayload()));
      return;
    }
    if (p === '/api/check') {
      const latest = await checkUpdates();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, latest, payload: statusPayload() }));
      return;
    }
    if (p === '/api/agent/run') { await handleAgentRun(req, res); return; }
    if (p === '/api/update') { await handleUpdate(req, res); return; }
    serveStatic(req, res, p);
  } catch (e) {
    res.writeHead(500); res.end(String(e && e.message ? e.message : e));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[xclaw] gateway listening on 127.0.0.1:${PORT}`);
});