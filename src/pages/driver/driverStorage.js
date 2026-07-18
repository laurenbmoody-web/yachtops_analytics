import { supabase } from '../../lib/supabaseClient';

// 32-char base64url capability token for the no-login driver link.
export const genDriverToken = () => {
  const bytes = new Uint8Array(24);
  (globalThis.crypto || window.crypto).getRandomValues(bytes);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// ── Token (no-login) driver page ────────────────────────────────────────────
export const fetchOrderForDriverToken = async (token) => {
  const { data, error } = await supabase.rpc('fetch_order_for_driver_token', { p_token: token });
  if (error) throw error;
  return data; // null on miss
};

export const postDriverPingToken = async (token, { lat, lng, accuracy, heading, speed }, status = null) => {
  const { error } = await supabase.rpc('post_driver_ping_token', {
    p_token: token,
    p_lat: lat,
    p_lng: lng,
    p_accuracy: accuracy ?? null,
    p_heading: heading ?? null,
    p_speed: speed ?? null,
    p_status: status,
  });
  if (error) throw error;
};

// ── Authed internal driver ──────────────────────────────────────────────────
export const postDriverPing = async (orderId, { lat, lng, accuracy, heading, speed }) => {
  const { error } = await supabase.rpc('post_driver_ping', {
    p_order_id: orderId,
    p_lat: lat,
    p_lng: lng,
    p_accuracy: accuracy ?? null,
    p_heading: heading ?? null,
    p_speed: speed ?? null,
  });
  if (error) throw error;
};

// ── Crew / supplier: read the driver's latest position ──────────────────────
export const fetchLatestDriverPing = async (orderId) => {
  const { data, error } = await supabase
    .from('order_driver_pings')
    .select('lat, lng, accuracy_m, heading, speed, captured_at')
    .eq('order_id', orderId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
};

// The public driver-follow / capture link for an order token.
export const driverLinkForToken = (token) =>
  `${window.location.origin}/drive/${token}`;
