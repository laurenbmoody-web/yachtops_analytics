// Supabase Edge Function: generate-rest-insights
//
// COPY MODE. The frontend's deterministic suggestionEngine decides WHICH fixes
// to show and computes every number; this function only writes the headline +
// body for each pre-decided change. The model is a copywriter, not a
// decision-maker — so it must never invent or alter a fix. Runs at temperature
// 0 with a cached system prompt so wording is stable call-to-call.
//
// Request body:
//   {
//     member:   { name, role, department },
//     breaches: [ { label } ],                 // failing MLC rules (for context)
//     changes:  [ {
//       id:            string,                 // stable id to echo back
//       kind:          'remove' | 'shorten' | 'day_off',
//       day_label:     string,                 // 'today' | 'tomorrow' | weekday
//       block_label:   string,                 // 'HH:MM–HH:MM'
//       freed_hours:   number,
//       rest_from:     number,                 // rolling-7 before
//       rest_to:       number,                 // rolling-7 after
//       resolves:      boolean,                // fully restores MLC compliance?
//       remaining_breaches: string[],          // rules still breaching if PARTIAL
//       coverage_ok:   boolean,                // is anyone free to cover the block?
//       coverage_roles: string[],              // generic roles absorbing cover
//     } ]
//   }
//
// Response: { copy: [ { id, headline, body } ] }

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

interface ChangeIn {
  id: string;
  kind: string;
  day_label: string;
  block_label: string;
  freed_hours: number;
  rest_from: number;
  rest_to: number;
  resolves: boolean;
  remaining_breaches?: string[];
  coverage_ok?: boolean;
  coverage_roles?: string[];
}
interface RequestBody {
  member: { name: string; role?: string | null; department?: string | null };
  breaches?: { label: string }[];
  changes: ChangeIn[];
}

function buildSystemPrompt(): string {
  return `You are a superyacht rota assistant writing the copy for rest-compliance fixes that have ALREADY been decided and costed by the system. You do NOT choose, change, combine, or second-guess the fixes — you only describe each one.

For EACH change you are given, write:
- HEADLINE: an imperative phrase, maximum 6 words, no numbers and no dates. Good: "Hand off the afternoon watch", "Full day off Thursday", "Trim tonight's watch". Bad headlines restate numbers or dates.
- BODY: at most 3 short sentences — what this change does for the rest picture, then who absorbs the coverage. Refer to covering crew by the ROLE(S) provided (e.g. "the 2nd stew"); never invent names. Cut filler.

Rules:
- HONESTY (most important): Each change is tagged either RESOLVES (it fully restores MLC compliance) or PARTIAL (it eases the load but a breach REMAINS). Only a RESOLVES change may say it brings the crew back into compliance / clears the breach / fixes it. For a PARTIAL change you MUST make clear it only reduces the load and the breach is NOT cleared — name the remaining breach(es) given, in plain words. Never imply or let a reader infer that a PARTIAL change restores compliance. Do not say "now compliant", "back in compliance", "resolves the breach", or similar for a PARTIAL change.
- If a PARTIAL breach is a continuous-hours / stretch breach on past days, it reflects already-worked time, so note that rescheduling can't undo it.
- COVERAGE: Each change says either COVERAGE OK (name the role(s) that absorb the block) or NO COVERAGE (nobody in the department is free during the block). For NO COVERAGE you MUST say plainly that no one is free to take it and it would need manual cover — never invent a role or claim someone absorbs it.
- DATES: use the day_label provided ("today", "tomorrow", a weekday) — never print a YYYY-MM-DD date.
- Do NOT state rest-hour numbers; the system displays the exact before/after itself.
- Voice: concise, confident, no hedging, no exclamation marks, no emoji. Chief-to-chief. Honest beats reassuring.
- Echo each change's id exactly so the system can match your copy to its fix.

Use the report_copy tool to return one {id, headline, body} per change, in the same order.`;
}

function buildUserPrompt(body: RequestBody): string {
  const lines: string[] = [];
  const m = body.member || ({} as RequestBody['member']);
  lines.push(`CREW: ${m.name}${m.role ? ` · ${m.role}` : ''}${m.department ? ` · ${m.department}` : ''}`);
  if (body.breaches?.length) {
    lines.push(`BREACHING: ${body.breaches.map(b => b.label).join('; ')}`);
  }
  lines.push('');
  lines.push('CHANGES TO DESCRIBE (write copy for each, do not alter):');
  for (const c of (body.changes || [])) {
    const roles = (c.coverage_roles && c.coverage_roles.length)
      ? c.coverage_roles.join(', ')
      : 'another crew member in the department';
    const kindLabel = c.kind === 'day_off' ? 'give a full day off (this is the only duty that day)'
      : c.kind === 'future_off' ? 'drop one duty block to lighten that day (NOT a full day off — other duty remains)'
        : c.kind === 'shorten' ? 'shorten the block' : 'remove the block';
    const remaining = (c.remaining_breaches && c.remaining_breaches.length)
      ? c.remaining_breaches.join('; ')
      : 'a breach';
    const status = c.resolves
      ? 'RESOLVES (fully restores MLC compliance)'
      : `PARTIAL (eases the load but does NOT clear it — still breaching: ${remaining})`;
    const coverage = c.coverage_ok
      ? `COVERAGE OK (absorbed by: ${roles})`
      : 'NO COVERAGE (nobody in the department is free during the block — needs manual cover)';
    lines.push(
      `- id=${c.id} · ${kindLabel} · ${c.day_label} · block ${c.block_label} · frees ${c.freed_hours}h`
      + ` · ${status}`
      + ` · ${coverage}`,
    );
  }
  return lines.join('\n').trim();
}

const REPORT_TOOL = {
  name: 'report_copy',
  description: 'Return headline + body copy for each pre-decided change, matched by id.',
  input_schema: {
    type: 'object',
    properties: {
      copy: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            headline: { type: 'string' },
            body: { type: 'string' },
          },
          required: ['id', 'headline', 'body'],
        },
      },
    },
    required: ['copy'],
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
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured', copy: [] }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!Array.isArray(body.changes) || body.changes.length === 0) {
      return new Response(JSON.stringify({ copy: [] }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 768,
        temperature: 0, // stable wording for identical inputs
        system: [{ type: 'text', text: buildSystemPrompt(), cache_control: { type: 'ephemeral' } }],
        tools: [REPORT_TOOL],
        tool_choice: { type: 'tool', name: 'report_copy' },
        messages: [{ role: 'user', content: buildUserPrompt(body) }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('[generate-rest-insights] Anthropic error:', anthropicRes.status, errText);
      return new Response(JSON.stringify({ error: 'AI service error', copy: [] }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await anthropicRes.json();
    const toolBlock = Array.isArray(data?.content)
      ? data.content.find((b: { type?: string; name?: string }) => b?.type === 'tool_use' && b?.name === 'report_copy')
      : null;

    const raw = Array.isArray(toolBlock?.input?.copy) ? toolBlock.input.copy : [];
    const clean = raw.filter((c: { id?: unknown; headline?: unknown; body?: unknown }) =>
      c && typeof c.id === 'string' && typeof c.headline === 'string' && typeof c.body === 'string');

    return new Response(JSON.stringify({ copy: clean }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[generate-rest-insights] Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error', copy: [] }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
