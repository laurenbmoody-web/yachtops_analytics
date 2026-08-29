import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import LogoSpinner from '../../components/LogoSpinner';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import { showToast } from '../../utils/toast';
import { fetchPresenceBoard, setPresence, ABOARD, flip } from '../../services/crewPresence';
import {
  fetchGuestsOnBoard, setGuestOnBoard,
  fetchContractorsOnBoard, addContractor, signOutContractor,
} from '../../services/personsOnBoard';
import '../../styles/editorial.css';
import './sign-in-board.css';

// Full-screen persons-on-board board — the wake-to-screen for a shared iPad at
// the gangway. Crew, on-trip guests and signed-in contractors, each a big tap
// target. Lock the iPad onto this page with iOS Guided Access + Add to Home Screen.
const initials = (name) => {
  const parts = String(name || '').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '—';
};
const hhmm = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
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

  const [vesselName, setVesselName] = useState('');
  const [crew, setCrew] = useState([]);
  const [guests, setGuests] = useState([]);
  const [contractors, setContractors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState({});
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addCompany, setAddCompany] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!activeTenantId) return;
    supabase?.from('tenants')?.select('name')?.eq('id', activeTenantId)?.maybeSingle()
      .then(({ data }) => { if (data?.name) setVesselName(data.name); });
  }, [activeTenantId]);

  const load = useCallback(async () => {
    if (!activeTenantId) { setLoading(false); return; }
    try {
      const [c, g, k] = await Promise.all([
        fetchPresenceBoard(activeTenantId),
        fetchGuestsOnBoard(activeTenantId),
        fetchContractorsOnBoard(activeTenantId),
      ]);
      setCrew(c); setGuests(g); setContractors(k);
    } catch { /* keep last-known board on a transient failure */ }
    finally { setLoading(false); }
  }, [activeTenantId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    pollRef.current = setInterval(load, 20000);
    window.addEventListener('focus', load);
    return () => { clearInterval(pollRef.current); window.removeEventListener('focus', load); };
  }, [load]);

  const mark = (key, on) => setPending((p) => { const n = { ...p }; if (on) n[key] = true; else delete n[key]; return n; });

  const toggleCrew = async (m) => {
    const key = `c:${m.userId}`;
    if (pending[key]) return;
    const next = flip(m.status);
    setCrew((cur) => cur.map((x) => (x.userId === m.userId ? { ...x, status: next } : x)));
    mark(key, true);
    try { await setPresence(activeTenantId, m.userId, next, meId); }
    catch (e) {
      setCrew((cur) => cur.map((x) => (x.userId === m.userId ? { ...x, status: m.status } : x)));
      showToast(/row-level|denied|policy/i.test(e?.message || '') ? 'This device can only sign the logged-in person in/out.' : 'Could not update — try again', 'error');
    } finally { mark(key, false); }
  };

  const toggleGuest = async (g) => {
    const key = `g:${g.id}`;
    if (pending[key]) return;
    const next = !g.onboard;
    setGuests((cur) => cur.map((x) => (x.id === g.id ? { ...x, onboard: next, returningAt: next ? null : x.returningAt } : x)));
    mark(key, true);
    try { await setGuestOnBoard(g.id, next, meId); }
    catch (e) {
      setGuests((cur) => cur.map((x) => (x.id === g.id ? { ...x, onboard: g.onboard } : x)));
      showToast(e.message || 'Could not update — try again', 'error');
    } finally { mark(key, false); }
  };

  const signOut = async (k) => {
    const key = `k:${k.id}`;
    if (pending[key]) return;
    setContractors((cur) => cur.filter((x) => x.id !== k.id)); // optimistic remove
    mark(key, true);
    try { await signOutContractor(k.id); }
    catch (e) { showToast(e.message || 'Could not sign out — try again', 'error'); load(); }
    finally { mark(key, false); }
  };

  const submitContractor = async () => {
    if (!addName.trim()) return;
    setAddBusy(true);
    try {
      await addContractor(activeTenantId, addName, addCompany, meId);
      setAddOpen(false); setAddName(''); setAddCompany('');
      load();
    } catch (e) { showToast(e.message || 'Could not add contractor', 'error'); }
    finally { setAddBusy(false); }
  };

  const crewAboard = crew.filter((c) => c.status === ABOARD).length;
  const guestsOn = guests.filter((g) => g.onboard).length;
  const pob = crewAboard + guestsOn + contractors.length;
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long' });

  const personCard = (opts) => {
    const { key, on, name, sub, onClick, disabled, backAt } = opts;
    return (
      <button key={key} type="button" className={`sib-card ${on ? 'aboard' : 'ashore'}`} onClick={onClick} disabled={disabled} aria-pressed={on}>
        <span className="sib-av">
          {opts.img ? <img src={opts.img} alt="" /> : <span className="sib-ini">{initials(name)}</span>}
        </span>
        <span className="sib-name">{name}</span>
        {sub && <span className="sib-dept">{sub}</span>}
        <span className={`sib-pill ${on ? 'on' : 'off'}`}>
          <span className="sib-pill-dot" />
          {on ? 'Aboard' : (backAt ? `Back ${hhmm(backAt)}` : 'Ashore')}
        </span>
      </button>
    );
  };

  const section = (label, count, children) => (
    <section className="sib-section">
      <div className="sib-section-head">
        <span className="sib-section-label">{label}</span>
        <span className="sib-section-count">{count}</span>
        <span className="sib-section-rule" />
      </div>
      <div className="sib-grid">{children}</div>
    </section>
  );

  return (
    <div className="sib">
      <header className="sib-top">
        <div className="sib-brand">
          <p className="editorial-meta">
            <span className="dot">●</span>
            <span>On board</span>
            <span className="bar" />
            <span className="muted">{pob} aboard</span>
            <span className="bar" />
            <span className="muted">{crewAboard} crew · {guestsOn} guests · {contractors.length} contractors</span>
          </p>
          <h1 className="sib-title">{vesselName || 'On board'}<span className="period">.</span></h1>
        </div>
        <div className="sib-clock">
          <span className="sib-time">{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
          <span className="sib-date">{dateStr}</span>
        </div>
        <button type="button" className="sib-exit" onClick={() => navigate('/dashboard')} title="Exit board">
          <Icon name="X" size={20} />
        </button>
      </header>

      {loading ? (
        <div className="sib-loading"><LogoSpinner size={44} /></div>
      ) : (
        <div className="sib-scroll">
          {section('Crew', crewAboard, crew.length === 0
            ? <p className="sib-none">No crew on duty.</p>
            : crew.map((m) => personCard({
                key: `c:${m.userId}`, on: m.status === ABOARD, name: m.name, sub: m.department,
                img: m.avatarUrl, disabled: !!pending[`c:${m.userId}`], onClick: () => toggleCrew(m),
              })))}

          {guests.length > 0 && section('Guests', guestsOn, guests.map((g) => personCard({
            key: `g:${g.id}`, on: g.onboard, name: g.name, sub: g.cabin || 'Guest',
            backAt: g.returningAt, disabled: !!pending[`g:${g.id}`], onClick: () => toggleGuest(g),
          })))}

          {section('Contractors', contractors.length, (
            <>
              {contractors.map((k) => personCard({
                key: `k:${k.id}`, on: true, name: k.name, sub: k.company || 'Contractor',
                disabled: !!pending[`k:${k.id}`], onClick: () => signOut(k),
              }))}
              <button type="button" className="sib-add" onClick={() => setAddOpen(true)}>
                <span className="sib-add-plus"><Icon name="Plus" size={22} /></span>
                <span className="sib-add-label">Add contractor</span>
              </button>
            </>
          ))}
        </div>
      )}

      <footer className="sib-foot">Tap crew or guests to sign in/out · tap a contractor to sign them off</footer>

      {addOpen && (
        <div className="sib-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setAddOpen(false); }}>
          <div className="sib-modal">
            <div className="sib-modal-head">
              <h4>Sign in a contractor</h4>
              <button type="button" className="sib-exit sm" onClick={() => setAddOpen(false)} title="Close"><Icon name="X" size={16} /></button>
            </div>
            <label className="sib-field"><span>Name</span>
              <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Full name" autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') submitContractor(); }} />
            </label>
            <label className="sib-field"><span>Company <em>optional</em></span>
              <input value={addCompany} onChange={(e) => setAddCompany(e.target.value)} placeholder="e.g. AV Marine"
                onKeyDown={(e) => { if (e.key === 'Enter') submitContractor(); }} />
            </label>
            <div className="sib-modal-foot">
              <button type="button" className="sib-btn ghost" onClick={() => setAddOpen(false)}>Cancel</button>
              <button type="button" className="sib-btn primary" onClick={submitContractor} disabled={addBusy || !addName.trim()}>
                Sign in
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SignInBoard;
