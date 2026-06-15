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
  EXPIRY_STATUS_CLASSES, formatDocDate, parseDocumentFile,
} from '../utils/crewDocuments';
import AddDocumentModal from './AddDocumentModal';

const DocumentsTab = ({ userId, tenantId, createdBy, canEdit }) => {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [presetType, setPresetType] = useState(null);

  // AI scan-and-autofill queue.
  const [prefill, setPrefill] = useState(null);
  const [prefillFile, setPrefillFile] = useState(null);
  const [scanQueue, setScanQueue] = useState([]);
  const [scanIdx, setScanIdx] = useState(0);
  const [scanning, setScanning] = useState(false);
  const scanInputRef = useRef(null);

  const processOne = useCallback(async (files, idx) => {
    setScanning(true);
    try {
      const suggestion = await parseDocumentFile(files[idx]);
      setEditing(null);
      setPresetType(null);
      setPrefill(suggestion);
      setPrefillFile(files[idx]);
      setModalOpen(true);
    } catch (e) {
      showToast(`Couldn't read ${files[idx]?.name || 'file'}`, 'error');
      if (idx + 1 < files.length) { setScanIdx(idx + 1); processOne(files, idx + 1); }
      else { setScanQueue([]); setScanIdx(0); }
    } finally {
      setScanning(false);
    }
  }, []);

  const onScanFiles = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setScanQueue(files);
    setScanIdx(0);
    processOne(files, 0);
  };

  // Closing the modal (saved or cancelled) advances the scan queue.
  const closeModal = () => {
    setModalOpen(false);
    setPrefill(null);
    setPrefillFile(null);
    if (scanQueue.length && scanIdx + 1 < scanQueue.length) {
      const next = scanIdx + 1;
      setScanIdx(next);
      processOne(scanQueue, next);
    } else {
      setScanQueue([]);
      setScanIdx(0);
    }
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
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div className="cp-section-head">
            <span className="cp-section-kicker">03 / Documents</span>
            <h3>Documents</h3>
          </div>
          <p className="cp-section-sub">Travel documents, medical &amp; safety certificates, and qualifications — with expiry tracking.</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <input
              ref={scanInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              onChange={onScanFiles}
              className="hidden"
            />
            <Button variant="outline" iconName="Sparkles" size="sm" onClick={() => scanInputRef.current?.click()}>
              Scan &amp; auto-fill
            </Button>
            <Button iconName="Plus" size="sm" onClick={() => openAdd()}>Add document</Button>
          </div>
        )}
      </div>

      {scanning && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg text-xs" style={{ background: '#FAEEDA', color: '#7A2E1E' }}>
          <LogoSpinner size={14} />
          <span>Reading document{scanQueue.length > 1 ? ` ${scanIdx + 1} of ${scanQueue.length}` : ''} with AI…</span>
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
        userId={userId}
        tenantId={tenantId}
        createdBy={createdBy}
        existing={editing}
        presetType={presetType}
        prefill={prefill}
        prefillFile={prefillFile}
      />
    </div>
  );
};

export default DocumentsTab;
