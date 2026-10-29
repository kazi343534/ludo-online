import { initBoard, renderBoard } from './board.js';
import { sfx, unlock } from './sound.js';
import { VideoChat } from './video.js';

const socket = io();
const params = new URLSearchParams(location.search);
const roomParam = (params.get('room') || '').trim();
let playerId = sessionStorage.getItem('ludo.playerId');
let playerName = sessionStorage.getItem('ludo.name') || 'Player';

if (!playerId && roomParam) {
  try {
    const last = JSON.parse(localStorage.getItem('ludo.last') || 'null');
    if (last && last.roomCode === roomParam && last.playerId) {
      playerId = last.playerId;
      playerName = last.name || playerName;
      sessionStorage.setItem('ludo.playerId', playerId);
      sessionStorage.setItem('ludo.name', playerName);
    }
  } catch {
    /* storage unavailable */
  }
}

if (!roomParam) location.href = '/';
else if (!playerId) location.href = `/?room=${encodeURIComponent(roomParam)}`;

const els = {
  roomCode: document.getElementById('roomCode'),
  copy: document.getElementById('copyBtn'),
  leave: document.getElementById('leaveBtn'),
  turn: document.getElementById('turnBanner'),
  turnDot: document.getElementById('turnDot'),
  turnText: document.getElementById('turnText'),
  turnClock: document.getElementById('turnClock'),
  turnFill: document.querySelector('#turnBanner .turn-fill'),
  dice: document.getElementById('dice'),
  dicePips: document.getElementById('dicePips'),
  roll: document.getElementById('rollBtn'),
  players: document.getElementById('playersPanel'),
  admin: document.getElementById('adminPanel'),
  forceToggle: document.getElementById('forceToggle'),
  forceNumbers: document.getElementById('forceNumbers'),
  forceStatus: document.getElementById('forceStatus'),
  status: document.getElementById('statusMsg'),
  lobby: document.getElementById('lobbyOverlay'),
  lobbyCode: document.getElementById('lobbyCode'),
  lobbyPlayers: document.getElementById('lobbyPlayers'),
  lobbyHint: document.getElementById('lobbyHint'),
  start: document.getElementById('startBtn'),
  win: document.getElementById('winOverlay'),
  winTitle: document.getElementById('winTitle'),
  restart: document.getElementById('restartBtn'),
  home: document.getElementById('homeBtn'),
  board: document.getElementById('board'),
  videoCard: document.getElementById('videoCard'),
  videoCount: document.getElementById('videoCount'),
  videoTiles: document.getElementById('videoTiles'),
  joinVideoBtn: document.getElementById('joinVideoBtn'),
  camBtn: document.getElementById('camBtn'),
  micBtn: document.getElementById('micBtn'),
  leaveVideoBtn: document.getElementById('leaveVideoBtn'),
  videoHint: document.getElementById('videoHint'),
  reactionBar: document.getElementById('reactionBar'),
  confetti: document.getElementById('confettiLayer')
};

let state = null;
let prevState = null;
let lastSeq = null;
let turnDeadlineLocal = 0;
let turnDeadlineTotal = 0;
let lastDeadline = 0;
let diceAnim = null;
let dicePopTimer = 0;

initBoard(els.board, handleTokenClick);

const floatLayer = document.createElement('div');
floatLayer.className = 'float-layer';
els.board.appendChild(floatLayer);

const video = new VideoChat(socket);
video.mount(els.videoTiles);
video.onUpdate = updateVideoControls;

buildAdminControls();

setInterval(updateTurnClock, 250);

document.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('pagehide', () => video.leave());

socket.on('connect', () => {
  socket.emit('joinRoom', { roomCode: roomParam, name: playerName, playerId }, (res) => {
    if (!res || !res.ok) {
      flash((res && res.error) || 'Could not join room.');
      setTimeout(() => {
        location.href = '/';
      }, 2400);
      return;
    }
    if (video.joined) video.reconnect();
  });
});

socket.on('disconnect', () => flash('Connection lost — reconnecting…'));

socket.on('state', (next) => {
  state = next;
  render();
});

socket.on('gameError', (msg) => flash(msg));

socket.on('event', (payload) => {
  if (!payload) return;
  if (payload.type === 'forfeit') {
    sfx.forfeit();
    floatText('THREE SIXES — TURN LOST!', 'red');
    return;
  }
  if (payload.type === 'auto-roll') {
    flash(`${nameOf(payload.by)} auto-rolled ${payload.dice}`);
    return;
  }
  if (payload.type === 'skip') {
    flash(`${nameOf(payload.by)} was skipped`);
    return;
  }
  if (payload.type === 'pass') {
    flash(`${nameOf(payload.by)} had no moves`);
    return;
  }
  if (payload.type !== 'move') return;
  if (payload.auto) flash(`${nameOf(payload.by)} auto-moved`);
  sfx.move();
  if (payload.entered) sfx.enter();
  if (payload.captured > 0) {
    sfx.capture();
    const victim = Array.isArray(payload.victims) && state && payload.victims.includes(state.you);
    if (victim) {
      floatText('OUCH! You got eaten!', 'red');
      shakeBoard(true);
      video.bump(payload.by);
    } else {
      floatText(`CHOMP! ${nameOf(payload.by)} ate ${payload.captured}`, 'gold');
      shakeBoard(false);
      video.bump(payload.victims && payload.victims.length ? payload.victims[0] : payload.by);
    }
  }
});

socket.on('reaction', (payload) => {
  if (!payload) return;
  sfx.reaction(payload.text);
  floatText(`${payload.name}: ${payload.text}`, payload.color);
  video.bump(payload.playerId);
});

function flash(msg) {
  els.status.textContent = msg;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => {
    els.status.textContent = '';
  }, 2600);
}

function makeTag(text, variant) {
  const span = document.createElement('span');
  span.className = variant ? `tag ${variant}` : 'tag';
  span.textContent = text;
  return span;
}

function winnerName() {
  if (!state) return '';
  const winner = state.players.find((p) => p.id === state.winnerId);
  return winner ? winner.name : 'Nobody';
}

function nameOf(id) {
  const player = state ? state.players.find((p) => p.id === id) : null;
  return player ? player.name : 'Someone';
}

function floatText(text, color) {
  const el = document.createElement('div');
  el.className = color ? `float-text ft-${color}` : 'float-text';
  el.textContent = text;
  el.style.left = `${44 + Math.random() * 12}%`;
  floatLayer.appendChild(el);
  setTimeout(() => el.remove(), 1750);
}

function shakeBoard(hard) {
  els.board.classList.remove('shake', 'shake-hard');
  void els.board.offsetWidth;
  els.board.classList.add(hard ? 'shake-hard' : 'shake');
  clearTimeout(shakeBoard.timer);
  shakeBoard.timer = setTimeout(() => {
    els.board.classList.remove('shake', 'shake-hard');
  }, 520);
}

function confetti() {
  const colors = ['#e11d48', '#16a34a', '#eab308', '#2563eb', '#8b5cf6', '#f472b6'];
  els.confetti.innerHTML = '';
  for (let i = 0; i < 90; i += 1) {
    const piece = document.createElement('i');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.setProperty('--dur', `${1.7 + Math.random() * 1.6}s`);
    piece.style.setProperty('--delay', `${Math.random() * 0.5}s`);
    piece.style.setProperty('--drift', `${Math.random() * 200 - 100}px`);
    piece.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
    els.confetti.appendChild(piece);
  }
  clearTimeout(confetti.timer);
  confetti.timer = setTimeout(clearConfetti, 4200);
}

function clearConfetti() {
  els.confetti.innerHTML = '';
}

function updateVideoControls() {
  const live = video.liveCount();
  els.videoCard.classList.toggle('live', live > 0);
  els.videoCount.textContent = `${live} live`;
  els.joinVideoBtn.classList.toggle('hidden', video.joined);
  els.camBtn.classList.toggle('hidden', !video.joined);
  els.micBtn.classList.toggle('hidden', !video.joined);
  els.leaveVideoBtn.classList.toggle('hidden', !video.joined);
  els.camBtn.textContent = video.videoOn ? 'Camera On' : 'Camera Off';
  els.camBtn.classList.toggle('off', !video.videoOn);
  els.micBtn.textContent = video.audioOn ? 'Mic On' : 'Mic Off';
  els.micBtn.classList.toggle('off', !video.audioOn);
  const blocked = !video.joined && !!video.error;
  els.videoHint.classList.toggle('error', blocked);
  if (blocked) {
    els.videoHint.textContent =
      'Camera/mic blocked. Allow access in your browser, then tap Join again.';
  } else if (video.joined) {
    els.videoHint.textContent = 'Video chat is live. Toggle camera or mic anytime.';
  } else {
    els.videoHint.textContent = 'Optional: join video to see and hear each other.';
  }
}

function render() {
  if (!state) return;
  const previous = prevState;
  prevState = state.state;
  const deadline = state.state === 'playing' ? state.turnDeadline || 0 : 0;
  if (deadline !== lastDeadline) {
    lastDeadline = deadline;
    turnDeadlineTotal = deadline ? Math.max(0, deadline - state.serverNow) : 0;
  }
  turnDeadlineLocal = deadline ? Date.now() + Math.max(0, deadline - state.serverNow) : 0;
  els.roomCode.textContent = state.code;
  els.lobbyCode.textContent = state.code;
  const current = state.players.find((p) => p.id === state.turnPlayerId);
  els.board.dataset.turn = state.state === 'playing' && current ? current.color : '';
  renderLobby();
  renderPlayers();
  renderTurn();
  renderDice();
  renderAdmin();
  renderWinner();
  renderBoard({
    players: state.players,
    tokens: state.tokens,
    you: state.you,
    pendingMoves: state.pendingMoves,
    turnPlayerId: state.turnPlayerId,
    diceRolled: state.diceRolled,
    state: state.state
  });
  video.sync(state.players, state.you);
  video.setWinner(state.state === 'finished' ? state.winnerId : null);
  updateVideoControls();
  updateTurnClock();
  if (state.state === 'finished' && previous !== 'finished') {
    sfx.win();
    confetti();
  }
  if (state.state !== 'finished' && previous === 'finished') {
    clearConfetti();
  }
}

function renderLobby() {
  const inLobby = state.state === 'lobby';
  els.lobby.classList.toggle('hidden', !inLobby);
  if (!inLobby) return;

  els.lobbyPlayers.innerHTML = '';
  for (const p of state.players) {
    const row = document.createElement('div');
    row.className = 'lobby-player';

    const dot = document.createElement('span');
    dot.className = `dot ${p.color}`;
    row.appendChild(dot);

    const name = document.createElement('span');
    name.className = 'pname';
    name.textContent = p.name;
    row.appendChild(name);

    if (p.isAdmin) row.appendChild(makeTag('Admin', 'admin-tag'));
    if (p.id === state.you) row.appendChild(makeTag('You'));
    if (!p.connected) row.appendChild(makeTag('offline', 'warn'));
    els.lobbyPlayers.appendChild(row);
  }

  if (state.isAdmin) {
    els.start.classList.remove('hidden');
    els.start.disabled = state.players.length < 2;
    els.start.textContent =
      state.players.length < 2 ? 'Start Game (need 2+ players)' : 'Start Game';
    els.lobbyHint.textContent =
      state.players.length < 2
        ? 'Waiting for at least one more player to join…'
        : 'Everyone here? Start the game.';
  } else {
    els.start.classList.add('hidden');
    els.lobbyHint.textContent = 'Waiting for the admin to start the game…';
  }
}

function renderPlayers() {
  els.players.innerHTML = '';
  for (const p of state.players) {
    const row = document.createElement('div');
    row.className = 'player-row';
    if (p.isAdmin) row.classList.add('is-admin');
    if (!p.connected) row.classList.add('offline');
    if (state.state === 'playing' && state.turnPlayerId === p.id) row.classList.add('turn');

    const dot = document.createElement('span');
    dot.className = `dot ${p.color}`;
    row.appendChild(dot);

    const info = document.createElement('div');
    info.className = 'player-info';

    const nameLine = document.createElement('div');
    nameLine.className = 'player-name';
    nameLine.textContent = p.name;
    if (p.isAdmin) nameLine.appendChild(makeTag('Admin', 'admin-tag'));
    if (p.id === state.you) nameLine.appendChild(makeTag('You'));
    if (!p.connected) nameLine.appendChild(makeTag('offline', 'warn'));
    info.appendChild(nameLine);

    const homeCount = state.tokens ? state.tokens[p.id].filter((v) => v === 56).length : 0;
    const eaten = state.captures ? state.captures[p.id] || 0 : 0;
    const sub = document.createElement('div');
    sub.className = 'player-sub';
    sub.textContent = `${homeCount}/4 Home • ⚔️ Ate ${eaten}`;
    info.appendChild(sub);

    row.appendChild(info);
    if (state.state === 'playing' && state.turnPlayerId === p.id) {
      row.appendChild(makeTag('Turn', 'turn-tag'));
    }
    els.players.appendChild(row);
  }
}

function renderTurn() {
  const mine = state.turnPlayerId === state.you;
  const current = state.players.find((p) => p.id === state.turnPlayerId);
  const active = state.state === 'playing' && current;
  els.turnDot.className = active ? `turn-dot ${current.color}` : 'turn-dot hidden';

  if (state.state === 'lobby') {
    els.turn.className = 'turn-banner';
    els.turnText.textContent = 'Lobby — waiting to start';
  } else if (state.state === 'finished') {
    els.turn.className = 'turn-banner';
    els.turnText.textContent = `${winnerName()} wins the game!`;
  } else {
    els.turn.className = mine ? 'turn-banner mine live' : 'turn-banner live';
    if (mine) {
      if (state.diceRolled) {
        els.turnText.textContent = state.pendingMoves.length
          ? 'Your move — tap a glowing token'
          : 'No valid moves — passing…';
      } else {
        els.turnText.textContent = 'Your turn — roll the dice';
      }
    } else {
      els.turnText.textContent = `${current ? current.name : 'Player'}'s turn`;
    }
  }

  const canRoll =
    state.state === 'playing' &&
    state.turnPlayerId === state.you &&
    !state.diceRolled;
  els.roll.disabled = !canRoll;
}

function updateTurnClock() {
  if (!state || state.state !== 'playing' || !turnDeadlineLocal) {
    els.turnClock.classList.add('hidden');
    if (els.turnFill) els.turnFill.style.width = '0%';
    els.turn.classList.remove('urgent');
    return;
  }
  const remaining = Math.max(0, turnDeadlineLocal - Date.now());
  const left = Math.ceil(remaining / 1000);
  const total = turnDeadlineTotal || remaining || 1;
  const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
  if (els.turnFill) els.turnFill.style.width = `${pct}%`;
  els.turnClock.textContent = `${left}s`;
  els.turnClock.classList.remove('hidden');
  els.turnClock.classList.toggle('urgent', left <= 5);
  els.turn.classList.toggle('urgent', left <= 5);
}

const DICE_PIPS = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9]
};

function setDiceFace(value) {
  const face = Math.max(1, Math.min(6, Number(value) || 1));
  els.dice.dataset.value = String(face);
  els.dice.setAttribute('aria-label', `Dice showing ${face}`);
  if (!els.dicePips) return;
  els.dicePips.innerHTML = (DICE_PIPS[face] || DICE_PIPS[1])
    .map((cell) => `<span class="dice-pip pip-${cell}" aria-hidden="true"></span>`)
    .join('');
}

function renderDice() {
  if (state.dice == null) {
    lastSeq = state.diceSeq || 0;
    setDiceFace(5);
    return;
  }
  if (lastSeq === null) {
    lastSeq = state.diceSeq;
    setDiceFace(state.dice);
    return;
  }
  if (state.diceSeq !== lastSeq) {
    lastSeq = state.diceSeq;
    if (state.state === 'playing') sfx.dice();
    animateDice(state.dice);
  } else if (!diceAnim) {
    setDiceFace(state.dice);
  }
}

function animateDice(finalValue) {
  if (diceAnim) {
    diceAnim.final = finalValue;
    setDiceFace(finalValue);
    return;
  }
  const anim = { final: finalValue, start: performance.now(), timer: 0 };
  diceAnim = anim;
  els.dice.classList.add('rolling');
  const tick = () => {
    if (performance.now() - anim.start >= 540) {
      diceAnim = null;
      els.dice.classList.remove('rolling');
      setDiceFace(anim.final);
      els.dice.classList.add('pop');
      clearTimeout(dicePopTimer);
      dicePopTimer = setTimeout(() => els.dice.classList.remove('pop'), 320);
      return;
    }
    setDiceFace(1 + Math.floor(Math.random() * 6));
    anim.timer = setTimeout(tick, 65);
  };
  tick();
}

function buildAdminControls() {
  for (let value = 1; value <= 6; value += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'force-num';
    button.dataset.value = String(value);
    button.textContent = String(value);
    button.addEventListener('click', () => {
      socket.emit('forceMode', { value });
    });
    els.forceNumbers.appendChild(button);
  }

  els.forceToggle.addEventListener('change', () => {
    socket.emit('forceMode', { enabled: els.forceToggle.checked });
  });
}

function renderAdmin() {
  if (!state.isAdmin || !state.force) {
    els.admin.classList.add('hidden');
    return;
  }
  els.admin.classList.remove('hidden');
  els.forceToggle.checked = state.force.enabled;

  for (const button of els.forceNumbers.querySelectorAll('.force-num')) {
    const selected = Number(button.dataset.value) === state.force.value;
    button.classList.toggle('selected', selected);
  }

  els.forceStatus.textContent = state.force.enabled
    ? `Force mode ON — your rolls will be ${state.force.value}`
    : 'Force mode OFF — your rolls are random';
}

function renderWinner() {
  const finished = state.state === 'finished';
  els.win.classList.toggle('hidden', !finished);
  if (!finished) return;
  els.winTitle.textContent = `${winnerName()} wins!`;
  els.restart.classList.toggle('hidden', !state.isAdmin);
}

function handleTokenClick(tokenPlayerId, tokenIndex) {
  if (!state || state.state !== 'playing') return;
  if (tokenPlayerId !== state.you) return;
  if (state.turnPlayerId !== state.you) return;
  if (!state.diceRolled) return;
  if (!state.pendingMoves.includes(tokenIndex)) return;
  socket.emit('move', { tokenIndex });
}

els.roll.addEventListener('click', () => {
  if (!state || state.state !== 'playing') return;
  if (state.turnPlayerId !== state.you || state.diceRolled) return;
  const payload = {};
  if (state.isAdmin && state.force && state.force.enabled) {
    payload.forceValue = state.force.value;
  }
  socket.emit('roll', payload);
});

els.start.addEventListener('click', () => socket.emit('startGame'));
els.restart.addEventListener('click', () => socket.emit('restart'));

els.leave.addEventListener('click', () => {
  socket.emit('leaveRoom');
  location.href = '/';
});

els.home.addEventListener('click', () => {
  socket.emit('leaveRoom');
  location.href = '/';
});

els.copy.addEventListener('click', async () => {
  const code = state ? state.code : roomParam;
  try {
    await navigator.clipboard.writeText(code);
    flash('Room code copied');
  } catch {
    window.prompt('Room code', code);
  }
});

els.joinVideoBtn.addEventListener('click', async () => {
  unlock();
  const ok = await video.join();
  if (!ok) updateVideoControls();
});

els.camBtn.addEventListener('click', () => {
  unlock();
  video.toggleCamera();
});

els.micBtn.addEventListener('click', () => {
  unlock();
  video.toggleMic();
});

els.leaveVideoBtn.addEventListener('click', () => video.leave());

for (const button of els.reactionBar.querySelectorAll('button')) {
  button.addEventListener('click', () => {
    unlock();
    socket.emit('reaction', { text: button.dataset.text });
  });
}

updateVideoControls();
