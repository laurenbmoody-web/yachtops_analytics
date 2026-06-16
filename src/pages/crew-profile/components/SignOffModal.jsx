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
