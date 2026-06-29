import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// "Match my own" for the guest-book export. Given an image of an existing
// crew-profile / guest-book page, the AI maps it onto our layout engine and
// returns settings the export modal can apply directly. We don't render an
// arbitrary uploaded layout — we pick the closest built-in template plus the
// orientation and crew-per-page that best match the sample.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

const ALLOWED_MEDIA = ["image/png", "image/jpeg", "image/webp", "image/gif"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

  let payload: { imageBase64?: string; mediaType?: string } = {};
  try { payload = await req.json(); } catch { /* empty */ }
  const { imageBase64 = "", mediaType = "image/png" } = payload;
  if (!imageBase64) return json({ error: "No image provided" }, 400);
  const media = ALLOWED_MEDIA.includes(mediaType) ? mediaType : "image/png";

  const prompt = `You map an uploaded sample of a yacht crew-profile / guest-book page onto a fixed layout engine. The engine offers exactly three templates:
- "classic": centred portrait — round photo on top, name, role, short bio centred. Good for 3 per page.
- "side": photo on the left, name/role/bio stacked on the right. Good for 4 per page.
- "editorial": dark, full-bleed, magazine feel, larger type. Good for 2 per page.

Look at the uploaded page and choose the closest match. Decide page orientation (portrait or landscape) and how many crew appear per page (2, 3 or 4).

Respond with ONLY a JSON object, no prose, no code fences:
{"template":"classic|side|editorial","orientation":"portrait|landscape","perPage":2|3|4,"rationale":"one short sentence on why this matches"}`;

  try {
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: media, data: imageBase64 } },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });
    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("[adapt-guestbook-template] anthropic error", aiRes.status, t.slice(0, 200));
      return json({ error: `AI request failed (${aiRes.status})` }, 502);
    }
    const data = await aiRes.json();
    const text = (data?.content || []).map((b: { text?: string }) => b?.text || "").join("").trim();
    let parsed: Record<string, unknown> = {};
    try {
      const m = text.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    } catch { parsed = {}; }

    const template = ["classic", "side", "editorial"].includes(String(parsed.template)) ? parsed.template : "classic";
    const orientation = parsed.orientation === "landscape" ? "landscape" : "portrait";
    const perPage = [2, 3, 4].includes(Number(parsed.perPage)) ? Number(parsed.perPage) : 3;
    const rationale = typeof parsed.rationale === "string" ? parsed.rationale : "Matched to the closest built-in template.";

    return json({ template, orientation, perPage, rationale });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
