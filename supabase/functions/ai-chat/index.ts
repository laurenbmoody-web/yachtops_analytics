// Supabase Edge Function: ai-chat
//
// Replaces the Rocket-built AWS Lambda ("chat-completion", ap-south-1) that
// relayed the app's generic vision/document calls to OpenAI gpt-4o. Callers
// (laundry item photos, care labels, receipts — via
// src/services/aiIntegrations/chatCompletion.js) still send OpenAI-style
// chat messages, and still get an OpenAI-shaped response back, so nothing
// upstream changes. Underneath it now runs on Claude, inside our own
// Supabase project, and only for signed-in users.
//
// Request body (OpenAI chat shape):
//   {
//     messages: [{ role: 'system'|'user'|'assistant',
//                  content: string | Array<
//                    { type: 'text', text } |
//                    { type: 'image_url', image_url: { url: 'data:image/...;base64,...' } } |
//                    { type: 'file', file: { file_data: 'data:application/pdf;base64,...' } }> }],
//     parameters?: { temperature?, max_completion_tokens?, max_tokens? }
//   }
//
// Response: { choices: [{ message: { role: 'assistant', content: string } }], model, usage }
//
// Env: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY

import { createClient } from 'jsr:@supabase/supabase-js@2';

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
// Sonnet 4.5 — strong vision for reading brand/care/size labels off photos.
// Must be a real, dated model id; a bare "claude-sonnet-4-6" 404s at the API
// and surfaces to users as "couldn't read the photo".
const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_TOKENS_CAP = 8192;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

type OpenAIPart =
  | { type: 'text'; text?: string }
  | { type: 'image_url'; image_url?: { url?: string } }
  | { type: 'file'; file?: { file_data?: string; filename?: string } };

type OpenAIMessage = { role?: string; content?: string | OpenAIPart[] };

function dataUrlParts(url: string | undefined) {
  const m = /^data:([a-zA-Z0-9.+/-]+);base64,(.+)$/s.exec(url || '');
  return m ? { mediaType: m[1], data: m[2] } : null;
}

// OpenAI content → Anthropic content blocks.
function toAnthropicContent(content: OpenAIMessage['content']) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  const blocks: unknown[] = [];
  for (const part of Array.isArray(content) ? content : []) {
    if (part?.type === 'text' && part.text) {
      blocks.push({ type: 'text', text: part.text });
    } else if (part?.type === 'image_url') {
      const d = dataUrlParts(part.image_url?.url);
      if (d && d.mediaType.startsWith('image/')) {
        blocks.push({ type: 'image', source: { type: 'base64', media_type: d.mediaType, data: d.data } });
      } else if (part.image_url?.url?.startsWith('https://')) {
        blocks.push({ type: 'image', source: { type: 'url', url: part.image_url.url } });
      }
    } else if (part?.type === 'file') {
      const d = dataUrlParts(part.file?.file_data);
      if (d?.mediaType === 'application/pdf') {
        blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.data } });
      } else if (d && d.mediaType.startsWith('image/')) {
        blocks.push({ type: 'image', source: { type: 'base64', media_type: d.mediaType, data: d.data } });
      }
    }
  }
  return blocks;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: 'AI is not configured' }, 500);

  // Signed-in users only (the old Lambda URL was open to anyone).
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const supabase = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_ANON_KEY') || '', {
    auth: { persistSession: false },
  });
  const { data: userData } = await supabase.auth.getUser(token);
  if (!userData?.user) return json({ error: 'sign in required' }, 401);

  let body: { messages?: OpenAIMessage[]; parameters?: Record<string, unknown> } = {};
  try { body = await req.json(); } catch { return json({ error: 'invalid JSON' }, 400); }

  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const system = msgs
    .filter((m) => m?.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : toAnthropicContent(m.content).map((b: any) => b?.text || '').join('\n')))
    .filter(Boolean)
    .join('\n\n');
  const messages = msgs
    .filter((m) => m?.role === 'user' || m?.role === 'assistant')
    .map((m) => ({ role: m.role, content: toAnthropicContent(m.content) }))
    .filter((m) => m.content.length);
  if (!messages.length) return json({ error: 'no messages' }, 400);

  const p = body.parameters || {};
  const maxTokens = Math.min(Number(p.max_completion_tokens || p.max_tokens || 4096) || 4096, MAX_TOKENS_CAP);
  const payload: Record<string, unknown> = { model: MODEL, max_tokens: maxTokens, messages };
  if (system) payload.system = system;
  if (typeof p.temperature === 'number') payload.temperature = p.temperature;

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('[ai-chat] anthropic error', res.status, detail.slice(0, 500));
    return json({ error: 'AI request failed' }, 502);
  }
  const out = await res.json();
  const text = (out?.content || []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('');

  return json({
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: out?.stop_reason || 'stop' }],
    model: out?.model || MODEL,
    usage: out?.usage || null,
  });
});
