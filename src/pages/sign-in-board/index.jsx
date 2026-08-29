import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import LogoSpinner from '../../components/LogoSpinner';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import { showToast } from '../../utils/toast';
import { fetchPresenceBoard, setPresence, ABOARD, flip } from '../../services/crewPresence';
import '../../styles/editorial.css';
import './sign-in-board.css';

// Full-screen crew sign-in/out board — the wake-to-screen for a shared iPad at the
// gangway. Every crew member is a big tap target: tap to flip aboard/ashore.
// Lock the iPad onto this page with iOS Guided Access + Add to Home Screen.
const initials = (name) => {
  const parts = String(name || '').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '—';
};

const useClock = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 20);
    return () => clearInterval(t);
  }, []);
  return now;
};

const SignInBoard = () => {
  const navigate = useNavigate();
  const { session, activeTenantId } = useAuth();
  const meId = session?.user?.id;
  const now = useClock();

  const [crew, setCrew] = useState([]);
  const [vesselName, setVesselName] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState({}); // userId -> true while saving
  const pollRef = useRef(null);

  useEffect(() => {
    if (!activeTenantId) return;
    supabase?.from('tenants')?.select('name')?.eq('id', activeTenantId)?.maybeSingle()
      .then(({ data }) => { if (data?.name) setVesselName(data.name); });
  }, [activeTenantId]);

  const load = useCallback(async () => {
    if (!activeTenantId) { setLoading(false); return; }
    try { setCrew(await fetchPresenceBoard(activeTenantId)); }
    catch { /* keep last-known board on a transient failure */ }
    finally { setLoading(false); }
  }, [activeTenantId]);

  useEffect(() => { load(); }, [load]);
  // Keep the board fresh across devices without a socket: poll + refetch on focus.
  useEffect(() => {
    pollRef.current = setInterval(load, 20000);
    window.addEventListener('focus', load);
    return () => { clearInterval(pollRef.current); window.removeEventListener('focus', load); };
  }, [load]);

  const toggle = async (member) => {
    if (pending[member.userId]) return;
    const next = flip(member.status);
    setCrew((cur) => cur.map((c) => (c.userId === member.userId ? { ...c, status: next } : c)));
    setPending((p) => ({ ...p, [member.userId]: true }));
    try {
      await setPresence(activeTenantId, member.userId, next, meId);
    } catch (e) {
      setCrew((cur) => cur.map((c) => (c.userId === member.userId ? { ...c, status: member.status } : c)));
      showToast(
        /row-level|denied|policy/i.test(e?.message || '')
          ? 'This device can only sign the logged-in person in/out.'
          : 'Could not update — try again',
        'error',
      );
    } finally {
      setPending((p) => { const n = { ...p }; delete n[member.userId]; return n; });
    }
  };

  const aboardCount = crew.filter((c) => c.status === ABOARD).length;
  const ashoreCount = crew.length - aboardCount;
  const hhmm = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long' });

  return (
    <div className="sib">
      <header className="sib-top">
        <div className="sib-brand">
          <p className="editorial-meta">
            <span className="dot">●</span>
            <span>Crew board</span>
            <span className="bar" />
            <span className="muted">{aboardCount} aboard</span>
            <span className="bar" />
            <span className="muted">{ashoreCount} ashore</span>
          </p>
          <h1 className="sib-title">{vesselName || 'Crew'}<span className="period">.</span></h1>
        </div>
        <div className="sib-clock">
          <span className="sib-time">{hhmm}</span>
          <span className="sib-date">{dateStr}</span>
        </div>
        <button type="button" className="sib-exit" onClick={() => navigate('/dashboard')} title="Exit board">
          <Icon name="X" size={20} />
        </button>
      </header>

      {loading ? (
        <div className="sib-loading"><LogoSpinner size={44} /></div>
      ) : crew.length === 0 ? (
        <div className="sib-empty"><Icon name="Users" size={40} /><p>No crew to show yet.</p></div>
      ) : (
        <div className="sib-grid">
          {crew.map((m) => {
            const aboard = m.status === ABOARD;
            return (
              <button
                key={m.userId}
                type="button"
                className={`sib-card ${aboard ? 'aboard' : 'ashore'}`}
                onClick={() => toggle(m)}
                disabled={!!pending[m.userId]}
                aria-pressed={aboard}
              >
                <span className="sib-av">
                  {m.avatarUrl ? <img src={m.avatarUrl} alt="" /> : <span className="sib-ini">{initials(m.name)}</span>}
                </span>
                <span className="sib-name">{m.name}</span>
                {m.department && <span className="sib-dept">{m.department}</span>}
                <span className={`sib-pill ${aboard ? 'on' : 'off'}`}>
                  <span className="sib-pill-dot" />
                  {aboard ? 'Aboard' : 'Ashore'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <footer className="sib-foot">Tap a name to sign in or out</footer>
    </div>
  );
};

export default SignInBoard;
