import React, { useState, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import { updateItemPaymentStatus, updateDeliveryBatch, uploadInvoiceFile } from '../utils/provisioningStorage';

// ── Constants ─────────────────────────────────────────────────────────────────

export const PAYMENT_STATUS_OPTIONS = [
  { value: 'awaiting_invoice', label: 'Awaiting invoice' },
  { value: 'invoice_received', label: 'Invoice received' },
  { value: 'paid', label: 'Paid' },
  { value: 'paid_upfront', label: 'Paid upfront' },
];

const ACCEPT_TYPES = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';

// ── Helpers ───────────────────────────────────────────────────────────────────

const readFileAsBase64 = (file) => new Promise((res, rej) => {
  const reader = new FileReader();
  reader.onload = ev => res(ev.target.result.split(',')[1]);
  reader.onerror = rej;
  reader.readAsDataURL(file);
});

const callClaudeInvoiceParser = async (file, batchItems) => {
  const base64 = await readFileAsBase64(file);
  const mediaType = file.type === 'application/pdf' ? 'application/pdf' : file.type;

  const resp = await fetch('/.netlify/functions/parse-invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64, mediaType, batchItems }),
  });

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.error || `Server error ${resp.status}`);
  }

  return resp.json();
};

// ── Match confidence badge ────────────────────────────────────────────────────

const ConfidenceBadge = ({ confidence }) => {
  const styles = {
    high:   { bg: '#ECFDF5', color: '#047857' },
    medium: { bg: '#FEF3C7', color: '#92400E' },
    low:    { bg: '#FEF2F2', color: '#B91C1C' },
    none:   { bg: '#F1F5F9', color: '#64748B' },
  };
  const s = styles[confidence] || styles.none;
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: s.bg, color: s.color }}>
      {confidence === 'high' ? '✓ Matched' : confidence === 'medium' ? '~ Likely match' : confidence === 'low' ? '? Weak match' : '— No match'}
    </span>
  );
};

// ── Main modal ────────────────────────────────────────────────────────────────

const InvoiceUploadModal = ({ batch, batchItems = [], onClose, onComplete }) => {
  const [step, setStep] = useState('upload'); // upload | parsing | review | done
  const [file, setFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [error, setError] = useState('');
  const [parsedData, setParsedData] = useState(null);
  const [matches, setMatches] = useState([]);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileSelect = (f) => {
    if (!f) return;
    setFile(f);
    setError('');
    if (f.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = ev => setFilePreview(ev.target.result);
      reader.readAsDataURL(f);
    } else {
      setFilePreview(null);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    handleFileSelect(e.dataTransfer.files?.[0]);
  };

  const handleParse = async () => {
    if (!file) return;
    setStep('parsing');
    setError('');
    try {
      const parsed = await callClaudeInvoiceParser(file, batchItems);
      setParsedData(parsed);
      setMatches((parsed.line_items || []).map(li => {
        const matchedItem = li.matched_item_id
          ? batchItems.find(i => i.id === li.matched_item_id) || null
          : null;
        return {
          lineItem: li,
          matchedItem,
          confirmed: li.match_confidence === 'high' || li.match_confidence === 'medium',
          actualCost: li.unit_price ?? null,
        };
      }));
      setStep('review');
    } catch (err) {
      setError(err.message || 'Failed to parse invoice. Check your API key and try again.');
      setStep('upload');
    }
  };

  const handleConfirm = async () => {
    setSaving(true);
    try {
      // Upload file to storage
      const fileUrl = file ? await uploadInvoiceFile(file, batch.id) : null;

      // Update batch record
      const batchUpdates = { parsed_data: { ...(batch.parsed_data || {}), invoice_parsed: true } };
      if (parsedData?.invoice_number) batchUpdates.invoice_number = parsedData.invoice_number;
      if (parsedData?.invoice_date) batchUpdates.invoice_date = parsedData.invoice_date;
      if (parsedData?.total_amount) batchUpdates.invoice_total = parsedData.total_amount;
      if (fileUrl) batchUpdates.invoice_file_url = fileUrl;
      await updateDeliveryBatch(batch.id, batchUpdates);

      // Update matched items
      await Promise.allSettled(
        matches
          .filter(m => m.confirmed && m.matchedItem)
          .map(m => updateItemPaymentStatus(m.matchedItem.id, 'invoice_received', m.actualCost))
      );

      setStep('done');
      onComplete?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateMatch = (idx, changes) => {
    setMatches(prev => prev.map((m, i) => i === idx ? { ...m, ...changes } : m));
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const backdrop = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
  };
  const card = {
    background: 'white', borderRadius: 16, width: '100%', maxWidth: 640,
    maxHeight: '90vh', display: 'flex', flexDirection: 'column',
    boxShadow: '0 24px 64px rgba(0,0,0,0.18)',
  };
  const header = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '18px 24px', borderBottom: '1px solid #F1F5F9', flexShrink: 0,
  };
  const body = { flex: 1, overflowY: 'auto', padding: '20px 24px' };
  const footer = {
    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
    padding: '14px 24px', borderTop: '1px solid #F1F5F9', flexShrink: 0,
  };

  return (
    <div style={backdrop} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={card}>

        {/* Header */}
        <div style={header}>
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', margin: 0 }}>Upload Invoice / Receipt</p>
            <p style={{ fontSize: 11, color: '#94A3B8', margin: '2px 0 0' }}>
              {step === 'upload' && 'Attach a file to parse with AI'}
              {step === 'parsing' && 'Analysing with Claude AI…'}
              {step === 'review' && (parsedData?.supplier_name ? `Invoice from ${parsedData.supplier_name}` : 'Review extracted data')}
              {step === 'done' && 'Invoice processed'}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4 }}>
            <Icon name="X" style={{ width: 18, height: 18 }} />
          </button>
        </div>

        {/* Body */}
        <div style={body}>

          {/* ── Step: Upload ── */}
          {step === 'upload' && (
            <>
              {error && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#DC2626' }}>
                  {error}
                </div>
              )}
              <div
                onDrop={handleDrop}
                onDragOver={e => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${file ? '#4A90E2' : '#E2E8F0'}`,
                  borderRadius: 12, padding: '32px 24px', textAlign: 'center',
                  cursor: 'pointer', transition: 'border-color 0.15s',
                  background: file ? '#EFF6FF' : '#FAFAFA',
                }}
              >
                <input ref={fileInputRef} type="file" accept={ACCEPT_TYPES} style={{ display: 'none' }} onChange={e => handleFileSelect(e.target.files?.[0])} />
                {filePreview ? (
                  <img src={filePreview} alt="Invoice preview" style={{ maxHeight: 200, maxWidth: '100%', borderRadius: 8, marginBottom: 8 }} />
                ) : (
                  <Icon name={file ? 'FileCheck' : 'FileUp'} style={{ width: 32, height: 32, color: file ? '#4A90E2' : '#CBD5E1', margin: '0 auto 10px' }} />
                )}
                {file ? (
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', margin: 0 }}>{file.name}</p>
                ) : (
                  <>
                    <p style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', margin: '0 0 4px' }}>Drop file here or click to browse</p>
                    <p style={{ fontSize: 11, color: '#94A3B8', margin: 0 }}>PDF, JPEG, PNG, WEBP supported</p>
                  </>
                )}
              </div>

              {file && (
                <div style={{ marginTop: 12, background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="Sparkles" style={{ width: 14, height: 14, color: '#4A90E2', flexShrink: 0 }} />
                  <p style={{ fontSize: 12, color: '#1D4ED8', margin: 0 }}>
                    Claude AI will extract line items, invoice number, date, and supplier, then match them to your {batchItems.length} received item{batchItems.length !== 1 ? 's' : ''}.
                  </p>
                </div>
              )}
            </>
          )}

          {/* ── Step: Parsing ── */}
          {step === 'parsing' && (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'linear-gradient(135deg, #4A90E2, #7C3AED)', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="Sparkles" style={{ width: 22, height: 22, color: 'white' }} />
              </div>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#0F172A', marginBottom: 6 }}>Analysing invoice…</p>
              <p style={{ fontSize: 12, color: '#94A3B8' }}>Extracting line items and matching to order</p>
            </div>
          )}

          {/* ── Step: Review ── */}
          {step === 'review' && parsedData && (
            <>
              {/* Invoice summary */}
              <div style={{ background: '#F8FAFC', border: '1px solid #F1F5F9', borderRadius: 10, padding: '12px 16px', marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: '8px 24px' }}>
                {parsedData.invoice_number && <span style={{ fontSize: 12, color: '#64748B' }}>Invoice <strong>#{parsedData.invoice_number}</strong></span>}
                {parsedData.invoice_date && <span style={{ fontSize: 12, color: '#64748B' }}>Date: <strong>{parsedData.invoice_date}</strong></span>}
                {parsedData.supplier_name && <span style={{ fontSize: 12, color: '#64748B' }}>Supplier: <strong>{parsedData.supplier_name}</strong></span>}
                {parsedData.total_amount != null && (
                  <span style={{ fontSize: 12, color: '#064E3B', fontWeight: 700 }}>
                    Total: {parsedData.currency || ''} {parsedData.total_amount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
              </div>

              {error && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#DC2626' }}>{error}</div>
              )}

              {/* Line items */}
              <p style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
                Line items ({matches.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {matches.map((m, idx) => {
                  const li = m.lineItem;
                  return (
                    <div key={idx} style={{ background: 'white', border: `1px solid ${m.confirmed ? '#E0F2FE' : '#F1F5F9'}`, borderRadius: 10, padding: '12px 16px' }}>
                      {/* Row 1: invoice line name + qty + cost */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <input
                          type="checkbox"
                          checked={m.confirmed}
                          onChange={e => updateMatch(idx, { confirmed: e.target.checked })}
                          style={{ flexShrink: 0, accentColor: '#4A90E2' }}
                        />
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', flex: 1 }}>{li.raw_name}</span>
                        <span style={{ fontSize: 12, color: '#64748B', whiteSpace: 'nowrap' }}>
                          {li.quantity != null ? `×${li.quantity}` : ''}
                          {li.line_total != null ? ` = ${parsedData.currency || ''}${li.line_total?.toFixed(2)}` : ''}
                        </span>
                      </div>

                      {/* Row 2: match status */}
                      <div style={{ paddingLeft: 24, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <ConfidenceBadge confidence={li.match_confidence} />
                        {m.matchedItem && (
                          <span style={{ fontSize: 12, color: '#64748B' }}>
                            → {[m.matchedItem.name, m.matchedItem.brand, m.matchedItem.size].filter(Boolean).join(' · ')}
                          </span>
                        )}
                        {!m.matchedItem && (
                          <select
                            value=""
                            onChange={e => {
                              const item = batchItems.find(i => i.id === e.target.value);
                              updateMatch(idx, { matchedItem: item || null, confirmed: !!item });
                            }}
                            style={{ fontSize: 11, padding: '3px 6px', border: '1px solid #E2E8F0', borderRadius: 6, color: '#64748B', background: 'white' }}
                          >
                            <option value="">Link to item…</option>
                            {batchItems.map(i => <option key={i.id} value={i.id}>{[i.name, i.brand, i.size].filter(Boolean).join(' · ')}</option>)}
                          </select>
                        )}
                      </div>

                      {/* Row 3: discrepancy warning */}
                      {li.discrepancy && (
                        <div style={{ paddingLeft: 24, marginTop: 6, fontSize: 11, color: '#B45309', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Icon name="AlertTriangle" style={{ width: 12, height: 12 }} />
                          {li.discrepancy}
                        </div>
                      )}

                      {/* Row 4: actual cost override */}
                      {m.confirmed && m.matchedItem && (
                        <div style={{ paddingLeft: 24, marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, color: '#94A3B8' }}>Actual unit cost:</span>
                          <input
                            type="number"
                            value={m.actualCost ?? ''}
                            onChange={e => updateMatch(idx, { actualCost: e.target.value !== '' ? parseFloat(e.target.value) : null })}
                            step="0.01"
                            min="0"
                            placeholder={m.matchedItem?.estimated_unit_cost ?? ''}
                            style={{ width: 80, fontSize: 12, padding: '3px 8px', border: '1px solid #E2E8F0', borderRadius: 6, outline: 'none' }}
                          />
                          {m.matchedItem?.estimated_unit_cost != null && m.actualCost != null && Math.abs(m.actualCost - m.matchedItem.estimated_unit_cost) > 0.01 && (
                            <span style={{ fontSize: 11, color: '#B45309' }}>
                              (quoted: {parsedData.currency || ''}{parseFloat(m.matchedItem.estimated_unit_cost).toFixed(2)})
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 12 }}>
                {matches.filter(m => m.confirmed && m.matchedItem).length} item{matches.filter(m => m.confirmed && m.matchedItem).length !== 1 ? 's' : ''} will be updated to "Invoice received".
              </p>
            </>
          )}

          {/* ── Step: Done ── */}
          {step === 'done' && (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#ECFDF5', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="CheckCircle" style={{ width: 24, height: 24, color: '#34D399' }} />
              </div>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#0F172A', marginBottom: 6 }}>Invoice processed ✓</p>
              <p style={{ fontSize: 12, color: '#94A3B8' }}>
                {matches.filter(m => m.confirmed && m.matchedItem).length} item{matches.filter(m => m.confirmed && m.matchedItem).length !== 1 ? 's' : ''} updated to "Invoice received".
              </p>
            </div>
          )}

        </div>

        {/* Footer */}
        <div style={footer}>
          {step !== 'done' && (
            <button onClick={onClose} style={{ fontSize: 13, padding: '8px 16px', background: 'none', border: '1px solid #E2E8F0', borderRadius: 8, color: '#64748B', cursor: 'pointer' }}>
              Cancel
            </button>
          )}
          {step === 'upload' && (
            <button
              onClick={handleParse}
              disabled={!file}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, padding: '8px 18px', background: file ? '#1E3A5F' : '#E2E8F0', border: 'none', borderRadius: 8, color: file ? 'white' : '#94A3B8', cursor: file ? 'pointer' : 'default' }}
            >
              <Icon name="Sparkles" style={{ width: 14, height: 14 }} /> Parse Invoice
            </button>
          )}
          {step === 'review' && (
            <button
              onClick={handleConfirm}
              disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, padding: '8px 18px', background: '#1E3A5F', border: 'none', borderRadius: 8, color: 'white', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}
            >
              <Icon name="Check" style={{ width: 14, height: 14 }} /> {saving ? 'Saving…' : 'Confirm & Update'}
            </button>
          )}
          {step === 'done' && (
            <button onClick={onClose} style={{ fontSize: 13, fontWeight: 600, padding: '8px 18px', background: '#1E3A5F', border: 'none', borderRadius: 8, color: 'white', cursor: 'pointer' }}>
              Close
            </button>
          )}
        </div>

      </div>
    </div>
  );
};

export default InvoiceUploadModal;
