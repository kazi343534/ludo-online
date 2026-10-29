import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const BASE_URL = 'http://127.0.0.1:3210';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const shots = '/tmp/ludo-shots';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required'
  ]
});

const errors = [];

function watch(page, tag) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${tag} console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`${tag} pageerror: ${err.message}`));
}

async function newPage(viewport) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(viewport);
  return page;
}

async function waitText(page, selector, text, timeout = 8000) {
  await page.waitForFunction(
    (sel, txt) => {
      const el = document.querySelector(sel);
      return el && el.textContent.includes(txt);
    },
    { timeout },
    selector,
    text
  );
}

try {
  const admin = await newPage({ width: 1280, height: 900 });
  watch(admin, 'admin');
  await admin.goto(BASE_URL, { waitUntil: 'networkidle0' });
  await admin.screenshot({ path: `${shots}/landing.png` });

  await admin.type('#name', 'Admin');
  const adminNav = admin.waitForNavigation({ waitUntil: 'networkidle0' });
  await admin.click('#createBtn');
  await adminNav;
  assert.match(admin.url(), /game\.html\?room=\d{6}/);
  const roomCode = new globalThis.URL(admin.url()).searchParams.get('room');

  await admin.waitForSelector('#lobbyOverlay:not(.hidden)');
  await waitText(admin, '#lobbyCode', roomCode);
  await admin.screenshot({ path: `${shots}/lobby-admin.png` });
  assert.equal(await admin.$eval('#startBtn', (el) => el.disabled), true);
  assert.equal(await admin.$eval('#adminPanel', (el) => el.classList.contains('hidden')), false);

  const friend = await newPage({ width: 1280, height: 900 });
  watch(friend, 'friend');
  await friend.goto(`${BASE_URL}/?room=${roomCode}`, { waitUntil: 'networkidle0' });
  assert.equal(await friend.$eval('#code', (el) => el.value), roomCode);
  await friend.type('#name', 'Friend');
  const friendNav = friend.waitForNavigation({ waitUntil: 'networkidle0' });
  await friend.click('#joinBtn');
  await friendNav;

  await admin.waitForFunction(
    () => document.querySelectorAll('#lobbyPlayers .lobby-player').length === 2,
    { timeout: 8000 }
  );
  assert.equal(await friend.$eval('#adminPanel', (el) => el.classList.contains('hidden')), true);
  assert.equal(await friend.$eval('#startBtn', (el) => el.classList.contains('hidden')), true);
  await friend.screenshot({ path: `${shots}/lobby-friend.png` });

  await admin.click('#startBtn');
  await admin.waitForFunction(
    () => document.querySelector('#lobbyOverlay').classList.contains('hidden'),
    { timeout: 8000 }
  );
  await waitText(admin, '#turnBanner', 'Your turn');

  assert.match(
    await admin.$eval('#playersPanel .player-sub', (el) => el.textContent),
    /Ate 0/,
    'capture counter is visible'
  );

  await admin.click('#joinVideoBtn');
  await admin.waitForSelector('#camBtn:not(.hidden)', { timeout: 8000 });
  await admin.waitForFunction(
    () => document.querySelectorAll('.video-tile.has-video').length >= 1,
    { timeout: 8000 }
  );
  await friend.click('#joinVideoBtn');
  await friend.waitForSelector('#camBtn:not(.hidden)', { timeout: 8000 });
  await admin.waitForFunction(
    () => document.querySelectorAll('.video-tile.has-video').length === 2,
    { timeout: 12000 }
  );
  await friend.waitForFunction(
    () => document.querySelectorAll('.video-tile.has-video').length === 2,
    { timeout: 12000 }
  );

  await admin.click('#camBtn');
  await friend.waitForFunction(
    () => {
      const tile = document.querySelector('.video-tile:not(.self)');
      return tile && !tile.classList.contains('has-video') && tile.textContent.includes('cam off');
    },
    { timeout: 6000 }
  );
  await admin.click('#camBtn');
  await friend.waitForFunction(
    () => {
      const tile = document.querySelector('.video-tile:not(.self)');
      return tile && tile.classList.contains('has-video');
    },
    { timeout: 8000 }
  );

  await admin.click('#reactionBar button[data-text="LOL!"]');
  await friend.waitForFunction(
    () => {
      const el = document.querySelector('.float-text');
      return el && el.textContent.includes('LOL!');
    },
    { timeout: 5000 }
  );
  await admin.screenshot({ path: `${shots}/video-chat.png` });

  await admin.click('.switch .slider');
  await admin.waitForFunction(
    () => document.querySelector('#forceStatus').textContent.includes('ON'),
    { timeout: 4000 }
  );
  await admin.click('.force-num[data-value="6"]');
  await admin.waitForFunction(
    () => document.querySelector('.force-num.selected')?.dataset.value === '6',
    { timeout: 4000 }
  );
  await admin.screenshot({ path: `${shots}/game-admin-before-roll.png` });

  await admin.click('#rollBtn');
  await admin.waitForFunction(
    () =>
      document.querySelector('#dice').dataset.value === '6' &&
      !document.querySelector('#dice').classList.contains('rolling'),
    { timeout: 8000 }
  );
  await admin.waitForFunction(
    () => document.querySelectorAll('.token.movable').length === 4,
    { timeout: 6000 }
  );
  await new Promise((r) => setTimeout(r, 350));
  await waitText(admin, '#turnBanner', 'Your move');
  await admin.screenshot({ path: `${shots}/game-admin-rolled-6.png` });

  assert.equal(
    await friend.evaluate(() => document.querySelector('#dice').dataset.value),
    '6',
    'friend sees the same forced dice result'
  );
  assert.equal(
    await friend.evaluate(() => document.querySelectorAll('.token.movable').length),
    0,
    'friend cannot move during admin turn'
  );

  await admin.click('.token.movable');
  await admin.waitForFunction(
    () => document.querySelector('#turnBanner').textContent.includes('Your turn'),
    { timeout: 8000 }
  );
  await new Promise((r) => setTimeout(r, 700));

  const tokenPosition = await admin.evaluate(() => {
    const board = document.querySelector('#board').getBoundingClientRect();
    const token = document.querySelector('.token.token-red[data-index="0"]').getBoundingClientRect();
    return {
      x: ((token.left + token.width / 2 - board.left) / board.width) * 15,
      y: ((token.top + token.height / 2 - board.top) / board.height) * 15
    };
  });
  assert.ok(Math.abs(tokenPosition.x - 1.5) < 0.3, `token on start column, got ${tokenPosition.x}`);
  assert.ok(Math.abs(tokenPosition.y - 6.5) < 0.3, `token on start row, got ${tokenPosition.y}`);
  await admin.screenshot({ path: `${shots}/game-after-move.png` });

  await admin.evaluate(() => sessionStorage.clear());
  await admin.reload({ waitUntil: 'networkidle0' });
  await admin.waitForFunction(
    () => document.querySelector('#roomCode').textContent.length === 6,
    { timeout: 8000 }
  );
  await waitText(admin, '#turnBanner', 'Your turn');
  assert.equal(
    await admin.$eval('#adminPanel', (el) => el.classList.contains('hidden')),
    false,
    'admin status restored after losing session storage'
  );
  assert.equal(await admin.$eval('#forceToggle', (el) => el.checked), true);

  await admin.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 500));
  await admin.screenshot({ path: `${shots}/mobile-game.png`, fullPage: true });

  assert.deepEqual(errors, [], `browser errors:\n${errors.join('\n')}`);
  console.log(`e2e passed, room ${roomCode}, screenshots in ${shots}`);
} finally {
  await browser.close();
}
