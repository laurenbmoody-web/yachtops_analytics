import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { useAuth } from '../../../contexts/AuthContext';
import { showToast } from '../../../utils/toast';
import { fetchMyPresence, setPresence, ABOARD, flip } from '../../../services/crewPresence';
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

  const toggle = async () => {
    if (busy || !activeTenantId || !userId) return;
    const next = flip(status);
    setStatus(next); // optimistic
    setBusy(true);
    try {
      await setPresence(activeTenantId, userId, next, userId);
    } catch (e) {
      setStatus(flip(next)); // revert
      showToast(e.message || 'Could not update — try again', 'error');
    } finally { setBusy(false); }
  };

  const aboard = status === ABOARD;

  return (
    <div className="ce-card sio rounded-xl p-5">
      <div className="sio-head">
        <h3 className="ce-title">On board</h3>
        {canOpenBoard && (
          <button type="button" className="ce-link" onClick={() => navigate('/sign-in-board')}>
            Crew board
          </button>
        )}
      </div>

      {loading ? (
        <div className="sio-skel" aria-hidden="true" />
      ) : (
        <>
          <p className={`sio-state ${aboard ? 'is-aboard' : 'is-ashore'}`}>
            <span className="sio-dot" />
            {aboard ? "You're aboard" : "You're ashore"}
          </p>

          <button
            type="button"
            className={`sio-toggle ${aboard ? 'on' : 'off'}`}
            onClick={toggle}
            disabled={busy}
            role="switch"
            aria-checked={aboard}
            aria-label={aboard ? 'Sign out — go ashore' : 'Sign in — come aboard'}
          >
            <span className="sio-track">
              <span className="sio-labels">
                <span className="l on">Aboard</span>
                <span className="l off">Ashore</span>
              </span>
              <span className="sio-knob">
                <Icon name={aboard ? 'Anchor' : 'LogOut'} size={16} />
              </span>
            </span>
          </button>

          <p className="sio-hint">{aboard ? 'Tap to sign ashore' : 'Tap to sign back aboard'}</p>
        </>
      )}
    </div>
  );
};

export default SignInOutWidget;
