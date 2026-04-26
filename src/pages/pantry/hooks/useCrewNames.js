// useCrewNames — Map<user_id, { firstName, fullName }> for the active tenant.
//
// Used by stew-notes surfaces to render "completed HH:MM by Sarah" metadata
// on done-rows when the completer isn't the current user. profiles stores a
// single full_name field, so first name is derived by splitting on whitespace.
// "Crew" is the fallback when the profile is missing or full_name is empty.
//
// One fetch on mount per tenant — small payload, infrequent change. No need
// for a refetch surface yet; if/when crew profile edits land, a refetch can
// be wired through.

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';

export function useCrewNames() {
  const { user } = useAuth();
  const [byId, setById] = useState(() => new Map());

  useEffect(() => {
    let cancelled = false;
    if (!user) { setById(new Map()); return; }

    (async () => {
      const { data: member } = await supabase
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', user.id)
        .eq('active', true)
        .single();
      if (!member || cancelled) return;

      const { data: members } = await supabase
        .from('tenant_members')
        .select('user_id')
        .eq('tenant_id', member.tenant_id)
        .eq('active', true);
      if (cancelled) return;

      const userIds = (members ?? []).map(m => m.user_id).filter(Boolean);
      if (userIds.length === 0) { setById(new Map()); return; }

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);
      if (cancelled) return;

      const m = new Map();
      for (const p of (profiles ?? [])) {
        const fullName  = p.full_name ?? '';
        const firstName = (fullName.trim().split(/\s+/)[0]) || 'Crew';
        m.set(p.id, { firstName, fullName });
      }
      setById(m);
    })();

    return () => { cancelled = true; };
  }, [user]);

  return byId;
}
