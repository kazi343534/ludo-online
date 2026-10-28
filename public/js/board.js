import {
  COLORS,
  BASE,
  PATH_END,
  MAIN_LOOP,
  START_INDEX,
  SAFE_LOOP,
  HOME_PATHS,
  BASE_SLOTS,
  BASE_RECTS
} from './constants.js';

const STARTS = new Set(Object.values(START_INDEX));
const OFFSETS = [[-1, -1], [1, 1], [-1, 1], [1, -1]];

let root = null;
let tokenLayer = null;
let clickHandler = null;
const tokenEls = new Map();

export function initBoard(el, onTokenClick) {
  root = el;
  clickHandler = onTokenClick;
  root.innerHTML = '';
  tokenEls.clear();

  const homeColors = new Map();
  for (const color of COLORS) {
    HOME_PATHS[color].slice(0, 5).forEach(([c, r]) => homeColors.set(`${c},${r}`, color));
  }

  const startColors = new Map();
  for (const color of COLORS) {
    const [c, r] = MAIN_LOOP[START_INDEX[color]];
    startColors.set(`${c},${r}`, color);
  }

  const stars = new Set();
  for (const idx of SAFE_LOOP) {
    if (STARTS.has(idx)) continue;
    const [c, r] = MAIN_LOOP[idx];
    stars.add(`${c},${r}`);
  }

  for (let r = 0; r < 15; r += 1) {
    for (let c = 0; c < 15; c += 1) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      const key = `${c},${r}`;
      if (homeColors.has(key)) cell.classList.add('home-cell', `home-${homeColors.get(key)}`);
      if (startColors.has(key)) cell.classList.add('start-cell', `start-${startColors.get(key)}`);
      if (stars.has(key)) {
        const star = document.createElement('span');
        star.className = 'star';
        star.textContent = '★';
        cell.appendChild(star);
      }
      root.appendChild(cell);
    }
  }

  for (const color of COLORS) {
    const rect = BASE_RECTS[color];
    const base = document.createElement('div');
    base.className = `base base-${color}`;
    base.style.left = `${(rect.x / 15) * 100}%`;
    base.style.top = `${(rect.y / 15) * 100}%`;
    base.style.width = `${(rect.w / 15) * 100}%`;
    base.style.height = `${(rect.h / 15) * 100}%`;

    const inner = document.createElement('div');
    inner.className = 'base-inner';
    base.appendChild(inner);

    for (let i = 0; i < 4; i += 1) {
      const hole = document.createElement('div');
      hole.className = 'hole';
      hole.style.left = `${i % 2 === 0 ? 25 : 75}%`;
      hole.style.top = `${i < 2 ? 25 : 75}%`;
      base.appendChild(hole);
    }
    root.appendChild(base);
  }

  const center = document.createElement('div');
  center.className = 'center-home';
  center.style.left = '40%';
  center.style.top = '40%';
  center.style.width = '20%';
  center.style.height = '20%';
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const tri = document.createElement('div');
    tri.className = `tri ${side}`;
    center.appendChild(tri);
  }
  const emblem = document.createElement('div');
  emblem.className = 'center-emblem';
  emblem.textContent = '★';
  center.appendChild(emblem);
  root.appendChild(center);

  tokenLayer = document.createElement('div');
  tokenLayer.className = 'token-layer';
  root.appendChild(tokenLayer);
}

function createTokenElement(playerId, index) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'token';
  el.dataset.player = playerId;
  el.dataset.index = String(index);
  el.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!clickHandler) return;
    clickHandler(el.dataset.player, Number(el.dataset.index));
  });
  tokenLayer.appendChild(el);
  return el;
}

export function renderBoard(view) {
  if (!root || !tokenLayer) return;
  const tokens = view.tokens;
  if (!tokens) {
    for (const [, el] of tokenEls) el.remove();
    tokenEls.clear();
    return;
  }

  const expected = new Set();
  const occupied = new Map();

  for (const player of view.players) {
    const positions = tokens[player.id];
    if (!positions) continue;

    positions.forEach((pos, index) => {
      const key = `${player.id}::${index}`;
      expected.add(key);

      let cell = null;
      if (pos === BASE) cell = BASE_SLOTS[player.color][index];
      else if (pos === PATH_END) cell = HOME_PATHS[player.color][5];
      else if (pos >= 51) cell = HOME_PATHS[player.color][pos - 51];
      else {
        const loopIndex = (START_INDEX[player.color] + pos) % MAIN_LOOP.length;
        cell = MAIN_LOOP[loopIndex];
      }
      if (!cell) return;

      const cellKey = `${cell[0]},${cell[1]}`;
      if (!occupied.has(cellKey)) occupied.set(cellKey, []);
      occupied.get(cellKey).push(key);

      let el = tokenEls.get(key);
      if (!el) {
        el = createTokenElement(player.id, index);
        tokenEls.set(key, el);
      }

      el.className = `token token-${player.color}`;
      el.style.left = `${((cell[0] + 0.5) / 15) * 100}%`;
      el.style.top = `${((cell[1] + 0.5) / 15) * 100}%`;
      if (pos === PATH_END) el.classList.add('finished');

      const movable =
        view.state === 'playing' &&
        view.turnPlayerId === player.id &&
        player.id === view.you &&
        view.diceRolled &&
        view.pendingMoves.includes(index);
      if (movable) el.classList.add('movable');
    });
  }

  for (const [key, el] of tokenEls) {
    if (!expected.has(key)) {
      el.remove();
      tokenEls.delete(key);
    }
  }

  for (const [, keys] of occupied) {
    keys.forEach((key, i) => {
      const el = tokenEls.get(key);
      if (!el) return;
      if (keys.length === 1) {
        el.style.setProperty('--ox', '0%');
        el.style.setProperty('--oy', '0%');
      } else {
        const [ox, oy] = OFFSETS[i % OFFSETS.length];
        el.style.setProperty('--ox', `${ox * 18}%`);
        el.style.setProperty('--oy', `${oy * 18}%`);
      }
    });
  }
}
