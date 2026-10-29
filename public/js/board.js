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
const STAR_OUTER =
  '50,6 61.2,36.6 93.8,37.8 68.1,57.9 77,89.2 50,71 23,89.2 31.9,57.9 6.3,37.8 38.8,36.6';
const STAR_LEFT = '50,6 38.8,36.6 6.3,37.8 31.9,57.9 23,89.2 50,71 50,52';
const STAR_RIGHT = '50,6 61.2,36.6 93.8,37.8 68.1,57.9 77,89.2 50,71 50,52';
const STAR_INNER =
  '50,13 59.5,38.2 86.8,39.2 65,55.6 72.4,81.5 50,66.3 27.6,81.5 35,55.6 13.2,39.2 40.5,38.2';

let starSeq = 0;
let root = null;

function facetedStarSVG({ center = false } = {}) {
  const id = `star${starSeq++}`;
  const rim = center
    ? `<polygon points="${STAR_OUTER}" transform="translate(50 52) scale(1.06) translate(-50 -52)" fill="none" stroke="#996515" stroke-width="4.5" stroke-linejoin="round"/>`
    : '';
  return `<svg class="star-svg${center ? ' star-center' : ''}" viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <linearGradient id="${id}L" x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0" stop-color="#fffbd6"/>
        <stop offset="0.4" stop-color="#ffe066"/>
        <stop offset="0.75" stop-color="#ffc400"/>
        <stop offset="1" stop-color="#b87300"/>
      </linearGradient>
      <linearGradient id="${id}R" x1="0.8" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffd700"/>
        <stop offset="0.45" stop-color="#e09b00"/>
        <stop offset="1" stop-color="#7a4a00"/>
      </linearGradient>
    </defs>
    ${rim}
    <polygon points="${STAR_LEFT}" fill="url(#${id}L)" stroke="#7a4a00" stroke-width="2" stroke-linejoin="round"/>
    <polygon points="${STAR_RIGHT}" fill="url(#${id}R)" stroke="#7a4a00" stroke-width="2" stroke-linejoin="round"/>
    <polygon points="${STAR_OUTER}" fill="none" stroke="#ffd700" stroke-width="2.4" stroke-linejoin="round"/>
    <polygon points="${STAR_INNER}" fill="none" stroke="#fff3a1" stroke-width="1" opacity="0.85" stroke-linejoin="round"/>
  </svg>`;
}
let tokenLayer = null;
let clickHandler = null;
const tokenEls = new Map();

export function initBoard(el, onTokenClick) {
  root = el;
  clickHandler = onTokenClick;
  root.innerHTML = '';
  tokenEls.clear();
  root.classList.add('board-enter');
  setTimeout(() => root.classList.remove('board-enter'), 650);

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
        star.innerHTML = facetedStarSVG();
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
  emblem.innerHTML = facetedStarSVG({ center: true });
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
  el.innerHTML =
    '<span class="pawn-base" aria-hidden="true"></span>' +
    '<span class="pawn-neck" aria-hidden="true"></span>' +
    '<span class="pawn-head" aria-hidden="true"></span>';
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
