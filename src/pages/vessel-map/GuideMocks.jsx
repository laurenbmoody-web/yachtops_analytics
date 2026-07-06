// TEMPORARY design exploration — four capture-guide directions behind
// /vessel/map/manage/guide-mocks?v=1..4. The chosen direction gets built
// properly into CaptureGuide; this file is then deleted.
import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import '../../styles/editorial.css';
import '../../styles/editorial-tokens.css';
import './vessel-map.css';
import './manage-scans.css';
import './guide-mocks.css';

const VM_STAGE = '#22253F';

/* ── Drawn illustrations — 1.5px strokes, ink + terracotta ──────────────── */

const ScanIllo = ({ ink = '#1C1B3A', accent = '#C65A1A', soft = '#AEB4C2' }) => (
  <svg viewBox="0 0 220 150" className="gm-illo" aria-hidden="true">
    {/* room corner */}
    <path d="M130 18 L205 40 M130 18 L130 96 M130 96 L205 122 M205 40 L205 122" stroke={soft} strokeWidth="1.2" fill="none" opacity="0.55" />
    {/* phone */}
    <rect x="28" y="38" width="44" height="80" rx="9" stroke={ink} strokeWidth="1.6" fill="none" />
    <line x1="42" y1="47" x2="58" y2="47" stroke={ink} strokeWidth="1.6" strokeLinecap="round" />
    {/* scan arcs */}
    <path d="M84 60 Q100 78 84 96" stroke={accent} strokeWidth="1.4" fill="none" opacity="0.9" />
    <path d="M94 50 Q118 78 94 106" stroke={accent} strokeWidth="1.4" fill="none" opacity="0.55" />
    <path d="M104 40 Q136 78 104 116" stroke={accent} strokeWidth="1.4" fill="none" opacity="0.3" />
    {/* splats landing on the room */}
    <g fill={accent}>
      <circle cx="146" cy="46" r="2.2" opacity="0.9" /><circle cx="160" cy="58" r="1.7" opacity="0.6" />
      <circle cx="142" cy="70" r="1.9" opacity="0.75" /><circle cx="172" cy="48" r="1.4" opacity="0.45" />
      <circle cx="156" cy="84" r="2" opacity="0.65" /><circle cx="176" cy="72" r="1.5" opacity="0.5" />
      <circle cx="148" cy="100" r="1.6" opacity="0.45" /><circle cx="184" cy="92" r="1.8" opacity="0.55" />
      <circle cx="168" cy="106" r="1.3" opacity="0.35" /><circle cx="188" cy="110" r="1.2" opacity="0.3" />
    </g>
  </svg>
);

const ExportIllo = ({ ink = '#1C1B3A', accent = '#C65A1A', soft = '#AEB4C2' }) => (
  <svg viewBox="0 0 220 150" className="gm-illo" aria-hidden="true">
    {/* share sheet */}
    <rect x="30" y="34" width="70" height="88" rx="10" stroke={ink} strokeWidth="1.6" fill="none" />
    <path d="M65 52 L65 84 M65 52 L56 62 M65 52 L74 62" stroke={accent} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="44" y1="98" x2="86" y2="98" stroke={soft} strokeWidth="1.4" strokeLinecap="round" />
    <line x1="44" y1="108" x2="74" y2="108" stroke={soft} strokeWidth="1.4" strokeLinecap="round" />
    {/* arrow */}
    <path d="M112 78 L142 78 M142 78 L134 70 M142 78 L134 86" stroke={ink} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    {/* file pill */}
    <rect x="152" y="62" width="52" height="32" rx="16" fill="#FBEFE9" />
    <text x="178" y="83" textAnchor="middle" fontSize="13" fontWeight="700" fill={accent} fontFamily="Inter, system-ui, sans-serif">SPZ</text>
  </svg>
);

const DropIllo = ({ ink = '#1C1B3A', accent = '#C65A1A', soft = '#AEB4C2' }) => (
  <svg viewBox="0 0 220 150" className="gm-illo" aria-hidden="true">
    {/* dropzone */}
    <rect x="36" y="66" width="148" height="58" rx="12" stroke={soft} strokeWidth="1.5" strokeDasharray="5 5" fill="none" />
    {/* file card dropping */}
    <rect x="88" y="18" width="44" height="30" rx="7" stroke={ink} strokeWidth="1.6" fill="none" />
    <path d="M110 54 L110 76 M110 76 L103 68 M110 76 L117 68" stroke={accent} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    {/* pin */}
    <path d="M110 118 C110 118 96 104 96 95 A14 14 0 1 1 124 95 C124 104 110 118 110 118 Z" fill={accent} opacity="0.95" />
    <circle cx="110" cy="94" r="4.5" fill="#fff" />
  </svg>
);

const RoomDots = () => (
  <svg viewBox="0 0 900 380" className="gm-hero-dots" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <g fill="#C65A1A">
      {Array.from({ length: 130 }).map((_, i) => {
        // deterministic pseudo-random scatter forming a loose floor + walls
        const a = (i * 137.508) % 360;
        const r = 30 + ((i * 89) % 310);
        const x = 450 + r * Math.cos((a * Math.PI) / 180) * 1.35;
        const y = 200 + r * Math.sin((a * Math.PI) / 180) * 0.52;
        const size = 0.8 + ((i * 31) % 22) / 10;
        const op = 0.12 + ((i * 53) % 60) / 100;
        return <circle key={i} cx={x} cy={y} r={size} opacity={Math.min(op, 0.85)} />;
      })}
    </g>
    <g fill="#8FA0C6">
      {Array.from({ length: 60 }).map((_, i) => {
        const a = (i * 222.5) % 360;
        const r = 60 + ((i * 71) % 300);
        const x = 450 + r * Math.cos((a * Math.PI) / 180) * 1.4;
        const y = 200 + r * Math.sin((a * Math.PI) / 180) * 0.5;
        return <circle key={i} cx={x} cy={y} r={0.7 + ((i * 13) % 14) / 10} opacity={0.08 + ((i * 41) % 40) / 100} />;
      })}
    </g>
  </svg>
);

/* ── Shared page chrome ─────────────────────────────────────────────────── */

const Shell = ({ children, navigate }) => (
  <>
    <Header />
    <div className="editorial-page pv-dashboard vm-page vmm-page" style={{ '--vm-stage': VM_STAGE }}>
      <div className="vm-shell">
        <button className="vmm-back" onClick={() => navigate('/vessel/map/manage')}>← Manage scans</button>
        {children}
      </div>
    </div>
  </>
);

const H1 = () => (
  <div className="vm-headblock">
    <h1 className="editorial-greeting">
      THE SCAN<span className="period">,</span> <em>captured in three steps</em><span className="period">.</span>
    </h1>
  </div>
);

/* ── V1 · Triptych — three illustration-forward cards ───────────────────── */

const V1 = ({ navigate }) => (
  <>
    <H1 />
    <div className="gm1-grid">
      <div className="gm1-card gm1-navy">
        <ScanIllo ink="#EDEFF8" accent="#E8813F" soft="#5C6285" />
        <h2>Scan the room</h2>
        <p>Slowly, with a free phone app — Scaniverse or Polycam. Lights on, blinds drawn.</p>
      </div>
      <div className="gm1-card gm1-paper">
        <ExportIllo />
        <h2>Export the scan</h2>
        <p>Scaniverse: Share → Export Model → <strong>SPZ</strong>.<br />Polycam: Export → Gaussian Splat → <strong>PLY</strong>.</p>
      </div>
      <div className="gm1-card gm1-tint">
        <DropIllo />
        <h2>Drop it in</h2>
        <p>Name it, stand it upright — it's on the map.</p>
        <button className="vm-btn-primary gm1-cta" onClick={() => navigate('/vessel/map/manage')}>Upload your scan</button>
      </div>
    </div>
    <p className="gm-footnote">Big file? SPZ exports are much smaller than PLY.</p>
  </>
);

/* ── V2 · Cinematic — dark hero from the product's own material ─────────── */

const V2 = ({ navigate }) => (
  <>
    <div className="gm2-hero">
      <RoomDots />
      <div className="gm2-hero-text">
        <h1>Ten minutes.<br />One phone.<br />The whole room.</h1>
        <p>Any crew member can put a space on the vessel map.</p>
      </div>
    </div>
    <div className="gm2-strip">
      <div className="gm2-step">
        <span className="gm2-n">1</span>
        <div>
          <h2>Scan the room</h2>
          <p>Slowly, with Scaniverse or Polycam. Lights on, blinds drawn.</p>
        </div>
      </div>
      <div className="gm2-step">
        <span className="gm2-n">2</span>
        <div>
          <h2>Export the scan</h2>
          <p>Scaniverse: Share → Export Model → <strong>SPZ</strong>. Polycam: → <strong>PLY</strong>.</p>
        </div>
      </div>
      <div className="gm2-step">
        <span className="gm2-n">3</span>
        <div>
          <h2>Drop it in</h2>
          <p>Name it, stand it upright — it's on the map.</p>
        </div>
      </div>
    </div>
    <div className="gm2-foot">
      <p className="gm-footnote gm2-footnote">Big file? SPZ exports are much smaller than PLY.</p>
      <button className="vm-btn-primary" onClick={() => navigate('/vessel/map/manage')}>Upload your scan</button>
    </div>
  </>
);

/* ── V3 · Walkthrough — step list + large stage panel ───────────────────── */

const V3_STEPS = [
  {
    title: 'Scan the room',
    line: 'A free phone app does the capture.',
    body: 'Move slowly around the space with Scaniverse or Polycam. Lights on, blinds drawn — reflections and glare are the enemy.',
    Illo: ScanIllo,
  },
  {
    title: 'Export the scan',
    line: 'One tap in either app.',
    body: null,
    Illo: ExportIllo,
  },
  {
    title: 'Drop it in',
    line: 'Name it, stand it upright.',
    body: 'Drop the file on Manage scans, give it a name the crew will recognise, and stand the room upright. It’s on the map.',
    Illo: DropIllo,
  },
];

const V3 = ({ navigate }) => {
  const [active, setActive] = useState(0);
  const step = V3_STEPS[active];
  return (
    <>
      <H1 />
      <div className="gm3-grid">
        <div className="gm3-list" role="tablist" aria-label="Capture steps">
          {V3_STEPS.map((s, i) => (
            <button
              key={s.title}
              role="tab"
              aria-selected={i === active}
              className={`gm3-item${i === active ? ' gm3-active' : ''}`}
              onClick={() => setActive(i)}
            >
              <span className="gm3-n">{i + 1}</span>
              <span className="gm3-item-text">
                <span className="gm3-item-title">{s.title}</span>
                <span className="gm3-item-line">{s.line}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="gm3-stage">
          <div className="gm3-stage-illo"><step.Illo /></div>
          <h2>{step.title}</h2>
          {active === 1 ? (
            <div className="gm3-routes">
              <span className="gm3-app">Scaniverse</span>
              <span className="gm3-route">Share → Export Model → <strong>SPZ</strong></span>
              <span className="gm3-app">Polycam</span>
              <span className="gm3-route">Export → Gaussian Splat → <strong>PLY</strong></span>
            </div>
          ) : (
            <p>{step.body}</p>
          )}
          {active === 2 && (
            <button className="vm-btn-primary gm3-cta" onClick={() => navigate('/vessel/map/manage')}>Upload your scan</button>
          )}
        </div>
      </div>
      <p className="gm-footnote">Big file? SPZ exports are much smaller than PLY.</p>
    </>
  );
};

/* ── V4 · Magazine — oversized numerals, asymmetric rhythm, pull-quote ──── */

const V4 = ({ navigate }) => (
  <>
    <H1 />
    <div className="gm4-flow">
      <section className="gm4-row">
        <span className="gm4-giant">1</span>
        <div className="gm4-block">
          <h2>Scan the room</h2>
          <p>Slowly, with a free phone app — <strong>Scaniverse</strong> or <strong>Polycam</strong>. Lights on, blinds drawn.</p>
        </div>
        <div className="gm4-art"><ScanIllo /></div>
      </section>
      <section className="gm4-row gm4-rev">
        <span className="gm4-giant">2</span>
        <div className="gm4-block">
          <h2>Export the scan</h2>
          <p>Scaniverse: Share → Export Model → <strong>SPZ</strong>.<br />Polycam: Export → Gaussian Splat → <strong>PLY</strong>.</p>
        </div>
        <div className="gm4-art"><ExportIllo /></div>
      </section>
      <p className="gm4-quote"><em>SPZ exports are a tenth the size of PLY — the kind route for marina wifi.</em></p>
      <section className="gm4-row">
        <span className="gm4-giant">3</span>
        <div className="gm4-block">
          <h2>Drop it in</h2>
          <p>Name it, stand it upright — it's on the map.</p>
          <button className="vm-btn-primary gm4-cta" onClick={() => navigate('/vessel/map/manage')}>Upload your scan</button>
        </div>
        <div className="gm4-art"><DropIllo /></div>
      </section>
    </div>
  </>
);

/* ── Router ─────────────────────────────────────────────────────────────── */

export default function GuideMocks() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const v = params.get('v') || '1';
  const V = { 1: V1, 2: V2, 3: V3, 4: V4 }[v] || V1;
  return (
    <Shell navigate={navigate}>
      <div className={`gm-root gm-v${v}`}>
        <V navigate={navigate} />
      </div>
    </Shell>
  );
}
