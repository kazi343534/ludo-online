const socket = io();
const nameEl = document.getElementById('name');
const codeEl = document.getElementById('code');
const statusEl = document.getElementById('status');

const params = new URLSearchParams(location.search);
if (params.get('room')) codeEl.value = params.get('room');

nameEl.value = sessionStorage.getItem('ludo.name') || '';

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `p-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function playerId() {
  let id = sessionStorage.getItem('ludo.playerId');
  if (!id) {
    id = newId();
    sessionStorage.setItem('ludo.playerId', id);
  }
  return id;
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

function go(code) {
  location.href = `/game.html?room=${encodeURIComponent(code)}`;
}

function rememberIdentity(code, name) {
  const identity = { roomCode: code, name, playerId: playerId() };
  try {
    localStorage.setItem('ludo.last', JSON.stringify(identity));
  } catch {
    /* storage unavailable */
  }
}

function createRoom() {
  const name = nameEl.value.trim();
  if (!name) return setStatus('Enter your name first.');
  sessionStorage.setItem('ludo.name', name);
  setStatus('Creating room…');
  socket.emit('createRoom', { name, playerId: playerId() }, (res) => {
    if (!res || !res.ok) return setStatus((res && res.error) || 'Could not create room.');
    rememberIdentity(res.code, name);
    go(res.code);
  });
}

function joinRoom() {
  const name = nameEl.value.trim();
  if (!name) return setStatus('Enter your name first.');
  const code = codeEl.value.trim();
  if (!/^\d{6}$/.test(code)) return setStatus('Enter the 6-digit room code.');
  sessionStorage.setItem('ludo.name', name);
  setStatus('Joining…');
  socket.emit('joinRoom', { roomCode: code, name, playerId: playerId() }, (res) => {
    if (!res || !res.ok) return setStatus((res && res.error) || 'Could not join room.');
    rememberIdentity(res.code, name);
    go(res.code);
  });
}

document.getElementById('createBtn').addEventListener('click', createRoom);
document.getElementById('joinBtn').addEventListener('click', joinRoom);

codeEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});

nameEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (codeEl.value.trim()) joinRoom();
    else createRoom();
  }
});

socket.on('connect_error', () => setStatus('Cannot reach the server. Is it running?'));
