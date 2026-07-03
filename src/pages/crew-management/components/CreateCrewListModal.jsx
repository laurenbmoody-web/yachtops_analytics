import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import { showToast } from '../../../utils/toast';
import EditorialDatePicker from '../../../components/editorial/EditorialDatePicker';
import { useAuth } from '../../../contexts/AuthContext';
import {
  fetchVesselForCrewList, fetchCrewListDetails, buildCrewRow, missingMandatory,
} from '../utils/crewListData';
import { exportCrewListPDF } from '../utils/crewListExport';
import {
  getMasterSignatureRow, signedUrl, loadImageForPdf, uploadMasterImage,
} from '../utils/masterSignature';
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

const TEMPLATES = [
  { key: 'fal', name: 'Port authority', blurb: 'Official IMO FAL 5 layout' },
  { key: 'editorial', name: 'Editorial', blurb: 'Cargo-styled version' },
];

const todayDisplay = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const CreateCrewListModal = ({ open, onClose, tenantId, crew = [] }) => {
  const { session } = useAuth();
  const currentUserId = session?.user?.id;
  const [loading, setLoading] = useState(true);
  const [vessel, setVessel] = useState(null);
  const [detailsByUser, setDetailsByUser] = useState({});
  const [selected, setSelected] = useState(() => new Set());
  const [template, setTemplate] = useState('editorial');
  const [busy, setBusy] = useState(false);

  // Saved signature + stamp for the person generating the list (their account).
  const [sigPreview, setSigPreview] = useState({ signature: null, stamp: null }); // signed urls
  const [sigData, setSigData] = useState({ signature: null, stamp: null });       // pdf data-urls
  const [applySig, setApplySig] = useState(true);
  const [sigBusy, setSigBusy] = useState('');

  // Header fields not stored on the vessel record — entered per export.
  const [callSign, setCallSign] = useState('');
  const [classNotation, setClassNotation] = useState('');
  const [master, setMaster] = useState('');
  const [voyage, setVoyage] = useState({
    portOfArrival: '', lastPort: '', nextPort: '',
    arrivalDate: '', arrivalTime: '', departureDate: '', departureTime: '',
  });
  const setV = (k, val) => setVoyage((p) => ({ ...p, [k]: val }));

  // Crew ordered by rank; captain's name pre-fills the master signature.
  const ordered = useMemo(
    () => [...crew].sort((a, b) => crewRank(a) - crewRank(b) || String(a.fullName).localeCompare(String(b.fullName))),
    [crew],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    // Pre-select everyone by default; the user unticks whoever isn't sailing.
    setSelected(new Set(ordered.map((m) => m.user_id || m.id)));
    (async () => {
      const ids = ordered.map((m) => m.user_id || m.id).filter(Boolean);
      const [v, det] = await Promise.all([
        fetchVesselForCrewList(tenantId),
        fetchCrewListDetails(tenantId, ids),
      ]);
      if (cancelled) return;
      setVessel(v || {});
      setDetailsByUser(det || {});
      const captain = ordered.find((m) => crewRank(m) === 0);
      if (captain) setMaster(captain.fullName || '');

      // Load the generator's saved signature/stamp so they can one-tap apply it.
      const row = await getMasterSignatureRow(currentUserId);
      if (!cancelled && (row?.signature_path || row?.stamp_path)) {
        const [sUrl, tUrl, sData, tData] = await Promise.all([
          signedUrl(row.signature_path), signedUrl(row.stamp_path),
          loadImageForPdf(row.signature_path), loadImageForPdf(row.stamp_path),
        ]);
        if (!cancelled) {
          setSigPreview({ signature: sUrl, stamp: tUrl });
          setSigData({ signature: sData, stamp: tData });
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, tenantId, ordered, currentUserId]);

  const handleUploadSig = async (kind, file) => {
    if (!file) return;
    setSigBusy(kind);
    try {
      await uploadMasterImage(file, kind, tenantId);
      const row = await getMasterSignatureRow(currentUserId);
      const path = kind === 'stamp' ? row?.stamp_path : row?.signature_path;
      const [url, data] = await Promise.all([signedUrl(path), loadImageForPdf(path)]);
      setSigPreview((p) => ({ ...p, [kind]: url }));
      setSigData((p) => ({ ...p, [kind]: data }));
      setApplySig(true);
      showToast(`${kind === 'stamp' ? 'Stamp' : 'Signature'} saved to your account`, 'success');
    } catch (e) {
      console.error('signature upload failed:', e);
      showToast('Couldn’t upload — please try a PNG/JPEG', 'error');
    } finally {
      setSigBusy('');
    }
  };

  const rows = useMemo(
    () => ordered.map((m) => ({ member: m, row: buildCrewRow(m, detailsByUser[m.user_id || m.id]) })),
    [ordered, detailsByUser],
  );
  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.member.user_id || r.member.id)).map((r) => r.row),
    [rows, selected],
  );

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allOn = selected.size === ordered.length && ordered.length > 0;
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(ordered.map((m) => m.user_id || m.id)));

  const totalMissing = useMemo(
    () => selectedRows.reduce((n, r) => n + (missingMandatory(r).length ? 1 : 0), 0),
    [selectedRows],
  );

  const handleExport = useCallback(async () => {
    if (!selectedRows.length || busy) return;
    setBusy(true);
    try {
      await exportCrewListPDF({
        template, vessel: vessel || {}, callSign, classNotation, voyage, master,
        rows: selectedRows, generatedAt: todayDisplay(),
        signature: applySig ? sigData.signature : null,
        stamp: applySig ? sigData.stamp : null,
      });
      showToast('Crew list generated', 'success');
    } catch (err) {
      console.error('Crew list export failed:', err);
      showToast('Couldn’t generate the crew list', 'error');
    } finally {
      setBusy(false);
    }
  }, [selectedRows, busy, template, vessel, callSign, classNotation, voyage, master]);

  if (!open) return null;

  return createPortal(
    <div className="ccl-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ccl-panel" role="dialog" aria-modal="true" aria-label="Create crew list">
        <div className="ccl-head">
          <div>
            <div className="ccl-eyebrow">Crew</div>
            <h2>Create crew list</h2>
            <p className="ccl-sub">For port authority &amp; immigration — IMO FAL 5</p>
          </div>
          <button type="button" className="ccl-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        {loading ? (
          <div className="ccl-loading"><LogoSpinner size={40} /><span>Gathering crew details…</span></div>
        ) : (
          <div className="ccl-body">
            {/* Voyage + vessel-gap fields */}
            <div className="ccl-section">
              <div className="ccl-grouphead"><span className="dia">◆</span><span className="t">Voyage</span><span className="line" /></div>
              <div className="ccl-grid3">
                <label className="ccl-field"><span className="ccl-label">Port of arrival</span>
                  <input className="ccl-input" value={voyage.portOfArrival} onChange={(e) => setV('portOfArrival', e.target.value)} placeholder="e.g. Athens" /></label>
                <label className="ccl-field"><span className="ccl-label">Last port</span>
                  <input className="ccl-input" value={voyage.lastPort} onChange={(e) => setV('lastPort', e.target.value)} placeholder="Previous port" /></label>
                <label className="ccl-field"><span className="ccl-label">Next port</span>
                  <input className="ccl-input" value={voyage.nextPort} onChange={(e) => setV('nextPort', e.target.value)} placeholder="Onward port" /></label>
                <div className="ccl-field"><span className="ccl-label">Arrival date</span>
                  <EditorialDatePicker value={voyage.arrivalDate} onChange={(iso) => setV('arrivalDate', iso || '')} placeholder="dd/mm/yyyy" /></div>
                <label className="ccl-field"><span className="ccl-label">Arrival time</span>
                  <input className="ccl-input" value={voyage.arrivalTime} onChange={(e) => setV('arrivalTime', e.target.value)} placeholder="HH:MM" /></label>
                <div className="ccl-field" />
                <div className="ccl-field"><span className="ccl-label">Departure date</span>
                  <EditorialDatePicker value={voyage.departureDate} onChange={(iso) => setV('departureDate', iso || '')} placeholder="dd/mm/yyyy" /></div>
                <label className="ccl-field"><span className="ccl-label">Departure time</span>
                  <input className="ccl-input" value={voyage.departureTime} onChange={(e) => setV('departureTime', e.target.value)} placeholder="HH:MM" /></label>
                <div className="ccl-field" />
              </div>
            </div>

            <div className="ccl-section">
              <div className="ccl-grouphead"><span className="dia">◆</span><span className="t">Vessel &amp; master</span><span className="line" /></div>
              <div className="ccl-grid3">
                <label className="ccl-field"><span className="ccl-label">Call sign</span>
                  <input className="ccl-input" value={callSign} onChange={(e) => setCallSign(e.target.value)} placeholder="Not on file — enter" /></label>
                <label className="ccl-field"><span className="ccl-label">Class / notation</span>
                  <input className="ccl-input" value={classNotation} onChange={(e) => setClassNotation(e.target.value)} placeholder="e.g. 100A1 SSC Yacht" /></label>
                <label className="ccl-field"><span className="ccl-label">Master (signature name)</span>
                  <input className="ccl-input" value={master} onChange={(e) => setMaster(e.target.value)} placeholder="Captain's name" /></label>
              </div>
              <p className="ccl-hint">{vessel?.name || 'Vessel'} · {vessel?.flag || 'flag —'} · IMO {vessel?.imo_number || '—'}. Call sign &amp; class aren’t stored on the vessel record, so add them here.</p>
            </div>

            {/* Master signature & stamp — saved to your account, reused each time */}
            <div className="ccl-section">
              <div className="ccl-grouphead"><span className="dia">◆</span><span className="t">Signature &amp; stamp</span><span className="line" />
                {(sigPreview.signature || sigPreview.stamp) && (
                  <label className="ccl-applytoggle">
                    <input type="checkbox" checked={applySig} onChange={(e) => setApplySig(e.target.checked)} />
                    Apply to list
                  </label>
                )}
              </div>
              <div className="ccl-sigrow">
                {['signature', 'stamp'].map((kind) => (
                  <div className="ccl-sigcard" key={kind}>
                    <span className="ccl-label">{kind === 'signature' ? 'Signature' : 'Stamp'}</span>
                    <div className={`ccl-sigbox${sigPreview[kind] ? ' has' : ''}`}>
                      {sigPreview[kind]
                        ? <img src={sigPreview[kind]} alt={kind} />
                        : <span className="ccl-sigempty">None saved</span>}
                    </div>
                    <label className="ccl-sigbtn">
                      {sigBusy === kind ? 'Uploading…' : (sigPreview[kind] ? 'Replace' : 'Upload')}
                      <input type="file" accept="image/png,image/jpeg,image/webp" hidden
                        disabled={!!sigBusy}
                        onChange={(e) => { handleUploadSig(kind, e.target.files?.[0]); e.target.value = ''; }} />
                    </label>
                  </div>
                ))}
              </div>
              <p className="ccl-hint">Saved to your account — upload once, then it’s applied to every crew list you generate. A transparent PNG works best for signatures.</p>
            </div>

            {/* Crew picker */}
            <div className="ccl-section">
              <div className="ccl-grouphead"><span className="dia">◆</span><span className="t">Crew on this list</span><span className="line" />
                <button type="button" className="ccl-allbtn" onClick={toggleAll}>{allOn ? 'Clear all' : 'Select all'}</button>
              </div>
              {totalMissing > 0 && (
                <div className="ccl-warn"><Icon name="AlertTriangle" size={14} />
                  <span><b>{totalMissing}</b> selected {totalMissing === 1 ? 'member is' : 'members are'} missing mandatory details (passport, DOB…). They’ll show “—” on the list.</span></div>
              )}
              <div className="ccl-list">
                {rows.map(({ member, row }) => {
                  const id = member.user_id || member.id;
                  const on = selected.has(id);
                  const miss = missingMandatory(row);
                  return (
                    <button type="button" key={id} className={`ccl-row${on ? ' on' : ''}`} onClick={() => toggle(id)}>
                      <span className={`ccl-check${on ? ' on' : ''}`}>{on && <Icon name="Check" size={12} />}</span>
                      <span className="ccl-av">{member.photo ? <img src={member.photo} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : initials(member.fullName)}</span>
                      <span className="ccl-who"><span className="ccl-name">{member.fullName}</span><span className="ccl-role">{row.rank || 'No role'}{member.status ? ` · ${member.status}` : ''}</span></span>
                      {miss.length > 0 && <span className="ccl-missing" title={`Missing: ${miss.join(', ')}`}>{miss.length} missing</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {!loading && (
          <div className="ccl-foot">
            <div className="ccl-templates">
              {TEMPLATES.map((t) => (
                <button type="button" key={t.key} className={`ccl-tpl${template === t.key ? ' on' : ''}`} onClick={() => setTemplate(t.key)}>
                  <span className="ccl-tpl-name">{t.name}</span><span className="ccl-tpl-blurb">{t.blurb}</span>
                </button>
              ))}
            </div>
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
