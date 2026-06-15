import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import ModalShell from '../../../components/ui/ModalShell';
import { showToast } from '../../../utils/toast';
import { groupedDocumentTypes, getDocType } from '../documentTypes';
import { saveCrewDocument, uploadDocumentFile } from '../utils/crewDocuments';

const blank = {
  docType: '', documentNumber: '', issuingAuthority: '', flagState: '',
  issueDate: '', expiryDate: '', details: {},
  fileUrl: null, fileName: null, mimeType: null, sizeBytes: null,
};

const AddDocumentModal = ({ isOpen, onClose, onSaved, userId, tenantId, createdBy, existing, presetType, prefill, prefillFile }) => {
  const [form, setForm] = useState(blank);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (existing) {
      setForm({
        id: existing.id,
        docType: existing.doc_type || '',
        documentNumber: existing.document_number || '',
        issuingAuthority: existing.issuing_authority || '',
        flagState: existing.flag_state || '',
        issueDate: existing.issue_date || '',
        expiryDate: existing.expiry_date || '',
        details: existing.details || {},
        fileUrl: existing.file_url || null,
        fileName: existing.file_name || null,
        mimeType: existing.mime_type || null,
        sizeBytes: existing.size_bytes || null,
      });
      setFile(null);
    } else if (prefill) {
      // AI-suggested fields from a scanned document, plus the file itself.
      setForm({
        ...blank,
        docType: prefill.doc_type || presetType || '',
        documentNumber: prefill.document_number || '',
        issuingAuthority: prefill.issuing_authority || '',
        flagState: prefill.flag_state || '',
        issueDate: prefill.issue_date || '',
        expiryDate: prefill.expiry_date || '',
        details: prefill.details || {},
      });
      setFile(prefillFile || null);
    } else {
      setForm({ ...blank, docType: presetType || '' });
      setFile(null);
    }
  }, [isOpen, existing, presetType, prefill, prefillFile]);

  if (!isOpen) return null;

  const typeDef = getDocType(form.docType);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setDetail = (k, v) => setForm((f) => ({ ...f, details: { ...f.details, [k]: v } }));

  const handleSave = async () => {
    if (!form.docType) { showToast('Pick a document type', 'error'); return; }
    setSaving(true);
    try {
      let fileMeta = {};
      if (file) {
        const up = await uploadDocumentFile(userId, file);
        fileMeta = {
          fileUrl: up.file_url, fileName: up.file_name,
          mimeType: up.mime_type, sizeBytes: up.size_bytes,
          details: { ...form.details, storage_path: up.storage_path },
        };
      }
      await saveCrewDocument({
        id: form.id,
        userId, tenantId, createdBy,
        category: typeDef?.category || 'other',
        docType: form.docType,
        documentNumber: form.documentNumber,
        issuingAuthority: form.issuingAuthority,
        flagState: form.flagState,
        issueDate: form.issueDate || null,
        expiryDate: form.expiryDate || null,
        details: fileMeta.details || form.details,
        fileUrl: fileMeta.fileUrl ?? form.fileUrl,
        fileName: fileMeta.fileName ?? form.fileName,
        mimeType: fileMeta.mimeType ?? form.mimeType,
        sizeBytes: fileMeta.sizeBytes ?? form.sizeBytes,
      });
      showToast(form.id ? 'Document updated' : 'Document added', 'success');
      onSaved?.();
      onClose?.();
    } catch (e) {
      console.error('[docs] save failed', e);
      showToast(e?.message || 'Failed to save document', 'error');
    } finally {
      setSaving(false);
    }
  };

  const labelCls = 'block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5';
  const boxCls = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <ModalShell onClose={onClose} isBusy={saving} panelClassName="bg-card border border-border rounded-2xl w-full max-w-2xl p-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-xl font-semibold text-foreground" style={{ fontFamily: "'DM Serif Display', Georgia, serif" }}>
          {form.id ? 'Edit document' : 'Add document'}
        </h3>
        <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg"><Icon name="X" size={18} /></button>
      </div>

      {prefill && !form.id && (
        <div className="flex items-start gap-2 mb-4 px-3 py-2 rounded-lg text-xs" style={{ background: '#FAEEDA', color: '#7A2E1E' }}>
          <Icon name="Sparkles" size={14} className="flex-shrink-0 mt-0.5" />
          <span>Auto-filled from the scan — please check each field before saving.</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Type picker (categorised) */}
        <div className="md:col-span-2">
          <label className={labelCls}>Document type</label>
          <select className={boxCls} value={form.docType} onChange={(e) => set('docType', e.target.value)}>
            <option value="">Select a document type…</option>
            {groupedDocumentTypes().map((g) => (
              <optgroup key={g.id} label={g.label}>
                {g.types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>Document number</label>
          <Input value={form.documentNumber} onChange={(e) => set('documentNumber', e.target.value)} placeholder="—" />
        </div>
        <div>
          <label className={labelCls}>Issuing authority</label>
          <Input value={form.issuingAuthority} onChange={(e) => set('issuingAuthority', e.target.value)} placeholder="—" />
        </div>

        {typeDef?.flagState && (
          <div>
            <label className={labelCls}>Issuing flag state</label>
            <Input value={form.flagState} onChange={(e) => set('flagState', e.target.value)} placeholder="e.g. Marshall Islands" />
          </div>
        )}

        <div>
          <label className={labelCls}>Issue date</label>
          <input type="date" className={boxCls} value={form.issueDate || ''} onChange={(e) => set('issueDate', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Expiry date</label>
          <input type="date" className={boxCls} value={form.expiryDate || ''} onChange={(e) => set('expiryDate', e.target.value)} />
        </div>

        {/* Type-specific fields → details jsonb */}
        {(typeDef?.fields || []).map((f) => (
          <div key={f.key} className={f.type === 'select' ? 'md:col-span-2' : ''}>
            <label className={labelCls}>{f.label}</label>
            {f.type === 'select' ? (
              <select className={boxCls} value={form.details?.[f.key] || ''} onChange={(e) => setDetail(f.key, e.target.value)}>
                <option value="">Select…</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === 'date' ? (
              <input type="date" className={boxCls} value={form.details?.[f.key] || ''} onChange={(e) => setDetail(f.key, e.target.value)} />
            ) : (
              <Input value={form.details?.[f.key] || ''} onChange={(e) => setDetail(f.key, e.target.value)} placeholder="—" />
            )}
          </div>
        ))}

        {/* File */}
        <div className="md:col-span-2">
          <label className={labelCls}>Scan / file (optional)</label>
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
          />
          {!file && form.fileName && (
            <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
              <Icon name="Paperclip" size={12} /> {form.fileName} (keep existing)
            </p>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-6">
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} loading={saving}>{form.id ? 'Save changes' : 'Add document'}</Button>
      </div>
    </ModalShell>
  );
};

export default AddDocumentModal;
