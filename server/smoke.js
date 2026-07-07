import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scorekeeper-'));
const dbPath = path.join(tmp, 'scorekeeper.sqlite');
const port = 39231;
const child = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, SESSION_SECRET: 'smoke-secret' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
child.stdout.on('data', (chunk) => { serverLog += chunk; });
child.stderr.on('data', (chunk) => { serverLog += chunk; });

const base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(pathname, options = {}) {
  const res = await fetch(base + pathname, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${body.error?.message || 'request failed'}\n${serverLog}`);
  return body.data;
}

try {
  for (let i = 0; i < 50; i += 1) {
    try {
      await fetch(base + '/api/sessions/history');
      break;
    } catch {
      await wait(100);
    }
  }

  const created = await request('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ name: 'smoke', type: 'boardgame', adminPin: '1234', players: ['A', 'B'] })
  });
  const code = created.session.roomCode;
  const admin = created.token;
  const a = created.players[0];
  const b = created.players[1];
  const joined = await request(`/api/sessions/${code}/join`, {
    method: 'POST',
    body: JSON.stringify({ playerId: a.id })
  });
  await assert.rejects(() => request(`/api/sessions/${code}/players/${b.id}/score`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${joined.token}` },
    body: JSON.stringify({ delta: 1 })
  }));
  let state = await request(`/api/sessions/${code}/players/${b.id}/score`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${admin}` },
    body: JSON.stringify({ delta: 5 })
  });
  assert.equal(state.players.find((p) => p.id === b.id).score, 5);
  state = await request(`/api/sessions/${code}/undo`, {
    method: 'POST',
    headers: { authorization: `Bearer ${admin}` }
  });
  assert.equal(state.players.find((p) => p.id === b.id).score, 0);
  console.log('smoke ok');
} finally {
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    wait(1000)
  ]);
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // ponytail: Windows can hold the sqlite file briefly; tmp cleanup is best effort.
  }
}
