import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../components/AppIcon';
import { supabase } from '../../lib/supabaseClient';

// Command approval list for crew notification-email requests. Crew request an
// address in their own Settings; Command approves/declines here (or from the
// bell notification that deep-links to this section). Approval is what writes
// crew_notification_emails, via the decide_notification_email_request RPC.
const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
};

export default function NotificationEmailRequests({ tenantId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!tenantId) { setItems([]); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const { data: reqs, error: rErr } = await supabase
        .from('notification_email_requests')
        .select('id, user_id, requested_email, requested_at')
        .eq('tenant_id', tenantId)
        .eq('status', 'pending')
        .order('requested_at', { ascending: false });
      if (rErr) throw rErr;
      const rows = reqs || [];
      if (rows.length === 0) { setItems([]); setLoading(false); return; }
      const ids = [...new Set(rows.map(r => r.user_id))];
      const { data: profs } = await supabase.from('profiles').select('id, full_name, email').in('id', ids);
      const nameMap = new Map((profs || []).map(p => [p.id, p]));
      setItems(rows.map(r => ({ ...r, requester: nameMap.get(r.user_id) })));
    } catch (e) {
      console.warn('[NotificationEmailRequests] load failed', e);
      setError('Couldn’t load requests.');
      setItems([]);
    } finally { setLoading(false); }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const decide = async (id, approve) => {
    setBusyId(id); setError(null);
    try {
      const { error: dErr } = await supabase.rpc('decide_notification_email_request', { p_request_id: id, p_approve: approve });
      if (dErr) throw dErr;
      setItems(prev => prev.filter(r => r.id !== id));
    } catch (e) {
      console.warn('[NotificationEmailRequests] decide failed', e);
      setError('Couldn’t save that decision.');
    } finally { setBusyId(null); }
  };

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: '#1C1B3A', maxWidth: 640 }}>
      <p style={{ fontSize: 13.5, color: '#6F7396', margin: '0 0 18px', lineHeight: 1.5 }}>
        Crew can request where this vessel’s alerts are sent. Approve to route their notifications to the new address, or decline to keep their login email.
      </p>

      {error && <div style={{ fontSize: 13, color: '#B23B2E', marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <div style={{ fontSize: 13, color: '#8B8478', padding: '18px 0' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '40px 0', textAlign: 'center' }}>
          <span style={{ width: 46, height: 46, borderRadius: '50%', background: '#F5F3EE', display: 'grid', placeItems: 'center' }}>
            <Icon name="Check" size={20} color="#B7B1A5" />
          </span>
          <p style={{ fontSize: 13, color: '#8B8478', margin: 0 }}>No pending requests</p>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E6E8EF', borderRadius: 14, overflow: 'hidden' }}>
          {items.map((r, i) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', borderTop: i ? '1px solid #EFF1F6' : 'none' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1C1B3A' }}>{r.requester?.full_name || 'Crew member'}</div>
                <div style={{ fontSize: 12.5, color: '#6F7396', marginTop: 2 }}>
                  {r.requester?.email || ''} → <b style={{ color: '#1C1B3A', fontWeight: 600 }}>{r.requested_email}</b>
                </div>
                <div style={{ fontSize: 11.5, color: '#A29C90', marginTop: 3 }}>Requested {fmtDate(r.requested_at)}</div>
              </div>
              <button
                onClick={() => decide(r.id, true)}
                disabled={busyId === r.id}
                style={{ fontSize: 13, fontWeight: 600, borderRadius: 8, padding: '7px 14px', cursor: 'pointer', background: '#C65A1A', border: '1px solid #C65A1A', color: '#fff', whiteSpace: 'nowrap' }}
              >Approve</button>
              <button
                onClick={() => decide(r.id, false)}
                disabled={busyId === r.id}
                style={{ fontSize: 13, fontWeight: 600, borderRadius: 8, padding: '7px 14px', cursor: 'pointer', background: '#fff', border: '1px solid #EAD7D3', color: '#B23B2E', whiteSpace: 'nowrap' }}
              >Decline</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
