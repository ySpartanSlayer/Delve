// Delve server: serves the web page and keeps every player's screen in sync over WebSockets.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game, CARDS, TARGET_GOLD, START_HEALTH, MAX_PLAYERS, MIN_PLAYERS } = require('./game');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const ROOM_IDLE_MS = 60 * 60 * 1000;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (url === '/config.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'] });
    return res.end(`window.DELVE = ${JSON.stringify({ CARDS, TARGET_GOLD, START_HEALTH, MAX_PLAYERS, MIN_PLAYERS })};`);
  }
  // Any path that isn't a file gets the app, so links like /ABCD open the join screen.
  let file = path.normalize(path.join(PUBLIC, url));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(PUBLIC, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

// ---- Rooms ----

const rooms = new Map(); // code -> room

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, they look like 1 and 0
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const room = { code: newCode(), seats: [], hostId: null, game: null, touched: Date.now() };
  rooms.set(room.code, room);
  return room;
}

function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

function roomState(room, forId) {
  return {
    type: 'state',
    code: room.code,
    you: forId,
    hostId: room.hostId,
    phase: room.game ? (room.game.over ? 'over' : 'playing') : 'lobby',
    seats: room.seats.map(s => ({ id: s.id, name: s.name, connected: !!s.ws })),
    game: room.game ? room.game.view(forId) : null,
  };
}

function broadcast(room) {
  room.touched = Date.now();
  for (const s of room.seats) {
    if (s.ws && s.ws.readyState === 1) s.ws.send(JSON.stringify(roomState(room, s.id)));
  }
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function pickNewHost(room) {
  if (room.seats.some(s => s.id === room.hostId && s.ws)) return;
  const next = room.seats.find(s => s.ws);
  if (next) room.hostId = next.id;
}

// ---- Connections ----

const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let room = null;
  let seat = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const fail = error => send(ws, { type: 'error', error });

    if (msg.type === 'create' || msg.type === 'join') {
      const name = cleanName(msg.name);
      if (!name) return fail('Enter a name first.');
      let r;
      if (msg.type === 'create') {
        r = createRoom();
      } else {
        r = rooms.get(String(msg.code || '').toUpperCase().trim());
        if (!r) return fail("That room code doesn't exist. Check it and try again.");
      }
      // Rejoin: same saved token, or same name on a seat that lost its connection.
      let s = r.seats.find(x => x.token === msg.token) ||
              r.seats.find(x => !x.ws && x.name.toLowerCase() === name.toLowerCase());
      if (s && s.ws && s.ws !== ws) {
        try { s.ws.close(); } catch {}
      }
      if (!s) {
        if (r.game && !r.game.over) return fail('That game has already started. Ask them to start a new one after this game.');
        if (r.seats.length >= MAX_PLAYERS) return fail(`That room is full (${MAX_PLAYERS} players max).`);
        if (r.seats.some(x => x.name.toLowerCase() === name.toLowerCase())) return fail('Someone in that room already has that name.');
        s = { id: crypto.randomUUID().slice(0, 8), token: crypto.randomUUID(), name, ws: null };
        r.seats.push(s);
      }
      if (room && seat && (room !== r || seat !== s)) leave();
      s.ws = ws;
      room = r; seat = s;
      if (!r.hostId) r.hostId = s.id;
      pickNewHost(r);
      send(ws, { type: 'joined', code: r.code, token: s.token, id: s.id });
      return broadcast(r);
    }

    if (!room || !seat) return fail('Join a room first.');
    const g = room.game;
    let err = null;

    switch (msg.type) {
      case 'start':
        if (seat.id !== room.hostId) return fail('Only the host can start the game.');
        if (g && !g.over) return fail('The game is already running.');
        room.seats = room.seats.filter(s => s.ws); // drop anyone who left the lobby
        if (room.seats.length < MIN_PLAYERS) return fail(`You need at least ${MIN_PLAYERS} players to start.`);
        room.game = new Game(room.seats.map(s => ({ id: s.id, name: s.name })));
        break;
      case 'again':
        if (!g || !g.over) return fail('The game is still running.');
        room.game = null;
        room.seats = room.seats.filter(s => s.ws);
        pickNewHost(room);
        break;
      case 'delve': err = g ? g.delve(seat.id) : 'No game running.'; break;
      case 'escape': err = g ? g.escape(seat.id) : 'No game running.'; break;
      case 'ambush': err = g ? g.ambush(seat.id, msg.target) : 'No game running.'; break;
      case 'skip': {
        if (!g || g.over) return fail('No game running.');
        const cur = room.seats.find(s => s.id === g.turn?.playerId);
        if (!cur || cur.ws) return fail('You can only skip a player who has disconnected.');
        err = g.forceSkip();
        break;
      }
      case 'ping': return send(ws, { type: 'pong' });
      default: return;
    }
    if (err) return fail(err);
    broadcast(room);
  });

  function leave() {
    if (!room || !seat) return;
    if (seat.ws === ws) seat.ws = null;
    // In the lobby a player who leaves gives up their seat. During a game the seat waits for them.
    if (!room.game && !seat.ws) room.seats = room.seats.filter(s => s !== seat);
    pickNewHost(room);
    if (!room.seats.some(s => s.ws)) room.touched = Date.now();
    broadcast(room);
  }

  ws.on('close', leave);
});

// Drop dead connections so the "disconnected" badge shows up quickly.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (!r.seats.some(s => s.ws) && now - r.touched > ROOM_IDLE_MS) rooms.delete(code);
  }
}, 15000);

server.listen(PORT, () => console.log(`Delve running on http://localhost:${PORT}`));
