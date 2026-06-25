import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import LogoSpinner from '../../../components/LogoSpinner';
import ModalShell from '../../../components/ui/ModalShell';
import { showToast } from '../../../utils/toast';
import { getDocTypeLabel, suggestedExpiry } from '../documentTypes';
import { parseDocumentFile, persistCrewDocument, findDuplicateDoc } from '../utils/crewDocuments';
import { syncPassportToPersonalDetails } from '../utils/crewProfileData';
import DocumentFields from './DocumentFields';

// Counter for stable row keys across a session (Math.random is unavailable here
// and dates aren't needed — a monotonic id is enough).
let rowSeq = 0;

const fmtDate = (v) =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''))
    ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`
    : v;

const formFromSuggestion = (s) => {
  const docType = s?.doc_type || '';
  const issueDate = s?.issue_date || '';
  // A scanned refresher cert often shows only an issue date — derive the
  // refresher/expiry from it (issue + N years) when none was read.
  const expiryDate = s?.expiry_date || suggestedExpiry(docType, issueDate) || '';
  return {
    docType,
    documentNumber: s?.document_number || '',
    issuingAuthority: s?.issuing_authority || '',
    flagState: s?.flag_state || '',
    issueDate,
    expiryDate,
    details: s?.details || {},
  };
};

/**
 * Drop several documents at once → each is read by the AI, then shown as a
 * collapsed row that expands to edit. "Save all" files every reviewed row into
 * the Documents tab in one go (passports also feed Personal Details).
 */
const BatchReviewModal = ({ isOpen, files, onClose, onSaved, onProfileSynced, userId, tenantId, createdBy, existingDocs = [] }) => {
  const [items, setItems] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [saving, setSaving] = useState(false);

  // Parse each dropped file once, sequentially, when the modal opens.
  useEffect(() => {
    if (!isOpen || !files?.length) return undefined;
    let cancelled = false;
    const rows = files.map((file) => ({ id: `r${++rowSeq}`, file, status: 'parsing', form: formFromSuggestion(null) }));
    setItems(rows);
    setExpandedId(null);
    (async () => {
      for (const row of rows) {
        try {
          const s = await parseDocumentFile(row.file);
          if (cancelled) return;
          setItems((prev) => prev.map((p) => (p.id === row.id ? { ...p, status: 'parsed', form: formFromSuggestion(s) } : p)));
        } catch (e) {
          console.error('[docs] batch parse failed', e);
          if (cancelled) return;
          setItems((prev) => prev.map((p) => (p.id === row.id ? { ...p, status: 'error' } : p)));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, files]);

  if (!isOpen) return null;

  const setItemForm = (id, k, v) =>
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, form: { ...p.form, [k]: v } } : p)));
  const setItemDetail = (id, k, v) =>
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, form: { ...p.form, details: { ...p.form.details, [k]: v } } } : p)));
  const removeItem = (id) => setItems((prev) => prev.filter((p) => p.id !== id));

  const parsing = items.some((i) => i.status === 'parsing');
  const savable = items.filter((i) => i.status !== 'error' && i.form.docType);
  const needsType = items.filter((i) => i.status !== 'error' && !i.form.docType).length;

  const saveAll = async () => {
    if (!savable.length) { showToast('Pick a type for at least one document', 'error'); return; }
    setSaving(true);
    let ok = 0;
    let failed = 0;
    let synced = false;
    for (const it of savable) {
      try {
        await persistCrewDocument({ form: it.form, file: it.file, userId, tenantId, createdBy });
        if (it.form.docType === 'passport') {
          try {
            const sync = await syncPassportToPersonalDetails(userId, {
              date_of_birth: it.form.details?.date_of_birth,
              nationality: it.form.details?.nationality,
              place_of_birth: it.form.details?.place_of_birth,
            });
            if (sync.updated.length || sync.conflicts.length) synced = true;
          } catch (e) { console.error('[docs] batch passport sync failed', e); }
        }
        ok += 1;
      } catch (e) {
        console.error('[docs] batch save failed', e);
        failed += 1;
      }
    }
    setSaving(false);
    onSaved?.();
    if (synced) onProfileSynced?.();
    showToast(`${ok} document${ok === 1 ? '' : 's'} added${failed ? `, ${failed} failed` : ''}`, failed ? 'warning' : 'success');
    onClose?.();
  };

  const rowStatusIcon = (it) => {
    if (it.status === 'parsing') return <LogoSpinner size={14} />;
    if (it.status === 'error') return <Icon name="AlertTriangle" size={15} style={{ color: '#A32D2D' }} />;
    if (!it.form.docType) return <Icon name="HelpCircle" size={15} style={{ color: '#C65A1A' }} />;
    return <Icon name="CheckCircle" size={15} style={{ color: '#1E7A3E' }} />;
  };

  return (
    <ModalShell onClose={saving ? () => {} : onClose} isBusy={saving} panelClassName="bg-card border border-border rounded-2xl w-full max-w-3xl p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xl font-semibold text-foreground" style={{ fontFamily: "'DM Serif Display', Georgia, serif" }}>
          Review {items.length} document{items.length === 1 ? '' : 's'}
        </h3>
        <button onClick={saving ? undefined : onClose} className="p-1.5 hover:bg-muted rounded-lg"><Icon name="X" size={18} /></button>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Each upload was read automatically — open a row to check or fix it, then save them all.
        {needsType > 0 && <span style={{ color: '#C65A1A' }}> {needsType} need a document type.</span>}
      </p>

      <div style={{ borderTop: '1px solid #F0F1F5' }}>
        {items.map((it) => {
          const open = expandedId === it.id;
          const summary = [
            it.form.documentNumber && `№ ${it.form.documentNumber}`,
            it.form.expiryDate && `exp ${fmtDate(it.form.expiryDate)}`,
          ].filter(Boolean).join(' · ');
          const canOpen = it.status !== 'parsing';
          // Flag duplicates against both what's already on file AND the other
          // rows in this same upload (e.g. the same cert as a jpg and a pdf).
          const otherRows = items
            .filter((o) => o.id !== it.id && o.status !== 'error' && o.form.docType)
            .map((o) => ({
              id: o.id, doc_type: o.form.docType, document_number: o.form.documentNumber,
              issue_date: o.form.issueDate, expiry_date: o.form.expiryDate,
            }));
          const dup = it.status !== 'parsing' && it.form.docType
            ? findDuplicateDoc([...existingDocs, ...otherRows], { ...it.form, id: it.id })
            : null;
          return (
            <div key={it.id} style={{ borderBottom: '1px solid #F0F1F5' }}>
              <div
                className="flex items-center gap-3 py-3"
                style={{ cursor: canOpen ? 'pointer' : 'default' }}
                onClick={() => canOpen && setExpandedId(open ? null : it.id)}
              >
                <span className="flex-shrink-0 w-5 flex justify-center">{rowStatusIcon(it)}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium" style={{ color: '#1C1B3A' }}>
                    {it.status === 'parsing'
                      ? 'Reading…'
                      : it.status === 'error'
                        ? "Couldn't read — set the type manually"
                        : it.form.docType
                          ? getDocTypeLabel(it.form.docType, it.form.details)
                          : 'Choose a document type'}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {it.file.name}{summary ? ` · ${summary}` : ''}
                  </div>
                </div>
                {dup && (
                  <span className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: '#FBEFE9', color: '#7A2E1E' }} title="A matching document is already on file">
                    <Icon name="Copy" size={11} /> Possible duplicate
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeItem(it.id); }}
                  className="p-1.5 hover:bg-red-50 rounded-lg text-muted-foreground flex-shrink-0"
                  title="Remove from this batch"
                >
                  <Icon name="Trash2" size={15} />
                </button>
                {canOpen && (
                  <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={16} className="text-muted-foreground flex-shrink-0" />
                )}
              </div>
              {open && canOpen && (
                <div className="pb-4 pt-1">
                  <DocumentFields
                    form={it.form}
                    onSet={(k, v) => setItemForm(it.id, k, v)}
                    onSetDetail={(k, v) => setItemDetail(it.id, k, v)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-6">
        <span className="text-xs text-muted-foreground">
          {parsing ? 'Still reading uploads…' : `${savable.length} ready to save`}
        </span>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={saveAll} loading={saving} disabled={parsing || !savable.length}>
            Save all{savable.length ? ` (${savable.length})` : ''}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
};

export default BatchReviewModal;
