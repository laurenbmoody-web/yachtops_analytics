// The vessel you're on, and the way to change it.
//
// Cargo resolved a tenant once at login and never offered a way back — fine for
// a crew member with one boat, useless for a management company with a dozen on
// the books, who would otherwise have to sign out and in again to look at the
// next one. It sits where the header's divider always implied a vessel name.
//
// Draws nothing at all for a single-vessel login: the name belongs in the header
// either way, but a chooser with one row on it is furniture.
import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Icon from '../AppIcon';
import { useTenant } from '../../contexts/TenantContext';
import {
  sortVessels, vesselName, vesselSub, canSwitchVessel, landingAfterSwitch,
} from '../../services/vesselSwitch';
import './vessel-switcher.css';

export default function VesselSwitcher() {
  const { memberships, activeTenantId, switchVessel } = useTenant();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [going, setGoing] = useState(null);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const rows = sortVessels(memberships, activeTenantId);
  const here = rows.find((m) => m.tenant_id === activeTenantId);
  const many = canSwitchVessel(rows);

  if (!rows.length) return null;

  // Static text when there's nowhere to go — same type, no affordance to click.
  if (!many) {
    return <p className="vs-solo" title={vesselName(here || rows[0])}>{vesselName(here || rows[0])}</p>;
  }

  const go = (tenantId) => {
    if (tenantId === activeTenantId) { setOpen(false); return; }
    setGoing(tenantId);
    switchVessel(tenantId, landingAfterSwitch(location?.pathname));
  };

  return (
    <div className="vs" ref={wrap}>
      <button type="button" className={`vs-trigger${open ? ' is-open' : ''}`}
        aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="vs-name">{here ? vesselName(here) : 'Choose a vessel'}</span>
        <Icon name="ChevronDown" size={14} />
      </button>

      {open && (
        <div className="vs-list" role="listbox" aria-label="Switch vessel">
          <p className="vs-head">Your vessels<span>{rows.length}</span></p>
          {rows.map((m) => {
            const on = m.tenant_id === activeTenantId;
            const sub = vesselSub(m);
            return (
              <button key={m.tenant_id} type="button" role="option" aria-selected={on}
                className={`vs-opt${on ? ' on' : ''}`} disabled={going != null}
                onClick={() => go(m.tenant_id)}>
                <span className="vs-opt-txt">
                  <b>{vesselName(m)}</b>
                  {sub && <em>{sub}</em>}
                </span>
                {on && <Icon name="Check" size={15} />}
                {going === m.tenant_id && <span className="vs-going">Switching…</span>}
              </button>
            );
          })}
          {/* Changing vessel re-enters the app, so a half-typed form would be
              lost without warning. Saying so costs one line. */}
          <p className="vs-foot">Switching reloads Cargo on the vessel you pick.</p>
        </div>
      )}
    </div>
  );
}
