import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from './game/Game.js';
import { COLORS } from './public/js/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3210;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.get('/rtc-config.js', (req, res) => {
  let servers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }
  ];
  const turnUrl = (process.env.TURN_URL || '').trim();
  const turnUsername = (process.env.TURN_USERNAME || '').trim();
  const turnCredential = (process.env.TURN_CREDENTIAL || '').trim();
  if (turnUrl && turnUsername && turnCredential) {
    servers = [
      ...servers,
      {
        urls: turnUrl.split(',').map((url) => url.trim()).filter(Boolean),
        username: turnUsername,
        credential: turnCredential
      }
    ];
  }
  res.type('application/javascript');
  res.set('Cache-Control', 'no-store');
  res.send(`window.RTC_ICE_SERVERS = ${JSON.stringify(servers)};`);
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const TURN_ROLL_MS = Number(process.env.TURN_ROLL_MS) || 30000;
const TURN_MOVE_MS = Number(process.env.TURN_MOVE_MS) || 15000;
const TURN_OFFLINE_MS = Number(process.env.TURN_OFFLINE_MS) || 6000;

function makeCode() {
  let code;
  do {
    code = String(crypto.randomInt(100000, 1000000));
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  const cleaned = String(name || '')
    .trim()
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .slice(0, 16);
  return cleaned || 'Player';
}

function cleanId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);
}

function newPlayer(id, name, color) {
  return {
    id,
    name,
    color,
    socketId: null,
    connected: false,
    forceMode: false,
    forceValue: 6,
    lastReaction: 0,
    rtc: false,
    mediaVideo: false,
    mediaAudio: false
  };
}

function buildState(room, viewerId) {
  const game = room.game;
  const me = room.players.find((p) => p.id === viewerId);
  const state = {
    code: room.code,
    adminId: room.adminId,
    state: room.state,
    you: viewerId,
    isAdmin: viewerId === room.adminId,
    canStart: room.players.length >= 2,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      connected: p.connected,
      isAdmin: p.id === room.adminId
    })),
    turnPlayerId: game ? game.currentPlayerId : null,
    dice: game ? game.dice : null,
    diceSeq: game ? game.diceSeq : 0,
    diceRolled: game ? game.diceRolled : false,
    pendingMoves: game ? [...game.availableMoves] : [],
    tokens: game ? game.tokens : null,
    captures: game ? game.captures : null,
    winnerId: game ? game.winnerId : null,
    finished: game ? game.finished : false,
    turnDeadline: room.turnDeadline || 0,
    serverNow: Date.now()
  };
  if (me && me.id === room.adminId) {
    state.force = { enabled: me.forceMode, value: me.forceValue };
  }
  return state;
}

function broadcast(room) {
  scheduleTurnTimer(room);
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('state', buildState(room, p.id));
  }
}

function context(socket) {
  const room = rooms.get(socket.data.roomCode);
  if (!room) return null;
  const player = room.players.find((p) => p.id === socket.data.playerId);
  if (!player || player.socketId !== socket.id) return null;
  return { room, player };
}

function resetTimers(room) {
  for (const t of room.timers) clearTimeout(t);
  room.timers = [];
  clearTurnTimer(room);
}

function clearRoom(room) {
  resetTimers(room);
  rooms.delete(room.code);
}

function clearTurnTimer(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.turnDeadline = 0;
}

function scheduleTurnTimer(room) {
  clearTurnTimer(room);
  if (room.state !== 'playing' || !room.game || room.game.finished) return;
  const current = room.players.find((p) => p.id === room.game.currentPlayerId);
  if (!current) return;
  let delay = TURN_ROLL_MS;
  if (!current.connected) delay = TURN_OFFLINE_MS;
  else if (room.game.diceRolled) delay = TURN_MOVE_MS;
  room.turnDeadline = Date.now() + delay;
  room.turnTimer = setTimeout(() => {
    room.turnTimer = null;
    room.turnDeadline = 0;
    handleTurnTimeout(room);
  }, delay);
}

function handleTurnTimeout(room) {
  if (room.state !== 'playing' || !room.game || room.game.finished) return;
  const player = room.players.find((p) => p.id === room.game.currentPlayerId);
  if (!player) {
    broadcast(room);
    return;
  }

  if (!player.connected) {
    room.game.advanceTurn();
    broadcast(room);
    io.to(room.code).emit('event', { type: 'skip', by: player.id });
    return;
  }

  if (!room.game.diceRolled) {
    const value = crypto.randomInt(1, 7);
    const result = room.game.roll(player.id, value);
    if (result.error) {
      broadcast(room);
      return;
    }
    broadcast(room);
    io.to(room.code).emit('event', { type: 'auto-roll', by: player.id, dice: value });
    if (result.forfeit || result.moves.length === 0) scheduleAdvance(room);
    return;
  }

  const moves = room.game.availableMoves;
  if (!moves.length) {
    room.game.advanceTurn();
    broadcast(room);
    io.to(room.code).emit('event', { type: 'pass', by: player.id });
    return;
  }
  const result = performMove(room, player, moves[0], true);
  if (result.error) broadcast(room);
}

function performMove(room, player, tokenIndex, auto = false) {
  const result = room.game.applyMove(player.id, tokenIndex);
  if (result.error) return result;
  if (result.finished) room.state = 'finished';
  broadcast(room);
  io.to(room.code).emit('event', {
    type: 'move',
    by: player.id,
    dice: room.game.dice,
    entered: result.entered,
    extraTurn: result.extraTurn,
    captured: result.captured.length,
    victims: result.captured.map((c) => c.playerId),
    finished: result.finished,
    auto
  });
  return result;
}

function scheduleAdvance(room) {
  const timer = setTimeout(() => {
    room.timers = room.timers.filter((t) => t !== timer);
    if (room.state !== 'playing' || !room.game) return;
    if (!room.game.diceRolled) return;
    const playerId = room.game.currentPlayerId;
    room.game.advanceTurn();
    broadcast(room);
    io.to(room.code).emit('event', { type: 'pass', by: playerId });
  }, 1600);
  room.timers.push(timer);
}

io.on('connection', (socket) => {
  socket.data.roomCode = null;
  socket.data.playerId = null;

  socket.on('createRoom', (payload = {}, ack) => {
    if (socket.data.roomCode) return;
    const playerId = cleanId(payload.playerId) || crypto.randomUUID();
    const name = cleanName(payload.name);
    const room = {
      code: makeCode(),
      adminId: playerId,
      players: [],
      state: 'lobby',
      game: null,
      timers: [],
      createdAt: Date.now()
    };
    const player = newPlayer(playerId, name, COLORS[0]);
    player.socketId = socket.id;
    player.connected = true;
    room.players.push(player);
    rooms.set(room.code, room);

    socket.data.roomCode = room.code;
    socket.data.playerId = playerId;
    socket.join(room.code);
    broadcast(room);
    if (typeof ack === 'function') ack({ ok: true, code: room.code });
  });

  socket.on('joinRoom', (payload = {}, ack) => {
    const reply = (res) => {
      if (typeof ack === 'function') ack(res);
    };
    const room = rooms.get(String(payload.roomCode || '').trim());
    if (!room) return reply({ ok: false, error: 'Room not found. Check the code.' });

    const playerId = cleanId(payload.playerId);
    if (!playerId) return reply({ ok: false, error: 'Invalid player id.' });

    let player = room.players.find((p) => p.id === playerId);
    if (player) {
      if (player.socketId && player.socketId !== socket.id) {
        const old = io.sockets.sockets.get(player.socketId);
        if (old) {
          old.data.roomCode = null;
          old.data.playerId = null;
        }
      }
      if (player.rtc) {
        player.rtc = false;
        player.mediaVideo = false;
        player.mediaAudio = false;
        socket.to(room.code).emit('rtc-peer-left', { playerId: player.id });
      }
      player.socketId = socket.id;
      player.connected = true;
    } else {
      if (room.state !== 'lobby') return reply({ ok: false, error: 'That game has already started.' });
      if (room.players.length >= 4) return reply({ ok: false, error: 'Room is full.' });
      const used = new Set(room.players.map((p) => p.color));
      const color = COLORS.find((c) => !used.has(c)) || COLORS[0];
      player = newPlayer(playerId, cleanName(payload.name), color);
      player.socketId = socket.id;
      player.connected = true;
      room.players.push(player);
    }

    socket.data.roomCode = room.code;
    socket.data.playerId = playerId;
    socket.join(room.code);
    broadcast(room);
    reply({ ok: true, code: room.code });
  });

  socket.on('startGame', () => {
    const ctx = context(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (player.id !== room.adminId) return;
    if (room.state !== 'lobby') return;
    if (room.players.length < 2) return;
    resetTimers(room);
    room.state = 'playing';
    room.game = new Game(room.players);
    broadcast(room);
  });

  socket.on('roll', (payload = {}) => {
    const ctx = context(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.state !== 'playing' || !room.game) return;
    if (room.game.currentPlayerId !== player.id) return;
    if (room.game.diceRolled) return;

    const requested = Number.isInteger(payload.forceValue) ? payload.forceValue : null;
    let value;
    if (
      player.id === room.adminId &&
      player.forceMode &&
      requested !== null &&
      requested >= 1 &&
      requested <= 6
    ) {
      value = requested;
    } else {
      value = crypto.randomInt(1, 7);
    }

    const result = room.game.roll(player.id, value);
    if (result.error) {
      if (player.socketId) io.to(player.socketId).emit('state', buildState(room, player.id));
      return;
    }
    broadcast(room);
    if (result.forfeit) {
      io.to(room.code).emit('event', { type: 'forfeit', by: player.id });
      scheduleAdvance(room);
    } else if (result.moves.length === 0) {
      scheduleAdvance(room);
    }
  });

  socket.on('move', (payload = {}) => {
    const ctx = context(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.state !== 'playing' || !room.game) return;
    const result = performMove(room, player, payload.tokenIndex);
    if (result.error && player.socketId) {
      io.to(player.socketId).emit('state', buildState(room, player.id));
    }
  });

  const REACTIONS = new Set(['LOL!', 'WOW!', 'NO!', 'GG!']);

  socket.on('reaction', (payload = {}) => {
    const ctx = context(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!REACTIONS.has(payload.text)) return;
    const now = Date.now();
    if (now - player.lastReaction < 800) return;
    player.lastReaction = now;
    io.to(room.code).emit('reaction', {
      playerId: player.id,
      name: player.name,
      color: player.color,
      text: payload.text
    });
  });

  socket.on('rtc-hello', () => {
    const ctx = context(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    player.rtc = true;
    const peers = room.players.filter((p) => p.rtc && p.id !== player.id).map((p) => p.id);
    socket.emit('rtc-peers', { peers });
    socket.to(room.code).emit('rtc-peer-joined', { playerId: player.id });
  });

  socket.on('rtc-signal', (payload = {}) => {
    const ctx = context(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.rtc || !payload.data) return;
    const target = room.players.find((p) => p.id === payload.to);
    if (!target || !target.rtc || !target.socketId) return;
    io.to(target.socketId).emit('rtc-signal', { from: player.id, data: payload.data });
  });

  socket.on('rtc-media', (payload = {}) => {
    const ctx = context(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.rtc) return;
    player.mediaVideo = !!payload.video;
    player.mediaAudio = !!payload.audio;
    socket.to(room.code).emit('rtc-media', {
      playerId: player.id,
      video: player.mediaVideo,
      audio: player.mediaAudio
    });
  });

  socket.on('rtc-status', () => {
    const ctx = context(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    const players = room.players
      .filter((p) => p.id !== player.id && p.rtc && (p.mediaVideo || p.mediaAudio))
      .map((p) => ({
        playerId: p.id,
        video: p.mediaVideo,
        audio: p.mediaAudio
      }));
    socket.emit('rtc-status', { players });
  });

  socket.on('rtc-watch', (payload = {}) => {
    const ctx = context(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    const target = room.players.find((p) => p.id === payload.to);
    if (!target || target.id === player.id || !target.rtc || !target.socketId) return;
    if (!target.mediaVideo && !target.mediaAudio) return;
    player.rtc = true;
    io.to(target.socketId).emit('rtc-watch-request', { playerId: player.id });
  });

  socket.on('rtc-bye', () => {
    const ctx = context(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!player.rtc) return;
    player.rtc = false;
    player.mediaVideo = false;
    player.mediaAudio = false;
    socket.to(room.code).emit('rtc-peer-left', { playerId: player.id });
  });

  socket.on('forceMode', (payload = {}) => {
    const ctx = context(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (player.id !== room.adminId) return;
    if (typeof payload.enabled === 'boolean') player.forceMode = payload.enabled;
    if (Number.isInteger(payload.value) && payload.value >= 1 && payload.value <= 6) {
      player.forceValue = payload.value;
    }
    if (player.socketId) io.to(player.socketId).emit('state', buildState(room, player.id));
  });

  socket.on('restart', () => {
    const ctx = context(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (player.id !== room.adminId) return;
    if (room.state !== 'finished') return;
    resetTimers(room);
    room.game = new Game(room.players);
    room.state = 'playing';
    broadcast(room);
  });

  socket.on('leaveRoom', () => {
    const ctx = context(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (player.rtc) {
      player.rtc = false;
      player.mediaVideo = false;
      player.mediaAudio = false;
      io.to(room.code).emit('rtc-peer-left', { playerId: player.id });
    }
    socket.leave(room.code);

    if (room.state === 'lobby') {
      room.players = room.players.filter((p) => p.id !== player.id);
      if (room.adminId === player.id) {
        room.adminId = room.players.length ? room.players[0].id : null;
      }
      if (room.players.length === 0) clearRoom(room);
      else broadcast(room);
    } else {
      player.connected = false;
      player.socketId = null;
      broadcast(room);
    }

    socket.data.roomCode = null;
    socket.data.playerId = null;
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = room.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    player.connected = false;
    player.socketId = null;
    if (player.rtc) {
      player.rtc = false;
      player.mediaVideo = false;
      player.mediaAudio = false;
      io.to(room.code).emit('rtc-peer-left', { playerId: player.id });
    }
    broadcast(room);
  });
});

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const room of [...rooms.values()]) {
    if (room.createdAt < cutoff && room.players.every((p) => !p.connected)) {
      clearRoom(room);
    }
  }
}, 30 * 60 * 1000).unref();

httpServer.listen(PORT, () => {
  console.log(`Ludo server running on http://localhost:${PORT}`);
});
