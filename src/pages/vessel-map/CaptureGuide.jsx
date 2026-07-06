// The capture guide — a proper document on the manage-scans shell, not a
// panel. Everything sits on one grid: a fixed numeral column, one content
// column, hairline rules between sections. No drawer, no overlay.
import React from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import '../../styles/editorial.css';
import '../../styles/editorial-tokens.css';
import './vessel-map.css';
import './manage-scans.css';

const VM_STAGE = '#22253F';

export default function CaptureGuide() {
  const navigate = useNavigate();

  return (
    <>
      <Header />
      <div className="editorial-page pv-dashboard vm-page vmm-page" style={{ '--vm-stage': VM_STAGE }}>
        <div className="vm-shell">
          <button className="vmm-back" onClick={() => navigate('/vessel/map/manage')}>← Manage scans</button>

          <div className="vm-headblock">
            <p className="editorial-meta">
              <span className="dot">●</span>
              <span>Vessel Map</span>
              <span className="bar" />
              <span className="muted">Manage scans</span>
              <span className="bar" />
              <span className="muted">Capture guide</span>
            </p>
            <h1 className="editorial-greeting">
              THE SCAN<span className="period">,</span> <em>captured in three steps</em><span className="period">.</span>
            </h1>
          </div>

          <ol className="vmg-steps">
            <li className="vmg-step">
              <span className="vmg-num">1</span>
              <div className="vmg-body">
                <h2 className="vmg-title">Scan the room</h2>
                <p className="vmg-copy">
                  Slowly, with a free phone app — <strong>Scaniverse</strong> or <strong>Polycam</strong>.
                  Lights on, blinds drawn.
                </p>
              </div>
            </li>
            <li className="vmg-step">
              <span className="vmg-num">2</span>
              <div className="vmg-body">
                <h2 className="vmg-title">Export the scan</h2>
                <div className="vmg-routes">
                  <span className="vmg-app">Scaniverse</span>
                  <span className="vmg-route">Share → Export Model → <strong>SPZ</strong></span>
                  <span className="vmg-app">Polycam</span>
                  <span className="vmg-route">Export → Gaussian Splat → <strong>PLY</strong></span>
                </div>
              </div>
            </li>
            <li className="vmg-step">
              <span className="vmg-num">3</span>
              <div className="vmg-body">
                <h2 className="vmg-title">Drop it in</h2>
                <p className="vmg-copy">
                  Back on Manage scans: drop the file, name it, stand it upright — it's on the map.
                </p>
                <button className="vm-btn-primary vmg-cta" onClick={() => navigate('/vessel/map/manage')}>
                  Upload your scan
                </button>
              </div>
            </li>
          </ol>

          <p className="vmg-footnote">Big file? SPZ exports are much smaller than PLY.</p>
        </div>
      </div>
    </>
  );
}
