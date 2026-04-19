import React from 'react';
import { Users, Plus, User } from 'lucide-react';
import { CLIENTS } from '../data';

const ClientsView = () => (
  <div className="sp-page">
    <div className="sp-page-head">
      <div>
        <div className="sp-eyebrow">16 active yachts · 4 this week</div>
        <h1 className="sp-page-title">Yacht <em>clients</em></h1>
        <p className="sp-page-sub">Your accounts, ordered by activity. Preferences, standing orders and contacts live inside each.</p>
      </div>
      <div className="sp-actions">
        <button className="sp-pill ghost"><Users size={13} />Invite contact</button>
        <button className="sp-pill primary"><Plus size={13} />New client</button>
      </div>
    </div>

    <div className="sp-clients">
      {CLIENTS.map(c => (
        <div key={c.name} className="sp-cc">
          <div className="sp-cc-head">
            <div className={`sp-ym ${c.color}`} style={{ width: 40, height: 40, borderRadius: 11, fontSize: 12 }}>{c.short}</div>
            <div>
              <h3>{c.name}</h3>
              <div className="sub">{c.flag}</div>
            </div>
          </div>
          <div className="sp-cc-stats">
            <div><div className="v">{c.orders}</div><div className="l">Orders</div></div>
            <div><div className="v">{c.ytd}</div><div className="l">YTD</div></div>
            <div><div className="v">{c.repeat}</div><div className="l">Repeat</div></div>
          </div>
          <div className="sp-cc-foot"><User size={12} />{c.contact}</div>
        </div>
      ))}
    </div>
  </div>
);

export default ClientsView;
