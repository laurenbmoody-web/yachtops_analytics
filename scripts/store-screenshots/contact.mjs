// Contact sheet of the demo vessel's inventory photos (name + location under
// each), so plain-background product shots can be picked for the store.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.env.OUT || 'store-screenshots');
const URL_ = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_ANON_KEY;
const auth = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ email: process.env.DEMO_EMAIL, password: process.env.DEMO_PASSWORD }),
}).then((r) => r.json());
const rows = await fetch(`${URL_}/rest/v1/inventory_items?select=id,name,location,sub_location,image_url&image_url=not.is.null&order=sub_location,name`, {
  headers: { apikey: KEY, authorization: `Bearer ${auth.access_token}` },
}).then((r) => r.json());
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const tiles = rows.map((r, i) => `<figure><img src="${esc(r.image_url)}"><figcaption><b>${i + 1}.</b> ${esc(r.name)}<br><span>${esc(r.location)} › ${esc(r.sub_location)}</span></figcaption></figure>`).join('');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.setContent(`<!doctype html><style>body{font:14px Inter,system-ui,sans-serif;margin:20px;background:#fff}
.g{display:grid;grid-template-columns:repeat(6,1fr);gap:14px}figure{margin:0}img{width:100%;aspect-ratio:1;object-fit:contain;background:#eee;border:1px solid #ddd}
span{color:#888;font-size:12px}</style><div class="g">${tiles}</div>`, { waitUntil: 'networkidle' });
await page.screenshot({ path: path.join(OUT, 'contact-sheet.png'), fullPage: true });
fs.writeFileSync(path.join(OUT, 'contact-sheet.json'), JSON.stringify(rows.map((r, i) => ({ n: i + 1, id: r.id, name: r.name, sub_location: r.sub_location })), null, 1));
console.log('contact sheet:', rows.length, 'items');
await browser.close();
