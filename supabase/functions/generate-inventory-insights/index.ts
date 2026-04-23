// Supabase Edge Function: generate-inventory-insights
//
// Calls the Anthropic Claude API to generate up to 5 anticipatory restock /
// service-risk insights for the interior crew. Input is a compact context
// block (active guests + flagged inventory + optional charter/schedule
// context the caller has confirmed is real). Output is forced through a
// tool-use schema so the response is always valid JSON with the exact
// shape the frontend expects.
//
// Request body (all fields optional-safe; caller decides what's available):
//   {
//     guests: [
//       { name, role, preferences_summary, allergies }
//     ],
//     inventory_items: [           // filter to below par / reorder BEFORE calling
//       { name, qty, unit, par, reorder }
//     ],
//     charter_days_remaining?: number,   // omit when unknown — prompt handles it
//     upcoming_events_today?: [          // omit when mock / unreliable
//       { time, title, guest_name? }
//     ]
//   }
//
// Response:
//   {
//     insights: [
//       {
//         severity: 'critical' | 'watch' | 'info',
//         sentence: string,
//         citations: string[]    // always present; [] is valid
//       }
//     ]
//   }
//
// Empty insights array is a valid response — the prompt encourages "all
// clear" over manufactured noise.

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

interface GuestContext {
  name: string;
  role?: string | null;
  preferences_summary?: string | null;
  allergies?: string | null;
}

interface InventoryContext {
  name: string;
  qty: number | null;
  unit?: string | null;
  par?: number | null;
  reorder?: number | null;
}

interface UpcomingEvent {
  time: string;
  title: string;
  guest_name?: string | null;
}

interface RequestBody {
  guests:                  GuestContext[];
  inventory_items:         InventoryContext[];
  charter_days_remaining?: number | null;
  upcoming_events_today?:  UpcomingEvent[] | null;
}

interface Insight {
  severity:  'critical' | 'watch' | 'info';
  sentence:  string;
  citations: string[];
}

// ─── System prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are an assistant helping the interior crew of a superyacht anticipate restock needs and avoid service problems.

You will receive a compact context block: active guests with names, preferences, and allergies; current inventory items (filtered to only those below par or otherwise flagged); days remaining in the charter (when known); and the next few scheduled events today (when known).

Return up to 5 insights. Fewer is better. Return ZERO insights if nothing is actually worth flagging — the user will see "All clear this week" and trust the system more for your restraint.

Each insight must:
- Name a specific item or guest
- State the triggering signal with numbers (e.g. "2 cartons left", "4-guest dinner planned", "Susan drinks 1-2 daily")
- Be time-bound ("in 1-2 days", "tonight", "this week")
- Use severity: critical (act today), watch (be aware), info (neutral)

No more than one insight per response may have severity='critical'. If more than one thing feels genuinely critical, pick the single most urgent and downgrade the others to 'watch'.

Do NOT:
- Produce generic statements ("consider restocking soon")
- Reference guest counts without specific consequences
- Use filler phrases like "it's worth noting" or "you may want to"
- Flag items in comfortable stock

Voice: match Cargo's editorial voice. Write as a chief stew speaking to another chief stew: concise, confident, no hedging. No corporate-assistant phrasing ("you may want to consider", "it might be worth", "please note"). No exclamation marks. No emoji in insight text. Sentence fragments are fine when they read cleanly.

Citations: for every insight, populate the citations array with stable slugs for the item(s) and guest(s) the insight refers to (e.g. "oat_milk", "susan"). If an insight genuinely doesn't refer to any specific item or guest, return an empty array — don't omit the field. The UI dims un-cited insights.

Use the report_insights tool to return your response.`;
}

// ─── User message (context block) ───────────────────────────────────────────

function buildUserPrompt(body: RequestBody): string {
  const lines: string[] = [];

  if (body.charter_days_remaining != null) {
    lines.push(`CHARTER: ${body.charter_days_remaining} day${body.charter_days_remaining === 1 ? '' : 's'} remaining.`);
    lines.push('');
  }

  if (body.guests?.length) {
    lines.push('ACTIVE GUESTS:');
    for (const g of body.guests) {
      const roleLabel = g.role ? ` (${g.role})` : '';
      const prefs     = (g.preferences_summary ?? '').trim() || 'no prefs on record';
      const allergies = (g.allergies ?? '').trim() || 'none';
      lines.push(`- ${g.name}${roleLabel}: ${prefs} — allergies: ${allergies}`);
    }
    lines.push('');
  }

  if (body.inventory_items?.length) {
    lines.push('INVENTORY (below par or reorder point):');
    for (const it of body.inventory_items) {
      const unit    = it.unit ? ` ${it.unit}` : '';
      const qty     = it.qty == null ? '?' : String(it.qty);
      const par     = it.par     == null ? '?' : String(it.par);
      const reorder = it.reorder == null ? '?' : String(it.reorder);
      lines.push(`- ${it.name}: ${qty}${unit} (par ${par}, reorder ${reorder})`);
    }
    lines.push('');
  }

  if (body.upcoming_events_today?.length) {
    lines.push('UPCOMING TODAY:');
    for (const ev of body.upcoming_events_today) {
      const who = ev.guest_name ? ` · ${ev.guest_name}` : '';
      lines.push(`- ${ev.time} ${ev.title}${who}`);
    }
    lines.push('');
  }

  if (lines.length === 0) {
    lines.push('No context provided. Respond with an empty insights array.');
  }

  return lines.join('\n').trim();
}

// ─── Tool schema (forces structured JSON output) ────────────────────────────

const REPORT_INSIGHTS_TOOL = {
  name: 'report_insights',
  description: 'Report zero or more inventory insights. Empty array is valid and preferred over padding with low-value items.',
  input_schema: {
    type: 'object',
    properties: {
      insights: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            severity:  { type: 'string', enum: ['critical', 'watch', 'info'] },
            sentence:  { type: 'string' },
            citations: {
              type: 'array',
              items: { type: 'string' },
              description: "Stable slugs for mentioned items/guests (e.g. 'oat_milk', 'susan'). Return [] if genuinely none apply — do not omit the field.",
            },
          },
          required: ['severity', 'sentence', 'citations'],
        },
      },
    },
    required: ['insights'],
  },
};

// ─── Server ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body: RequestBody = await req.json();

    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 1024,
        system:     buildSystemPrompt(),
        tools:      [REPORT_INSIGHTS_TOOL],
        tool_choice: { type: 'tool', name: 'report_insights' },
        messages: [
          { role: 'user', content: buildUserPrompt(body) },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('[generate-inventory-insights] Anthropic error:', anthropicRes.status, errText);
      return new Response(JSON.stringify({ error: 'AI service error', detail: errText }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anthropicData = await anthropicRes.json();

    // tool_use response shape: content is an array; find the block where
    // type === 'tool_use' and name === 'report_insights'. input is the
    // validated structured object.
    const toolBlock = Array.isArray(anthropicData?.content)
      ? anthropicData.content.find((b: { type?: string; name?: string }) =>
          b?.type === 'tool_use' && b?.name === 'report_insights')
      : null;

    if (!toolBlock?.input) {
      console.error('[generate-inventory-insights] No tool_use block in response:', JSON.stringify(anthropicData));
      return new Response(JSON.stringify({ error: 'No structured response from AI', insights: [] }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const insights: Insight[] = Array.isArray(toolBlock.input.insights) ? toolBlock.input.insights : [];

    // Belt-and-braces post-parse validation. Anthropic enforces the schema
    // server-side so this is defensive, but shipping a known-bad shape to
    // the client is worse than dropping it. Normalise: clamp to 5, coerce
    // missing citations to [], drop items lacking severity or sentence.
    const clean: Insight[] = insights
      .filter(i => i && typeof i.sentence === 'string' && ['critical', 'watch', 'info'].includes(i.severity))
      .slice(0, 5)
      .map(i => ({
        severity:  i.severity,
        sentence:  i.sentence,
        citations: Array.isArray(i.citations) ? i.citations.filter(c => typeof c === 'string') : [],
      }));

    return new Response(JSON.stringify({ insights: clean }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[generate-inventory-insights] Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
