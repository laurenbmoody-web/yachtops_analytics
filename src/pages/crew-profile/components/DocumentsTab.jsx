import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import LogoSpinner from '../../../components/LogoSpinner';
import { showToast } from '../../../utils/toast';
import { DOC_CATEGORIES, getDocTypeLabel } from '../documentTypes';
import {
  fetchCrewDocuments, deleteCrewDocument, getExpiryStatus,
  EXPIRY_STATUS_CLASSES, formatDocDate,
} from '../utils/crewDocuments';
import AddDocumentModal from './AddDocumentModal';

const DocumentsTab = ({ userId, tenantId, createdBy, canEdit }) => {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

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

  const openAdd = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (d) => { setEditing(d); setModalOpen(true); };

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

  // Expiry summary across all docs.
  const flagged = docs.map((d) => getExpiryStatus(d.expiry_date));
  const expiredCount = flagged.filter((s) => s.level === 'expired').length;
  const soonCount = flagged.filter((s) => s.level === 'red' || s.level === 'amber').length;

  return (
    <div>
      <div className="cp-section-head" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="cp-section-kicker">03 / Documents</span>
          <h3>Documents</h3>
        </div>
        {canEdit && <Button iconName="Plus" onClick={openAdd} size="sm">Add document</Button>}
      </div>
      <p className="cp-section-sub">Travel documents, medical &amp; safety certificates, and qualifications — with expiry tracking.</p>

      {/* Expiry summary */}
      {!loading && docs.length > 0 && (expiredCount > 0 || soonCount > 0) && (
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
      ) : docs.length === 0 ? (
        <div className="cp-field-card text-center py-10">
          <Icon name="FileText" size={32} className="text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No documents yet.</p>
          {canEdit && <Button variant="outline" size="sm" iconName="Plus" className="mt-3" onClick={openAdd}>Add the first one</Button>}
        </div>
      ) : (
        DOC_CATEGORIES.map((cat) => {
          const rows = docs.filter((d) => (d.category || 'other') === cat.id);
          if (rows.length === 0) return null;
          return (
            <div className="cp-group" key={cat.id}>
              <div className="cp-group-head">
                <span className="dia">◆</span><span className="t">{cat.label}</span><span className="line" />
              </div>
              <div className="space-y-2">
                {rows.map((d) => {
                  const s = getExpiryStatus(d.expiry_date);
                  return (
                    <div key={d.id} className="cp-doc-row">
                      <div className="min-w-0">
                        <div className="cp-doc-title">{getDocTypeLabel(d.doc_type, d.details)}</div>
                        <div className="cp-doc-meta">
                          {d.document_number && <span>№ {d.document_number}</span>}
                          {d.flag_state && <span>{d.flag_state}</span>}
                          {d.issuing_authority && <span>{d.issuing_authority}</span>}
                          {d.details?.grade && <span>{d.details.grade}</span>}
                          <span>{d.expiry_date ? `Expires ${formatDocDate(d.expiry_date)}` : 'No expiry'}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${EXPIRY_STATUS_CLASSES[s.level]}`}>
                          {s.label}
                        </span>
                        {d.file_url && (
                          <a href={d.file_url} target="_blank" rel="noreferrer" className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground" title="View file">
                            <Icon name="Paperclip" size={15} />
                          </a>
                        )}
                        {canEdit && (
                          <>
                            <button onClick={() => openEdit(d)} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground" title="Edit"><Icon name="Pencil" size={15} /></button>
                            <button onClick={() => handleDelete(d)} className="p-1.5 hover:bg-red-50 rounded-lg text-red-500" title="Delete"><Icon name="Trash2" size={15} /></button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      <AddDocumentModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={load}
        userId={userId}
        tenantId={tenantId}
        createdBy={createdBy}
        existing={editing}
      />
    </div>
  );
};

export default DocumentsTab;
