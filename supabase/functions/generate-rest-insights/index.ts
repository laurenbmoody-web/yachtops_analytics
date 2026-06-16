// Supabase Edge Function: generate-rest-insights
//
// Calls the Anthropic Claude API to propose up to 2 concrete schedule
// adjustments that bring a crew member back into MLC rest compliance WITHOUT
// losing essential coverage. The model proposes the STRATEGY (which shift to
// shorten / move / drop); the frontend recomputes the real rest deltas with
// the shared MLC engine, so the numbers shown to the user are never invented.
//
// Request body:
//   {
//     member:   { name, role, department },
//     breaches: [ { rule, label, actual, limit } ],   // failing MLC rules
//     today:    { date, rest_hours, on_duty_hours,
//                 blocks: [ { start, end, type } ] },  // HH:MM, today's shifts
//     week:     { rest_hours,                          // rolling 7d rest total
//                 days: [ { date, on_duty_hours, rest_hours } ] }
//   }
//
// Response:
//   { suggestions: [ {
//       confidence: 'high' | 'medium',
//       headline:   string,
//       body:       string,
//       change: {                       // the single edit to apply (or null)
//         shift_date:     string,       // YYYY-MM-DD
//         original_start: string|null,  // HH:MM — which block to target
//         action:         'shorten' | 'shift' | 'remove',
//         new_start:      string|null,  // HH:MM (null when action='remove')
//         new_end:        string|null,
//       } | null
//   } ] }
//
// Empty suggestions array is valid (e.g. nothing safe to change).

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

interface Block { start: string; end: string; type?: string | null; }
interface Breach { rule: string; label: string; actual?: unknown; limit?: unknown; }
interface RequestBody {
  member: { name: string; role?: string | null; department?: string | null };
  breaches: Breach[];
  today: { date: string; rest_hours: number; on_duty_hours: number; blocks: Block[] };
  week: { rest_hours: number; days: { date: string; on_duty_hours: number; rest_hours: number }[] };
}

function buildSystemPrompt(): string {
  return `You are a superyacht rota assistant helping a chief or captain bring a crew member back into MLC 2006 rest compliance.

The four MLC rules: at least 10h rest in any 24h; at least 77h rest in any 7 days; daily rest in no more than 2 periods, one of which is at least 6h; and no more than 14h continuous on duty.

You receive: the crew member's role and department, which rule(s) are breaching with their numbers, today's shift blocks, and the rolling 7-day rest picture.

Propose up to TWO concrete adjustments that would restore compliance while protecting service coverage. Fewer is better — one clean fix beats two weak ones. Return ZERO suggestions only if no safe change exists.

Each suggestion must:
- Target ONE specific shift block (reference it by its date and start time).
- Describe the change plainly in the headline (e.g. "Shorten tonight's watch by 2 hours", "Hand the 12:00 block to the 2nd stew", "Give a full day off Thursday").
- In the body, give the coverage reasoning chief-to-chief: who could absorb the slack, why it's safe. Refer to other crew by ROLE generically (e.g. "the 2nd stew", "another deckhand") — you are NOT given their names, so never invent names.
- Set confidence: 'high' when the change clearly fixes the breach with low coverage risk, 'medium' otherwise.
- Populate the structured change so the system can compute the exact rest gained.

Voice: concise, confident, no hedging, no exclamation marks, no emoji, no corporate filler ("you may want to", "it might be worth"). Write like a chief stew briefing another.

Do NOT compute or state rest-hour numbers in your text — the system calculates and displays the exact before/after. Just describe the change and the coverage logic.

Use the report_rest_suggestions tool to return your response.`;
}

function buildUserPrompt(body: RequestBody): string {
  const lines: string[] = [];
  const m = body.member || ({} as RequestBody['member']);
  lines.push(`CREW: ${m.name}${m.role ? ` · ${m.role}` : ''}${m.department ? ` · ${m.department}` : ''}`);
  lines.push('');

  if (body.breaches?.length) {
    lines.push('BREACHING RULES:');
    for (const b of body.breaches) lines.push(`- ${b.label}`);
    lines.push('');
  }

  if (body.today) {
    lines.push(`TODAY (${body.today.date}): ${body.today.rest_hours}h rest · ${body.today.on_duty_hours}h on duty`);
    if (body.today.blocks?.length) {
      for (const blk of body.today.blocks) {
        lines.push(`- ${blk.start}–${blk.end}${blk.type ? ` (${blk.type})` : ''}`);
      }
    } else {
      lines.push('- no shifts today');
    }
    lines.push('');
  }

  if (body.week) {
    lines.push(`ROLLING 7-DAY REST: ${body.week.rest_hours}h (77h minimum)`);
    if (body.week.days?.length) {
      for (const d of body.week.days) {
        lines.push(`- ${d.date}: ${d.on_duty_hours}h on duty, ${d.rest_hours}h rest`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

const REPORT_TOOL = {
  name: 'report_rest_suggestions',
  description: 'Report up to 2 schedule adjustments to restore MLC rest compliance. Empty array is valid when no safe change exists.',
  input_schema: {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        maxItems: 2,
        items: {
          type: 'object',
          properties: {
            confidence: { type: 'string', enum: ['high', 'medium'] },
            headline: { type: 'string' },
            body: { type: 'string' },
            change: {
              type: ['object', 'null'],
              properties: {
                shift_date: { type: 'string', description: 'YYYY-MM-DD of the shift to change' },
                original_start: { type: ['string', 'null'], description: 'HH:MM start of the block to target (identifies which block)' },
                action: { type: 'string', enum: ['shorten', 'shift', 'remove'] },
                new_start: { type: ['string', 'null'], description: 'HH:MM new start (null for remove)' },
                new_end: { type: ['string', 'null'], description: 'HH:MM new end (null for remove)' },
              },
              required: ['shift_date', 'action'],
            },
          },
          required: ['confidence', 'headline', 'body', 'change'],
        },
      },
    },
    required: ['suggestions'],
  },
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body: RequestBody = await req.json();
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured', suggestions: [] }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anthropicRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: buildSystemPrompt(),
        tools: [REPORT_TOOL],
        tool_choice: { type: 'tool', name: 'report_rest_suggestions' },
        messages: [{ role: 'user', content: buildUserPrompt(body) }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('[generate-rest-insights] Anthropic error:', anthropicRes.status, errText);
      return new Response(JSON.stringify({ error: 'AI service error', suggestions: [] }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await anthropicRes.json();
    const toolBlock = Array.isArray(data?.content)
      ? data.content.find((b: { type?: string; name?: string }) => b?.type === 'tool_use' && b?.name === 'report_rest_suggestions')
      : null;

    const raw = Array.isArray(toolBlock?.input?.suggestions) ? toolBlock.input.suggestions : [];
    const clean = raw
      .filter((s: { headline?: unknown; confidence?: unknown }) =>
        s && typeof s.headline === 'string' && ['high', 'medium'].includes(s.confidence as string))
      .slice(0, 2);

    return new Response(JSON.stringify({ suggestions: clean }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[generate-rest-insights] Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error', suggestions: [] }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
