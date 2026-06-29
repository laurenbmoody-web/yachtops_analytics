import { supabase } from '../../../lib/supabaseClient';

// The crew member's guest-facing profile statement + light bio fields.

export const fetchProfileStatement = async (userId) => {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('crew_profile_statements').select('*').eq('user_id', userId).maybeSingle();
  if (error) { console.error('[statement] fetch failed', error); return null; }
  return data;
};

export const saveProfileStatement = async (s) => {
  const payload = {
    user_id: s.userId,
    tenant_id: s.tenantId || null,
    statement: s.statement ?? null,
    headline: s.headline ?? null,
    hometown: s.hometown ?? null,
    languages: s.languages ?? null,
    interests: s.interests ?? null,
    updated_at: new Date().toISOString(),
    updated_by: s.actorId || null,
  };
  const { error } = await supabase
    .from('crew_profile_statements').upsert(payload, { onConflict: 'user_id' });
  if (error) throw error;
};

// AI assist — draft from facts/notes, or polish an existing draft.
export const draftStatementWithAI = async ({ mode, name, role, nationality, hometown, languages, interests, draft }) => {
  const { data, error } = await supabase.functions.invoke('draft-crew-bio', {
    body: { mode, name, role, nationality, hometown, languages, interests, draft },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data?.statement || '';
};
