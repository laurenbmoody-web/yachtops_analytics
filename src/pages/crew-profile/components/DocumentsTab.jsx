import React, { useState, useEffect, useCallback, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import LogoSpinner from '../../../components/LogoSpinner';
import { showToast } from '../../../utils/toast';
import {
  DOC_CATEGORIES, CORE_DOCUMENT_TYPE_IDS, coreDocumentTypes, getDocTypeLabel,
} from '../documentTypes';
import {
  fetchCrewDocuments, deleteCrewDocument, getExpiryStatus,
  EXPIRY_STATUS_CLASSES, formatDocDate,
} from '../utils/crewDocuments';
import AddDocumentModal from './AddDocumentModal';
import BatchReviewModal from './BatchReviewModal';

const DocumentsTab = ({ userId, tenantId, createdBy, canEdit, openPreset, onPresetHandled, onProfileSynced }) => {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [presetType, setPresetType] = useState(null);
  const [presetDetails, setPresetDetails] = useState(null);

  // Batch upload — drop/select several files, parse + review them together.
  const [batchFiles, setBatchFiles] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const scanInputRef = useRef(null);

  // Only image/PDF files can be parsed; ignore anything else that's dropped.
  const openBatch = (fileList) => {
    const files = Array.from(fileList || []).filter((f) => /^image\/|application\/pdf/.test(f.type));
    if (!files.length) { showToast('Drop image or PDF documents to upload', 'error'); return; }
    setBatchFiles(files);
  };

  const onPickFiles = (e) => {
    const files = e.target.files;
    openBatch(files);
    e.target.value = '';
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (!canEdit) return;
    openBatch(e.dataTransfer?.files);
  };

  // Opened from elsewhere (e.g. the Sea Time held-certs drawer) with a doc type
  // + grade to pre-fill.
  useEffect(() => {
    if (!openPreset) return;
    setEditing(null);
    setPresetType(openPreset.docType || null);
    setPresetDetails(openPreset.grade ? { grade: openPreset.grade } : null);
    setModalOpen(true);
    onPresetHandled && onPresetHandled();
  }, [openPreset, onPresetHandled]);

  const closeModal = () => {
    setModalOpen(false);
    setPresetDetails(null);
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setDocs(await fetchCrewDocuments(userId));
    } catch {
      showToast('Failed to load documents', 'error');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { if (userId) load(); }, [userId, load]);

  const openAdd = (preset = null) => { setEditing(null); setPresetType(preset); setModalOpen(true); };
  const openEdit = (d) => { setEditing(d); setPresetType(null); setModalOpen(true); };

  const handleDelete = async (d) => {
    if (!window.confirm(`Delete "${getDocTypeLabel(d.doc_type, d.details)}"? This cannot be undone.`)) return;
    try {
      await deleteCrewDocument(d.id);
      showToast('Document deleted', 'success');
      load();
    } catch {
      showToast('Failed to delete document', 'error');
    }
  };

  const flagged = docs.map((d) => getExpiryStatus(d.expiry_date));
  const expiredCount = flagged.filter((s) => s.level === 'expired').length;
  const soonCount = flagged.filter((s) => s.level === 'red' || s.level === 'amber').length;

  // The nearest still-valid expiry, for an at-a-glance heads-up at the top.
  const todayStart = new Date(new Date().toDateString());
  const soonest = docs
    .filter((d) => d.expiry_date && new Date(`${String(d.expiry_date).slice(0, 10)}T00:00:00`) >= todayStart)
    .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)))[0];

  // Meta line shared by core + additional rows.
  const metaBits = (d) => [
    d.document_number && `№ ${d.document_number}`,
    d.flag_state,
    d.issuing_authority,
    d.details?.grade,
    d.expiry_date ? `Expires ${formatDocDate(d.expiry_date)}` : 'No expiry',
  ].filter(Boolean);

  const renderActions = (d) => (
    <div className="flex items-center gap-2 flex-shrink-0">
      <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${EXPIRY_STATUS_CLASSES[getExpiryStatus(d.expiry_date).level]}`}>
        {getExpiryStatus(d.expiry_date).label}
      </span>
      {d.file_url && (
        <a href={d.file_url} target="_blank" rel="noreferrer" className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground" title="View file"><Icon name="Paperclip" size={15} /></a>
      )}
      {canEdit && (
        <>
          <button onClick={() => openEdit(d)} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground" title="Edit"><Icon name="Pencil" size={15} /></button>
          <button onClick={() => handleDelete(d)} className="p-1.5 hover:bg-red-50 rounded-lg text-red-500" title="Delete"><Icon name="Trash2" size={15} /></button>
        </>
      )}
    </div>
  );

  const renderDocRow = (d) => (
    <div key={d.id} className="cp-doc-row">
      <div className="min-w-0">
        <div className="cp-doc-title">{getDocTypeLabel(d.doc_type, d.details)}</div>
        <div className="cp-doc-meta">{metaBits(d).map((b, i) => <span key={i}>{b}</span>)}</div>
      </div>
      {renderActions(d)}
    </div>
  );

  const additional = docs.filter((d) => !CORE_DOCUMENT_TYPE_IDS.includes(d.doc_type));

  return (
    <div
      style={{ position: 'relative' }}
      onDragOver={canEdit ? (e) => { e.preventDefault(); setDragOver(true); } : undefined}
      onDragLeave={canEdit ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); } : undefined}
      onDrop={canEdit ? onDrop : undefined}
    >
      {dragOver && (
        <div
          className="flex flex-col items-center justify-center gap-2 text-sm font-semibold"
          style={{
            position: 'absolute', inset: 0, zIndex: 5, borderRadius: 14,
            border: '2px dashed #C65A1A', background: 'rgba(251,239,233,0.92)', color: '#7A2E1E',
            pointerEvents: 'none',
          }}
        >
          <Icon name="UploadCloud" size={28} style={{ color: '#C65A1A' }} />
          Drop to upload &amp; auto-fill
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div className="cp-section-head">
            <span className="cp-section-num">05 /</span>
            <h3>Documents</h3>
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <input
              ref={scanInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              onChange={onPickFiles}
              className="hidden"
            />
            <Button variant="outline" iconName="Sparkles" size="sm" onClick={() => scanInputRef.current?.click()}>
              Upload &amp; auto-fill
            </Button>
            <Button iconName="Plus" size="sm" onClick={() => openAdd()}>Add document</Button>
          </div>
        )}
      </div>

      {canEdit && (
        <p className="text-xs text-muted-foreground mb-4 flex items-center gap-1.5">
          <Icon name="UploadCloud" size={13} style={{ color: '#C65A1A' }} />
          Drag &amp; drop documents anywhere here, or use “Upload &amp; auto-fill”, to scan several at once.
        </p>
      )}

      {!loading && soonest && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg text-xs" style={{ background: '#FAFAF8', border: '1px solid #ECEAE3', color: '#6B7280' }}>
          <Icon name="CalendarClock" size={14} style={{ color: '#C65A1A' }} />
          <span>Soonest expiry: <strong style={{ color: '#1C1B3A' }}>{getDocTypeLabel(soonest.doc_type, soonest.details)}</strong> · {formatDocDate(soonest.expiry_date)}</span>
        </div>
      )}

      {!loading && (expiredCount > 0 || soonCount > 0) && (
        <div className="flex flex-wrap gap-2 mb-4">
          {expiredCount > 0 && (
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${EXPIRY_STATUS_CLASSES.expired}`}>
              <Icon name="AlertTriangle" size={13} /> {expiredCount} expired
            </span>
          )}
          {soonCount > 0 && (
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${EXPIRY_STATUS_CLASSES.amber}`}>
              <Icon name="Clock" size={13} /> {soonCount} expiring within 90 days
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16"><LogoSpinner size={32} /></div>
      ) : (
        <>
          {/* Core documents — always shown as slots */}
          <div className="cp-group">
            <div className="cp-group-head">
              <span className="dia">◆</span><span className="t">Required for all crew</span><span className="line" />
            </div>
            <div className="space-y-2">
              {coreDocumentTypes().map((t) => {
                const existing = docs.find((d) => d.doc_type === t.id);
                if (existing) return renderDocRow(existing);
                return (
                  <div key={t.id} className="cp-doc-row cp-doc-empty">
                    <div className="min-w-0">
                      <div className="cp-doc-title">{t.label}</div>
                      <div className="cp-doc-meta"><span>Not added yet</span></div>
                    </div>
                    {canEdit ? (
                      <Button variant="outline" size="xs" iconName="Plus" onClick={() => openAdd(t.id)}>Add</Button>
                    ) : (
                      <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold ${EXPIRY_STATUS_CLASSES.none}`}>Missing</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Additional documents — visas, role-specific quals, other */}
          {additional.length > 0 && DOC_CATEGORIES.map((cat) => {
            const rows = additional.filter((d) => (d.category || 'other') === cat.id);
            if (rows.length === 0) return null;
            return (
              <div className="cp-group" key={cat.id}>
                <div className="cp-group-head">
                  <span className="dia">◆</span><span className="t">{cat.label}</span><span className="line" />
                </div>
                <div className="space-y-2">{rows.map(renderDocRow)}</div>
              </div>
            );
          })}
        </>
      )}

      <AddDocumentModal
        isOpen={modalOpen}
        onClose={closeModal}
        onSaved={load}
        onProfileSynced={onProfileSynced}
        userId={userId}
        tenantId={tenantId}
        createdBy={createdBy}
        existing={editing}
        presetType={presetType}
        presetDetails={presetDetails}
      />

      <BatchReviewModal
        isOpen={!!batchFiles}
        files={batchFiles}
        onClose={() => setBatchFiles(null)}
        onSaved={load}
        onProfileSynced={onProfileSynced}
        userId={userId}
        tenantId={tenantId}
        createdBy={createdBy}
      />
    </div>
  );
};

export default DocumentsTab;
