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
const tokenState = new Map();
const tokenAnims = new Map();
let hasRendered = false;
let lastViewState = null;

export function initBoard(el, onTokenClick) {
  root = el;
  clickHandler = onTokenClick;
  for (const key of [...tokenAnims.keys()]) stopTokenAnimation(key);
  root.innerHTML = '';
  tokenEls.clear();
  tokenState.clear();
  hasRendered = false;
  lastViewState = null;
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

function tokenCell(color, index, pos) {
  if (pos === BASE) return BASE_SLOTS[color][index];
  if (pos === PATH_END) return HOME_PATHS[color][5];
  if (pos >= 51) return HOME_PATHS[color][pos - 51];
  const loopIndex = (START_INDEX[color] + pos) % MAIN_LOOP.length;
  return MAIN_LOOP[loopIndex];
}

function cellCenter(cell) {
  return [((cell[0] + 0.5) / 15) * 100, ((cell[1] + 0.5) / 15) * 100];
}

function tokenPath(color, index, fromPos, toPos) {
  const from = tokenCell(color, index, fromPos);
  const to = tokenCell(color, index, toPos);
  if (!from || !to) return [];
  if (fromPos >= 0 && toPos > fromPos) {
    const cells = [from];
    for (let pos = fromPos + 1; pos <= toPos; pos += 1) {
      cells.push(tokenCell(color, index, pos));
    }
    return cells;
  }
  return [from, to];
}

function setTokenPosition(el, cell) {
  const [x, y] = cellCenter(cell);
  el.style.left = `${x}%`;
  el.style.top = `${y}%`;
}

function setTokenOffset(el, ox, oy) {
  el.style.setProperty('--ox', `${ox}%`);
  el.style.setProperty('--oy', `${oy}%`);
}

function setTokenMotion(
  el,
  {
    hop = 0,
    sx = 1,
    sy = 1,
    tilt = 0,
    spin = 0,
    shadowScale = 1,
    shadowOpacity = 0.55
  } = {}
) {
  el.style.setProperty('--hop', `${-hop}px`);
  el.style.setProperty('--sx', String(sx));
  el.style.setProperty('--sy', String(sy));
  el.style.setProperty('--tilt', `${tilt}deg`);
  el.style.setProperty('--spin', `${spin}deg`);
  el.style.setProperty('--shadow-scale', String(shadowScale));
  el.style.setProperty('--shadow-opacity', String(shadowOpacity));
}

function resetTokenMotion(el) {
  setTokenMotion(el);
  el.style.opacity = '';
  el.style.zIndex = '';
  el.classList.remove('moving');
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function stopTokenAnimation(key) {
  const anim = tokenAnims.get(key);
  if (!anim) return;
  anim.done = true;
  cancelAnimationFrame(anim.raf);
  tokenAnims.delete(key);
  anim.finish();
}

function startTokenAnimation({
  key,
  el,
  path,
  fromOx,
  fromOy,
  toOx,
  toOy,
  toPos,
  mode
}) {
  if (!path.length) return;
  stopTokenAnimation(key);
  if (path.length < 2) {
    setTokenPosition(el, path[0]);
    setTokenOffset(el, toOx, toOy);
    resetTokenMotion(el);
    tokenState.set(key, { pos: toPos, cell: path[0], ox: toOx, oy: toOy });
    return;
  }
  el.classList.add('moving');
  const segments = Math.max(1, path.length - 1);
  const lastCell = path[path.length - 1];
  const stepMs = mode === 'capture' ? 300 : mode === 'enter' ? 360 : mode === 'finish' ? 125 : 105;
  const pathMs = mode === 'capture' || mode === 'enter' ? stepMs : stepMs * segments;
  const settleMs = mode === 'capture' ? 190 : mode === 'finish' ? 210 : 130;
  const totalMs = pathMs + settleMs;
  const points = path.map(cellCenter);
  const boardWidth = root ? root.getBoundingClientRect().width : 600;
  const cellSize = Math.max(12, boardWidth / 15);
  const hopHeight =
    cellSize *
    (mode === 'capture' ? 0.72 : mode === 'enter' ? 0.5 : mode === 'finish' ? 0.42 : 0.32);
  const start = performance.now();
  if (mode !== 'capture') el.style.zIndex = '9';
  const anim = {
    raf: 0,
    done: false,
    finish: () => {}
  };

  anim.finish = () => {
    setTokenPosition(el, lastCell);
    setTokenOffset(el, toOx, toOy);
    resetTokenMotion(el);
    tokenState.set(key, { pos: toPos, cell: lastCell, ox: toOx, oy: toOy });
  };

  const frame = (now) => {
    if (anim.done) return;
    const elapsed = Math.max(0, now - start);
    if (elapsed >= totalMs) {
      anim.finish();
      tokenAnims.delete(key);
      return;
    }

    let hop = 0;
    let sx = 1;
    let sy = 1;
    let tilt = 0;
    let spin = 0;
    let shadowScale = 1;
    let shadowOpacity = 0.55;

    if (elapsed < pathMs) {
      const progress = Math.max(0, Math.min(1, elapsed / pathMs));
      const scaled = progress * segments;
      const seg = Math.max(0, Math.min(segments - 1, Math.floor(scaled)));
      const local = segments === 1 ? progress : Math.max(0, Math.min(1, scaled - seg));
      const eased = easeInOutCubic(local);
      const a = points[seg];
      const b = points[seg + 1];
      const x = a[0] + (b[0] - a[0]) * eased;
      const y = a[1] + (b[1] - a[1]) * eased;
      el.style.left = `${x}%`;
      el.style.top = `${y}%`;

      const air = Math.sin(Math.PI * local);
      hop = air * hopHeight;
      const stretch = air * (mode === 'capture' ? 0.02 : 0.055);
      sx = 1 - stretch * 0.6;
      sy = 1 + stretch;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const length = Math.hypot(dx, dy) || 1;
      tilt = (dx / length) * 3.5 * air;
      if (mode === 'capture') {
        const shrink = 1 - 0.55 * easeInOutCubic(progress);
        sx = shrink;
        sy = shrink;
        spin = 360 * easeInOutCubic(progress);
        el.style.opacity = String(1 - 0.82 * progress);
        shadowScale = 0.6;
        shadowOpacity = 0;
      } else {
        el.style.opacity = '';
        shadowScale = 1 - air * 0.28;
        shadowOpacity = 0.55 - air * 0.3;
      }
      const offsetT = easeInOutCubic(progress);
      setTokenOffset(
        el,
        fromOx + (toOx - fromOx) * offsetT,
        fromOy + (toOy - fromOy) * offsetT
      );
    } else {
      setTokenPosition(el, lastCell);
      setTokenOffset(el, toOx, toOy);
      const settle = Math.min(1, (elapsed - pathMs) / Math.max(1, settleMs));
      if (mode === 'capture') {
        const pop = 0.55 + 0.45 * easeOutBack(settle);
        sx = pop;
        sy = pop;
        el.style.opacity = String(0.18 + 0.82 * settle);
        shadowScale = 0.55 + 0.45 * settle;
        shadowOpacity = 0.15 + 0.4 * settle;
      } else {
        const squash =
          Math.sin(Math.PI * settle) * (1 - settle) * (mode === 'finish' ? 0.12 : 0.08);
        sx = 1 + squash * 0.7;
        sy = 1 - squash;
        el.style.opacity = '';
      }
    }

    setTokenMotion(el, { hop, sx, sy, tilt, spin, shadowScale, shadowOpacity });
    anim.raf = requestAnimationFrame(frame);
  };

  tokenAnims.set(key, anim);
  anim.raf = requestAnimationFrame(frame);
}

function startOffsetAnimation({ key, el, fromOx, fromOy, toOx, toOy, toPos, cell }) {
  stopTokenAnimation(key);
  const start = performance.now();
  const duration = 190;
  const anim = {
    raf: 0,
    done: false,
    finish: () => {}
  };

  anim.finish = () => {
    setTokenOffset(el, toOx, toOy);
    resetTokenMotion(el);
    tokenState.set(key, { pos: toPos, cell, ox: toOx, oy: toOy });
  };

  const frame = (now) => {
    if (anim.done) return;
    const progress = Math.max(0, Math.min(1, (now - start) / duration));
    const eased = easeInOutCubic(progress);
    setTokenOffset(
      el,
      fromOx + (toOx - fromOx) * eased,
      fromOy + (toOy - fromOy) * eased
    );
    if (progress >= 1) {
      anim.finish();
      tokenAnims.delete(key);
      return;
    }
    anim.raf = requestAnimationFrame(frame);
  };

  tokenAnims.set(key, anim);
  anim.raf = requestAnimationFrame(frame);
}

export function renderBoard(view) {
  if (!root || !tokenLayer) return;
  const tokens = view.tokens;
  if (!tokens) {
    for (const key of [...tokenAnims.keys()]) stopTokenAnimation(key);
    for (const [, el] of tokenEls) el.remove();
    tokenEls.clear();
    tokenState.clear();
    hasRendered = true;
    lastViewState = view.state;
    return;
  }

  for (const key of [...tokenAnims.keys()]) stopTokenAnimation(key);

  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const snap =
    !hasRendered || lastViewState === 'lobby' || lastViewState === 'finished' || reduceMotion;
  const expected = new Set();
  const occupied = new Map();
  const records = [];

  for (const player of view.players) {
    const positions = tokens[player.id];
    if (!positions) continue;

    positions.forEach((pos, index) => {
      const key = `${player.id}::${index}`;
      expected.add(key);

      const cell = tokenCell(player.color, index, pos);
      if (!cell) return;

      const cellKey = `${cell[0]},${cell[1]}`;
      if (!occupied.has(cellKey)) occupied.set(cellKey, []);
      occupied.get(cellKey).push(key);

      let el = tokenEls.get(key);
      let fresh = false;
      if (!el) {
        el = createTokenElement(player.id, index);
        tokenEls.set(key, el);
        fresh = true;
      }

      el.className = `token token-${player.color}`;
      if (pos === PATH_END) el.classList.add('finished');

      const movable =
        view.state === 'playing' &&
        view.turnPlayerId === player.id &&
        player.id === view.you &&
        view.diceRolled &&
        view.pendingMoves.includes(index);
      if (movable) el.classList.add('movable');

      records.push({ key, el, player, index, pos, cell, fresh });
    });
  }

  for (const [key, el] of tokenEls) {
    if (expected.has(key)) continue;
    stopTokenAnimation(key);
    el.remove();
    tokenEls.delete(key);
    tokenState.delete(key);
  }

  const targetOffsets = new Map();
  for (const [, keys] of occupied) {
    keys.forEach((key, i) => {
      if (keys.length === 1) {
        targetOffsets.set(key, [0, 0]);
      } else {
        const [ox, oy] = OFFSETS[i % OFFSETS.length];
        targetOffsets.set(key, [ox * 18, oy * 18]);
      }
    });
  }

  for (const record of records) {
    const [toOx, toOy] = targetOffsets.get(record.key) || [0, 0];
    const old = tokenState.get(record.key);

    if (snap || record.fresh || !old) {
      setTokenPosition(record.el, record.cell);
      setTokenOffset(record.el, toOx, toOy);
      resetTokenMotion(record.el);
      tokenState.set(record.key, {
        pos: record.pos,
        cell: record.cell,
        ox: toOx,
        oy: toOy
      });
      continue;
    }

    if (old.pos !== record.pos) {
      const path = tokenPath(record.player.color, record.index, old.pos, record.pos);
      if (path.length) {
        const mode =
          old.pos >= 0 && record.pos === BASE
            ? 'capture'
            : old.pos === BASE && record.pos === 0
              ? 'enter'
              : record.pos === PATH_END
                ? 'finish'
                : 'move';
        startTokenAnimation({
          key: record.key,
          el: record.el,
          path,
          fromOx: old.ox,
          fromOy: old.oy,
          toOx,
          toOy,
          toPos: record.pos,
          mode
        });
      }
      continue;
    }

    setTokenPosition(record.el, record.cell);
    if (old.ox !== toOx || old.oy !== toOy) {
      startOffsetAnimation({
        key: record.key,
        el: record.el,
        fromOx: old.ox,
        fromOy: old.oy,
        toOx,
        toOy,
        toPos: record.pos,
        cell: record.cell
      });
    } else {
      setTokenOffset(record.el, toOx, toOy);
      resetTokenMotion(record.el);
      tokenState.set(record.key, {
        pos: record.pos,
        cell: record.cell,
        ox: toOx,
        oy: toOy
      });
    }
  }

  hasRendered = true;
  lastViewState = view.state;
}
