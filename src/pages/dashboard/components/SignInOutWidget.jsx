import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
import { showToast } from '../../../utils/toast';
import { fetchMyPresence, setPresence, ABOARD, flip } from '../../../services/crewPresence';
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

  const toggle = async () => {
    if (busy || !activeTenantId || !userId) return;
    const next = flip(status);
    setStatus(next);
    setBusy(true);
    try { await setPresence(activeTenantId, userId, next, userId); }
    catch (e) { setStatus(flip(next)); showToast(e.message || 'Could not update — try again', 'error'); }
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

          <button
            type="button"
            className={`sio-switch ${aboard ? 'on' : 'off'}`}
            onClick={toggle}
            disabled={busy}
            role="switch"
            aria-checked={aboard}
            aria-label={aboard ? 'Aboard — tap to sign ashore' : 'Ashore — tap to sign aboard'}
          >
            <span className="sio-switch-knob" />
          </button>
          <span className={`sio-state ${aboard ? 'on' : 'off'}`}>{aboard ? 'Aboard' : 'Ashore'}</span>
        </div>
      )}
    </div>
  );
};

export default SignInOutWidget;
