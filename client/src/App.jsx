import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const socket = io();
const W = 800, H = 600;
const COLORS = ['#000000', '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6', '#8d5524', '#7f8c8d'];

export default function App() {
  const [gs, setGs] = useState(null);
  const [me, setMe] = useState('');
  const [opts, setOpts] = useState([]);
  const [word, setWord] = useState('');
  const [msgs, setMsgs] = useState([]);
  const [over, setOver] = useState(null);

  useEffect(() => {
    const add = (m) => setMsgs((x) => [...x.slice(-80), m]);
    socket.on('connect', () => setMe(socket.id));
    if (socket.connected) setMe(socket.id);
    socket.on('game_state', setGs);
    socket.on('word_options', setOpts);
    socket.on('your_word', (w) => { setWord(w); setOpts([]); });
    socket.on('chat_message', add);
    socket.on('guess_result', (r) => add({ system: true, text: `${r.playerName} guessed the word! +${r.points}` }));
    socket.on('game_over', setOver);
    return () => socket.off();
  }, []);

  if (!gs) return <Home />;
  if (gs.phase === 'lobby') return <Lobby gs={gs} me={me} />;
  return <Game gs={gs} me={me} opts={opts} word={word} msgs={msgs} over={over} />;
}

function Home() {
  const [name, setName] = useState('');
  const [code, setCode] = useState(new URLSearchParams(location.search).get('room') || '');
  const [err, setErr] = useState('');
  const [s, setS] = useState({ maxPlayers: 8, rounds: 3, drawTime: 80, hints: 2, isPrivate: false });
  const go = (ev, p) => (name.trim() ? socket.emit(ev, p, (r) => r.error && setErr(r.error)) : setErr('Enter your name'));
  const num = (k) => (
    <label key={k}>{k}<input type="number" value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} /></label>
  );
  return (
    <div className="card">
      <h1>🎨 Skribbl Clone</h1>
      <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
      <h3>Join</h3>
      <input placeholder="Room code" value={code} onChange={(e) => setCode(e.target.value)} />
      <button onClick={() => go('join_room', { roomId: code, playerName: name })}>Join with code</button>
      <button onClick={() => go('quick_join', { playerName: name })}>Join a public room</button>
      <h3>Create room</h3>
      {['maxPlayers', 'rounds', 'drawTime', 'hints'].map(num)}
      <label>Private (invite link only)
        <input type="checkbox" checked={s.isPrivate} onChange={(e) => setS({ ...s, isPrivate: e.target.checked })} />
      </label>
      <button onClick={() => go('create_room', { hostName: name, settings: s })}>Create room</button>
      {err && <p className="err">{err}</p>}
    </div>
  );
}

function Lobby({ gs, me }) {
  const link = `${location.origin}/?room=${gs.roomId}`;
  const host = gs.hostId === me;
  return (
    <div className="card">
      <h2>Lobby — {gs.roomId}</h2>
      <input readOnly value={link} onFocus={(e) => e.target.select()} />
      <button onClick={() => navigator.clipboard?.writeText(link)}>Copy invite link</button>
      <p>{gs.settings.rounds} rounds · {gs.settings.drawTime}s · {gs.settings.hints} hints · {gs.settings.isPrivate ? 'Private' : 'Public'}</p>
      {gs.players.map((p) => <div key={p.id}>👤 {p.name}{p.id === gs.hostId && ' (host)'}</div>)}
      {host
        ? <button disabled={gs.players.length < 2} onClick={() => socket.emit('start_game')}>Start game (need 2+ players)</button>
        : <p>Waiting for host to start…</p>}
    </div>
  );
}

function Board({ canDraw }) {
  const ref = useRef(), cur = useRef(null);
  const [color, setColor] = useState('#000000');
  const [size, setSize] = useState(5);
  const ctx = () => ref.current.getContext('2d');
  const seg = (a, b, c, s) => {
    const x = ctx(); x.strokeStyle = c; x.lineWidth = s; x.lineCap = 'round';
    x.beginPath(); x.moveTo(a[0] * W, a[1] * H); x.lineTo(b[0] * W, b[1] * H); x.stroke();
  };
  const clear = () => { ctx().fillStyle = '#fff'; ctx().fillRect(0, 0, W, H); };
  const apply = (e) => {
    if (e.type === 'start') { cur.current = { c: e.color, s: e.size, p: [e.x, e.y] }; seg(cur.current.p, cur.current.p, e.color, e.size); }
    else if (e.type === 'move' && cur.current) { const n = [e.x, e.y]; seg(cur.current.p, n, cur.current.c, cur.current.s); cur.current.p = n; }
    else cur.current = null;
  };
  useEffect(() => {
    clear();
    socket.on('draw_data', apply);
    socket.on('canvas_clear', clear);
    socket.on('canvas_state', ({ strokes }) => {
      clear();
      strokes.forEach((s) => { seg(s.pts[0], s.pts[0], s.color, s.size); for (let i = 1; i < s.pts.length; i++) seg(s.pts[i - 1], s.pts[i], s.color, s.size); });
    });
    socket.emit('get_canvas');
    return () => { socket.off('draw_data'); socket.off('canvas_clear'); socket.off('canvas_state'); };
  }, []);

  const pos = (e) => { const r = ref.current.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  const down = (e) => {
    if (!canDraw) return;
    ref.current.setPointerCapture(e.pointerId);
    const [x, y] = pos(e), d = { x, y, color, size };
    apply({ type: 'start', ...d }); socket.emit('draw_start', d);
  };
  const move = (e) => { if (!canDraw || !cur.current) return; const [x, y] = pos(e); apply({ type: 'move', x, y }); socket.emit('draw_move', { x, y }); };
  const up = () => { if (cur.current) { apply({ type: 'end' }); socket.emit('draw_end'); } };

  return (
    <>
      <canvas ref={ref} width={W} height={H} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      {canDraw && (
        <div className="tools">
          {COLORS.map((c) => <button key={c} className="sw" style={{ background: c, outline: c === color ? '3px solid #4f46e5' : 'none' }} onClick={() => setColor(c)} />)}
          <button onClick={() => setColor('#ffffff')}>Eraser</button>
          <input type="range" min="2" max="30" value={size} onChange={(e) => setSize(+e.target.value)} />
          <button onClick={() => socket.emit('draw_undo')}>Undo</button>
          <button onClick={() => socket.emit('canvas_clear')}>Clear</button>
        </div>
      )}
    </>
  );
}

function Game({ gs, me, opts, word, msgs, over }) {
  const [t, setT] = useState('');
  const drawer = gs.drawerId === me;
  const dname = gs.players.find((p) => p.id === gs.drawerId)?.name;
  const send = (e) => {
    e.preventDefault();
    if (!t.trim()) return;
    socket.emit(drawer ? 'chat' : 'guess', { text: t }); setT('');
  };
  const sorted = [...gs.players].sort((a, b) => b.score - a.score);
  const title = gs.phase === 'choosing' ? `${dname} is choosing a word…` : drawer && gs.phase === 'drawing' ? `Draw: ${word}` : gs.mask;

  return (
    <div className="game">
      <div className="col">
        <b>Leaderboard</b>
        {sorted.map((p) => <div key={p.id}>{p.id === gs.drawerId ? '✏️' : p.guessed ? '✅' : '👤'} {p.name}{p.id === me && ' (you)'} — {p.score}</div>)}
      </div>
      <div className="board">
        <div className="head">
          <span>Round {gs.round}/{gs.settings.rounds}</span>
          <span className="mask">{title}</span>
          <span>⏱ {gs.timeLeft}</span>
        </div>
        <Board canDraw={drawer && gs.phase === 'drawing'} />
      </div>
      <div className="col chat">
        <div className="msgs">
          {msgs.map((m, i) => m.system ? <div key={i} className="ok">{m.text}</div> : <div key={i}><b>{m.playerName}:</b> {m.text}</div>)}
        </div>
        <form onSubmit={send}>
          <input style={{ width: '100%' }} placeholder={drawer ? 'Chat…' : 'Type your guess…'} value={t} onChange={(e) => setT(e.target.value)} />
        </form>
      </div>

      {drawer && gs.phase === 'choosing' && opts.length > 0 && (
        <div className="overlay">Pick a word to draw
          {opts.map((w) => <button key={w} onClick={() => socket.emit('word_chosen', { word: w })}>{w}</button>)}
        </div>
      )}
      {gs.phase === 'roundEnd' && <div className="overlay">Round over! The word was <b>{gs.mask}</b></div>}
      {gs.phase === 'gameover' && over && (
        <div className="overlay">
          🏆 Winner: {over.winner.name}
          {over.leaderboard.map((p, i) => <div key={i}>{i + 1}. {p.name} — {p.score}</div>)}
          {gs.hostId === me && <button onClick={() => socket.emit('start_game')}>Play again</button>}
        </div>
      )}
    </div>
  );
}
