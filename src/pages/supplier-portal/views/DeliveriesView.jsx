import React from 'react';
import { Route, Printer, Truck, ChevronRight, MapPin, MessageSquare } from 'lucide-react';
import { DELIVERIES } from '../data';

const DeliveriesView = () => (
  <div className="sp-page">
    <div className="sp-page-head">
      <div>
        <div className="sp-eyebrow"><span className="sp-dot" />Week 17 · Mon 20 – Sun 26 Apr</div>
        <h1 className="sp-page-title">This week's <em>deliveries</em></h1>
        <p className="sp-page-sub">7 deliveries this week. Two 6 am starts — Quai des Milliardaires Thursday, Port Vauban Friday.</p>
      </div>
      <div className="sp-actions">
        <button className="sp-pill ghost"><Route size={13} />Optimise route</button>
        <button className="sp-pill"><Printer size={13} />Print pick lists</button>
        <button className="sp-pill primary"><Truck size={13} />Schedule delivery</button>
      </div>
    </div>

    <div className="sp-del-board">
      <div>
        {DELIVERIES.map((d, di) => (
          <div key={di} className="sp-del-day">
            <h3>{d.day} <span>{d.sub}</span></h3>
            {d.slots.map((s, si) => {
              const short = s.yacht.split(' ').pop().slice(0, 3).toUpperCase();
              return (
                <div key={si} className="sp-del-slot">
                  <div className="sp-del-tm">{s.time}<span>{s.window}</span></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                    <div className={`sp-ym ${s.color}`} style={{ width: 34, height: 34, borderRadius: 9, fontSize: 11 }}>{short}</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{s.yacht}</div>
                      <div className="sp-del-loc" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <MapPin size={11} />{s.loc}
                      </div>
                    </div>
                  </div>
                  <button className="sp-rb"><ChevronRight size={14} /></button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="sp-card">
          <h4>This week</h4>
          <div className="sp-kv-list">
            {[
              ['Deliveries scheduled', '7'],
              ['Estimated distance',   '184 km'],
              ['Earliest start',       'Thu · 05:30'],
              ['Fleet',                '2 vans · 1 driver'],
            ].map(([k, v]) => (
              <div key={k} className="sp-kv"><span className="k">{k}</span><span className="v">{v}</span></div>
            ))}
          </div>
        </div>

        <div className="sp-card">
          <h4>Drivers</h4>
          {[
            { init: 'JP', name: 'Jean-Paul', role: 'On duty · 4 runs today' },
            { init: 'SF', name: 'Soufiane',  role: 'Off today · back Tue' },
          ].map(d => (
            <div key={d.init} className="sp-contact-row">
              <div className="sp-cav">{d.init}</div>
              <div><div className="sp-cn">{d.name}</div><div className="sp-cr">{d.role}</div></div>
              <button className="sp-cb"><MessageSquare size={12} /></button>
            </div>
          ))}
        </div>
      </aside>
    </div>
  </div>
);

export default DeliveriesView;
