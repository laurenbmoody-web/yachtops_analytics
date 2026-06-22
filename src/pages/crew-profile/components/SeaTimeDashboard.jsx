import React, { useState, useMemo, useRef, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabase';
import { fetchEntriesForUser, addManualEntries, submitEntries, signEntries } from '../utils/seaTimeService';
import { adaptLiveEntries } from '../utils/seaTimeLiveAdapter';
import SeaServiceCalendar from './SeaServiceCalendar';
import {
  DEFAULT_CONFIG, TYPE_META, SOURCE_META, VERIFIER_PROFILES,
  classify, computeBuckets, buildRequirementBars, runChecks, buildTestimonialDataset
} from '../../../seatime/engine';
import {
  DEPARTMENTS, DEPT_FAMILIES, CERTIFICATES, GOAL_OPTIONS, DEFAULT_GOAL, routeFor, GRADE_TO_CERT, CERT_TO_GRADE
} from '../../../seatime/pathways';
import { fetchCrewDocuments } from '../utils/crewDocuments';
import { sendDbNotification } from '../../../lib/dbNotifications';
import { SEED_VESSELS, SEED_ENTRIES, SEED_PRIOR, SEED_SEAFARER } from '../../../seatime/seed';
import { buildAssurance, makeQrDataUrl, renderPackPdf, downloadBytes } from '../../../seatime/packExport';
import './sea-time-dashboard.css';

// Sea Time Tracker — Countdown layout, driven by the ported rules engine.
// Live Supabase data when the crew member has logged service; otherwise a
// clearly-labelled sample so the page is never blank.

const IcoPath = ({ d, color, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d={d} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const fmtDate = (iso) => { if (!iso) return '—'; const [y, m, d] = String(iso).split('-'); return d ? `${d}/${m}/${y}` : iso; };
const ZERO_PRIOR = { seagoing: 0, watchkeeping: 0, total: 0 };

// A testimonial is per-vessel and per-master: each master can only attest the
// service served on HIS vessel. Attestation is anchored to the master OF RECORD
// for the service period — never the vessel's current captain. The route is
// decided by whether that master is still aboard the Cargo vessel:
//   stamp   — master of record is still aboard (the ship can be stamped; the
//             crew leaving never downgrades this).
//   virtual — vessel on Cargo but the master has left it (signs virtually).
//   external— vessel isn't on Cargo at all (upload a paper testimonial).
const routeForVessel = (v) => !v?.cargoRegistered
  ? 'external'
  : v.captainMember ? 'stamp' : 'virtual';
// Reachability of the master once they've left the vessel: in-app while still on
// Cargo, else an emailed secure-link signature (then external as last resort).
const virtualReach = (v) => (v?.captainOnCargo ? 'inapp' : 'email');

const ROUTE_META = {
  stamp:    { label: 'Verified in Cargo',  icon: 'BadgeCheck', color: '#3F7A52', bg: '#E7F0E9', tint: '#EFF6F1' },
  virtual:  { label: 'Signed digitally',   icon: 'PenLine',    color: '#7A5A12', bg: '#FBEFD9', tint: '#FBF4E4' },
  external: { label: 'Signed testimonial', icon: 'Upload',     color: '#5A6478', bg: '#EEF0F3', tint: '#F4F5F7' }
};
// Blank captain sign-off form (MSN 1858 signatory particulars).
const SIGN_EMPTY = { name: '', cocNo: '', cocGrade: '', email: '', phone: '', place: '', cmdFrom: '', cmdTo: '' };
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Per-vessel status chip — plain language (no "stamp / virtual / external").
const ATT_CHIP = {
  attested_stamp:    { label: 'Verified in Cargo',   color: '#3F7A52', bg: '#E7F0E9' },
  attested_virtual:  { label: 'Signed by captain',   color: '#3F7A52', bg: '#E7F0E9' },
  attested_external: { label: 'Testimonial uploaded',color: '#4A5263', bg: '#EEF0F3' },
  requested:         { label: 'Awaiting captain',    color: '#7A5A12', bg: '#FBEFD9' },
  outstanding:       { label: 'Not verified yet',    color: '#A32D2D', bg: '#FCEDEA' }
};

// Cargo-styled select (native <select> menus can't be themed). `variant`:
//   'dept' — serif inline trigger · 'goal' — rounded pill trigger.
const StpSelect = ({ value, options, onChange, variant = 'dept', label }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const cur = options.find(o => o.value === value);
  return (
    <div className={`stp-dd ${variant}`} ref={ref}>
      <button type="button" className="stp-dd-btn" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}>
        {variant === 'goal' && <span className="gk">{label || 'Goal'}</span>}
        <span className="lbl">{cur?.label || '—'}</span>
        <svg className="chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="stp-dd-menu" role="listbox">
          {options.map(o => (
            <button key={o.value} type="button" role="option" aria-selected={o.value === value}
              className={`stp-dd-opt${o.value === value ? ' on' : ''}`} onClick={() => { onChange(o.value); setOpen(false); }}>
              <span className="ck"><Icon name="Check" size={13} /></span>
              <span className="txt"><span className="t">{o.label}</span>{o.sub && <span className="s">{o.sub}</span>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const SeaTimeDashboard = ({ userId, tenantId, currentUser, onAddCertificate, canAttest = false }) => {
  const config = DEFAULT_CONFIG;
  const [deptId, setDeptId] = useState('deck');
  const [goalId, setGoalId] = useState(DEFAULT_GOAL.DECK); // '' == logging-only
  const [heldCerts, setHeldCerts] = useState({});          // certId -> { issueDate, number, fileUrl, fileName, docId }
  const [heldOpen, setHeldOpen] = useState(false);
  const [serviceFilter, setServiceFilter] = useState('all');
  const [logView, setLogView] = useState('list');
  const [verifier, setVerifier] = useState('pya');
  const signatory = 'master'; // self-attestation is never permitted (MSN 1858)
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [docMet, setDocMet] = useState({ passport: false, email: true, srb: true, template: true, stamp: false, scan: true, min642: true, sig: true });
  const [form, setForm] = useState({ vesselId: '', from: '', to: '', type: 'watchkeeping', watchHours: 6, capacity: 'Master', region: '' });
  const [qrDataUrl, setQrDataUrl] = useState(null);
  // Per-vessel attestation: vesselId -> { status, mode, ref, fileName, at }.
  // status ∈ outstanding | requested | attested ; mode ∈ stamp | virtual | external.
  const [vesselAttest, setVesselAttest] = useState({});
  const [uploadFor, setUploadFor] = useState(null); // vesselId awaiting an external file pick
  const fileRef = useRef(null);
  // Captain sign-off ceremony — the master reviews one vessel's periods and
  // either signs the testimonial or declines it back to the crew member.
  const [signFor, setSignFor] = useState(null);     // vessel object under review
  const [signForm, setSignForm] = useState(SIGN_EMPTY); // signatory details (MSN 1858)
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [signoffMeta, setSignoffMeta] = useState({}); // vesselId -> signatory record for the testimonial
  const [extConfirm, setExtConfirm] = useState(null); // vessel awaiting external-upload stamp confirmation
  const [extStamped, setExtStamped] = useState(false);

  // data source: live Supabase, or a clearly-labelled sample fallback.
  const [vessels, setVessels] = useState(SEED_VESSELS);
  const [entries, setEntries] = useState(SEED_ENTRIES);
  const [seafarer, setSeafarer] = useState(SEED_SEAFARER);
  const [prior, setPrior] = useState(SEED_PRIOR);
  const [usingSample, setUsingSample] = useState(true);
  const toastTimer = useRef(null);
  const ledgerRef = useRef(null);

  const flash = (msg) => { setToast(msg); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 2600); };

  // Pathway derivation. The crew member's DEPARTMENT sets which certificate
  // families are in reach (a department shares one pathway regardless of exact
  // rank); the GOAL (career ceiling) trims the ladder to its route; held certs
  // (from the crew's CoC documents) mark where they are; the live target is the
  // first un-held rung. Empty goalId == logging-only.
  const deptFamilies = DEPT_FAMILIES[deptId] || [];
  const deptGoalOptions = deptFamilies.flatMap(f => GOAL_OPTIONS[f] || []);
  const family = goalId && CERTIFICATES[goalId] ? CERTIFICATES[goalId].family : null;
  const route = useMemo(() => routeFor(goalId), [goalId]);
  const targetId = route.find(id => !heldCerts[id]) || goalId;
  const cert = targetId && CERTIFICATES[targetId] ? CERTIFICATES[targetId] : null;
  const rungs = route.map(id => ({ id, ...CERTIFICATES[id] }));
  const familyCerts = family ? Object.entries(CERTIFICATES).filter(([, c]) => c.family === family).map(([id, c]) => ({ id, ...c })) : [];
  const crossDiscipline = !!family && !deptFamilies.includes(family);
  const deptLabel = DEPARTMENTS[deptId]?.label || '—';
  const familyWord = family === 'DECK' ? 'Deck' : family === 'ENGINE' ? 'Engine' : family === 'ETO' ? 'ETO' : '';
  const familyPathLabel = family === 'DECK' ? 'Bridge pathway' : family === 'ENGINE' ? 'Engine pathway' : family === 'ETO' ? 'ETO pathway' : '';

  const goalForDept = (id) => { const fams = DEPT_FAMILIES[id] || []; return fams.length ? (DEFAULT_GOAL[fams[0]] || '') : ''; };
  // Changing department re-defaults the goal to that department's ceiling
  // (or logging-only when the department accrues toward nothing).
  const changeDept = (id) => { setDeptId(id); setGoalId(goalForDept(id)); };
  const startPathway = () => setGoalId(goalForDept(deptId) || 'MASTER_YACHT_3000');
  const stopPathway = () => setGoalId('');

  // ── load live data ──
  const loadLive = async () => {
    if (!tenantId || !userId) return;
    try {
      const [rows, prof, pd] = await Promise.all([
        fetchEntriesForUser(tenantId, userId, 'mca-oow-yachts'),
        supabase?.from('profiles')?.select('full_name, first_name, surname')?.eq('id', userId)?.maybeSingle(),
        supabase?.from('crew_personal_details')?.select('date_of_birth, nationality')?.eq('user_id', userId)?.maybeSingle()
      ]);
      const fullName = prof?.data?.full_name || [prof?.data?.first_name, prof?.data?.surname].filter(Boolean).join(' ') || currentUser?.fullName || 'Seafarer';
      if (rows && rows.length) {
        const { vessels: vMap, entries: ents } = adaptLiveEntries(rows);
        const dates = rows.map(r => r.date).filter(Boolean).sort();
        setVessels(vMap); setEntries(ents);
        setSeafarer({ fullName, dob: pd?.data?.date_of_birth, nationality: pd?.data?.nationality, dischargeBookNo: '', cocHeld: '', periodFrom: dates[0], periodTo: dates[dates.length - 1] });
        setPrior(ZERO_PRIOR); // TODO: store a lifetime accrual baseline per seafarer.
        setUsingSample(false);
        setForm(f => ({ ...f, vesselId: Object.keys(vMap)[0] || '' }));
        // Derive attestation state from the rows' verification status, then
        // project it onto each vessel that appears in the record.
        const sc = rows.reduce((a, r) => {
          const s = r.rawVerificationStatus;
          if (s === 'captain_signed') a.signed += 1; else if (s === 'pending') a.pending += 1; else if (s === 'rejected') a.rejected += 1; else a.draft += 1;
          return a;
        }, { draft: 0, pending: 0, rejected: 0, signed: 0 });
        const status = (sc.signed > 0 && sc.pending === 0 && sc.draft === 0) ? 'attested' : sc.pending > 0 ? 'requested' : 'outstanding';
        const usedIds = [...new Set(ents.filter(e => !e.excluded).map(e => e.vesselId))];
        const va = {};
        for (const id of usedIds) va[id] = { status, mode: routeForVessel(vMap[id]) };
        setVesselAttest(va);
      } else {
        // No live entries yet — keep the sample so the page is assessable.
        setUsingSample(true);
        setForm(f => ({ ...f, vesselId: 'v1', from: '2026-04-26', to: '2026-04-30' }));
      }
    } catch (e) {
      console.error('sea-time live load failed', e);
    }
  };
  useEffect(() => { loadLive(); /* eslint-disable-next-line */ }, [tenantId, userId]);

  // Held certificates derive from the crew member's CoC documents (Documents tab):
  // a `coc` document's `grade` maps to a ladder cert, and the document is linked.
  useEffect(() => {
    if (!userId) return;
    fetchCrewDocuments(userId).then(docs => {
      const held = {};
      for (const d of docs || []) {
        if (d.doc_type !== 'coc') continue;
        const cid = GRADE_TO_CERT[d.details?.grade];
        if (cid) held[cid] = { issueDate: d.issue_date, number: d.document_number, fileUrl: d.file_url, fileName: d.file_name, docId: d.id };
      }
      setHeldCerts(held);
    }).catch(e => console.error('held certs load failed', e));
  }, [userId]);

  // ── derived ──
  const buckets = useMemo(() => computeBuckets(entries, vessels, config), [entries, vessels]);
  const requirements = useMemo(() => (cert ? buildRequirementBars(buckets, prior, cert) : []), [buckets, prior, cert]);
  const { checks, canGenerate, passed, total, readinessPct } = useMemo(() => runChecks({ entries, vessels, config, signatory, verifier, docMet }), [entries, vessels, signatory, verifier, docMet]);
  const dataset = useMemo(() => buildTestimonialDataset({ seafarer, entries, vessels, signatory, verifier }), [seafarer, entries, vessels, signatory, verifier]);
  const assurance = useMemo(() => buildAssurance(dataset), [dataset]);

  // days-to-go tracks the certificate's largest single requirement (headline gate)
  const primary = requirements.reduce((a, b) => (b.required > (a?.required || 0) ? b : a), null) || requirements[0];
  const daysToGo = primary ? primary.remaining : 0;
  const live = entries.filter(e => !e.excluded);
  const totalLoggedDays = live.reduce((s, e) => s + (e.days || 0), 0);
  const badCount = live.filter(e => !classify(e, vessels[e.vesselId], config).qual).length;
  const hasAttention = badCount > 0;
  const vp = VERIFIER_PROFILES[verifier];
  const usedVessels = [...new Set(live.map(e => e.vesselId))].map(id => vessels[id]).filter(Boolean);
  const areasCruised = [...new Set(live.map(e => e.region).filter(Boolean))].join(', ') || '—';

  // Per-vessel attestation record. Each vessel takes its own route (stamp /
  // virtual / external) and carries its own status — the testimonial is built
  // vessel-by-vessel, since one master can only attest his own ship.
  const recVessels = usedVessels.map(v => {
    const mode = routeForVessel(v);
    const att = vesselAttest[v.id] || { status: 'outstanding', mode };
    const reach = mode === 'virtual' ? virtualReach(v) : null; // 'inapp' | 'email'
    const cap = (v.captainName || 'Master').replace('Capt. ', '');
    const masterNote = mode === 'external' ? 'Ship not on Cargo'
      : v.captainMember ? 'Captain aboard · on Cargo'
        : v.captainOnCargo ? 'Captain moved on · active on Cargo' : 'Captain moved on · left Cargo';
    const how = mode === 'stamp'
      ? `The captain is still aboard ${v.name} with an active Cargo account, so these days are verified automatically — even after you leave, nothing to chase.`
      : mode === 'virtual'
        ? (reach === 'inapp'
          ? `${v.captainName || 'The captain'} has left ${v.name} but still has an active Cargo account — they review and sign your service digitally, in the app.`
          : `${v.captainName || 'The captain'} no longer has an active Cargo account — they sign by a secure email link; if you can’t reach them, upload their signed testimonial instead.`)
        : `${v.name} isn’t on Cargo — add the signed testimonial you got from the captain.`;
    return { ...v, mode, att, reach, cap, masterNote, how };
  });
  const attestedCount = recVessels.filter(v => v.att.status === 'attested').length;
  const allAttested = recVessels.length > 0 && attestedCount === recVessels.length;
  const signed = allAttested; // the consolidated pack is issuable once every vessel is attested
  const chipKey = (v) => v.att.status === 'attested' ? `attested_${v.att.mode}` : v.att.status;

  // real QR once signed (and whenever the assured payload changes)
  useEffect(() => {
    if (!signed) { setQrDataUrl(null); return; }
    let cancelled = false;
    makeQrDataUrl(assurance.qrPayload).then(u => { if (!cancelled) setQrDataUrl(u); }).catch(() => {});
    return () => { cancelled = true; };
  }, [signed, assurance.qrPayload]);

  // ── handlers ──
  // Any change to the pack invalidates every prior attestation.
  const resetSignoff = () => { setVesselAttest({}); setSignoffMeta({}); };
  const pickVerifier = (v) => { setVerifier(v); resetSignoff(); };
  const toggleDoc = (id) => { setDocMet(d => ({ ...d, [id]: !d[id] })); resetSignoff(); };
  const reclassify = (id) => { setEntries(es => es.map(e => e.id === id ? { ...e, type: 'standby', detailOverride: 'Reclassified from watchkeeping' } : e)); resetSignoff(); flash('Entry reclassified to standby'); };
  const excludeEntry = (id) => { setEntries(es => es.map(e => e.id === id ? { ...e, excluded: true } : e)); resetSignoff(); flash('Entry excluded from the pack'); };

  // Per-vessel row ids — so requests and sign-offs touch only that ship.
  const liveRowIdsFor = (vid) => entries.filter(e => !e.excluded && e.vesselId === vid).flatMap(e => e.rowIds || []);
  const setVA = (vid, patch) => setVesselAttest(m => ({ ...m, [vid]: { ...(m[vid] || {}), ...patch } }));

  // Crew requests; the master OF RECORD for that vessel reviews and attests it.
  // `via`: 'app' (in-app notification) or 'email' (secure-link, master off Cargo).
  const requestVessel = async (v, via = 'app') => {
    if (!canGenerate) { flash('Resolve all validation checks first'); return; }
    if (!usingSample && tenantId && userId) {
      try {
        await submitEntries(tenantId, liveRowIdsFor(v.id), { signedName: seafarer.fullName });
        if (via === 'app') {
          try {
            const { data: masters } = await supabase.from('tenant_members').select('user_id').eq('tenant_id', tenantId).eq('active', true).ilike('role', 'captain');
            for (const m of masters || []) {
              if (m?.user_id && m.user_id !== userId) {
                await sendDbNotification(m.user_id, { type: 'sea_time', title: 'Sea-service attestation requested', message: `${seafarer.fullName} has asked you to review and attest their service on ${v.name}.`, actionUrl: `/profile/${userId}?tab=seatime`, severity: 'info' });
              }
            }
          } catch (ne) { console.warn('attestation notify failed', ne); }
        }
        await loadLive();
      } catch (e) { console.error(e); flash('Could not send for attestation'); return; }
    } else {
      setVA(v.id, { status: 'requested', mode: v.mode });
    }
    flash(via === 'email' ? `Secure signing link emailed to ${v.captainName || 'the captain'}`
      : v.mode === 'virtual' ? `Sent to ${v.captainName || 'the captain'} to sign your service`
        : `Sent to ${v.captainName || 'the captain'} to verify your service`);
  };

  // The master attests one vessel — a Cargo stamp when both are aboard, else a
  // virtual signature. `record` carries the MSN 1858 signatory particulars.
  const attestVessel = async (v, record) => {
    if (!canGenerate) { flash('Resolve all validation checks first'); return; }
    const who = record?.name || v.captainName || 'Master';
    if (record) setSignoffMeta(m => ({ ...m, [v.id]: { ...record, mode: v.mode, at: '2026-04-22' } }));
    if (!usingSample && tenantId && userId) {
      try { await signEntries(tenantId, liveRowIdsFor(v.id), { signedName: who }); await loadLive(); }
      catch (e) { console.error(e); flash('Could not attest — check your permissions'); return; }
    } else {
      setVA(v.id, { status: 'attested', mode: v.mode, at: '2026-04-22', signedBy: who });
    }
    flash(v.mode === 'stamp' ? `${v.name} verified in Cargo` : `${v.name} signed by ${v.captainName || 'the captain'}`);
  };

  // ── captain sign-off ceremony ──
  // The qualifying periods on one vessel — what the master is being asked to confirm.
  const periodsFor = (vid) => entries.filter(e => !e.excluded && e.vesselId === vid);
  const openSignoff = (v) => {
    const ps = periodsFor(v.id);
    const froms = ps.map(e => e.from).filter(Boolean).sort();
    const tos = ps.map(e => e.to).filter(Boolean).sort();
    // The signer is the captain viewing the profile; on the sample preview it's
    // the vessel's master of record being role-played. Prefill known particulars.
    setSignForm({
      name: (canAttest ? currentUser?.fullName : null) || (v.captainName || '').replace('Capt. ', ''),
      cocNo: v.captainCoc || '',
      cocGrade: v.captainCocGrade || '',
      email: v.captainEmail || (canAttest ? currentUser?.email : '') || '',
      phone: '',
      place: '',
      cmdFrom: froms[0] || '',
      cmdTo: tos[tos.length - 1] || ''
    });
    setDeclineOpen(false); setDeclineReason('');
    setSignFor(v);
  };
  const closeSignoff = () => setSignFor(null);
  const setSF = (patch) => setSignForm(f => ({ ...f, ...patch }));
  const confirmSignoff = async () => {
    const v = signFor; if (!v) return;
    const record = { name: signForm.name.trim(), cocNo: signForm.cocNo.trim(), cocGrade: signForm.cocGrade.trim(), email: signForm.email.trim(), phone: signForm.phone.trim(), place: signForm.place.trim(), cmdFrom: signForm.cmdFrom, cmdTo: signForm.cmdTo };
    setSignFor(null);
    await attestVessel(v, record);
  };
  const declineSignoff = async () => {
    const v = signFor; if (!v) return;
    setSignFor(null);
    // Hand the request back to the crew member with the master's reason.
    if (!usingSample && tenantId && userId) {
      try { await sendDbNotification(userId, { type: 'sea_time', title: 'Sea-service attestation declined', message: `${v.captainName || 'The captain'} couldn’t confirm your service on ${v.name}${declineReason.trim() ? ` — “${declineReason.trim()}”` : ''}.`, actionUrl: `/profile/${userId}?tab=seatime`, severity: 'warning' }); }
      catch (ne) { console.warn('decline notify failed', ne); }
    }
    setVA(v.id, { status: 'outstanding', mode: v.mode });
    flash(`Declined — ${seafarer.fullName} has been notified`);
  };

  // External testimonial — for a vessel that isn't on Cargo, the crew uploads
  // the signed paper they obtained from the master. The MCA requires it to bear
  // the master's signature AND the ship's official stamp, so we gate the upload
  // on an explicit confirmation of that before recording the file.
  const openUpload = (v) => { setExtStamped(false); setExtConfirm(v); };
  const pickExternalFile = () => { setUploadFor(extConfirm.id); setExtConfirm(null); fileRef.current?.click(); };
  const onExternalFile = (e) => {
    const f = e.target.files?.[0];
    if (f && uploadFor) {
      setVA(uploadFor, { status: 'attested', mode: 'external', fileName: f.name, at: new Date().toISOString().slice(0, 10) });
      setSignoffMeta(m => ({ ...m, [uploadFor]: { ...(m[uploadFor] || {}), mode: 'external', stamped: true, fileName: f.name, at: new Date().toISOString().slice(0, 10) } }));
      flash('Testimonial uploaded');
    }
    setUploadFor(null); if (fileRef.current) fileRef.current.value = '';
  };

  const signatoryMeta = { name: 'Each ship’s captain', rank: 'Master', signedAt: '2026-04-22' };

  const onDownload = async () => {
    try {
      flash('Preparing pack…');
      const qr = qrDataUrl || await makeQrDataUrl(assurance.qrPayload);
      const bytes = await renderPackPdf({ dataset, verifier: vp, assurance, qrDataUrl: qr, signatoryMeta });
      downloadBytes(bytes, `sea-service-testimonial-${vp.id}-${assurance.verificationRef}.pdf`);
      flash('Pack downloaded');
    } catch (e) { console.error(e); flash('Could not generate the PDF'); }
  };

  // Structured per-voyage export — the exact fields a PYA / Transport Malta
  // testimonial form asks for, so the crew member can fill it in minutes.
  const onExportCsv = () => {
    const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const cols = ['Vessel', 'Type', 'Flag', 'Official no', 'IMO', 'GT', 'Length (m)', 'From', 'To', 'Days', 'Service type', 'Watch hours/day', 'Capacity', 'Areas cruised'];
    const rows = live.map(e => {
      const v = vessels[e.vesselId] || {};
      const tm = TYPE_META[e.type] || {};
      return [v.name, v.type, v.flag, v.officialNo || '', v.imo || '', v.gt, v.lengthM, e.from || '', e.to || '', e.days, tm.label || e.type, e.type === 'watchkeeping' ? e.watchHours : '', e.capacity || '', e.region || ''].map(esc).join(',');
    });
    const csv = [cols.map(esc).join(','), ...rows].join('\r\n');
    const bytes = new TextEncoder().encode('﻿' + csv);
    downloadBytes(bytes, `sea-service-record-${seafarer.fullName.replace(/\s+/g, '-')}.csv`, 'text/csv');
  };

  const formDays = () => { const { from, to } = form; if (!from || !to) return 1; const d = Math.round((new Date(to) - new Date(from)) / 86400000) + 1; return d > 0 ? d : 1; };
  const saveEntry = async () => {
    const days = formDays();
    if (!usingSample && tenantId && userId) {
      // Persist to Supabase, then reload the live set.
      const v = vessels[form.vesselId] || {};
      try {
        await addManualEntries(tenantId, userId, {
          period: { startDate: form.from, endDate: form.to, capacityServed: form.capacity, watchHours: form.watchHours, seaServiceType: form.type === 'seagoing' ? 'Underway' : form.type === 'standby' ? 'Standby' : form.type === 'yard' ? 'Yard period' : 'Underway', pathId: 'mca-oow-yachts' },
          vessel: { vesselName: v.name, flag: v.flag, imoNumber: v.imo, vesselType: v.type, grossTonnage: v.gt, lengthM: v.lengthM }
        });
        setDrawerOpen(false); resetSignoff(); flash('Sea time logged & classified');
        await loadLive();
      } catch (e) { console.error(e); flash('Could not save the entry'); }
      return;
    }
    // sample mode — in-memory
    const fm = (iso) => { const d = new Date(iso); return String(d.getDate()).padStart(2, '0') + ' ' + d.toLocaleString('en-GB', { month: 'short' }); };
    const main = fm(form.from) + (form.to && form.to !== form.from ? ' – ' + fm(form.to) : '');
    const yr = form.from ? new Date(form.from).getFullYear() : 2026;
    const entry = { id: 'e' + Date.now() + Math.random().toString(36).slice(2, 6), vesselId: form.vesselId, label: TYPE_META[form.type].label + ' — ' + (vessels[form.vesselId]?.name || ''), region: form.region, from: form.from, to: form.to || form.from, dateMain: main, dateSub: yr + ' · ' + days + (days === 1 ? ' day' : ' days'), days, type: form.type, watchHours: form.watchHours, capacity: form.capacity, source: 'manual' };
    setEntries(es => [entry, ...es]); setDrawerOpen(false); resetSignoff(); flash('Sea time logged & classified');
  };

  const shortMsn = (m) => String(m || '').replace('MSN 1858 Amd 2 ', '').replace('MSN 1859 ', '').replace('MSN 1858 ', '');

  // ── pathway: progression spine (Condensed A) or logging-only record ──
  const heldCount = Object.keys(heldCerts).filter(id => CERTIFICATES[id]).length;
  const selectGoals = (() => {
    const ids = [...deptGoalOptions];
    if (goalId && !ids.includes(goalId)) ids.push(goalId);
    return ids.map(id => ({ id, ...CERTIFICATES[id] }));
  })();
  const goalSub = (g) => g.family === 'ETO' ? 'Electro-technical' : g.family === 'ENGINE' ? `Engine · ${shortMsn(g.msn)}` : /unlimited/i.test(g.label) ? 'Unlimited route' : 'Tonnage-limited';
  const deptOpts = Object.values(DEPARTMENTS).map(d => ({ value: d.id, label: d.label }));
  const goalOpts = selectGoals.map(g => ({ value: g.id, label: g.short, sub: goalSub(g) }));

  const PathwaySection = () => (
    <>
    <div className="std-card std-pad std-pathway">
      <div className="stp-head">
        <div>
          <div className="stp-dept">
            {crossDiscipline ? `Working toward ${familyWord}` : cert ? familyPathLabel : 'Logged service'}
          </div>
          <div className="stp-controls">
            <StpSelect variant="goal" label="Department" value={deptId} options={deptOpts} onChange={changeDept} />
            {cert && <StpSelect variant="goal" label="Goal" value={goalId} options={goalOpts} onChange={setGoalId} />}
          </div>
          <div className="stp-sub">{crossDiscipline ? 'Target chosen manually — not this crew member’s department' : cert ? 'Pathway set from this crew member’s department' : 'Logged service — for your record'}</div>
        </div>
        <div className="stp-links">
          {cert && <button className="stp-link rust" type="button" onClick={() => setHeldOpen(true)}>Certificates held{heldCount ? ` (${heldCount})` : ''} →</button>}
          {cert
            ? <button className="stp-link" type="button" onClick={stopPathway}>Just track my days — no certificate</button>
            : <button className="stp-link rust" type="button" onClick={startPathway}>Working toward a certificate →</button>}
        </div>
      </div>

      {cert ? (
        <div className="stp-spine">
          {rungs.map((r) => {
            const isHeld = !!heldCerts[r.id];
            const status = isHeld ? 'held' : r.id === targetId ? 'target' : 'upcoming';
            const isGoal = r.id === goalId;
            if (status !== 'target') {
              const onClick = isHeld ? () => setHeldOpen(true) : () => setGoalId(r.id);
              return (
                <button className={`stp-step ${status}${isGoal ? ' goal' : ''}`} key={r.id} type="button" onClick={onClick}>
                  <span className="stp-m" />
                  <span className="stp-row">
                    <span className="nm">{r.label} <span className="ref">{shortMsn(r.msn)}</span>{isGoal && <span className="goaltag">Goal</span>}</span>
                    <span className={`st ${status}`}>{isHeld ? <>Held{heldCerts[r.id].issueDate ? <> · <span className="dt">{fmtDate(heldCerts[r.id].issueDate)}</span></> : ''}</> : 'Upcoming'}</span>
                  </span>
                </button>
              );
            }
            return (
              <div className={`stp-step target${isGoal ? ' goal' : ''}`} key={r.id}>
                <span className="stp-m" />
                <div className="stp-feat">
                  <div className="stp-feathead">
                    <div>
                      <div className="stp-eyebrow">Now working toward · {r.msn}{isGoal ? ' · your goal' : ''}</div>
                      <h4 className="stp-title">{r.label}</h4>
                    </div>
                    <div className="stp-fig"><span className="big">{daysToGo}</span><span className="cap">{daysToGo === 1 ? 'day to go' : 'days to go'}</span></div>
                  </div>
                  {crossDiscipline && (
                    <div className="stp-accrual">
                      <b>{buckets.total} of {totalLoggedDays} logged days</b> count toward this certificate. Days served in a {family === 'ENGINE' ? 'engine-room' : family === 'ETO' ? 'electro-technical' : 'deck'} capacity accrue; other service is logged for your CV, visa and tax but doesn’t count toward this CoC.
                    </div>
                  )}
                  {requirements.length > 0 ? (
                    <div className="stp-reqs">
                      {requirements.map(rq => (
                        <div className={`stp-req ${rq.met ? 'done' : ''}`} key={rq.key}>
                          <div className="l">{rq.label}</div>
                          <div className="v">{rq.required ? <>{rq.current} <em>/ {rq.required}</em></> : '—'}</div>
                          <div className="meter"><i style={{ width: `${rq.pct}%` }} /></div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="stp-sub" style={{ marginTop: 12 }}>No additional qualifying service required — may be applied for alongside the certificate above.</div>
                  )}
                  {r.note && <div className="stp-cnote">{r.note}</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="stp-loghero">
          <div>
            <h4 className="stp-title">Your sea-day record</h4>
            <div className="stp-loglead">Every day aboard, logged and captain-verifiable — for your CV, visa day-counts and tax, even though this role doesn’t accrue toward a Certificate of Competency.</div>
            <div className="stp-uses">
              <div className="u"><div className="l">CV</div><div className="d"><b>{buckets.total} verified sea days</b>{usedVessels.length ? ` across ${usedVessels.length} vessel${usedVessels.length === 1 ? '' : 's'}` : ''}</div></div>
              <div className="u"><div className="l">Visa</div><div className="d">Day-counts for <b>Schengen &amp; B1/B2</b> evidence</div></div>
              <div className="u"><div className="l">Tax</div><div className="d"><b>Seafarers’ Earnings Deduction</b> day record</div></div>
            </div>
          </div>
          <div className="stp-logtotal"><div className="n">{buckets.total}</div><div className="u">Sea days logged</div></div>
        </div>
      )}

      {cert && (
        <div className={`std-nudge ${hasAttention ? '' : 'clear'}`} style={{ marginTop: 18 }}>
          <IcoPath d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2ZM9 21h6M10 17v4m4-4v4" color={hasAttention ? '#C65A1A' : '#5E8E6F'} size={20} />
          <div>
            <div className="nt">{hasAttention ? `${badCount} logged ${badCount === 1 ? 'entry needs' : 'entries need'} attention.` : 'Your logged service is qualifying and on track.'}</div>
            <div className="ns">{hasAttention ? 'Non-qualifying service is excluded from your totals — review and re-tag to keep your pack clean.' : 'Keep logging — projected eligibility updates as you add service.'}</div>
            {!hasAttention && <div className="priv">Private to you.</div>}
          </div>
          {hasAttention && <button className="std-reviewbtn" onClick={() => ledgerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Review</button>}
        </div>
      )}
    </div>

    {heldOpen && (
      <>
        <div className="std-scrim" onClick={() => setHeldOpen(false)} />
        <div className="std-drawer stp-drawer">
          <div className="stp-drhead">
            <div className="mlabel rustlabel">{deptLabel} certificates</div>
            <div className="serif" style={{ fontSize: 21, marginTop: 4 }}>Certificates you already hold</div>
            <button className="stp-drclose" onClick={() => setHeldOpen(false)} aria-label="Close"><Icon name="X" size={20} /></button>
          </div>
          <div className="stp-drlist">
            {familyCerts.map(c => {
              const h = heldCerts[c.id];
              return (
                <div className={`stp-drc ${h ? 'held' : ''}`} key={c.id}>
                  <div className="row">
                    <span className="mk">{h ? <Icon name="Check" size={13} color="#3F7A52" /> : <span className="dot" />}</span>
                    <div className="nm">{c.label} <span className="ref">{shortMsn(c.msn)}</span></div>
                  </div>
                  {h ? (
                    <div className="meta">
                      Held{h.issueDate ? ` · issued ${fmtDate(h.issueDate)}` : ''}{h.number ? ` · ${h.number}` : ''}
                      {h.fileUrl ? <> · <a href={h.fileUrl} target="_blank" rel="noreferrer">View document</a></> : ''}
                    </div>
                  ) : (
                    <button className="stp-dradd" type="button"
                      onClick={() => { setHeldOpen(false); onAddCertificate && onAddCertificate(CERT_TO_GRADE[c.id] || c.short); }}>
                      <Icon name="Plus" size={12} /> Add this certificate in Documents
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="stp-drfoot">
            <button className="std-dl" style={{ background: '#fff', border: '1px solid #E6E8EC', color: '#1C1B3A', flex: 1, justifyContent: 'center' }} onClick={() => setHeldOpen(false)}>Done</button>
          </div>
        </div>
      </>
    )}
    </>
  );

  // ── logged-service ledger (part of the Countdown page) ──
  const LedgerTable = () => {
    const shown = entries.filter(e => serviceFilter === 'all' || e.type === serviceFilter);
    const excludedCount = entries.filter(e => e.excluded).length;
    const prevDays = entries.filter(e => !e.excluded && routeForVessel(vessels[e.vesselId]) === 'external').reduce((s, e) => s + (e.days || 0), 0);
    return (
      <div className="std-ledger std-card" ref={ledgerRef} style={{ overflow: 'hidden' }}>
        <div className="lhead" style={{ padding: '20px 18px 0', alignItems: 'flex-start' }}>
          <h4>Logged sea service</h4>
          <div className="std-toggle">
            <button className={logView === 'list' ? 'on' : ''} onClick={() => setLogView('list')} title="List view" aria-label="List view"><Icon name="List" size={15} /></button>
            <button className={logView === 'calendar' ? 'on' : ''} onClick={() => setLogView('calendar')} title="Calendar view" aria-label="Calendar view"><Icon name="Calendar" size={15} /></button>
          </div>
        </div>
        {logView === 'calendar' && (
          <div style={{ padding: '16px 18px 0' }}>
            <SeaServiceCalendar entries={entries} vessels={vessels} config={config} serviceFilter={serviceFilter} />
          </div>
        )}
        <div style={{ padding: '8px 18px 0', display: logView === 'list' ? 'block' : 'none' }}>
          {shown.length === 0 && <div className="std-foot">No sea service logged yet — use “Log sea time”.</div>}
          {(() => {
            const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
            const groups = [];
            const idx = {};
            shown.forEach(e => {
              const d = e.from ? new Date(e.from + 'T00:00:00') : null;
              const key = d ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : 'Earlier service';
              if (idx[key] == null) { idx[key] = groups.length; groups.push({ key, items: [] }); }
              groups[idx[key]].items.push(e);
            });
            return groups.map(g => (
              <div key={g.key} className="std-agroup">
                <div className="std-amonth">{g.key}</div>
                {g.items.map(e => {
                  const v = vessels[e.vesselId] || {}, tm = TYPE_META[e.type], c = classify(e, v, config), sm = SOURCE_META[e.source] || SOURCE_META.manual;
                  const isExcluded = !!e.excluded, isQual = !isExcluded && c.qual, isBad = !isExcluded && !c.qual;
                  // Provenance: a ship on Cargo (the captain confirms your days
                  // in-app) vs one off Cargo (you'll add a signed testimonial).
                  const isCargo = routeForVessel(v) !== 'external';
                  const provLabel = isCargo ? 'On Cargo' : 'Off Cargo';
                  const provCol = isCargo ? { color: '#3F7A52', tint: '#EFF6F1' } : { color: '#5A6478', tint: '#F4F5F7' };
                  const detail = e.type === 'watchkeeping' ? `${e.watchHours}h watch · ${e.capacity}` : (e.detailOverride || `${tm.hint} · ${e.capacity}`);
                  const qualLabel = e.type === 'seagoing' ? 'Qualifies · seagoing' : e.type === 'watchkeeping' ? 'Qualifies · watchkeeping' : e.type === 'standby' ? 'Counts · standby' : 'Counts · shipyard';
                  return (
                    <div className="std-arow" key={e.id} style={{ opacity: isExcluded ? 0.55 : 1 }}>
                      <span className="std-arail" style={{ background: isExcluded ? '#CBC8C0' : tm.color }} />
                      <div className="std-adate">{e.dateMain}<span>{e.days} {e.days === 1 ? 'day' : 'days'}</span></div>
                      <div className="std-amid">
                        <div className="std-flex std-ac" style={{ gap: 7, flexWrap: 'wrap' }}>
                          <span className="std-avn">{v.name}</span>
                          <span className="std-tag" style={{ color: sm.color, background: sm.bg }}>{sm.label}</span>
                          <span className={`std-prov${isCargo ? ' cargo' : ''}`} style={{ color: provCol.color, background: provCol.tint }} title={isCargo ? 'This ship is on Cargo — the captain confirms your days in-app' : 'This ship isn’t on Cargo — you’ll add a signed testimonial for these days'}>
                            <span className="pm" style={isCargo ? { background: provCol.color } : { borderColor: provCol.color }} />{provLabel}
                          </span>
                        </div>
                        <div className="std-avs">{v.flag} · {v.gt}GT · {v.lengthM}m · IMO {v.imo} · {detail}</div>
                      </div>
                      <div className="std-aright">
                        {isExcluded && <span className="std-pill" style={{ color: '#5A6478', background: '#EEF0F3' }}>Excluded from pack</span>}
                        {isQual && <span className="std-pill" style={{ color: tm.color, background: tm.bg }}><Icon name="Check" size={12} /> {qualLabel}</span>}
                        {isBad && (
                          <>
                            <span className="std-pill" style={{ color: '#A32D2D', background: '#FCEDEA' }}><Icon name="X" size={12} /> Non-qualifying</span>
                            <div className="std-avs" style={{ color: '#A32D2D', textAlign: 'right', maxWidth: 230 }}>{c.reason}</div>
                            <button className="std-fix" onClick={() => e.type === 'watchkeeping' ? reclassify(e.id) : excludeEntry(e.id)}>
                              {e.type === 'watchkeeping' ? 'Reclassify to standby' : 'Exclude from pack'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ));
          })()}
        </div>
        <div className="std-foot" style={{ padding: '14px 18px 18px' }}>
          {live.length} entries in pack · {buckets.total} qualifying days{excludedCount ? ` · ${excludedCount} excluded` : ''}
          {prevDays > 0 && <> · <b style={{ color: '#5A6478' }}>{prevDays} {prevDays === 1 ? 'day' : 'days'} on a previous ship</b> — you’ll add a testimonial</>}
        </div>
      </div>
    );
  };

  return (
    <div className="std">
      <div className="std-head">
        <div className="std-sechead"><h3 className="cp-hor-title">SEA&nbsp;TIME<span className="pn">,</span> <em>Tracker</em><span className="pn">.</span></h3></div>
        <div className="std-controls">
          <button className="std-logbtn" onClick={() => setDrawerOpen(true)}><Icon name="Plus" size={16} /> Log sea time</button>
        </div>
      </div>

      {/* ── pathway spine / logging-only record ── */}
      {PathwaySection()}

      {/* ── bucket tiles — double as the service-type filter ── */}
      <div className="std-bpills" style={{ marginTop: 18 }}>
        {[['seagoing', 'SEAGOING'], ['watchkeeping', 'WATCHKEEPING'], ['standby', 'STANDBY'], ['yard', 'SHIPYARD']].map(([k, up]) => {
          const tm = TYPE_META[k];
          const on = serviceFilter === k;
          const toggle = () => setServiceFilter(on ? 'all' : k);
          return (
            <button className={`std-bpill${on ? ' on' : ''}`} key={k} type="button" aria-pressed={on}
              onClick={toggle}
              style={{ borderTopColor: tm.color, ...(on ? { borderColor: tm.color, boxShadow: `0 0 0 2px ${tm.bg}` } : null) }}>
              <div className="l"><span className="dot" style={{ background: tm.color }} /> {up}</div>
              <div className="n">{buckets[k]}</div> <span className="u">days</span>
            </button>
          );
        })}
      </div>
      {serviceFilter !== 'all' && (
        <div className="std-filternote">
          Showing <b>{TYPE_META[serviceFilter].label}</b> only · <button type="button" onClick={() => setServiceFilter('all')}>Show all</button>
        </div>
      )}

      <div style={{ marginTop: 18 }}>{LedgerTable()}</div>

      {/* ── pack generator ── */}
      <div style={{ marginTop: 18 }}>
        <div className="std-dossier">
          <div className="std-dossier-h">
            <div>
              <div className="mlabel rustlabel">Captain-verified · MSN 1858</div>
              <h3>Sea Service Testimonial Pack</h3>
              <div className="sub">Your sea service, confirmed by each ship’s captain — use it to complete your verifying organisation’s submission, or attach it as supporting evidence.</div>
            </div>
            <div>
              <div className="mlabel" style={{ marginBottom: 6 }}>Verifying organisation</div>
              <div className="std-vtabs">
                {Object.values(VERIFIER_PROFILES).map(v => <button key={v.id} className={verifier === v.id ? 'on' : ''} onClick={() => pickVerifier(v.id)}>{v.label}</button>)}
              </div>
            </div>
          </div>

          <div className="std-flow">
            {/* 01 Validate */}
            <div className="std-fstep">
              <div className="std-fnum">01</div>
              <div>
                <div className="std-fhead">
                  <span className="std-flabel">Validate</span>
                  <span className="std-fchip" style={{ color: '#fff', background: canGenerate ? '#5E8E6F' : '#C65A1A' }}>{passed} of {total} cleared</span>
                </div>
                <div className="std-ftitle">Every rule must clear</div>
                <div className="std-fprog"><i className="std-grow" style={{ display: 'block', height: '100%', width: `${readinessPct}%`, background: canGenerate ? '#5E8E6F' : '#C65A1A', borderRadius: 999 }} /></div>
                <div className="std-chks">
                  {checks.map((c, i) => (
                    <div className={`std-chk${c.ok ? '' : ' bad'}`} key={i}>
                      <span className="mk" style={{ color: c.ok ? '#5E8E6F' : '#A32D2D' }}><Icon name={c.ok ? 'Check' : 'X'} size={14} /></span>
                      <div><div className="el">{c.label}</div><div className="ed">{c.detail}</div></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 02 Attach documents */}
            <div className="std-fstep">
              <div className="std-fnum">02</div>
              <div>
                <div className="std-fhead"><span className="std-flabel">Attach documents · for {vp.name}</span></div>
                <div className="std-ftitle">Supporting documents</div>
                <div className="std-docs">
                  {vp.docs.map(d => {
                    const met = !!docMet[d.id];
                    return (
                      <div className={`std-doc2${met ? ' on' : ''}`} key={d.id} onClick={() => toggleDoc(d.id)}>
                        <span className="ring">{met && <Icon name="Check" size={12} color="#fff" />}</span>
                        <span className="dl">{d.label}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="std-fee">{vp.fee}</div>
              </div>
            </div>

            {/* 03 Attest by vessel — one master per ship */}
            <div className="std-fstep">
              <div className="std-fnum">03</div>
              <div>
                <div className="std-fhead">
                  <span className="std-flabel">Get each ship verified</span>
                  <span className="std-fchip" style={{ color: '#fff', background: allAttested ? '#5E8E6F' : '#C65A1A' }}>{attestedCount} of {recVessels.length} verified</span>
                </div>
                <div className="std-ftitle">Your service is confirmed by each ship’s captain
                  <span className="std-fhelp" tabIndex={0} role="note" aria-label="How each period is confirmed">
                    <Icon name="Info" size={15} />
                    <span className="std-fhelp-pop">
                      <b>How each period is confirmed</b>
                      <span>By the captain who ran that ship at the time — never her current one:</span>
                      <span>· <b className="inl">Still aboard in Cargo</b> — verified automatically.</span>
                      <span>· <b className="inl">Moved on</b> — they sign digitally, in the app or by a secure email link.</span>
                      <span>· <b className="inl">Never on Cargo</b> — you upload their signed testimonial.</span>
                    </span>
                  </span>
                </div>
                {!canGenerate && (
                  <div className="std-fnote" style={{ color: '#A32D2D' }}>
                    <Icon name="Lock" size={13} /> Locked until step one clears — resolve the {checks.filter(c => !c.ok).length} outstanding check{checks.filter(c => !c.ok).length === 1 ? '' : 's'}.
                  </div>
                )}
                <div className="std-vlist">
                  {recVessels.map(v => {
                    const rm = ROUTE_META[v.mode], ck = ATT_CHIP[chipKey(v)];
                    const done = v.att.status === 'attested';
                    return (
                      <div className={`std-vrow${done ? ' done' : ''}`} key={v.id}>
                        <span className="std-vrail" style={{ background: rm.color }} />
                        <div className="std-vmain">
                          <div className="std-vtop">
                            <span className="vn">{v.name}</span>
                          </div>
                          <div className="std-vmeta">{v.flag} · {v.gt}GT · {v.lengthM}m · <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{v.captainName || 'Captain'}</b> · {v.masterNote}</div>
                          <div className="std-vhow">{done && v.att.fileName ? `Uploaded · ${v.att.fileName}` : v.how}</div>
                        </div>
                        <div className="std-vact">
                          <span className="std-vchip" style={{ color: ck.color, background: ck.bg }}>
                            {done && v.mode !== 'external' && <Icon name="Check" size={12} />} {ck.label}
                          </span>
                          {/* A ship that isn't on Cargo: upload the captain's signed testimonial. */}
                          {!done && v.mode === 'external' && (
                            <button className="std-vbtn ghost" disabled={!canGenerate} onClick={() => openUpload(v)}><Icon name="Upload" size={13} /> Upload testimonial</button>
                          )}
                          {/* The captain viewing their own ship — confirm or sign. */}
                          {!done && v.mode !== 'external' && canAttest && (
                            <button className="std-vbtn rust" disabled={!canGenerate} onClick={() => openSignoff(v)}>
                              <Icon name={v.mode === 'stamp' ? 'BadgeCheck' : 'PenLine'} size={13} /> {v.mode === 'stamp' ? 'Review & verify' : 'Review & sign'}
                            </button>
                          )}
                          {/* Crew — ask the captain. In-app while reachable, secure email when off Cargo (upload as last resort). */}
                          {!done && v.mode !== 'external' && !canAttest && v.att.status === 'outstanding' && (
                            v.reach === 'email' ? (
                              <div className="std-flex std-ac" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                <button className="std-vbtn rust" disabled={!canGenerate} onClick={() => requestVessel(v, 'email')}><Icon name="Mail" size={13} /> Email for signature</button>
                                <button className="std-vbtn ghost" disabled={!canGenerate} onClick={() => openUpload(v)}><Icon name="Upload" size={13} /> Upload instead</button>
                              </div>
                            ) : (
                              <button className="std-vbtn rust" disabled={!canGenerate} onClick={() => requestVessel(v, 'app')}>
                                <Icon name="Send" size={13} /> {v.mode === 'stamp' ? 'Ask captain to verify' : 'Ask captain to sign'}
                              </button>
                            )
                          )}
                          {!done && v.mode !== 'external' && !canAttest && v.att.status === 'requested' && usingSample && (
                            <button className="std-vbtn navy" onClick={() => openSignoff(v)} title="Preview only — no live captain account on the sample">
                              <Icon name={v.mode === 'stamp' ? 'BadgeCheck' : 'PenLine'} size={13} /> Preview: {v.mode === 'stamp' ? 'verify' : 'sign'} as {v.cap}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="std-issue">
            <div>
              <div className="mlabel">Step 03 · Captain sign-off</div>
              <div className="std-issue-h">
                {!canGenerate ? `${checks.filter(c => !c.ok).length} check(s) still to clear`
                  : allAttested ? 'Every ship verified — your pack is ready to export'
                    : `${attestedCount} of ${recVessels.length} ships verified — ${recVessels.length - attestedCount} still to confirm`}
              </div>
            </div>
            {allAttested
              ? <span className="std-genbtn" style={{ marginLeft: 'auto', background: '#E7F0E9', color: '#3F7A52' }}><Icon name="Check" size={15} /> Verified</span>
              : <span className="std-genbtn" style={{ marginLeft: 'auto', background: '#FBF0DA', color: '#7A5A12' }}><Icon name="Clock" size={15} /> Confirm each ship above</span>}
          </div>

          {signed && (
            <div className="std-cert">
              <div className="frame">
                <div>
                  <div className="ce">Maritime &amp; Coastguard Agency · Testimonial of Sea Service (MSN 1858)</div>
                  <h2>Testimonial of Sea Service</h2>
                  <div className="prepared">Prepared for {vp.name}</div>
                </div>
                <div className="drule" /><div className="drule2" />
                <div className="fields">
                  <div className="field"><div className="fl">Seafarer</div><div className="fv">{seafarer.fullName}</div></div>
                  <div className="field"><div className="fl">DOB · Nationality</div><div className="fv">{fmtDate(seafarer.dob)} · {seafarer.nationality || '—'}</div></div>
                  <div className="field"><div className="fl">Discharge book / NoE</div><div className="fv">{seafarer.dischargeBookNo || '—'}</div></div>
                  <div className="field"><div className="fl">Capacity</div><div className="fv">{dataset.service.capacity || '—'}</div></div>
                  <div className="field"><div className="fl">Service period</div><div className="fv">{fmtDate(seafarer.periodFrom)} – {fmtDate(seafarer.periodTo)}</div></div>
                  <div className="field"><div className="fl">CoC held</div><div className="fv">{seafarer.cocHeld || '—'}</div></div>
                  <div className="field" style={{ gridColumn: '1 / -1' }}><div className="fl">Areas cruised</div><div className="fv">{areasCruised}</div></div>
                </div>
                <table>
                  <thead><tr><th>Vessel</th><th>Flag · Official no</th><th>GT</th><th>Length</th>{deptId === 'engineering' && <th>Propulsion</th>}<th>How it’s verified</th></tr></thead>
                  <tbody>{recVessels.map(v => { const ck = ATT_CHIP[chipKey(v)]; return (
                    <tr key={v.id}>
                      <td>{v.name}</td>
                      <td>{v.flag} · {v.officialNo || v.imo || '—'}</td>
                      <td>{v.gt} GT</td>
                      <td>{v.lengthM} m</td>
                      {deptId === 'engineering' && <td>{v.kw ? `${v.kw} kW` : '—'}</td>}
                      <td><span className="std-vchip" style={{ color: ck.color, background: ck.bg }}>{v.mode === 'stamp' && <Icon name="BadgeCheck" size={11} />} {ck.label}</span></td>
                    </tr>
                  ); })}</tbody>
                </table>
                <div className="mlabel" style={{ marginTop: 16 }}>Service totals — totalled separately</div>
                <div className="totals">
                  {[['Seagoing', buckets.seagoing], ['Watchkeeping', buckets.watchkeeping], ['Standby', buckets.standby], ['Shipyard', buckets.yard]].map(([l, n]) => (
                    <div className="tbox" key={l}><div className="tn">{n}</div><div className="tl">{l} days</div></div>
                  ))}
                </div>
                <div className="std-flex std-between" style={{ alignItems: 'flex-end', marginTop: 22, gap: 20, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 300 }}>
                    <div className="sigline">Master’s certification</div>
                    <div className="std-sigs">
                      {recVessels.map(v => {
                        const sm = signoffMeta[v.id] || {};
                        const nm = sm.name || v.captainName || 'Master';
                        const bits = sm.mode === 'external'
                          ? [`Signed paper testimonial — ship’s stamp confirmed`, sm.fileName]
                          : [
                            sm.cocNo && `CoC ${sm.cocNo}${sm.cocGrade ? ` · ${sm.cocGrade}` : ''}`,
                            (sm.cmdFrom && sm.cmdTo) && `In command ${fmtDate(sm.cmdFrom)} – ${fmtDate(sm.cmdTo)}`,
                            [sm.email, sm.phone].filter(Boolean).join(' · '),
                            sm.place && `Signed at ${sm.place}`,
                            ROUTE_META[v.mode].label
                          ];
                        return (
                          <div className="std-sig" key={v.id}>
                            <div className="std-sig-name">{nm}<span>Master · {v.name}</span></div>
                            <div className="std-sig-meta">{bits.filter(Boolean).join(' · ')}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="qrseal">
                    {qrDataUrl ? <img src={qrDataUrl} width={96} height={96} alt="Verification QR" /> : <div style={{ width: 96, height: 96, background: '#F2F2F2' }} />}
                    <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', marginTop: 4 }}>SCAN TO VERIFY</div>
                    <div style={{ fontSize: 9.5, color: '#8A7F63', marginTop: 2 }}>{assurance.verificationRef}</div>
                    <div style={{ fontSize: 8.5, color: '#A0916C', wordBreak: 'break-all' }}>sha256:{assurance.contentHash.slice(0, 16)}…</div>
                  </div>
                </div>
              </div>
              <div className="std-certfoot">
                <div className="vs" style={{ maxWidth: 480 }}>{vp.instructions}</div>
                <div className="std-flex" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <button className="std-dl" style={{ background: '#C65A1A', color: '#fff' }} onClick={onDownload}><Icon name="Download" size={15} /> Download PDF</button>
                  <button className="std-dl" style={{ background: '#fff', color: '#1C1B3A', border: '1px solid #E6E8EC' }} onClick={onExportCsv}><Icon name="Table" size={15} /> Export data (CSV)</button>
                  <button className="std-dl" style={{ background: '#fff', color: '#1C1B3A', border: '1px solid #E6E8EC' }} onClick={() => flash('Pack emailed to the verifier (demo)')}><Icon name="Mail" size={15} /> Email pack</button>
                  <button className="std-dl" style={{ background: '#fff', color: '#1C1B3A', border: '1px solid #E6E8EC' }} onClick={() => flash('Shared in Cargo (demo)')}><Icon name="Send" size={15} /> Send in Cargo</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── log sea time drawer ── */}
      {drawerOpen && (
        <>
          <div className="std-scrim" onClick={() => setDrawerOpen(false)} />
          <div className="std-drawer">
            <div className="std-flex std-between std-ac" style={{ padding: '22px 24px', borderBottom: '1px solid #E6E8EC' }}>
              <div className="serif" style={{ fontSize: 22 }}>Log sea time</div>
              <button onClick={() => setDrawerOpen(false)} style={{ border: 0, background: 'transparent', cursor: 'pointer' }}><Icon name="X" size={20} /></button>
            </div>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="std-field"><label>Vessel</label>
                <select className="std-select" value={form.vesselId} onChange={e => setForm(f => ({ ...f, vesselId: e.target.value }))}>
                  {Object.values(vessels).map(v => <option key={v.id} value={v.id}>{v.name} · {v.lengthM}m · {v.gt}GT</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="std-field"><label>From</label><input className="std-input" type="date" value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value }))} /></div>
                <div className="std-field"><label>To</label><input className="std-input" type="date" value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))} /></div>
              </div>
              <div className="std-field"><label>Service type</label>
                <div className="std-typegrid">
                  {['seagoing', 'watchkeeping', 'standby', 'yard'].map(t => {
                    const tm = TYPE_META[t], sel = form.type === t;
                    return (
                      <div className="std-typecard" key={t} onClick={() => setForm(f => ({ ...f, type: t }))} style={{ borderColor: sel ? tm.color : '#DDE0E6', background: sel ? tm.bg : '#fff' }}>
                        <div className="tt" style={{ color: sel ? tm.color : '#1C1B3A' }}>{tm.label}</div>
                        <div className="th">{tm.hint}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="std-field"><label>Watch hours / day</label><input className="std-input" type="number" min="0" max="24" value={form.watchHours} onChange={e => setForm(f => ({ ...f, watchHours: +e.target.value || 0 }))} /></div>
                <div className="std-field"><label>Capacity</label><input className="std-input" value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))} /></div>
              </div>
              <div className="std-field"><label>Areas cruised <span style={{ color: 'var(--faint)', fontWeight: 500 }}>optional</span></label><input className="std-input" value={form.region} placeholder="e.g. W. Mediterranean" onChange={e => setForm(f => ({ ...f, region: e.target.value }))} /></div>
              {form.vesselId && vessels[form.vesselId] && (() => {
                const pc = classify({ ...form }, vessels[form.vesselId], config);
                return (
                  <div className="std-preview" style={{ background: pc.qual ? '#E7F0E9' : '#FCEDEA', borderColor: pc.qual ? '#CDE6D3' : '#F2C9C0' }}>
                    <Icon name={pc.qual ? 'Check' : 'X'} size={16} color={pc.qual ? '#5E8E6F' : '#A32D2D'} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: pc.qual ? '#5E8E6F' : '#A32D2D' }}>{pc.qual ? 'Will qualify' : 'Will be flagged non-qualifying'} · {formDays()} {formDays() === 1 ? 'day' : 'days'}</div>
                      <div className="vs" style={{ marginTop: 2 }}>{pc.reason || `${TYPE_META[form.type].label} service on ${vessels[form.vesselId].name} — counts toward your ${TYPE_META[form.type].label.toLowerCase()} total.`}</div>
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="std-flex" style={{ gap: 10, padding: '16px 24px', borderTop: '1px solid #E6E8EC' }}>
              <button className="std-dl" style={{ background: '#fff', border: '1px solid #E6E8EC', color: '#1C1B3A', flex: 1, justifyContent: 'center' }} onClick={() => setDrawerOpen(false)}>Cancel</button>
              <button className="std-dl" style={{ background: '#1C1B3A', color: '#fff', flex: 1, justifyContent: 'center' }} onClick={saveEntry}>Add entry</button>
            </div>
          </div>
        </>
      )}

      <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg" hidden onChange={onExternalFile} />

      {/* ── captain sign-off ceremony ── */}
      {signFor && (() => {
        const v = signFor;
        const ps = periodsFor(v.id);
        const totDays = ps.reduce((s, e) => s + (e.days || 0), 0);
        const caps = [...new Set(ps.map(e => e.capacity).filter(Boolean))].join(', ') || '—';
        const isStamp = v.mode === 'stamp';
        const isEng = deptId === 'engineering';
        const spanFrom = ps.map(e => e.from).filter(Boolean).sort()[0];
        const spanTo = ps.map(e => e.to).filter(Boolean).sort().slice(-1)[0];
        // The master may have commanded only part of the logged span (change of
        // command); flag the dates that then need a separate master's testimonial.
        const partialCmd = !!(signForm.cmdFrom && signForm.cmdTo && (signForm.cmdFrom > spanFrom || signForm.cmdTo < spanTo));
        const canSign = signForm.name.trim().length > 1 && signForm.cocNo.trim().length > 1 && EMAIL_RE.test(signForm.email.trim()) && !!signForm.cmdFrom && !!signForm.cmdTo && signForm.cmdFrom <= signForm.cmdTo;
        return (
          <>
            <div className="cso-scrim" onClick={closeSignoff} />
            <div className="cso" role="dialog" aria-modal="true" aria-label="Captain sign-off">
              <button className="cso-x" onClick={closeSignoff} aria-label="Close"><Icon name="X" size={18} /></button>
              <div className="cso-head">
                <div className="cso-eyebrow">Captain sign-off · MSN 1858</div>
                <h3 className="cso-title">{isStamp ? 'Verify service in Cargo' : 'Sign sea-service testimonial'}</h3>
                <div className="cso-sub">You’re confirming service performed under your command aboard <b>{v.name}</b>.</div>
              </div>
              <div className="cso-body">
                <div className="cso-meta">
                  <div className="cso-metacol">
                    <span className="cso-lbl">Seafarer</span>
                    <span className="cso-val">{seafarer.fullName}</span>
                    <span className="cso-vs">{caps}</span>
                  </div>
                  <div className="cso-metacol">
                    <span className="cso-lbl">Vessel</span>
                    <span className="cso-val">{v.name}</span>
                    <span className="cso-vs">{v.flag} · {v.gt}GT · {v.lengthM}m · IMO {v.imo}{isEng && v.kw ? ` · ${v.kw} kW` : ''}</span>
                  </div>
                </div>
                <div className="cso-sec">
                  <div className="cso-lbl">Service you’re confirming <span className="cso-cnt">{ps.length} {ps.length === 1 ? 'period' : 'periods'} · {totDays} {totDays === 1 ? 'day' : 'days'}</span></div>
                  <div className="cso-plist">
                    {ps.map(e => {
                      const tm = TYPE_META[e.type];
                      const det = e.type === 'watchkeeping' ? `${e.watchHours}h watch · ${e.capacity}` : (e.detailOverride || `${tm.hint} · ${e.capacity}`);
                      return (
                        <div className="cso-prow" key={e.id}>
                          <span className="cso-prail" style={{ background: tm.color }} />
                          <div className="cso-pdate">{e.dateMain}<span>{e.days} {e.days === 1 ? 'day' : 'days'}</span></div>
                          <div className="cso-pdet"><span className="cso-ptype" style={{ color: tm.color }}>{tm.label}</span><span className="cso-vs">{det}</span></div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="cso-decl">
                  <Icon name="ShieldCheck" size={16} />
                  <span>I certify that the above is a true record of sea service performed aboard <b>{v.name}</b> under my command, and that I am authorised to make this testimonial. I am not the seafarer named.</span>
                </div>
                {isStamp ? (
                  <div className="cso-stamp">
                    <Icon name="BadgeCheck" size={20} />
                    <div>
                      <div className="cso-stamp-t">Ship’s stamp applied from {v.name}’s Cargo identity</div>
                      <div className="cso-vs">The official stamp is carried automatically from the vessel’s Cargo record — no paper stamp needed.</div>
                    </div>
                  </div>
                ) : (
                  <div className="cso-stamp ink">
                    <Icon name="PenLine" size={20} />
                    <div>
                      <div className="cso-stamp-t">Digital signature — stands in for the ship’s stamp</div>
                      <div className="cso-vs">Your signed-off CoC details below authenticate this testimonial.</div>
                    </div>
                  </div>
                )}
                <div className="cso-fields">
                  <div className="cso-grid">
                    <div className="cso-fld">
                      <label className="cso-lbl">Master’s CoC number <span className="req">required</span></label>
                      <input className="cso-input" value={signForm.cocNo} onChange={e => setSF({ cocNo: e.target.value })} placeholder="e.g. GBR-CoC-447120" />
                    </div>
                    <div className="cso-fld">
                      <label className="cso-lbl">CoC grade <span className="opt">optional</span></label>
                      <input className="cso-input" value={signForm.cocGrade} onChange={e => setSF({ cocGrade: e.target.value })} placeholder="e.g. Master (Yachts) <3000GT" />
                    </div>
                  </div>
                  <div className="cso-grid">
                    <div className="cso-fld">
                      <label className="cso-lbl">Contact email <span className="req">required</span></label>
                      <input className="cso-input" type="email" value={signForm.email} onChange={e => setSF({ email: e.target.value })} placeholder="so the assessor can verify with you" />
                    </div>
                    <div className="cso-fld">
                      <label className="cso-lbl">Contact phone <span className="opt">optional</span></label>
                      <input className="cso-input" value={signForm.phone} onChange={e => setSF({ phone: e.target.value })} placeholder="+…" />
                    </div>
                  </div>
                  <div className="cso-grid">
                    <div className="cso-fld">
                      <label className="cso-lbl">In command from <span className="req">required</span></label>
                      <input className="cso-input" type="date" value={signForm.cmdFrom} onChange={e => setSF({ cmdFrom: e.target.value })} />
                    </div>
                    <div className="cso-fld">
                      <label className="cso-lbl">In command to <span className="req">required</span></label>
                      <input className="cso-input" type="date" value={signForm.cmdTo} onChange={e => setSF({ cmdTo: e.target.value })} />
                    </div>
                  </div>
                  {partialCmd && (
                    <div className="cso-warn"><Icon name="TriangleAlert" size={15} /><span>Your command dates don’t cover the whole logged period ({fmtDate(spanFrom)} – {fmtDate(spanTo)}). You’ll only certify the dates you were in command — the rest needs a separate testimonial from the master in command then.</span></div>
                  )}
                  <div className="cso-fld">
                    <label className="cso-lbl">Place of signing <span className="opt">optional</span></label>
                    <input className="cso-input" value={signForm.place} onChange={e => setSF({ place: e.target.value })} placeholder="e.g. Antibes, France" />
                  </div>
                </div>
                <div className="cso-sig">
                  <label className="cso-lbl">Sign here — type your full name <span className="req">required</span></label>
                  <input className="cso-input" value={signForm.name} onChange={e => setSF({ name: e.target.value })} placeholder="e.g. Henrik Sörensen" />
                  <div className="cso-sigprev" style={{ opacity: signForm.name.trim() ? 1 : 0.35 }}>{signForm.name.trim() || 'Your signature'}</div>
                </div>
                {declineOpen ? (
                  <div className="cso-sig">
                    <label className="cso-lbl">Reason for declining <span className="opt">optional</span></label>
                    <textarea className="cso-input" rows={2} value={declineReason} onChange={e => setDeclineReason(e.target.value)} placeholder="Let them know what needs correcting…" />
                  </div>
                ) : (
                  <button className="cso-declinelink" onClick={() => setDeclineOpen(true)}>Something’s not right? Decline this request</button>
                )}
              </div>
              <div className="cso-foot">
                {declineOpen ? (
                  <>
                    <button className="cso-btn ghost" onClick={() => setDeclineOpen(false)}>Back</button>
                    <button className="cso-btn danger" onClick={declineSignoff}>Send decline</button>
                  </>
                ) : (
                  <>
                    <button className="cso-btn ghost" onClick={closeSignoff}>Cancel</button>
                    <button className="cso-btn rust" disabled={!canSign} onClick={confirmSignoff}>
                      <Icon name={isStamp ? 'BadgeCheck' : 'PenLine'} size={15} /> {isStamp ? 'Verify in Cargo' : 'Sign & confirm'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </>
        );
      })()}

      {/* ── external testimonial — ship's-stamp confirmation before upload ── */}
      {extConfirm && (
        <>
          <div className="cso-scrim" onClick={() => setExtConfirm(null)} />
          <div className="cso" role="dialog" aria-modal="true" aria-label="Upload signed testimonial" style={{ width: 480 }}>
            <button className="cso-x" onClick={() => setExtConfirm(null)} aria-label="Close"><Icon name="X" size={18} /></button>
            <div className="cso-head">
              <div className="cso-eyebrow">External testimonial · MSN 1858</div>
              <h3 className="cso-title">Upload the signed testimonial</h3>
              <div className="cso-sub"><b>{extConfirm.name}</b> isn’t on Cargo, so the master’s paper testimonial stands as the record.</div>
            </div>
            <div className="cso-body">
              <div className="cso-decl">
                <Icon name="ShieldCheck" size={16} />
                <span>The MCA requires an external testimonial to carry the <b>master’s signature</b> and the <b>ship’s official stamp</b>. Confirm both are present before uploading.</span>
              </div>
              <label className="cso-check">
                <input type="checkbox" checked={extStamped} onChange={e => setExtStamped(e.target.checked)} />
                <span>This testimonial is signed by the master and bears {extConfirm.name}’s official ship’s stamp.</span>
              </label>
            </div>
            <div className="cso-foot">
              <button className="cso-btn ghost" onClick={() => setExtConfirm(null)}>Cancel</button>
              <button className="cso-btn rust" disabled={!extStamped} onClick={pickExternalFile}><Icon name="Upload" size={15} /> Choose file</button>
            </div>
          </div>
        </>
      )}

      {toast && <div className="std-toast"><Icon name="Check" size={16} color="#5E8E6F" /> {toast}</div>}
    </div>
  );
};

export default SeaTimeDashboard;
