import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Daily AIS sync. For each vessel with an MMSI, makes ONE Data Docked location
// call (1 credit), turns the lat/lon into a country via a free reverse-geocoder
// (no credits), flags whether that country is in the Schengen area, and writes a
// single row per vessel per day into vessel_positions (source='ais').
//
// Token-gated (?t=) as defence-in-depth on top of the platform JWT check. The DB
// writes run with the service role, so they bypass RLS.

const SCHENGEN = new Set([
  "AT","BE","CZ","DK","EE","FI","FR","DE","GR","HU","IS","IT","LV","LI","LT",
  "LU","MT","NL","NO","PL","PT","SK","SI","ES","SE","CH","HR","BG","RO",
]);
const TOKEN = "belongers2026";
const num = (x: unknown) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o, null, 2), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("t") !== TOKEN) return new Response("forbidden", { status: 403 });
  const debug = url.searchParams.get("debug") === "1";

  const apiKey = Deno.env.get("DATADOCKED_API_KEY") ?? "";
  if (!apiKey) return json({ ok: false, error: "DATADOCKED_API_KEY not set" });

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: vessels, error: vErr } = await supa
    .from("vessels").select("tenant_id, name, mmsi, imo_number").not("mmsi", "is", null);
  if (vErr) return json({ ok: false, error: "vessel lookup: " + vErr.message });
  if (!vessels?.length) return json({ ok: true, count: 0, note: "no vessels with an MMSI" });

  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  const results: unknown[] = [];

  for (const v of vessels) {
    const id = v.mmsi || v.imo_number;
    // Single location call — 1 credit.
    const ep = `https://datadocked.com/api/vessels_operations/get-vessel-location?imo_or_mmsi=${encodeURIComponent(id)}`;
    let raw: unknown = null, lat: number | null = null, lon: number | null = null;
    let navStatus = "", ulocDest = "", destination = "";
    try {
      const r = await fetch(ep, { headers: { accept: "application/json", "x-api-key": apiKey } });
      const body = await r.json().catch(() => null);
      raw = { status: r.status, body };
      const d = (body && (body as Record<string, unknown>).data) ? (body as Record<string, unknown>).data as Record<string, unknown> : (body as Record<string, unknown>);
      lat = num(d?.lat ?? d?.latitude ?? d?.last_position_latitude ?? d?.LAT);
      lon = num(d?.lon ?? d?.longitude ?? d?.last_position_longitude ?? d?.LON);
      navStatus = String(d?.navigationalStatus ?? d?.navStatus ?? "");
      ulocDest = String(d?.unlocodeDestination ?? "");
      destination = String(d?.destination ?? "");
    } catch (e) { raw = { error: String(e) }; }

    if (lat == null || lon == null) {
      results.push({ vessel: v.name, ok: false, note: "no position in response", raw });
      continue;
    }

    // Country: try a land reverse-geocode first (she's in port / on a coast).
    let country: string | null = null, countryName: string | null = null;
    let zone = "offshore";
    try {
      const g = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
      const gj = await g.json();
      country = gj?.countryCode || null;
      countryName = gj?.countryName || null;
      if (country) zone = "coastal_or_land";
    } catch (_) { /* over water / failed */ }

    // Over water but moored/anchored at a port → use the port's UN/LOCODE country.
    if (!country) {
      const stopped = /moor|anchor|berth|port/i.test(navStatus);
      if (stopped && ulocDest.length >= 2) {
        country = ulocDest.slice(0, 2).toUpperCase();
        countryName = destination || country;
        zone = "in_port";
      }
    }

    const schengen = country ? SCHENGEN.has(country) : null;
    const row = {
      observed_at: nowIso, latitude: lat, longitude: lon,
      country_code: country, schengen, maritime_zone: zone,
      note: [navStatus, countryName].filter(Boolean).join(" · ") || null,
      updated_at: nowIso,
    };
    // One vessel per tenant (vessels is keyed by tenant_id), so vessel_id stays null.
    const { data: existing } = await supa.from("vessel_positions").select("id")
      .eq("tenant_id", v.tenant_id).is("vessel_id", null).eq("observed_on", today).eq("source", "ais").maybeSingle();
    let upErr;
    if (existing) ({ error: upErr } = await supa.from("vessel_positions").update(row).eq("id", existing.id));
    else ({ error: upErr } = await supa.from("vessel_positions").insert({ ...row, tenant_id: v.tenant_id, observed_on: today, source: "ais" }));

    results.push({ vessel: v.name, ok: !upErr, lat, lon, country, countryName, schengen, upsertError: upErr?.message, raw: debug ? raw : undefined });
  }

  return json({ ok: true, day: today, count: results.length, results });
});
