import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabase';
import { fetchEntriesForUser, fetchEntriesAcrossVessels, addManualEntries, submitEntries, signEntries, syncFromVessel } from '../utils/seaTimeService';
import { adaptLiveEntries } from '../utils/seaTimeLiveAdapter';
import SeaServiceCalendar from './SeaServiceCalendar';
import { SHOW_SIGNOFF } from '../../../seatime/signoffFlag';
import {
  DEFAULT_CONFIG, TYPE_META, SOURCE_META, VERIFIER_PROFILES,
  classify, computeBuckets, buildRequirementBars, runChecks, buildTestimonialDataset, recentQualifyingDays
} from '../../../seatime/engine';
import {
  DEPARTMENTS, DEPT_FAMILIES, CERTIFICATES, GOAL_OPTIONS, DEFAULT_GOAL, routeFor, GRADE_TO_CERT, CERT_TO_GRADE, yardCapForCertificate
} from '../../../seatime/pathways';
import { fetchCrewDocuments } from '../utils/crewDocuments';
import { sendDbNotification } from '../../../lib/dbNotifications';
import { SEED_VESSELS, SEED_ENTRIES, SEED_PRIOR, SEED_SEAFARER } from '../../../seatime/seed';
import { buildAssurance, makeQrDataUrl, renderPackPdf, downloadBytes } from '../../../seatime/packExport';
import { buildNautilusSST } from '../../../seatime/nautilusExport';
import CaptainSignoff from '../../../seatime/CaptainSignoff';
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
// Lifetime sea service accrued before Cargo (a crew-entered lump sum) → the prior
// shape the pathway adds on top of the auto-logged Cargo service.
const priorFromBaseline = (b) => {
  const n = (x) => Math.max(0, Math.round(+x || 0));
  const sg = n(b?.seagoing), wk = n(b?.watchkeeping), sb = n(b?.standby), yd = n(b?.yard);
  const onboard = sg + wk + sb + yd;
  return { seagoing: sg, watchkeeping: wk, standby: sb, yard: yd, onboard, total: onboard };
};

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
// Reachability of a master who has left the vessel, decided per command spell:
// in-app while still on Cargo, else an emailed secure-link signature (then
// external as a last resort) — computed inline as `cmd.onCargo ? 'inapp' : 'email'`.
//
// A vessel's command spells. If it changed command mid-service, each spell is a
// master with active dates (from/to); otherwise one implied spell from the
// vessel's captain* fields, keyed by the vessel id so live data keeps working.
const vesselCommands = (v) => {
  if (Array.isArray(v?.commands) && v.commands.length) {
    return v.commands.map((c, i) => ({
      key: `${v.id}:${c.id || i}`, id: c.id || `c${i}`, name: c.name, coc: c.coc,
      cocGrade: c.cocGrade, email: c.email, member: !!c.member, onCargo: !!c.onCargo,
      from: c.from || null, to: c.to || null
    })).sort((a, b) => (a.from || '') < (b.from || '') ? -1 : 1);
  }
  return [{ key: v.id, id: v.id, name: v.captainName, coc: v.captainCoc, cocGrade: v.captainCocGrade, email: v.captainEmail, member: v.captainMember, onCargo: v.captainOnCargo, from: null, to: null }];
};
// A period belongs to the spell whose window contains its start date (handovers
// fall between trips, so each period lands wholly with one master).
const inCommand = (e, cmd) => (!cmd.from || e.from >= cmd.from) && (!cmd.to || e.from <= cmd.to);
const routeForCmd = (v, cmd) => !v?.cargoRegistered ? 'external' : cmd.member ? 'stamp' : 'virtual';

const ROUTE_META = {
  stamp:    { label: 'Verified in Cargo',  icon: 'BadgeCheck', color: '#3F7A52', bg: '#E7F0E9', tint: '#EFF6F1' },
  virtual:  { label: 'Signed digitally',   icon: 'PenLine',    color: '#7A5A12', bg: '#FBEFD9', tint: '#FBF4E4' },
  external: { label: 'Signed testimonial', icon: 'Upload',     color: '#5A6478', bg: '#EEF0F3', tint: '#F4F5F7' }
};
// Per-vessel status chip — plain language (no "stamp / virtual / external").
const ATT_CHIP = {
  attested_stamp:    { label: 'Verified in Cargo',   color: '#3F7A52', bg: '#E7F0E9' },
  attested_virtual:  { label: 'Signed by captain',   color: '#3F7A52', bg: '#E7F0E9' },
  attested_external: { label: 'Testimonial uploaded',color: '#4A5263', bg: '#EEF0F3' },
  requested:         { label: 'Awaiting captain',    color: '#7A5A12', bg: '#FBEFD9' },
  outstanding:       { label: 'Not verified yet',    color: '#A32D2D', bg: '#FCEDEA' },
  declined:          { label: 'Declined',            color: '#C65A1A', bg: '#FBEFE9' }
};
// Read-only verification chip shown inline on each log period. Tapping it jumps
// to that ship in Step 03 (where the actions live). Draft/unsubmitted days show
// no chip — the chip only appears once a period is in the sign-off pipeline.
const VLOG_CHIP = {
  captain_signed: { label: 'Signed',           color: '#3F7A52', bg: '#E7F0E9' },
  pending:        { label: 'Awaiting captain',  color: '#7A5A12', bg: '#FBEFD9' },
  rejected:       { label: 'Declined',          color: '#C65A1A', bg: '#FBEFE9' }
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

// Common maritime CoC flag-state codes → country names (for the Nautilus
// "Issuing Country" box). Falls through to the raw value for anything unlisted.
const COUNTRY_NAMES = {
  GB: 'United Kingdom', UK: 'United Kingdom', US: 'United States', USA: 'United States',
  MT: 'Malta', KY: 'Cayman Islands', BM: 'Bermuda', MH: 'Marshall Islands', LR: 'Liberia',
  PA: 'Panama', NL: 'Netherlands', FR: 'France', ES: 'Spain', IT: 'Italy', DE: 'Germany',
  AU: 'Australia', NZ: 'New Zealand', ZA: 'South Africa', IE: 'Ireland', JE: 'Jersey', GG: 'Guernsey',
};
const countryName = (code) => { if (!code) return ''; const k = String(code).trim().toUpperCase(); return COUNTRY_NAMES[k] || code; };

// Certification-journey defaults + the MCA validity timers (NoE 5y, oral pass 3y).
const JOURNEY_DEFAULT = { noe: { status: 'not_applied', issueDate: '' }, oral: { status: 'not_booked', bookedDate: '', passDate: '' }, coc: { issuedDate: '' }, note: '' };
// The NoE/NoA spans many routes, each with its own application form + Marine
// Notice (gov.uk). The journey is the same; only the form differs by route.
const MSF_FORMS = {
  deck: { form: 'MSF 4343', notice: 'MSN 1858', label: 'Yacht Deck Officers' },
  engineering: { form: 'MSF 4275', notice: 'MSN 1857', label: 'Engineer Officers' },
};
const addYearsIso = (iso, n) => { if (!iso) return ''; const [y, m, d] = String(iso).split('-'); return `${+y + n}-${m}-${d}`; };
const daysUntil = (iso) => { if (!iso) return null; return Math.round((new Date(iso + 'T00:00:00') - new Date()) / 86400000); };

const SeaTimeDashboard = ({ userId, tenantId, currentUser, onAddCertificate, canAttest = false }) => {
  const config = DEFAULT_CONFIG;
  const [deptId, setDeptId] = useState('deck');
  const [goalId, setGoalId] = useState(DEFAULT_GOAL.DECK); // '' == logging-only
  const [heldCerts, setHeldCerts] = useState({});          // certId -> { issueDate, number, fileUrl, fileName, docId }
  const [docsOnFile, setDocsOnFile] = useState({});        // doc_type -> { fileUrl, fileName, docId } from the profile
  const [heldOpen, setHeldOpen] = useState(false);
  const [serviceFilter, setServiceFilter] = useState('all');
  const [logView, setLogView] = useState('list');
  const [ledgerScope, setLedgerScope] = useState('all'); // 'all' | 'cargo' (Cargo-tracked only)
  const [ledgerYear, setLedgerYear] = useState(null);    // selected year in the list view (null = latest)
  const [verifier, setVerifier] = useState('nautilus');
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
  // Captain sign-off ceremony — the master reviews one command spell and either
  // signs the testimonial or declines it back to the crew member.
  const [signFor, setSignFor] = useState(null);     // command-spell unit under review
  const [signoffMeta, setSignoffMeta] = useState({}); // unit key -> signatory record for the testimonial
  const [extConfirm, setExtConfirm] = useState(null); // unit awaiting external-upload stamp confirmation
  const [extStamped, setExtStamped] = useState(false);

  // data source: live Supabase, or a clearly-labelled sample fallback.
  const [vessels, setVessels] = useState(SEED_VESSELS);
  const [entries, setEntries] = useState(SEED_ENTRIES);
  const [seafarer, setSeafarer] = useState(SEED_SEAFARER);
  const [company, setCompany] = useState({}); // vessel's company/shipowner contact (Nautilus Part 1)
  const [prior, setPrior] = useState(SEED_PRIOR);
  const [priorBaseline, setPriorBaseline] = useState(null); // raw {seagoing,watchkeeping,standby,yard,note}
  const [priorOpen, setPriorOpen] = useState(false);
  const [priorDraft, setPriorDraft] = useState({ seagoing: '', watchkeeping: '', standby: '', yard: '', note: '' });
  // Certification journey: NoE -> oral exam -> CoC, with the MCA validity timers.
  const [journey, setJourney] = useState(null);
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [journeyDraft, setJourneyDraft] = useState(null);
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

  // Resolve the Part-4 endorser for ONE command spell — the master who covered
  // those dates (stamped on the auto-logged rows). Pull their name + CoC from
  // their Cargo record. If that captain IS the seafarer (own service as master),
  // the endorser becomes the owner/company (a responsible person), not self.
  const resolveEndorserFor = async (captainId, captainName) => {
    if (!captainId || captainId === userId) {
      return { position: 'ResponsiblePerson', organisation: company?.company_name || '', positionHeld: '' };
    }
    try {
      const [cp, coc] = await Promise.all([
        supabase?.from('profiles')?.select('full_name, first_name, surname')?.eq('id', captainId)?.maybeSingle(),
        supabase?.from('personal_documents')?.select('document_number, issuing_authority, flag_state')?.eq('user_id', captainId)?.eq('doc_type', 'coc')?.order('expiry_date', { ascending: false, nullsFirst: false })?.limit(1)?.maybeSingle(),
      ]);
      const cd = cp?.data || {};
      const name = (cd.first_name && cd.surname) ? `${cd.first_name} ${cd.surname}` : (cd.full_name || captainName || '');
      const cc = coc?.data || {};
      const issuingCountry = countryName(cc.flag_state) || cc.issuing_authority || '';
      return { position: 'Master', name, cocNo: cc.document_number || '', issuingCountry };
    } catch (e) {
      console.warn('[seatime] endorser resolve failed', e);
      return { position: 'Master', name: captainName || '', cocNo: '', issuingCountry: '' };
    }
  };

  // ── load live data ──
  const loadLive = async () => {
    if (!tenantId || !userId) return;
    try {
      // Sea service is a personal career record — fetch across EVERY Cargo vessel
      // the crew member has served on (RLS scopes it: the seafarer sees all their
      // vessels; a COMMAND viewer sees only their own vessel's portion).
      const [rows, prof, pd, ves, certCopy] = await Promise.all([
        fetchEntriesAcrossVessels(userId, 'mca-oow-yachts', tenantId),
        supabase?.from('profiles')?.select('full_name, first_name, surname')?.eq('id', userId)?.maybeSingle(),
        supabase?.from('crew_personal_details')?.select('date_of_birth, nationality, discharge_book_number, verifier_membership_number, sea_service_prior, cert_progression')?.eq('user_id', userId)?.maybeSingle(),
        supabase?.from('vessels')?.select('name, imo_number, company_name, company_address, company_email, company_phone, company_country, company_postcode, propulsion_kw')?.eq('tenant_id', tenantId)?.maybeSingle(),
        // A certified true copy of the passport in Documents satisfies the
        // pack's proof-of-identity requirement automatically.
        supabase?.from('personal_documents')?.select('id')?.eq('user_id', userId)?.eq('doc_type', 'passport_certified_copy')?.limit(1)?.maybeSingle(),
      ]);
      setDocMet((d) => ({ ...d, passport: !!certCopy?.data }));
      // Prefer the structured first + surname over a free-text full_name (which can
      // get polluted with a rank); fall back to full_name, then the session user.
      const p = prof?.data || {};
      const fullName = (p.first_name && p.surname) ? `${p.first_name} ${p.surname}`
        : (p.full_name || currentUser?.fullName || 'Seafarer');
      setCompany(ves?.data || {});
      if (rows && rows.length) {
        const { vessels: vMap, entries: ents } = adaptLiveEntries(rows);
        const dates = rows.map(r => r.date).filter(Boolean).sort();
        setVessels(vMap); setEntries(ents);
        setSeafarer({ fullName, dob: pd?.data?.date_of_birth, nationality: pd?.data?.nationality, dischargeBookNo: pd?.data?.discharge_book_number || '', membershipNo: pd?.data?.verifier_membership_number || '', cocHeld: '', periodFrom: dates[0], periodTo: dates[dates.length - 1] });
        setPriorBaseline(pd?.data?.sea_service_prior || {});
        setPrior(priorFromBaseline(pd?.data?.sea_service_prior)); // lifetime baseline accrued before Cargo
        setJourney(pd?.data?.cert_progression || null);
        setUsingSample(false);
        setForm(f => ({ ...f, vesselId: Object.keys(vMap)[0] || '' }));
        // Per-command-spell attestation is derived from each entry's verification
        // status in recVessels (live), so clear any local sign-off overrides.
        setVesselAttest({});
        setSignoffMeta({});
      } else {
        // No live entries yet — keep the sample so the page is assessable.
        setUsingSample(true);
        setForm(f => ({ ...f, vesselId: 'v1', from: '2026-04-26', to: '2026-04-30' }));
      }
    } catch (e) {
      console.error('sea-time live load failed', e);
    }
  };
  // Auto-log: materialise onboard days from the vessel's employment record, then
  // load. Idempotent server-side, so it's safe to run on every mount — the crew
  // never reconstruct dates by hand. If there's no authority-set join date yet,
  // syncInfo.has_start_date is false and we prompt for COMMAND to set it.
  const [syncInfo, setSyncInfo] = useState(null);
  useEffect(() => {
    if (!tenantId || !userId) return;
    let cancelled = false;
    (async () => {
      try { const r = await syncFromVessel(tenantId, userId); if (!cancelled) setSyncInfo(r); }
      catch (e) { console.warn('[seatime] auto-log sync failed', e); }
      if (!cancelled) await loadLive();
    })();
    return () => { cancelled = true; };
    /* eslint-disable-next-line */
  }, [tenantId, userId]);

  // Held certificates derive from the crew member's CoC documents (Documents tab):
  // a `coc` document's `grade` maps to a ladder cert, and the document is linked.
  useEffect(() => {
    if (!userId) return;
    fetchCrewDocuments(userId).then(docs => {
      const held = {};
      const onFile = {};
      for (const d of docs || []) {
        // Supporting docs for the verifier submission, pulled from the profile.
        if (!onFile[d.doc_type]) onFile[d.doc_type] = { fileUrl: d.file_url, fileName: d.file_name, docId: d.id };
        if (d.doc_type !== 'coc') continue;
        const cid = GRADE_TO_CERT[d.details?.grade];
        if (cid) held[cid] = { issueDate: d.issue_date, number: d.document_number, fileUrl: d.file_url, fileName: d.file_name, docId: d.id };
      }
      setHeldCerts(held);
      setDocsOnFile(onFile);
    }).catch(e => console.error('held certs load failed', e));
  }, [userId]);

  // ── derived ──
  // Cargo-tracked vessels = those Cargo auto-logs (rota / status / AIS); a vessel
  // qualifies once it has any auto-logged day. Off-Cargo vessels the crew adds
  // manually still show and still count toward the pathway — they just aren't
  // Cargo-verifiable (so they're excluded from the per-endorser export). The
  // ledger has a toggle to show all vessels or Cargo-tracked only.
  const cargoVesselIds = useMemo(() => new Set(entries.filter(e => e.source === 'vessel').map(e => e.vesselId)), [entries]);
  // Yard cap is per-certificate (90 for OOW, 30 for Master/Chief Mate) — fold it
  // into the config so the yard bucket totals against the right MCA ceiling.
  const buckets = useMemo(
    () => computeBuckets(entries, vessels, { ...config, yardCapDays: yardCapForCertificate(targetId) }),
    [entries, vessels, config, targetId],
  );
  // Recent qualifying seagoing service in the last 5 years (MCA recency rule).
  const recentDays = useMemo(() => recentQualifyingDays(entries.filter(e => !e.excluded)), [entries]);
  const requirements = useMemo(() => (cert ? buildRequirementBars(buckets, prior, cert, recentDays) : []), [buckets, prior, cert, recentDays]);
  // Supporting-doc checks tick automatically when the matching profile document is
  // on file (passport, seaman's book); other docs keep their manual toggle.
  const docMetEffective = useMemo(() => {
    const out = { ...docMet };
    for (const d of (VERIFIER_PROFILES[verifier]?.docs || [])) {
      if (d.profileDoc) out[d.id] = !!docsOnFile[d.profileDoc]?.fileUrl; // needs an actual scan on file
    }
    return out;
  }, [docMet, verifier, docsOnFile]);
  const { checks, canGenerate, passed, total, readinessPct } = useMemo(() => runChecks({ entries, vessels, config, signatory, verifier, docMet: docMetEffective }), [entries, vessels, signatory, verifier, docMetEffective]);
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
  // virtual / external) and carries its own status. Attestation is per COMMAND
  // SPELL, not per vessel: if command changed mid-service, each master signs
  // only the periods that fall inside his own active dates.
  const recVessels = usedVessels.flatMap(v => {
    const cmds = vesselCommands(v);
    const multi = cmds.length > 1;
    return cmds.map(cmd => {
      // The seafarer's periods that fall in this master's command window.
      const periods = entries.filter(e => !e.excluded && e.vesselId === v.id && inCommand(e, cmd));
      if (!periods.length) return null;
      const mode = routeForCmd(v, cmd);
      // Live status comes from the rows' verification status; a local sign-off
      // action (sample, or this session) overrides via vesselAttest.
      const sig = periods.filter(p => p.vstatus === 'captain_signed').length;
      const pen = periods.filter(p => p.vstatus === 'pending').length;
      const rej = periods.filter(p => p.vstatus === 'rejected').length;
      // A master's decline takes priority over a fresh "outstanding" so the crew
      // see the reason and can't blindly re-request without actioning it.
      const derived = periods.length && sig === periods.length ? 'attested'
        : pen > 0 ? 'requested'
          : rej > 0 ? 'declined'
            : 'outstanding';
      const declineReason = periods.find(p => p.vstatus === 'rejected')?.rejectionReason || '';
      const testimonialPath = periods.find(p => p.testimonialPath)?.testimonialPath || null;
      const att = vesselAttest[cmd.key] || { status: derived, mode };
      const reach = mode === 'virtual' ? (cmd.onCargo ? 'inapp' : 'email') : null;
      const cap = (cmd.name || 'Master').replace('Capt. ', '');
      const days = periods.reduce((s, e) => s + (e.days || 0), 0);
      const cmdLabel = multi ? `In command ${cmd.from ? fmtDate(cmd.from) : '—'} – ${cmd.to ? fmtDate(cmd.to) : 'present'}` : null;
      const masterNote = mode === 'external' ? 'Vessel not on Cargo'
        : cmd.member ? 'Captain aboard · on Cargo'
          : cmd.onCargo ? 'Captain moved on · active on Cargo' : 'Captain moved on · left Cargo';
      const how = mode === 'stamp'
        ? `${cmd.name || 'The captain'} is still aboard ${v.name} with an active Cargo account, so these days are verified automatically — even after you leave, nothing to chase.`
        : mode === 'virtual'
          ? (reach === 'inapp'
            ? `${cmd.name || 'The captain'} has left ${v.name} but still has an active Cargo account — they review and sign your service digitally, in the app.`
            : `${cmd.name || 'The captain'} no longer has an active Cargo account — they sign by a secure email link; if you can’t reach them, upload their signed testimonial instead.`)
          : `${v.name} isn’t on Cargo — add the signed testimonial you got from the captain.`;
      return {
        ...v, key: cmd.key, cmdId: cmd.id, multi, cmdLabel, periods, days,
        captainName: cmd.name, captainCoc: cmd.coc, captainCocGrade: cmd.cocGrade, captainEmail: cmd.email,
        captainMember: cmd.member, captainOnCargo: cmd.onCargo, cmdFrom: cmd.from, cmdTo: cmd.to,
        mode, att, reach, cap, masterNote, how, declineReason, testimonialPath
      };
    }).filter(Boolean);
  });
  const attestedCount = recVessels.filter(v => v.att.status === 'attested').length;
  const allAttested = recVessels.length > 0 && attestedCount === recVessels.length;
  const signed = allAttested; // the consolidated pack is issuable once every command spell is attested
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
  // Jump from a log period's status chip to that ship's row in Step 03.
  const jumpToVerify = (vesselId) => {
    const el = (vesselId && document.querySelector(`[data-vessel="${vesselId}"]`)) || document.getElementById('std-verify');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  // Open a stored testimonial PDF via a short-lived signed URL.
  const viewTestimonial = async (path) => {
    if (!path) return;
    try {
      const { data, error } = await supabase.functions.invoke('get-seatime-testimonial', { body: { path } });
      if (error || !data?.url) throw error || new Error('no url');
      window.open(data.url, '_blank', 'noopener');
    } catch (e) { console.error('[seatime] view testimonial', e); flash('Could not open the testimonial'); }
  };

  // Per-command-spell row ids — so requests and sign-offs touch only the periods
  // that fall inside that one master's command dates.
  const liveRowIdsFor = (unit) => (unit.periods || []).flatMap(e => e.rowIds || []);
  const setVA = (key, patch) => setVesselAttest(m => ({ ...m, [key]: { ...(m[key] || {}), ...patch } }));

  // Crew requests; the master OF RECORD for that command spell reviews and attests it.
  // `via`: 'app' (in-app notification) or 'email' (secure-link, master off Cargo).
  const requestVessel = async (v, via = 'app') => {
    if (!canGenerate) { flash('Resolve all validation checks first'); return; }

    // Email route — the master has left Cargo / has no account. Mint a public,
    // token-based sign link (create_sea_service_sign_request) and email it; the
    // master signs at /sea-service/sign/:token with no login. The link is also
    // copied to the clipboard so it can be shared directly.
    if (via === 'email') {
      if (usingSample || !tenantId || !userId) { setVA(v.key, { status: 'requested', mode: v.mode }); flash('Preview only — no live record on the sample'); return; }
      const email = (v.captainEmail || '').trim() || (typeof window !== 'undefined' ? (window.prompt(`Email address for ${v.captainName || 'the captain'}?`) || '').trim() : '');
      const snapshot = {
        seafarer: { fullName: seafarer.fullName, dob: seafarer.dob, nationality: seafarer.nationality, dischargeBookNo: seafarer.dischargeBookNo, cocHeld: seafarer.cocHeld },
        unit: {
          name: v.name, flag: v.flag, gt: v.gt, lengthM: v.lengthM, imo: v.imo,
          mode: 'virtual', multi: v.multi, cmdLabel: v.cmdLabel,
          captainName: v.captainName, captainCoc: v.captainCoc || '', captainCocGrade: v.captainCocGrade || '',
          captainEmail: email, cmdFrom: v.cmdFrom || '', cmdTo: v.cmdTo || '',
          periods: (v.periods || []).map(p => ({ id: p.id, dateMain: p.dateMain, days: p.days, type: p.type, capacity: p.capacity, watchHours: p.watchHours, from: p.from, to: p.to })),
        },
      };
      let token;
      try {
        const { data, error } = await supabase.rpc('create_sea_service_sign_request', {
          p_row_ids: liveRowIdsFor(v), p_captain_name: v.captainName || null, p_captain_email: email || null, p_snapshot: snapshot,
        });
        if (error) throw error;
        token = data?.token;
      } catch (e) { console.error(e); flash('Could not create the signing link'); return; }
      if (!token) { flash('Could not create the signing link'); return; }
      const link = `${window.location.origin}/sea-service/sign/${token}`;
      if (email) {
        supabase.functions.invoke('send-sea-service-signature-request', {
          body: { token, captainEmail: email, captainName: v.captainName, seafarerName: seafarer.fullName, vesselName: v.name, dayCount: v.days },
        }).catch(() => {});
      }
      try { await navigator.clipboard?.writeText(link); } catch { /* clipboard may be unavailable */ }
      await loadLive();
      flash(email ? `Signing link emailed to ${email} — link also copied` : `Signing link copied — share it with ${v.captainName || 'the captain'}`);
      return;
    }

    // In-app route — the master has an active Cargo account. submitEntries flips
    // the rows to pending AND fires sendSeaTimeSubmission, notifying the active
    // COMMAND member(s) via the nav bell + a courtesy email.
    if (!usingSample && tenantId && userId) {
      try {
        await submitEntries(tenantId, liveRowIdsFor(v), { signedName: seafarer.fullName });
        await loadLive();
      } catch (e) { console.error(e); flash('Could not send for attestation'); return; }
    } else {
      setVA(v.key, { status: 'requested', mode: v.mode });
    }
    flash(v.mode === 'virtual' ? `Sent to ${v.captainName || 'the captain'} to sign your service`
      : `Sent to ${v.captainName || 'the captain'} to verify your service`);
  };

  // The master attests one vessel — a Cargo stamp when both are aboard, else a
  // virtual signature. `record` carries the MSN 1858 signatory particulars.
  const attestVessel = async (v, record) => {
    if (!canGenerate) { flash('Resolve all validation checks first'); return; }
    const who = record?.name || v.captainName || 'Master';
    if (record) setSignoffMeta(m => ({ ...m, [v.key]: { ...record, mode: v.mode, at: '2026-04-22' } }));
    if (!usingSample && tenantId && userId) {
      try { await signEntries(tenantId, liveRowIdsFor(v), { signedName: who }); await loadLive(); }
      catch (e) { console.error(e); flash('Could not attest — check your permissions'); return; }
    } else {
      setVA(v.key, { status: 'attested', mode: v.mode, at: '2026-04-22', signedBy: who });
    }
    flash(v.mode === 'stamp' ? `${v.name} verified in Cargo` : `${v.name} signed by ${v.captainName || 'the captain'}`);
  };

  // ── captain sign-off ceremony (the modal itself lives in <CaptainSignoff/>) ──
  const openSignoff = (v) => setSignFor(v);
  const closeSignoff = () => setSignFor(null);
  const confirmSignoff = async (record) => {
    const v = signFor; if (!v) return;
    setSignFor(null);
    await attestVessel(v, record);
  };
  const declineSignoff = async (reason) => {
    const v = signFor; if (!v) return;
    setSignFor(null);
    // Hand the request back to the crew member with the master's reason.
    if (!usingSample && tenantId && userId) {
      try { await sendDbNotification(userId, { type: 'sea_time', title: 'Sea-service attestation declined', message: `${v.captainName || 'The captain'} couldn’t confirm your service on ${v.name}${reason ? ` — “${reason}”` : ''}.`, actionUrl: `/profile/${userId}?tab=seatime`, severity: 'warning' }); }
      catch (ne) { console.warn('decline notify failed', ne); }
    }
    setVA(v.key, { status: 'outstanding', mode: v.mode });
    flash(`Declined — ${seafarer.fullName} has been notified`);
  };

  // External testimonial — for a vessel that isn't on Cargo, the crew uploads
  // the signed paper they obtained from the master. The MCA requires it to bear
  // the master's signature AND the ship's official stamp, so we gate the upload
  // on an explicit confirmation of that before recording the file.
  const openUpload = (v) => { setExtStamped(false); setExtConfirm(v); };
  const pickExternalFile = () => { setUploadFor(extConfirm.key); setExtConfirm(null); fileRef.current?.click(); };
  // Read a File as a base64 string (sans data: prefix) for transport to the edge function.
  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const onExternalFile = async (e) => {
    const f = e.target.files?.[0];
    const key = uploadFor;
    setUploadFor(null); if (fileRef.current) fileRef.current.value = '';
    if (!f || !key) return;
    const unit = recVessels.find(x => x.key === key);
    // Sample mode (or no unit) keeps the in-memory mock so the demo still works.
    if (usingSample || !unit || !tenantId || !userId) {
      setVA(key, { status: 'attested', mode: 'external', fileName: f.name, at: new Date().toISOString().slice(0, 10) });
      setSignoffMeta(m => ({ ...m, [key]: { ...(m[key] || {}), mode: 'external', stamped: true, fileName: f.name, at: new Date().toISOString().slice(0, 10) } }));
      flash('Testimonial uploaded');
      return;
    }
    // Live: store the master's signed paper in the private bucket, stamp its path
    // onto the rows, and flip them to captain_signed (the paper IS the attestation).
    try {
      flash('Uploading testimonial…');
      const ext = (f.name.split('.').pop() || 'pdf').toLowerCase();
      const base64 = await fileToBase64(f);
      const { data, error } = await supabase.functions.invoke('store-seatime-testimonial', {
        body: { entryIds: liveRowIdsFor(unit), pdfBase64: base64, markVerified: true, contentType: f.type || 'application/pdf', ext, signedName: unit.captainName || null },
      });
      if (error || !data?.ok) throw error || new Error('store failed');
      await loadLive();
      flash('Testimonial uploaded & verified');
    } catch (err) {
      console.error('[seatime] external upload', err);
      flash('Could not upload the testimonial');
    }
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

  // A Nautilus/PYA testimonial is per command spell: one document per master, per
  // vessel, for the dates THEY were in command. Split the auto-logged service by
  // (vessel × captain) across every Cargo vessel the crew served on. Manual
  // entries (off-Cargo / prior) are excluded — only Cargo-tracked service is
  // endorsable this way.
  const nautilusSpells = useMemo(() => {
    const autos = live.filter(e => e.source === 'vessel'); // vessel_auto only
    if (!autos.length) return [];
    const groups = {};
    for (const e of autos) {
      const key = `${e.vesselId}::${e.masterUserId || e.masterName || 'unattributed'}`;
      (groups[key] ||= { vesselId: e.vesselId, captainId: e.masterUserId || null, captainName: e.masterName || '', entries: [] }).entries.push(e);
    }
    return Object.values(groups).map(g => {
      const froms = g.entries.map(e => e.from).filter(Boolean).sort();
      const tos = g.entries.map(e => e.to).filter(Boolean).sort();
      return { ...g, from: froms[0] || null, to: tos[tos.length - 1] || null, days: g.entries.reduce((s, e) => s + (e.days || 0), 0) };
    }).sort((a, b) => (vessels[a.vesselId]?.name || '').localeCompare(vessels[b.vesselId]?.name || '') || String(a.from).localeCompare(String(b.from)));
  }, [live, vessels]);

  // Build + download ONE captain's Nautilus testimonial, scoped to that spell.
  const onDownloadSpell = async (spell) => {
    try {
      const v = vessels[spell.vesselId] || {};
      const mine = spell.entries;
      const b = computeBuckets(mine, vessels, { ...config, yardCapDays: yardCapForCertificate(targetId) });
      const froms = mine.map(e => e.from).filter(Boolean).sort();
      const tos = mine.map(e => e.to).filter(Boolean).sort();
      const from = froms[0] || null, to = tos[tos.length - 1] || null;
      const totalDaysOnboard = mine.reduce((s, e) => s + (e.days || 0), 0);
      const spanDays = (from && to) ? Math.round((new Date(to) - new Date(from)) / 86400000) + 1 : totalDaysOnboard;
      const standbyPassages = mine.filter(e => e.type === 'standby')
        .map(e => ({ from: e.from, to: e.to, days: e.days })).sort((a, b) => String(a.from).localeCompare(String(b.from)));
      const capCount = {};
      for (const e of mine) if (e.capacity) capCount[e.capacity] = (capCount[e.capacity] || 0) + (e.days || 0);
      const capacity = Object.keys(capCount).sort((a, b) => capCount[b] - capCount[a])[0] || '';
      // Company contact + kW are vessel-settings of the CURRENT vessel only; for a
      // previous Cargo vessel we don't have them, so leave Part 1 blank there.
      const isCurrentVessel = company?.imo_number && v.imo && String(company.imo_number) === String(v.imo);
      const co = isCurrentVessel ? company : {};
      const addrLines = String(co.company_address || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      flash('Building Nautilus form…');
      const endorser = await resolveEndorserFor(spell.captainId, spell.captainName);
      const pdfBytes = await buildNautilusSST({
        seafarer: { fullName: seafarer.fullName, dob: seafarer.dob, dischargeBook: seafarer.dischargeBookNo, nautilusNo: seafarer.membershipNo },
        vessel: { type: v.type, flag: v.flag, name: v.name, imo: v.imo, officialNo: v.officialNo, lengthM: v.lengthM, gt: v.gt, kw: co.propulsion_kw },
        endorser,
        company: {
          shipowner: co.company_name || '',
          addr1: addrLines[0] || '', addr2: addrLines[1] || '',
          zip: co.company_postcode || addrLines[addrLines.length - 1] || '',
          country: co.company_country || '',
          phone: co.company_phone || '',
          email: co.company_email || '',
        },
        service: {
          capacity, from, to, totalDaysOnboard,
          leaveDays: Math.max(0, spanDays - totalDaysOnboard),
          actualSea: b.seagoing, standby: b.standby, yard: b.yard, watchkeeping: b.watchkeeping,
        },
        standbyPassages,
      });
      const who = (endorser.name || spell.captainName || 'captain').replace(/\s+/g, '-');
      downloadBytes(pdfBytes, `nautilus-sst-${(v.name || 'vessel').replace(/\s+/g, '-')}-${who}.pdf`);
      flash('Nautilus form ready');
    } catch (e) { console.error('[seatime] nautilus export', e); flash('Could not build the Nautilus form'); }
  };

  // Prior service before Cargo — a crew-entered lump sum that counts toward the
  // pathway alongside the auto-logged Cargo service.
  const openPrior = () => {
    const b = priorBaseline || {};
    setPriorDraft({ seagoing: b.seagoing ?? '', watchkeeping: b.watchkeeping ?? '', standby: b.standby ?? '', yard: b.yard ?? '', note: b.note || '' });
    setPriorOpen(true);
  };
  const savePrior = async () => {
    const clean = (x) => Math.max(0, Math.round(+x || 0)) || 0;
    const payload = { seagoing: clean(priorDraft.seagoing), watchkeeping: clean(priorDraft.watchkeeping), standby: clean(priorDraft.standby), yard: clean(priorDraft.yard), note: (priorDraft.note || '').trim() };
    setPriorOpen(false);
    if (usingSample || !userId) { setPriorBaseline(payload); setPrior(priorFromBaseline(payload)); flash('Prior service saved (preview)'); return; }
    try {
      const { error } = await supabase.from('crew_personal_details').upsert({ user_id: userId, sea_service_prior: payload }, { onConflict: 'user_id' });
      if (error) throw error;
      setPriorBaseline(payload); setPrior(priorFromBaseline(payload));
      flash('Prior service saved');
    } catch (e) { console.error('[seatime] save prior', e); flash('Could not save prior service'); }
  };

  // Certification journey (NoE -> oral -> CoC).
  const openJourney = () => { setJourneyDraft(JSON.parse(JSON.stringify(journey || JOURNEY_DEFAULT))); setJourneyOpen(true); };
  const setJD = (path, val) => setJourneyDraft(d => { const n = JSON.parse(JSON.stringify(d || JOURNEY_DEFAULT)); const [a, b] = path.split('.'); if (b) { n[a] = { ...n[a], [b]: val }; } else { n[a] = val; } return n; });
  const saveJourney = async () => {
    const payload = journeyDraft || JOURNEY_DEFAULT;
    setJourneyOpen(false);
    if (usingSample || !userId) { setJourney(payload); flash('Journey saved (preview)'); return; }
    try {
      const { error } = await supabase.from('crew_personal_details').upsert({ user_id: userId, cert_progression: payload }, { onConflict: 'user_id' });
      if (error) throw error;
      setJourney(payload);
      flash('Certification journey saved');
    } catch (e) { console.error('[seatime] save journey', e); flash('Could not save the journey'); }
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
  const yearOf = (e) => (e.from ? +String(e.from).slice(0, 4) : null);
  const LedgerTable = () => {
    const scoped = ledgerScope === 'cargo' ? entries.filter(e => cargoVesselIds.has(e.vesselId)) : entries;
    const typed = scoped.filter(e => serviceFilter === 'all' || e.type === serviceFilter);
    // Split the logged service by year, newest first, navigated like the calendar.
    const years = [...new Set(typed.map(yearOf).filter(Boolean))].sort((a, b) => a - b);
    const activeYear = (ledgerYear && years.includes(ledgerYear)) ? ledgerYear : (years[years.length - 1] || null);
    const yearIdx = years.indexOf(activeYear);
    const shown = activeYear ? typed.filter(e => yearOf(e) === activeYear) : typed;
    const yearDays = shown.filter(e => !e.excluded).reduce((s, e) => s + (e.days || 0), 0);
    const excludedCount = scoped.filter(e => e.excluded).length;
    const offCargoDays = entries.filter(e => !e.excluded && !cargoVesselIds.has(e.vesselId)).reduce((s, e) => s + (e.days || 0), 0);
    return (
      <div className="std-ledger std-card" ref={ledgerRef} style={{ overflow: 'hidden' }}>
        <div className="lhead" style={{ padding: '20px 18px 0', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
          <h4>Logged sea service</h4>
          <div className="std-flex std-ac" style={{ gap: 10, marginLeft: 'auto' }}>
            {offCargoDays > 0 && (
              <div className="std-toggle">
                <button className={ledgerScope === 'all' ? 'on' : ''} onClick={() => setLedgerScope('all')} title="All vessels">All</button>
                <button className={ledgerScope === 'cargo' ? 'on' : ''} onClick={() => setLedgerScope('cargo')} title="Cargo-tracked only">Cargo-tracked</button>
              </div>
            )}
            <div className="std-toggle">
              <button className={logView === 'list' ? 'on' : ''} onClick={() => setLogView('list')} title="List view" aria-label="List view"><Icon name="List" size={15} /></button>
              <button className={logView === 'calendar' ? 'on' : ''} onClick={() => setLogView('calendar')} title="Calendar view" aria-label="Calendar view"><Icon name="Calendar" size={15} /></button>
            </div>
          </div>
        </div>
        {logView === 'calendar' && (
          <div style={{ padding: '16px 18px 0' }}>
            <SeaServiceCalendar entries={scoped} vessels={vessels} config={config} serviceFilter={serviceFilter} />
          </div>
        )}
        <div style={{ padding: '8px 18px 0', display: logView === 'list' ? 'block' : 'none' }}>
          {years.length > 0 && (
            <div className="std-flex std-ac std-between" style={{ padding: '6px 0 10px', borderBottom: '1px solid #F0F1F5', marginBottom: 8 }}>
              <div className="std-flex std-ac" style={{ gap: 8 }}>
                <button type="button" aria-label="Previous year" disabled={yearIdx <= 0}
                  onClick={() => setLedgerYear(years[yearIdx - 1])}
                  style={{ border: '1px solid #ECEAE3', background: '#fff', borderRadius: 8, width: 28, height: 28, cursor: yearIdx <= 0 ? 'default' : 'pointer', opacity: yearIdx <= 0 ? 0.4 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="ChevronLeft" size={16} />
                </button>
                <span style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 20, color: '#1C1B3A', minWidth: 54, textAlign: 'center' }}>{activeYear}</span>
                <button type="button" aria-label="Next year" disabled={yearIdx >= years.length - 1}
                  onClick={() => setLedgerYear(years[yearIdx + 1])}
                  style={{ border: '1px solid #ECEAE3', background: '#fff', borderRadius: 8, width: 28, height: 28, cursor: yearIdx >= years.length - 1 ? 'default' : 'pointer', opacity: yearIdx >= years.length - 1 ? 0.4 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="ChevronRight" size={16} />
                </button>
              </div>
              <span className="std-vs">{yearDays} {yearDays === 1 ? 'day' : 'days'} in {activeYear}</span>
            </div>
          )}
          {shown.length === 0 && (
            syncInfo && syncInfo.has_start_date === false
              ? <div className="std-foot">Your sea service will populate automatically once your <b>join date is confirmed by command</b> — it’s taken from your employment record, not entered by hand. You can still log a period manually with “Log sea time”.</div>
              : <div className="std-foot">No sea service logged yet — it auto-logs from your current vessel, or use “Log sea time”.</div>
          )}
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
                  // Provenance: Cargo-tracked (auto-logged on a Cargo vessel —
                  // verifiable/exportable) vs off-Cargo, self-recorded (counts
                  // toward the pathway, but you supply your own testimonial).
                  const isCargo = cargoVesselIds.has(e.vesselId);
                  const provLabel = isCargo ? 'Cargo-tracked' : 'Off-Cargo · self-recorded';
                  const provCol = isCargo ? { color: '#3F7A52', tint: '#EFF6F1' } : { color: '#5A6478', tint: '#F4F5F7' };
                  const detail = e.type === 'watchkeeping' ? `${e.watchHours}h watch · ${e.capacity}` : (e.detailOverride || `${tm.hint} · ${e.capacity}`);
                  const qualWord = e.type === 'seagoing' ? 'seagoing' : e.type === 'watchkeeping' ? 'watchkeeping' : e.type === 'standby' ? 'standby' : 'shipyard';
                  // Verification status for the log, route-aware: an off-Cargo
                  // (external) vessel is verified by an uploaded testimonial, so an
                  // un-verified one prompts "Add testimonial" rather than nothing.
                  // Sign-off parked: the log no longer carries verification status
                  // or links to a captain sign-off step — it's purely the service record.
                  const vlog = !SHOW_SIGNOFF ? null
                    : isExcluded ? null
                      : e.vstatus === 'captain_signed' ? (isCargo ? VLOG_CHIP.captain_signed : { label: 'Uploaded', color: '#4A5263' })
                        : e.vstatus === 'pending' ? VLOG_CHIP.pending
                          : e.vstatus === 'rejected' ? VLOG_CHIP.rejected
                            : !isCargo ? { label: 'Add testimonial', color: '#4A5263' }
                              : null;
                  // The whole row opens its attached testimonial when there is one;
                  // (sign-off jump only applies in the parked sign-off mode).
                  const rowAction = !isExcluded && e.testimonialPath ? () => viewTestimonial(e.testimonialPath)
                    : (SHOW_SIGNOFF && vlog ? () => jumpToVerify(e.vesselId) : null);
                  return (
                    <div className="std-arow" key={e.id}
                      role={rowAction ? 'button' : undefined} tabIndex={rowAction ? 0 : undefined}
                      onClick={rowAction || undefined}
                      onKeyDown={rowAction ? (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); rowAction(); } } : undefined}
                      style={{ opacity: isExcluded ? 0.55 : 1, cursor: rowAction ? 'pointer' : undefined }}>
                      <span className="std-arail" style={{ background: isExcluded ? '#CBC8C0' : tm.color }} />
                      <div className="std-adate">{e.dateMain}<span>{e.days} {e.days === 1 ? 'day' : 'days'}</span></div>
                      <div className="std-amid">
                        <div className="std-flex std-ac" style={{ gap: 7, flexWrap: 'wrap' }}>
                          <span className="std-avn">{v.name}</span>
                          <span className="std-tag" style={{ color: sm.color, background: sm.bg }}>{sm.label}</span>
                          <span className={`std-prov${isCargo ? ' cargo' : ''}`} style={{ color: provCol.color, background: provCol.tint }} title={isCargo ? 'Cargo-tracked — auto-logged on a Cargo vessel; verifiable and exportable' : 'Off-Cargo, self-recorded — counts toward your pathway, but supply your own testimonial as evidence'}>
                            <span className="pm" style={isCargo ? { background: provCol.color } : { borderColor: provCol.color }} />{provLabel}
                          </span>
                        </div>
                        <div className="std-avs">{v.flag} · {v.gt}GT · {v.lengthM}m · IMO {v.imo} · {detail}</div>
                      </div>
                      <div className="std-aright">
                        {/* The row itself opens the attached testimonial — a small
                            hint when one is present, no separate link. */}
                        {!isExcluded && e.testimonialPath && (
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#C65A1A', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <Icon name="FileText" size={13} /> Testimonial
                          </span>
                        )}
                        {/* Status — a quiet dot + word; the row itself is the click target
                            (opens the testimonial when signed, else jumps to Step 03). */}
                        {vlog && (
                          <span title={vlog.label === 'Declined' && e.rejectionReason ? `Declined — “${e.rejectionReason}”` : (e.testimonialPath ? 'Open testimonial' : `${vlog.label} — view in Step 03`)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: vlog.color }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: vlog.color, flexShrink: 0 }} />{vlog.label}
                          </span>
                        )}
                        {isExcluded && <span className="std-avs" style={{ color: '#8B8478' }}>Excluded from pack</span>}
                        {/* Qualifying note — faint, no fill. */}
                        {isQual && <span className="std-avs" style={{ color: '#AEB4C2', fontWeight: 500 }}>{qualWord}</span>}
                        {isBad && (
                          <>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#A32D2D' }}>
                              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#A32D2D', flexShrink: 0 }} />Non-qualifying
                            </span>
                            <div className="std-avs" style={{ color: '#A32D2D', textAlign: 'right', maxWidth: 230 }}>{c.reason}</div>
                            <button className="std-fix" onClick={(ev) => { ev.stopPropagation(); e.type === 'watchkeeping' ? reclassify(e.id) : excludeEntry(e.id); }}>
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
          {offCargoDays > 0 && <> · <b style={{ color: '#5A6478' }}>{offCargoDays} {offCargoDays === 1 ? 'day' : 'days'} off-Cargo</b> — counts toward your pathway, but not Cargo-verifiable (use your own testimonial)</>}
        </div>
      </div>
    );
  };

  return (
    <div className="std">
      <div className="std-head">
        <div className="std-sechead"><h3 className="cp-hor-title">SEA&nbsp;TIME<span className="pn">,</span> <em>Tracker</em><span className="pn">.</span></h3></div>
        <div className="std-controls">
          <button className="std-logbtn" style={{ background: '#fff', color: '#1C1B3A', border: '1px solid #E6E8EC' }} onClick={openPrior}><Icon name="History" size={16} /> Prior service</button>
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
      {prior.onboard > 0 && (
        <div className="std-filternote">
          Pathway also counts <b>{prior.onboard} prior {prior.onboard === 1 ? 'day' : 'days'}</b> entered before Cargo ({prior.seagoing} seagoing · {prior.watchkeeping} watchkeeping · {prior.standby} standby · {prior.yard} yard) · <button type="button" onClick={openPrior}>Edit</button>
        </div>
      )}

      {/* ── certification journey: NoE → oral exam → CoC ── */}
      {(() => {
        const j = journey || JOURNEY_DEFAULT;
        const eligible = requirements.length > 0 && requirements.every(r => r.met);
        const noeExpiry = addYearsIso(j.noe?.issueDate, 5);
        const oralExpiry = addYearsIso(j.oral?.passDate, 3);
        const noeDte = daysUntil(noeExpiry), oralDte = daysUntil(oralExpiry);
        const Stage = ({ n, label, state, line, warn }) => (
          <div style={{ flex: '1 1 150px', minWidth: 150, border: '1px solid #ECEAE3', borderRadius: 12, padding: '12px 14px', background: state === 'done' ? '#EFF6F1' : '#FAFAF8' }}>
            <div className="mlabel" style={{ marginBottom: 4 }}>{n} · {label}</div>
            <div style={{ fontWeight: 700, fontSize: 13, color: state === 'done' ? '#3F7A52' : state === 'active' ? '#C65A1A' : '#8B8478' }}>{line}</div>
            {warn && <div style={{ fontSize: 11.5, color: '#A6712C', marginTop: 3 }}>{warn}</div>}
          </div>
        );
        return (
          <div className="std-card" style={{ marginTop: 18, padding: '16px 18px' }}>
            <div className="std-flex std-between std-ac" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div className="mlabel rustlabel">Certification journey{cert?.label ? ` · ${cert.label}` : ''}</div>
              <button className="std-dl" style={{ background: '#fff', color: '#1C1B3A', border: '1px solid #E6E8EC' }} onClick={openJourney}><Icon name="Route" size={15} /> Update journey</button>
            </div>
            <div className="std-vs" style={{ marginTop: 2, marginBottom: 12 }}>NoE / NoA → oral exam → CoC. Cargo tracks your progress and the MCA validity timers; the milestones are yours to confirm.{MSF_FORMS[deptId] ? ` Apply with ${MSF_FORMS[deptId].form} (${MSF_FORMS[deptId].notice}).` : ' Apply with the MSF form for your route.'}</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Stage n="01" label="Eligibility" state={eligible ? 'done' : 'active'}
                line={eligible ? 'Service requirements met' : `${requirements.filter(r => !r.met).length} requirement(s) to go`} />
              <Stage n="02" label="Notice of Eligibility"
                state={j.noe?.status === 'issued' ? 'done' : j.noe?.status === 'applied' ? 'active' : 'todo'}
                line={j.noe?.status === 'issued' ? `Issued ${fmtDate(j.noe.issueDate)}` : j.noe?.status === 'applied' ? 'Applied — awaiting NoE' : 'Not applied'}
                warn={j.noe?.status === 'issued' && noeDte != null ? (noeDte < 0 ? 'NoE expired — reapply' : `Valid to ${fmtDate(noeExpiry)}${noeDte < 180 ? ` · ${noeDte}d left` : ''}`) : null} />
              <Stage n="03" label="Oral exam"
                state={j.oral?.status === 'passed' ? 'done' : (j.oral?.status === 'booked' || j.oral?.status === 'failed') ? 'active' : 'todo'}
                line={j.oral?.status === 'passed' ? `Passed ${fmtDate(j.oral.passDate)}` : j.oral?.status === 'booked' ? 'Booked' : j.oral?.status === 'failed' ? 'Failed — reapply' : 'Not booked'}
                warn={j.oral?.status === 'passed' && !j.coc?.issuedDate && oralDte != null ? (oralDte < 0 ? 'Pass expired — re-sit' : `Pass valid to ${fmtDate(oralExpiry)}${oralDte < 180 ? ` · ${oralDte}d left` : ''}`) : null} />
              <Stage n="04" label="Certificate of Competency"
                state={j.coc?.issuedDate ? 'done' : 'todo'}
                line={j.coc?.issuedDate ? `Issued ${fmtDate(j.coc.issuedDate)}` : '—'} />
            </div>
          </div>
        );
      })()}

      <div style={{ marginTop: 18 }}>{LedgerTable()}</div>

      {/* ── pack generator ── */}
      <div style={{ marginTop: 18 }}>
        <div className="std-dossier">
          <div className="std-dossier-h">
            <div>
              <div className="mlabel rustlabel">{SHOW_SIGNOFF ? 'Captain-verified · MSN 1858' : 'For your verifying organisation · MSN 1858'}</div>
              <h3>{SHOW_SIGNOFF ? 'Sea Service Testimonial Pack' : 'Sea Service Record'}</h3>
              <div className="sub">{SHOW_SIGNOFF
                ? 'Your sea service, confirmed by each ship’s captain — use it to complete your verifying organisation’s submission, or attach it as supporting evidence.'
                : 'Your compiled sea service, ready to export for PYA or Nautilus to verify. They issue the testimonial your captain signs — Cargo just gets your record right first.'}</div>
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
                    const onFile = d.profileDoc ? docsOnFile[d.profileDoc] : null;
                    const met = !!docMetEffective[d.id];
                    // Profile-backed docs are read-only (pulled from Documents);
                    // others keep the manual toggle.
                    return (
                      <div className={`std-doc2${met ? ' on' : ''}`} key={d.id} onClick={d.profileDoc ? undefined : () => toggleDoc(d.id)} style={d.profileDoc ? { cursor: 'default' } : undefined}>
                        <span className="ring">{met && <Icon name="Check" size={12} color="#fff" />}</span>
                        <span className="dl">{d.label}</span>
                        {d.profileDoc && (onFile?.fileUrl
                          ? <a href={onFile.fileUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: '#C65A1A', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="Paperclip" size={12} /> View</a>
                          : <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#A6712C' }}>Add to your profile documents</span>)}
                      </div>
                    );
                  })}
                </div>
                <div className="std-fee">{vp.fee}</div>
              </div>
            </div>

            {/* 03 Attest by vessel — one master per ship (parked: sign-off hidden) */}
            {SHOW_SIGNOFF && (
            <div className="std-fstep" id="std-verify">
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
                      <div className={`std-vrow${done ? ' done' : ''}`} key={v.key} data-vessel={v.id}>
                        <span className="std-vrail" style={{ background: rm.color }} />
                        <div className="std-vmain">
                          <div className="std-vtop">
                            <span className="vn">{v.name}</span>
                            {v.multi && <span className="std-vcmd"><Icon name="GitBranch" size={10} /> {v.cmdLabel}</span>}
                          </div>
                          <div className="std-vmeta">{v.flag} · {v.gt}GT · {v.lengthM}m · <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{v.captainName || 'Captain'}</b> · {v.masterNote}</div>
                          <div className="std-vhow" style={v.att.status === 'declined' ? { color: '#B14E16' } : undefined}>{v.att.status === 'declined'
                            ? `${v.captainName || 'The captain'} declined${v.declineReason ? ` — “${v.declineReason}”` : ''}. Edit the days and resend.`
                            : (done && v.att.fileName ? `Uploaded · ${v.att.fileName}` : v.how)}</div>
                          {v.testimonialPath && (
                            <button type="button" onClick={() => viewTestimonial(v.testimonialPath)} style={{ marginTop: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 600, color: '#C65A1A', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <Icon name="FileText" size={13} /> View testimonial
                            </button>
                          )}
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
                          {!done && v.mode !== 'external' && !canAttest && (v.att.status === 'outstanding' || v.att.status === 'declined') && (
                            v.reach === 'email' ? (
                              <div className="std-flex std-ac" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                <button className="std-vbtn rust" disabled={!canGenerate} onClick={() => requestVessel(v, 'email')}><Icon name="Mail" size={13} /> {v.att.status === 'declined' ? 'Edit & resend' : 'Email for signature'}</button>
                                <button className="std-vbtn ghost" disabled={!canGenerate} onClick={() => openUpload(v)}><Icon name="Upload" size={13} /> Upload instead</button>
                              </div>
                            ) : (
                              <button className="std-vbtn rust" disabled={!canGenerate} onClick={() => requestVessel(v, 'app')}>
                                <Icon name="Send" size={13} /> {v.att.status === 'declined' ? 'Edit & resend' : (v.mode === 'stamp' ? 'Ask captain to verify' : 'Ask captain to sign')}
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
            )}
          </div>

          {SHOW_SIGNOFF && (
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
          )}

          {/* Parked export when sign-off is hidden — the per-voyage service data the
              crew hands to PYA/Nautilus. (Form-faithful export is the next build.) */}
          {!SHOW_SIGNOFF && (
            <div className="std-issue" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 14 }}>
              <div className="std-flex std-between" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div className="mlabel">Export · for {vp.name}</div>
                  <div className="std-issue-h">{verifier === 'nautilus'
                    ? 'One testimonial per captain — each endorses only the dates they were in command. Manual & off-Cargo days are excluded.'
                    : `${live.length} entries · ${buckets.total} qualifying days — export your record to start your ${vp.label} submission`}</div>
                </div>
                <button className="std-dl" style={{ background: '#fff', color: '#1C1B3A', border: '1px solid #E6E8EC' }} onClick={onExportCsv}><Icon name="Table" size={15} /> Service data (CSV)</button>
              </div>
              {verifier === 'nautilus' && (
                nautilusSpells.length === 0
                  ? <div className="std-foot" style={{ padding: 0 }}>No Cargo-tracked service to export yet — it auto-logs from your current vessel.</div>
                  : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {nautilusSpells.map((s, i) => (
                        <div key={i} className="std-flex std-between std-ac" style={{ gap: 12, padding: '10px 12px', border: '1px solid #ECEAE3', borderRadius: 10, background: '#FAFAF8' }}>
                          <div>
                            <div style={{ fontWeight: 600, color: '#1C1B3A', fontSize: 13 }}>{vessels[s.vesselId]?.name || 'Vessel'} · {s.captainId === userId ? 'your service as Master' : (s.captainName || 'Captain')}</div>
                            <div className="std-vs">{fmtDate(s.from)} – {fmtDate(s.to)} · {s.days} {s.days === 1 ? 'day' : 'days'}{s.captainId === userId ? ' · endorsed by company' : ''}</div>
                          </div>
                          <button className="std-dl" style={{ background: '#C65A1A', color: '#fff' }} onClick={() => onDownloadSpell(s)}><Icon name="FileText" size={15} /> Nautilus form (PDF)</button>
                        </div>
                      ))}
                    </div>
              )}
            </div>
          )}

          {SHOW_SIGNOFF && signed && (
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
                    <tr key={v.key}>
                      <td>{v.name}{v.multi && <span className="std-tcmd">{v.captainName} · {v.cmdLabel?.replace('In command ', '')}</span>}</td>
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
                        const sm = signoffMeta[v.key] || {};
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
                          <div className="std-sig" key={v.key}>
                            {sm.signature?.kind === 'drawn' && sm.signature.image
                              ? <img className="std-sig-img" src={sm.signature.image} alt={`${nm} signature`} />
                              : sm.signature?.kind === 'typed' && sm.signature.text
                                ? <div className="std-sig-script">{sm.signature.text}</div>
                                : null}
                            <div className="std-sig-name">{nm}<span>Master · {v.name}{v.multi ? ` · ${v.cmdLabel?.replace('In command ', '')}` : ''}</span></div>
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

      {/* ── prior service before Cargo (lump-sum baseline) ── */}
      {priorOpen && createPortal(
        <div className="cso-overlay" onClick={() => setPriorOpen(false)}>
          <div className="cso" role="dialog" aria-modal="true" aria-label="Prior service before Cargo" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
            <button className="cso-x" onClick={() => setPriorOpen(false)} aria-label="Close"><Icon name="X" size={18} /></button>
            <div className="cso-head">
              <div className="cso-eyebrow">Pathway · before Cargo</div>
              <h3 className="cso-title">Prior sea service</h3>
              <div className="cso-sub">Service you accrued <b>before Cargo</b> (or that can’t be auto-logged), as a lump sum. It counts toward your pathway alongside your Cargo-tracked service — keep your own testimonials as evidence for it.</div>
            </div>
            <div className="cso-body">
              <div className="cso-grid">
                {[['seagoing', 'Seagoing days'], ['watchkeeping', 'Watchkeeping days'], ['standby', 'Standby days'], ['yard', 'Shipyard days']].map(([k, label]) => (
                  <div className="cso-fld" key={k}>
                    <label className="cso-lbl">{label}</label>
                    <input className="cso-input" type="number" min="0" value={priorDraft[k]} onChange={e => setPriorDraft(d => ({ ...d, [k]: e.target.value }))} placeholder="0" />
                  </div>
                ))}
              </div>
              <div className="cso-fld" style={{ marginTop: 12 }}>
                <label className="cso-lbl">Note <span className="opt">optional</span></label>
                <input className="cso-input" value={priorDraft.note} onChange={e => setPriorDraft(d => ({ ...d, note: e.target.value }))} placeholder="e.g. 2019–2023, prior to joining Cargo" />
              </div>
            </div>
            <div className="cso-foot">
              <button className="cso-btn ghost" onClick={() => setPriorOpen(false)}>Cancel</button>
              <button className="cso-btn rust" onClick={savePrior}><Icon name="Check" size={15} /> Save prior service</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── certification journey editor ── */}
      {journeyOpen && journeyDraft && createPortal(
        <div className="cso-overlay" onClick={() => setJourneyOpen(false)}>
          <div className="cso" role="dialog" aria-modal="true" aria-label="Certification journey" style={{ width: 520 }} onClick={e => e.stopPropagation()}>
            <button className="cso-x" onClick={() => setJourneyOpen(false)} aria-label="Close"><Icon name="X" size={18} /></button>
            <div className="cso-head">
              <div className="cso-eyebrow">Pathway · NoE / NoA → oral → CoC</div>
              <h3 className="cso-title">Certification journey</h3>
              <div className="cso-sub">Record where you are in the MCA process. Cargo isn’t part of the MCA confirmation — these milestones are yours to keep, and they drive the validity reminders (NoE 5 years, oral pass 3 years).</div>
            </div>
            <div className="cso-body">
              <div className="cso-fld">
                <label className="cso-lbl">Notice of Eligibility / Assessment</label>
                <div className="cso-grid">
                  <select className="cso-input" value={journeyDraft.noe?.status || 'not_applied'} onChange={e => setJD('noe.status', e.target.value)}>
                    <option value="not_applied">Not applied</option>
                    <option value="applied">Applied — awaiting</option>
                    <option value="issued">Issued</option>
                  </select>
                  <input className="cso-input" type="date" value={journeyDraft.noe?.issueDate || ''} onChange={e => setJD('noe.issueDate', e.target.value)} disabled={journeyDraft.noe?.status !== 'issued'} title="Issue date" />
                </div>
              </div>
              <div className="cso-fld" style={{ marginTop: 12 }}>
                <label className="cso-lbl">Oral examination</label>
                <select className="cso-input" value={journeyDraft.oral?.status || 'not_booked'} onChange={e => setJD('oral.status', e.target.value)}>
                  <option value="not_booked">Not booked</option>
                  <option value="booked">Booked</option>
                  <option value="passed">Passed</option>
                  <option value="failed">Failed</option>
                </select>
                <div className="cso-grid" style={{ marginTop: 8 }}>
                  <div><div className="cso-lbl" style={{ marginBottom: 3 }}>Booked for</div><input className="cso-input" type="date" value={journeyDraft.oral?.bookedDate || ''} onChange={e => setJD('oral.bookedDate', e.target.value)} /></div>
                  <div><div className="cso-lbl" style={{ marginBottom: 3 }}>Passed on</div><input className="cso-input" type="date" value={journeyDraft.oral?.passDate || ''} onChange={e => setJD('oral.passDate', e.target.value)} disabled={journeyDraft.oral?.status !== 'passed'} /></div>
                </div>
              </div>
              <div className="cso-fld" style={{ marginTop: 12 }}>
                <label className="cso-lbl">CoC issued</label>
                <input className="cso-input" type="date" value={journeyDraft.coc?.issuedDate || ''} onChange={e => setJD('coc.issuedDate', e.target.value)} />
              </div>
              <div className="cso-fld" style={{ marginTop: 12 }}>
                <label className="cso-lbl">Note <span className="opt">optional</span></label>
                <input className="cso-input" value={journeyDraft.note || ''} onChange={e => setJD('note', e.target.value)} placeholder="e.g. NoE ref, exam centre" />
              </div>
            </div>
            <div className="cso-foot">
              <button className="cso-btn ghost" onClick={() => setJourneyOpen(false)}>Cancel</button>
              <button className="cso-btn rust" onClick={saveJourney}><Icon name="Check" size={15} /> Save journey</button>
            </div>
          </div>
        </div>,
        document.body
      )}

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
      {signFor && (
        <CaptainSignoff
          variant="modal"
          unit={signFor}
          seafarer={seafarer}
          isEng={deptId === 'engineering'}
          signerName={canAttest ? currentUser?.fullName : null}
          signerEmail={canAttest ? currentUser?.email : null}
          onSign={confirmSignoff}
          onDecline={declineSignoff}
          onClose={closeSignoff}
        />
      )}

      {/* ── external testimonial — ship's-stamp confirmation before upload ── */}
      {extConfirm && createPortal(
        <div className="cso-overlay" onClick={() => setExtConfirm(null)}>
          <div className="cso" role="dialog" aria-modal="true" aria-label="Upload signed testimonial" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
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
        </div>,
        document.body
      )}

      {toast && <div className="std-toast"><Icon name="Check" size={16} color="#5E8E6F" /> {toast}</div>}
    </div>
  );
};

export default SeaTimeDashboard;
