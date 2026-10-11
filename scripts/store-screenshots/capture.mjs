// Captures the App Store screenshots from the live app, signed in as the demo
// captain (M/Y Aurora). Run by .github/workflows/app-store-screenshots.yml.
//   BASE_URL       the built app (vite preview)
//   DEMO_EMAIL / DEMO_PASSWORD
//   OUT            output folder (raw/<device>_<name>.png)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { SHOTS, DEVICES } from './shots.config.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const OUT = process.env.OUT || 'store-screenshots';
const only = (process.env.ONLY || '').split(',').filter(Boolean);
fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true });

const browser = await chromium.launch();
for (const [device, vp] of Object.entries(DEVICES)) {
  const ctx = await browser.newContext({ ...vp.context, locale: 'en-GB', timezoneId: 'Europe/Paris' });
  await ctx.route(/google-analytics|googletagmanager|stripe\.com/, (r) => r.abort());
  let offline = false;
  await ctx.route(/supabase\.co/, (r) => (offline ? r.abort('internetdisconnected') : r.continue()));
  const page = await ctx.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#cl-email', process.env.DEMO_EMAIL);
  await page.fill('#cl-password', process.env.DEMO_PASSWORD);
  await page.click('button.cl-submit[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await page.waitForTimeout(4000);
  // Skip first-run tours, open inventory in icon (grid) view.
  await page.evaluate(({ zoom }) => {
    const raw = Object.keys(localStorage).find((k) => k.includes('auth-token') || k === 'supabase.auth.token');
    let uid = '';
    try { uid = JSON.parse(localStorage.getItem(raw)).user.id; } catch {}
    for (let v = 1; v < 10; v++) localStorage.setItem(`cg_tour_v${v}_done_${uid || 'anon'}`, '1');
    localStorage.setItem('cargo_inventory_view_mode', 'grid');
    localStorage.setItem('cargo_inventory_tile_zoom', String(zoom));
  }, { zoom: vp.tileZoom });

  for (const s of SHOTS) {
    if (only.length && !only.includes(s.name)) continue;
    offline = false;
    await page.goto(BASE + s.route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(s.wait || 6000);
    if (s.offline) {
      offline = true;
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(7000);
    }
    for (const c of s.clicks || []) {
      try { await page.locator(c).first().click({ timeout: 4000 }); await page.waitForTimeout(1500); } catch { console.log('  click miss', c); }
    }
    if (s.reveal) {
      // Scroll a sideways board so the column titled `reveal` comes first.
      await page.evaluate((title) => {
        const h = [...document.querySelectorAll('h2')].find((e) => e.textContent.trim() === title);
        const col = h?.closest('.tj-col-head')?.parentElement || h;
        let sc = col?.parentElement;
        while (sc && sc.scrollWidth <= sc.clientWidth) sc = sc.parentElement;
        if (sc && col) sc.scrollLeft = col.getBoundingClientRect().left - sc.getBoundingClientRect().left + sc.scrollLeft - 16;
      }, s.reveal);
      await page.waitForTimeout(600);
    }
    const scroll = s.scroll?.[device] ?? 0;
    if (scroll) { await page.mouse.wheel(0, scroll); await page.waitForTimeout(1000); }
    await page.addStyleTag({ content: '.fbw-root,[class*="feedback-widget"]{display:none!important} *{caret-color:transparent!important}' });
    await page.screenshot({ path: path.join(OUT, 'raw', `${device}_${s.name}.png`) });
    // A tall capture too, so scroll offsets can be tuned without guessing.
    await page.screenshot({ path: path.join(OUT, 'raw', `${device}_${s.name}_full.png`), fullPage: true });
    console.log(device, s.name, new URL(page.url()).pathname);
  }

  await ctx.close();
}
await browser.close();
