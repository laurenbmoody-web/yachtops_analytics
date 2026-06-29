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
  const { name = "", role = "", nationality = "", hometown = "", languages = "", studies = "", interests = "", funFact = "", favouriteDestination = "", yearsYachting = "", vessel = "", draft = "", mode = "draft", tone = "warm" } = payload;

  // Voice / tone the crew member picked. Default to "warm" if unknown. Each is
  // written to push the model to commit hard so the four voices read distinctly.
  const TONES: Record<string, string> = {
    warm: "Warm and friendly. Open with genuine warmth; conversational and heartfelt, the kind of person you'd happily share a long dinner with. Soft, personable phrasing.",
    professional: "Polished and assured. Crisp, composed sentences and understated confidence — a sense of craft and quiet competence, but still a real human, never a brochure.",
    playful: "Playful and witty. Lead with humour or a self-deprecating aside; light, cheeky, a wink in the writing. Have fun with it and don't take yourself too seriously.",
    adventurous: "Adventurous and spirited. Open on movement, the sea and far horizons; energetic verbs, a wanderer's restlessness and an obvious love of the outdoors.",
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
    studies && `Studies / training: ${studies}`,
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
- LENGTH: aim for 60–80 words. This is a hard limit — never exceed 80 words. Count as you go and tighten ruthlessly; two or three short sentences is plenty.
- Warm and human, a little character. First person. No emojis, no clichés.`;

  const instruction = mode === "polish"
    ? `Polish and lightly improve this yacht crew member's personal introduction for the guest information book. Keep their voice and facts; fix grammar and flow; strip out any soppy service-speak so it sounds like the real person. Return only the statement text.\n\n${RULES}\n\nTone to lean into: ${toneLine}\n\nDraft:\n${draft}\n\nFacts:\n${facts}`
    : `Write a yacht crew member's personal introduction for the guest information book — a glimpse of who they are as a person.\n\nWrite it COMPLETELY FRESH from the facts below. Do NOT reuse or lightly edit any existing statement — start from a blank page and give it a different spin. Commit fully to the requested voice: let it drive the opening line, the rhythm, and what you choose to emphasise, so a different voice would produce a noticeably different introduction.\n\n${RULES}\n\nVoice — commit to it fully: ${toneLine}\n\nReturn only the statement text.\n\nFacts:\n${facts}`;

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
