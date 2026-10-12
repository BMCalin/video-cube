import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const server = spawn('npx', ['vite', '--port', '5199', '--strictPort'], {
  stdio: 'pipe',
  detached: true,
});
server.stdout.on('data', async (d) => {
  if (!String(d).includes('Local:')) return;
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.goto('http://localhost:5199');
  await p.evaluate(() => {
    const op = document.querySelector('#opacity');
    op.value = '40';
    op.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.click('button[data-axis="x"]');
  await p.waitForTimeout(300);

  const probe = async (off) => {
    await p.evaluate((v) => {
      const o = document.querySelector('#offset');
      o.value = v;
      o.dispatchEvent(new Event('input', { bubbles: true }));
    }, off);
    await p.waitForTimeout(250);
    const png = (await p.screenshot()).toString('base64');
    return p.evaluate(
      async ([b64, d]) => {
        const cube = window.__vcCube;
        const v = new (cube.box.geometry.attributes.position.constructor)(3); // scratch
        const THREE_V = cube.camera.position.constructor;
        const proj = (x, y, z) => {
          const cw = document.querySelector('#cube').clientWidth || 1280;
          const p = new THREE_V(x, y, z).project(cube.camera);
          return [(p.x * 0.5 + 0.5) * cw, (-p.y * 0.5 + 0.5) * 800];
        };
        // expected: front-face cut trace (x=d, y=0, z=+half.z) and outline near edge (same line!)
        const hz = cube.half[2];
        const [ex] = proj(d, 0, hz);
        // actual: mid-row lit boundary
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, c.width, c.height).data;
        let bY0 = 1e9, bY1 = -1;
        for (let y = 0; y < c.height; y++)
          for (let x = 0; x < 900; x++) {
            const i = (y * c.width + x) * 4;
            if (px[i] > 40 || px[i + 1] > 40 || px[i + 2] > 40) {
              if (y < bY0) bY0 = y;
              if (y > bY1) bY1 = y;
            }
          }
        const r0 = bY0 + Math.floor((bY1 - bY0) * 0.45);
        const r1 = bY0 + Math.floor((bY1 - bY0) * 0.55);
        let sum = 0, n = 0;
        for (let y = r0; y <= r1; y++)
          for (let x = 0; x < 895; x++) {
            const i = (y * c.width + x) * 4;
            const j = (y * c.width + x + 4) * 4;
            if (px[i] > 40 && px[j] > 40) { sum += x; n++; break; }
          }
        return { d, expectedTraceX: +ex.toFixed(0), actualTraceX: n ? +(sum / n).toFixed(0) : null };
      },
      [png, Number(off)],
    );
  };

  for (const off of ['-0.4', '-0.2', '0', '0.1', '0.2', '0.3', '0.4']) {
    console.log(JSON.stringify(await probe(off)));
  }
  await b.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch {}
  process.exit(0);
});
