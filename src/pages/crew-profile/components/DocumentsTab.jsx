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
  EXPIRY_STATUS_CLASSES, formatDocDate, groupDocumentVersions,
} from '../utils/crewDocuments';
import AddDocumentModal from './AddDocumentModal';
import BatchReviewModal from './BatchReviewModal';

// Each category's editorial face: a soft-tinted lucide glyph (no cheesy icons),
// reused on the overview tiles and the jump rail.
const CAT_STYLE = {
  travel:       { icon: 'Plane',         bg: '#ECEFF5', ink: '#5B6B8C' },
  medical:      { icon: 'HeartPulse',    bg: '#FBECEB', ink: '#C0504D' },
  safety:       { icon: 'LifeBuoy',      bg: '#E5F0ED', ink: '#2E7D6B' },
  deck:         { icon: 'Compass',       bg: '#E7EFF2', ink: '#3E6A8E' },
  engineering:  { icon: 'Wrench',        bg: '#F1EEF6', ink: '#6E5B97' },
  interior:     { icon: 'Wine',          bg: '#EEF3EA', ink: '#7C9A6B' },
  watersports:  { icon: 'Waves',         bg: '#E9F1F6', ink: '#4B85A8' },
  professional: { icon: 'Briefcase',     bg: '#F2F0EB', ink: '#8B7A55' },
  qualification:{ icon: 'GraduationCap', bg: '#F0EEF7', ink: '#6E5B97' },
  issued:       { icon: 'FileText',      bg: '#F2F0EB', ink: '#8B8478' },
  other:        { icon: 'Files',         bg: '#F0F1F5', ink: '#7A7E8C' },
};

// Departments we always surface as a tile so the page reads complete and invites
// filling the gaps; the remaining buckets appear only once they hold something.
const ALWAYS_SHOWN_CATS = ['travel', 'medical', 'safety', 'deck', 'engineering', 'interior', 'watersports', 'professional'];

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

  // ── Crew readiness — driven by the always-required core documents ─────────
  const coreTypes = coreDocumentTypes();
  const heldCore = coreTypes.filter((t) => currents.some((d) => d.doc_type === t.id)).length;
  const readinessPct = coreTypes.length ? Math.round((heldCore / coreTypes.length) * 100) : 100;
  const missingCoreCount = coreTypes.length - heldCore;

  const flagged = currents.map((d) => getExpiryStatus(d.expiry_date));
  const expiredCount = flagged.filter((s) => s.level === 'expired').length;
  const expiringCount = flagged.filter((s) => s.level === 'red' || s.level === 'amber').length;
  const attentionCount = expiredCount + expiringCount;

  const todayStart = new Date(new Date().toDateString());

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

  const renderDocRow = (d) => {
    const prev = previousById.get(d.id);
    const open = !!openPrev[d.id];
    return (
      <div key={d.id}>
        <div className="cp-doc-row">
          <div className="min-w-0">
            <div className="cp-doc-title">{getDocTypeLabel(d.doc_type, d.details)}</div>
            <div className="cp-doc-meta">{metaBits(d).map((b, i) => <span key={i}>{b}</span>)}</div>
          </div>
          {renderActions(d)}
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

  // ── Per-category summary used by the tiles + rail ─────────────────────────
  const summaryFor = (cat) => {
    const inCat = currents.filter((d) => catOf(d) === cat.id);
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
    else pill = { cls: 'ok', label: inCat.some((d) => d.expiry_date) ? (inCat.length > 1 ? 'All valid' : 'Valid') : 'Held' };

    let foot;
    if (expired.length) {
      const d = expired[0];
      foot = { label: 'Needs attention', value: `${getDocTypeLabel(d.doc_type, d.details)} expired ${formatDocDate(d.expiry_date)}`, bad: true };
    } else if (future.length) {
      const d = future[0];
      foot = { label: 'Soonest renewal', value: `${getDocTypeLabel(d.doc_type, d.details)} · ${formatDocDate(d.expiry_date)}` };
    } else if (counts.miss && inCat.length === 0) {
      foot = null;
    } else if (counts.miss) {
      foot = { label: 'Required', value: `${counts.miss} document${counts.miss > 1 ? 's' : ''} missing` };
    } else {
      foot = { label: 'On file', value: `${inCat.length} document${inCat.length > 1 ? 's' : ''} · no expiry` };
    }

    return {
      id: cat.id, label: cat.label, inCat, counts, segments, pill, foot, noExpiry,
      isEmpty: inCat.length === 0 && counts.miss === 0,
      attn: counts.bad > 0 || counts.amber > 0,
    };
  };

  const visibleCats = DOC_CATEGORIES.filter((c) =>
    ALWAYS_SHOWN_CATS.includes(c.id) || currents.some((d) => catOf(d) === c.id));
  const summaries = visibleCats.map(summaryFor);

  // ── Tiles ─────────────────────────────────────────────────────────────────
  const renderTile = (s) => {
    const st = CAT_STYLE[s.id] || CAT_STYLE.other;
    if (s.isEmpty) {
      return (
        <button
          key={s.id}
          type="button"
          className="cd-tile is-empty"
          onClick={canEdit ? () => openAdd() : undefined}
        >
          <div className="cd-tile-top">
            <span className="cd-ico" style={{ background: '#F1EFE9' }}><Icon name={st.icon} size={19} style={{ color: '#A8A296' }} /></span>
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
          <span className="cd-ico" style={{ background: st.bg }}><Icon name={st.icon} size={19} style={{ color: st.ink }} /></span>
          {s.pill && <span className={`cd-pill ${s.pill.cls}`}>{s.pill.label}</span>}
        </div>
        <div className="cd-tile-name">{s.label}</div>
        <div className="cd-tile-break">
          {[
            s.counts.bad ? <span key="b" className="rd">{s.counts.bad} expired</span> : null,
            s.counts.amber ? <span key="a">{s.counts.amber} expiring</span> : null,
            s.counts.ok ? <span key="o"><b>{s.counts.ok}</b> valid</span> : null,
            s.counts.miss ? <span key="m">{s.counts.miss} missing</span> : null,
          ].filter(Boolean).reduce((acc, el, i) => (i === 0 ? [el] : [...acc, <span key={`s${i}`} className="cd-sep"> · </span>, el]), [])}
          {s.noExpiry > 0 && s.counts.ok > 0 && !s.counts.bad && !s.counts.amber && (
            <span className="cd-faint">&nbsp;({s.noExpiry} no expiry)</span>
          )}
        </div>
        <div className="cd-spacer" />
        <div className="cd-bar">{s.segments.map((seg, i) => <i key={i} className={seg.cls} style={{ width: `${seg.width}%` }} />)}</div>
        {s.foot && (
          <div className="cd-soon">
            <span className="cd-eyebrow">{s.foot.label}&nbsp;</span>
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
    const rest = inCat.filter((d) => !coreIds.includes(d.doc_type));
    const st = CAT_STYLE[catId] || CAT_STYLE.other;
    return (
      <div>
        <div className="cd-detail-head">
          <span className="cd-ico" style={{ background: st.bg }}><Icon name={st.icon} size={18} style={{ color: st.ink }} /></span>
          <h4>{cat.label}</h4>
          {canEdit && <Button variant="outline" size="xs" iconName="Plus" onClick={() => openAdd()}>Add</Button>}
        </div>
        <div className="space-y-2">
          {coreInCat.map((t) => {
            const ex = inCat.find((d) => d.doc_type === t.id);
            return ex ? renderDocRow(ex) : renderEmptySlot(t);
          })}
          {rest.map(renderDocRow)}
          {coreInCat.length === 0 && rest.length === 0 && (
            <p className="cd-muted">No documents in this category yet.</p>
          )}
        </div>
      </div>
    );
  };

  // ── Flat lists: attention + all ──────────────────────────────────────────
  const attentionDocs = currents
    .filter((d) => ['bad', 'amber'].includes(bucketOf(d)))
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
    const dated = currents.filter((d) => d.expiry_date);
    const overdue = dated.filter((d) => getExpiryStatus(d.expiry_date).level === 'expired')
      .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
    const soon = dated.filter((d) => ['red', 'amber'].includes(getExpiryStatus(d.expiry_date).level))
      .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
    const later = dated.filter((d) => getExpiryStatus(d.expiry_date).level === 'green')
      .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
    const noExp = currents.filter((d) => !d.expiry_date);
    const section = (key, label, rows) => rows.length > 0 && (
      <div className="cp-group" key={key}>
        <div className="cp-group-head">
          <span className="dia">◆</span><span className="t">{label}</span><span className="line" />
        </div>
        <div className="space-y-2">{rows.map(renderDocRow)}</div>
      </div>
    );
    if (!dated.length && !noExp.length) return <p className="cd-muted">No documents yet.</p>;
    return (
      <div>
        {section('overdue', 'Overdue', overdue)}
        {section('soon', 'Next 90 days', soon)}
        {section('later', 'Later', later)}
        {section('noexp', "Doesn't expire", noExp)}
      </div>
    );
  };

  // The category body: overview grid, a drilled-in category, or the
  // needs-attention list. Tiles are the navigation — no separate side rail.
  const renderCategoryBody = () => {
    if (selected === '__attention') return renderAttention();
    if (selected && selected !== '__attention') return renderCategoryDetail(selected);
    return (
      <>
        <div className="cd-legend">
          <span className="cd-eyebrow">Each bar =</span>
          <span><i className="cd-sw ok" />Valid / no expiry</span>
          <span><i className="cd-sw amber" />Expiring ≤90 days</span>
          <span><i className="cd-sw bad" />Expired</span>
          <span><i className="cd-sw miss" />Missing (required)</span>
        </div>
        <div className="cd-grid">{summaries.map(renderTile)}</div>
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

      {loading ? (
        <div className="flex items-center justify-center py-16"><LogoSpinner size={32} /></div>
      ) : (
        <>
          {/* Crew readiness — required-document coverage at a glance */}
          <div className="cd-ready">
            <span className={`cd-ready-pct ${readinessPct === 100 ? 'is-full' : ''}`}>{readinessPct}%</span>
            <div className="cd-ready-body">
              <div className="cd-eyebrow">Crew readiness</div>
              <div className="cd-ready-t">{heldCore} of {coreTypes.length} required documents held · {missingCoreCount} missing</div>
              <div className="cd-ready-track"><i style={{ width: `${readinessPct}%` }} /></div>
            </div>
            <div className="cd-ready-att">
              {expiredCount > 0 && <button type="button" className="bad" onClick={() => { setMode('category'); setSelected('__attention'); }}>{expiredCount} expired</button>}
              {expiringCount > 0 && <button type="button" className="amb" onClick={() => { setMode('category'); setSelected('__attention'); }}>{expiringCount} expiring</button>}
              {attentionCount === 0 && <span className="ok">All in date</span>}
            </div>
          </div>

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
