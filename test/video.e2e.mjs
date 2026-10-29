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

async function waitForVideo(page, selector, timeout = 15000) {
  await page.waitForFunction(
    (sel) => {
      const tile = document.querySelector(sel);
      const video = tile && tile.querySelector('video');
      return !!video && !!video.srcObject && video.readyState >= 2 && !video.paused;
    },
    { timeout },
    selector
  );
}

async function waitForNoVideo(page, selector, timeout = 10000) {
  await page.waitForFunction(
    (sel) => {
      const tile = document.querySelector(sel);
      return !!tile && !tile.classList.contains('has-video');
    },
    { timeout },
    selector
  );
}

try {
  const admin = await newPage({ width: 1280, height: 900 });
  watch(admin, 'admin');
  await admin.goto(BASE_URL, { waitUntil: 'networkidle0' });
  await admin.type('#name', 'Admin');
  const adminNav = admin.waitForNavigation({ waitUntil: 'networkidle0' });
  await admin.click('#createBtn');
  await adminNav;
  const roomCode = new globalThis.URL(admin.url()).searchParams.get('room');

  const players = [admin];
  for (let i = 2; i <= 4; i += 1) {
    const page = await newPage({ width: 1280, height: 900 });
    watch(page, `player${i}`);
    await page.goto(`${BASE_URL}/?room=${roomCode}`, { waitUntil: 'networkidle0' });
    await page.type('#name', `Player ${i}`);
    const nav = page.waitForNavigation({ waitUntil: 'networkidle0' });
    await page.click('#joinBtn');
    await nav;
    players.push(page);
  }

  await admin.waitForFunction(
    () => document.querySelectorAll('#lobbyPlayers .lobby-player').length === 4,
    { timeout: 8000 }
  );
  await admin.click('#startBtn');
  await admin.waitForFunction(
    () => document.querySelector('#lobbyOverlay').classList.contains('hidden'),
    { timeout: 8000 }
  );

  const adminId = await admin.$eval('.video-tile.self', (el) => el.dataset.player);
  const adminTile = `.video-tile[data-player="${adminId}"]`;

  for (const page of players) {
    assert.equal(await page.$eval('#videoCount', (el) => el.textContent), '0 live');
  }

  await admin.click('#joinVideoBtn');
  await admin.waitForSelector('#camBtn:not(.hidden)', { timeout: 8000 });
  await waitForVideo(admin, '.video-tile.self');

  await Promise.all(players.slice(1).map((page) => waitForVideo(page, adminTile)));
  for (const page of players.slice(1)) {
    assert.equal(await page.$eval('#joinVideoBtn', (el) => el.classList.contains('hidden')), false);
    assert.equal(await page.$eval('#videoCount', (el) => el.textContent), '1 live');
  }
  await players[1].screenshot({ path: `${shots}/video-one-camera-all.png` });

  await players[1].click('#joinVideoBtn');
  await players[1].waitForSelector('#camBtn:not(.hidden)', { timeout: 8000 });
  const secondId = await players[1].$eval('.video-tile.self', (el) => el.dataset.player);
  const secondTile = `.video-tile[data-player="${secondId}"]`;
  await Promise.all([
    waitForVideo(admin, secondTile),
    waitForVideo(players[2], secondTile),
    waitForVideo(players[3], secondTile)
  ]);
  for (const page of players) {
    await page.waitForFunction(
      () => document.querySelectorAll('.video-tile.has-video').length === 2,
      { timeout: 10000 }
    );
    assert.equal(await page.$eval('#videoCount', (el) => el.textContent), '2 live');
  }

  await admin.click('#camBtn');
  for (const page of players.slice(1)) await waitForNoVideo(page, adminTile);
  await admin.click('#camBtn');
  await Promise.all(players.slice(1).map((page) => waitForVideo(page, adminTile)));

  assert.deepEqual(errors, []);
  console.log(`video e2e passed, room ${roomCode}`);
} finally {
  await browser.close();
}
