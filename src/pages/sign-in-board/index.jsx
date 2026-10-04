import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Header from '../../components/navigation/Header';
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
  const [searchParams] = useSearchParams();
  // Kiosk mode = the locked door iPad (home-screen / Guided Access). It has no
  // personal dashboard to go back to, so hide the back link there. A crew member
  // who opens the board from their dashboard (plain /sign-in-board) keeps it.
  // Standby = the always-on door iPad. It shows a calm glance screen and wakes to
  // the interactive board on tap, returning to standby after a spell of no touches.
  const standbyParam = searchParams.get('mode') === 'standby' || searchParams.get('standby') === '1';
  const kiosk = searchParams.get('kiosk') === '1' || searchParams.get('mode') === 'kiosk' || standbyParam;
  // Door-iPad flow: 'glance' (always-on standby) → tap → 'board' (stripped quick
  // sign-in) → 'muster' (emergency roll call). null = the normal full board.
  const [doorView, setDoorView] = useState(standbyParam ? 'glance' : null);
  const [mustered, setMustered] = useState({}); // personKey -> true when accounted for
  const { session, activeTenantId } = useAuth();
  const meId = session?.user?.id;
  const now = useClock();

  const [vesselName, setVesselName] = useState('');
  const [crew, setCrew] = useState([]);
  const [guests, setGuests] = useState([]);
  const [contractors, setContractors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState({});
  const [tab, setTab] = useState('crew'); // crew | guests | visitors
  const [imgErr, setImgErr] = useState({}); // card key -> true when its photo failed to load
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addCompany, setAddCompany] = useState('');
  const [addPhone, setAddPhone] = useState('');
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

  // After waking the door iPad to the quick board, drop back to the standby
  // glance once there's been no interaction for a while, so it's always ready at
  // the gangway. Muster is never auto-dismissed — an emergency roll call stays up.
  useEffect(() => {
    if (doorView !== 'board') return;
    let t;
    const reset = () => { clearTimeout(t); t = setTimeout(() => setDoorView('glance'), 60000); };
    const evs = ['pointerdown', 'keydown', 'touchstart'];
    reset();
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => { clearTimeout(t); evs.forEach((e) => window.removeEventListener(e, reset)); };
  }, [doorView]);

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
    if (!addName.trim() || !addPhone.trim()) return;
    setAddBusy(true);
    try {
      await addContractor(activeTenantId, addName, addCompany, addPhone, meId);
      setAddOpen(false); setAddName(''); setAddCompany(''); setAddPhone('');
      load();
    } catch (e) { showToast(e.message || 'Could not add visitor', 'error'); }
    finally { setAddBusy(false); }
  };

  const crewAboard = crew.filter((c) => c.status === ABOARD).length;
  const guestsOn = guests.filter((g) => g.onboard).length;
  const pob = crewAboard + guestsOn + contractors.length;
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long' });

  const personCard = (opts) => {
    const { key, on, name, sub, sub2, onClick, disabled, backAt } = opts;
    return (
      <button key={key} type="button" className={`sib-card ${on ? 'aboard' : 'ashore'}`} onClick={onClick} disabled={disabled} aria-pressed={on}>
        <span className="sib-av">
          {opts.img && !imgErr[key]
            ? <img src={opts.img} alt="" onError={() => setImgErr((e) => ({ ...e, [key]: true }))} />
            : <span className="sib-ini">{initials(name)}</span>}
        </span>
        <span className="sib-name">{name}</span>
        {sub && <span className="sib-dept">{sub}</span>}
        {sub2 && <span className="sib-phone"><Icon name="Phone" size={11} /> {sub2}</span>}
        <span className={`sib-toggle ${on ? 'aboard' : 'ashore'}`} aria-hidden="true">
          <span className="sib-toggle-hl" />
          <span className="sib-half l">Aboard</span>
          <span className="sib-half r">Ashore</span>
        </span>
        {!on && backAt && <span className="sib-backcap">Back {hhmm(backAt)}</span>}
      </button>
    );
  };

  const tabs = [
    { id: 'crew', label: 'Crew', n: crew.length },
    { id: 'guests', label: 'Guests', n: guests.length },
    { id: 'visitors', label: 'Visitors', n: contractors.length },
  ];

  const crewAshore = crew.length - crewAboard;
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  // Everyone the muster accounts for: all crew (aboard or ashore), plus guests
  // on board and signed-in visitors. `aboard` flags who is expected present.
  const musterRoster = [
    ...crew.map((m) => ({ key: `c:${m.userId}`, name: m.name, sub: m.department, aboard: m.status === ABOARD, img: m.avatarUrl })),
    ...guests.filter((g) => g.onboard).map((g) => ({ key: `g:${g.id}`, name: g.name, sub: g.cabin || 'Guest', aboard: true })),
    ...contractors.map((k) => ({ key: `k:${k.id}`, name: k.name, sub: k.company || 'Visitor', aboard: true })),
  ];
  const expected = musterRoster.filter((p) => p.aboard);
  const musteredAboard = expected.filter((p) => mustered[p.key]).length;
  const toggleMuster = (key) => setMustered((m) => { const n = { ...m }; if (n[key]) delete n[key]; else n[key] = true; return n; });

  // ── Standby glance (always-on door iPad) ───────────────────────────────────
  if (doorView === 'glance') {
    return (
      <div className="sib-sb" onClick={() => setDoorView('board')} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setDoorView('board'); }}>
        <div className="sib-sb-inner">
          <p className="editorial-meta sib-sb-meta">
            <span className="dot">●</span>
            <span>On board</span>
            <span className="bar" />
            <span className="muted">{dateStr}</span>
          </p>
          <h1 className="sib-sb-vessel">{vesselName || 'On board'}<span className="period">.</span></h1>
          <div className="sib-sb-clock">{timeStr}</div>
          <div className="sib-sb-stats">
            <div className="sib-sb-stat primary"><span className="n">{pob}</span><span className="l">Aboard</span></div>
            <div className="sib-sb-stat"><span className="n">{crewAboard}</span><span className="l">Crew</span></div>
            <div className="sib-sb-stat"><span className="n">{guestsOn}</span><span className="l">Guests</span></div>
            <div className="sib-sb-stat"><span className="n">{contractors.length}</span><span className="l">Visitors</span></div>
            {crewAshore > 0 && <div className="sib-sb-stat ashore"><span className="n">{crewAshore}</span><span className="l">Ashore</span></div>}
          </div>
        </div>
        <div className="sib-sb-cta">
          <span className="sib-sb-tap"><Icon name="Hand" size={16} /> Tap anywhere to sign in or out</span>
        </div>
      </div>
    );
  }

  // ── Muster (emergency roll call) ───────────────────────────────────────────
  if (doorView === 'muster') {
    const allAccounted = expected.length > 0 && musteredAboard === expected.length;
    return (
      <div className="sibm">
        <div className="sibm-top">
          <div className="sibm-head-l">
            <p className="sibm-eyebrow"><span className="dot">●</span> Muster · {vesselName || 'On board'}</p>
            <h1 className="sibm-title">{musteredAboard} <span className="sibm-of">/ {expected.length}</span> accounted</h1>
          </div>
          <div className="sibm-head-r">
            <span className={`sibm-status ${allAccounted ? 'ok' : 'warn'}`}>
              {allAccounted ? 'All accounted for' : `${expected.length - musteredAboard} to find`}
            </span>
            <button type="button" className="sibm-btn ghost" onClick={() => setMustered({})}>Reset</button>
            <button type="button" className="sibm-btn" onClick={() => setDoorView('board')}>Exit muster</button>
          </div>
        </div>
        <div className="sibm-grid">
          {musterRoster.map((p) => {
            const done = !!mustered[p.key];
            return (
              <button key={p.key} type="button"
                className={`sibm-cell${done ? ' done' : ''}${p.aboard ? '' : ' ashore'}`}
                onClick={() => toggleMuster(p.key)}>
                <span className="sibm-check">{done ? <Icon name="Check" size={18} /> : null}</span>
                <span className="sibm-nm">
                  <span className="sibm-person">{p.name}</span>
                  <span className="sibm-sub">{p.aboard ? (p.sub || '') : 'Ashore'}</span>
                </span>
              </button>
            );
          })}
        </div>
        <footer className="sibm-foot">Tap each person once they’re at the muster station · ashore crew are shown greyed</footer>
      </div>
    );
  }

  // ── Quick board (woken from standby — tap your name to flip your status) ─────
  if (doorView === 'board') {
    return (
      <div className="sibq">
        <div className="sibq-top">
          <div className="sibq-brand">
            <span className="sibq-vessel">{vesselName || 'On board'}</span>
            <span className="sibq-dot">·</span>
            <span className="sibq-clock">{timeStr}</span>
            <span className="sibq-dot">·</span>
            <span className="sibq-pob">{pob} aboard</span>
          </div>
          <div className="sibq-actions">
            <button type="button" className="sibq-btn muster" onClick={() => setDoorView('muster')}>
              <Icon name="AlertTriangle" size={16} /> Muster
            </button>
            <button type="button" className="sibq-btn" onClick={() => setDoorView('glance')}>
              <Icon name="Monitor" size={15} /> Standby
            </button>
          </div>
        </div>
        {loading ? (
          <div className="sib-loading"><LogoSpinner size={44} /></div>
        ) : (
          <div className="sibq-grid">
            {crew.map((m) => {
              const on = m.status === ABOARD;
              const key = `c:${m.userId}`;
              return (
                <button key={key} type="button" className={`sibq-tile ${on ? 'aboard' : 'ashore'}`}
                  onClick={() => toggleCrew(m)} disabled={!!pending[key]} aria-pressed={on}>
                  <span className="sibq-av">
                    {m.avatarUrl && !imgErr[key]
                      ? <img src={m.avatarUrl} alt="" onError={() => setImgErr((e) => ({ ...e, [key]: true }))} />
                      : <span className="sibq-ini">{initials(m.name)}</span>}
                  </span>
                  <span className="sibq-name">{m.name}</span>
                  {m.department && <span className="sibq-dept">{m.department}</span>}
                  <span className={`sibq-chip ${on ? 'aboard' : 'ashore'}`}>{on ? 'On board' : 'Ashore'}</span>
                </button>
              );
            })}
          </div>
        )}
        <footer className="sibq-foot">Tap your name to sign in or out</footer>
      </div>
    );
  }

  return (
    <>
      {!kiosk && <Header />}
      <div className={`sib${kiosk ? '' : ' sib--nav'}`}>
      <header className="sib-top">
        <div className="sib-utilrow">
          {kiosk ? <span /> : (
            <button type="button" className="sib-back" onClick={() => navigate('/dashboard')}>
              <Icon name="ArrowLeft" size={16} /> Back to dashboard
            </button>
          )}
          <div className="sib-utilrow-r">
            <button type="button" className="sib-standby-btn" onClick={() => setDoorView('glance')} title="Switch to the always-on door display">
              <Icon name="Monitor" size={15} /><span className="lbl">Standby</span>
            </button>
            <button type="button" className="sib-add-btn" onClick={() => setAddOpen(true)} aria-label="Add visitor">
              <Icon name="Plus" size={18} /><span className="lbl">Visitor</span>
            </button>
          </div>
        </div>
        <div className="sib-titlerow">
          <div className="sib-brand">
            <p className="editorial-meta">
              <span className="dot">●</span>
              <span>On board</span>
              <span className="bar" />
              <span className="muted">{pob} aboard</span>
              <span className="bar" />
              <span className="muted">{crewAboard} crew · {guestsOn} guests · {contractors.length} visitors</span>
            </p>
            <h1 className="sib-title">{vesselName || 'On board'}<span className="period">.</span></h1>
          </div>
          <div className="sib-clock">
            <span className="sib-time">{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
            <span className="sib-date">{dateStr}</span>
          </div>
        </div>
      </header>

      {loading ? (
        <div className="sib-loading"><LogoSpinner size={44} /></div>
      ) : (
        <div className="sib-scroll">
          <div className="sib-tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
                className={`sib-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                {t.label} <span className="sib-tab-n">{t.n}</span>
              </button>
            ))}
          </div>

          {tab === 'crew' && (crew.length === 0
            ? <p className="sib-none">No crew on duty.</p>
            : <div className="sib-grid">{crew.map((m) => personCard({
                key: `c:${m.userId}`, on: m.status === ABOARD, name: m.name, sub: m.department,
                img: m.avatarUrl, disabled: !!pending[`c:${m.userId}`], onClick: () => toggleCrew(m),
              }))}</div>)}

          {tab === 'guests' && (guests.length === 0
            ? <p className="sib-none">No guests on this trip.</p>
            : <div className="sib-grid">{guests.map((g) => personCard({
                key: `g:${g.id}`, on: g.onboard, name: g.name, sub: g.cabin || 'Guest',
                backAt: g.returningAt, disabled: !!pending[`g:${g.id}`], onClick: () => toggleGuest(g),
              }))}</div>)}

          {tab === 'visitors' && (
            <div className="sib-grid">
              {contractors.map((k) => personCard({
                key: `k:${k.id}`, on: true, name: k.name, sub: k.company || 'Visitor', sub2: k.phone,
                disabled: !!pending[`k:${k.id}`], onClick: () => signOut(k),
              }))}
              <button type="button" className="sib-add" onClick={() => setAddOpen(true)}>
                <span className="sib-add-plus"><Icon name="Plus" size={22} /></span>
                <span className="sib-add-label">Add visitor</span>
              </button>
            </div>
          )}
        </div>
      )}

      <footer className="sib-foot">Tap crew or guests to sign in/out · tap a visitor to sign them off</footer>

      {addOpen && (
        <div className="sib-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setAddOpen(false); }}>
          <div className="sib-modal">
            <div className="sib-modal-head">
              <h4>Sign in a visitor</h4>
              <button type="button" className="sib-exit sm" onClick={() => setAddOpen(false)} title="Close"><Icon name="X" size={16} /></button>
            </div>
            <label className="sib-field"><span>Name</span>
              <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Full name" autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') submitContractor(); }} />
            </label>
            <label className="sib-field"><span>Contact number <em>for emergencies</em></span>
              <input value={addPhone} onChange={(e) => setAddPhone(e.target.value)} placeholder="Mobile number" type="tel" inputMode="tel"
                onKeyDown={(e) => { if (e.key === 'Enter') submitContractor(); }} />
            </label>
            <label className="sib-field"><span>Company <em>optional</em></span>
              <input value={addCompany} onChange={(e) => setAddCompany(e.target.value)} placeholder="e.g. AV Marine"
                onKeyDown={(e) => { if (e.key === 'Enter') submitContractor(); }} />
            </label>
            <div className="sib-modal-foot">
              <button type="button" className="sib-btn ghost" onClick={() => setAddOpen(false)}>Cancel</button>
              <button type="button" className="sib-btn primary" onClick={submitContractor} disabled={addBusy || !addName.trim() || !addPhone.trim()}>
                Sign in
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  );
};

export default SignInBoard;
