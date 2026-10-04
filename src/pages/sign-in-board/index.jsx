import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Header from '../../components/navigation/Header';
import LogoSpinner from '../../components/LogoSpinner';
import DoorScanModal from './components/DoorScanModal';
import DeviceSetupModal from './components/DeviceSetupModal';
import VisitorPassModal from './components/VisitorPassModal';
import { decodeVisitorPass } from './utils/visitorPass';
import { speakText } from './utils/speech';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import { showToast } from '../../utils/toast';
import { fetchPresenceBoard, setPresence, ABOARD, flip } from '../../services/crewPresence';
import { logPresenceEvent, saveMusterRecord } from '../../services/presenceLog';
import { exportMusterPdf } from './utils/musterPdf';
import {
  fetchGuestsOnBoard, setGuestOnBoard,
  fetchContractorsOnBoard, addContractor, signOutContractor,
  stepOutContractor, returnContractor, fetchRecentVisitors,
  fetchExpectedVisitors, addExpectedVisitor, activateExpected, cancelExpected,
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
  const logSource = kiosk ? 'entryway' : 'board'; // where a logged event came from
  // Door-iPad flow: 'glance' (always-on standby) → tap → 'board' (stripped quick
  // sign-in) → 'muster' (emergency roll call). null = the normal full board.
  const [doorView, setDoorView] = useState(standbyParam ? 'glance' : null);
  // Muster is a spreadsheet: people down the left, one column per roll call.
  // rollMarks[rollId][personKey] = accounted-for in that roll call.
  const [rolls, setRolls] = useState([{ id: 'r1', name: 'Roll call 1', startedAt: null }]);
  const [activeRoll, setActiveRoll] = useState('r1');
  const [rollMarks, setRollMarks] = useState({});
  const [musterSaving, setMusterSaving] = useState(false);
  const [musterSaved, setMusterSaved] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [deviceSetupOpen, setDeviceSetupOpen] = useState(false);
  const [confirm, setConfirm] = useState(null); // { name, aboard } — kiosk confirmation flash
  const [leaveVisitor, setLeaveVisitor] = useState(null); // visitor the "leaving?" popover is open for
  const [passVisitor, setPassVisitor] = useState(null); // visitor whose QR pass is being shown
  const [speakOn, setSpeakOn] = useState(() => { try { return localStorage.getItem('cargo_gangway_speak') === '1'; } catch { return false; } });
  const confirmTimer = useRef(null);
  const { session, activeTenantId, hasCommandAccess } = useAuth();
  const isCommand = typeof hasCommandAccess === 'function' && hasCommandAccess();
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
  const [addReason, setAddReason] = useState('');
  const [addAck, setAddAck] = useState(false);
  const [recentVisitors, setRecentVisitors] = useState([]);
  const [expectedVisitors, setExpectedVisitors] = useState([]); // pre-registered expected visitors
  const [fromExpected, setFromExpected] = useState(null); // expected id being signed in
  const pollRef = useRef(null);

  // Load recent (not-present) visitors when the Add panel opens, for one-tap return.
  useEffect(() => {
    if (!addOpen || !activeTenantId) return;
    setAddAck(false);
    if (!fromExpected) setAddReason('');
    let alive = true;
    fetchRecentVisitors(activeTenantId).then((v) => { if (alive) setRecentVisitors(v); });
    return () => { alive = false; };
  }, [addOpen, activeTenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeTenantId) return;
    supabase?.from('tenants')?.select('name')?.eq('id', activeTenantId)?.maybeSingle()
      .then(({ data }) => { if (data?.name) setVesselName(data.name); });
  }, [activeTenantId]);

  const load = useCallback(async () => {
    if (!activeTenantId) { setLoading(false); return; }
    try {
      const [c, g, k, ex] = await Promise.all([
        fetchPresenceBoard(activeTenantId),
        fetchGuestsOnBoard(activeTenantId),
        fetchContractorsOnBoard(activeTenantId),
        fetchExpectedVisitors(activeTenantId),
      ]);
      setCrew(c); setGuests(g); setContractors(k); setExpectedVisitors(ex);
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

  // Kiosk confirmation flash — a big "Welcome aboard, {name}" after a tap/scan on
  // the door board. Optionally spoken. Only shown in a door/kiosk context so the
  // admin board (toggling many at once) isn't interrupted.
  const inDoorContext = kiosk || doorView === 'board';
  const toggleSpeak = () => setSpeakOn((on) => { const next = !on; try { localStorage.setItem('cargo_gangway_speak', next ? '1' : '0'); } catch { /* ignore */ } return next; });
  const speak = (text) => { if (speakOn) speakText(text); };
  const flashConfirm = (name, aboard) => {
    if (!inDoorContext) return;
    setConfirm({ name, aboard });
    speak(`${aboard ? 'Welcome aboard' : 'Safe trip ashore'}, ${name}`);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirm(null), 2800);
  };
  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); }, []);

  const toggleCrew = async (m) => {
    const key = `c:${m.userId}`;
    if (pending[key]) return;
    const next = flip(m.status);
    setCrew((cur) => cur.map((x) => (x.userId === m.userId ? { ...x, status: next } : x)));
    mark(key, true);
    try {
      await setPresence(activeTenantId, m.userId, next, meId, { source: kiosk ? 'entryway' : 'board', subjectName: m.name });
      flashConfirm(m.name, next === ABOARD);
    }
    catch (e) {
      setCrew((cur) => cur.map((x) => (x.userId === m.userId ? { ...x, status: m.status } : x)));
      showToast(/row-level|denied|policy/i.test(e?.message || '') ? 'This device can only sign the logged-in person in/out.' : 'Could not update — try again', 'error');
    } finally { mark(key, false); }
  };

  // A scanned gangway pass (`cargo-pass:<userId>`, or a bare id) flips that crew
  // member's aboard/ashore status — the QR stand-in for the future NFC tap.
  const handleScan = (raw) => {
    setScanOpen(false);
    const str = String(raw || '').trim();
    // Visitor pass → sign in / return (self-contained, no lookup needed).
    const vm = /^cargo-visitor:(.+)$/i.exec(str);
    if (vm) {
      const v = decodeVisitorPass(vm[1]);
      if (!v?.name || !v?.phone) { showToast('Visitor pass not recognised', 'error'); return; }
      const existing = contractors.find((k) => norm(k.phone) === norm(v.phone));
      if (existing) {
        if (existing.state === 'stepped_out') { returnVisitor(existing); flashConfirm(v.name, true); }
        else showToast(`${v.name} is already on board — tap their card to leave`, 'info');
      } else {
        signInVisitor(v.name, v.company, v.phone, { inducted: true });
      }
      return;
    }
    const m = /^cargo-pass:(.+)$/i.exec(str);
    const uid = (m ? m[1] : str).trim();
    const member = crew.find((c) => c.userId === uid);
    if (!member) { showToast('Pass not recognised for this vessel', 'error'); return; }
    toggleCrew(member); // flips status + shows the confirmation flash
  };

  const toggleGuest = async (g) => {
    const key = `g:${g.id}`;
    if (pending[key]) return;
    const next = !g.onboard;
    setGuests((cur) => cur.map((x) => (x.id === g.id ? { ...x, onboard: next, returningAt: next ? null : x.returningAt } : x)));
    mark(key, true);
    try {
      await setGuestOnBoard(g.id, next, meId);
      logPresenceEvent({ tenantId: activeTenantId, subjectType: 'guest', subjectId: g.id, subjectName: g.name, direction: next ? 'aboard' : 'ashore', actorUserId: meId, source: logSource });
    } catch (e) {
      setGuests((cur) => cur.map((x) => (x.id === g.id ? { ...x, onboard: g.onboard } : x)));
      showToast(e.message || 'Could not update — try again', 'error');
    } finally { mark(key, false); }
  };

  const visitorMeta = (k) => ({ company: k.company || '', phone: k.phone || '' });

  // Permanent sign-off — visitor leaves for good and drops off the board.
  const signOffVisitor = async (k) => {
    const key = `k:${k.id}`;
    if (pending[key]) return;
    setLeaveVisitor(null);
    setContractors((cur) => cur.filter((x) => x.id !== k.id)); // optimistic remove
    mark(key, true);
    try {
      await signOutContractor(k.id);
      logPresenceEvent({ tenantId: activeTenantId, subjectType: 'visitor', subjectId: k.id, subjectName: k.name, direction: 'ashore', actorUserId: meId, source: logSource, meta: { ...visitorMeta(k), leave: 'permanent' } });
    } catch (e) { showToast(e.message || 'Could not sign out — try again', 'error'); load(); }
    finally { mark(key, false); }
  };

  // Temporary — stepping out (lunch). Stays on the board, greyed, "tap to return".
  const stepOutVisitor = async (k) => {
    const key = `k:${k.id}`;
    if (pending[key]) return;
    setLeaveVisitor(null);
    setContractors((cur) => cur.map((x) => (x.id === k.id ? { ...x, state: 'stepped_out' } : x)));
    mark(key, true);
    try {
      await stepOutContractor(k.id);
      logPresenceEvent({ tenantId: activeTenantId, subjectType: 'visitor', subjectId: k.id, subjectName: k.name, direction: 'ashore', actorUserId: meId, source: logSource, meta: { ...visitorMeta(k), leave: 'temporary' } });
    } catch (e) { setContractors((cur) => cur.map((x) => (x.id === k.id ? { ...x, state: 'onboard' } : x))); showToast(e.message || 'Could not update — try again', 'error'); }
    finally { mark(key, false); }
  };

  const returnVisitor = async (k) => {
    const key = `k:${k.id}`;
    if (pending[key]) return;
    setContractors((cur) => cur.map((x) => (x.id === k.id ? { ...x, state: 'onboard' } : x)));
    mark(key, true);
    try {
      await returnContractor(k.id);
      logPresenceEvent({ tenantId: activeTenantId, subjectType: 'visitor', subjectId: k.id, subjectName: k.name, direction: 'aboard', actorUserId: meId, source: logSource, meta: visitorMeta(k) });
    } catch (e) { setContractors((cur) => cur.map((x) => (x.id === k.id ? { ...x, state: 'stepped_out' } : x))); showToast(e.message || 'Could not update — try again', 'error'); }
    finally { mark(key, false); }
  };

  const signInVisitor = async (name, company, phone, opts = {}) => {
    const nm = String(name || '').trim();
    const ph = String(phone || '').trim();
    if (!nm || !ph || addBusy) return;
    const reason = String(opts.reason || '').trim();
    setAddBusy(true);
    try {
      const row = await addContractor(activeTenantId, nm, company, ph, meId, { reason, inducted: !!opts.inducted });
      logPresenceEvent({ tenantId: activeTenantId, subjectType: 'visitor', subjectId: row?.id, subjectName: nm, direction: 'aboard', actorUserId: meId, source: logSource, meta: { company: String(company || '').trim(), phone: ph, reason } });
      flashConfirm(nm, true);
      setAddOpen(false); setAddName(''); setAddCompany(''); setAddPhone(''); setAddReason(''); setAddAck(false);
      load();
    } catch (e) { showToast(e.message || 'Could not add visitor', 'error'); }
    finally { setAddBusy(false); }
  };
  // Manual new visitor — needs the safety-briefing acknowledgment. If arriving
  // from a pre-registered "expected" entry, activate that row instead of a new one.
  const submitContractor = async () => {
    if (!addAck) return;
    if (fromExpected) {
      if (addBusy) return;
      setAddBusy(true);
      try {
        const row = await activateExpected(fromExpected, { inducted: true, reason: addReason });
        logPresenceEvent({ tenantId: activeTenantId, subjectType: 'visitor', subjectId: row?.id, subjectName: addName.trim(), direction: 'aboard', actorUserId: meId, source: logSource, meta: { company: addCompany.trim(), phone: addPhone.trim(), reason: addReason.trim() } });
        flashConfirm(addName.trim(), true);
        setAddOpen(false); setFromExpected(null); setAddName(''); setAddCompany(''); setAddPhone(''); setAddReason(''); setAddAck(false);
        load();
      } catch (e) { showToast(e.message || 'Could not sign in', 'error'); }
      finally { setAddBusy(false); }
      return;
    }
    signInVisitor(addName, addCompany, addPhone, { reason: addReason, inducted: true });
  };

  // Pre-register an expected visitor (planned work) — no sign-in, no ack yet.
  const saveExpected = async () => {
    if (!addName.trim() || addBusy) return;
    setAddBusy(true);
    try {
      await addExpectedVisitor(activeTenantId, { name: addName, company: addCompany, phone: addPhone, reason: addReason }, meId);
      setAddOpen(false); setFromExpected(null); setAddName(''); setAddCompany(''); setAddPhone(''); setAddReason(''); setAddAck(false);
      showToast('Added to expected', 'success');
      load();
    } catch (e) { showToast(e.message || 'Could not save', 'error'); }
    finally { setAddBusy(false); }
  };

  // Tap an expected visitor to sign them in — prefill the induction panel.
  const arriveExpected = (x) => {
    setFromExpected(x.id);
    setAddName(x.name || ''); setAddCompany(x.company || ''); setAddPhone(x.phone || ''); setAddReason(x.reason || ''); setAddAck(false);
    setAddOpen(true);
  };

  // Prefill from a recent visitor when the typed phone matches one.
  const norm = (s) => String(s || '').replace(/\s+/g, '');
  const onAddPhone = (val) => {
    setAddPhone(val);
    if (norm(val).length >= 6) {
      const match = recentVisitors.find((v) => v.phone && norm(v.phone) === norm(val));
      if (match) { if (!addName.trim()) setAddName(match.name); if (!addCompany.trim() && match.company) setAddCompany(match.company); }
    }
  };

  const crewAboard = crew.filter((c) => c.status === ABOARD).length;
  const guestsOn = guests.filter((g) => g.onboard).length;
  const visitorsOnboard = contractors.filter((k) => k.state !== 'stepped_out').length;
  const pob = crewAboard + guestsOn + visitorsOnboard;
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

  const confirmFlash = confirm && (
    <div className={`sib-confirm ${confirm.aboard ? 'aboard' : 'ashore'}`} onClick={() => setConfirm(null)}>
      <div className="sib-confirm-ic"><Icon name={confirm.aboard ? 'Anchor' : 'LogOut'} size={54} /></div>
      <p className="sib-confirm-lead">{confirm.aboard ? 'Welcome aboard' : 'Safe trip ashore'}</p>
      <h2 className="sib-confirm-name">{confirm.name}</h2>
      <p className="sib-confirm-time">{timeStr}</p>
    </div>
  );

  // Everyone the muster accounts for: all crew (aboard or ashore), plus guests
  // on board and signed-in visitors. `aboard` flags who is expected present.
  // Crew are ordered by department (Bridge, Engineering, Deck, Interior, Galley,
  // then any others), then by name — the order used at a muster station.
  const DEPT_ORDER = ['bridge', 'engineering', 'deck', 'interior', 'galley'];
  const deptRank = (d) => { const i = DEPT_ORDER.indexOf(String(d || '').toLowerCase()); return i === -1 ? 99 : i; };
  const crewByDept = [...crew].sort((a, b) =>
    deptRank(a.department) - deptRank(b.department)
    || String(a.department || '').localeCompare(String(b.department || ''))
    || String(a.name || '').localeCompare(String(b.name || '')));
  const musterRoster = [
    ...crewByDept.map((m) => ({ key: `c:${m.userId}`, name: m.name, sub: m.department, aboard: m.status === ABOARD, img: m.avatarUrl })),
    ...guests.filter((g) => g.onboard).map((g) => ({ key: `g:${g.id}`, name: g.name, sub: g.cabin || 'Guest', aboard: true })),
    ...contractors.map((k) => ({ key: `k:${k.id}`, name: k.name, sub: k.company || 'Visitor', aboard: k.state !== 'stepped_out' })),
  ];
  const expected = musterRoster.filter((p) => p.aboard);
  const markCell = (rollId, key) => {
    setRollMarks((m) => {
      const col = { ...(m[rollId] || {}) };
      if (col[key]) delete col[key]; else col[key] = true;
      return { ...m, [rollId]: col };
    });
    // Stamp when this roll call was first taken.
    setRolls((rs) => rs.map((r) => (r.id === rollId && !r.startedAt ? { ...r, startedAt: new Date().toISOString() } : r)));
  };
  const rollCount = (rollId) => expected.filter((p) => rollMarks[rollId]?.[p.key]).length;
  const addRoll = () => setRolls((rs) => {
    const id = `r${Date.now().toString(36)}`;
    setActiveRoll(id);
    return [...rs, { id, name: `Roll call ${rs.length + 1}`, startedAt: null }];
  });
  const resetMuster = () => { setRollMarks({}); setMusterSaved(false); };
  const saveMuster = async () => {
    if (musterSaving) return;
    setMusterSaving(true);
    try {
      const rollCalls = rolls.map((r) => ({
        name: r.name,
        at: r.startedAt || null,
        count: rollCount(r.id),
        marked: musterRoster.filter((p) => rollMarks[r.id]?.[p.key]).map((p) => p.name),
      }));
      const roster = musterRoster.map((p) => ({ key: p.key, name: p.name, sub: p.sub || '', aboard: p.aboard }));
      await saveMusterRecord({ tenantId: activeTenantId, createdBy: meId, expected: expected.length, rollCalls, roster });
      setMusterSaved(true);
      showToast('Muster saved to history', 'success');
    } catch (e) { showToast(e?.message || 'Could not save muster', 'error'); }
    finally { setMusterSaving(false); }
  };

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
            <div className="sib-sb-stat"><span className="n">{visitorsOnboard}</span><span className="l">Visitors</span></div>
            {crewAshore > 0 && <div className="sib-sb-stat ashore"><span className="n">{crewAshore}</span><span className="l">Ashore</span></div>}
          </div>
        </div>
        <div className="sib-sb-cta">
          <span className="sib-sb-tap"><Icon name="Hand" size={16} /> Tap anywhere to sign in or out</span>
        </div>
      </div>
    );
  }

  // ── Muster (emergency roll call — spreadsheet of people × roll calls) ───────
  if (doorView === 'muster') {
    const activeCount = rollCount(activeRoll);
    const allAccounted = expected.length > 0 && activeCount === expected.length;
    return (
      <div className="sibm">
        <div className="sibm-top">
          <div className="sibm-head-l">
            <p className="sibm-eyebrow"><span className="dot">●</span> Muster · {vesselName || 'On board'}</p>
            <h1 className="sibm-title">{activeCount} <span className="sibm-of">/ {expected.length}</span> on {rolls.find((r) => r.id === activeRoll)?.name || 'this roll call'}</h1>
          </div>
          <div className="sibm-head-r">
            <span className={`sibm-status ${allAccounted ? 'ok' : 'warn'}`}>
              {allAccounted ? 'All accounted for' : `${expected.length - activeCount} to find`}
            </span>
            <button type="button" className="sibm-btn ghost" onClick={resetMuster}>Reset</button>
            <button type="button" className="sibm-btn ghost" onClick={() => exportMusterPdf({ vesselName, rolls, rollMarks, roster: musterRoster, expectedCount: expected.length })}>
              <Icon name="FileDown" size={15} /> PDF
            </button>
            <button type="button" className="sibm-btn save" onClick={saveMuster} disabled={musterSaving}>
              <Icon name={musterSaved ? 'Check' : 'Save'} size={15} /> {musterSaving ? 'Saving…' : musterSaved ? 'Saved' : 'Save to log'}
            </button>
            <button type="button" className="sibm-btn" onClick={() => setDoorView('board')}>Exit muster</button>
          </div>
        </div>

        <div className="sibm-scroll">
          <table className="sibm-table">
            <thead>
              <tr>
                <th className="sibm-th-name">Crew &amp; guests</th>
                {rolls.map((r) => (
                  <th key={r.id}
                    className={`sibm-th-roll${r.id === activeRoll ? ' active' : ''}`}
                    onClick={() => setActiveRoll(r.id)}>
                    <span className="sibm-th-roll-n">{r.name}</span>
                    <span className="sibm-th-roll-c">{rollCount(r.id)} / {expected.length}{r.startedAt ? ` · ${hhmm(r.startedAt)}` : ''}</span>
                  </th>
                ))}
                <th className="sibm-th-add">
                  <button type="button" onClick={addRoll} title="Add another roll call" aria-label="Add roll call"><Icon name="Plus" size={18} /></button>
                </th>
              </tr>
            </thead>
            <tbody>
              {musterRoster.map((p) => (
                <tr key={p.key} className={p.aboard ? '' : 'ashore'}>
                  <th className="sibm-td-name" onClick={() => markCell(activeRoll, p.key)}>
                    <span className="sibm-person">{p.name}</span>
                    <span className="sibm-sub">{p.aboard ? (p.sub || '') : 'Ashore'}</span>
                  </th>
                  {rolls.map((r) => {
                    const on = !!rollMarks[r.id]?.[p.key];
                    return (
                      <td key={r.id}
                        className={`sibm-cellx${on ? ' on' : ''}${r.id === activeRoll ? ' activecol' : ''}`}
                        onClick={() => markCell(r.id, p.key)}>
                        <span className="sibm-tick">{on ? <Icon name="Check" size={18} /> : null}</span>
                      </td>
                    );
                  })}
                  <td className="sibm-td-add" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className="sibm-foot">Tap a name to mark it on the highlighted roll call · tap a cell to tick or untick it · tap a column header to switch roll call · <b>+</b> adds another</footer>
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
            <button type="button" className={`sibq-btn icon${speakOn ? ' on' : ''}`} onClick={toggleSpeak} title={speakOn ? 'Spoken confirmation on' : 'Spoken confirmation off'} aria-label="Toggle spoken confirmation">
              <Icon name={speakOn ? 'Volume2' : 'VolumeX'} size={16} />
            </button>
            <button type="button" className="sibq-btn scan" onClick={() => setScanOpen(true)}>
              <Icon name="QrCode" size={16} /> Scan pass
            </button>
            <button type="button" className="sibq-btn muster" onClick={() => setDoorView('muster')}>
              <Icon name="AlertTriangle" size={16} /> Muster
            </button>
            <button type="button" className="sibq-btn" onClick={() => setDoorView('glance')}>
              <Icon name="Monitor" size={15} /> Standby
            </button>
          </div>
        </div>
        {scanOpen && <DoorScanModal onClose={() => setScanOpen(false)} onDetect={handleScan} />}
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
        {confirmFlash}
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
            {!kiosk && isCommand && (
              <button type="button" className="sib-standby-btn" onClick={() => setDeviceSetupOpen(true)} title="Set up the entry-door iPad">
                <Icon name="Tablet" size={15} /><span className="lbl">Device</span>
              </button>
            )}
            {!kiosk && (
              <button type="button" className="sib-standby-btn" onClick={() => navigate('/presence-history')} title="Sign in/out & muster history">
                <Icon name="History" size={15} /><span className="lbl">History</span>
              </button>
            )}
            {!kiosk && (
              <button type="button" className="sib-standby-btn" onClick={() => navigate('/door-pass')} title="Show my gangway QR pass">
                <Icon name="QrCode" size={15} /><span className="lbl">My pass</span>
              </button>
            )}
            <button type="button" className="sib-standby-btn" onClick={() => setDoorView('glance')} title="Switch to the always-on door display">
              <Icon name="Monitor" size={15} /><span className="lbl">Standby</span>
            </button>
            <button type="button" className="sib-add-btn" onClick={() => { setFromExpected(null); setAddOpen(true); }} aria-label="Add visitor">
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
              <span className="muted">{crewAboard} crew · {guestsOn} guests · {visitorsOnboard} visitors</span>
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
              {contractors.map((k) => {
                const away = k.state === 'stepped_out';
                const busyK = !!pending[`k:${k.id}`];
                return (
                  <div key={`k:${k.id}`} className={`sib-vcard${away ? ' away' : ''}`}>
                    <span className="sib-av"><span className="sib-ini">{initials(k.name)}</span></span>
                    <span className="sib-name">{k.name}</span>
                    <span className="sib-dept">{k.company || 'Visitor'}</span>
                    {k.reason && <span className="sib-vreason">{k.reason}</span>}
                    {k.phone && <span className="sib-phone"><Icon name="Phone" size={11} /> {k.phone}</span>}
                    {away ? (
                      <button type="button" className="sib-vbtn return" disabled={busyK} onClick={() => returnVisitor(k)}>
                        <Icon name="LogIn" size={14} /> Away — tap to return
                      </button>
                    ) : (
                      <button type="button" className="sib-vbtn leave" disabled={busyK} onClick={() => setLeaveVisitor(k)}>
                        <Icon name="LogOut" size={14} /> Tap to leave
                      </button>
                    )}
                    <button type="button" className="sib-vpasslink" onClick={() => setPassVisitor(k)}>
                      <Icon name="QrCode" size={12} /> Pass
                    </button>
                  </div>
                );
              })}
              <button type="button" className="sib-add" onClick={() => { setFromExpected(null); setAddOpen(true); }}>
                <span className="sib-add-plus"><Icon name="Plus" size={22} /></span>
                <span className="sib-add-label">Add visitor</span>
              </button>
            </div>
          )}

          {tab === 'visitors' && expectedVisitors.length > 0 && (
            <div className="sib-expected">
              <p className="sib-expected-l">Expected</p>
              <div className="sib-expected-list">
                {expectedVisitors.map((x) => (
                  <div key={x.id} className="sib-exp-row">
                    <button type="button" className="sib-exp-main" onClick={() => arriveExpected(x)}>
                      <span className="sib-exp-nm">{x.name}</span>
                      <span className="sib-exp-sub">{[x.company, x.reason].filter(Boolean).join(' · ') || 'Visitor'}</span>
                    </button>
                    <button type="button" className="sib-exp-in" onClick={() => arriveExpected(x)}>Sign in</button>
                    <button type="button" className="sib-exp-x" onClick={() => cancelExpected(x.id).then(load)} title="Remove"><Icon name="X" size={14} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <footer className="sib-foot">Tap crew or guests to sign in/out · tap a visitor to leave or return</footer>

      {leaveVisitor && (
        <div className="sib-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setLeaveVisitor(null); }}>
          <div className="sib-modal">
            <div className="sib-modal-head">
              <h4>{leaveVisitor.name} is leaving</h4>
              <button type="button" className="sib-exit sm" onClick={() => setLeaveVisitor(null)} title="Close"><Icon name="X" size={16} /></button>
            </div>
            <p className="sib-leave-q">Stepping out for a bit, or done for the day?</p>
            <div className="sib-leave-opts">
              <button type="button" className="sib-leave-opt" onClick={() => stepOutVisitor(leaveVisitor)}>
                <span className="sib-leave-ic temp"><Icon name="Coffee" size={20} /></span>
                <span className="sib-leave-t">Stepping out</span>
                <span className="sib-leave-s">Back later — stays on the board, one tap to return</span>
              </button>
              <button type="button" className="sib-leave-opt" onClick={() => signOffVisitor(leaveVisitor)}>
                <span className="sib-leave-ic perm"><Icon name="LogOut" size={20} /></span>
                <span className="sib-leave-t">Leaving for good</span>
                <span className="sib-leave-s">Signs them off — removed from the board</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {addOpen && (
        <div className="sib-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) { setAddOpen(false); setFromExpected(null); } }}>
          <div className="sib-modal">
            <div className="sib-modal-head">
              <h4>{fromExpected ? 'Sign in — induction' : 'Sign in a visitor'}</h4>
              <button type="button" className="sib-exit sm" onClick={() => { setAddOpen(false); setFromExpected(null); }} title="Close"><Icon name="X" size={16} /></button>
            </div>

            {!fromExpected && recentVisitors.length > 0 && (
              <div className="sib-recent">
                <span className="sib-recent-l">Returning? Tap to sign back in</span>
                <div className="sib-recent-list">
                  {recentVisitors.map((v, i) => (
                    <button key={i} type="button" className="sib-recent-chip" disabled={addBusy}
                      onClick={() => signInVisitor(v.name, v.company, v.phone, { reason: v.reason, inducted: true })}>
                      <span className="sib-recent-nm">{v.name}</span>
                      {v.company && <span className="sib-recent-co">{v.company}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="sib-field"><span>Name</span>
              <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Full name" autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') submitContractor(); }} />
            </label>
            <label className="sib-field"><span>Contact number <em>for emergencies</em></span>
              <input value={addPhone} onChange={(e) => onAddPhone(e.target.value)} placeholder="Mobile number" type="tel" inputMode="tel"
                onKeyDown={(e) => { if (e.key === 'Enter') submitContractor(); }} />
            </label>
            <label className="sib-field"><span>Company <em>optional</em></span>
              <input value={addCompany} onChange={(e) => setAddCompany(e.target.value)} placeholder="e.g. AV Marine"
                onKeyDown={(e) => { if (e.key === 'Enter') submitContractor(); }} />
            </label>
            <label className="sib-field"><span>Reason for visit <em>optional</em></span>
              <input value={addReason} onChange={(e) => setAddReason(e.target.value)} placeholder="e.g. Engine survey"
                onKeyDown={(e) => { if (e.key === 'Enter') submitContractor(); }} />
            </label>
            <button type="button" className={`sib-ack${addAck ? ' on' : ''}`} onClick={() => setAddAck((v) => !v)}>
              <span className="sib-ack-box">{addAck && <Icon name="Check" size={13} />}</span>
              <span className="sib-ack-t">Safety briefing given &amp; understood <em>required</em></span>
            </button>
            <div className="sib-modal-foot">
              <button type="button" className="sib-btn ghost" onClick={() => { setAddOpen(false); setFromExpected(null); }}>Cancel</button>
              {!fromExpected && (
                <button type="button" className="sib-btn ghost" onClick={saveExpected} disabled={addBusy || !addName.trim()} title="Pre-register — sign in when they arrive">
                  Expected
                </button>
              )}
              <button type="button" className="sib-btn primary" onClick={submitContractor} disabled={addBusy || !addName.trim() || !addPhone.trim() || !addAck}>
                Sign in
              </button>
            </div>
          </div>
        </div>
      )}

      {deviceSetupOpen && (
        <DeviceSetupModal tenantId={activeTenantId} crew={crew} onClose={() => setDeviceSetupOpen(false)} />
      )}
      {passVisitor && <VisitorPassModal visitor={passVisitor} onClose={() => setPassVisitor(null)} />}
      {confirmFlash}
      </div>
    </>
  );
};

export default SignInBoard;
