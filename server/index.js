import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { Server } from 'socket.io';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 3000);
const dbPath = process.env.DATABASE_PATH || path.join(root, 'data', 'scorekeeper.sqlite');
const secret = process.env.SESSION_SECRET || 'dev-secret-change-me';

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);

db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT,
  admin_pin_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE(session_id, name)
);
CREATE INDEX IF NOT EXISTS idx_players_session_id ON players(session_id);

CREATE TABLE IF NOT EXISTS score_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  operator_type TEXT NOT NULL,
  operator_player_id INTEGER,
  target_player_id INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  score_before INTEGER NOT NULL,
  score_after INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY(operator_player_id) REFERENCES players(id) ON DELETE SET NULL,
  FOREIGN KEY(target_player_id) REFERENCES players(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_score_events_session_id ON score_events(session_id, id);
CREATE INDEX IF NOT EXISTS idx_score_events_target_player_id ON score_events(target_player_id);
`);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

app.use(express.json({ limit: '64kb' }));

function now() {
  return new Date().toISOString();
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function cleanRoomCode(value) {
  const code = String(value || '').trim();
  if (!/^\d+$/.test(code)) fail(400, '房间码必须是场次 ID');
  return code;
}

function text(value, name, max) {
  const v = String(value || '').trim();
  if (!v || v.length > max) fail(400, `${name}不能为空，且不能超过 ${max} 个字符`);
  return v;
}

function int(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n)) fail(400, `${name}必须是整数`);
  return n;
}

function sign(payload) {
  return jwt.sign(payload, secret, { expiresIn: '30d' });
}

function auth(req, _res, next) {
  const header = req.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return next();
  try {
    req.user = jwt.verify(header.slice(7), secret);
  } catch {
    req.user = null;
  }
  next();
}

app.use(auth);

function requireUser(req, roomCodeValue) {
  if (!req.user || req.user.roomCode !== roomCodeValue) fail(401, '请先进入该场次');
  return req.user;
}

function requireAdmin(req, roomCodeValue) {
  const user = requireUser(req, roomCodeValue);
  if (user.role !== 'admin') fail(403, '需要管理员权限');
  return user;
}

function loadSession(roomCodeValue) {
  const session = db.prepare('SELECT * FROM sessions WHERE room_code = ?').get(roomCodeValue);
  if (!session) fail(404, '场次不存在');
  return session;
}

function publicSession(session) {
  return {
    id: session.id,
    roomCode: session.room_code,
    name: session.name,
    type: session.type,
    status: session.status,
    createdAt: session.created_at,
    updatedAt: session.updated_at
  };
}

function state(roomCodeValue) {
  const session = loadSession(roomCodeValue);
  const players = db.prepare(`
    SELECT id, name, score, created_at AS createdAt, updated_at AS updatedAt
    FROM players WHERE session_id = ? ORDER BY id
  `).all(session.id);
  return { session: publicSession(session), players };
}

function touch(sessionId) {
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now(), sessionId);
}

function broadcast(roomCodeValue) {
  io.to(roomCodeValue).emit('session:updated', state(roomCodeValue));
}

function tokenForPlayer(session, playerId) {
  return sign({ role: 'player', roomCode: session.room_code, sessionId: session.id, playerId });
}

function tokenForAdmin(session) {
  return sign({ role: 'admin', roomCode: session.room_code, sessionId: session.id });
}

app.post('/api/sessions', (req, res) => {
  const name = text(req.body.name, '场次名称', 80);
  const type = String(req.body.type || 'other').trim().slice(0, 40) || 'other';
  const pin = text(req.body.adminPin, '管理员 PIN', 32);
  if (pin.length < 4) fail(400, '管理员 PIN 至少 4 位');
  const names = [...new Set((req.body.players || []).map((p) => String(p || '').trim()).filter(Boolean))];
  if (names.some((p) => p.length > 30)) fail(400, '玩家名称不能超过 30 个字符');

  const created = now();
  let code = '';
  transaction(() => {
    const info = db.prepare(`
      INSERT INTO sessions (room_code, name, type, admin_pin_hash, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).run(`pending-${Date.now()}`, name, type, bcrypt.hashSync(pin, 10), created, created);
    code = String(info.lastInsertRowid);
    db.prepare('UPDATE sessions SET room_code = ? WHERE id = ?').run(code, info.lastInsertRowid);
    for (const playerName of names) {
      db.prepare(`
        INSERT INTO players (session_id, name, score, created_at, updated_at)
        VALUES (?, ?, 0, ?, ?)
      `).run(info.lastInsertRowid, playerName, created, created);
    }
  });
  const session = loadSession(code);
  res.status(201).json({ data: { ...state(code), token: tokenForAdmin(session), role: 'admin' } });
});

app.get('/api/sessions/history', (_req, res) => {
  const rows = db.prepare(`
    SELECT s.room_code AS roomCode, s.name, s.type, s.status,
      s.created_at AS createdAt, s.updated_at AS updatedAt, COUNT(p.id) AS playerCount
    FROM sessions s
    LEFT JOIN players p ON p.session_id = s.id
    GROUP BY s.id
    ORDER BY s.updated_at DESC
    LIMIT 50
  `).all();
  res.json({ data: rows });
});

app.get('/api/sessions/:roomCode', (req, res) => {
  res.json({ data: state(cleanRoomCode(req.params.roomCode)) });
});

app.post('/api/sessions/:roomCode/join', (req, res) => {
  const code = cleanRoomCode(req.params.roomCode);
  const session = loadSession(code);
  const playerId = int(req.body.playerId, 'playerId');
  const player = db.prepare('SELECT id FROM players WHERE id = ? AND session_id = ?').get(playerId, session.id);
  if (!player) fail(404, '玩家不存在');
  res.json({ data: { token: tokenForPlayer(session, playerId), role: 'player', playerId } });
});

app.post('/api/sessions/:roomCode/admin-login', (req, res) => {
  const code = cleanRoomCode(req.params.roomCode);
  const session = loadSession(code);
  if (!bcrypt.compareSync(String(req.body.adminPin || ''), session.admin_pin_hash)) fail(401, '管理员 PIN 错误');
  res.json({ data: { token: tokenForAdmin(session), role: 'admin' } });
});

app.post('/api/sessions/:roomCode/players', (req, res) => {
  const code = cleanRoomCode(req.params.roomCode);
  requireAdmin(req, code);
  const session = loadSession(code);
  const name = text(req.body.name, '玩家名称', 30);
  const created = now();
  try {
    db.prepare(`
      INSERT INTO players (session_id, name, score, created_at, updated_at)
      VALUES (?, ?, 0, ?, ?)
    `).run(session.id, name, created, created);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) fail(409, '该玩家名称已存在');
    throw err;
  }
  touch(session.id);
  broadcast(code);
  res.status(201).json({ data: state(code) });
});

app.delete('/api/sessions/:roomCode/players/:playerId', (req, res) => {
  const code = cleanRoomCode(req.params.roomCode);
  requireAdmin(req, code);
  const session = loadSession(code);
  const playerId = int(req.params.playerId, 'playerId');
  const used = db.prepare('SELECT 1 FROM score_events WHERE target_player_id = ? OR operator_player_id = ?').get(playerId, playerId);
  if (used) fail(409, '已有计分记录的玩家不能删除');
  const info = db.prepare('DELETE FROM players WHERE id = ? AND session_id = ?').run(playerId, session.id);
  if (!info.changes) fail(404, '玩家不存在');
  touch(session.id);
  broadcast(code);
  res.json({ data: state(code) });
});

app.patch('/api/sessions/:roomCode/players/:playerId/score', (req, res) => {
  const code = cleanRoomCode(req.params.roomCode);
  const user = requireUser(req, code);
  const session = loadSession(code);
  if (session.status !== 'active') fail(409, '场次已结束');
  const playerId = int(req.params.playerId, 'playerId');
  const delta = int(req.body.delta, 'delta');
  if (delta < -9999 || delta > 9999 || delta === 0) fail(400, '分数变化必须在 -9999 到 9999 之间，且不能为 0');
  if (user.role !== 'admin' && user.playerId !== playerId) fail(403, '普通玩家只能修改自己的分数');

  transaction(() => {
    const player = db.prepare('SELECT id, score FROM players WHERE id = ? AND session_id = ?').get(playerId, session.id);
    if (!player) fail(404, '玩家不存在');
    const at = now();
    const next = player.score + delta;
    db.prepare('UPDATE players SET score = ?, updated_at = ? WHERE id = ?').run(next, at, playerId);
    db.prepare(`
      INSERT INTO score_events
        (session_id, operator_type, operator_player_id, target_player_id, delta, score_before, score_after, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(session.id, user.role, user.role === 'player' ? user.playerId : null, playerId, delta, player.score, next, at);
    touch(session.id);
  });

  broadcast(code);
  res.json({ data: state(code) });
});

app.post('/api/sessions/:roomCode/undo', (req, res) => {
  const code = cleanRoomCode(req.params.roomCode);
  requireAdmin(req, code);
  const session = loadSession(code);
  const event = db.prepare('SELECT * FROM score_events WHERE session_id = ? ORDER BY id DESC LIMIT 1').get(session.id);
  if (!event) fail(409, '没有可撤销的分数操作');
  transaction(() => {
    const at = now();
    db.prepare('UPDATE players SET score = ?, updated_at = ? WHERE id = ? AND session_id = ?')
      .run(event.score_before, at, event.target_player_id, session.id);
    db.prepare('DELETE FROM score_events WHERE id = ?').run(event.id);
    touch(session.id);
  });
  broadcast(code);
  res.json({ data: state(code) });
});

app.post('/api/sessions/:roomCode/reset', (req, res) => {
  const code = cleanRoomCode(req.params.roomCode);
  const user = requireAdmin(req, code);
  const session = loadSession(code);
  transaction(() => {
    const at = now();
    const players = db.prepare('SELECT id, score FROM players WHERE session_id = ?').all(session.id);
    for (const player of players) {
      if (player.score === 0) continue;
      db.prepare('UPDATE players SET score = 0, updated_at = ? WHERE id = ?').run(at, player.id);
      db.prepare(`
        INSERT INTO score_events
          (session_id, operator_type, operator_player_id, target_player_id, delta, score_before, score_after, created_at)
        VALUES (?, 'admin', NULL, ?, ?, ?, 0, ?)
      `).run(session.id, player.id, -player.score, player.score, at);
    }
    touch(session.id);
  });
  broadcast(code);
  res.json({ data: state(code) });
});

app.post('/api/sessions/:roomCode/finish', (req, res) => {
  const code = cleanRoomCode(req.params.roomCode);
  requireAdmin(req, code);
  const session = loadSession(code);
  db.prepare("UPDATE sessions SET status = 'finished', updated_at = ? WHERE id = ?").run(now(), session.id);
  broadcast(code);
  res.json({ data: state(code) });
});

app.post('/api/sessions/:roomCode/reopen', (req, res) => {
  const code = cleanRoomCode(req.params.roomCode);
  requireAdmin(req, code);
  const session = loadSession(code);
  db.prepare("UPDATE sessions SET status = 'active', updated_at = ? WHERE id = ?").run(now(), session.id);
  broadcast(code);
  res.json({ data: state(code) });
});

io.on('connection', (socket) => {
  socket.on('session:join', ({ roomCode: rawCode }) => {
    try {
      const code = cleanRoomCode(rawCode);
      loadSession(code);
      socket.join(code);
      socket.emit('session:updated', state(code));
    } catch {
      socket.emit('session:error', { message: '房间不存在' });
    }
  });
});

const dist = path.join(root, 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: { message: status === 500 ? '服务端错误' : err.message } });
});

server.listen(port, () => {
  console.log(`scorekeeper listening on ${port}`);
});

export { app, db, server };
