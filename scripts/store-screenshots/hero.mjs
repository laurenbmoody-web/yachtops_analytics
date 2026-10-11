// The App Store product page header (3840×1646, 21:9) and search results
// image (3840×2560, 3:2): the caption over a fan of iPhones showing the app.
// Built from the raw captures → OUT/promo/{header,search}.jpg (JPEG: Apple
// refuses images with an alpha channel).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { LOGO } from './shots.config.mjs';

const OUT = path.resolve(process.env.OUT || 'store-screenshots');
const FONTS = 'https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Inter:wght@600;700&display=swap';
const raw = (n) => fs.readFileSync(path.join(OUT, 'raw', `iphone_${n}.png`)).toString('base64');

// One iPhone, `w` px wide, with the status bar and dynamic island.
function phone(name, w, x, y, rot = 0) {
  const k = w / 1052; // scale from the 1000px screen + bezels used in compose.mjs
  const bez = 26 * k, sw = w - bez * 2, sh = sw * 956 / 440, sb = 59 * sw / 440;
  return `<div class="ph" style="left:${x}px;top:${y}px;width:${w}px;height:${sh + bez * 2}px;padding:${bez}px;border-radius:${150 * k}px;transform:rotate(${rot}deg)">
  <div class="isl" style="top:${bez + 34 * k}px;width:${300 * k}px;height:${88 * k}px"></div>
  <div class="scr" style="border-radius:${124 * k}px"><div class="sb" style="height:${sb}px;font-size:${40 * k}px;padding:${14 * k}px ${80 * k}px 0 ${100 * k}px"><span>9:41</span><span class="bat" style="width:${56 * k}px;height:${26 * k}px"></span></div>
  <img src="data:image/png;base64,${raw(name)}"></div></div>`;
}

function page(W, H, { capTop, h1, eb, phones }) {
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${FONTS}"><style>
*{margin:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;overflow:hidden;position:relative;font-family:'Inter',sans-serif;
  background:#1C1B3A;background-image:radial-gradient(${W * 0.55}px ${H * 0.7}px at 50% 75%,#2E2D58 0%,#1C1B3A 72%)}
.cap{position:absolute;left:0;right:0;top:${capTop}px;text-align:center}
.logo{height:${eb * 2.1}px;filter:brightness(0) invert(1);display:block;margin:0 auto ${eb * 0.9}px}
.eb{color:#E0864F;font-weight:700;font-size:${eb}px;letter-spacing:${eb * 0.22}px;text-transform:uppercase}
.eb:before{content:'●';margin-right:${eb * 0.45}px;font-size:.8em}
h1{margin-top:${eb * 0.7}px;color:#fff;font-family:'DM Serif Display',Georgia,serif;font-weight:400;font-size:${h1}px;line-height:1.04;letter-spacing:-1px}
h1 em{color:#E0864F}
.ph{position:absolute;background:#0D0D14;box-shadow:0 0 0 5px #3B3A5A,0 80px 160px -40px rgba(0,0,0,.65)}
.isl{position:absolute;left:50%;transform:translateX(-50%);border-radius:999px;background:#000;z-index:2}
.scr{width:100%;height:100%;overflow:hidden;background:#F8FAFC}
.scr img{width:100%;display:block}
.sb{background:#fff;display:flex;justify-content:space-between;align-items:center;font-weight:600;font-family:-apple-system,'Inter',sans-serif}
.bat{border:3px solid rgba(0,0,0,.45);border-radius:8px;background:linear-gradient(90deg,#000 75%,transparent 75%) content-box;padding:3px}
</style></head><body>
<div class="cap"><img class="logo" src="${LOGO}"><div class="eb">Superyacht operations</div><h1>Run the boat, <em>from your pocket.</em></h1></div>
${phones.join('')}
</body></html>`;
}

const fan = (W, top, w, names, gap) => {
  const n = names.length, mid = (n - 1) / 2;
  return names.map((nm, i) => {
    const d = i - mid, ww = Math.round(w * (1 - Math.abs(d) * 0.08));
    const x = W / 2 + d * gap - ww / 2, y = top + Math.abs(d) * w * 0.12;
    return phone(nm, ww, x, y, d * 3);
  });
};

const browser = await chromium.launch();
fs.mkdirSync(path.join(OUT, 'promo'), { recursive: true });
const jobs = [
  // Header: the App Store lays the icon, name and Get button over the bottom,
  // and crops the sides on narrow screens — keep the caption high and central.
  ['header', 3840, 1646, { capTop: 90, eb: 46, h1: 160,
    phones: fan(3840, 700, 600, ['5_laundry', '4_defects', '1_dashboard', '6_inventory', '7_board'], 660) }],
  ['search', 3840, 2560, { capTop: 170, eb: 58, h1: 200,
    phones: fan(3840, 960, 960, ['4_defects', '1_dashboard', '6_inventory'], 1080) }],
];
for (const [name, W, H, opts] of jobs) {
  const p = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await p.setContent(page(W, H, opts), { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(OUT, 'promo', `${name}.jpg`), type: 'jpeg', quality: 92 });
  await p.close();
  console.log('promo', name);
}
await browser.close();
