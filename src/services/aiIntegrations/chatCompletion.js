import { supabase } from '../../lib/supabaseClient';

const AI_CHAT_URL = `${import.meta.env?.VITE_SUPABASE_URL || ''}/functions/v1/ai-chat`;
const ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || '';
// Document extractions (reading a multi-page order into ~100 items) routinely
// take 30–60s. The shared app client aborts every request at 20s, which turned
// these into "Failed to send a request to the Edge Function". So call ai-chat
// with our own fetch and a generous ceiling instead of supabase.functions.invoke.
const AI_TIMEOUT_MS = 120000;

/**
 * Chat completion for the app's generic vision / document calls (laundry item
 * photos, care labels, receipts, inventory imports).
 *
 * Hits our `ai-chat` Supabase edge function (Claude), signed in as the current
 * user. OpenAI-style `messages` in, `{ choices: [{ message: { content } }] }` out.
 * `provider` and `model` are accepted for compatibility and ignored.
 *
 * @param {string} _provider
 * @param {string} _model
 * @param {array} messages - OpenAI-style chat messages (text, image_url data URIs, PDF file_data)
 * @param {object} options - { temperature, max_completion_tokens }
 */
export async function getChatCompletion(_provider, _model, messages, options = {}) {
  let token = ANON_KEY;
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) token = data.session.access_token;
  } catch { /* fall back to the anon key */ }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(AI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
        'X-Client-Info': 'supabase-js-web',
      },
      body: JSON.stringify({ messages, parameters: options }),
      signal: controller.signal,
    });
  } catch (e) {
    throw new Error(
      e?.name === 'AbortError'
        ? 'The AI took too long to respond. Try a smaller or clearer document.'
        : 'Could not reach the AI service. Check your connection and try again.',
    );
  } finally {
    clearTimeout(timer);
  }

  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok || json?.error) {
    throw new Error(json?.error || `AI request failed (${res.status})`);
  }
  return json;
}

/**
 * Streaming-compatible wrapper. The edge function answers in one piece, so this
 * delivers the whole reply as a single chunk.
 */
export async function getStreamingChatCompletion(
  provider,
  model,
  messages,
  onChunk,
  onComplete,
  onError,
  options = {}
) {
  try {
    const res = await getChatCompletion(provider, model, messages, options);
    const text = res?.choices?.[0]?.message?.content || '';
    if (text) onChunk?.(text);
    onComplete?.();
  } catch (error) {
    console.error('Chat completion error:', error);
    onError?.(error);
  }
}
