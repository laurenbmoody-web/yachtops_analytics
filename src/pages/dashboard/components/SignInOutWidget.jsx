import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { useAuth } from '../../../contexts/AuthContext';
import { showToast } from '../../../utils/toast';
import { fetchMyPresence, setPresence, ABOARD, ASHORE } from '../../../services/crewPresence';
import './sign-in-out.css';

// Personal quick sign-in/out — a single aboard/ashore toggle for the logged-in
// crew member. The all-crew board lives at /sign-in-board (kiosk). Presence is
// the lightweight "on the boat right now" flag, not leave status.
const SignInOutWidget = () => {
  const navigate = useNavigate();
  const { session, activeTenantId, hasCommandAccess, hasChiefAccess } = useAuth();
  const userId = session?.user?.id;
  const canOpenBoard = (typeof hasCommandAccess === 'function' && hasCommandAccess())
    || (typeof hasChiefAccess === 'function' && hasChiefAccess());

  const [status, setStatus] = useState(ABOARD);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!activeTenantId || !userId) { setLoading(false); return; }
    try { setStatus(await fetchMyPresence(activeTenantId, userId)); }
    finally { setLoading(false); }
  }, [activeTenantId, userId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const choose = async (next) => {
    if (busy || next === status || !activeTenantId || !userId) return;
    const prev = status;
    setStatus(next); // optimistic
    setBusy(true);
    try {
      await setPresence(activeTenantId, userId, next, userId);
    } catch (e) {
      setStatus(prev); // revert
      showToast(e.message || 'Could not update — try again', 'error');
    } finally { setBusy(false); }
  };

  const aboard = status === ABOARD;

  return (
    <div className="ce-card sio rounded-xl p-5">
      <div className="sio-head">
        <span className="sio-eyebrow">On board</span>
        {canOpenBoard && (
          <button type="button" className="ce-link" onClick={() => navigate('/sign-in-board')}>
            Crew board
          </button>
        )}
      </div>

      {loading ? (
        <div className="sio-skel" aria-hidden="true" />
      ) : (
        <div className={`sio-seg ${aboard ? 'aboard' : 'ashore'}`} role="group" aria-label="Sign in or out">
          <span className="sio-seg-hl" aria-hidden="true" />
          <button
            type="button"
            className="sio-seg-btn"
            onClick={() => choose(ABOARD)}
            disabled={busy}
            aria-pressed={aboard}
          >
            <Icon name="Anchor" size={16} /> Aboard
          </button>
          <button
            type="button"
            className="sio-seg-btn"
            onClick={() => choose(ASHORE)}
            disabled={busy}
            aria-pressed={!aboard}
          >
            <Icon name="LogOut" size={16} /> Ashore
          </button>
        </div>
      )}
    </div>
  );
};

export default SignInOutWidget;
