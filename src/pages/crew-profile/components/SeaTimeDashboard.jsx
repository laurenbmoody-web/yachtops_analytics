import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabase';
import { fetchEntriesForUser, fetchEntriesAcrossVessels, addManualEntries, submitEntries, signEntries, syncFromVessel, fetchLeaveDaysInRange, fetchGuestOnDays } from '../utils/seaTimeService';
import { adaptLiveEntries } from '../utils/seaTimeLiveAdapter';
import SeaServiceCalendar from './SeaServiceCalendar';
import { SHOW_SIGNOFF } from '../../../seatime/signoffFlag';
import {
  DEFAULT_CONFIG, TYPE_META, SOURCE_META, VERIFIER_PROFILES,
  classify, computeBuckets, buildRequirementBars, runChecks, buildTestimonialDataset, recentQualifyingDays
} from '../../../seatime/engine';
import {
  DEPARTMENTS, DEPT_FAMILIES, CERTIFICATES, GOAL_OPTIONS, DEFAULT_GOAL, routeFor, GRADE_TO_CERT, CERT_TO_GRADE, yardCapForCertificate, certConfidence, legacyConversionForGrade, CONVERSION_RECENCY, DUAL_CAPACITY_RATE, isDualCapacityRole, ancillaryFor
} from '../../../seatime/pathways';
import { fetchCrewDocuments, uploadDocumentFile } from '../utils/crewDocuments';
import { sendDbNotification } from '../../../lib/dbNotifications';
import { SEED_VESSELS, SEED_ENTRIES, SEED_PRIOR, SEED_SEAFARER } from '../../../seatime/seed';
import { buildAssurance, makeQrDataUrl, renderPackPdf, buildSpellTestimonialPdf, downloadBytes } from '../../../seatime/packExport';
import { buildNautilusSST } from '../../../seatime/nautilusExport';
import { buildTransportMaltaSST, buildTransportMaltaEngineSST } from '../../../seatime/transportMaltaExport';
import { buildPyaPayload } from '../../../seatime/pya/pyaPayload';
import { buildPyaClipboard } from '../../../seatime/pya/pyaBookmarklet';
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
const JOURNEY_DEFAULT = {
  noe:  { status: 'not_applied', appliedDate: '', issueDate: '', ref: '', file: null },
  oral: { status: 'not_booked', bookedDate: '', passDate: '', ref: '', fails: [], file: null },
  coc:  { status: 'not_applied', appliedDate: '', issuedDate: '', ref: '', file: null, checklist: {} },
  note: '',
};
// The NoE/NoA spans many routes, each with its own application form + Marine
// Notice (gov.uk). The journey is the same; only the form differs by route.
const MSF_FORMS = {
  deck: { form: 'MSF 4343', notice: 'MSN 1858', label: 'Yacht Deck Officers' },
  engineering: { form: 'MSF 4275', notice: 'MSN 1857', label: 'Engineer Officers' },
};
const addYearsIso = (iso, n) => { if (!iso) return ''; const [y, m, d] = String(iso).split('-'); return `${+y + n}-${m}-${d}`; };
const daysUntil = (iso) => { if (!iso) return null; return Math.round((new Date(iso + 'T00:00:00') - new Date()) / 86400000); };
const yearOf = (e) => (e.from ? +String(e.from).slice(0, 4) : null);

// Map a crew member's DB department (tenant_members → departments.name) to the
// sea-time pathway department, so the tracker opens on the right ladder for the
// crew member's actual role. Bridge officers sit on the deck pathway.
const DEPT_NAME_TO_ID = {
  Deck: 'deck', Bridge: 'deck', Engineering: 'engineering', Interior: 'interior', Galley: 'galley'
};

const SeaTimeDashboard = ({ userId, tenantId, currentUser, onAddCertificate, onAddDocument, canAttest = false }) => {
  const config = DEFAULT_CONFIG;
  const [deptId, setDeptId] = useState('deck');
  const [dualMode, setDualMode] = useState(false);   // dual deck+engine: 50% credit
  const dualRate = dualMode ? DUAL_CAPACITY_RATE : 1;
  const [coursesOpen, setCoursesOpen] = useState(false);  // courses & tickets section
  const [goalId, setGoalId] = useState(DEFAULT_GOAL.DECK); // '' == logging-only
  const [heldCerts, setHeldCerts] = useState({});          // certId -> { issueDate, number, fileUrl, fileName, docId }
  const [docsOnFile, setDocsOnFile] = useState({});        // doc_type -> { fileUrl, fileName, docId } from the profile
  const [untaggedCocs, setUntaggedCocs] = useState(0);     // CoC docs with no recognised grade -> can't be matched
  const [heldOpen, setHeldOpen] = useState(false);
  const [serviceFilter, setServiceFilter] = useState('all');
  const [logView, setLogView] = useState('list');
  const [ledgerScope, setLedgerScope] = useState('all'); // 'all' | 'cargo' (Cargo-tracked only)
  const [ledgerYear, setLedgerYear] = useState(null);    // selected year in the list view (null = latest)
  const [openMonths, setOpenMonths] = useState(null);    // collapsible month groups (null = untouched → latest month open)
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
  const [guestOnDays, setGuestOnDays] = useState(null);     // Yacht Purser evidence — manual override (days with guests aboard)
  const [derivedGuest, setDerivedGuest] = useState(null);   // { days, trips } auto-derived from trips carrying guests
  const [priorOpen, setPriorOpen] = useState(false);
  const [priorDraft, setPriorDraft] = useState({ seagoing: '', watchkeeping: '', standby: '', yard: '', note: '' });
  // Certification journey: NoE -> oral exam -> CoC, with the MCA validity timers.
  const [journey, setJourney] = useState(null);
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [journeyDraft, setJourneyDraft] = useState(null);
  const [journeyStep, setJourneyStep] = useState('noe');   // which milestone the modal is scoped to
  const [cocListOpen, setCocListOpen] = useState(null);     // CoC "what to send" collapse (null = auto: open while gathering)
  const [eligOpen, setEligOpen] = useState(false);          // eligibility detail expand (step 01)
  const [pathwayCfgOpen, setPathwayCfgOpen] = useState(false); // dept/goal popover anchored to the target title
  const cfgRef = useRef(null);
  // Years marked "accounted for" (verified + submitted toward a prior CoC) →
  // collapsed in the ledger and excluded from the active pathway.
  const [accounted, setAccounted] = useState({});
  const [usingSample, setUsingSample] = useState(true);
  const toastTimer = useRef(null);
  const ledgerRef = useRef(null);
  const journeyRef = useRef(null); // certification-journey card, for the status strip CTA

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
  // The route is a strict progression — each rung requires the one below it, so
  // holding a higher rung implies every rung at or below it is satisfied (a crew
  // member who logged only their top CoC still counts as having the rest). The
  // live target is therefore the first rung ABOVE the highest held cert; if the
  // highest held cert is the goal itself, the route is complete (no target).
  // Per-certificate journeys: cert_progression is a map of certId -> {noe,oral,coc}.
  // Legacy rows stored a single {noe,oral,coc}; treat that as the journey for the
  // first un-held rung (the cert it was tracking).
  const docHeldIdx = route.reduce((max, id, i) => (heldCerts[id] ? i : max), -1);
  const baseTargetId = docHeldIdx >= route.length - 1 ? null : route[docHeldIdx + 1];
  // A legacy single-object journey predates the per-cert map and multi-family
  // routes — it was always the DECK pathway. Only attribute it to a DECK base
  // target, never to engine/ETO/interior, so a finished deck journey can't mark
  // an unrelated cert (e.g. the Yacht Purser) as held on a different pathway.
  const isLegacyJourney = journey && ('noe' in journey || 'oral' in journey || 'coc' in journey);
  const journeyMap = isLegacyJourney
    ? (baseTargetId && CERTIFICATES[baseTargetId]?.family === 'DECK' ? { [baseTargetId]: journey } : {})
    : (journey || {});
  const cocIssuedIn = (jr) => !!jr && (jr.coc?.status === 'issued' || !!jr.coc?.issuedDate);
  // A completed certification journey (CoC recorded as issued) means the crew now
  // holds that rung — fold it into the held set so the target advances to the next
  // rung, exactly as uploading the CoC document would.
  const effectiveHeld = { ...heldCerts };
  for (const [cid, jr] of Object.entries(journeyMap)) {
    if (cocIssuedIn(jr) && !effectiveHeld[cid]) effectiveHeld[cid] = { issueDate: jr.coc.issuedDate || '', number: jr.coc.ref || '', fromJourney: true };
  }
  const highestHeldIdx = route.reduce((max, id, i) => (effectiveHeld[id] ? i : max), -1);
  const targetId = highestHeldIdx >= route.length - 1 ? null : route[highestHeldIdx + 1];
  const routeComplete = !targetId && route.length > 0;
  const cert = targetId && CERTIFICATES[targetId] ? CERTIFICATES[targetId] : null;
  // The live journey is the current target's entry (fresh until they start it).
  const activeJourney = (targetId && journeyMap[targetId]) ? journeyMap[targetId] : JOURNEY_DEFAULT;
  const rungs = route.map(id => ({ id, ...CERTIFICATES[id] }));
  const familyCerts = family ? Object.entries(CERTIFICATES).filter(([, c]) => c.family === family).map(([id, c]) => ({ id, ...c })) : [];
  const crossDiscipline = !!family && !deptFamilies.includes(family);
  const deptLabel = DEPARTMENTS[deptId]?.label || '—';
  const familyWord = family === 'DECK' ? 'Deck' : family === 'ENGINE' ? 'Engine' : family === 'ETO' ? 'ETO' : '';
  const familyPathLabel = family === 'DECK' ? 'Bridge pathway' : family === 'ENGINE' ? 'Engine pathway' : family === 'ETO' ? 'ETO pathway' : '';
  // Who signs the testimonial, by department: the chief engineer for engine/ETO
  // service (MSN 1904 §5.5), otherwise the captain.
  const signerWord = (family === 'ENGINE' || family === 'ETO') ? 'chief engineer' : 'captain';
  // The crew's OWN top rank on board — used when their own service can't be
  // self-attested and the company signs instead.
  const topRankWord = (family === 'ENGINE' || family === 'ETO') ? 'Chief Engineer' : 'Master';

  const goalForDept = (id) => { const fams = DEPT_FAMILIES[id] || []; return fams.length ? (DEFAULT_GOAL[fams[0]] || '') : ''; };
  // Changing department re-defaults the goal to that department's ceiling
  // (or logging-only when the department accrues toward nothing).
  const changeDept = (id) => { setDeptId(id); setGoalId(goalForDept(id)); };
  const startPathway = () => setGoalId(goalForDept(deptId) || 'MASTER_YACHT_3000');
  const stopPathway = () => { setGoalId(''); setPathwayCfgOpen(false); };

  // Close the anchored dept/goal popover on any outside click.
  useEffect(() => {
    if (!pathwayCfgOpen) return;
    const onDoc = (e) => { if (cfgRef.current && !cfgRef.current.contains(e.target)) setPathwayCfgOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [pathwayCfgOpen]);

  // Role-aware default: open the tracker on the crew member's actual department,
  // and auto-apply the 50% dual rate if their assigned role is a dual deck+engine
  // role (Mate/Engineer, Deck/Engineer) — which holds whichever ladder they view.
  useEffect(() => {
    if (!userId || !tenantId) return;
    let cancel = false;
    (async () => {
      const { data } = await supabase
        .from('tenant_members')
        .select('departments(name), role:roles!role_id(name)')
        .eq('tenant_id', tenantId).eq('user_id', userId).eq('active', true).maybeSingle();
      if (cancel || !data) return;
      const mapped = DEPT_NAME_TO_ID[data.departments?.name];
      if (mapped) { setDeptId(mapped); setGoalId(goalForDept(mapped)); }
      if (isDualCapacityRole(data.role?.name || '')) setDualMode(true);
    })();
    return () => { cancel = true; };
  }, [userId, tenantId]);

  // Derive guest-on days from trips that carry guests (Yacht Purser evidence).
  useEffect(() => {
    if (!userId || !tenantId) return;
    let cancel = false;
    fetchGuestOnDays(tenantId, userId).then(r => { if (!cancel && r) setDerivedGuest(r); }).catch(() => {});
    return () => { cancel = true; };
  }, [userId, tenantId]);

  // Never let the goal sit below the crew member's highest held qualification in
  // the current family: if they already hold a CoC above (or off) the default
  // goal's route, raise the goal to it so the pathway reflects what they hold
  // (it then shows "achieved"; they can still manually aim higher). Height = how
  // many rungs a cert's own route has.
  useEffect(() => {
    if (!family) return;
    const heldInFamily = Object.keys(heldCerts).filter(id => CERTIFICATES[id]?.family === family);
    if (!heldInFamily.length) return;
    const height = (id) => routeFor(id).length;
    const highestHeld = heldInFamily.reduce((a, b) => (height(b) > height(a) ? b : a));
    if (!routeFor(goalId).includes(highestHeld) && height(highestHeld) >= height(goalId)) {
      setGoalId(highestHeld);
    }
  }, [heldCerts, family, goalId]);

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
        supabase?.from('profiles')?.select('full_name, first_name, surname, email')?.eq('id', captainId)?.maybeSingle(),
        supabase?.from('personal_documents')?.select('document_number, issuing_authority, flag_state')?.eq('user_id', captainId)?.eq('doc_type', 'coc')?.order('expiry_date', { ascending: false, nullsFirst: false })?.limit(1)?.maybeSingle(),
      ]);
      const cd = cp?.data || {};
      const name = (cd.first_name && cd.surname) ? `${cd.first_name} ${cd.surname}` : (cd.full_name || captainName || '');
      const cc = coc?.data || {};
      const issuingCountry = countryName(cc.flag_state) || cc.issuing_authority || '';
      return { position: 'Master', name, cocNo: cc.document_number || '', issuingCountry, email: cd.email || '' };
    } catch (e) {
      console.warn('[seatime] endorser resolve failed', e);
      return { position: 'Master', name: captainName || '', cocNo: '', issuingCountry: '', email: '' };
    }
  };

  // ── load live data ──
  const loadLive = async () => {
    if (!tenantId || !userId) return;
    try {
      // Sea service is a personal career record — fetch across EVERY Cargo vessel
      // the crew member has served on (RLS scopes it: the seafarer sees all their
      // vessels; a COMMAND viewer sees only their own vessel's portion).
      const [rows, prof, pd, ves] = await Promise.all([
        fetchEntriesAcrossVessels(userId, 'mca-oow-yachts', tenantId),
        supabase?.from('profiles')?.select('full_name, first_name, surname')?.eq('id', userId)?.maybeSingle(),
        supabase?.from('crew_personal_details')?.select('date_of_birth, nationality, discharge_book_number, verifier_membership_number, sea_service_prior, cert_progression, accounted_years, guest_on_days')?.eq('user_id', userId)?.maybeSingle(),
        supabase?.from('vessels')?.select('name, imo_number, company_name, company_address, company_email, company_phone, company_country, company_postcode, propulsion_kw, loa_m, typical_guest_count')?.eq('tenant_id', tenantId)?.maybeSingle(),
      ]);
      // The certified passport copy auto-ticks the pack's proof-of-identity doc
      // via docMetEffective + profileDoc (which also links the file) — see below.
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
        setGuestOnDays(pd?.data?.guest_on_days ?? null);
        setJourney(pd?.data?.cert_progression || null);
        setAccounted(pd?.data?.accounted_years || {});
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
      let untagged = 0;
      for (const d of docs || []) {
        // Supporting docs for the verifier submission, pulled from the profile.
        // Carry the document number too (the passport doc is the source of truth
        // for the holder's ID number on official forms).
        if (!onFile[d.doc_type]) onFile[d.doc_type] = { fileUrl: d.file_url, fileName: d.file_name, docId: d.id, documentNumber: d.document_number || '' };
        if (d.doc_type !== 'coc') continue;
        const cid = GRADE_TO_CERT[d.details?.grade];
        if (cid) held[cid] = { issueDate: d.issue_date, number: d.document_number, fileUrl: d.file_url, fileName: d.file_name, docId: d.id,
          // If they recorded an old MSN 1859 Y-grade, remember it so we can nudge
          // them to convert it to the in-force Small Vessel CoC.
          legacy: legacyConversionForGrade(d.details?.grade) };
        else untagged++;  // a CoC with no recognised grade — can't be matched to the ladder
      }
      setHeldCerts(held);
      setDocsOnFile(onFile);
      setUntaggedCocs(untagged);
    }).catch(e => console.error('held certs load failed', e));
  }, [userId]);

  // ── derived ──
  // Cargo-tracked vessels = those Cargo auto-logs (rota / status / AIS); a vessel
  // qualifies once it has any auto-logged day. Off-Cargo vessels the crew adds
  // manually still show and still count toward the pathway — they just aren't
  // Cargo-verifiable (so they're excluded from the per-endorser export). The
  // ledger has a toggle to show all vessels or Cargo-tracked only.
  const cargoVesselIds = useMemo(() => new Set(entries.filter(e => e.source === 'vessel').map(e => e.vesselId)), [entries]);
  // Accounted-for years are excluded from the ACTIVE pathway (spent on a prior
  // CoC) — but still shown (collapsed) in the ledger.
  const accountedSet = useMemo(() => new Set(Object.keys(accounted || {}).map(Number)), [accounted]);
  const pathwayEntries = useMemo(() => entries.filter(e => !accountedSet.has(yearOf(e))), [entries, accountedSet]);
  // Yard cap is per-certificate (90 for OOW, 30 for Master/Chief Mate) — fold it
  // into the config so the yard bucket totals against the right MCA ceiling.
  const buckets = useMemo(
    () => computeBuckets(pathwayEntries, vessels, { ...config, yardCapDays: yardCapForCertificate(targetId), dualRate }),
    [pathwayEntries, vessels, config, targetId, dualRate],
  );
  // A higher CoC only counts service done AS AN OFFICER, WHILE HOLDING its
  // prerequisite (MSN 1858 §3.4-3.6/§4; MSN 1904 §5.9.2). So its requirement
  // bars run on a gated bucket set: officer-capacity service dated on/after the
  // date the prerequisite CoC was held. `whileHoldingISO` is that date (null if
  // the crew hasn't recorded the prerequisite's issue date — then we gate by
  // officer capacity only and flag it). Prior (pre-Cargo) service has no dates
  // and is trusted as entered. Entry certs (no asOfficer) use the plain buckets.
  const whileHoldingISO = cert?.heldWhilstCert ? (effectiveHeld[cert.heldWhilstCert]?.issueDate || null) : null;
  const reqBuckets = useMemo(
    () => (cert?.asOfficer
      ? computeBuckets(pathwayEntries, vessels, { ...config, yardCapDays: yardCapForCertificate(targetId), dualRate, officerOnly: true, sinceISO: whileHoldingISO })
      : buckets),
    [cert, pathwayEntries, vessels, config, targetId, dualRate, whileHoldingISO, buckets],
  );
  // Recent qualifying seagoing service in the last 5 years (MCA recency rule).
  const recentDays = useMemo(() => recentQualifyingDays(pathwayEntries.filter(e => !e.excluded)), [pathwayEntries]);
  // Guest-on days for the Yacht Purser Route A gate — manual override if set,
  // otherwise the count auto-derived from guest-carrying trips.
  const effectiveGuestOn = guestOnDays != null ? guestOnDays : (derivedGuest?.days ?? 0);
  const requirements = useMemo(() => (cert ? buildRequirementBars(reqBuckets, prior, cert, recentDays, effectiveGuestOn) : []), [reqBuckets, prior, cert, recentDays, effectiveGuestOn]);
  // Ancillary courses/tickets for the target CoC, with held-state auto-detected
  // from the crew member's documents (a course counts as held once a matching
  // document type is on file).
  const ancillary = useMemo(
    () => (cert ? ancillaryFor(targetId).map(item => ({ ...item, met: item.anyOf.some(t => !!docsOnFile[t]) })) : []),
    [cert, targetId, docsOnFile],
  );
  const ancillaryDone = ancillary.filter(a => a.met).length;
  // Supporting-doc checks tick automatically when the matching profile document is
  // on file (passport, seaman's book); other docs keep their manual toggle.
  const docMetEffective = useMemo(() => {
    const out = { ...docMet };
    for (const d of (VERIFIER_PROFILES[verifier]?.docs || [])) {
      if (d.profileDoc) out[d.id] = !!docsOnFile[d.profileDoc]?.fileUrl; // needs an actual scan on file
    }
    return out;
  }, [docMet, verifier, docsOnFile]);
  const { checks, canGenerate, passed, total, readinessPct } = useMemo(() => runChecks({ entries, vessels, config, signatory, verifier, docMet: docMetEffective, cert, buckets }), [entries, vessels, config, signatory, verifier, docMetEffective, cert, buckets]);
  // Cert-specific MCA CoC-application bundle — what the crew sends to the MCA to
  // claim the certificate, shown inside the Certification journey's CoC step.
  // Live state where we can detect it (verified testimonial, NoE/oral from the
  // journey, ENG1 from Documents, courses from the ancillary list); the items we
  // can't detect (e.g. photos) are 'todo' and ticked by hand in the modal.
  const appChecklist = useMemo(() => {
    if (!cert) return [];
    const j = activeJourney;
    const noeIssued = !!j.noe?.issueDate || j.noe?.status === 'issued';
    const oralPassed = !!j.oral?.passDate || j.oral?.status === 'passed';
    const hasEng1 = !!docsOnFile?.eng1?.fileUrl;
    const coursesState = !ancillary.length ? 'na' : (ancillaryDone === ancillary.length ? 'done' : ancillaryDone > 0 ? 'pending' : 'todo');
    // Yacht Purser (IAMI GUEST) — verified senior service + GUEST courses +
    // guest-on days, submitted to the PYA. No testimonial/NoE/oral/ENG1.
    if (cert.family === 'INTERIOR') {
      const guestDays = guestOnDays != null ? guestOnDays : (derivedGuest?.days ?? 0);
      const guestTarget = cert.requires?.guestOnDays || 0;
      const guestMet = guestTarget ? guestDays >= guestTarget : guestDays > 0;
      return [
        { key: 'service', label: 'Verified senior yacht service (PYA)', detail: canGenerate ? 'Verified & ready to export' : 'Get your record verified first', state: canGenerate ? 'done' : 'todo' },
        { key: 'courses', label: 'IAMI GUEST course units', detail: ancillary.length ? `${ancillaryDone} of ${ancillary.length} on file — see Courses & tickets` : 'See Courses & tickets', state: coursesState },
        { key: 'guest', label: guestTarget ? `Guest-on days (Route A · ${guestTarget} min)` : 'Guest-on days evidenced', detail: guestTarget ? `${guestDays} of ${guestTarget} day${guestTarget === 1 ? '' : 's'} on record${guestMet ? '' : ' — or use Route B (3yr management)'}` : (guestDays > 0 ? `${guestDays} days on record` : 'Record on the pathway above'), state: guestMet ? 'done' : (guestDays > 0 ? 'pending' : 'todo') },
      ];
    }
    // Chief Mate (Yachts) is a courses-only endorsement — no NoE, no oral, and no
    // fresh testimonial (the OOW service already covers it). Other rungs need the
    // full exam bundle.
    const endorsement = cert.oral === false;
    return [
      !endorsement && { key: 'test', label: 'Verified Sea Service Testimonial (+ your SRB)', detail: canGenerate ? 'Verified & ready to export' : 'Get your record verified first', state: canGenerate ? 'done' : 'todo' },
      !endorsement && { key: 'noe', label: 'Notice of Eligibility (NoE)', detail: noeIssued ? 'On record' : 'Record it in step 02', state: noeIssued ? 'done' : 'todo' },
      !endorsement && { key: 'oral', label: 'Oral exam pass (valid 3 years)', detail: oralPassed ? 'Passed' : 'Record it in step 03', state: oralPassed ? 'done' : 'todo' },
      { key: 'courses', label: `Management-level courses for ${cert.short}`, detail: ancillary.length ? `${ancillaryDone} of ${ancillary.length} on file — see Courses & tickets` : 'None additional for this route', state: coursesState },
      { key: 'eng1', label: 'Valid ENG1 medical', detail: hasEng1 ? 'On file' : 'Add to your Documents', state: hasEng1 ? 'done' : 'todo' },
      { key: 'photos', label: 'Two passport-size photographs', detail: '', state: 'todo' },
    ].filter(Boolean);
  }, [cert, activeJourney, docsOnFile, ancillary, ancillaryDone, canGenerate, guestOnDays, derivedGuest]);
  const dataset = useMemo(() => buildTestimonialDataset({ seafarer, entries, vessels, signatory, verifier }), [seafarer, entries, vessels, signatory, verifier]);
  const assurance = useMemo(() => buildAssurance(dataset), [dataset]);

  // days-to-go tracks the certificate's largest single requirement (headline gate)
  const primary = requirements.reduce((a, b) => (b.required > (a?.required || 0) ? b : a), null) || requirements[0];
  const daysToGo = primary ? primary.remaining : 0;
  const live = entries.filter(e => !e.excluded);
  const totalLoggedDays = live.reduce((s, e) => s + (e.days || 0), 0);
  const badCount = live.filter(e => !classify(e, vessels[e.vesselId], config).qual).length;
  const hasAttention = badCount > 0;
  // Interior (Yacht Purser) service is verified by the PYA only — Nautilus and the
  // MCA-route verifiers don't handle purser/interior service. Other families get
  // the full list. interiorPathway re-skins the dossier copy for the purser route.
  const interiorPathway = cert?.family === 'INTERIOR';
  const verifierIds = useMemo(() => (interiorPathway ? ['pya'] : Object.keys(VERIFIER_PROFILES)), [interiorPathway]);
  useEffect(() => { if (!verifierIds.includes(verifier)) setVerifier(verifierIds[0]); }, [verifierIds, verifier]);
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
    if (!canGenerate) { flash('Resolve the outstanding validation checks first'); return; }
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
      // National ID = the passport number from the uploaded passport document.
      const passportNo = docsOnFile.passport?.documentNumber || docsOnFile.passport_certified_copy?.documentNumber || seafarer.passportNo || '';
      const pdfBytes = await buildNautilusSST({
        seafarer: { fullName: seafarer.fullName, dob: seafarer.dob, dischargeBook: seafarer.dischargeBookNo, nautilusNo: seafarer.membershipNo, nationalId: passportNo },
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
          // Exact leave/absence from crew_status_history; fall back to the
          // span-minus-days-aboard proxy if the lookup is unavailable.
          leaveDays: (await fetchLeaveDaysInRange(userId, from, to)) ?? Math.max(0, spanDays - totalDaysOnboard),
          actualSea: b.seagoing, standby: b.standby, yard: b.yard, watchkeeping: b.watchkeeping,
        },
        standbyPassages,
      });
      const who = (endorser.name || spell.captainName || 'captain').replace(/\s+/g, '-');
      downloadBytes(pdfBytes, `nautilus-sst-${(v.name || 'vessel').replace(/\s+/g, '-')}-${who}.pdf`);
      flash('Nautilus form ready');
    } catch (e) { console.error('[seatime] nautilus export', e); flash('Could not build the Nautilus form'); }
  };

  // Pre-fill the OFFICIAL Transport Malta testimonial (S.L. 499.23) for one
  // command spell — we stamp the factual service data onto Transport Malta's own
  // PDF; the endorsing officer completes the assessment + signs. The deck variant
  // carries LOA + max passengers (denormalised onto every Cargo-tracked day by
  // the autolog sync: vessel_length_m = LOA, vessel_max_pax = typical_guest_count);
  // the engineering variant carries the engine type & power column instead, and is
  // endorsed by the chief engineer rather than the master.
  const onDownloadSpellTM = async (spell) => {
    if (!canGenerate) { flash('Resolve the outstanding validation checks first'); return; }
    try {
      const v = vessels[spell.vesselId] || {};
      const rows = spell.entries
        .slice()
        .sort((a, b) => String(a.from).localeCompare(String(b.from)))
        .map(e => ({ from: e.from, to: e.to, capacity: e.capacity }));
      // Engineering routes use Transport Malta's Engineering-personnel variant
      // (engine-power column, chief-engineer endorser); deck routes use the deck
      // form. The endorser signs — the crew's OWN service in the top rank can't
      // be self-attested, so the company signs (position blank, company named).
      const engineForm = family === 'ENGINE' || family === 'ETO';
      const topRankPosition = engineForm ? 'Chief Engineer' : 'Master';
      const isOwnTopRank = spell.captainId === userId;
      let signatoryName = '', position = '', companyName = '';
      if (isOwnTopRank) {
        companyName = company?.company_name || '';
      } else {
        const endorser = await resolveEndorserFor(spell.captainId, spell.captainName);
        signatoryName = endorser?.name || spell.captainName || '';
        position = topRankPosition;
      }
      // I.D. No. = the passport number from the uploaded passport document
      // (its document_number); fall back to the sample seafarer in preview.
      const passportNo = docsOnFile.passport?.documentNumber || docsOnFile.passport_certified_copy?.documentNumber || seafarer.passportNo || '';
      flash('Pre-filling the Transport Malta form…');
      const build = engineForm ? buildTransportMaltaEngineSST : buildTransportMaltaSST;
      const pdfBytes = await build({
        seafarer: { fullName: seafarer.fullName, idNo: passportNo },
        vessel: engineForm
          ? { name: v.name, type: v.type, flag: v.flag, officialNo: v.officialNo, powerKW: v.powerKW ?? v.propulsionKW }
          : { name: v.name, type: v.type, flag: v.flag, officialNo: v.officialNo, loaM: v.lengthM, maxPax: v.maxPax },
        rows,
        signatory: { name: signatoryName, position },
        company: { name: companyName },
      });
      downloadBytes(pdfBytes, `transport-malta-sst${engineForm ? '-engine' : ''}-${(v.name || 'vessel').replace(/\s+/g, '-')}.pdf`);
      flash('Transport Malta form ready');
    } catch (e) { console.error('[seatime] transport malta export', e); flash('Could not build the Transport Malta form'); }
  };

  // PYA & MCA (Discharge Book) routes have no official third-party form to fill —
  // Cargo generates its OWN Testimonial of Sea Service (MSN 1858) per command
  // spell, with the service table + totals filled and the signature/stamp/date
  // left blank for the endorsing officer. For the MCA direct route that IS the
  // signable testimonial that backs the Discharge Book; for PYA it's the
  // captain-attested record used to complete the PYA portal and as evidence.
  const onDownloadSpellRecord = async (spell) => {
    if (!canGenerate) { flash('Resolve the outstanding validation checks first'); return; }
    try {
      const v = vessels[spell.vesselId] || {};
      const periods = spell.entries
        .slice()
        .sort((a, b) => String(a.from).localeCompare(String(b.from)))
        .map(e => ({ from: e.from, to: e.to, days: e.days, type: e.type, capacity: e.capacity }));
      // The crew's OWN top-rank service can't be self-attested — leave the
      // endorser name blank so the company/owner completes it by hand.
      const isOwnTopRank = spell.captainId === userId;
      let signatoryName = '';
      if (!isOwnTopRank) {
        const endorser = await resolveEndorserFor(spell.captainId, spell.captainName);
        signatoryName = endorser?.name || spell.captainName || '';
      }
      flash(`Building ${vp.short} testimonial…`);
      const bytes = await buildSpellTestimonialPdf({
        seafarer: { fullName: seafarer.fullName, dob: seafarer.dob, nationality: seafarer.nationality, dischargeBookNo: seafarer.dischargeBookNo, cocHeld: seafarer.cocHeld },
        vessel: { name: v.name, flag: v.flag, imo: v.imo, gt: v.gt, lengthM: v.lengthM },
        periods,
        signatory: { name: signatoryName, rank: topRankWord, unsigned: true },
        verifier: vp,
      });
      downloadBytes(bytes, `${verifier === 'mca' ? 'mca-testimonial' : 'pya-record'}-${(v.name || 'vessel').replace(/\s+/g, '-')}.pdf`);
      flash(`${vp.short} testimonial ready`);
    } catch (e) { console.error('[seatime] testimonial export', e); flash('Could not build the testimonial'); }
  };

  // Copy ONE captain spell to the clipboard for the PYA autofill bookmarklet.
  // Same buckets/vessel/leave as the PDF above, mapped onto PYA's online SST
  // fields (see seatime/pya/pyaPayload). The bookmarklet types them into
  // member.pya.org; nothing is submitted.
  const onCopySpellForPya = async (spell) => {
    try {
      const v = vessels[spell.vesselId] || {};
      const mine = spell.entries;
      const b = computeBuckets(mine, vessels, { ...config, yardCapDays: yardCapForCertificate(targetId) });
      const froms = mine.map(e => e.from).filter(Boolean).sort();
      const tos = mine.map(e => e.to).filter(Boolean).sort();
      const from = froms[0] || null, to = tos[tos.length - 1] || null;
      const capCount = {};
      for (const e of mine) if (e.capacity) capCount[e.capacity] = (capCount[e.capacity] || 0) + (e.days || 0);
      const capacity = Object.keys(capCount).sort((a, b) => capCount[b] - capCount[a])[0] || '';
      const leaveDays = (from && to) ? ((await fetchLeaveDaysInRange(userId, from, to)) ?? null) : null;
      let signatoryEmail = '';
      if (spell.captainId && spell.captainId !== userId) {
        const endorser = await resolveEndorserFor(spell.captainId, spell.captainName);
        signatoryEmail = endorser?.email || '';
      }
      const sstType = (family === 'ENGINE' || family === 'ETO')
        ? 'Engineering Testimonial'
        : interiorPathway ? 'Chef / Cook, Interior Crew, Interior/Deck Dual Role' : 'Deck Testimonial';
      // Vessel cruising region → PYA "areas cruised" checkboxes; propulsion kW;
      // the canonical (unabbreviated) flag — entries carry a short form like
      // "Cayman Is." that won't match PYA's "Cayman Islands" picker list.
      let operatingRegions = '', propulsionKw = null, vesselFlagFull = '', engineType = '';
      try {
        const { data: vrow } = await supabase.from('vessels').select('operating_regions, area_of_operation, propulsion_kw, flag, main_engine_type').eq('tenant_id', tenantId).maybeSingle();
        operatingRegions = [vrow?.operating_regions, vrow?.area_of_operation].filter(Boolean).join(' ');
        propulsionKw = vrow?.propulsion_kw ?? null;
        vesselFlagFull = vrow?.flag || '';
        engineType = vrow?.main_engine_type || '';
      } catch { /* leave blank — areas/propulsion/flag/engine fall back */ }
      const payload = buildPyaPayload({
        dataset: {
          vessels: [{ name: v.name, flag: vesselFlagFull || v.flag, imo: v.imo, grossTonnage: v.gt, registeredLengthM: v.lengthM, vesselType: v.type, officialNumber: v.officialNo }],
          service: { capacity, periodFrom: from, periodTo: to, totals: { seagoing: b.seagoing, watchkeeping: b.watchkeeping, standby: b.standby, yard: b.yard } },
        },
        leaveDays,
        guestDays: (guestOnDays ?? derivedGuest?.days ?? null),
        signatoryEmail,
        sstType,
        operatingRegions,
        propulsionKw,
        engineType,
      });
      await navigator.clipboard.writeText(buildPyaClipboard(payload));
      flash('Copied — now click the “Fill PYA form” bookmark on the PYA page');
    } catch (e) { console.error('[seatime] pya copy', e); flash('Could not copy the PYA data'); }
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

  // Guest-on days (Yacht Purser evidence). A verified count, not a hard gate —
  // the IAMI route asks for it to be evidenced (captain/company or charter records).
  const saveGuestOnDays = async (val) => {
    const n = val === '' || val == null ? null : Math.max(0, Math.round(+val) || 0);
    setGuestOnDays(n);
    if (usingSample || !userId) { flash('Guest-on days saved (preview)'); return; }
    try {
      const { error } = await supabase.from('crew_personal_details').upsert({ user_id: userId, guest_on_days: n }, { onConflict: 'user_id' });
      if (error) throw error;
      flash('Guest-on days saved');
    } catch (e) { console.error('[seatime] save guest-on days', e); flash('Could not save guest-on days'); }
  };

  // Certification journey (NoE -> oral -> CoC). The modal is scoped to one
  // milestone (step) at a time, gated by progress.
  const openJourney = (step = 'noe') => { setJourneyStep(step); setCocListOpen(null); setJourneyDraft(JSON.parse(JSON.stringify(activeJourney))); setJourneyOpen(true); };
  const setJD = (path, val) => setJourneyDraft(d => {
    const n = JSON.parse(JSON.stringify(d || JOURNEY_DEFAULT));
    const keys = path.split('.');
    let o = n;
    for (let i = 0; i < keys.length - 1; i++) { o[keys[i]] = o[keys[i]] ? { ...o[keys[i]] } : {}; o = o[keys[i]]; }
    o[keys[keys.length - 1]] = val;
    return n;
  });
  // Attach the milestone's paper (NoE letter / oral pass / CoC) — uploaded to the
  // crew-documents bucket, its signed URL + path stored on the journey step.
  const [journeyUploading, setJourneyUploading] = useState(false);
  const onJourneyFile = async (stepKey, e) => {
    const f = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!f) return;
    if (usingSample || !userId) { setJD(`${stepKey}.file`, { fileName: f.name, fileUrl: null }); flash('Attached (preview)'); return; }
    try {
      setJourneyUploading(true);
      const up = await uploadDocumentFile(userId, f);
      setJD(`${stepKey}.file`, { fileUrl: up.file_url, fileName: up.file_name, storagePath: up.storage_path });
      flash('Document attached');
    } catch (err) { console.error('[seatime] journey file', err); flash('Could not upload the document'); }
    finally { setJourneyUploading(false); }
  };
  const journeyFileField = (stepKey, label) => {
    const f = journeyDraft?.[stepKey]?.file;
    return (
      <div className="cso-fld" style={{ marginTop: 12 }}>
        <label className="cso-lbl">{label} <span className="opt">optional</span></label>
        {f?.fileName ? (
          <div className="cso-file">
            <Icon name="FileText" size={14} color="#C65A1A" />
            <span className="nm">{f.fileName}</span>
            {f.fileUrl && <a href={f.fileUrl} target="_blank" rel="noreferrer">View</a>}
            <button type="button" onClick={() => setJD(`${stepKey}.file`, null)}>Remove</button>
          </div>
        ) : (
          <label className={`cso-upload${journeyUploading ? ' busy' : ''}`}>
            <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={e => onJourneyFile(stepKey, e)} />
            <Icon name="Upload" size={14} /> {journeyUploading ? 'Uploading…' : 'Upload a scan or photo'}
          </label>
        )}
      </div>
    );
  };
  // Oral re-sit: bank the failed attempt's date and reset for a fresh booking.
  const addOralResit = () => setJourneyDraft(d => {
    const n = JSON.parse(JSON.stringify(d || JOURNEY_DEFAULT));
    const o = n.oral || {};
    o.fails = [...(o.fails || []), o.bookedDate || o.passDate || ''].filter(Boolean);
    o.status = 'booked'; o.bookedDate = ''; o.passDate = '';
    n.oral = o; return n;
  });
  const saveJourney = async () => {
    // cert_progression is a per-certificate map; write this draft under the live
    // target so each rung keeps its own NoE/oral/CoC (and completed rungs persist
    // as held, advancing the target).
    const entry = journeyDraft || JOURNEY_DEFAULT;
    const nextMap = targetId ? { ...journeyMap, [targetId]: entry } : journeyMap;
    setJourneyOpen(false);
    if (usingSample || !userId) { setJourney(nextMap); flash('Journey saved (preview)'); return; }
    try {
      const { error } = await supabase.from('crew_personal_details').upsert({ user_id: userId, cert_progression: nextMap }, { onConflict: 'user_id' });
      if (error) throw error;
      setJourney(nextMap);
      flash('Certification journey saved');
    } catch (e) { console.error('[seatime] save journey', e); flash('Could not save the journey'); }
  };

  // Mark / reopen a year as "accounted for" (verified + submitted toward a CoC).
  const toggleAccounted = async (year) => {
    const next = { ...(accounted || {}) };
    const isOn = !!next[year];
    if (isOn) delete next[year];
    else next[year] = { at: new Date().toISOString().slice(0, 10), note: cert?.label ? `Counted toward ${cert.label}` : '' };
    setAccounted(next);
    if (usingSample || !userId) { flash(isOn ? 'Year reopened (preview)' : 'Year accounted for (preview)'); return; }
    try {
      const { error } = await supabase.from('crew_personal_details').upsert({ user_id: userId, accounted_years: next }, { onConflict: 'user_id' });
      if (error) throw error;
      flash(isOn ? `${year} reopened` : `${year} marked accounted for`);
    } catch (e) { console.error('[seatime] accounted', e); flash('Could not update'); setAccounted(accounted); }
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
  const heldCount = Object.keys(effectiveHeld).filter(id => CERTIFICATES[id]).length;
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
      {dualMode && (
        <div className="stp-dualnote">Dual capacity: each day counts at <b>50%</b> toward this pathway — the same service also accrues at 50% toward the {family === 'DECK' ? 'engine' : 'deck'} ladder (MSN 1858 §5.1).</div>
      )}

      {untaggedCocs > 0 && (
        <div className="stp-untagged">
          <IcoPath d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" color="#A6712C" size={18} />
          <div>{untaggedCocs} Certificate{untaggedCocs === 1 ? '' : 's'} of Competency {untaggedCocs === 1 ? 'is' : 'are'} uploaded without a grade set, so {untaggedCocs === 1 ? "it can't" : "they can't"} be matched to your pathway. Open <b>Documents</b> and set the certificate’s grade/level so it counts.</div>
        </div>
      )}

      {route.length > 0 ? (
        <>
        <div className="stp-spine">
          {rungs.map((r) => {
            const isHeld = !!effectiveHeld[r.id];
            const idx = route.indexOf(r.id);
            // 'complete' = below the highest held cert, so implied satisfied even
            // if the crew member never logged that intermediate certificate.
            const status = isHeld ? 'held' : (idx > -1 && idx < highestHeldIdx ? 'complete' : r.id === targetId ? 'target' : 'upcoming');
            const isGoal = r.id === goalId;
            if (status !== 'target') {
              const onClick = (isHeld || status === 'complete') ? () => setHeldOpen(true) : () => setGoalId(r.id);
              return (
                <button className={`stp-step ${status}${isGoal ? ' goal' : ''}`} key={r.id} type="button" onClick={onClick}>
                  <span className="stp-m" />
                  <span className="stp-row">
                    <span className="nm">{r.label} <span className="ref">{shortMsn(r.msn)}</span>{r.legacyAlias && <span className="stp-alias">{r.legacyAlias}</span>}{isGoal && <span className="goaltag">Goal</span>}</span>
                    <span className={`st ${status}`}>{isHeld ? <>Held{effectiveHeld[r.id].issueDate ? <> · <span className="dt">{fmtDate(effectiveHeld[r.id].issueDate)}</span></> : ''}</> : status === 'complete' ? 'Covered' : 'Upcoming'}</span>
                  </span>
                </button>
              );
            }
            return (
              <div className={`stp-step target${isGoal ? ' goal' : ''}`} key={r.id}>
                <span className="stp-m" />
                <div className="stp-feat">
                  <div className="stp-feathead">
                    <div className="stp-titlewrap" ref={cfgRef}>
                      <div className="stp-eyebrow">Now working toward · {r.msn}{isGoal ? ' · your goal' : ''}</div>
                      <button type="button" className={`stp-titlebtn${pathwayCfgOpen ? ' open' : ''}`} onClick={() => setPathwayCfgOpen(o => !o)} aria-haspopup="dialog" aria-expanded={pathwayCfgOpen} title="Change department or goal">
                        <h4 className="stp-title">{r.label}{r.legacyAlias && <span className="stp-alias">{r.legacyAlias}</span>}</h4>
                        <svg className="stp-titlechev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                      </button>
                      {certConfidence(r).authoritative === false && (
                        <div className="stp-provisional">{certConfidence(r).label} — these figures aren’t yet confirmed against {r.msn}. Treat as a guide and verify with your training provider before applying.</div>
                      )}
                      {pathwayCfgOpen && (
                        <div className="stp-cfg" role="dialog" aria-label="Change pathway">
                          <div className="stp-cfg-sec">
                            <div className="stp-cfg-lbl">Department</div>
                            <StpSelect variant="plain" value={deptId} options={deptOpts} onChange={changeDept} />
                          </div>
                          <div className="stp-cfg-sec">
                            <div className="stp-cfg-lbl">Goal</div>
                            <div className="stp-cfg-list">
                              {goalOpts.map(o => (
                                <button key={o.value} type="button" role="option" aria-selected={o.value === goalId}
                                  className={`stp-cfg-opt${o.value === goalId ? ' on' : ''}`} onClick={() => setGoalId(o.value)}>
                                  <span className="ck"><Icon name="Check" size={13} /></span>
                                  <span className="txt"><span className="t">{o.label}</span>{o.sub && <span className="s">{o.sub}</span>}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                          {(family === 'DECK' || family === 'ENGINE') && (
                            <label className="stp-cfg-dual" title="On smaller yachts one person may serve as both deck and engineer. The MCA counts dual deck+engine service at 50% toward each Certificate of Competency (MSN 1858 §5.1).">
                              <input type="checkbox" checked={dualMode} onChange={(e) => setDualMode(e.target.checked)} />
                              <span>Dual deck + engine role <em>— counts at 50% toward each CoC</em></span>
                            </label>
                          )}
                          <button type="button" className="stp-cfg-stop" onClick={stopPathway}>Just track my days — no certificate</button>
                        </div>
                      )}
                    </div>
                    <div className="stp-fig"><span className="big">{daysToGo}</span><span className="cap">{daysToGo === 1 ? 'day to go' : 'days to go'}</span></div>
                  </div>
                  {crossDiscipline && (
                    <div className="stp-accrual">
                      <b>{buckets.total} of {totalLoggedDays} logged days</b> count toward this certificate. Days served in a {family === 'ENGINE' ? 'engine-room' : family === 'ETO' ? 'electro-technical' : 'deck'} capacity accrue; other service is logged for your CV, visa and tax but doesn’t count toward this CoC.
                    </div>
                  )}
                  {requirements.length > 0 ? (
                    <div className="stp-reqs" data-cols={Math.min(requirements.length, 4)}>
                      {requirements.map(rq => (
                        <div className={`stp-req ${rq.met ? 'done' : ''}${rq.advisory ? ' advisory' : ''}`} key={rq.key}>
                          <div className="l">{rq.label}{rq.advisory && <span className="stp-advtag">advisory</span>}</div>
                          <div className="stp-reqtop">
                            <span className="v">{rq.required ? <>{rq.current}<em>/{rq.required}</em></> : '—'}</span>
                            {rq.required ? (rq.met
                              ? <span className="stp-reqpill met">Met</span>
                              : <span className="stp-reqpill togo">{rq.remaining} to go</span>) : null}
                          </div>
                          <div className="stp-track"><i style={{ width: `${rq.pct}%` }} /></div>
                          {rq.orBranch && rq.detail && (
                            <div className="stp-orhint">
                              by length {rq.detail.metres24}/{rq.detail.metresTarget} · by tonnage {rq.detail.gt500}/{rq.detail.gtTarget}
                              {rq.detail.sizeUnknownDays > 0 ? ` · ${rq.detail.sizeUnknownDays} day${rq.detail.sizeUnknownDays === 1 ? '' : 's'} without vessel size not counted` : ''}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="stp-sub" style={{ marginTop: 12 }}>No additional qualifying service required — may be applied for alongside the certificate above.</div>
                  )}
                  {cert?.family === 'INTERIOR' && (() => {
                    const derived = derivedGuest?.days ?? 0;
                    const derivedTrips = derivedGuest?.trips ?? 0;
                    const overridden = guestOnDays != null && guestOnDays !== derived;
                    const shown = guestOnDays != null ? guestOnDays : derived;
                    const target = cert?.requires?.guestOnDays || 0;
                    return (
                      <div className="stp-guest">
                        <div className="stp-guest-main">
                          <span className="mlabel rustlabel">Guest-on days{target ? <> · {shown}/{target}</> : null}</span>
                          <span className="stp-guest-sub">
                            {target
                              ? <><b>Route A</b> pairs your 12 months’ senior service with at least <b>{target} guest-on days</b> (charters, shows, owner trips). Or take <b>Route B</b> — 3 years in a maritime management/administration role, logged as prior service.{' '}</>
                              : <>Days with guests aboard (charters, shows, owner trips).{' '}</>}
                            {derivedTrips > 0
                              ? <>Auto-counted from <b>{derivedTrips} trip{derivedTrips === 1 ? '' : 's'}</b> carrying guests on your record{overridden ? <> — overridden (auto-count {derived})</> : ' — edit to override'}.</>
                              : <>No guest-carrying trips on record yet — enter a verified total (captain/company or charter records).</>}
                            {overridden && <> <button type="button" className="stp-guest-reset" onClick={() => saveGuestOnDays('')}>Use auto-count</button></>}
                          </span>
                        </div>
                        <div className="stp-guest-field">
                          <input type="number" min="0" className="stp-guest-input" key={`${guestOnDays ?? 'a'}-${derived}`} defaultValue={shown || ''} placeholder="0"
                            onBlur={(e) => { const v = e.target.value; const n = v === '' ? 0 : Math.max(0, Math.round(+v) || 0); if (n === derived) { if (guestOnDays != null) saveGuestOnDays(''); } else if (n !== guestOnDays) saveGuestOnDays(String(n)); }} />
                          <span className="stp-guest-unit">days</span>
                        </div>
                      </div>
                    );
                  })()}
                  {r.asOfficer && (
                    <div className="stp-whilst">
                      <Icon name="Info" size={13} />
                      <div>{whileHoldingISO
                        ? <>Counts <b>deck/engineer-officer service from {fmtDate(whileHoldingISO)}</b> — when you held {CERTIFICATES[r.heldWhilstCert]?.short || r.heldWhilst}. Earlier and rating service counted toward that certificate, not this one (MSN 1858 / MSN 1904).</>
                        : <>Only <b>officer service whilst holding {CERTIFICATES[r.heldWhilstCert]?.short || r.heldWhilst}</b> counts toward this CoC. Set that certificate’s issue date under <b>Certificates held</b> so only qualifying service is counted — for now it’s gated by capacity only.</>}</div>
                    </div>
                  )}
                  {r.note && <div className="stp-cnote">{r.note}</div>}
                </div>
              </div>
            );
          })}
        </div>
        {routeComplete && (
          <div className="stp-achieved">
            <IcoPath d="M20 6L9 17l-5-5" color="#5E8E6F" size={22} />
            <div>
              <div className="nt">You hold {CERTIFICATES[goalId]?.label || 'your goal'} — the top of this pathway.</div>
              <div className="ns">Every rung below counts as covered, so there’s nothing left to work toward here. Pick a higher goal to keep progressing, or switch to “just track my days”.</div>
            </div>
          </div>
        )}
        </>
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

      {cert && ancillary.length > 0 && (
        <div className="stp-courses">
          <button type="button" className="stp-courses-head" aria-expanded={coursesOpen} onClick={() => setCoursesOpen(o => !o)}>
            <span className="mlabel rustlabel">Courses &amp; tickets</span>
            <span className="stp-courses-right">
              <span className="stp-courses-count" style={{ color: ancillaryDone === ancillary.length ? '#5E8E6F' : '#C65A1A' }}>{ancillaryDone} of {ancillary.length} on file</span>
              <Icon name="ChevronDown" size={16} className="stp-courses-chev" style={{ transform: coursesOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
            </span>
          </button>
          {coursesOpen && (
            <>
              <div className="stp-courses-sub">Required for {cert.short} alongside your sea time — auto-detected from your Documents.{interiorPathway ? ' The PYA / IAMI need these for the Purser CoC.' : ' The MCA won’t issue the CoC without these.'}</div>
              <div className="stp-courses-list">
                {ancillary.map(a => {
                  const addType = a.anyOf?.[0];
                  const canAdd = !a.met && addType && onAddDocument;
                  return (
                    <div className={`stp-course ${a.met ? 'has' : 'missing'}${canAdd ? ' add' : ''}`} key={a.key}
                      role={canAdd ? 'button' : undefined} tabIndex={canAdd ? 0 : undefined}
                      onClick={canAdd ? () => onAddDocument(addType) : undefined}
                      onKeyDown={canAdd ? (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onAddDocument(addType); } } : undefined}>
                      <span className="ck">{a.met ? <Icon name="Check" size={13} color="#3F7A52" /> : <span className="dot" />}</span>
                      <div className="cl">
                        <div className="nm">{a.label}</div>
                        {a.note && <div className="nt">{a.note}</div>}
                      </div>
                      {!a.met && <span className="st">{canAdd ? <><Icon name="Plus" size={11} /> Add to Documents</> : 'Not on file'}</span>}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Only surface the nudge when there's something to act on — the
          "all good / private to you" filler banner was noise otherwise. */}
      {cert && hasAttention && (
        <div className="std-nudge" style={{ marginTop: 18 }}>
          <IcoPath d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2ZM9 21h6M10 17v4m4-4v4" color="#C65A1A" size={20} />
          <div>
            <div className="nt">{badCount} logged {badCount === 1 ? 'entry needs' : 'entries need'} attention.</div>
            <div className="ns">Non-qualifying service is excluded from your totals — review and re-tag to keep your pack clean.</div>
          </div>
          <button className="std-reviewbtn" onClick={() => ledgerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Review</button>
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
              const h = effectiveHeld[c.id];
              return (
                <div className={`stp-drc ${h ? 'held' : ''}`} key={c.id}>
                  <div className="row">
                    <span className="mk">{h ? <Icon name="Check" size={13} color="#3F7A52" /> : <span className="dot" />}</span>
                    <div className="nm">{c.label} <span className="ref">{shortMsn(c.msn)}</span>{c.legacyAlias && <span className="stp-alias">{c.legacyAlias}</span>}</div>
                  </div>
                  {h ? (
                    <>
                    <div className="meta">
                      Held{h.issueDate ? ` · issued ${fmtDate(h.issueDate)}` : ''}{h.number ? ` · ${h.number}` : ''}
                      {h.fileUrl ? <> · <a href={h.fileUrl} target="_blank" rel="noreferrer">View document</a></> : ''}
                    </div>
                    {h.legacy && (
                      <div className="stp-convert">
                        <b>This is a legacy {h.legacy.key} certificate.</b> Since 2023 the yacht-engineer scheme moved to Small Vessel CoCs — under the current system your {h.legacy.key} converts to {h.legacy.to.map(id => CERTIFICATES[id]?.short).filter(Boolean).join(' / ')} (MCA conversion {h.legacy.code}, MIN 642). Typical top-up: {h.legacy.topUp} Every conversion also needs {CONVERSION_RECENCY.months} months’ seagoing in the last {CONVERSION_RECENCY.windowYears} years ({CONVERSION_RECENCY.msn}).{h.legacy.seagoingCapacity ? ` ${h.legacy.seagoingCapacity}` : ''}{h.legacy.note ? ` ${h.legacy.note}` : ''} The MCA assess your outlined seagoing service — confirm the exact requirement with them or your training provider, then upload your converted CoC here.
                      </div>
                    )}
                    </>
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
        {/* One bar carries the total, the type breakdown and the filter — tap a
            band to filter the log below (Concept B: one object, not five). */}
        <div className="std-compwrap">
          <div className="std-comphd">
            <span className="big">{buckets.total}<em>{buckets.total === 1 ? 'day' : 'days'}{offCargoDays > 0 ? ` · ${offCargoDays} off-Cargo` : ''}</em></span>
            {serviceFilter === 'all'
              ? <span className="hint">tap a band to filter</span>
              : <button type="button" className="std-comp-clear" onClick={() => setServiceFilter('all')}>Showing {TYPE_META[serviceFilter].label} · clear ×</button>}
          </div>
          <div className="std-comp" role="group" aria-label="Service by type — tap to filter">
            {[['seagoing', 'Seagoing'], ['watchkeeping', 'Watchkeeping'], ['standby', 'Standby'], ['yard', 'Shipyard']].map(([k, label]) => {
              const tm = TYPE_META[k], val = buckets[k];
              if (!val) return null;
              const on = serviceFilter === k, dim = serviceFilter !== 'all' && !on;
              const small = val / (buckets.total || 1) < 0.1;
              return (
                <button key={k} type="button" aria-pressed={on} title={`${label} · ${val} days`}
                  className={`std-comp-s${on ? ' on' : ''}${dim ? ' dim' : ''}${small ? ' sm' : ''}`}
                  style={{ flexGrow: val, background: tm.color }}
                  onClick={() => setServiceFilter(on ? 'all' : k)}>
                  <span className="sl">{label}</span>
                  <span className="sn">{val}</span>
                </button>
              );
            })}
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
              <div className="std-flex std-ac" style={{ gap: 10 }}>
                {activeYear && (accountedSet.has(activeYear)
                  ? <button type="button" onClick={() => toggleAccounted(activeYear)} className="std-vs" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C65A1A', fontWeight: 600 }}>Reopen</button>
                  : <button type="button" onClick={() => toggleAccounted(activeYear)} className="std-dl" style={{ background: '#fff', color: '#1C1B3A', border: '1px solid #E6E8EC', padding: '4px 10px' }}><Icon name="CheckCheck" size={13} /> Mark accounted for</button>)}
              </div>
            </div>
          )}
          {activeYear && accountedSet.has(activeYear) && (
            <div className="std-flex std-between std-ac" style={{ padding: '12px 14px', border: '1px solid #CDE6D3', background: '#EFF6F1', borderRadius: 10, marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#3F7A52' }}>{activeYear} · accounted for</div>
                <div className="std-vs">{yearDays} {yearDays === 1 ? 'day' : 'days'} · verified &amp; submitted{accounted[activeYear]?.note ? ` — ${accounted[activeYear].note}` : ''}. Excluded from your active pathway.</div>
              </div>
              <Icon name="ShieldCheck" size={20} color="#3F7A52" />
            </div>
          )}
          {!(activeYear && accountedSet.has(activeYear)) && shown.length === 0 && (
            syncInfo && syncInfo.has_start_date === false
              ? <div className="std-foot">Your sea service will populate automatically once your <b>join date is confirmed by command</b> — it’s taken from your employment record, not entered by hand. You can still log a period manually with “Log sea time”.</div>
              : <div className="std-foot">No sea service logged yet — it auto-logs from your current vessel, or use “Log sea time”.</div>
          )}
          {(() => {
            if (activeYear && accountedSet.has(activeYear)) return null; // collapsed summary shown above
            const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
            // Group chronologically into months; each month is a collapsible
            // section. A vessel band is emitted once per vessel run within a
            // month, so its flag/GT/IMO shows once per spell, not on every row.
            const groups = [];
            let cur = null, lastVessel = null;
            shown.forEach(e => {
              const d = e.from ? new Date(e.from + 'T00:00:00') : null;
              const monthKey = d ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : 'Earlier service';
              if (!cur || cur.key !== monthKey) { cur = { key: monthKey, days: 0, count: 0, nodes: [] }; groups.push(cur); lastVessel = null; }
              cur.count += 1; if (!e.excluded) cur.days += (e.days || 0);
              const v = vessels[e.vesselId] || {}, tm = TYPE_META[e.type], c = classify(e, v, config), sm = SOURCE_META[e.source] || SOURCE_META.manual;
              const isCargo = cargoVesselIds.has(e.vesselId);
              if (e.vesselId !== lastVessel) {
                const vm = [v.flag, v.gt != null ? `${v.gt} GT` : null, v.lengthM != null ? `${v.lengthM} m` : null, v.imo ? `IMO ${v.imo}` : null].filter(Boolean).join(' · ');
                cur.nodes.push(
                  <div className="std-vband" key={'v' + e.id}>
                    <span className="std-vband-dot" style={{ background: tm.color }} />
                    <div className="std-vband-id"><span className="vn">{v.name || 'Vessel'}</span>{vm && <span className="vm">{vm}</span>}</div>
                    <span className={`std-prov${isCargo ? ' cargo' : ''}`} style={{ marginLeft: 'auto', color: isCargo ? '#3F7A52' : '#5A6478', background: isCargo ? '#EFF6F1' : '#F4F5F7' }}
                      title={isCargo ? 'Cargo-tracked — auto-logged on a Cargo vessel; verifiable and exportable' : 'Off-Cargo, self-recorded — counts toward your pathway, but supply your own testimonial as evidence'}>
                      <span className="pm" style={isCargo ? { background: '#3F7A52' } : { borderColor: '#5A6478' }} />{isCargo ? 'Cargo-tracked' : 'Off-Cargo'}
                    </span>
                  </div>
                );
                lastVessel = e.vesselId;
              }
              const isExcluded = !!e.excluded, isQual = !isExcluded && c.qual, isBad = !isExcluded && !c.qual;
              const detail = e.type === 'watchkeeping' ? `${e.watchHours}h watch` : (e.detailOverride || tm.hint);
              const rowAction = !isExcluded && e.testimonialPath ? () => viewTestimonial(e.testimonialPath) : null;
              cur.nodes.push(
                <div className="std-leg" key={e.id}
                  role={rowAction ? 'button' : undefined} tabIndex={rowAction ? 0 : undefined}
                  onClick={rowAction || undefined}
                  onKeyDown={rowAction ? (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); rowAction(); } } : undefined}
                  style={{ opacity: isExcluded ? 0.55 : 1, cursor: rowAction ? 'pointer' : undefined }}>
                  <span className="std-leg-rail" style={{ background: isExcluded ? '#CBC8C0' : tm.color }} />
                  <div className="std-leg-dt"><b>{e.dateMain}</b><span>{e.days} {e.days === 1 ? 'day' : 'days'}</span></div>
                  <div className="std-leg-mid">
                    <div className="role">{e.capacity}</div>
                    <div className="sub">{detail} · {sm.label.toLowerCase()}</div>
                  </div>
                  <div className="std-leg-right">
                    {!isExcluded && e.testimonialPath && <span className="std-leg-tlink"><Icon name="FileText" size={13} /> Testimonial</span>}
                    {isExcluded && <span className="std-leg-stat">Excluded</span>}
                    {isQual && <span className="std-leg-pill" style={{ background: tm.bg, color: tm.color }}>{tm.label}</span>}
                    {isBad && (
                      <div className="std-leg-bad">
                        <span className="std-leg-pill bad">Non-qualifying</span>
                        <div className="rsn">{c.reason}</div>
                        <button className="std-fix" onClick={(ev) => { ev.stopPropagation(); e.type === 'watchkeeping' ? reclassify(e.id) : excludeEntry(e.id); }}>
                          {e.type === 'watchkeeping' ? 'Reclassify to standby' : 'Exclude from pack'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            });
            // Default: only the most recent month open (so the page isn't a long
            // scroll); once the crew toggles anything, respect their choice.
            const latestKey = groups.length ? groups[groups.length - 1].key : null;
            const effectiveOpen = openMonths ?? (latestKey ? new Set([latestKey]) : new Set());
            const toggleMonth = (key) => setOpenMonths(prev => {
              const base = prev ?? (latestKey ? new Set([latestKey]) : new Set());
              const n = new Set(base);
              n.has(key) ? n.delete(key) : n.add(key);
              return n;
            });
            return groups.map(g => {
              const open = effectiveOpen.has(g.key);
              return (
                <div className="std-agroup" key={'g' + g.key}>
                  <button type="button" className={`std-amonth${open ? ' open' : ''}`} onClick={() => toggleMonth(g.key)} aria-expanded={open}>
                    <span className="std-amonth-lbl">{g.key}</span>
                    <span className="std-amonth-meta"><Icon name="ChevronDown" size={14} className="std-amonth-chev" /></span>
                  </button>
                  {open && g.nodes}
                </div>
              );
            });
          })()}
        </div>
        {(prior.onboard > 0 || syncInfo?.excluded_leave_days > 0) && (
          <div className="std-lnotes">
            {prior.onboard > 0 && (
              <div className="std-lnote">
                <span className="k">Prior service</span>
                <span className="v"><b>{prior.onboard} {prior.onboard === 1 ? 'day' : 'days'}</b> logged before Cargo, counting toward your pathway <button type="button" onClick={openPrior}>Edit</button></span>
              </div>
            )}
            {syncInfo?.excluded_leave_days > 0 && (
              <div className="std-lnote">
                <span className="k">Leave</span>
                <span className="v"><b>{syncInfo.excluded_leave_days} {syncInfo.excluded_leave_days === 1 ? 'day' : 'days'}</b> excluded — reported on your testimonial, not counted toward your CoC</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="std">
      <div className="cp-tab-head">
        <div className="cp-section-head"><span className="cp-section-num">10 /</span><h3>Sea Time Tracker</h3></div>
        <div className="cp-tab-actions std-controls">
          <button className="std-logbtn" style={{ background: '#fff', color: '#1C1B3A', border: '1px solid #E6E8EC' }} onClick={openPrior}><Icon name="History" size={16} /> Prior service</button>
          <button className="std-logbtn" onClick={() => setDrawerOpen(true)}><Icon name="Plus" size={16} /> Log sea time</button>
        </div>
      </div>

      {/* Clickable section sub-header — the cert action moved off the toolbar:
          work toward a certificate (or jump to held certificates). */}
      <button type="button" className="cp-group-head std-pathhead" onClick={cert ? () => setHeldOpen(true) : startPathway}>
        <span className="dia">◆</span>
        <span className="t">{cert ? `Certificates held${heldCount ? ` (${heldCount})` : ''}` : 'Work toward a certificate'}</span>
        <Icon name="ChevronRight" size={14} className="std-pathhead-chev" />
        <span className="line" />
      </button>

      {/* ── pathway spine / logging-only record ── */}
      {PathwaySection()}

      {/* ── certification journey: NoE → oral exam → CoC (only while a target CoC
            is in play — hidden once the goal is held / logging-only) ── */}
      {cert && (() => {
        const j = activeJourney;
        const conf = certConfidence(cert);
        // Hard requirements only (advisory bars like recency guide but don't gate).
        // An un-verified route never declares "requirements met" off a figure we
        // haven't confirmed against the notice.
        const hardReqs = requirements.filter(r => !r.advisory);
        const eligible = conf.authoritative && hardReqs.length > 0 && hardReqs.every(r => r.met);
        const noeExpiry = addYearsIso(j.noe?.issueDate, 5);
        const oralExpiry = addYearsIso(j.oral?.passDate, 3);
        const noeDte = daysUntil(noeExpiry), oralDte = daysUntil(oralExpiry);
        // The specific outstanding requirements — so Eligibility says WHAT's left,
        // not just a count. Binding (biggest gap) first.
        const unmet = conf.authoritative
          ? hardReqs.filter(r => !r.met).slice().sort((a, b) => b.remaining - a.remaining)
          : [];
        const noeIssued = j.noe?.status === 'issued';
        const oralPassed = j.oral?.status === 'passed';
        const cocIssued = j.coc?.status === 'issued' || !!j.coc?.issuedDate;
        // Chief Mate (Yachts) is an ENDORSEMENT of the OOW II/1 CoC — gained by the
        // management-level courses, with no oral exam (gov.uk lists no Chief Mate
        // yacht oral). Those rungs get a Courses step in place of NoE → Oral.
        const hasOral = cert.oral !== false;
        const coursesTotal = ancillary.length;
        const coursesComplete = coursesTotal === 0 ? true : ancillaryDone === coursesTotal;
        const cocApplied = j.coc?.status === 'applied' || cocIssued;
        const eligStep = {
          n: '01', label: 'Eligibility', key: 'elig', reachable: true,
          state: eligible ? 'done' : 'active',
          line: !conf.authoritative ? 'Confirm figures' : eligible ? 'Requirements met' : `${unmet.length} to go`,
        };
        let steps;
        if (hasOral) {
          const noeStarted = noeIssued || j.noe?.status === 'applied';
          const eligPrompt = eligible && !noeStarted;
          eligStep.pulse = eligPrompt;
          eligStep.detail = !conf.authoritative
            ? <div className="cj-detail">{conf.notice || 'see notice'}</div>
            : eligPrompt
              ? <div className="cj-detail cj-detail-cta">Apply for your NoE now →</div>
              : eligible
                ? <div className="cj-detail">All requirements met</div>
                : (unmet[0] ? <div className="cj-detail">{unmet[0].label} · {unmet[0].remaining} to go</div> : null);
          steps = [
            eligStep,
            {
              n: '02', label: 'Notice of Eligibility', key: 'noe', reachable: eligible,
              state: noeIssued ? 'done' : j.noe?.status === 'applied' ? 'active' : eligible ? 'todo' : 'locked',
              line: noeIssued ? `Issued ${fmtDate(j.noe.issueDate)}` : j.noe?.status === 'applied' ? 'Awaiting NoE' : eligible ? 'Ready to apply' : 'Locked',
              detail: noeIssued && noeDte != null
                ? <div className="cj-detail">{noeDte < 0 ? 'Expired — reapply' : `Valid to ${fmtDate(noeExpiry)}${noeDte < 180 ? ` · ${noeDte}d left` : ''}`}{j.noe?.ref ? ` · ${j.noe.ref}` : ''}</div> : null,
            },
            {
              n: '03', label: 'Oral exam', key: 'oral', reachable: noeIssued,
              state: oralPassed ? 'done' : (j.oral?.status === 'booked' || j.oral?.status === 'failed') ? 'active' : noeIssued ? 'todo' : 'locked',
              line: oralPassed ? `Passed ${fmtDate(j.oral.passDate)}` : j.oral?.status === 'booked' ? `Booked ${fmtDate(j.oral.bookedDate) || ''}`.trim() : j.oral?.status === 'failed' ? 'Failed — book re-sit' : noeIssued ? 'Not booked' : 'Locked',
              detail: oralPassed && !cocIssued && oralDte != null
                ? <div className="cj-detail">{oralDte < 0 ? 'Pass expired — re-sit' : `Pass valid to ${fmtDate(oralExpiry)}${oralDte < 180 ? ` · ${oralDte}d left` : ''}`}</div>
                : (j.oral?.fails?.length ? <div className="cj-detail">Attempt {j.oral.fails.length + 1}</div> : null),
            },
            {
              n: '04', label: 'Certificate of Competency', key: 'coc', reachable: oralPassed,
              state: cocIssued ? 'done' : j.coc?.status === 'applied' ? 'active' : oralPassed ? 'todo' : 'locked',
              line: cocIssued ? `Issued ${fmtDate(j.coc.issuedDate)}` : j.coc?.status === 'applied' ? 'Applied — awaiting' : oralPassed ? 'Ready to apply' : 'Locked',
              detail: cocIssued && j.coc?.ref ? <div className="cj-detail">{j.coc.ref}</div> : null,
            },
          ];
        } else {
          // Endorsement route: Eligibility → Courses → Certificate (no NoE/oral).
          const endorsePrompt = eligible && !cocApplied;
          eligStep.pulse = endorsePrompt;
          eligStep.detail = !conf.authoritative
            ? <div className="cj-detail">{conf.notice || 'see notice'}</div>
            : endorsePrompt
              ? <div className="cj-detail cj-detail-cta">{coursesComplete ? 'Apply to add the endorsement →' : 'Add your management courses →'}</div>
              : eligible
                ? <div className="cj-detail">No oral — endorsed by courses</div>
                : (unmet[0] ? <div className="cj-detail">{unmet[0].label} · {unmet[0].remaining} to go</div> : null);
          steps = [
            eligStep,
            {
              n: '02', label: 'Courses', key: 'courses', reachable: eligible,
              state: !eligible ? 'locked' : coursesComplete ? 'done' : ancillaryDone > 0 ? 'active' : 'todo',
              line: !eligible ? 'Locked' : coursesComplete ? (coursesTotal ? 'All courses on file' : 'No extra courses') : `${ancillaryDone} of ${coursesTotal} on file`,
              detail: eligible && coursesTotal > 0 && !coursesComplete ? <div className="cj-detail">Management-level courses for {cert.short}</div> : null,
            },
            {
              n: '03', label: 'Certificate of Competency', key: 'coc', reachable: coursesComplete,
              state: cocIssued ? 'done' : j.coc?.status === 'applied' ? 'active' : coursesComplete ? 'todo' : 'locked',
              line: cocIssued ? `Endorsed ${fmtDate(j.coc.issuedDate)}` : j.coc?.status === 'applied' ? 'Applied — awaiting' : coursesComplete ? 'Ready to endorse' : 'Locked',
              detail: cocIssued && j.coc?.ref ? <div className="cj-detail">{j.coc.ref}</div> : null,
            },
          ];
        }
        // Every step is openable so the crew can see each stage; the lock styling
        // still signals where they actually are in the real-world process.
        const clickStep = (s) => {
          if (s.key === 'elig') { setEligOpen(o => !o); return; }
          if (s.key === 'courses') { setCoursesOpen(true); journeyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
          openJourney(s.key);
        };
        const doneCount = steps.filter(s => s.state === 'done').length;
        return (
          <div className="cj" id="cert-journey" ref={journeyRef} style={{ marginTop: 18 }}>
            <div className="cj-head">
              <div>
                <h3 className="cj-title">Certification journey</h3>
                <div className="cj-ctx">Working toward {cert.short}{MSF_FORMS[deptId] ? ` · Apply with ${MSF_FORMS[deptId].form} (${MSF_FORMS[deptId].notice})` : ''}</div>
              </div>
              <div className="cj-progress"><b>{doneCount}</b> of {steps.length} complete</div>
            </div>
            {/* full-width rail: nodes spaced edge-to-edge with connecting lines */}
            <div className="cj-rail">
              {steps.map((s, i) => (
                <React.Fragment key={s.n}>
                  <button type="button" className={`cj-node ${s.state}${s.pulse ? ' pulse' : ''}`} onClick={() => clickStep(s)}
                    title={s.key === 'elig' ? 'Show requirements' : `Update ${s.label}`}>
                    {s.state === 'done' ? <Icon name="Check" size={14} color="#fff" /> : s.state === 'locked' ? <Icon name="Lock" size={11} /> : s.n}
                  </button>
                  {i < steps.length - 1 && <span className={`cj-line${s.state === 'done' ? ' done' : ''}`} />}
                </React.Fragment>
              ))}
            </div>
            {/* labels sit under their nodes: first left, last right, middle centred */}
            <div className="cj-labels">
              {steps.map((s, i) => (
                <div className={`cj-stepcell pos-${i === 0 ? 'first' : i === steps.length - 1 ? 'last' : 'mid'}${s.key === 'elig' && eligOpen ? ' open' : ''}`} key={s.n}>
                  <button type="button" className={`cj-step ${s.state}`} onClick={() => clickStep(s)}
                    title={s.key === 'elig' ? 'Show requirements' : `Update ${s.label}`}>
                    <div className="cj-steplabel">{s.label}{s.key === 'elig' && <Icon name="ChevronDown" size={12} className="cj-eligchev" style={{ transform: eligOpen ? 'rotate(180deg)' : 'none' }} />}{j[s.key]?.file?.fileName && <Icon name="Paperclip" size={11} className="cj-clip" />}</div>
                    <div className="cj-statusline">{s.line}</div>
                    {s.detail}
                  </button>
                  {s.key === 'elig' && eligOpen && (
                    <div className="cj-elig-pop" role="dialog" aria-label="Service requirements">
                      <button className="cj-elig-x" onClick={() => setEligOpen(false)} aria-label="Close"><Icon name="X" size={13} /></button>
                      <div className="cj-elig-h">Service requirements</div>
                      {hardReqs.map(r => (
                        <div className={`cj-elig-row ${r.met ? 'met' : ''}`} key={r.key}>
                          <span className="ck">{r.met ? <Icon name="Check" size={11} color="#3F7A52" /> : <span className="dot" />}</span>
                          <span className="l">{r.label}</span>
                          <span className="v">{r.current}/{r.required}{!r.met && <em> · {r.remaining}</em>}</span>
                        </div>
                      ))}
                      {!conf.authoritative && <div className="cj-detail" style={{ marginTop: 6 }}>{conf.label}</div>}
                      <div className="cj-elig-foot">{eligible ? 'All met — apply for your NoE.' : 'Clear the outstanding service first.'}</div>
                    </div>
                  )}
                </div>
              ))}
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
              <h3>{interiorPathway ? 'Get your service signed off' : SHOW_SIGNOFF ? 'Sea Service Testimonial Pack' : 'Get your sea time signed off'}</h3>
              <div className="sub">{interiorPathway
                ? 'Cargo compiles your senior yacht service and readies it for the PYA to verify for your IAMI GUEST Yacht Purser CoC — submitted alongside your guest-on days and GUEST course certificates.'
                : SHOW_SIGNOFF
                  ? `Your sea service, confirmed by each ship’s ${signerWord} — use it to complete your verifying organisation’s submission, or attach it as supporting evidence.`
                  : <>Cargo pre-fills the forms — your {signerWord} reviews and signs.
                      <span className="std-fhelp" tabIndex={0} role="note" aria-label="How sign-off works">
                        <Icon name="Info" size={14} />
                        <span className="std-fhelp-pop">
                          <b>How this works</b>
                          <span>Cargo compiles your sea time and pre-fills your verifying organisation’s forms, so your {signerWord} just reviews and signs.</span>
                          <span>We only speed up the paperwork — the organisation verifies and holds the record.</span>
                        </span>
                      </span>
                    </>}</div>
            </div>
            <div>
              <div className="mlabel" style={{ marginBottom: 6 }}>Verifying organisation</div>
              <div className="std-vtabs">
                {verifierIds.map(id => VERIFIER_PROFILES[id]).map(v => <button key={v.id} className={verifier === v.id ? 'on' : ''} onClick={() => pickVerifier(v.id)}>{v.label}</button>)}
              </div>
            </div>
          </div>

          <div className="std-flow">
            {/* 01 Validate */}
            <div className="std-fstep">
              <div className="std-fnum">01</div>
              <div className="std-fbody">
                <span className="std-fchip" style={{ color: '#fff', background: canGenerate ? '#5E8E6F' : '#C65A1A' }}>{passed} of {total} cleared</span>
                <div className="std-ftitle">Every rule must clear{cert ? <span className="std-fagainst"> · checked against {cert.short}</span> : ''}</div>
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
                <div className="std-ftitle">What {vp.short} need to verify your service</div>
                <div className="std-docs">
                  {vp.docs.map(d => {
                    const onFile = d.profileDoc ? docsOnFile[d.profileDoc] : null;
                    const met = !!docMetEffective[d.id];
                    // Profile-backed docs are read-only (pulled from Documents);
                    // others keep the manual toggle. Optional = supporting.
                    return (
                      <div className={`std-doc2${met ? ' on' : ''}${d.optional ? ' opt' : ''}`} key={d.id} onClick={d.profileDoc ? undefined : () => toggleDoc(d.id)} style={d.profileDoc ? { cursor: 'default' } : undefined}>
                        <span className="ring">{met && <Icon name="Check" size={12} color="#fff" />}</span>
                        <span className="dl">{d.label}{d.optional && <span className="std-doc-opt">optional</span>}</span>
                        {d.profileDoc && (onFile?.fileUrl
                          ? <a href={onFile.fileUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: '#C65A1A', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="Paperclip" size={12} /> View</a>
                          : <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#A6712C' }}>Add to your profile documents</span>)}
                      </div>
                    );
                  })}
                </div>
                {verifier !== 'pya' && <div className="std-fee">{vp.fee}</div>}
              </div>
            </div>

            {/* 03 Attest by vessel — one master per ship (parked: sign-off hidden) */}
            {SHOW_SIGNOFF && (
            <div className="std-fstep" id="std-verify">
              <div className="std-fnum">03</div>
              <div className="std-fbody">
                <span className="std-fchip" style={{ color: '#fff', background: allAttested ? '#5E8E6F' : '#C65A1A' }}>{attestedCount} of {recVessels.length} verified</span>
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

            {/* 03 Export & submit — the deliverable for the chosen verifier.
                Gated on canGenerate (steps 01-02), coherent for every verifier:
                the per-captain breakdown for all; the Nautilus form PDF only for
                Nautilus (the one form Cargo builds); CSV + instructions always. */}
            {!SHOW_SIGNOFF && (
              <div className="std-fstep" id="std-verify">
                <div className="std-fnum">03</div>
                <div className="std-fbody">
                  <span className="std-fchip" style={{ color: '#fff', background: canGenerate ? '#5E8E6F' : '#C65A1A' }}>{canGenerate ? 'Ready to export' : 'Locked'}</span>
                  <div className="std-ftitle">Hand your record to {vp.short}</div>
                  {!canGenerate && (
                    <div className="std-fnote" style={{ color: '#A32D2D' }}>
                      <Icon name="Lock" size={13} /> Locked until steps 01–02 clear — {checks.filter(c => !c.ok).length} check{checks.filter(c => !c.ok).length === 1 ? '' : 's'} still outstanding above.
                    </div>
                  )}
                  {interiorPathway ? (
                    <div className="std-export-instr">Export your record below, then submit it to the PYA with your guest-on days, GUEST certificates and ID for the IAMI GUEST Yacht Purser CoC.</div>
                  ) : verifier === 'pya' ? (
                    <div className="std-export-instr">Download the Cargo → PYA extension and auto-fill your PYA Sea Service Testimonial — one per captain to e-sign.</div>
                  ) : (
                    <div className="std-export-instr">Export the pre-filled form below, get it signed, then submit it to {vp.short} to verify.
                      <span className="std-fhelp" tabIndex={0} role="note" aria-label={`How the ${vp.short} route works`}>
                        <Icon name="Info" size={14} />
                        <span className="std-fhelp-pop">
                          <b>How this works</b>
                          <span>{vp.instructions}</span>
                        </span>
                      </span>
                    </div>
                  )}
                  {nautilusSpells.length === 0 ? (
                    <div className="std-foot" style={{ padding: '10px 0 0' }}>No Cargo-tracked service to export yet — it auto-logs from your current vessel. You can still export your full record as CSV below.</div>
                  ) : (
                    <div className="std-spells">
                      {interiorPathway && (
                        <div className="std-spells-lbl">Your service under each captain, ready for the PYA to verify. Manual &amp; off-Cargo days are excluded.</div>
                      )}
                      {nautilusSpells.map((s, i) => (
                        <div key={i} className="std-spell">
                          <div className="std-spell-main">
                            <div className="nm">{vessels[s.vesselId]?.name || 'Vessel'} · {s.captainId === userId ? `your service as ${topRankWord}` : (s.captainName || 'Captain')}</div>
                            <div className="std-vs">{fmtDate(s.from)} – {fmtDate(s.to)} · {s.days} {s.days === 1 ? 'day' : 'days'}{s.captainId === userId ? ' · endorsed by company' : ''}</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            {verifier === 'nautilus'
                              ? <button className="std-dl" disabled={!canGenerate} style={{ background: canGenerate ? '#C65A1A' : '#EFEDE7', color: canGenerate ? '#fff' : '#A6A199', cursor: canGenerate ? 'pointer' : 'not-allowed' }} onClick={() => onDownloadSpell(s)}><Icon name="FileText" size={15} /> Nautilus form (PDF)</button>
                              : (verifier === 'transport_malta' && (family === 'DECK' || family === 'ENGINE' || family === 'ETO'))
                                ? <button className="std-dl" disabled={!canGenerate} style={{ background: canGenerate ? '#C65A1A' : '#EFEDE7', color: canGenerate ? '#fff' : '#A6A199', cursor: canGenerate ? 'pointer' : 'not-allowed' }} onClick={() => onDownloadSpellTM(s)}><Icon name="FileText" size={15} /> Transport Malta form (PDF)</button>
                                : (verifier === 'mca' && !interiorPathway)
                                  ? <button className="std-dl" disabled={!canGenerate} style={{ background: canGenerate ? '#C65A1A' : '#EFEDE7', color: canGenerate ? '#fff' : '#A6A199', cursor: canGenerate ? 'pointer' : 'not-allowed' }} onClick={() => onDownloadSpellRecord(s)}><Icon name="FileText" size={15} /> Testimonial · MSN 1858 (PDF)</button>
                                  : verifier === 'pya' ? null
                                    : <span className="std-spell-tag">Submit on the {vp.short} route</span>}
                            {verifier === 'pya' && (
                              <button className="std-dl" disabled={!canGenerate} style={{ background: '#fff', color: canGenerate ? '#1C1B3A' : '#A6A199', border: '1px solid #E6E8EC', cursor: canGenerate ? 'pointer' : 'not-allowed' }} onClick={() => canGenerate && onCopySpellForPya(s)} title="Copy this record's details for the PYA autofill bookmarklet"><Icon name="Copy" size={15} /> Copy for PYA</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="std-export-actions">
                    <button className="std-dl" style={{ background: '#fff', color: '#1C1B3A', border: '1px solid #E6E8EC' }} onClick={onExportCsv}><Icon name="Table" size={15} /> Service data (CSV)</button>
                    {verifier !== 'pya' && <span className="std-fee">{vp.fee}</span>}
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
              <div className="cso-eyebrow">Certification journey · Step {journeyStep === 'noe' ? '02' : journeyStep === 'oral' ? '03' : (cert?.oral === false ? '03' : '04')}</div>
              <h3 className="cso-title">{journeyStep === 'noe' ? 'Notice of Eligibility' : journeyStep === 'oral' ? 'Oral examination' : 'Certificate of Competency'}</h3>
              <div className="cso-sub">{journeyStep === 'noe'
                ? 'Apply with your MSF form once eligible. The NoE lets you book the oral exam and is valid 5 years.'
                : journeyStep === 'oral'
                  ? 'Book your MCA oral exam and record the result. A pass is valid 3 years; if you fail, add a re-sit.'
                  : 'The final step. Pull your application bundle together below, record the date you apply, then add the certificate number once it’s issued.'}</div>
            </div>
            <div className="cso-body">
              {journeyStep === 'noe' && (<>
                <div className="cso-fld">
                  <label className="cso-lbl">Status</label>
                  <select className="cso-input" value={journeyDraft.noe?.status || 'not_applied'} onChange={e => setJD('noe.status', e.target.value)}>
                    <option value="not_applied">Not applied</option>
                    <option value="applied">Applied — awaiting</option>
                    <option value="issued">Issued</option>
                  </select>
                </div>
                {(journeyDraft.noe?.status === 'applied' || journeyDraft.noe?.status === 'issued') && (
                  <div className="cso-fld" style={{ marginTop: 12 }}>
                    <label className="cso-lbl">Date applied</label>
                    <input className="cso-input" type="date" value={journeyDraft.noe?.appliedDate || ''} onChange={e => setJD('noe.appliedDate', e.target.value)} />
                  </div>
                )}
                {journeyDraft.noe?.status === 'issued' && (
                  <div className="cso-grid" style={{ marginTop: 12 }}>
                    <div><label className="cso-lbl">Issue date</label><input className="cso-input" type="date" value={journeyDraft.noe?.issueDate || ''} onChange={e => setJD('noe.issueDate', e.target.value)} /></div>
                    <div><label className="cso-lbl">NoE reference no.</label><input className="cso-input" value={journeyDraft.noe?.ref || ''} onChange={e => setJD('noe.ref', e.target.value)} placeholder="e.g. NOE-12345" /></div>
                  </div>
                )}
                {journeyFileField('noe', 'NoE / NoA letter')}
              </>)}

              {journeyStep === 'oral' && (<>
                {journeyDraft.oral?.fails?.length > 0 && (
                  <div className="cso-note">{journeyDraft.oral.fails.length} previous attempt{journeyDraft.oral.fails.length === 1 ? '' : 's'} recorded — this is attempt {journeyDraft.oral.fails.length + 1}.</div>
                )}
                <div className="cso-fld">
                  <label className="cso-lbl">Status</label>
                  <select className="cso-input" value={journeyDraft.oral?.status || 'not_booked'} onChange={e => setJD('oral.status', e.target.value)}>
                    <option value="not_booked">Not booked</option>
                    <option value="booked">Booked</option>
                    <option value="passed">Passed</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>
                {(journeyDraft.oral?.status === 'booked' || journeyDraft.oral?.status === 'failed' || journeyDraft.oral?.status === 'passed') && (
                  <div className="cso-fld" style={{ marginTop: 12 }}>
                    <label className="cso-lbl">Exam date</label>
                    <input className="cso-input" type="date" value={journeyDraft.oral?.bookedDate || ''} onChange={e => setJD('oral.bookedDate', e.target.value)} />
                  </div>
                )}
                {journeyDraft.oral?.status === 'passed' && (
                  <div className="cso-grid" style={{ marginTop: 12 }}>
                    <div><label className="cso-lbl">Passed on</label><input className="cso-input" type="date" value={journeyDraft.oral?.passDate || ''} onChange={e => setJD('oral.passDate', e.target.value)} /></div>
                    <div><label className="cso-lbl">Pass reference no.</label><input className="cso-input" value={journeyDraft.oral?.ref || ''} onChange={e => setJD('oral.ref', e.target.value)} placeholder="e.g. exam ref" /></div>
                  </div>
                )}
                {journeyDraft.oral?.status === 'failed' && (
                  <div className="cso-resit">
                    <div className="cso-note">This attempt was a fail. The MCA sets a minimum interval before re-sitting. Once you’ve re-booked, record it as a new attempt.</div>
                    <button className="cso-btn ghost" type="button" onClick={addOralResit}><Icon name="Plus" size={14} /> Add re-sit (book again)</button>
                  </div>
                )}
                {journeyFileField('oral', 'Oral exam pass slip')}
              </>)}

              {journeyStep === 'coc' && (() => {
                const ck = journeyDraft.coc?.checklist || {};
                const itemDone = (it) => it.state === 'done' || it.state === 'na' || !!ck[it.key];
                const cocReady = appChecklist.length > 0 && appChecklist.every(itemDone);
                const doneN = appChecklist.filter(itemDone).length;
                const listOpen = cocListOpen == null ? !cocReady : cocListOpen;
                const cocStatus = journeyDraft.coc?.status || 'not_applied';
                // Keep the application fields visible once they've applied even if a
                // detected item later lapses, so a recorded date is never hidden.
                const showApply = cocReady || cocStatus === 'applied' || cocStatus === 'issued';
                return (<>
                  <div className="cj-cocsec">
                    <button type="button" className="cj-cocsec-toggle" onClick={() => setCocListOpen(!listOpen)} aria-expanded={listOpen}>
                      <span className="cj-cocsec-h">{interiorPathway ? 'What to send to the PYA' : 'What to send to the MCA'}</span>
                      <span className="cj-cocsec-count">{cocReady ? 'All ready' : `${doneN}/${appChecklist.length} ready`}<Icon name="ChevronDown" size={14} style={{ transform: listOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} /></span>
                    </button>
                    {listOpen && (<>
                      <div className="cj-cocsec-sub">{interiorPathway
                        ? <>Your verified service record is the evidence of senior service — the PYA also verify your guest-on days and GUEST course units for the Yacht Purser CoC. We tick what we can detect; confirm the rest by hand.</>
                        : <>Your verified Sea Service Record is the evidence of sea service — the MCA also needs the rest of this bundle for {cert?.short || 'your CoC'}. We tick what we can detect; confirm the rest by hand.</>}</div>
                      <div className="cj-coclist">
                        {appChecklist.map(it => {
                          const auto = it.state === 'done' || it.state === 'na';
                          const ticked = itemDone(it);
                          const ic = it.state === 'pending' ? 'Clock' : ticked ? 'CheckCircle' : 'Circle';
                          return (
                            <button type="button" key={it.key} className={`cj-cocitem${ticked ? ' on' : ''}${auto ? ' auto' : ''}`}
                              disabled={auto} onClick={auto ? undefined : () => setJD(`coc.checklist.${it.key}`, !ck[it.key])}
                              title={auto ? 'Tracked for you' : 'Tap to confirm'}>
                              <span className="mk"><Icon name={ic} size={15} /></span>
                              <span className="tx"><span className="l">{it.label}</span>{it.detail && <span className="d">{it.detail}</span>}</span>
                              {auto && <span className="cj-cocauto">auto</span>}
                            </button>
                          );
                        })}
                      </div>
                    </>)}
                  </div>
                  {!showApply ? (
                    <div className="cso-note">Tick everything you’ll send, then record your application date below.</div>
                  ) : (<>
                    <div className="cso-fld">
                      <label className="cso-lbl">Application</label>
                      <select className="cso-input" value={cocStatus} onChange={e => setJD('coc.status', e.target.value)}>
                        <option value="not_applied">Bundle ready — not applied yet</option>
                        <option value="applied">Applied — awaiting</option>
                        <option value="issued">Issued</option>
                      </select>
                    </div>
                    {(cocStatus === 'applied' || cocStatus === 'issued') && (
                      <div className="cso-fld" style={{ marginTop: 12 }}>
                        <label className="cso-lbl">Date applied</label>
                        <input className="cso-input" type="date" value={journeyDraft.coc?.appliedDate || ''} onChange={e => setJD('coc.appliedDate', e.target.value)} />
                      </div>
                    )}
                    {cocStatus === 'issued' && (
                      <div className="cso-grid" style={{ marginTop: 12 }}>
                        <div><label className="cso-lbl">Issue date</label><input className="cso-input" type="date" value={journeyDraft.coc?.issuedDate || ''} onChange={e => setJD('coc.issuedDate', e.target.value)} /></div>
                        <div><label className="cso-lbl">Certificate no.</label><input className="cso-input" value={journeyDraft.coc?.ref || ''} onChange={e => setJD('coc.ref', e.target.value)} placeholder="CoC number" /></div>
                      </div>
                    )}
                    {journeyFileField('coc', 'Certificate of Competency')}
                  </>)}
                </>);
              })()}
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
