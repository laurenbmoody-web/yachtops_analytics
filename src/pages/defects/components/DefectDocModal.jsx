// Attach a quote or invoice to a defect. Pick a file (PDF/image), optionally the
// amount + currency, and it uploads to the private defect-documents bucket and
// records a defect_documents row (feeding the repair record's cost variance).
import React, { useRef, useState } from 'react';
import ModalShell from '../../../components/ui/ModalShell';
import Icon from '../../../components/AppIcon';
import VmdSelect from '../../vessel-map/components/VmdSelect';
import { useDefectActor } from '../utils/useDefectActor';
import { uploadDefectDocument } from '../utils/defectDocuments';
import './DefectDocModal.css';

const CURRENCIES = ['EUR', 'USD', 'GBP'];

export default function DefectDocModal({ defect, kind = 'quote', onClose, onDone }) {
  const actor = useDefectActor();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const title = kind === 'quote' ? 'Attach a quote' : kind === 'invoice' ? 'Attach an invoice' : 'Attach a document';

  const submit = async () => {
    if (!file) { setErr('Choose a file to attach.'); return; }
    setBusy(true); setErr('');
    try {
      const row = await uploadDefectDocument({ defect, file, kind, amount, currency, actor });
      onDone?.(row);
    } catch (e) {
      setErr(e?.message || 'Could not attach the file.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose} panelClassName="ddoc" isBusy={busy}>
      <div className="ddoc-head">
        <div>
          <p className="ddoc-eyebrow">{defect.ref}</p>
          <h3>{title}</h3>
        </div>
        <button className="ddoc-x" onClick={onClose} aria-label="Close"><Icon name="X" size={16} /></button>
      </div>

      <div className="ddoc-body">
        <button type="button" className={`ddoc-drop${file ? ' has' : ''}`} onClick={() => fileRef.current?.click()}>
          <Icon name={file ? 'FileCheck2' : 'Upload'} size={20} />
          <span>{file ? file.name : 'Choose a PDF or photo'}</span>
        </button>
        <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" style={{ display: 'none' }}
          onChange={(e) => { setFile(e.target.files?.[0] || null); setErr(''); }} />

        <div className="ddoc-money">
          <div className="ddoc-field" style={{ flex: 1 }}>
            <label className="ddoc-lbl">Amount<span className="opt">optional</span></label>
            <input className="ddoc-input" inputMode="decimal" value={amount} placeholder="0.00"
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          </div>
          <div className="ddoc-field" style={{ width: 110 }}>
            <label className="ddoc-lbl">Currency</label>
            <VmdSelect value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} ariaLabel="Currency" />
          </div>
        </div>
      </div>

      {err && <p className="ddoc-err">{err}</p>}
      <div className="ddoc-foot">
        <button className="ddoc-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="ddoc-btn primary" onClick={submit} disabled={busy}>{busy ? 'Attaching…' : 'Attach'}</button>
      </div>
    </ModalShell>
  );
}
