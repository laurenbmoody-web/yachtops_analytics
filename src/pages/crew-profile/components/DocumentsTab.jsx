import React, { useState, useEffect, useCallback, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import LogoSpinner from '../../../components/LogoSpinner';
import { showToast } from '../../../utils/toast';
import {
  DOC_CATEGORIES, CORE_DOCUMENT_TYPE_IDS, coreDocumentTypes, getDocTypeLabel, getDocType,
} from '../documentTypes';
import {
  fetchCrewDocuments, deleteCrewDocument, getExpiryStatus,
  EXPIRY_STATUS_CLASSES, formatDocDate, groupDocumentVersions, findHistoricDocIds,
} from '../utils/crewDocuments';
import AddDocumentModal from './AddDocumentModal';
import BatchReviewModal from './BatchReviewModal';

// Each category's glyph (no cheesy icons). The chip is a single calm neutral
// across every category so colour only ever signals status (pills + bars),
// never category — a coloured icon was being read as an alert.
const CAT_ICON = {
  travel: 'Plane',
  medical: 'HeartPulse',
  safety: 'LifeBuoy',
  deck: 'Compass',
  engineering: 'Wrench',
  interior: 'Wine',
  watersports: 'Waves',
  professional: 'Briefcase',
  qualification: 'GraduationCap',
  issued: 'FileText',
  other: 'Files',
};
const catIcon = (id) => CAT_ICON[id] || CAT_ICON.other;
const ICON_BG = '#F0EFF3';
const ICON_INK = '#605D78';

// Traffic-light bucket for one document — colours always carry meaning:
//   ok = valid / in date OR simply doesn't expire (held & fine)
//   amber = expiring within 90 days · bad = expired
// (a category's grey "missing" segment comes from un-held required docs, below).
const bucketOf = (d) => {
  if (!d.expiry_date) return 'ok';
  const lvl = getExpiryStatus(d.expiry_date).level;
  if (lvl === 'expired') return 'bad';
  if (lvl === 'red' || lvl === 'amber') return 'amber';
  return 'ok';
};

const catOf = (d) => getDocType(d.doc_type)?.category || d.category || 'other';

const DocumentsTab = ({ userId, tenantId, createdBy, canEdit, openPreset, onPresetHandled, onProfileSynced }) => {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [presetType, setPresetType] = useState(null);
  const [presetDetails, setPresetDetails] = useState(null);

  // View state: "By category" (overview grid → drill into a category) vs the
  // flat "By renewal" timeline. `selected` is null on the overview, a category
  // id when drilled in, or the virtual '__attention' / '__all' lists.
  const [mode, setMode] = useState('category');
  const [selected, setSelected] = useState(null);
  const [showEmpty, setShowEmpty] = useState(false);

  // Batch upload — drop/select several files, parse + review them together.
  const [batchFiles, setBatchFiles] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const scanInputRef = useRef(null);
  // Expanded "earlier versions" rows, keyed by the current doc's id.
  const [openPrev, setOpenPrev] = useState({});

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

  // Show one live row per credential: the newest record is "current"; older
  // same-type records are superseded and tucked underneath. Alerts and the
  // soonest-expiry heads-up count only what's current, so a refreshed cert
  // silences the old one instead of double-counting it.
  const { currents, previousById } = groupDocumentVersions(docs);

  // A historic record (e.g. an expired combined STCW Basic that's been refreshed
  // via element revalidations) is still held, but shouldn't raise expiry alerts.
  const historicIds = findHistoricDocIds(currents);
  const isHistoric = (d) => historicIds.has(d.id);

  // The always-required core documents, used to surface empty required slots
  // within each category (status itself is shown per-folder on the tiles).
  const coreTypes = coreDocumentTypes();

  const todayStart = new Date(new Date().toDateString());

  // dd/mm/yyyy per the editorial design system (the tiles read tighter than the
  // long "05 Dec 2028" form).
  const fmtDate = (d) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : formatDocDate(d);
  };

  // Meta line shared by core + additional rows.
  const metaBits = (d) => [
    d.document_number && `№ ${d.document_number}`,
    d.flag_state,
    d.issuing_authority,
    d.details?.grade,
    d.expiry_date ? `Expires ${formatDocDate(d.expiry_date)}` : 'No expiry',
  ].filter(Boolean);

  const renderActions = (d, opts = {}) => (
    <div className="flex items-center gap-2 flex-shrink-0">
      {opts.historic ? (
        <span className="cd-historic-pill" title="Basic Safety Training is kept current through individual element refreshers (PST, FPFF). The original combined certificate is retained as a historic record.">
          Historic
        </span>
      ) : (
        <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${EXPIRY_STATUS_CLASSES[getExpiryStatus(d.expiry_date).level]}`}>
          {getExpiryStatus(d.expiry_date).label}
        </span>
      )}
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

  const renderDocRow = (d, opts = {}) => {
    const prev = previousById.get(d.id);
    const open = !!openPrev[d.id];
    const historic = opts.historic;
    return (
      <div key={d.id}>
        <div className={`cp-doc-row${historic ? ' cd-historic-row' : ''}`}>
          <div className="min-w-0">
            <div className="cp-doc-title">{getDocTypeLabel(d.doc_type, d.details)}</div>
            <div className="cp-doc-meta">
              {metaBits(d).map((b, i) => <span key={i}>{b}</span>)}
              {historic && <span className="cd-historic-note">Refreshed via element revalidations (PST, FPFF)</span>}
            </div>
          </div>
          {renderActions(d, { historic })}
        </div>
        {prev?.length > 0 && (
          <div style={{ paddingLeft: 2, marginTop: 2 }}>
            <button
              type="button"
              onClick={() => setOpenPrev((s) => ({ ...s, [d.id]: !s[d.id] }))}
              className="inline-flex items-center gap-1 text-[11px]"
              style={{ color: '#8B8478' }}
            >
              <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={12} />
              {prev.length} earlier version{prev.length > 1 ? 's' : ''} on file
            </button>
            {open && prev.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-1.5" style={{ borderTop: '1px dashed #ECEAE3' }}>
                <span className="text-[11px] text-muted-foreground truncate">
                  {[...metaBits(p), 'superseded'].join(' · ')}
                </span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {p.file_url && (
                    <a href={p.file_url} target="_blank" rel="noreferrer" className="p-1 hover:bg-muted rounded text-muted-foreground" title="View file"><Icon name="Paperclip" size={13} /></a>
                  )}
                  {canEdit && (
                    <button onClick={() => handleDelete(p)} className="p-1 hover:bg-red-50 rounded text-red-500" title="Delete this old version"><Icon name="Trash2" size={13} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // An un-held required document — dashed prompt to add it.
  const renderEmptySlot = (t) => (
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

  // ── Per-category summary used by the tiles ───────────────────────────────
  const summaryFor = (cat) => {
    const allInCat = currents.filter((d) => catOf(d) === cat.id);
    // Historic records are kept on file but don't drive status, counts or alerts.
    const inCat = allInCat.filter((d) => !isHistoric(d));
    const historic = allInCat.filter(isHistoric);
    const coreInCat = coreTypes.filter((t) => t.category === cat.id);
    const missingCore = coreInCat.filter((t) => !currents.some((d) => d.doc_type === t.id));

    const counts = { ok: 0, amber: 0, bad: 0, miss: missingCore.length };
    inCat.forEach((d) => { counts[bucketOf(d)] += 1; });
    const totalSeg = counts.ok + counts.amber + counts.bad + counts.miss;

    const order = [['bad', 'cd-bad'], ['amber', 'cd-amber'], ['ok', 'cd-ok'], ['miss', 'cd-miss']];
    const segments = totalSeg
      ? order.filter(([k]) => counts[k] > 0).map(([k, cls]) => ({ cls, width: (counts[k] / totalSeg) * 100 }))
      : [];

    const future = inCat
      .filter((d) => d.expiry_date && new Date(`${String(d.expiry_date).slice(0, 10)}T00:00:00`) >= todayStart)
      .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
    const expired = inCat
      .filter((d) => getExpiryStatus(d.expiry_date).level === 'expired')
      .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
    const noExpiry = inCat.filter((d) => !d.expiry_date).length;

    let pill;
    if (counts.bad) pill = { cls: 'bad', label: `${counts.bad} expired` };
    else if (counts.amber) pill = { cls: 'amber', label: `${counts.amber} expiring` };
    else if (counts.miss && inCat.length === 0) pill = null;
    else if (counts.miss) pill = { cls: 'miss', label: `${counts.miss} missing` };
    else if (inCat.length === 0) pill = null;
    else pill = { cls: 'ok', label: inCat.some((d) => d.expiry_date) ? (inCat.length > 1 ? 'All valid' : 'Valid') : 'Held' };

    let foot;
    if (expired.length) {
      const d = expired[0];
      foot = { label: 'Needs attention', value: `${getDocTypeLabel(d.doc_type, d.details)} expired ${fmtDate(d.expiry_date)}`, bad: true };
    } else if (future.length) {
      const d = future[0];
      foot = { label: 'Soonest renewal', value: `${getDocTypeLabel(d.doc_type, d.details)} · ${fmtDate(d.expiry_date)}` };
    } else if (counts.miss && inCat.length === 0) {
      foot = null;
    } else if (counts.miss) {
      foot = { label: 'Required', value: `${counts.miss} document${counts.miss > 1 ? 's' : ''} missing` };
    } else if (inCat.length > 0) {
      foot = { label: 'On file', value: `${inCat.length} document${inCat.length > 1 ? 's' : ''} · no expiry` };
    } else {
      foot = null;
    }

    return {
      id: cat.id, label: cat.label, inCat, historic, counts, segments, pill, foot, noExpiry,
      isEmpty: inCat.length === 0 && counts.miss === 0,
      attn: counts.bad > 0 || counts.amber > 0,
    };
  };

  // Only categories that actually hold something (or owe a required doc) show by
  // default; empty departments stay tucked away behind a reveal toggle so the
  // page isn't padded with blank tiles, but can still be opened to add to.
  const allSummaries = DOC_CATEGORIES.map(summaryFor);
  const activeSummaries = allSummaries.filter((s) => !s.isEmpty);
  const emptySummaries = allSummaries.filter((s) => s.isEmpty);

  // ── Tiles ─────────────────────────────────────────────────────────────────
  const renderTile = (s) => {
    if (s.isEmpty) {
      return (
        <button
          key={s.id}
          type="button"
          className="cd-tile is-empty"
          onClick={canEdit ? () => openAdd() : undefined}
        >
          <div className="cd-tile-top">
            <span className="cd-ico" style={{ background: '#F1EFE9' }}><Icon name={catIcon(s.id)} size={19} style={{ color: '#A8A296' }} /></span>
          </div>
          <div className="cd-tile-name">{s.label}</div>
          <div className="cd-tile-break">No documents yet</div>
          {canEdit && <div className="cd-tile-add">+ Add a document</div>}
        </button>
      );
    }
    return (
      <button key={s.id} type="button" className="cd-tile" onClick={() => setSelected(s.id)}>
        <div className="cd-tile-top">
          <span className="cd-ico" style={{ background: ICON_BG }}><Icon name={catIcon(s.id)} size={19} style={{ color: ICON_INK }} /></span>
          {s.pill && <span className={`cd-pill ${s.pill.cls}`}>{s.pill.label}</span>}
        </div>
        <div className="cd-tile-name">{s.label}</div>
        <div className="cd-bar">{s.segments.map((seg, i) => <i key={i} className={seg.cls} style={{ width: `${seg.width}%` }} />)}</div>
        {s.foot && (
          <div className="cd-soon">
            <span className={`cd-soon-v ${s.foot.bad ? 'bad' : ''}`}>{s.foot.value}</span>
          </div>
        )}
      </button>
    );
  };

  // ── Drill-in: one category's documents (core slots + held docs) ──────────
  const renderCategoryDetail = (catId) => {
    const cat = DOC_CATEGORIES.find((c) => c.id === catId);
    if (!cat) return null;
    const coreInCat = coreTypes.filter((t) => t.category === catId);
    const coreIds = coreInCat.map((t) => t.id);
    const inCat = currents.filter((d) => catOf(d) === catId);
    const rest = inCat.filter((d) => !coreIds.includes(d.doc_type) && !isHistoric(d));
    // Non-core historic records get tucked into their own subsection; a historic
    // core record (e.g. STCW Basic) stays inline so the requirement reads as met.
    const restHistoric = inCat.filter((d) => !coreIds.includes(d.doc_type) && isHistoric(d));
    return (
      <div>
        <div className="cd-detail-head">
          <span className="cd-ico" style={{ background: ICON_BG }}><Icon name={catIcon(catId)} size={18} style={{ color: ICON_INK }} /></span>
          <h4>{cat.label}</h4>
          {canEdit && <Button variant="outline" size="xs" iconName="Plus" onClick={() => openAdd()}>Add</Button>}
        </div>
        <div className="space-y-2">
          {coreInCat.map((t) => {
            const ex = inCat.find((d) => d.doc_type === t.id);
            return ex ? renderDocRow(ex, { historic: isHistoric(ex) }) : renderEmptySlot(t);
          })}
          {rest.map((d) => renderDocRow(d))}
          {coreInCat.length === 0 && rest.length === 0 && restHistoric.length === 0 && (
            <p className="cd-muted">No documents in this category yet.</p>
          )}
        </div>
        {restHistoric.length > 0 && (
          <div className="cd-historic-group">
            <div className="cd-historic-head">Historic — kept on file, not counted toward expiries</div>
            <div className="space-y-2">{restHistoric.map((d) => renderDocRow(d, { historic: true }))}</div>
          </div>
        )}
      </div>
    );
  };

  // ── Flat lists: attention + all ──────────────────────────────────────────
  const attentionDocs = currents
    .filter((d) => !isHistoric(d) && ['bad', 'amber'].includes(bucketOf(d)))
    .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));

  const renderAttention = () => (
    <div>
      <div className="cd-detail-head">
        <span className="cd-ico" style={{ background: '#FBE9E7' }}><Icon name="AlertTriangle" size={18} style={{ color: '#A32D2D' }} /></span>
        <h4>Needs attention</h4>
      </div>
      {attentionDocs.length ? (
        <div className="space-y-2">{attentionDocs.map(renderDocRow)}</div>
      ) : (
        <p className="cd-muted">Nothing expired or expiring within 90 days.</p>
      )}
    </div>
  );

  // ── By renewal — flat chronological timeline ─────────────────────────────
  const renderRenewalTimeline = () => {
    const active = currents.filter((d) => !isHistoric(d));
    const dated = active.filter((d) => d.expiry_date);
    const overdue = dated.filter((d) => getExpiryStatus(d.expiry_date).level === 'expired')
      .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
    const soon = dated.filter((d) => ['red', 'amber'].includes(getExpiryStatus(d.expiry_date).level))
      .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
    const later = dated.filter((d) => getExpiryStatus(d.expiry_date).level === 'green')
      .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
    const noExp = active.filter((d) => !d.expiry_date);
    const historic = currents.filter(isHistoric);
    const section = (key, label, rows, opts = {}) => rows.length > 0 && (
      <div className="cp-group" key={key}>
        <div className="cp-group-head">
          <span className="dia">◆</span><span className="t">{label}</span><span className="line" />
        </div>
        <div className="space-y-2">{rows.map((d) => renderDocRow(d, opts))}</div>
      </div>
    );
    if (!dated.length && !noExp.length && !historic.length) return <p className="cd-muted">No documents yet.</p>;
    return (
      <div>
        {section('overdue', 'Overdue', overdue)}
        {section('soon', 'Next 90 days', soon)}
        {section('later', 'Later', later)}
        {section('noexp', "Doesn't expire", noExp)}
        {section('historic', 'Historic', historic, { historic: true })}
      </div>
    );
  };

  // The category body: overview grid, a drilled-in category, or the
  // needs-attention list. Tiles are the navigation — no separate side rail.
  const renderCategoryBody = () => {
    if (selected === '__attention') return renderAttention();
    if (selected && selected !== '__attention') return renderCategoryDetail(selected);
    const shown = showEmpty ? [...activeSummaries, ...emptySummaries] : activeSummaries;
    return (
      <>
        <div className="cd-grid">{shown.map(renderTile)}</div>
        {emptySummaries.length > 0 && (
          <button type="button" className="cd-show-empty" onClick={() => setShowEmpty((v) => !v)}>
            <Icon name={showEmpty ? 'ChevronUp' : 'Plus'} size={13} />
            {showEmpty
              ? 'Hide empty folders'
              : `Show ${emptySummaries.length} more ${emptySummaries.length === 1 ? 'folder' : 'folders'}`}
          </button>
        )}
      </>
    );
  };

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
            <Button
              variant="outline"
              iconName="Sparkles"
              size="sm"
              onClick={() => scanInputRef.current?.click()}
              title="Scan several at once — or drag &amp; drop documents anywhere on this tab to auto-fill them."
            >
              Upload &amp; auto-fill
            </Button>
            <Button iconName="Plus" size="sm" onClick={() => openAdd()}>Add document</Button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><LogoSpinner size={32} /></div>
      ) : (
        <>
          {/* Controls — view toggle + breadcrumb */}
          <div className="cd-controls">
            <div className="cd-eyebrow">
              {mode === 'renewal' ? 'Documents by renewal date'
                : selected === null ? 'Documents by category'
                : (
                  <button type="button" className="cd-crumb" onClick={() => setSelected(null)}>
                    <Icon name="ChevronLeft" size={12} /> All categories
                  </button>
                )}
            </div>
            <div className="cd-seg">
              <button type="button" className={mode === 'category' ? 'on' : ''} onClick={() => setMode('category')}>By category</button>
              <button type="button" className={mode === 'renewal' ? 'on' : ''} onClick={() => setMode('renewal')}>By renewal</button>
            </div>
          </div>

          {mode === 'renewal' ? renderRenewalTimeline() : renderCategoryBody()}
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
        existingDocs={docs}
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
        existingDocs={docs}
      />
    </div>
  );
};

export default DocumentsTab;
