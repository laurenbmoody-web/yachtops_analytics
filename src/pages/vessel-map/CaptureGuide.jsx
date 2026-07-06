// The capture guide — three illustration-forward cards on the manage shell.
// Colour arc runs tint → paper → navy: warm start, ink finish, with the
// terracotta CTA landing on the dark closing card (the map's own stage ink).
import React from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import '../../styles/editorial.css';
import '../../styles/editorial-tokens.css';
import './vessel-map.css';
import './manage-scans.css';
import './capture-guide.css';

const VM_STAGE = '#22253F';

/* Drawn artwork — 1.5px strokes, ink + terracotta. One drawing per step. */

const ScanIllo = () => (
  <svg viewBox="0 0 220 150" className="cg-illo" aria-hidden="true">
    <path d="M130 18 L205 40 M130 18 L130 96 M130 96 L205 122 M205 40 L205 122" stroke="#AEB4C2" strokeWidth="1.2" fill="none" opacity="0.55" />
    <rect x="28" y="38" width="44" height="80" rx="9" stroke="#1C1B3A" strokeWidth="1.6" fill="none" />
    <line x1="42" y1="47" x2="58" y2="47" stroke="#1C1B3A" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M84 60 Q100 78 84 96" stroke="#C65A1A" strokeWidth="1.4" fill="none" opacity="0.9" />
    <path d="M94 50 Q118 78 94 106" stroke="#C65A1A" strokeWidth="1.4" fill="none" opacity="0.55" />
    <path d="M104 40 Q136 78 104 116" stroke="#C65A1A" strokeWidth="1.4" fill="none" opacity="0.3" />
    <g fill="#C65A1A">
      <circle cx="146" cy="46" r="2.2" opacity="0.9" /><circle cx="160" cy="58" r="1.7" opacity="0.6" />
      <circle cx="142" cy="70" r="1.9" opacity="0.75" /><circle cx="172" cy="48" r="1.4" opacity="0.45" />
      <circle cx="156" cy="84" r="2" opacity="0.65" /><circle cx="176" cy="72" r="1.5" opacity="0.5" />
      <circle cx="148" cy="100" r="1.6" opacity="0.45" /><circle cx="184" cy="92" r="1.8" opacity="0.55" />
      <circle cx="168" cy="106" r="1.3" opacity="0.35" /><circle cx="188" cy="110" r="1.2" opacity="0.3" />
    </g>
  </svg>
);

const ExportIllo = () => (
  <svg viewBox="0 0 220 150" className="cg-illo" aria-hidden="true">
    <rect x="30" y="34" width="70" height="88" rx="10" stroke="#1C1B3A" strokeWidth="1.6" fill="none" />
    <path d="M65 52 L65 84 M65 52 L56 62 M65 52 L74 62" stroke="#C65A1A" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="44" y1="98" x2="86" y2="98" stroke="#AEB4C2" strokeWidth="1.4" strokeLinecap="round" />
    <line x1="44" y1="108" x2="74" y2="108" stroke="#AEB4C2" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M112 78 L142 78 M142 78 L134 70 M142 78 L134 86" stroke="#1C1B3A" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="152" y="62" width="52" height="32" rx="16" fill="#FBEFE9" />
    <text x="178" y="83" textAnchor="middle" fontSize="13" fontWeight="700" fill="#C65A1A" fontFamily="Inter, system-ui, sans-serif">SPZ</text>
  </svg>
);

const DropIllo = () => (
  <svg viewBox="0 0 220 150" className="cg-illo" aria-hidden="true">
    <rect x="36" y="66" width="148" height="58" rx="12" stroke="#5C6285" strokeWidth="1.5" strokeDasharray="5 5" fill="none" />
    <rect x="88" y="18" width="44" height="30" rx="7" stroke="#EDEFF8" strokeWidth="1.6" fill="none" />
    <path d="M110 54 L110 76 M110 76 L103 68 M110 76 L117 68" stroke="#E8813F" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M110 118 C110 118 96 104 96 95 A14 14 0 1 1 124 95 C124 104 110 118 110 118 Z" fill="#E8813F" opacity="0.95" />
    <circle cx="110" cy="94" r="4.5" fill="#fff" />
  </svg>
);

export default function CaptureGuide() {
  const navigate = useNavigate();

  return (
    <>
      <Header />
      <div className="editorial-page pv-dashboard vm-page vmm-page" style={{ '--vm-stage': VM_STAGE }}>
        <div className="vm-shell">
          <button className="vmm-back" onClick={() => navigate('/vessel/map/manage')}>← Manage scans</button>

          <div className="vm-headblock">
            <h1 className="editorial-greeting">
              THE SCAN<span className="period">,</span> <em>captured in three steps</em><span className="period">.</span>
            </h1>
          </div>

          <div className="cg-grid">
            <div className="cg-card cg-tint">
              <div className="cg-art"><ScanIllo /></div>
              <h2>Scan the room</h2>
              <p>Slowly, with a free phone app — Scaniverse or Polycam. Lights on, blinds drawn.</p>
            </div>
            <div className="cg-card cg-paper">
              <div className="cg-art"><ExportIllo /></div>
              <h2>Export the scan</h2>
              <p>Scaniverse: Share → Export Model → <strong>SPZ</strong>.<br />Polycam: Export → Gaussian Splat → <strong>PLY</strong>.</p>
            </div>
            <div className="cg-card cg-navy">
              <div className="cg-art"><DropIllo /></div>
              <h2>Drop it in</h2>
              <p>Name it, stand it upright — it's on the map.</p>
              <button className="vm-btn-primary cg-cta" onClick={() => navigate('/vessel/map/manage')}>
                Upload your scan
              </button>
            </div>
          </div>

          <p className="cg-footnote">Big file? SPZ exports are much smaller than PLY.</p>
        </div>
      </div>
    </>
  );
}
