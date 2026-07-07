import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './styles.css';

const buttons = [1, -1, 5, -5];

function path() {
  return window.location.pathname;
}

function go(to) {
  window.history.pushState({}, '', to);
  window.dispatchEvent(new Event('popstate'));
}

async function api(pathname, options = {}) {
  const res = await fetch(`/api${pathname}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message || '请求失败');
  return body.data;
}

function key(roomCode, name) {
  return `scorekeeper:${roomCode}:${name}`;
}

function saveLogin(roomCode, data) {
  localStorage.setItem(key(roomCode, 'token'), data.token);
  localStorage.setItem(key(roomCode, 'role'), data.role);
  if (data.playerId) localStorage.setItem(key(roomCode, 'playerId'), data.playerId);
}

function useRoute() {
  const [route, setRoute] = useState(path());
  useEffect(() => {
    const onPop = () => setRoute(path());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return route;
}

function App() {
  const route = useRoute();
  if (route === '/create') return <CreatePage />;
  if (route === '/history') return <HistoryPage />;
  if (route.startsWith('/join/')) return <JoinPage roomCode={route.split('/')[2]} />;
  if (route.startsWith('/sessions/')) return <ScorePage roomCode={route.split('/')[2]} />;
  return <HomePage />;
}

function Shell({ children }) {
  return (
    <main className="shell">
      <button className="link" onClick={() => go('/')}>scorekeeper</button>
      {children}
    </main>
  );
}

function HomePage() {
  const [roomCode, setRoomCode] = useState('');
  return (
    <Shell>
      <section className="hero">
        <h1>实时计分</h1>
        <p>朋友聚会、桌游、台球、羽毛球，一房一码就开局。</p>
      </section>
      <div className="panel">
        <label>房间码</label>
        <input value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} placeholder="例如 AB12CD" />
        <button onClick={() => roomCode.trim() && go(`/join/${roomCode.trim().toUpperCase()}`)}>加入场次</button>
      </div>
      <div className="actions">
        <button onClick={() => go('/create')}>创建新场次</button>
        <button className="secondary" onClick={() => go('/history')}>历史场次</button>
      </div>
    </Shell>
  );
}

function CreatePage() {
  const [name, setName] = useState('');
  const [type, setType] = useState('boardgame');
  const [adminPin, setAdminPin] = useState('');
  const [players, setPlayers] = useState(['', '']);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      const data = await api('/sessions', {
        method: 'POST',
        body: JSON.stringify({ name, type, adminPin, players })
      });
      saveLogin(data.session.roomCode, data);
      go(`/sessions/${data.session.roomCode}`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Shell>
      <h1>创建场次</h1>
      <form className="panel" onSubmit={submit}>
        <label>场次名称</label>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength="80" required />
        <label>场景类型</label>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="boardgame">桌游</option>
          <option value="billiards">台球</option>
          <option value="badminton">羽毛球</option>
          <option value="other">其他</option>
        </select>
        <label>管理员 PIN</label>
        <input value={adminPin} onChange={(e) => setAdminPin(e.target.value)} minLength="4" maxLength="32" required />
        <label>初始玩家</label>
        {players.map((player, index) => (
          <div className="row" key={index}>
            <input value={player} onChange={(e) => setPlayers(players.map((p, i) => i === index ? e.target.value : p))} placeholder={`玩家 ${index + 1}`} />
            <button type="button" className="icon" onClick={() => setPlayers(players.filter((_, i) => i !== index))}>×</button>
          </div>
        ))}
        <button type="button" className="secondary" onClick={() => setPlayers([...players, ''])}>添加玩家</button>
        {error && <p className="error">{error}</p>}
        <button>创建并进入</button>
      </form>
    </Shell>
  );
}

function JoinPage({ roomCode }) {
  const [data, setData] = useState(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/sessions/${roomCode}`).then(setData).catch((err) => setError(err.message));
  }, [roomCode]);

  async function join(playerId) {
    setError('');
    try {
      const login = await api(`/sessions/${roomCode}/join`, {
        method: 'POST',
        body: JSON.stringify({ playerId })
      });
      saveLogin(roomCode, login);
      go(`/sessions/${roomCode}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function adminLogin(e) {
    e.preventDefault();
    setError('');
    try {
      const login = await api(`/sessions/${roomCode}/admin-login`, {
        method: 'POST',
        body: JSON.stringify({ adminPin: pin })
      });
      saveLogin(roomCode, login);
      go(`/sessions/${roomCode}`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Shell>
      <h1>{data?.session.name || roomCode}</h1>
      <p className="muted">选择你的名字，或用管理员 PIN 进入。</p>
      {error && <p className="error">{error}</p>}
      <div className="list">
        {data?.players.map((player) => (
          <button className="playerPick" key={player.id} onClick={() => join(player.id)}>
            {player.name}<span>{player.score}</span>
          </button>
        ))}
      </div>
      <form className="panel" onSubmit={adminLogin}>
        <label>管理员 PIN</label>
        <input value={pin} onChange={(e) => setPin(e.target.value)} />
        <button>管理员进入</button>
      </form>
    </Shell>
  );
}

function ScorePage({ roomCode }) {
  const token = localStorage.getItem(key(roomCode, 'token'));
  const role = localStorage.getItem(key(roomCode, 'role'));
  const playerId = Number(localStorage.getItem(key(roomCode, 'playerId')));
  const [data, setData] = useState(null);
  const [newPlayer, setNewPlayer] = useState('');
  const [error, setError] = useState('');

  const sorted = useMemo(() => [...(data?.players || [])].sort((a, b) => b.score - a.score), [data]);

  useEffect(() => {
    api(`/sessions/${roomCode}`).then(setData).catch((err) => setError(err.message));
    const socket = io();
    socket.emit('session:join', { roomCode });
    socket.on('session:updated', setData);
    socket.on('session:error', (err) => setError(err.message));
    return () => socket.close();
  }, [roomCode]);

  async function write(pathname, body) {
    setError('');
    try {
      const next = await api(pathname, { method: 'POST', token, body: JSON.stringify(body || {}) });
      setData(next);
    } catch (err) {
      setError(err.message);
    }
  }

  async function score(target, delta) {
    setError('');
    try {
      const next = await api(`/sessions/${roomCode}/players/${target.id}/score`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ delta })
      });
      setData(next);
    } catch (err) {
      setError(err.message);
    }
  }

  async function addPlayer(e) {
    e.preventDefault();
    if (!newPlayer.trim()) return;
    await write(`/sessions/${roomCode}/players`, { name: newPlayer });
    setNewPlayer('');
  }

  async function deletePlayer(id) {
    setError('');
    try {
      const next = await api(`/sessions/${roomCode}/players/${id}`, { method: 'DELETE', token });
      setData(next);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!data) return <Shell><p>加载中...</p>{error && <p className="error">{error}</p>}</Shell>;
  const admin = role === 'admin';

  return (
    <Shell>
      <div className="scoreHeader">
        <div>
          <h1>{data.session.name}</h1>
          <p className="muted">房间码 {data.session.roomCode} · {data.session.status === 'active' ? '进行中' : '已结束'}</p>
        </div>
        <button className="secondary" onClick={() => go(`/join/${roomCode}`)}>切换身份</button>
      </div>
      {!token && <p className="error">请先选择玩家或管理员身份。</p>}
      {error && <p className="error">{error}</p>}
      <div className="scores">
        {sorted.map((player) => {
          const canEdit = admin || player.id === playerId;
          return (
            <article className="card" key={player.id}>
              <div>
                <h2>{player.name}</h2>
                <strong>{player.score}</strong>
              </div>
              {canEdit && data.session.status === 'active' && (
                <div className="scoreButtons">
                  {buttons.map((delta) => <button key={delta} onClick={() => score(player, delta)}>{delta > 0 ? `+${delta}` : delta}</button>)}
                </div>
              )}
              {admin && data.session.status === 'active' && <button className="danger ghost" onClick={() => deletePlayer(player.id)}>删除玩家</button>}
            </article>
          );
        })}
      </div>
      {admin && (
        <section className="admin">
          <form className="row" onSubmit={addPlayer}>
            <input value={newPlayer} onChange={(e) => setNewPlayer(e.target.value)} placeholder="新玩家名称" />
            <button>添加</button>
          </form>
          <div className="actions">
            <button className="secondary" onClick={() => write(`/sessions/${roomCode}/undo`)}>撤销</button>
            <button className="secondary" onClick={() => write(`/sessions/${roomCode}/reset`)}>重置</button>
            {data.session.status === 'active'
              ? <button className="danger" onClick={() => write(`/sessions/${roomCode}/finish`)}>结束场次</button>
              : <button onClick={() => write(`/sessions/${roomCode}/reopen`)}>重新打开</button>}
          </div>
        </section>
      )}
    </Shell>
  );
}

function HistoryPage() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/sessions/history').then(setRows).catch((err) => setError(err.message));
  }, []);
  return (
    <Shell>
      <h1>历史场次</h1>
      {error && <p className="error">{error}</p>}
      <div className="list">
        {rows.map((row) => (
          <button className="history" key={row.roomCode} onClick={() => go(`/sessions/${row.roomCode}`)}>
            <b>{row.name}</b>
            <span>{row.roomCode} · {row.playerCount} 人 · {row.status === 'active' ? '进行中' : '已结束'}</span>
            <small>{new Date(row.updatedAt).toLocaleString()}</small>
          </button>
        ))}
      </div>
    </Shell>
  );
}

createRoot(document.getElementById('root')).render(<App />);
