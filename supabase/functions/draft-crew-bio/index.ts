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
  const { name = "", role = "", nationality = "", hometown = "", languages = "", interests = "", funFact = "", favouriteDestination = "", yearsYachting = "", vessel = "", draft = "", mode = "draft", tone = "warm" } = payload;

  // Voice / tone the crew member picked. Default to "warm" if unknown.
  const TONES: Record<string, string> = {
    warm: "Warm and friendly — approachable and genuine, the kind of person you'd happily share a meal with.",
    professional: "Polished and self-assured — composed and articulate, but still a real person, not a brochure.",
    playful: "Light and playful — a wink of humour and personality; let them not take themselves too seriously.",
    adventurous: "Adventurous and spirited — a love of the sea, travel, the outdoors and the next horizon.",
  };
  const toneLine = TONES[tone] || TONES.warm;

  const facts = [
    name && `Name: ${name}`,
    role && `Role aboard: ${role}`,
    yearsYachting && `Years in yachting: ${yearsYachting}`,
    vessel && `Current vessel: ${vessel}`,
    nationality && `Nationality: ${nationality}`,
    hometown && `Hometown: ${hometown}`,
    languages && `Languages: ${languages}`,
    interests && `Interests / hobbies: ${interests}`,
    favouriteDestination && `Favourite destination: ${favouriteDestination}`,
    funFact && `Fun fact / hidden talent: ${funFact}`,
  ].filter(Boolean).join("\n");

  // This is a "who am I" introduction for the crew member, in a guest book. It
  // should read like meeting a real, interesting person — NOT a service pitch.
  const RULES = `This is a personal introduction, not a service statement. Rules:
- Lead with the PERSON: where they're from, what they love, what makes them them. Personality over professionalism.
- Their role can appear once, naturally and briefly — do NOT build the bio around service, hospitality or "making your stay perfect".
- BANNED: "passionate about hospitality", "exceptional service", "your every need", "finest/effortless service", "ensure your time aboard", "go above and beyond", and any guest-pleasing mission statement.
- Warm and human, a little character. First person. 2–3 sentences. No emojis, no clichés.`;

  const instruction = mode === "polish"
    ? `Polish and lightly improve this yacht crew member's personal introduction for the guest information book. Keep their voice and facts; fix grammar and flow; strip out any soppy service-speak so it sounds like the real person. Return only the statement text.\n\n${RULES}\n\nTone to lean into: ${toneLine}\n\nDraft:\n${draft}\n\nFacts:\n${facts}`
    : `Write a yacht crew member's personal introduction for the guest information book — a glimpse of who they are as a person.\n\n${RULES}\n\nTone to lean into: ${toneLine}\n\nReturn only the statement text.\n\nFacts:\n${facts}${draft ? `\n\nNotes from the crew member:\n${draft}` : ""}`;

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
