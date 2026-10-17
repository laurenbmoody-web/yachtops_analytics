import { supabase } from '../../lib/supabaseClient';

/**
 * Chat completion for the app's generic vision / document calls (laundry item
 * photos, care labels, receipts).
 *
 * Runs through our own `ai-chat` Supabase edge function (Claude), signed in as
 * the current user. It used to go to a Rocket-built AWS Lambda that relayed to
 * OpenAI; the call shape is unchanged so callers didn't need to move:
 * OpenAI-style `messages` in, `{ choices: [{ message: { content } }] }` out.
 *
 * `provider` and `model` are accepted for compatibility and ignored — the edge
 * function picks the model.
 *
 * @param {string} _provider
 * @param {string} _model
 * @param {array} messages - OpenAI-style chat messages (text, image_url data URIs, PDF file_data)
 * @param {object} options - { temperature, max_completion_tokens }
 */
export async function getChatCompletion(_provider, _model, messages, options = {}) {
  const { data, error } = await supabase.functions.invoke('ai-chat', {
    body: { messages, parameters: options },
  });
  if (error || data?.error) {
    let reason = data?.error;
    try { reason = reason || (await error?.context?.json?.())?.error; } catch { /* no body */ }
    throw new Error(reason || error?.message || 'AI request failed');
  }
  return data;
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
