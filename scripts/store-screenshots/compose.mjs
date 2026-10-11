// Frames each raw capture in an iPhone / iPad body on the Cargo navy canvas
// with its caption, at Apple's exact upload sizes → OUT/<device>/<name>.png
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { SHOTS, DEVICES, LOGO } from './shots.config.mjs';

const OUT = path.resolve(process.env.OUT || 'store-screenshots');
const FONTS = 'https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Inter:wght@600;700&display=swap';

function html(device, s, img) {
  const [W, H] = DEVICES[device].canvas;
  const phone = device === 'iphone';
  // Screen size keeps the capture's aspect ratio (440×956 / 1032×1376).
  const screenW = phone ? 1000 : 1640;
  const [vw, vh] = [DEVICES[device].context.viewport.width, DEVICES[device].context.viewport.height];
  const screenH = Math.round(screenW * vh / vw);
  const bezel = phone ? 26 : 30;
  const radius = phone ? 150 : 70;
  const top = phone ? 640 : 560;
  // iOS status bar (59pt on iPhone, 24pt on iPad) above the app, which in the
  // real app starts below it.
  const sbH = Math.round((phone ? 59 : 24) * screenW / vw);
  const sig = `<svg width="${phone ? 46 : 26}" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>`;
  const wifi = `<svg width="${phone ? 42 : 24}" viewBox="0 0 16 12"><path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0zM3.5 6.9a6.4 6.4 0 0 1 9 0l-1.4 1.4a4.4 4.4 0 0 0-6.2 0zM1.3 4.7a9.5 9.5 0 0 1 13.4 0l-1.4 1.4a7.5 7.5 0 0 0-10.6 0z"/></svg>`;
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${FONTS}">
<style>
*{margin:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;overflow:hidden;background:#1C1B3A;
  background-image:radial-gradient(1200px 900px at 50% ${top + 300}px, #2A2950 0%, #1C1B3A 70%);
  font-family:'Inter',system-ui,sans-serif;position:relative}
.cap{position:absolute;left:0;right:0;top:${phone ? 110 : 90}px;text-align:center;padding:0 80px}
.logo{height:${phone ? 62 : 58}px;filter:brightness(0) invert(1);margin-bottom:${phone ? 56 : 44}px}
.eb{color:#E0864F;font-weight:700;font-size:${phone ? 40 : 38}px;letter-spacing:${phone ? 8 : 9}px;text-transform:uppercase}
.eb:before{content:'●';margin-right:18px;font-size:.8em}
h1{margin-top:${phone ? 34 : 28}px;color:#fff;font-family:'DM Serif Display',Georgia,serif;font-weight:400;
  font-size:${phone ? 112 : 120}px;line-height:1.05;letter-spacing:-1px}
h1 em{color:#E0864F;font-style:italic;${phone ? 'display:block;' : ''}}
.dev{position:absolute;left:50%;top:${top}px;transform:translateX(-50%);
  width:${screenW + bezel * 2}px;height:${screenH + bezel * 2}px;padding:${bezel}px;border-radius:${radius}px;
  background:#0D0D14;box-shadow:0 0 0 ${phone ? 6 : 5}px #3B3A5A, 0 60px 120px -30px rgba(0,0,0,.6)}
.scr{width:${screenW}px;height:${screenH}px;border-radius:${radius - bezel}px;overflow:hidden;position:relative;background:#F8FAFC}
.scr img{width:100%;display:block}
.sb{height:${sbH}px;background:#fff;display:flex;align-items:center;justify-content:space-between;
  padding:${phone ? '14px 70px 0 90px' : '0 34px'};font:600 ${phone ? 40 : 22}px/1 -apple-system,'Inter',sans-serif;color:#000}
.sb i{display:inline-flex;gap:${phone ? 12 : 8}px;align-items:center}
.bat{width:${phone ? 56 : 32}px;height:${phone ? 26 : 14}px;border:${phone ? 3 : 2}px solid rgba(0,0,0,.4);border-radius:${phone ? 8 : 4}px;padding:${phone ? 3 : 2}px}
.bat:after{content:'';display:block;height:100%;width:80%;background:#000;border-radius:${phone ? 4 : 2}px}
${phone ? `.island{position:absolute;top:${bezel + 34}px;left:50%;transform:translateX(-50%);width:300px;height:88px;border-radius:44px;background:#000;z-index:2}` : `.cam{position:absolute;top:${bezel / 2 - 5}px;left:50%;width:10px;height:10px;border-radius:50%;background:#26253A;transform:translateX(-50%)}`}
</style></head><body>
<div class="cap"><img class="logo" src="${LOGO}"><div class="eb">${s.eyebrow}</div><h1>${s.title} <em>${s.em}</em></h1></div>
<div class="dev">${phone ? '<div class="island"></div>' : '<div class="cam"></div>'}<div class="scr"><div class="sb"><span>9:41</span><i>${sig}${wifi}<span class="bat"></span></i></div><img src="data:image/png;base64,${img}"></div></div>
</body></html>`;
}

const browser = await chromium.launch();
for (const device of Object.keys(DEVICES)) {
  const [W, H] = DEVICES[device].canvas;
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  fs.mkdirSync(path.join(OUT, device), { recursive: true });
  for (const s of SHOTS) {
    const raw = path.join(OUT, 'raw', `${device}_${s.name}.png`);
    if (!fs.existsSync(raw)) continue;
    await page.setContent(html(device, s, fs.readFileSync(raw).toString('base64')), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, device, `${s.name}.png`) });
    console.log('framed', device, s.name);
  }
  await page.close();
}
await browser.close();
