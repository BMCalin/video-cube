import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = new URL('..', import.meta.url).pathname;
const video =
  process.argv[2] ?? '/mnt/e/nolli/by-architect/Le Corbusier.mp4';

const server = spawn('npx', ['vite', '--port', '5199', '--strictPort'], {
  cwd: ROOT,
  stdio: 'pipe',
  detached: true,
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('dev server timeout')), 30000);
  server.stdout.on('data', (d) => {
    if (String(d).includes('Local:')) {
      clearTimeout(t);
      resolve();
    }
  });
  server.on('exit', () => reject(new Error('dev server died')));
});

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => console.log('[page]', m.text()));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('http://localhost:5199');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${ROOT}tools/repro-synthetic.png` });
  await page.setInputFiles('#file', video);
  try {
    await page.waitForSelector('#reslice:not([hidden])', { timeout: 180000 });
  } catch (e) {
    const state = await page.evaluate(() => ({
      msg: document.querySelector('#msg')?.textContent,
      msgHidden: document.querySelector('#msg')?.hidden,
      progressHidden: document.querySelector('#progress')?.hidden,
      progressText: document.querySelector('#progress-num')?.textContent,
    }));
    console.log('TIMEOUT state:', JSON.stringify(state));
    await page.screenshot({ path: `${ROOT}tools/repro.png` });
    throw e;
  }
  await page.waitForTimeout(2000);
  const state = await page.evaluate(() => {
    const cube = window.__vcCube;
    return cube
      ? {
          half: cube.half,
          scale: cube.box.scale.toArray(),
          camPos: cube.camera.position.toArray(),
        }
      : 'no __vcCube';
  });
  console.log('CUBE STATE:', JSON.stringify(state));
  await page.screenshot({ path: `${ROOT}tools/repro.png` });
  // engage an X slice mid-volume + squeeze spacing, then screenshot
  await page.click('button[data-axis="x"]');
  await page.evaluate(() => {
    const off = document.querySelector('#offset');
    off.value = '0';
    off.dispatchEvent(new Event('input', { bubbles: true }));
    const sp = document.querySelector('#spacing');
    sp.value = '0.5';
    sp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${ROOT}tools/repro-slice.png` });
  console.log('DONE screenshots at tools/repro.png + tools/repro-slice.png');
} finally {
  await browser.close();
  try {
    process.kill(-server.pid, 'SIGTERM'); // kill the whole npx->vite group
  } catch {
    /* already gone */
  }
}
