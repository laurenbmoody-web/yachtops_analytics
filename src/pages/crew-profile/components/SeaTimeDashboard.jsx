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
  const [signatory, setSignatory] = useState('master');
  const [signed, setSigned] = useState(false);   // master has attested
  const [requested, setRequested] = useState(false); // crew has requested attestation
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [docMet, setDocMet] = useState({ passport: false, email: true, srb: true, template: true, stamp: false, scan: true, min642: true, sig: true });
  const [form, setForm] = useState({ vesselId: '', from: '', to: '', type: 'watchkeeping', watchHours: 6, capacity: 'Master', region: '' });
  const [qrDataUrl, setQrDataUrl] = useState(null);

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
        // Derive attestation state from the rows' verification status.
        const sc = rows.reduce((a, r) => {
          const s = r.rawVerificationStatus;
          if (s === 'captain_signed') a.signed += 1; else if (s === 'pending') a.pending += 1; else if (s === 'rejected') a.rejected += 1; else a.draft += 1;
          return a;
        }, { draft: 0, pending: 0, rejected: 0, signed: 0 });
        setSigned(sc.signed > 0 && sc.pending === 0 && sc.draft === 0);
        setRequested(sc.pending > 0);
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

  // real QR once signed (and whenever the assured payload changes)
  useEffect(() => {
    if (!signed) { setQrDataUrl(null); return; }
    let cancelled = false;
    makeQrDataUrl(assurance.qrPayload).then(u => { if (!cancelled) setQrDataUrl(u); }).catch(() => {});
    return () => { cancelled = true; };
  }, [signed, assurance.qrPayload]);

  // ── handlers ──
  // Any change to the pack invalidates a prior request/attestation.
  const resetSignoff = () => { setSigned(false); setRequested(false); };
  const pickVerifier = (v) => { setVerifier(v); resetSignoff(); };
  const pickSignatory = (s) => { setSignatory(s); resetSignoff(); };
  const toggleDoc = (id) => { setDocMet(d => ({ ...d, [id]: !d[id] })); resetSignoff(); };
  const reclassify = (id) => { setEntries(es => es.map(e => e.id === id ? { ...e, type: 'standby', detailOverride: 'Reclassified from watchkeeping' } : e)); resetSignoff(); flash('Entry reclassified to standby'); };
  const excludeEntry = (id) => { setEntries(es => es.map(e => e.id === id ? { ...e, excluded: true } : e)); resetSignoff(); flash('Entry excluded from the pack'); };
  // Crew can only request; the master reviews the service and attests it.
  const liveRowIds = () => entries.filter(e => !e.excluded).flatMap(e => e.rowIds || []);
  const onRequestAttestation = async () => {
    if (!canGenerate) { flash('Resolve all validation checks first'); return; }
    if (!usingSample && tenantId && userId) {
      try {
        await submitEntries(tenantId, liveRowIds(), { signedName: seafarer.fullName });
        // Notify the tenant's master(s) that an attestation is waiting.
        try {
          const { data: masters } = await supabase.from('tenant_members').select('user_id').eq('tenant_id', tenantId).eq('active', true).ilike('role', 'captain');
          for (const m of masters || []) {
            if (m?.user_id && m.user_id !== userId) {
              await sendDbNotification(m.user_id, { type: 'sea_time', title: 'Sea-service attestation requested', message: `${seafarer.fullName} has requested you review and attest their sea service.`, actionUrl: `/profile/${userId}?tab=seatime`, severity: 'info' });
            }
          }
        } catch (ne) { console.warn('attestation notify failed', ne); }
        flash('Sent to the master to review & attest'); await loadLive();
      } catch (e) { console.error(e); flash('Could not send for attestation'); }
      return;
    }
    setRequested(true); flash('Sent to the master to review & attest');
  };
  const onAttest = async () => {
    if (!canGenerate) { flash('Resolve all validation checks first'); return; }
    if (!usingSample && tenantId && userId) {
      try { await signEntries(tenantId, liveRowIds(), { signedName: signatoryMeta.name }); flash('Service attested & captain-signed'); await loadLive(); }
      catch (e) { console.error(e); flash('Could not attest — check your permissions'); }
      return;
    }
    setSigned(true); setRequested(false); flash('Service attested & captain-signed');
  };

  const signatoryMeta = signatory === 'self'
    ? { name: seafarer.fullName, rank: 'Seafarer (self)', signedAt: null }
    : { name: 'Capt. Henrik Sõrensen', rank: 'Master', cocNumber: '0094821', signedAt: '2026-04-22' };

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
        setDrawerOpen(false); setSigned(false); flash('Sea time logged & classified');
        await loadLive();
      } catch (e) { console.error(e); flash('Could not save the entry'); }
      return;
    }
    // sample mode — in-memory
    const fm = (iso) => { const d = new Date(iso); return String(d.getDate()).padStart(2, '0') + ' ' + d.toLocaleString('en-GB', { month: 'short' }); };
    const main = fm(form.from) + (form.to && form.to !== form.from ? ' – ' + fm(form.to) : '');
    const yr = form.from ? new Date(form.from).getFullYear() : 2026;
    const entry = { id: 'e' + Date.now() + Math.random().toString(36).slice(2, 6), vesselId: form.vesselId, label: TYPE_META[form.type].label + ' — ' + (vessels[form.vesselId]?.name || ''), region: form.region, from: form.from, to: form.to || form.from, dateMain: main, dateSub: yr + ' · ' + days + (days === 1 ? ' day' : ' days'), days, type: form.type, watchHours: form.watchHours, capacity: form.capacity, source: 'manual' };
    setEntries(es => [entry, ...es]); setDrawerOpen(false); setSigned(false); flash('Sea time logged & classified');
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
        <div className="std-foot" style={{ padding: '14px 18px 18px' }}>{live.length} entries in pack · {buckets.total} qualifying days{excludedCount ? ` · ${excludedCount} excluded` : ''}</div>
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
              <div className="mlabel rustlabel">Captain-attested · MSN 1858</div>
              <h3>Sea Service Testimonial Pack</h3>
              <div className="sub">A captain-attested sea-service record — use it to complete your verifying organisation’s submission, or attach it as supporting evidence.</div>
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

            {/* 03 Authorise */}
            <div className="std-fstep">
              <div className="std-fnum">03</div>
              <div>
                <div className="std-fhead"><span className="std-flabel">Authorise</span></div>
                <div className="std-ftitle">Master who attests this service</div>
                <div className="std-opts">
                  {[{ key: 'master', name: 'Capt. Henrik Sõrensen', sub: 'Master · CoC 0094821', bad: false }, { key: 'self', name: `${seafarer.fullName} (self)`, sub: 'Seafarer — not permitted', bad: true }].map(o => {
                    const sel = signatory === o.key;
                    return (
                      <div className={`std-opt${sel ? ' sel' : ''}${o.bad ? ' bad' : ''}`} key={o.key} onClick={() => pickSignatory(o.key)}>
                        <span className="rad" />
                        <div><div className="on">{o.name}</div><div className="os">{o.sub}</div></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 04 Attestation */}
            <div className="std-fstep">
              <div className="std-fnum">04</div>
              <div>
                <div className="std-fhead"><span className="std-flabel">Captain attestation</span></div>
                <div className="std-ftitle">Reviewed &amp; attested by the master</div>
                <div className="std-fnote" style={{ color: signed ? '#3F7A52' : canGenerate ? 'var(--muted)' : '#A32D2D' }}>
                  <Icon name={signed ? 'Check' : canGenerate ? 'Eye' : 'Lock'} size={13} />
                  {signed
                    ? ' Attested — the master has confirmed the logged service is accurate. The pack can now be exported.'
                    : canGenerate
                      ? ' The master must check the logged service is correct and attest it before the pack is issued — it can’t be self-generated.'
                      : ` Locked until step one clears — resolve the ${checks.filter(c => !c.ok).length} outstanding check${checks.filter(c => !c.ok).length === 1 ? '' : 's'}.`}
                </div>
              </div>
            </div>
          </div>

          <div className="std-issue">
            <div>
              <div className="mlabel">Step 04 · Captain attestation</div>
              <div className="std-issue-h">
                {!canGenerate ? `${checks.filter(c => !c.ok).length} check(s) blocking attestation`
                  : signed ? 'Attested — ready to export'
                    : canAttest ? 'Ready for your review & attestation'
                      : requested ? 'Awaiting the master’s attestation'
                        : 'Ready to send for attestation'}
              </div>
            </div>
            {!canGenerate ? (
              <button className="std-genbtn" disabled style={{ background: '#F1EFE9', color: '#AEB4C2', cursor: 'not-allowed' }}>
                <Icon name="Lock" size={15} /> Blocked
              </button>
            ) : signed ? (
              canAttest && (
                <button className="std-genbtn" onClick={onAttest} style={{ background: '#fff', color: '#1C1B3A', border: '1px solid #E6E8EC', cursor: 'pointer' }}>
                  <Icon name="RefreshCw" size={15} /> Re-attest
                </button>
              )
            ) : canAttest ? (
              <button className="std-genbtn" onClick={onAttest} style={{ background: '#C65A1A', color: '#fff', cursor: 'pointer' }}>
                <Icon name="PenLine" size={15} /> Review &amp; attest
              </button>
            ) : requested ? (
              <div className="std-flex std-ac" style={{ marginLeft: 'auto', gap: 10, flexWrap: 'wrap' }}>
                <button className="std-genbtn" disabled style={{ marginLeft: 0, background: '#FBF0DA', color: '#7A5A12', cursor: 'default' }}>
                  <Icon name="Clock" size={15} /> Awaiting sign-off
                </button>
                {usingSample && (
                  <button className="std-genbtn" onClick={onAttest} title="Preview only — there is no live master account on the sample"
                    style={{ marginLeft: 0, background: '#1C1B3A', color: '#fff', cursor: 'pointer' }}>
                    <Icon name="PenLine" size={15} /> Preview: attest as Capt. Henrik
                  </button>
                )}
              </div>
            ) : (
              <button className="std-genbtn" onClick={onRequestAttestation} style={{ background: '#C65A1A', color: '#fff', cursor: 'pointer' }}>
                <Icon name="Send" size={15} /> Request attestation
              </button>
            )}
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
                  <thead><tr><th>Vessel</th><th>Type</th><th>Flag · Official no</th><th>GT</th><th>Length</th></tr></thead>
                  <tbody>{usedVessels.map(v => <tr key={v.id}><td>{v.name}</td><td>{v.type || '—'}</td><td>{v.flag} · {v.officialNo || v.imo || '—'}</td><td>{v.gt} GT</td><td>{v.lengthM} m</td></tr>)}</tbody>
                </table>
                <div className="mlabel" style={{ marginTop: 16 }}>Service totals — totalled separately</div>
                <div className="totals">
                  {[['Seagoing', buckets.seagoing], ['Watchkeeping', buckets.watchkeeping], ['Standby', buckets.standby], ['Shipyard', buckets.yard]].map(([l, n]) => (
                    <div className="tbox" key={l}><div className="tn">{n}</div><div className="tl">{l} days</div></div>
                  ))}
                </div>
                <div className="std-flex std-between" style={{ alignItems: 'flex-end', marginTop: 22, gap: 20, flexWrap: 'wrap' }}>
                  <div>
                    <div className="sigline">{signatoryMeta.name}</div>
                    <div className="vs" style={{ marginTop: 6 }}>{signatory === 'self' ? 'Self — not accepted by MCA' : 'Capt. Henrik Sõrensen · Master · CoC 0094821 · 22/04/2026'}</div>
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
                  <button className="std-dl" style={{ background: '#fff', color: '#1C1B3A', border: '1px solid #E6E8EC' }} onClick={() => flash('Pack emailed (demo)')}><Icon name="Mail" size={15} /> Email pack</button>
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

      {toast && <div className="std-toast"><Icon name="Check" size={16} color="#5E8E6F" /> {toast}</div>}
    </div>
  );
};

export default SeaTimeDashboard;
