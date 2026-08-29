import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
import { showToast } from '../../../utils/toast';
import { fetchMyPresence, setPresence, ABOARD, ASHORE } from '../../../services/crewPresence';
import './sign-in-out.css';

const initials = (name) => {
  const p = String(name || '').trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '—';
};

// Personal aboard/ashore toggle — your avatar + name above a navy⇄terracotta switch.
const SignInOutWidget = () => {
  const navigate = useNavigate();
  const { session, activeTenantId, hasCommandAccess, hasChiefAccess } = useAuth();
  const userId = session?.user?.id;
  const canOpenBoard = (typeof hasCommandAccess === 'function' && hasCommandAccess())
    || (typeof hasChiefAccess === 'function' && hasChiefAccess());

  const [status, setStatus] = useState(ABOARD);
  const [me, setMe] = useState({ name: '', avatarUrl: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!activeTenantId || !userId) { setLoading(false); return; }
    try {
      const [s, prof] = await Promise.all([
        fetchMyPresence(activeTenantId, userId),
        supabase?.from('profiles')?.select('full_name, avatar_url')?.eq('id', userId)?.maybeSingle(),
      ]);
      setStatus(s);
      setMe({ name: prof?.data?.full_name || '', avatarUrl: prof?.data?.avatar_url || null });
    } finally { setLoading(false); }
  }, [activeTenantId, userId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const choose = async (next) => {
    if (busy || next === status || !activeTenantId || !userId) return;
    const prev = status;
    setStatus(next);
    setBusy(true);
    try { await setPresence(activeTenantId, userId, next, userId); }
    catch (e) { setStatus(prev); showToast(e.message || 'Could not update — try again', 'error'); }
    finally { setBusy(false); }
  };

  const aboard = status === ABOARD;

  return (
    <div className="ce-card sio rounded-xl">
      <div className="sio-top">
        <span className="sio-eyebrow">On board</span>
        {canOpenBoard && (
          <button type="button" className="sio-boardlink" onClick={() => navigate('/sign-in-board')}>Crew board</button>
        )}
      </div>

      {loading ? (
        <div className="sio-skel" aria-hidden="true" />
      ) : (
        <div className="sio-body">
          <span className="sio-avatar">
            {me.avatarUrl ? <img src={me.avatarUrl} alt="" /> : <span className="sio-ini">{initials(me.name)}</span>}
          </span>
          {me.name && <span className="sio-name">{me.name}</span>}

          <div className={`sio-toggle ${aboard ? 'aboard' : 'ashore'}`} role="group" aria-label="Sign in or out">
            <span className="sio-toggle-hl" aria-hidden="true" />
            <button type="button" className="sio-half l" onClick={() => choose(ABOARD)} disabled={busy} aria-pressed={aboard}>Aboard</button>
            <button type="button" className="sio-half r" onClick={() => choose(ASHORE)} disabled={busy} aria-pressed={!aboard}>Ashore</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SignInOutWidget;
