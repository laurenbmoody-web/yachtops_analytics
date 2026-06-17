import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import ModalShell from '../../../components/ui/ModalShell';
import SignaturePad from '../../../components/ui/SignaturePad';
import { uploadSignature, bestEffortIp, currentUserAgent } from '../utils/horSignatures';
import { showToast } from '../../../utils/toast';
import './SignOffModal.css';

// SignOffModal — captures a drawn signature + audit trail (typed legal name,
// server timestamp via the writer RPC, best-effort IP, user agent) before a HOR
// month transition. Used for both crew submit and the captain's counter-sign.
//
// On confirm it uploads the PNG to the hor-signatures bucket and hands the
// caller a signature payload { path, name, ip, ua } to pass to the writer RPC.
// The caller performs the actual submit/approve so the DB stamp + signature
// land together.
const SignOffModal = ({
  isOpen,
  onClose,
  onConfirm,           // async ({ path, name, ip, ua }) => void  (does the RPC)
  title,
  declaration,
  periodLabel,
  defaultName = '',
  confirmLabel = 'Sign & submit',
  kind = 'submit',     // 'submit' | 'approve' — filename hint only
  breaches = [],       // [{ date, note, documented, signed }] — shown for awareness
}) => {
  const [dataUrl, setDataUrl] = useState(null);
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const canSign = !!dataUrl && name.trim().length > 0 && !busy;

  const handleConfirm = async () => {
    if (!canSign) return;
    setBusy(true);
    try {
      const path = await uploadSignature(dataUrl, kind);
      const ip = await bestEffortIp();
      await onConfirm({ path, name: name.trim(), ip, ua: currentUserAgent() });
      onClose();
    } catch (e) {
      console.error('[HOR] sign-off failed:', e);
      showToast(e?.message || 'Failed to record signature', 'error');
      setBusy(false);
    }
  };

  return (
    <ModalShell
      onClose={onClose}
      isBusy={busy}
      isDirty={!!dataUrl || name.trim() !== defaultName.trim()}
      panelClassName="so-panel"
    >
      <div className="so-wrap">
        <div className="so-head">
          <span className="so-head-icon">
            <Icon name="PenLine" size={18} />
          </span>
          <div className="flex-1">
            <h3 className="so-title">{title}</h3>
            {periodLabel && <p className="so-period">{periodLabel}</p>}
          </div>
        </div>

        <p className="so-decl">{declaration}</p>

        {/* Rest-hour breaches in this period — surfaced so the signer knowingly
            includes them. Editorial (Cargo) treatment: the reasons are already
            documented by this point, so this is a calm confirmation summary, not
            an amber hazard panel. Terracotta is reserved for a genuine "No reason". */}
        {breaches.length > 0 && (
          <div className="rounded-xl p-4" style={{ background: '#FAFAF8', border: '1px solid #ECEAE3' }}>
            <div
              className="text-[9px] font-bold uppercase tracking-[1px] pb-2 mb-1"
              style={{ color: '#8B8478', borderBottom: '1px solid #F0F1F5' }}
            >
              {breaches.length} rest-hour breach{breaches.length > 1 ? 'es' : ''} this period
            </div>
            <ul className="max-h-40 overflow-y-auto pr-0.5">
              {breaches.map((b, i) => {
                const [yy, mm, dd] = String(b.date).split('-');
                const dateLabel = dd && mm && yy ? `${dd}/${mm}/${yy}` : b.date;
                return (
                  <li
                    key={b.date}
                    className="flex items-center justify-between gap-3 py-2"
                    style={i > 0 ? { borderTop: '1px solid #F0F1F5' } : undefined}
                  >
                    <span className="min-w-0 text-[13px]" style={{ color: '#1C1B3A' }}>
                      <span className="font-medium">{dateLabel}</span>
                      {b.note
                        ? <span style={{ color: '#6B7280' }}> — {b.note}</span>
                        : <span className="italic" style={{ color: '#C65A1A' }}> — no reason documented</span>}
                    </span>
                    {b.signed ? (
                      <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: '#1C7C54' }}>
                        <Icon name="Check" size={13} /> Signed off
                      </span>
                    ) : !b.documented ? (
                      <span className="shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: '#FBEFE9', color: '#C65A1A' }}>
                        No reason
                      </span>
                    ) : kind === 'approve' ? (
                      <span className="shrink-0 text-[11px] font-medium" style={{ color: '#8B8478' }}>
                        Awaiting sign-off
                      </span>
                    ) : (
                      <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: '#8B8478' }}>
                        <Icon name="Check" size={13} /> Reason documented
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-[11px] mt-2" style={{ color: '#AEB4C2' }}>
              {kind === 'approve'
                ? 'Included in your counter-signature. Sign off each reason on the HOR page if needed.'
                : 'These reasons are included in this sign-off.'}
            </p>
          </div>
        )}

        <div>
          <label className="so-label">
            Full name (as it appears on your record)<span className="so-req">required</span>
          </label>
          <input
            className="so-input"
            value={name}
            onChange={(e) => setName(e?.target?.value)}
            placeholder="e.g. Jane Smith"
          />
        </div>

        <div>
          <label className="so-label">
            Signature<span className="so-req">required</span>
          </label>
          <SignaturePad onChange={setDataUrl} disabled={busy} />
        </div>

        <p className="so-audit">
          Your name, the time of signing, your IP address and device are recorded with this
          signature as an audit trail.
        </p>

        <div className="so-actions">
          <button type="button" className="so-btn so-btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="so-btn so-btn-primary" onClick={handleConfirm} disabled={!canSign}>
            {busy ? (
              <><Icon name="Loader" size={16} className="animate-spin" /> Recording…</>
            ) : (
              <><Icon name="Check" size={16} /> {confirmLabel}</>
            )}
          </button>
        </div>
      </div>
    </ModalShell>
  );
};

export default SignOffModal;
