// TEMPORARY design exploration — four scan-library directions behind
// /vessel/map/manage/lib-mocks?v=1..4. Fake fleet data + generated posters
// so the compositions read at realistic density. Deleted once a direction
// is chosen and built properly.
import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import '../../styles/editorial.css';
import '../../styles/editorial-tokens.css';
import './vessel-map.css';
import './manage-scans.css';
import './lib-mocks.css';

const VM_STAGE = '#22253F';

// Fake fleet — realistic density: four decks, six rooms.
const FLEET = [
  { deck: 'Sun deck', rooms: [
    { id: 'a', name: 'Sun deck bar', size: '18.2MB', format: 'SPZ', pins: 4, added: '02/07/2026', hue: 226, warm: true },
    { id: 'b', name: 'Jacuzzi forward', size: '11.9MB', format: 'SPZ', pins: 1, added: '02/07/2026', hue: 234, warm: false },
  ] },
  { deck: 'Bridge deck', rooms: [
    { id: 'c', name: 'Wheelhouse', size: '24.5MB', format: 'SPZ', pins: 7, added: '28/06/2026', hue: 240, warm: true },
  ] },
  { deck: 'Main deck', rooms: [
    { id: 'd', name: 'Main Galley', size: '47.6MB', format: 'PLY', pins: 12, added: '03/07/2026', hue: 222, warm: true },
    { id: 'e', name: "Owner's salon", size: '31.0MB', format: 'SPZ', pins: 3, added: '30/06/2026', hue: 230, warm: false },
  ] },
  { deck: 'Lower deck', rooms: [
    { id: 'f', name: 'Crew mess', size: '15.4MB', format: 'SPZ', pins: 5, added: '01/07/2026', hue: 236, warm: true },
  ] },
];
const ROOMS = FLEET.flatMap((d) => d.rooms.map((r) => ({ ...r, deck: d.deck })));

// Generated poster stand-in: a moody room-ish gradient + splat dots, so the
// compositions can be judged at real visual weight without real captures.
const Poster = ({ room, className = '' }) => (
  <div
    className={`lm-poster ${className}`}
    style={{
      background: `linear-gradient(${room.warm ? 160 : 205}deg,
        hsl(${room.hue} 26% 38%) 0%,
        hsl(${room.hue} 28% 26%) 46%,
        hsl(${room.warm ? 24 : room.hue} ${room.warm ? 42 : 26}% ${room.warm ? 32 : 19}%) 100%)`,
    }}
  >
    <svg viewBox="0 0 200 125" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g fill="#E8813F">
        {Array.from({ length: 26 }).map((_, i) => {
          const x = ((i * 73 + room.id.charCodeAt(0) * 31) % 190) + 5;
          const y = ((i * 47 + room.id.charCodeAt(0) * 17) % 115) + 5;
          return <circle key={i} cx={x} cy={y} r={0.7 + ((i * 13) % 16) / 10} opacity={0.12 + ((i * 29) % 45) / 100} />;
        })}
      </g>
      <g fill="#AEB4C2">
        {Array.from({ length: 14 }).map((_, i) => {
          const x = ((i * 113 + room.id.charCodeAt(0) * 53) % 190) + 5;
          const y = ((i * 67 + room.id.charCodeAt(0) * 29) % 115) + 5;
          return <circle key={i} cx={x} cy={y} r={0.6 + ((i * 11) % 10) / 10} opacity={0.1 + ((i * 37) % 30) / 100} />;
        })}
      </g>
    </svg>
  </div>
);

const Shell = ({ children, navigate }) => (
  <>
    <Header />
    <div className="editorial-page pv-dashboard vm-page vmm-page" style={{ '--vm-stage': VM_STAGE }}>
      <div className="vm-shell">
        <button className="vmm-back" onClick={() => navigate('/vessel/map/manage')}>← Manage scans</button>
        <div className="vm-headblock">
          <h1 className="editorial-greeting">
            THE SCANS<span className="period">,</span> <em>kept shipshape</em><span className="period">.</span>
          </h1>
        </div>
        <p className="lm-note">Library mock — upload cards unchanged above, omitted here for focus.</p>
        {children}
      </div>
    </div>
  </>
);

/* ── V1 · Cinematic shelf — colour variants via ?c= :
      a paper band · b no band (straight on the page) · c blush band ·
      d dusk band (lighter slate, text stays on the posters) ─────────────── */

const V1_LIGHT = { a: 'lm1-paper', b: 'lm1-bare', c: 'lm1-blush' };

const V1 = ({ scheme = 'd' }) => {
  const light = scheme in V1_LIGHT;
  return (
    <section className={`lm1-band ${light ? V1_LIGHT[scheme] : 'lm1-dusk'}`}>
      <p className="lm1-count">Scans aboard · {ROOMS.length}</p>
      {FLEET.map((d) => (
        <div key={d.deck} className="lm1-shelf">
          <p className="lm1-deck">{d.deck.toUpperCase()} · {d.rooms.length}</p>
          <div className="lm1-row">
            {d.rooms.map((r) => (
              <button key={r.id} className="lm1-tile">
                <span className="lm1-frame">
                  <Poster room={r} />
                  {!light && <span className="lm1-scrim" />}
                  {!light && (
                    <span className="lm1-text">
                      <span className="lm1-name">{r.name}</span>
                      <span className="lm1-meta">{r.size} · {r.format} · {r.pins} pins</span>
                    </span>
                  )}
                </span>
                {light && (
                  <span className="lm1-below">
                    <span className="lm1-name-ink">{r.name}</span>
                    <span className="lm1-meta-ink">{r.size} · {r.format} · {r.pins} pins</span>
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
};

/* ── V2 · The ledger — serif deck headings, aligned columns, hover actions ─ */

const V2 = () => (
  <section className="lm2">
    {FLEET.map((d) => (
      <div key={d.deck} className="lm2-section">
        <div className="lm2-deckline">
          <h3 className="lm2-deck">{d.deck}</h3>
          <span className="lm2-deckcount">{d.rooms.length} scan{d.rooms.length === 1 ? '' : 's'}</span>
        </div>
        <div className="lm2-cols vml-label">
          <span>Room</span><span>Size</span><span>Format</span><span>Pins</span><span>Added</span><span />
        </div>
        {d.rooms.map((r) => (
          <div key={r.id} className="lm2-row">
            <div className="lm2-room">
              <Poster room={r} className="lm2-poster" />
              <span className="lm2-name">{r.name}</span>
            </div>
            <span className="lm2-cell">{r.size}</span>
            <span className="lm2-cell">{r.format}</span>
            <span className="lm2-cell">{r.pins}</span>
            <span className="lm2-cell">{r.added}</span>
            <span className="lm2-actions">
              <button className="vmc-action">Edit</button>
              <button className="vmc-action">Replace</button>
              <button className="vmc-action vmc-action-danger">Delete</button>
            </span>
          </div>
        ))}
      </div>
    ))}
  </section>
);

/* ── V3 · Postcards — mat-framed prints with serif captions ──────────────── */

const V3 = () => (
  <section className="lm3">
    {FLEET.map((d) => (
      <div key={d.deck}>
        <div className="vml-deck-head"><span className="vml-label">{d.deck.toUpperCase()} · {d.rooms.length}</span></div>
        <div className="lm3-wall">
          {d.rooms.map((r, i) => (
            <button key={r.id} className={`lm3-card${i % 2 ? ' lm3-tilt-r' : ' lm3-tilt-l'}`}>
              <Poster room={r} className="lm3-print" />
              <span className="lm3-caption">{r.name}</span>
              <span className="lm3-sub">{r.pins} pins · {r.added}</span>
            </button>
          ))}
        </div>
      </div>
    ))}
  </section>
);

/* ── V4 · Split view — room index left, living preview right ─────────────── */

const V4 = () => {
  const [activeId, setActiveId] = useState(ROOMS[0].id);
  const active = ROOMS.find((r) => r.id === activeId);
  return (
    <section className="lm4">
      <div className="lm4-list">
        {FLEET.map((d) => (
          <div key={d.deck}>
            <p className="vml-label lm4-deck">{d.deck.toUpperCase()}</p>
            {d.rooms.map((r) => (
              <button
                key={r.id}
                className={`lm4-item${r.id === activeId ? ' lm4-active' : ''}`}
                onClick={() => setActiveId(r.id)}
              >
                <span className="lm4-item-name">{r.name}</span>
                <span className="lm4-item-meta">{r.pins} pins · {r.format}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="lm4-stage">
        <Poster room={active} className="lm4-poster" />
        <div className="lm4-overlay">
          <div>
            <h3 className="lm4-name">{active.name}</h3>
            <p className="lm4-meta">{active.deck} · {active.size} · {active.format} · {active.pins} pins · added {active.added}</p>
          </div>
          <div className="lm4-actions">
            <button className="vm-btn-primary vmm-btn-sm">View on map</button>
            <button className="lm4-ghost">Edit</button>
            <button className="lm4-ghost">Replace file</button>
            <button className="lm4-ghost lm4-ghost-danger">Delete</button>
          </div>
        </div>
      </div>
    </section>
  );
};

/* ── V5 · Coverflow — the fleet as a scrollable carousel: centre room
      prominent, neighbours collapsed behind with perspective ─────────────── */

const V5 = () => {
  const [idx, setIdx] = useState(2);
  const go = (next) => setIdx(Math.max(0, Math.min(ROOMS.length - 1, next)));
  const active = ROOMS[idx];
  const wheelLock = React.useRef(0);
  const onWheel = (e) => {
    const now = performance.now();
    if (now - wheelLock.current < 320) return; // one step per gesture beat
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(d) < 8) return;
    wheelLock.current = now;
    go(idx + (d > 0 ? 1 : -1));
  };
  return (
    <section className="lm5" onWheel={onWheel}>
      <div className="lm5-stage" role="listbox" aria-label="Scans aboard">
        {ROOMS.map((r, i) => {
          const o = i - idx;
          if (Math.abs(o) > 3) return null;
          return (
            <button
              key={r.id}
              role="option"
              aria-selected={o === 0}
              className={`lm5-card${o === 0 ? ' lm5-centre' : ''}`}
              style={{
                transform: `translateX(${o * 215}px) translateZ(${-Math.abs(o) * 170}px) rotateY(${o === 0 ? 0 : o > 0 ? -26 : 26}deg)`,
                zIndex: 100 - Math.abs(o),
                opacity: Math.abs(o) === 3 ? 0.25 : 1,
              }}
              onClick={() => go(i)}
              tabIndex={o === 0 ? 0 : -1}
            >
              <Poster room={r} className="lm5-poster" />
              <span className="lm5-deck-chip">{r.deck}</span>
              {o === 0 && <span className="lm5-shine" />}
            </button>
          );
        })}
        <button className="lm5-arrow lm5-prev" onClick={() => go(idx - 1)} disabled={idx === 0} aria-label="Previous scan">‹</button>
        <button className="lm5-arrow lm5-next" onClick={() => go(idx + 1)} disabled={idx === ROOMS.length - 1} aria-label="Next scan">›</button>
      </div>
      <div className="lm5-caption">
        <h3 className="lm5-name">{active.name}</h3>
        <p className="lm5-meta">{active.deck} · {active.size} · {active.format} · {active.pins} pins · added {active.added}</p>
        <div className="lm5-actions">
          <button className="vm-btn-primary vmm-btn-sm">View on map</button>
          <button className="vmc-action">Edit</button>
          <button className="vmc-action">Replace file</button>
          <button className="vmc-action vmc-action-danger">Delete</button>
        </div>
      </div>
      <div className="lm5-dots" aria-hidden="true">
        {ROOMS.map((r, i) => (
          <button key={r.id} className={`lm5-dot${i === idx ? ' lm5-dot-on' : ''}`} onClick={() => go(i)} />
        ))}
      </div>
    </section>
  );
};

export default function LibMocks() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const v = params.get('v') || '1';
  const scheme = params.get('c') || 'd';
  const V = { 1: V1, 2: V2, 3: V3, 4: V4, 5: V5 }[v] || V1;
  return (
    <Shell navigate={navigate}>
      <div className={`lm-root lm-v${v}`}>
        <V scheme={scheme} />
      </div>
    </Shell>
  );
}
