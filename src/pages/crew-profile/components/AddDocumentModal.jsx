import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import ModalShell from '../../../components/ui/ModalShell';
import DateInput from '../../../components/ui/DateInput';
import LogoSpinner from '../../../components/LogoSpinner';
import { showToast } from '../../../utils/toast';
import { groupedDocumentTypes, getDocType } from '../documentTypes';
import { saveCrewDocument, uploadDocumentFile, parseDocumentFile } from '../utils/crewDocuments';
import { syncPassportToPersonalDetails } from '../utils/crewProfileData';

// Loose match for verifying typed input against a scanned value: trim, collapse
// whitespace, case-insensitive. Dates are already normalised to YYYY-MM-DD.
const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// Show YYYY-MM-DD dates the Cargo way (dd/mm/yyyy) when advising on a mismatch.
const fmtVal = (v) =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''))
    ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`
    : v;

const blank = {
  docType: '', documentNumber: '', issuingAuthority: '', flagState: '',
  issueDate: '', expiryDate: '', details: {},
  fileUrl: null, fileName: null, mimeType: null, sizeBytes: null,
};

const AddDocumentModal = ({ isOpen, onClose, onSaved, onProfileSynced, userId, tenantId, createdBy, existing, presetType, presetDetails, prefill, prefillFile }) => {
  const [form, setForm] = useState(blank);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  // Result of reading a file the user attached inside the modal:
  // { kind: 'filled' | 'ok' | 'warn' | 'error', messages: string[] }.
  const [advisory, setAdvisory] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setScanning(false);
    setAdvisory(null);
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
      setForm({ ...blank, docType: presetType || '', details: presetDetails || {} });
      setFile(null);
    }
  }, [isOpen, existing, presetType, presetDetails, prefill, prefillFile]);

  if (!isOpen) return null;

  const typeDef = getDocType(form.docType);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setDetail = (k, v) => setForm((f) => ({ ...f, details: { ...f.details, [k]: v } }));

  // Attaching a file inside the modal triggers a read:
  //   • nothing typed yet → parse the document and fill the fields;
  //   • already typed     → fill any blanks and flag where the typed value
  //     disagrees with what the document shows.
  const handleFileSelect = async (selected) => {
    setFile(selected);
    setAdvisory(null);
    if (!selected) return;

    const detailVals = Object.values(form.details || {}).filter((v) => v != null && String(v).trim() !== '');
    const hasInput = [form.documentNumber, form.issuingAuthority, form.flagState, form.issueDate, form.expiryDate]
      .some((v) => v && String(v).trim() !== '') || detailVals.length > 0;

    setScanning(true);
    try {
      const s = await parseDocumentFile(selected);

      if (!hasInput) {
        // Auto-fill mode — populate everything from the scan.
        setForm((f) => ({
          ...f,
          docType: f.docType || s.doc_type || '',
          documentNumber: s.document_number || '',
          issuingAuthority: s.issuing_authority || '',
          flagState: s.flag_state || '',
          issueDate: s.issue_date || '',
          expiryDate: s.expiry_date || '',
          details: { ...f.details, ...(s.details || {}) },
        }));
        setAdvisory({
          kind: 'filled',
          messages: ['We filled the fields from your upload — please check each one before saving.'],
        });
        return;
      }

      // Verify mode — fill blanks, flag conflicts on fields already typed.
      const specs = [
        ['documentNumber', 'Document number', s.document_number],
        ['issuingAuthority', 'Issuing authority', s.issuing_authority],
        ['issueDate', 'Issue date', s.issue_date],
        ['expiryDate', 'Expiry date', s.expiry_date],
      ];
      if (typeDef?.flagState) specs.push(['flagState', 'Issuing flag state', s.flag_state]);

      const fills = {};
      const detailFills = {};
      const conflicts = [];

      specs.forEach(([key, label, parsed]) => {
        if (!parsed) return;
        const cur = form[key];
        if (!cur || String(cur).trim() === '') fills[key] = parsed;
        else if (norm(cur) !== norm(parsed)) {
          conflicts.push(`${label}: you entered “${fmtVal(cur)}”, the document shows “${fmtVal(parsed)}”.`);
        }
      });

      (typeDef?.fields || []).forEach((fd) => {
        const parsed = s.details?.[fd.key];
        if (!parsed) return;
        const cur = form.details?.[fd.key];
        if (!cur || String(cur).trim() === '') detailFills[fd.key] = parsed;
        else if (norm(cur) !== norm(parsed)) {
          conflicts.push(`${fd.label}: you entered “${fmtVal(cur)}”, the document shows “${fmtVal(parsed)}”.`);
        }
      });

      if (Object.keys(fills).length || Object.keys(detailFills).length) {
        setForm((f) => ({ ...f, ...fills, details: { ...f.details, ...detailFills } }));
      }

      setAdvisory(
        conflicts.length
          ? { kind: 'warn', messages: ['These fields don’t match your upload — please double-check:', ...conflicts] }
          : { kind: 'ok', messages: ['Your details match the uploaded document.'] },
      );
    } catch (e) {
      console.error('[docs] file parse failed', e);
      setAdvisory({
        kind: 'error',
        messages: ['Couldn’t read this file automatically — the file is still attached, just fill the fields in manually.'],
      });
    } finally {
      setScanning(false);
    }
  };

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
      const saved = await saveCrewDocument({
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
      // Adopt the new row's id so the modal can stay open (passport conflicts)
      // without a second save inserting a duplicate.
      if (saved?.id && !form.id) setForm((f) => ({ ...f, id: saved.id }));
      showToast(form.id ? 'Document updated' : 'Document added', 'success');

      // A passport is the source of truth for the holder's identity — feed any
      // parsed details into the profile's Personal Details (filling blanks),
      // and surface anything that disagrees with what's already on file.
      let sync = null;
      if (form.docType === 'passport') {
        try {
          sync = await syncPassportToPersonalDetails(userId, {
            date_of_birth: form.details?.date_of_birth,
            nationality: form.details?.nationality,
            place_of_birth: form.details?.place_of_birth,
          });
        } catch (e) {
          console.error('[docs] passport → personal details sync failed', e);
        }
      }

      onSaved?.();
      if (sync && (sync.updated.length || sync.conflicts.length)) onProfileSynced?.();

      if (sync?.updated.length) {
        showToast(`Personal details updated from passport: ${sync.updated.join(', ')}`, 'success');
      }
      if (sync?.conflicts.length) {
        // Keep the modal open so the discrepancies are read; we don't overwrite
        // existing Personal Details automatically.
        setAdvisory({
          kind: 'warn',
          messages: [
            'Saved. These passport details differ from the crew member’s Personal Details — review and update there if needed:',
            ...sync.conflicts.map((c) => `${c.label}: profile shows “${fmtVal(c.profile)}”, passport shows “${fmtVal(c.passport)}”.`),
          ],
        });
        setSaving(false);
        return;
      }
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
          <span>Pre-filled from your upload — please check each field before saving.</span>
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
          <DateInput className={boxCls} value={form.issueDate || ''} onChange={(e) => set('issueDate', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Expiry date</label>
          <DateInput className={boxCls} value={form.expiryDate || ''} onChange={(e) => set('expiryDate', e.target.value)} />
        </div>

        {/* Type-specific fields → details jsonb */}
        {(typeDef?.fields || []).map((f) => (
          <div key={f.key} className={f.type === 'select' ? 'md:col-span-2' : ''}>
            <label className={labelCls}>{f.label}</label>
            {f.type === 'select' ? (
              <select className={boxCls} value={form.details?.[f.key] || ''} onChange={(e) => setDetail(f.key, e.target.value)}>
                <option value="">Select…</option>
                {/* Keep a parsed/saved value that isn't in the preset list (e.g. an
                    AI-read licence grade) so it still shows as selected. */}
                {form.details?.[f.key] && !f.options.includes(form.details[f.key]) && (
                  <option value={form.details[f.key]}>{form.details[f.key]}</option>
                )}
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === 'date' ? (
              <DateInput className={boxCls} value={form.details?.[f.key] || ''} onChange={(e) => setDetail(f.key, e.target.value)} />
            ) : (
              <Input value={form.details?.[f.key] || ''} onChange={(e) => setDetail(f.key, e.target.value)} placeholder="—" />
            )}
          </div>
        ))}

        {/* File — attaching one reads the document to fill or check the fields. */}
        <div className="md:col-span-2">
          <label className={labelCls}>File (optional)</label>
          <input
            type="file"
            accept="image/*,application/pdf"
            disabled={scanning}
            onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground disabled:opacity-60"
          />
          {scanning ? (
            <p className="text-xs mt-1.5 flex items-center gap-1.5" style={{ color: '#7A2E1E' }}>
              <LogoSpinner size={12} /> Reading your upload…
            </p>
          ) : file ? (
            <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
              <Icon name="Paperclip" size={12} /> {file.name} {prefill && !form.id ? '(from your upload)' : '(attached)'}
            </p>
          ) : form.fileName ? (
            <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
              <Icon name="Paperclip" size={12} /> {form.fileName} (keep existing)
            </p>
          ) : null}

          {advisory && !scanning && (
            <div
              className="flex items-start gap-2 mt-2 px-3 py-2 rounded-lg text-xs"
              style={
                advisory.kind === 'warn'
                  ? { background: '#FBEFE9', color: '#7A2E1E' }
                  : advisory.kind === 'error'
                    ? { background: '#FAFAF8', border: '1px solid #ECEAE3', color: '#6B7280' }
                    : advisory.kind === 'ok'
                      ? { background: '#ECF7EE', color: '#1E7A3E' }
                      : { background: '#FAEEDA', color: '#7A2E1E' }
              }
            >
              <Icon
                name={advisory.kind === 'warn' ? 'AlertTriangle' : advisory.kind === 'ok' ? 'CheckCircle' : advisory.kind === 'error' ? 'Info' : 'Sparkles'}
                size={14}
                className="flex-shrink-0 mt-0.5"
              />
              <div className="space-y-0.5">
                {advisory.messages.map((m, i) => <div key={i}>{m}</div>)}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-6">
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} loading={saving} disabled={scanning}>{form.id ? 'Save changes' : 'Add document'}</Button>
      </div>
    </ModalShell>
  );
};

export default AddDocumentModal;
