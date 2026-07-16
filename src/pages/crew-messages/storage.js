import { supabase } from '../../lib/supabaseClient';

// Crew (vessel) side of supplier↔yacht messaging. Tenant members read their
// threads + messages (RLS) and send as 'vessel'. Read-state is moved via a
// SECURITY DEFINER RPC since members have no UPDATE on the threads table.

// This vessel's supplier conversations, newest activity first, with the
// supplier's name + logo for the row.
export const fetchVesselThreads = async (tenantId) => {
  const { data, error } = await supabase
    .from('supplier_message_threads')
    .select('*, supplier_profiles(id, name, logo_url), supplier_orders(id, list_id, provisioning_lists(id, title))')
    .eq('tenant_id', tenantId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
};

export const fetchThreadMessages = async (threadId) => {
  const { data, error } = await supabase
    .from('supplier_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
};

// Send a message from the vessel side. Pass replyToId to quote another message.
export const sendVesselMessage = async (threadId, body, replyToId = null) => {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('supplier_messages')
    .insert({ thread_id: threadId, sender_type: 'vessel', sender_user_id: auth?.user?.id ?? null, body, reply_to_id: replyToId })
    .select()
    .single();
  if (error) throw error;
  return data;
};

// Toggle an emoji reaction on a message (one per user). Returns the new array.
export const reactToMessage = async (messageId, emoji) => {
  const { data, error } = await supabase.rpc('react_to_message', { p_message_id: messageId, p_emoji: emoji });
  if (error) throw error;
  return data;
};

// Delete one of your own messages for everyone (soft delete).
export const deleteMessage = async (messageId) => {
  const { error } = await supabase.rpc('delete_supplier_message', { p_message_id: messageId });
  if (error) throw error;
};

// Edit the text of one of your own messages.
export const editMessage = async (messageId, body) => {
  const { error } = await supabase.rpc('edit_supplier_message', { p_message_id: messageId, p_body: body });
  if (error) throw error;
};

// Archive / restore a conversation (vessel side, via SECURITY DEFINER RPC).
export const setThreadArchived = async (threadId, archived) => {
  const { error } = await supabase.rpc('set_thread_archived_vessel', { p_thread_id: threadId, p_archived: archived });
  if (error) throw error;
};

// Delete a conversation for both sides (vessel side, via SECURITY DEFINER RPC).
export const deleteThread = async (threadId) => {
  const { error } = await supabase.rpc('delete_thread_vessel', { p_thread_id: threadId });
  if (error) throw error;
};

// Clear this vessel's unread + move its read cursor (via SECURITY DEFINER RPC).
export const markThreadReadVessel = async (threadId) => {
  const { error } = await supabase.rpc('mark_thread_read_vessel', { p_thread_id: threadId });
  if (error) throw error;
};

// Accept a supplier quote — adds its line items to the order (RPC, gated to
// vessel members). Returns the order id.
export const acceptQuote = async (messageId) => {
  const { data, error } = await supabase.rpc('accept_supplier_quote', { p_message_id: messageId });
  if (error) throw error;
  return data;
};

// Decline a supplier quote, optionally with a reason the supplier sees.
export const declineQuote = async (messageId, reason = null) => {
  const { error } = await supabase.rpc('decline_supplier_quote', { p_message_id: messageId, p_reason: reason });
  if (error) throw error;
};

// Clear any bell notifications for this thread once the crew opens it, so the
// header badge and the inbox stay in sync with the conversation's read state.
export const markThreadNotificationsRead = async (threadId) => {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return;
  await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', uid)
    .eq('type', 'supplier_message')
    .eq('action_url', `/messages?threadId=${threadId}`)
    .eq('read', false);
};

// Total unread for the vessel — drives the nav badge.
export const fetchVesselUnreadCount = async (tenantId) => {
  const { data, error } = await supabase
    .from('supplier_message_threads')
    .select('vessel_unread_count')
    .eq('tenant_id', tenantId)
    .is('archived_at', null);
  if (error) throw error;
  return (data ?? []).reduce((s, t) => s + (t.vessel_unread_count || 0), 0);
};
