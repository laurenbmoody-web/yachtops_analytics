import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import { showToast } from '../../../utils/toast';
import EditorialDatePicker from '../../../components/editorial/EditorialDatePicker';
import EditorialTimePicker from '../../../components/editorial/EditorialTimePicker';
import {
  fetchVesselForCrewList, fetchCrewListDetails, buildCrewRow, missingMandatory,
} from '../utils/crewListData';
import { exportCrewListPDF } from '../utils/crewListExport';
import { getMasterSignatureRow, loadImageForPdf } from '../utils/masterSignature';
import './create-crew-list-modal.css';

const initials = (n) => String(n || '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '—';

// Yacht rank order so the exported list reads Captain → Engineering → Deck →
// Interior → Galley → Other (mirrors the guest-book ordering).
const crewRank = (m) => {
  const s = `${m?.roleTitle || ''} ${m?.department || ''}`.toLowerCase();
  if (/\bcaptain\b|\bmaster\b|\bcapt\b/.test(s)) return 0;
  if (/chief eng|\bce\b|\bc\/e\b|first eng|second eng|2nd eng|3rd eng|third eng/.test(s)) return 1;
  if (/eng|eto|electro/.test(s)) return 2;
  if (/officer|\boow\b|\bmate\b|bosun/.test(s)) return 3;
  if (/deck/.test(s)) return 4;
  if (/chief stew|\bchstew\b|head of (service|interior)|purser/.test(s)) return 5;
  if (/stew|interior|housekeep|laundry|service|spa/.test(s)) return 6;
  if (/head chef|executive chef|exec chef/.test(s)) return 7;
  if (/chef|galley|cook|sous/.test(s)) return 8;
  return 9;
};

const todayDisplay = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

// Only the things that change per port call live in this modal — everything
// static (call sign, class, vessel identity) comes from Vessel Settings, the
// master is the on-duty captain, and their signature/stamp from their profile.
const CreateCrewListModal = ({ open, onClose, tenantId, crew = [] }) => {
  const [loading, setLoading] = useState(true);
  const [vessel, setVessel] = useState(null);
  const [detailsByUser, setDetailsByUser] = useState({});
  const [selected, setSelected] = useState(() => new Set());
  const [order, setOrder] = useState([]); // user_ids in document order (drag to reorder)
  const dragFrom = useRef(null);
  const [busy, setBusy] = useState(false);
  // Captain's saved signature/stamp (pulled from their profile), applied to the list.
  const [sigData, setSigData] = useState({ signature: null, stamp: null });
  const [voyage, setVoyage] = useState({
    portOfArrival: '', lastPort: '', nextPort: '',
    arrivalDate: '', arrivalTime: '', departureDate: '', departureTime: '',
  });
  const setV = (k, val) => setVoyage((p) => ({ ...p, [k]: val }));

  const ordered = useMemo(
    () => [...crew].sort((a, b) => crewRank(a) - crewRank(b) || String(a.fullName).localeCompare(String(b.fullName))),
    [crew],
  );
  // The on-duty master: the captain in the roster.
  const captain = useMemo(() => ordered.find((m) => crewRank(m) === 0) || null, [ordered]);
  const masterName = captain?.fullName || '';

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setSigData({ signature: null, stamp: null });
    setSelected(new Set(ordered.map((m) => m.user_id || m.id)));
    setOrder(ordered.map((m) => m.user_id || m.id)); // start in rank order
    (async () => {
      const ids = ordered.map((m) => m.user_id || m.id).filter(Boolean);
      const [v, det] = await Promise.all([
        fetchVesselForCrewList(tenantId),
        fetchCrewListDetails(tenantId, ids),
      ]);
      if (cancelled) return;
      setVessel(v || {});
      setDetailsByUser(det || {});

      // Pull the captain's signature + stamp from their profile (master_signatures).
      const capId = captain?.user_id || captain?.id;
      if (capId) {
        const row = await getMasterSignatureRow(capId);
        if (!cancelled && (row?.signature_path || row?.stamp_path)) {
          const [sData, tData] = await Promise.all([
            loadImageForPdf(row.signature_path, row.bucket), loadImageForPdf(row.stamp_path, row.bucket),
          ]);
          if (!cancelled) setSigData({ signature: sData, stamp: tData });
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, tenantId, ordered, captain]);

  const rowById = useMemo(() => {
    const map = {};
    ordered.forEach((m) => { const id = m.user_id || m.id; map[id] = { member: m, row: buildCrewRow(m, detailsByUser[id]) }; });
    return map;
  }, [ordered, detailsByUser]);
  // The list as displayed/exported — in drag order.
  const orderedList = useMemo(() => order.map((id) => rowById[id]).filter(Boolean), [order, rowById]);
  const selectedRows = useMemo(
    () => order.filter((id) => selected.has(id)).map((id) => rowById[id]?.row).filter(Boolean),
    [order, selected, rowById],
  );
  // Document row number (1..N) for each selected member, in drag order.
  const docNumById = useMemo(() => {
    const map = {}; let n = 0;
    order.forEach((id) => { if (selected.has(id)) { n += 1; map[id] = n; } });
    return map;
  }, [order, selected]);

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allOn = selected.size === ordered.length && ordered.length > 0;
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(ordered.map((m) => m.user_id || m.id)));

  const onDrop = (toPos) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from == null || from === toPos) return;
    setOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(toPos, 0, moved);
      return next;
    });
  };

  const totalMissing = useMemo(
    () => selectedRows.reduce((n, r) => n + (missingMandatory(r).length ? 1 : 0), 0),
    [selectedRows],
  );

  const handleExport = useCallback(async () => {
    if (!selectedRows.length || busy) return;
    setBusy(true);
    try {
      await exportCrewListPDF({
        template: 'editorial',
        vessel: vessel || {},
        callSign: vessel?.call_sign || '',
        classNotation: vessel?.class_notation || '',
        voyage,
        master: masterName,
        rows: selectedRows,
        generatedAt: todayDisplay(),
        signature: sigData.signature,
        stamp: sigData.stamp,
      });
      showToast('Crew list generated', 'success');
    } catch (err) {
      console.error('Crew list export failed:', err);
      showToast('Couldn’t generate the crew list', 'error');
    } finally {
      setBusy(false);
    }
  }, [selectedRows, busy, vessel, voyage, masterName, sigData]);

  if (!open) return null;

  return createPortal(
    <div className="ccl-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ccl-panel" role="dialog" aria-modal="true" aria-label="Create crew list">
        <div className="ccl-head">
          <div>
            <h2>Create crew list</h2>
          </div>
          <button type="button" className="ccl-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        {loading ? (
          <div className="ccl-loading"><LogoSpinner size={40} /><span>Gathering crew details…</span></div>
        ) : (
          <div className="ccl-body">
            {/* Voyage — the only per-call detail entered here */}
            <div className="ccl-section">
              <div className="ccl-grouphead"><span className="dia">◆</span><span className="t">Voyage</span><span className="line" /></div>
              <div className="ccl-grid3">
                <label className="ccl-field"><span className="ccl-label">Last port</span>
                  <input className="ccl-input" value={voyage.lastPort} onChange={(e) => setV('lastPort', e.target.value)} placeholder="Previous port" /></label>
                <label className="ccl-field"><span className="ccl-label">Port of arrival</span>
                  <input className="ccl-input" value={voyage.portOfArrival} onChange={(e) => setV('portOfArrival', e.target.value)} placeholder="e.g. Athens" /></label>
                <label className="ccl-field"><span className="ccl-label">Next port</span>
                  <input className="ccl-input" value={voyage.nextPort} onChange={(e) => setV('nextPort', e.target.value)} placeholder="Onward port" /></label>
                <div className="ccl-field"><span className="ccl-label">Arrival date</span>
                  <EditorialDatePicker value={voyage.arrivalDate} onChange={(iso) => setV('arrivalDate', iso || '')} placeholder="dd/mm/yyyy" /></div>
                <div className="ccl-field"><span className="ccl-label">Arrival time</span>
                  <EditorialTimePicker value={voyage.arrivalTime} onChange={(t) => setV('arrivalTime', t)} placeholder="HH:MM" /></div>
                <div className="ccl-field" />
                <div className="ccl-field"><span className="ccl-label">Departure date</span>
                  <EditorialDatePicker value={voyage.departureDate} onChange={(iso) => setV('departureDate', iso || '')} placeholder="dd/mm/yyyy" /></div>
                <div className="ccl-field"><span className="ccl-label">Departure time</span>
                  <EditorialTimePicker value={voyage.departureTime} onChange={(t) => setV('departureTime', t)} placeholder="HH:MM" /></div>
                <div className="ccl-field" />
              </div>
            </div>

            {/* Crew picker */}
            <div className="ccl-section">
              <div className="ccl-grouphead"><span className="dia">◆</span><span className="t">Crew on this list</span><span className="line" />
                <button type="button" className="ccl-allbtn" onClick={toggleAll}>{allOn ? 'Clear all' : 'Select all'}</button>
              </div>
              <p className="ccl-draghint">Drag to set the order they appear on the document. The number is their row.</p>
              {totalMissing > 0 && (
                <div className="ccl-warn"><Icon name="AlertTriangle" size={14} />
                  <span><b>{totalMissing}</b> selected {totalMissing === 1 ? 'member is' : 'members are'} missing mandatory details (passport, DOB…). They’ll show “—” on the list.</span></div>
              )}
              <div className="ccl-list">
                {orderedList.map(({ member, row }, pos) => {
                  const id = member.user_id || member.id;
                  const on = selected.has(id);
                  const miss = missingMandatory(row);
                  return (
                    <div
                      key={id}
                      className={`ccl-row${on ? ' on' : ''}`}
                      draggable
                      onDragStart={() => { dragFrom.current = pos; }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => onDrop(pos)}
                      onClick={() => toggle(id)}
                    >
                      <span className="ccl-grip" title="Drag to reorder"><Icon name="GripVertical" size={15} /></span>
                      <span className={`ccl-num${on ? '' : ' off'}`}>{on ? docNumById[id] : '—'}</span>
                      <span className={`ccl-check${on ? ' on' : ''}`}>{on && <Icon name="Check" size={12} />}</span>
                      <span className="ccl-av">{member.photo ? <img src={member.photo} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : initials(member.fullName)}</span>
                      <span className="ccl-who"><span className="ccl-name">{member.fullName}</span><span className="ccl-role">{row.rank || 'No role'}{member.status ? ` · ${member.status}` : ''}</span></span>
                      {miss.length > 0 && <span className="ccl-missing" title={`Missing: ${miss.join(', ')}`}>{miss.length} missing</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {!loading && (
          <div className="ccl-foot">
            <p className="ccl-foothint">
              <Icon name={(sigData.signature || sigData.stamp) ? 'CheckCircle2' : 'Info'} size={13} />
              {(sigData.signature || sigData.stamp)
                ? `Captain ${masterName}’s signature and stamp will be applied.`
                : `No signature or stamp saved on ${masterName || 'the captain'}’s profile yet — add one on their profile (Personal Details).`}
            </p>
            <div className="ccl-foot-actions">
              <span className="ccl-count">{selectedRows.length} of {ordered.length} crew</span>
              <button type="button" className="ccl-export" disabled={!selectedRows.length || busy} onClick={handleExport}>
                {busy ? 'Generating…' : <><Icon name="Download" size={16} /> Export crew list</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default CreateCrewListModal;
