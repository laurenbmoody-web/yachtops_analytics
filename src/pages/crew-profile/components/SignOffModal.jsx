import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import ModalShell from '../../../components/ui/ModalShell';
import SignaturePad from '../../../components/ui/SignaturePad';
import { uploadSignature, bestEffortIp, currentUserAgent } from '../utils/horSignatures';
import { showToast } from '../../../utils/toast';

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
      panelClassName="bg-card border border-border rounded-xl shadow-xl w-full max-w-md"
    >
      <div className="p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-primary/10 p-2">
            <Icon name="PenLine" size={18} className="text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            {periodLabel && <p className="text-sm text-muted-foreground">{periodLabel}</p>}
          </div>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed">{declaration}</p>

        {/* Rest-hour breaches in this period — surfaced so the signer knowingly
            includes them in the sign-off, with each day's documented-reason /
            sign-off state. */}
        {breaches.length > 0 && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Icon name="AlertTriangle" size={15} className="text-amber-600 dark:text-amber-400" />
              <span className="text-sm font-semibold text-foreground">
                {breaches.length} rest-hour breach{breaches.length > 1 ? 'es' : ''} this period
              </span>
            </div>
            <ul className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
              {breaches.map((b) => (
                <li key={b.date} className="flex items-start justify-between gap-2 text-xs">
                  <span className="min-w-0 text-foreground">
                    <span className="font-medium">
                      {new Date(b.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </span>
                    {b.note
                      ? <span className="text-muted-foreground"> — {b.note}</span>
                      : <span className="text-muted-foreground italic"> — no reason documented</span>}
                  </span>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full font-semibold ${
                    b.signed
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                      : b.documented
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                        : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                  }`}>
                    {b.signed ? 'Signed off' : b.documented ? 'Awaiting sign-off' : 'No reason'}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground mt-2">
              {kind === 'approve'
                ? 'These breaches are included in your counter-signature. Sign off each reason on the HOR page if needed.'
                : 'These breaches are included in this sign-off. Add a reason for any marked “No reason”.'}
            </p>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            Full name (as it appears on your record)
          </label>
          <Input value={name} onChange={(e) => setName(e?.target?.value)} placeholder="e.g. Jane Smith" />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">Signature</label>
          <SignaturePad onChange={setDataUrl} disabled={busy} />
        </div>

        <p className="text-[11px] text-muted-foreground">
          Your name, the time of signing, your IP address and device are recorded with this
          signature as an audit trail.
        </p>

        <div className="flex justify-end gap-3 pt-1">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!canSign}>
            {busy ? (
              <><Icon name="Loader" size={16} className="animate-spin" /> Recording…</>
            ) : (
              <><Icon name="Check" size={16} /> {confirmLabel}</>
            )}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
};

export default SignOffModal;
