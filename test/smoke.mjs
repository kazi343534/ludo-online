import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { io } from 'socket.io-client';

const PORT = 3111;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const serverPath = fileURLToPath(new globalThis.URL('../server.js', import.meta.url));

const server = spawn(process.execPath, [serverPath], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe']
});

let serverOutput = '';
server.stdout.on('data', (d) => {
  serverOutput += d.toString();
});
server.stderr.on('data', (d) => {
  serverOutput += d.toString();
});

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    if (serverOutput.includes('running')) return;
    await sleep(100);
  }
  throw new Error(`server did not start:\n${serverOutput}`);
}

function makeClient(playerId) {
  const socket = io(BASE_URL, { transports: ['websocket'], forceNew: true, reconnection: false });
  const client = { socket, playerId, state: null, states: 0, reactions: [], rtc: [] };
  socket.on('state', (s) => {
    client.state = s;
    client.states += 1;
  });
  socket.on('reaction', (r) => client.reactions.push(r));
  socket.on('rtc-peers', (p) => client.rtc.push({ type: 'peers', ...p }));
  socket.on('rtc-peer-joined', (p) => client.rtc.push({ type: 'joined', ...p }));
  socket.on('rtc-signal', (p) => client.rtc.push({ type: 'signal', ...p }));
  socket.on('rtc-peer-left', (p) => client.rtc.push({ type: 'left', ...p }));
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(client));
    socket.on('connect_error', reject);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

async function waitFor(fn, label, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await sleep(25);
  }
  throw new Error(`timeout waiting for ${label}`);
}

let a;
let b;
let late;

try {
  await waitForServer();
  a = await makeClient('admin-1');
  const created = await emitAck(a.socket, 'createRoom', { name: 'Admin', playerId: 'admin-1' });
  assert.equal(created.ok, true);
  const code = created.code;
  assert.match(code, /^\d{6}$/);

  b = await makeClient('player-2');
  const joined = await emitAck(b.socket, 'joinRoom', {
    roomCode: code,
    name: 'Friend',
    playerId: 'player-2'
  });
  assert.equal(joined.ok, true);

  await waitFor(() => a.state && a.state.players.length === 2, 'both players in lobby');
  assert.equal(a.state.isAdmin, true);
  assert.equal(b.state.isAdmin, false);
  assert.equal(b.state.force, undefined, 'non-admin never receives force controls');

  b.socket.emit('reaction', { text: 'GG!' });
  await waitFor(() => a.reactions.length === 1, 'reaction broadcast');
  assert.equal(a.reactions[0].text, 'GG!');
  assert.equal(a.reactions[0].playerId, 'player-2');
  b.socket.emit('reaction', { text: 'HACK!' });
  await sleep(300);
  assert.equal(a.reactions.length, 1, 'invalid reaction text is dropped');
  await sleep(600);
  b.socket.emit('reaction', { text: 'LOL!' });
  await waitFor(() => a.reactions.length === 2, 'reaction allowed after cooldown');

  a.socket.emit('rtc-hello');
  await waitFor(() => a.rtc.some((e) => e.type === 'peers'), 'admin rtc peer list');
  assert.deepEqual(a.rtc.find((e) => e.type === 'peers').peers, []);

  b.socket.emit('rtc-hello');
  await waitFor(() => b.rtc.some((e) => e.type === 'peers'), 'friend rtc peer list');
  assert.deepEqual(b.rtc.find((e) => e.type === 'peers').peers, ['admin-1']);
  await waitFor(
    () => a.rtc.some((e) => e.type === 'joined' && e.playerId === 'player-2'),
    'peer joined broadcast'
  );

  b.socket.emit('rtc-signal', {
    to: 'admin-1',
    data: { description: { type: 'offer', sdp: 'test-sdp' } }
  });
  await waitFor(() => a.rtc.some((e) => e.type === 'signal'), 'signal relayed to peer');
  const relayed = a.rtc.find((e) => e.type === 'signal');
  assert.equal(relayed.from, 'player-2');
  assert.equal(relayed.data.description.sdp, 'test-sdp');

  a.socket.emit('rtc-bye');
  await waitFor(
    () => b.rtc.some((e) => e.type === 'left' && e.playerId === 'admin-1'),
    'peer left broadcast'
  );

  b.socket.emit('startGame');
  await sleep(300);
  assert.equal(a.state.state, 'lobby', 'non-admin cannot start the game');

  a.socket.emit('startGame');
  await waitFor(() => a.state.state === 'playing', 'game start');
  assert.equal(a.state.players[0].color, 'red');
  assert.equal(a.state.players[1].color, 'green');

  b.socket.emit('forceMode', { enabled: true, value: 6 });
  await sleep(250);
  assert.equal(a.state.force.enabled, false, 'non-admin cannot toggle admin force mode');

  a.socket.emit('forceMode', { enabled: true, value: 6 });
  await waitFor(() => a.state.force && a.state.force.enabled === true, 'admin force enabled');

  a.socket.emit('roll', { forceValue: 6 });
  await waitFor(() => a.state.diceSeq === 1 && a.state.dice === 6, 'admin forced roll = 6');
  assert.equal(a.state.turnPlayerId, 'admin-1');
  assert.deepEqual(a.state.pendingMoves, [0, 1, 2, 3]);

  a.socket.emit('move', { tokenIndex: 0 });
  await waitFor(
    () => a.state.tokens['admin-1'][0] === 0 && a.state.diceRolled === false,
    'token enters board'
  );
  assert.equal(a.state.turnPlayerId, 'admin-1', 'extra turn after rolling 6');

  const before = JSON.stringify(a.state.tokens);
  a.socket.emit('move', { tokenIndex: 2 });
  await sleep(250);
  assert.equal(JSON.stringify(a.state.tokens), before, 'cannot move before rolling');

  a.socket.emit('roll', { forceValue: 6 });
  await waitFor(() => a.state.dice === 6 && a.state.diceRolled === true, 'second forced six');
  a.socket.emit('move', { tokenIndex: 0 });
  await waitFor(() => a.state.tokens['admin-1'][0] === 6, 'token advances six');
  assert.equal(a.state.turnPlayerId, 'admin-1');

  a.socket.emit('roll', { forceValue: 6 });
  await waitFor(() => a.state.diceRolled === true && a.state.pendingMoves.length === 0, 'third six forfeits');
  assert.equal(a.state.tokens['admin-1'][0], 6, 'third six grants no move');
  await waitFor(() => a.state.turnPlayerId === 'player-2', 'turn passes after third six');

  late = await makeClient('player-late');
  const lateJoin = await emitAck(late.socket, 'joinRoom', {
    roomCode: code,
    name: 'Late',
    playerId: 'player-late'
  });
  assert.equal(lateJoin.ok, false, 'cannot join a game in progress');

  for (let i = 0; i < 16 && a.state.turnPlayerId !== 'admin-1'; i += 1) {
    if (b.state.turnPlayerId === 'player-2' && !b.state.diceRolled) {
      b.socket.emit('roll', { forceValue: 6 });
      await waitFor(
        () => b.state.diceRolled === true || b.state.turnPlayerId !== 'player-2',
        'friend roll'
      );
      assert.ok(b.state.dice >= 1 && b.state.dice <= 6, 'friend dice in range');
      assert.equal(b.state.force, undefined, 'friend cannot see force panel');
      if (b.state.diceRolled && b.state.pendingMoves.length > 0) {
        b.socket.emit('move', { tokenIndex: b.state.pendingMoves[0] });
        await sleep(300);
      }
    }
    await sleep(250);
  }
  assert.equal(a.state.turnPlayerId, 'admin-1', 'turn returns to admin');

  a.socket.emit('forceMode', { value: 1 });
  await waitFor(() => a.state.force.value === 1, 'force value updated');
  a.socket.emit('roll', { forceValue: 1 });
  await waitFor(() => a.state.dice === 1 && a.state.diceRolled === true, 'forced roll = 1');
  assert.deepEqual(a.state.pendingMoves, [0]);

  const beforeInvalid = JSON.stringify(a.state.tokens);
  a.socket.emit('move', { tokenIndex: 2 });
  await sleep(250);
  assert.equal(JSON.stringify(a.state.tokens), beforeInvalid, 'invalid move is rejected');

  a.socket.emit('move', { tokenIndex: 0 });
  await waitFor(() => a.state.tokens['admin-1'][0] === 7, 'token advances one');
  assert.equal(a.state.turnPlayerId, 'player-2', 'turn passes after non-extra move');

  console.log('smoke tests passed');
} finally {
  if (a) a.socket.disconnect();
  if (b) b.socket.disconnect();
  if (late) late.socket.disconnect();
  server.kill('SIGTERM');
}
