import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// AI assist for a crew member's guest-facing profile statement. Given a few
// facts (and optionally a rough draft), returns a warm, concise bio for the
// guest information book. Uses the same ANTHROPIC_API_KEY as the other AI
// functions; called from the app with the user's session (verify_jwt on).

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

  let payload: Record<string, string> = {};
  try { payload = await req.json(); } catch { /* empty */ }
  const { name = "", role = "", nationality = "", hometown = "", languages = "", interests = "", draft = "", mode = "draft" } = payload;

  const facts = [
    name && `Name: ${name}`,
    role && `Role aboard: ${role}`,
    nationality && `Nationality: ${nationality}`,
    hometown && `Hometown: ${hometown}`,
    languages && `Languages: ${languages}`,
    interests && `Interests / hobbies: ${interests}`,
  ].filter(Boolean).join("\n");

  const instruction = mode === "polish"
    ? `Polish and lightly improve this luxury-yacht crew member's guest-facing profile statement for the guest information book. Keep their voice and all facts; fix grammar and flow; keep it warm, professional and welcoming. 2–4 sentences, first person. No emojis, no clichés like "passionate about hospitality". Return only the statement text.\n\nDraft:\n${draft}\n\nFacts:\n${facts}`
    : `Write a warm, professional, guest-facing profile statement for a luxury-yacht crew member, for the guest information book. 2–4 sentences, first person, welcoming and personable, conveying their role and a little personality. No emojis, no clichés. Return only the statement text.\n\nFacts:\n${facts}${draft ? `\n\nNotes from the crew member:\n${draft}` : ""}`;

  try {
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 400, messages: [{ role: "user", content: instruction }] }),
    });
    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("[draft-crew-bio] anthropic error", aiRes.status, t.slice(0, 200));
      return json({ error: `AI request failed (${aiRes.status})` }, 502);
    }
    const data = await aiRes.json();
    const statement = (data?.content || []).map((b: { text?: string }) => b?.text || "").join("").trim();
    return json({ statement });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
