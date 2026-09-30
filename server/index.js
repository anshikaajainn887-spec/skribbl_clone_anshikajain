const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const WORDS = ['apple','banana','cat','dog','house','tree','car','bus','train','plane','boat','sun','moon','star','cloud','rain','snow','fire','flower','book','phone','laptop','chair','table','bed','door','window','clock','key','guitar','piano','pizza','burger','cake','ice cream','egg','fish','bird','horse','cow','lion','tiger','elephant','monkey','snake','spider','butterfly','bicycle','umbrella','glasses','hat','shoe','camera','robot','rocket','castle','bridge','mountain','beach','volcano','ghost','dragon','cricket bat'];

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const DIST = path.join(__dirname, '../client/dist');
app.use(express.static(DIST));
app.use((req, res) => res.sendFile(path.join(DIST, 'index.html')));

const clamp = (v, a, b, d) => { v = parseInt(v); return isNaN(v) ? d : Math.min(b, Math.max(a, v)); };
const norm = (s) => String(s || '').trim().toLowerCase();
const rooms = new Map();

class Player {
  constructor(id, name) {
    this.id = id;
    this.name = String(name || 'Player').trim().slice(0, 16) || 'Player';
    this.score = 0;
  }
}

class Room {
  constructor(id, settings) {
    this.id = id; this.settings = settings;
    this.players = new Map(); this.hostId = null;
    this.reset();
  }
  reset() {
    clearInterval(this.iv); clearTimeout(this.to);
    this.phase = 'lobby'; this.round = 0; this.queue = [];
    this.drawerId = null; this.word = ''; this.opts = [];
    this.revealed = new Set(); this.strokes = []; this.guessed = new Set(); this.timeLeft = 0;
  }
  emit(e, d) { io.to(this.id).emit(e, d); }
  mask() {
    return [...this.word].map((c, i) => c === ' ' ? '/' : (this.revealed.has(i) || this.phase === 'roundEnd') ? c : '_').join(' ');
  }
  state() {
    const show = this.phase === 'drawing' || this.phase === 'roundEnd';
    return {
      roomId: this.id, settings: this.settings, phase: this.phase, round: this.round,
      drawerId: this.drawerId, hostId: this.hostId, timeLeft: this.timeLeft,
      mask: show ? this.mask() : '',
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, score: p.score, guessed: this.guessed.has(p.id) })),
    };
  }
  sync() { this.emit('game_state', this.state()); }
  add(p) { this.players.set(p.id, p); if (!this.hostId) this.hostId = p.id; }

  start() {
    if (this.players.size < 2) return;
    this.players.forEach((p) => (p.score = 0));
    this.round = 1; this.queue = [...this.players.keys()];
    this.next();
  }
  next() {
    while (this.queue.length && !this.players.has(this.queue[0])) this.queue.shift();
    if (!this.queue.length) {
      if (this.round >= this.settings.rounds) return this.over();
      this.round++; this.queue = [...this.players.keys()];
    }
    this.drawerId = this.queue.shift();
    this.phase = 'choosing'; this.strokes = []; this.guessed.clear(); this.word = ''; this.revealed = new Set();
    this.emit('canvas_clear');
    this.opts = [...WORDS].sort(() => Math.random() - 0.5).slice(0, 3);
    io.to(this.drawerId).emit('word_options', this.opts);
    this.timeLeft = 0; this.sync();
    this.to = setTimeout(() => this.choose(this.opts[0]), 15000); // auto-pick
  }
  choose(w) {
    if (this.phase !== 'choosing' || !this.opts.includes(w)) return;
    clearTimeout(this.to);
    this.word = w; this.phase = 'drawing'; this.timeLeft = this.settings.drawTime;
    io.to(this.drawerId).emit('your_word', w);
    const T = this.settings.drawTime, h = this.settings.hints;
    this.iv = setInterval(() => {
      this.timeLeft--;
      for (let i = 1; i <= h; i++) if (this.timeLeft === Math.round(T * (1 - i / (h + 1)))) this.hint();
      if (this.timeLeft <= 0) this.endRound(); else this.sync();
    }, 1000);
    this.sync();
  }
  hint() {
    const idx = [...this.word].map((c, i) => i).filter((i) => this.word[i] !== ' ' && !this.revealed.has(i));
    if (idx.length > 1) this.revealed.add(idx[Math.floor(Math.random() * idx.length)]);
  }
  guess(p, text) {
    if (this.phase !== 'drawing' || p.id === this.drawerId || this.guessed.has(p.id)) return this.chat(p, text);
    // word matching: case-insensitive + trimmed, exact
    if (norm(text) === norm(this.word)) {
      const pts = Math.round(50 + 200 * this.timeLeft / this.settings.drawTime);
      p.score += pts;
      const d = this.players.get(this.drawerId); if (d) d.score += 30;
      this.guessed.add(p.id);
      this.emit('guess_result', { correct: true, playerId: p.id, playerName: p.name, points: pts });
      if (this.guessed.size >= this.players.size - 1) this.endRound(); else this.sync();
    } else this.chat(p, text);
  }
  chat(p, text) {
    text = String(text || '').slice(0, 100);
    const leak = this.phase === 'drawing' && this.word && norm(text).includes(norm(this.word));
    if (leak && (p.id === this.drawerId || this.guessed.has(p.id))) return; // don't leak the word
    this.emit('chat_message', { playerId: p.id, playerName: p.name, text });
  }
  endRound() {
    if (this.phase !== 'drawing') return;
    clearInterval(this.iv); clearTimeout(this.to);
    this.phase = 'roundEnd';
    this.emit('round_end', { word: this.word });
    this.sync();
    this.to = setTimeout(() => this.next(), 4000);
  }
  over() {
    clearInterval(this.iv); clearTimeout(this.to);
    this.phase = 'gameover';
    const lb = [...this.players.values()].map((p) => ({ name: p.name, score: p.score })).sort((a, b) => b.score - a.score);
    this.emit('game_over', { winner: lb[0], leaderboard: lb });
    this.sync();
  }
  remove(id) {
    this.players.delete(id);
    if (!this.players.size) { this.reset(); rooms.delete(this.id); return; }
    if (this.hostId === id) this.hostId = this.players.keys().next().value;
    if (this.phase !== 'lobby' && this.phase !== 'gameover') {
      if (this.players.size < 2) this.reset();
      else if (id === this.drawerId) {
        if (this.phase === 'drawing') this.endRound();
        else if (this.phase === 'choosing') { clearTimeout(this.to); this.next(); }
      } else if (this.phase === 'drawing' && this.guessed.size >= this.players.size - 1) this.endRound();
    }
    this.emit('player_left', { playerId: id });
    this.sync();
  }
}

io.on('connection', (socket) => {
  let room = null;
  const me = () => room && room.players.get(socket.id);
  const enter = (r, name) => {
    room = r; r.add(new Player(socket.id, name)); socket.join(r.id);
    io.to(r.id).emit('player_joined', { playerId: socket.id });
    r.sync();
  };

  socket.on('create_room', ({ hostName, settings = {} }, cb) => {
    if (room) return;
    let id; do id = Math.random().toString(36).slice(2, 7).toUpperCase(); while (rooms.has(id));
    const s = {
      maxPlayers: clamp(settings.maxPlayers, 2, 20, 8), rounds: clamp(settings.rounds, 2, 10, 3),
      drawTime: clamp(settings.drawTime, 15, 240, 80), hints: clamp(settings.hints, 0, 5, 2),
      isPrivate: !!settings.isPrivate,
    };
    const r = new Room(id, s); rooms.set(id, r); enter(r, hostName);
    cb && cb({ roomId: id });
  });
  socket.on('join_room', ({ roomId, playerName }, cb) => {
    if (room) return;
    const r = rooms.get(String(roomId || '').trim().toUpperCase());
    if (!r) return cb({ error: 'Room not found' });
    if (r.players.size >= r.settings.maxPlayers) return cb({ error: 'Room is full' });
    enter(r, playerName); cb({ roomId: r.id });
  });
  socket.on('quick_join', ({ playerName }, cb) => {
    if (room) return;
    const r = [...rooms.values()].find((x) => !x.settings.isPrivate && x.phase === 'lobby' && x.players.size < x.settings.maxPlayers);
    if (!r) return cb({ error: 'No public room open. Create one!' });
    enter(r, playerName); cb({ roomId: r.id });
  });
  socket.on('start_game', () => room && room.hostId === socket.id && ['lobby', 'gameover'].includes(room.phase) && room.start());
  socket.on('word_chosen', ({ word }) => room && room.drawerId === socket.id && room.choose(word));
  socket.on('guess', ({ text }) => me() && room.guess(me(), text));
  socket.on('chat', ({ text }) => me() && room.chat(me(), text));

  const canDraw = () => room && room.drawerId === socket.id && room.phase === 'drawing';
  socket.on('get_canvas', () => room && socket.emit('canvas_state', { strokes: room.strokes }));
  socket.on('draw_start', (d) => {
    if (!canDraw()) return;
    room.strokes.push({ color: d.color, size: d.size, pts: [[d.x, d.y]] });
    socket.to(room.id).emit('draw_data', { type: 'start', x: d.x, y: d.y, color: d.color, size: d.size });
  });
  socket.on('draw_move', (d) => {
    if (!canDraw()) return;
    const s = room.strokes[room.strokes.length - 1]; s && s.pts.push([d.x, d.y]);
    socket.to(room.id).emit('draw_data', { type: 'move', x: d.x, y: d.y });
  });
  socket.on('draw_end', () => canDraw() && socket.to(room.id).emit('draw_data', { type: 'end' }));
  socket.on('canvas_clear', () => { if (canDraw()) { room.strokes = []; room.emit('canvas_clear'); } });
  socket.on('draw_undo', () => { if (canDraw()) { room.strokes.pop(); room.emit('canvas_state', { strokes: room.strokes }); } });
  socket.on('disconnect', () => room && room.remove(socket.id));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server on http://localhost:' + PORT));
