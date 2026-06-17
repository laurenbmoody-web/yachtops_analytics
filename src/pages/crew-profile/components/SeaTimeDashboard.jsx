import React, { useState, useMemo, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import {
  DEFAULT_CONFIG, PATHWAYS, DEFAULT_PATHWAY, TYPE_META, SOURCE_META, VERIFIER_PROFILES,
  classify, computeBuckets, computeRequirements, runChecks, computeAssurance
} from '../../../seatime/engine';
import { SEED_VESSELS, SEED_ENTRIES, SEED_PRIOR, SEED_SEAFARER } from '../../../seatime/seed';
import './sea-time-dashboard.css';

// Recreation of the design-handoff Sea Time Tracker (Countdown default + Ledger
// + Voyage + the shared MIN 642 testimonial pack generator), driven by the
// ported rules engine. In-memory demo state per the handoff; live-store wiring
// is a later step.

const IcoPath = ({ d, color, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d={d} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Deterministic QR-ish seal (ported from the mock's qrElement).
const QrSeal = ({ seed, size = 96 }) => {
  const N = 21, cell = 5;
  let s = 0; for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
  const rects = [];
  const finder = (ox, oy) => { for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) { const edge = x === 0 || x === 6 || y === 0 || y === 6; const core = x >= 2 && x <= 4 && y >= 2 && y <= 4; if (edge || core) rects.push(<rect key={`f${ox}${oy}${x}${y}`} x={(ox + x) * cell} y={(oy + y) * cell} width={cell} height={cell} fill="#1A2233" />); } };
  finder(0, 0); finder(N - 7, 0); finder(0, N - 7);
  const inFinder = (x, y) => (x < 8 && y < 8) || (x > N - 9 && y < 8) || (x < 8 && y > N - 9);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { if (inFinder(x, y)) continue; if (rnd() > 0.52) rects.push(<rect key={`m${x}${y}`} x={x * cell} y={y * cell} width={cell} height={cell} fill="#1A2233" />); }
  return <svg width={size} height={size} viewBox={`0 0 ${N * cell} ${N * cell}`}>{rects}</svg>;
};

const fmtDate = (iso) => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

const SeaTimeDashboard = () => {
  const vessels = SEED_VESSELS;
  const config = DEFAULT_CONFIG;
  const [variant, setVariant] = useState('countdown');
  const [pathwayId, setPathwayId] = useState(DEFAULT_PATHWAY);
  const [serviceFilter, setServiceFilter] = useState('all');
  const [verifier, setVerifier] = useState('pya');
  const [signatory, setSignatory] = useState('master');
  const [signed, setSigned] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [docMet, setDocMet] = useState({ passport: false, email: true, srb: true, template: true, stamp: false, scan: true, min642: true, sig: true });
  const [form, setForm] = useState({ vesselId: 'v1', from: '2026-04-26', to: '2026-04-30', type: 'watchkeeping', watchHours: 6, capacity: 'Master' });
  const [entries, setEntries] = useState(SEED_ENTRIES);
  const toastTimer = useRef(null);

  const flash = (msg) => { setToast(msg); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 2600); };
  const pathway = PATHWAYS[pathwayId];

  // ── derived (pure, recomputed each render) ──
  const buckets = useMemo(() => computeBuckets(entries, vessels, config), [entries]);
  const requirements = useMemo(() => computeRequirements(buckets, SEED_PRIOR, pathway), [buckets, pathway]);
  const checkResult = useMemo(() => runChecks({ entries, vessels, config, signatory, verifier, docMet }), [entries, signatory, verifier, docMet]);
  const { checks, canGenerate, passed, total, readinessPct } = checkResult;
  const assurance = useMemo(() => computeAssurance({ verifierShort: VERIFIER_PROFILES[verifier].short, buckets, signatory }), [verifier, buckets, signatory]);

  const totalReq = requirements.find(r => r.key === 'total');
  const arcPct = Math.min(100, Math.round(totalReq.current / pathway.total * 100));
  const arcOffset = Math.round(565 * (1 - arcPct / 100));
  const daysToGo = Math.max(0, pathway.total - totalReq.current);
  const live = entries.filter(e => !e.excluded);
  const badCount = live.filter(e => !classify(e, vessels[e.vesselId], config).qual).length;
  const hasAttention = badCount > 0;

  // ── handlers ──
  const pickVerifier = (v) => { setVerifier(v); setSigned(false); };
  const pickSignatory = (s) => { setSignatory(s); setSigned(false); };
  const toggleDoc = (id) => { setDocMet(d => ({ ...d, [id]: !d[id] })); setSigned(false); };
  const reclassify = (id) => { setEntries(es => es.map(e => e.id === id ? { ...e, type: 'standby', detailOverride: 'Reclassified from watchkeeping' } : e)); setSigned(false); flash('Entry reclassified to standby'); };
  const excludeEntry = (id) => { setEntries(es => es.map(e => e.id === id ? { ...e, excluded: true } : e)); setSigned(false); flash('Entry excluded from the pack'); };
  const onGenerate = () => { if (!canGenerate) { flash('Resolve all validation checks first'); return; } setSigned(true); flash('Pack generated & captain-signed'); };

  const formDays = () => { const { from, to } = form; if (!from || !to) return 1; const d = Math.round((new Date(to) - new Date(from)) / 86400000) + 1; return d > 0 ? d : 1; };
  const saveEntry = () => {
    const days = formDays();
    const fm = (iso) => { const d = new Date(iso); return String(d.getDate()).padStart(2, '0') + ' ' + d.toLocaleString('en-GB', { month: 'short' }); };
    const main = fm(form.from) + (form.to && form.to !== form.from ? ' – ' + fm(form.to) : '');
    const yr = form.from ? new Date(form.from).getFullYear() : 2026;
    const entry = { id: 'e' + Date.now(), vesselId: form.vesselId, label: TYPE_META[form.type].label + ' — ' + vessels[form.vesselId].name, dateMain: main, dateSub: yr + ' · ' + days + (days === 1 ? ' day' : ' days'), days, type: form.type, watchHours: form.watchHours, capacity: form.capacity, source: 'manual' };
    setEntries(es => [entry, ...es]); setDrawerOpen(false); setSigned(false); flash('Sea time logged & classified');
  };

  const reqAccent = (key, met) => key === 'seagoing' ? '#1F6F8B' : key === 'watchkeeping' ? (met ? '#27A567' : '#4C5FB0') : '#C65A1A';

  // ── shared ledger table (Variant A + Countdown) ──
  const LedgerTable = () => {
    const filters = [['all', 'All'], ['seagoing', 'Seagoing'], ['watchkeeping', 'Watchkeeping'], ['standby', 'Standby'], ['yard', 'Yard']];
    const shown = entries.filter(e => serviceFilter === 'all' || e.type === serviceFilter);
    const excludedCount = entries.filter(e => e.excluded).length;
    return (
      <div className="std-ledger std-card" style={{ overflow: 'hidden' }}>
        <div className="lhead" style={{ padding: '20px 18px 0' }}>
          <h4>Logged sea service</h4>
          <div className="std-filter">
            {filters.map(([k, l]) => (
              <button key={k} className={serviceFilter === k ? 'on' : ''} onClick={() => setServiceFilter(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          {shown.map(e => {
            const v = vessels[e.vesselId], tm = TYPE_META[e.type], c = classify(e, v, config), sm = SOURCE_META[e.source] || SOURCE_META.manual;
            const isExcluded = !!e.excluded, isQual = !isExcluded && c.qual, isBad = !isExcluded && !c.qual;
            const detail = e.type === 'watchkeeping' ? `${e.watchHours}h watch · ${e.capacity}` : (e.detailOverride || `${tm.hint} · ${e.capacity}`);
            const qualLabel = e.type === 'seagoing' ? 'Qualifies · seagoing' : e.type === 'watchkeeping' ? 'Qualifies · watchkeeping' : e.type === 'standby' ? 'Counts · standby' : 'Counts · shipyard';
            return (
              <div className="std-row" key={e.id} style={{ opacity: isExcluded ? 0.5 : 1 }}>
                <div><div className="date">{e.dateMain}</div><div className="datesub">{e.dateSub}</div></div>
                <div>
                  <div className="std-flex std-ac" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span className="vn">{v.name}</span>
                    <span className="std-tag" style={{ color: sm.color, background: sm.bg }}>{sm.label}</span>
                  </div>
                  <div className="vs">{v.flag} · {v.gt}GT · {v.lengthM}m · IMO {v.imo}</div>
                </div>
                <div>
                  <span className="std-pill" style={{ color: tm.color, background: tm.bg }}>
                    <span style={{ width: 8, height: 8, borderRadius: 3, background: tm.color, display: 'inline-block' }} /> {tm.label}
                  </span>
                  <div className="vs" style={{ marginTop: 4 }}>{detail}</div>
                </div>
                <div className="std-right">
                  {isExcluded && <span className="std-pill" style={{ color: '#5A6478', background: '#EEF0F3' }}>Excluded from pack</span>}
                  {isQual && <span className="std-pill" style={{ color: '#1F7A4D', background: '#DEF3E7' }}><Icon name="Check" size={12} /> {qualLabel}</span>}
                  {isBad && (
                    <div>
                      <span className="std-pill" style={{ color: '#C0392B', background: '#FBE7E4' }}><Icon name="X" size={12} /> Non-qualifying</span>
                      <div className="vs" style={{ color: '#C0392B', marginTop: 4, textAlign: 'right' }}>{c.reason}</div>
                      <button className="std-fix" onClick={() => e.type === 'watchkeeping' ? reclassify(e.id) : excludeEntry(e.id)}>
                        {e.type === 'watchkeeping' ? 'Reclassify to standby' : 'Exclude from pack'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="std-foot">{live.length} entries in pack · {buckets.total} qualifying days{excludedCount ? ` · ${excludedCount} excluded` : ''}</div>
      </div>
    );
  };

  // ── bucket pills ──
  const BucketPills = () => (
    <div className="std-bpills">
      {[['seagoing', 'SEAGOING'], ['watchkeeping', 'WATCHKEEPING'], ['standby', 'STANDBY'], ['yard', 'SHIPYARD']].map(([k, up]) => {
        const tm = TYPE_META[k === 'yard' ? 'yard' : k];
        return (
          <div className="std-bpill" key={k}>
            <div className="l" style={{ color: tm.color }}>● {up}</div>
            <div className="n">{buckets[k]}</div><span className="u">days</span>
          </div>
        );
      })}
    </div>
  );

  // ── Countdown variant ──
  const Countdown = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="std-card std-hero">
        <div className="std-arc-wrap">
          <svg width="240" height="240" viewBox="0 0 240 240">
            <circle cx="120" cy="120" r="90" fill="none" stroke="#F0F2F5" strokeWidth="20" />
            <circle cx="120" cy="120" r="90" fill="none" stroke="#C65A1A" strokeWidth="20" strokeLinecap="round"
              strokeDasharray="565" strokeDashoffset={arcOffset} transform="rotate(-90 120 120)" style={{ transition: 'stroke-dashoffset 1.4s cubic-bezier(.2,.8,.2,1)' }} />
          </svg>
          <div className="std-arc-center">
            <div className="pct">{arcPct}%</div>
            <div className="cap">toward your next certificate</div>
          </div>
        </div>
        <div>
          <div className="mlabel rustlabel">Next certificate</div>
          <h3>{pathway.label}</h3>
          <div className="lead"><b>{totalReq.current} of {pathway.total}</b> qualifying days logged — <b>{daysToGo} days to go</b>.</div>
          <div className="std-reqmini">
            {requirements.map(r => (
              <div className="c" key={r.key}>
                <div className="l" style={{ color: reqAccent(r.key, r.met) }}>{r.short}</div>
                <div className="n">{r.current} / {r.required}</div>
                <div className="std-bar"><i className="std-grow" style={{ width: `${r.pct}%`, background: r.met ? '#27A567' : '#C65A1A' }} /></div>
              </div>
            ))}
          </div>
          <div className={`std-nudge ${hasAttention ? '' : 'clear'}`}>
            <IcoPath d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2ZM9 21h6M10 17v4m4-4v4" color={hasAttention ? '#C65A1A' : '#1F7A4D'} size={20} />
            <div>
              <div className="nt">{hasAttention ? `${badCount} logged ${badCount === 1 ? 'entry needs' : 'entries need'} attention.` : "On your current rota you'll qualify by 12 Sept 2026."}</div>
              <div className="ns">{hasAttention ? 'Non-qualifying service is excluded from your totals — review and re-tag to keep your pack clean.' : 'Request 40 more bridge-watch days this season to bring eligibility forward to July.'}</div>
              {!hasAttention && <div className="priv">Private to you.</div>}
            </div>
            {hasAttention && <button className="std-reviewbtn" onClick={() => setVariant('ledger')}>Review</button>}
          </div>
        </div>
      </div>
      <BucketPills />
      <LedgerTable />
    </div>
  );

  // ── Ledger variant ──
  const Ledger = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="std-card std-pathcard">
        <div className="std-flex std-between std-astart" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div><div className="mlabel">Target pathway</div><div className="serif" style={{ fontSize: 22, marginTop: 4 }}>{pathway.label}</div></div>
          <div className="std-right"><div className="big">{totalReq.current} <span className="of">/ {pathway.total}</span></div><div className="vs">qualifying days logged</div></div>
        </div>
        {requirements.map(r => (
          <div className="std-req" key={r.key}>
            <div className="top">
              <span className="rl">{r.label}</span><span className="rs">{r.sub}</span>
              <span className="std-pill" style={{ marginLeft: 'auto', color: r.met ? '#1F7A4D' : '#B7791F', background: r.met ? '#DEF3E7' : '#FBF0DA' }}>
                {r.met ? <Icon name="Check" size={12} /> : <Icon name="ArrowUp" size={12} />} {r.statusLabel}
              </span>
              <span className="rl" style={{ minWidth: 78, textAlign: 'right' }}>{r.current} / {r.required}</span>
            </div>
            <div className="std-bar"><i className="std-grow" style={{ width: `${r.pct}%`, background: r.met ? '#27A567' : '#C65A1A' }} /></div>
          </div>
        ))}
      </div>
      <div className="std-bucket-tiles">
        {[['seagoing', 'AT SEA', 'Qualifying passage days'], ['watchkeeping', '≥4H WATCH', 'Bridge watch days'], ['standby', 'CAPPED', `${buckets.standbyRaw} logged · cap ${config.standbyCapDays}`], ['yard', 'REFIT', 'Shipyard / standby refit']].map(([k, tag, note]) => {
          const tm = TYPE_META[k];
          return (
            <div className="std-tile" key={k}>
              <div className="chip" style={{ background: tm.bg }}><IcoPath d={tm.icon} color={tm.color} /></div>
              <div className="tag" style={{ color: tm.color }}>{tag}</div>
              <div className="n">{buckets[k]}</div>
              <div className="vs">{tm.label}</div>
              <div className="note">{note}</div>
            </div>
          );
        })}
      </div>
      <LedgerTable />
    </div>
  );

  // ── Voyage variant ──
  const Voyage = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="std-passage">
        <div className="std-flex std-between" style={{ alignItems: 'flex-start' }}>
          <div><div className="pe">The passage to command</div><h3>{totalReq.current} of {pathway.total} days logged</h3></div>
          <div style={{ textAlign: 'right' }}><div className="serif" style={{ fontSize: 40, color: '#fff' }}>{arcPct}%</div><div style={{ fontSize: 12, color: '#C7956F' }}>to {pathway.short}</div></div>
        </div>
        <div style={{ position: 'relative', height: 8, background: '#36456A', borderRadius: 999, marginTop: 22 }}>
          <div style={{ position: 'absolute', inset: '0 auto 0 0', width: `${arcPct}%`, background: '#C65A1A', borderRadius: 999 }} />
          <div style={{ position: 'absolute', left: `${Math.max(2, Math.min(96, arcPct))}%`, top: -7, transform: 'translateX(-50%)' }}><IcoPath d={TYPE_META.seagoing.icon} color="#fff" size={22} /></div>
        </div>
        <div className="std-flex std-between" style={{ marginTop: 12, fontSize: 11.5, color: '#9DB0C9' }}>
          <span>Jan 2026 · joined</span><span>today · {totalReq.current} days</span><span>{pathway.total} · certificate</span>
        </div>
      </div>
      <BucketPills />
      <div className="std-spine">
        {entries.map(e => {
          const v = vessels[e.vesselId], tm = TYPE_META[e.type], c = classify(e, v, config);
          const isExcluded = !!e.excluded, isBad = !isExcluded && !c.qual;
          const word = (e.type === 'standby' || e.type === 'yard') ? 'Counts' : 'Qualifies';
          const sub = `${v.name} · ${e.dateMain} · ${e.days} ${e.days === 1 ? 'day' : 'days'}${e.type === 'watchkeeping' ? ` · ${e.watchHours}h watch` : ''}`;
          return (
            <div className="std-vcard" key={e.id} style={{ background: isBad ? '#FFF8F7' : '#fff', borderColor: isBad ? '#F3D5CF' : '#E6E8EC', opacity: isExcluded ? 0.5 : 1 }}>
              <span style={{ position: 'absolute', left: -26, top: 22, width: 12, height: 12, borderRadius: '50%', border: '3px solid #fff', background: isExcluded ? '#C7CCD5' : (isBad ? '#C0392B' : tm.color) }} />
              <div className="std-vtile" style={{ background: isBad ? '#FBE7E4' : tm.bg }}><IcoPath d={tm.icon} color={isBad ? '#C0392B' : tm.color} size={24} /></div>
              <div style={{ flex: 1 }}>
                <div className="std-flex std-ac" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span className="std-vtitle">{e.label}</span>
                  <span className="std-pill" style={{ color: tm.color, background: tm.bg }}>{tm.label}</span>
                </div>
                <div className="vs" style={{ marginTop: 3 }}>{sub}</div>
                {isBad && <div className="vs" style={{ color: '#C0392B', marginTop: 4 }}>{c.reason}</div>}
              </div>
              <div className="std-right">
                {isExcluded ? <span className="std-pill" style={{ color: '#5A6478', background: '#EEF0F3' }}>Excluded</span>
                  : isBad ? <button className="std-fix" onClick={() => e.type === 'watchkeeping' ? reclassify(e.id) : excludeEntry(e.id)}>{e.type === 'watchkeeping' ? 'Reclassify' : 'Exclude'}</button>
                  : <span className="std-pill" style={{ color: '#1F7A4D', background: '#DEF3E7' }}><Icon name="Check" size={12} /> {word}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── Pack generator (shared) ──
  const vp = VERIFIER_PROFILES[verifier];
  const usedVessels = [...new Set(live.map(e => e.vesselId))].map(id => vessels[id]);
  const PackGenerator = () => (
    <div className="std-dossier">
      <div className="std-dossier-h">
        <div>
          <div className="mlabel rustlabel">Captain-signed · MCA MIN 642</div>
          <h3>Sea Service Testimonial Pack</h3>
          <div className="sub">Assemble a first-pass-clean, captain-signed testimonial for your chosen verifying organisation. Switching the verifier re-renders the checklist from the same record — no re-entry.</div>
        </div>
        <div>
          <div className="mlabel" style={{ marginBottom: 6 }}>Verifying organisation</div>
          <div className="std-vtabs">
            {Object.values(VERIFIER_PROFILES).map(v => (
              <button key={v.id} className={verifier === v.id ? 'on' : ''} onClick={() => pickVerifier(v.id)}>{v.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="std-steps">
        {/* Step 1 — Validate (dark) */}
        <div className="std-step dark">
          <div className="sh">
            <span className="std-badge">1</span>
            <div><div className="st">Validate</div><div className="ss">Blocked until every rule clears</div></div>
            <span className="std-chip-ready" style={{ marginLeft: 'auto', color: '#fff', background: canGenerate ? '#27A567' : '#C65A1A' }}>{passed} of {total} checks cleared</span>
          </div>
          <div className="std-readbar"><i className="std-grow" style={{ display: 'block', height: '100%', width: `${readinessPct}%`, background: canGenerate ? '#27A567' : '#C65A1A', borderRadius: 999 }} /></div>
          <div style={{ marginTop: 6 }}>
            {checks.map((c, i) => (
              <div className="std-check" key={i}>
                <span className="box" style={{ background: c.ok ? '#27A567' : '#C0392B' }}><Icon name={c.ok ? 'Check' : 'X'} size={12} color="#fff" /></span>
                <div><div className="ct" style={{ color: c.ok ? '#CFE8D8' : '#F0B7B0' }}>{c.label}</div><div className="cd">{c.detail}</div></div>
              </div>
            ))}
          </div>
        </div>

        {/* Step 2 — Attach documents */}
        <div className="std-step">
          <div className="sh"><span className="std-badge">2</span><div><div className="st">Attach documents</div><div className="ss">For {vp.name}</div></div></div>
          {vp.docs.map(d => {
            const met = !!docMet[d.id];
            return (
              <div className="std-doc" key={d.id} onClick={() => toggleDoc(d.id)} style={{ background: met ? '#EAF7EF' : '#fff', borderColor: met ? '#BFE3CC' : '#E6E8EC' }}>
                <span className="dbox" style={{ borderColor: met ? '#27A567' : '#C7CCD5', background: met ? '#27A567' : '#fff' }}>{met && <Icon name="Check" size={12} color="#fff" />}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{d.label}</span>
              </div>
            );
          })}
          <div className="vs" style={{ marginTop: 8 }}>{vp.fee}</div>
        </div>

        {/* Step 3 — Authorise */}
        <div className="std-step">
          <div className="sh"><span className="std-badge">3</span><div><div className="st">Authorise</div><div className="ss">Master who attests this service</div></div></div>
          <div className="std-sig">
            {[{ key: 'master', name: 'Capt. Henrik Sõrensen', sub: 'Master · CoC 0094821', bad: false }, { key: 'self', name: 'Lauren Moody (self)', sub: 'Seafarer — not permitted', bad: true }].map(o => {
              const sel = signatory === o.key;
              return (
                <div className="std-sigcard" key={o.key} onClick={() => pickSignatory(o.key)}
                  style={{ borderColor: sel ? (o.bad ? '#C0392B' : '#27A567') : '#E6E8EC', background: sel ? (o.bad ? '#FBEDEB' : '#EAF7EF') : '#fff' }}>
                  <div className="nm">{o.name}</div>
                  <div className="sb" style={{ color: o.bad ? '#C0392B' : '#8A93A3' }}>{o.sub}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step 4 placeholder spacing handled by issue bar below */}
        <div className="std-step" style={{ background: '#fff', borderStyle: 'dashed' }}>
          <div className="sh" style={{ borderBottom: 0, marginBottom: 0, paddingBottom: 0 }}>
            <span className="std-badge">4</span><div><div className="st">Issue</div><div className="ss">Generate the signed pack →</div></div>
          </div>
        </div>
      </div>

      {/* Issue bar */}
      <div className="std-issue">
        <span className="std-gate-ic" style={{ background: canGenerate ? '#DEF3E7' : '#FBE7E4' }}><Icon name={canGenerate ? 'Check' : 'X'} size={20} color={canGenerate ? '#1F7A4D' : '#C0392B'} /></span>
        <div>
          <div className="mlabel">Step 4 · Issue</div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{canGenerate ? 'All checks passed' : `${checks.filter(c => !c.ok).length} check(s) blocking generation`}</div>
          <div className="vs">{canGenerate ? `Ready to generate a first-pass-clean pack for ${vp.short}.` : 'Resolve every item in step 1 to continue.'}</div>
        </div>
        <button className="std-genbtn" onClick={onGenerate}
          style={{ background: canGenerate ? '#C65A1A' : '#2E3850', color: canGenerate ? '#fff' : '#6B7689', cursor: canGenerate ? 'pointer' : 'not-allowed' }}>
          <Icon name={canGenerate ? 'FileCheck' : 'Lock'} size={15} /> {canGenerate ? (signed ? 'Regenerate pack' : 'Generate signed pack') : 'Blocked'}
        </button>
      </div>

      {/* Certificate */}
      {signed && (
        <div className="std-cert">
          <div className="frame">
            <div className="stamp"><div className="v">✶ VERIFIED ✶</div><div className="c">Captain-signed</div></div>
            <div className="std-flex std-ac" style={{ gap: 14 }}>
              <span className="seal"><Icon name="Anchor" size={22} /></span>
              <div>
                <div className="ce">Maritime &amp; Coastguard Agency · MIN 642 Annex A</div>
                <h2>Testimonial of Sea Service</h2>
                <div className="prepared">Prepared for {vp.name}</div>
              </div>
            </div>
            <div className="drule" /><div className="drule2" />
            <div className="fields">
              <div className="field"><div className="fl">Seafarer</div><div className="fv">{SEED_SEAFARER.fullName}</div></div>
              <div className="field"><div className="fl">DOB · Nationality</div><div className="fv">{fmtDate(SEED_SEAFARER.dob)} · {SEED_SEAFARER.nationality}</div></div>
              <div className="field"><div className="fl">Discharge book / NoE</div><div className="fv">{SEED_SEAFARER.dischargeBookNo}</div></div>
              <div className="field"><div className="fl">Capacity</div><div className="fv">Master</div></div>
              <div className="field"><div className="fl">Service period</div><div className="fv">{fmtDate(SEED_SEAFARER.periodFrom)} – {fmtDate(SEED_SEAFARER.periodTo)}</div></div>
              <div className="field"><div className="fl">CoC held</div><div className="fv">{SEED_SEAFARER.cocHeld}</div></div>
            </div>
            <table>
              <thead><tr><th>Vessel</th><th>Flag · IMO</th><th>GT</th><th>Length</th></tr></thead>
              <tbody>{usedVessels.map(v => <tr key={v.id}><td>{v.name}</td><td>{v.flag} · IMO {v.imo}</td><td>{v.gt} GT</td><td>{v.lengthM} m</td></tr>)}</tbody>
            </table>
            <div className="mlabel" style={{ marginTop: 16 }}>Service totals — totalled separately</div>
            <div className="totals">
              {[['Seagoing', buckets.seagoing], ['Watchkeeping', buckets.watchkeeping], ['Standby', buckets.standby], ['Shipyard', buckets.yard]].map(([l, n]) => (
                <div className="tbox" key={l}><div className="tn">{n}</div><div className="tl">{l} days</div></div>
              ))}
            </div>
            <div className="std-flex std-between" style={{ alignItems: 'flex-end', marginTop: 22, gap: 20, flexWrap: 'wrap' }}>
              <div>
                <div className="sigline">{signatory === 'self' ? 'Lauren Moody' : 'H. Sõrensen'}</div>
                <div className="vs" style={{ marginTop: 6 }}>{signatory === 'self' ? 'Self — not accepted by MCA' : 'Capt. Henrik Sõrensen · Master · CoC 0094821 · 22/04/2026'}</div>
              </div>
              <div className="qrseal">
                <QrSeal seed={assurance.contentHash} />
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', marginTop: 4 }}>SCAN TO VERIFY</div>
                <div style={{ fontSize: 9.5, color: '#8A7F63', marginTop: 2 }}>{assurance.verificationRef}</div>
                <div style={{ fontSize: 8.5, color: '#A0916C' }}>{assurance.qrPayload}</div>
              </div>
            </div>
          </div>
          <div className="std-certfoot">
            <div className="vs" style={{ maxWidth: 480 }}>{vp.instructions}</div>
            <div className="std-flex" style={{ gap: 10 }}>
              <button className="std-dl" style={{ background: '#C65A1A', color: '#fff' }} onClick={() => flash('Preparing pack… (demo)')}><Icon name="Download" size={15} /> Download PDF</button>
              <button className="std-dl" style={{ background: '#fff', color: '#1A2233', border: '1px solid #E6E8EC' }} onClick={() => flash('Pack emailed (demo)')}><Icon name="Mail" size={15} /> Email pack</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ── Log sea time drawer ──
  const previewClassify = classify({ ...form }, vessels[form.vesselId], config);
  const Drawer = () => (
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
                    <div className="tt" style={{ color: sel ? tm.color : '#1A2233' }}>{tm.label}</div>
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
          <div className="std-preview" style={{ background: previewClassify.qual ? '#F1F9F4' : '#FDF1EF', borderColor: previewClassify.qual ? '#CFE8D8' : '#F3D5CF' }}>
            <Icon name={previewClassify.qual ? 'Check' : 'X'} size={16} color={previewClassify.qual ? '#1F7A4D' : '#C0392B'} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: previewClassify.qual ? '#1F7A4D' : '#C0392B' }}>{previewClassify.qual ? 'Will qualify' : 'Will be flagged non-qualifying'} · {formDays()} {formDays() === 1 ? 'day' : 'days'}</div>
              <div className="vs" style={{ marginTop: 2 }}>{previewClassify.reason || `${TYPE_META[form.type].label} service on ${vessels[form.vesselId].name} — counts toward your ${TYPE_META[form.type].label.toLowerCase()} total.`}</div>
            </div>
          </div>
        </div>
        <div className="std-flex" style={{ gap: 10, padding: '16px 24px', borderTop: '1px solid #E6E8EC' }}>
          <button className="std-dl" style={{ background: '#fff', border: '1px solid #E6E8EC', color: '#1A2233', flex: 1, justifyContent: 'center' }} onClick={() => setDrawerOpen(false)}>Cancel</button>
          <button className="std-dl" style={{ background: '#1A2233', color: '#fff', flex: 1, justifyContent: 'center' }} onClick={saveEntry}>Add entry</button>
        </div>
      </div>
    </>
  );

  return (
    <div className="std">
      <div className="std-head">
        <div className="std-title"><span className="num">07</span><span className="sl">/</span>Sea Time Tracker</div>
        <div className="std-flex std-ac" style={{ gap: 12, flexWrap: 'wrap' }}>
          <select className="std-select" style={{ width: 'auto' }} value={pathwayId} onChange={e => setPathwayId(e.target.value)}>
            {Object.values(PATHWAYS).map(p => <option key={p.id} value={p.id}>{p.short}</option>)}
          </select>
          <div className="std-switch">
            {[['ledger', 'Ledger'], ['voyage', 'Voyage Log'], ['countdown', 'Countdown']].map(([k, l]) => (
              <button key={k} className={variant === k ? 'on' : ''} onClick={() => setVariant(k)}>{l}</button>
            ))}
          </div>
          <button className="std-logbtn" onClick={() => setDrawerOpen(true)}><Icon name="Plus" size={16} /> Log sea time</button>
        </div>
      </div>

      {variant === 'countdown' && <Countdown />}
      {variant === 'ledger' && <Ledger />}
      {variant === 'voyage' && <Voyage />}

      <div style={{ marginTop: 18 }}><PackGenerator /></div>

      {drawerOpen && <Drawer />}
      {toast && <div className="std-toast"><Icon name="Check" size={16} color="#27A567" /> {toast}</div>}
    </div>
  );
};

export default SeaTimeDashboard;
