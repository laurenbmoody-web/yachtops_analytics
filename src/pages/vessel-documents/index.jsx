// Vessel Documents — the ship's master documents vault. A file/folder tree for
// statutory & class certificates, insurance, manuals & plans, and anything else
// the vessel needs to keep. Command/Chief only. Files carry an optional expiry
// date so certificate renewals surface with a RAG status pill.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import '../../styles/editorial.css';
import { useTenant } from '../../contexts/TenantContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  fetchChildren, fetchBreadcrumb, fetchShelf, createFolder, uploadFile,
  renameItem, setExpiry, deleteItem, getFileUrl, moveItem, fetchFolders,
  seedDefaultFolders, getExpiryStatus, formatDocDate, isVirtualId,
  VIRT_HOR, VIRT_CREW, VIRT_TEMPLATES,
} from './vesselDocuments';
import './vessel-documents.css';

// Editorial RAG colours for expiry pills (mirrors the crew-doc thresholds).
const PILL = {
  expired: { bg: '#FBE4DC', fg: '#9A2B12' },
  red:     { bg: '#FBE4DC', fg: '#9A2B12' },
  amber:    { bg: '#FBEFD9', fg: '#8A5A12' },
  green:    { bg: '#E3EFE4', fg: '#3F7A52' },
  advisory: { bg: '#F0F1F5', fg: '#6B7280' },
  none:     { bg: '#F0F1F5', fg: '#8B8478' },
};

const fmtSize = (n) => {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

export default function VesselDocuments() {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const [cwd, setCwd] = useState(null);          // current folder id (null = root)
  const [items, setItems] = useState([]);
  const [shelf, setShelf] = useState(null);      // root landing: folder cards + linked + root files
  const [crumbs, setCrumbs] = useState([]);      // [{id, name}] root→here
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [prompt, setPrompt] = useState(null);    // { mode, item }  text/date modal
  const [promptValue, setPromptValue] = useState('');
  const [move, setMove] = useState(null);        // { item, cwd, crumbs, folders } move picker
  const [crewSort, setCrewSort] = useState('az'); // crew cert organise: az|za|expiry|tenure
  const [crewDept, setCrewDept] = useState('all'); // crew cert department filter
  const [crewDocSort, setCrewDocSort] = useState('status'); // member docs: status|az|za|expiry
  const [crewDocCat, setCrewDocCat] = useState('all'); // member docs: category filter
  const fileRef = useRef(null);
  const seededRef = useRef(null);                // tenant whose empty vault we've already seeded

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2800); };

  const load = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    try {
      if (!cwd) {
        // Root → the Shelf (folder cards + linked stores + any loose files).
        let s = await fetchShelf({ tenantId: activeTenantId });
        // First time an account opens an empty vault, lay down the starter
        // folders so it doesn't start blank. Idempotent and one-shot per tenant.
        if (seededRef.current !== activeTenantId && s.folders.length === 0 && s.rootFiles.length === 0) {
          seededRef.current = activeTenantId;
          try {
            const created = await seedDefaultFolders({ tenantId: activeTenantId, createdBy: userId });
            if (created.length) { s = await fetchShelf({ tenantId: activeTenantId }); flash('Added starter folders'); }
          } catch { /* leave the vault empty if seeding fails */ }
        }
        setShelf(s);
        setItems([]);
        setCrumbs([]);
      } else {
        // Inside a folder → the Index (editorial list).
        const [kids, chain] = await Promise.all([
          fetchChildren({ tenantId: activeTenantId, parentId: cwd }),
          fetchBreadcrumb({ tenantId: activeTenantId, folderId: cwd }),
        ]);
        setItems(kids);
        setCrumbs(chain);
        setShelf(null);
      }
    } catch (e) {
      console.error(e);
      flash('Couldn’t load the vault');
    } finally {
      setLoading(false);
    }
  }, [activeTenantId, cwd]);

  useEffect(() => { load(); }, [load]);
  // Reset per-folder filters when you move between folders.
  useEffect(() => { setCrewDept('all'); setCrewDocCat('all'); }, [cwd]);

  const folders = items.filter((i) => i.kind === 'folder');
  const files = items.filter((i) => i.kind === 'file');

  // ── Actions ─────────────────────────────────────────────────────────────
  const openNewFolder = () => { setPromptValue(''); setPrompt({ mode: 'new-folder' }); };
  const openRename = (item) => { setPromptValue(item.name); setPrompt({ mode: 'rename', item }); };
  const openExpiry = (item) => { setPromptValue(item.expiry_date || ''); setPrompt({ mode: 'expiry', item }); };

  const submitPrompt = async () => {
    if (!prompt) return;
    setBusy(true);
    try {
      if (prompt.mode === 'new-folder') {
        await createFolder({ tenantId: activeTenantId, parentId: cwd, name: promptValue, createdBy: userId });
        flash('Folder created');
      } else if (prompt.mode === 'rename') {
        await renameItem({ id: prompt.item.id, name: promptValue });
        flash('Renamed');
      } else if (prompt.mode === 'expiry') {
        await setExpiry({ id: prompt.item.id, expiryDate: promptValue || null });
        flash(promptValue ? 'Expiry set' : 'Expiry cleared');
      }
      setPrompt(null);
      await load();
    } catch (e) {
      flash(e?.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const onPickFiles = async (e) => {
    const list = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-selecting the same file
    if (!list.length) return;
    setBusy(true);
    try {
      // eslint-disable-next-line no-await-in-loop
      for (const file of list) await uploadFile({ tenantId: activeTenantId, parentId: cwd, file, createdBy: userId });
      flash(list.length === 1 ? 'File uploaded' : `${list.length} files uploaded`);
      await load();
    } catch (err) {
      flash(err?.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (item) => {
    // Crew docs carry a stored signed URL; vault/HOR/template files re-sign by path.
    const url = item.url || await getFileUrl(item.storage_path, item.bucket);
    if (url) window.open(url, '_blank', 'noopener');
    else flash('Couldn’t open that file');
  };

  // ── Move ────────────────────────────────────────────────────────────────
  // A mini folder-browser: navigate the real tree and drop the item into the
  // folder you land on. The item being moved (and its own subtree, for folders)
  // is excluded so you can't re-parent it into itself.
  const loadMoveFolders = useCallback(async (item, dest) => {
    const [kids, chain] = await Promise.all([
      fetchFolders({ tenantId: activeTenantId, parentId: dest }),
      dest ? fetchBreadcrumb({ tenantId: activeTenantId, folderId: dest }) : Promise.resolve([]),
    ]);
    return { folders: kids.filter((f) => f.id !== item.id), crumbs: chain };
  }, [activeTenantId]);

  const openMove = async (item) => {
    const { folders: f, crumbs: c } = await loadMoveFolders(item, null);
    setMove({ item, cwd: null, crumbs: c, folders: f });
  };

  const moveBrowse = async (dest) => {
    const { folders: f, crumbs: c } = await loadMoveFolders(move.item, dest);
    setMove((m) => ({ ...m, cwd: dest, crumbs: c, folders: f }));
  };

  const confirmMove = async () => {
    setBusy(true);
    try {
      await moveItem({ tenantId: activeTenantId, id: move.item.id, newParentId: move.cwd });
      setMove(null);
      flash('Moved');
      await load();
    } catch (e) {
      flash(e?.message || 'Couldn’t move');
    } finally {
      setBusy(false);
    }
  };

  const removeItem = async (item) => {
    const msg = item.kind === 'folder'
      ? `Delete folder “${item.name}” and everything inside it? This can’t be undone.`
      : `Delete “${item.name}”? This can’t be undone.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await deleteItem({ tenantId: activeTenantId, item });
      flash('Deleted');
      await load();
    } catch (e) {
      flash(e?.message || 'Couldn’t delete');
    } finally {
      setBusy(false);
    }
  };

  // ── Shelf cards (root landing) ────────────────────────────────────────────
  const renderCard = (f) => {
    const total = f.total || 0;
    const segs = [
      { n: f.valid, c: '#3F7A52' },
      { n: f.lapsing, c: '#8A5A12' },
      { n: f.expired, c: '#9A2B12' },
    ].filter((s) => s.n > 0);
    let chip = null;
    if (f.expired) chip = { cls: 'red', txt: `${f.expired} expired` };
    else if (f.lapsing) chip = { cls: 'amber', txt: `${f.lapsing} lapsing` };
    else if (total) chip = { cls: 'green', txt: 'all current' };
    const parts = [];
    if (f.valid) parts.push(`${f.valid} current`);
    if (f.lapsing) parts.push(`${f.lapsing} lapsing`);
    if (f.expired) parts.push(`${f.expired} expired`);
    return (
      <button type="button" key={f.id} className="vd-card" onClick={() => setCwd(f.id)}>
        <div className="vd-card-top">
          <span className="vd-card-ico"><Icon name="Folder" size={18} /></span>
          {chip && <span className={`vd-chip ${chip.cls}`}>{chip.txt}</span>}
        </div>
        <h3 className="vd-card-h">{f.name}</h3>
        <div className="vd-card-sub">{total ? parts.join(' · ') : 'Empty'}</div>
        <div className="vd-card-bar">
          {total ? segs.map((s, i) => <i key={i} style={{ width: `${(s.n / total) * 100}%`, background: s.c }} />)
            : <i style={{ width: '100%', background: '#ECEAE3' }} />}
        </div>
        <div className="vd-card-foot">
          <span>{total} document{total !== 1 ? 's' : ''}</span>
          <span>{f.lastUpdated ? `Updated ${formatDocDate(f.lastUpdated)}` : '—'}</span>
        </div>
      </button>
    );
  };

  const renderLinkedCard = (key, name, sub, count, unit) => (
    <button type="button" key={key} className="vd-card vd-card-linked" onClick={() => setCwd(key)}>
      <div className="vd-card-top">
        <span className="vd-card-ico vd-card-ico-linked"><Icon name="FolderSymlink" size={18} /></span>
        <span className="vd-chip link">linked</span>
      </div>
      <h3 className="vd-card-h">{name}</h3>
      <div className="vd-card-sub">{sub}</div>
      <div className="vd-card-bar"><i style={{ width: '100%', background: '#AEB4C2' }} /></div>
      <div className="vd-card-foot">
        <span>{count} {unit}{count !== 1 ? 's' : ''}</span>
        <span>Read-only</span>
      </div>
    </button>
  );

  // ── Index rows (inside a folder) ──────────────────────────────────────────
  const renderFolder = (f) => (
    <button type="button" key={f.id} className={`vd-idx-row vd-idx-folder${f.system ? ' vd-idx-system' : ''}`} onClick={() => setCwd(f.id)}>
      <span className={`vd-idx-fico${f.system ? ' vd-idx-linked' : ''}`}>
        <Icon name={f.system ? 'FolderSymlink' : 'Folder'} size={17} />
      </span>
      <span className="vd-idx-nm">{f.name}</span>
      <span className="vd-idx-lead" />
      <span className="vd-idx-rt">
        {f.expiringCount > 0 && (
          <span className="vd-pill" style={{ background: PILL.amber.bg, color: PILL.amber.fg }} title="Documents expiring within 90 days">
            {f.expiringCount} expiring
          </span>
        )}
        {f.soonestExpiry && !f.expiringCount ? (
          <span className="vd-idx-meta" title={`Next renewal ${formatDocDate(f.soonestExpiry)}`}>Next {formatDocDate(f.soonestExpiry)}</span>
        ) : (
          <span className="vd-idx-meta">{f.meta || 'Folder'}</span>
        )}
      </span>
      <Icon name="ChevronRight" size={15} className="vd-idx-go" />
      {!f.system && (
        <span className="vd-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="vd-act" title="Move" onClick={() => openMove(f)}><Icon name="FolderInput" size={15} /></button>
          <button type="button" className="vd-act" title="Rename" onClick={() => openRename(f)}><Icon name="Pencil" size={15} /></button>
          <button type="button" className="vd-act vd-act-danger" title="Delete" onClick={() => removeItem(f)}><Icon name="Trash2" size={15} /></button>
        </span>
      )}
    </button>
  );

  const renderFile = (f, n) => {
    // Crew docs carry a precomputed (advisory-aware) status; others derive from date.
    const st = f.statusLevel ? { level: f.statusLevel, label: f.statusLabel } : getExpiryStatus(f.expiry_date);
    const pill = PILL[st.level] || PILL.none;
    return (
      <div key={f.id} className="vd-idx-row" role="button" tabIndex={0} onClick={() => openFile(f)} onKeyDown={(e) => { if (e.key === 'Enter') openFile(f); }}>
        <span className="vd-idx-num">{String(n).padStart(2, '0')}</span>
        <span className="vd-idx-nm">{f.name}</span>
        <span className="vd-idx-lead" />
        <span className="vd-idx-rt">
          {f.readOnly && f.meta && <span className="vd-linkmeta">{f.meta}</span>}
          {f.historic ? (
            <span className="vd-pill" style={{ background: '#F0F1F5', color: '#8B8478' }} title={f.expiry_date ? `Superseded — last valid ${formatDocDate(f.expiry_date)}` : 'Kept on file — superseded by a newer record'}>
              Historic
            </span>
          ) : f.expiry_date ? (
            <span className="vd-pill" style={{ background: pill.bg, color: pill.fg }} title={st.level === 'advisory' ? 'Recommended refresh — not mandatory' : `Expires ${formatDocDate(f.expiry_date)}`}>
              {st.level === 'green' ? `Valid · ${formatDocDate(f.expiry_date)}` : st.label}
            </span>
          ) : null}
          {f.size_bytes ? <span className="vd-size">{fmtSize(f.size_bytes)}</span> : null}
        </span>
        <span className="vd-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="vd-act" title="Open / download" onClick={() => openFile(f)}><Icon name="Download" size={15} /></button>
          {!f.readOnly && (
            <>
              <button type="button" className="vd-act" title="Move" onClick={() => openMove(f)}><Icon name="FolderInput" size={15} /></button>
              <button type="button" className="vd-act" title="Set expiry date" onClick={() => openExpiry(f)}><Icon name="CalendarClock" size={15} /></button>
              <button type="button" className="vd-act" title="Rename" onClick={() => openRename(f)}><Icon name="Pencil" size={15} /></button>
              <button type="button" className="vd-act vd-act-danger" title="Delete" onClick={() => removeItem(f)}><Icon name="Trash2" size={15} /></button>
            </>
          )}
        </span>
      </div>
    );
  };

  // ── Crew Documents virtual tree — four levels keyed off the cwd id ────────
  //   virt:crew → groups · virt:crew:<g> → members · …:<uid> → buckets · …:<b> → files
  const crewParts = (typeof cwd === 'string' && cwd.startsWith(VIRT_CREW)) ? cwd.split(':') : [];
  const inCrewRoot = cwd === VIRT_CREW;                                   // Active/Former folders
  const inCrewGroup = crewParts.length === 3 && crewParts[1] === 'crew';  // member folders
  const inCrewMember = crewParts.length === 4 && crewParts[1] === 'crew'; // Certificates/Documents/Expired folders
  const inCrewBucket = crewParts.length === 5 && crewParts[1] === 'crew'; // files
  const crewDepts = inCrewGroup
    ? Array.from(new Set(items.map((i) => i.dept || '—'))).sort((a, b) => a.localeCompare(b))
    : [];
  const crewComparator = (mode) => (a, b) => {
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (mode === 'za') return -byName;
    if (mode === 'expiry') return (a.soonestExpiry || '9999').localeCompare(b.soonestExpiry || '9999') || byName;
    if (mode === 'tenure') return (a.since || '9999').localeCompare(b.since || '9999') || byName;
    return byName;
  };
  const crewRows = inCrewGroup
    ? items
      .filter((i) => crewDept === 'all' || (i.dept || '—') === crewDept)
      .slice()
      .sort(crewComparator(crewSort))
    : [];

  const renderCrewBar = () => (
    <div className="vd-crewbar">
      <span className="vd-crewbar-count"><Icon name="Users" size={14} /> {items.length} crew · {crewRows.length} shown</span>
      <div className="vd-crewbar-controls">
        <label className="vd-select-wrap">
          <span>Dept</span>
          <select className="vd-select" value={crewDept} onChange={(e) => setCrewDept(e.target.value)}>
            <option value="all">All departments</option>
            {crewDepts.map((d) => <option key={d} value={d}>{d === '—' ? 'No department' : d}</option>)}
          </select>
        </label>
        <label className="vd-select-wrap">
          <span>Sort</span>
          <select className="vd-select" value={crewSort} onChange={(e) => setCrewSort(e.target.value)}>
            <option value="az">Name A–Z</option>
            <option value="za">Name Z–A</option>
            <option value="expiry">Soonest expiry</option>
            <option value="tenure">Longest standing</option>
          </select>
        </label>
      </div>
    </div>
  );

  // ── Crew member's documents (inside a bucket): filter by category, sort ────
  const crewDocCats = inCrewBucket
    ? Array.from(new Map(files.map((f) => [f.cat, f.catLabel])).entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
    : [];
  const crewDocComparator = (mode) => (a, b) => {
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    const byExp = String(a.expiry_date || '9999').localeCompare(String(b.expiry_date || '9999'));
    if (mode === 'az') return byName;
    if (mode === 'za') return -byName;
    if (mode === 'expiry') {
      if (!!a.historic !== !!b.historic) return a.historic ? 1 : -1;
      return byExp || byName;
    }
    // status: live → advisory → historic, then soonest expiry
    const rank = (d) => (d.historic ? 3 : d.statusLevel === 'advisory' ? 2 : 1);
    return (rank(a) - rank(b)) || byExp || byName;
  };
  const crewDocFiles = inCrewBucket
    ? files
      .filter((f) => crewDocCat === 'all' || f.cat === crewDocCat)
      .slice()
      .sort(crewDocComparator(crewDocSort))
    : [];

  const renderCrewDocBar = () => (
    <div className="vd-crewbar">
      <span className="vd-crewbar-count"><Icon name="FileText" size={14} /> {files.length} documents · {crewDocFiles.length} shown</span>
      <div className="vd-crewbar-controls">
        <label className="vd-select-wrap">
          <span>Category</span>
          <select className="vd-select" value={crewDocCat} onChange={(e) => setCrewDocCat(e.target.value)}>
            <option value="all">All categories</option>
            {crewDocCats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="vd-select-wrap">
          <span>Sort</span>
          <select className="vd-select" value={crewDocSort} onChange={(e) => setCrewDocSort(e.target.value)}>
            <option value="status">Status</option>
            <option value="az">Name A–Z</option>
            <option value="za">Name Z–A</option>
            <option value="expiry">Soonest expiry</option>
          </select>
        </label>
      </div>
    </div>
  );

  const renderCrewFolder = (f) => {
    const sub = [f.role, f.dept].filter(Boolean).join(' · ');
    const sinceYear = f.since ? new Date(f.since).getFullYear() : null;
    return (
      <button type="button" key={f.id} className="vd-idx-row vd-crew-row" onClick={() => setCwd(f.id)}>
        <span className="vd-idx-fico vd-idx-linked"><Icon name="User" size={17} /></span>
        <span className="vd-crew-main">
          <span className="vd-crew-name">{f.name}</span>
          <span className="vd-crew-sub">{sub || 'No department'}{crewSort === 'tenure' && sinceYear ? ` · since ${sinceYear}` : ''}</span>
        </span>
        <span className="vd-idx-lead" />
        <span className="vd-idx-rt">
          {f.expiredCount > 0 && <span className="vd-pill" style={{ background: '#FBE4DC', color: '#9A2B12' }}>{f.expiredCount} expired</span>}
          <span className="vd-idx-meta">{f.meta}</span>
        </span>
        <Icon name="ChevronRight" size={15} className="vd-idx-go" />
      </button>
    );
  };

  return (
    <>
      <Header />
      <div className="vd-page">
        <div className="vd-wrap">
          <button type="button" className="vd-back" onClick={() => navigate('/dashboard')}>
            <Icon name="ChevronLeft" size={16} /> Back to Dashboard
          </button>

          <div className="vd-head">
            <p className="editorial-meta">
              <span className="dot">●</span>
              <span>Vessel documents</span>
              <span className="bar" />
              <span className="muted">Command &amp; Chief</span>
            </p>
            <h1 className="editorial-greeting">Vessel, <em>documents</em><span className="period">.</span></h1>
          </div>

          {/* Breadcrumb + toolbar */}
          <div className="vd-bar">
            <div className="vd-crumbs">
              <button type="button" className={`vd-crumb${cwd ? '' : ' is-here'}`} onClick={() => setCwd(null)}>
                <Icon name="Home" size={14} /> Vault
              </button>
              {crumbs.map((c, i) => (
                <span key={c.id} className="vd-crumb-wrap">
                  <Icon name="ChevronRight" size={13} className="vd-crumb-sep" />
                  <button type="button" className={`vd-crumb${i === crumbs.length - 1 ? ' is-here' : ''}`} onClick={() => setCwd(c.id)}>{c.name}</button>
                </span>
              ))}
            </div>
            <div className="vd-tools">
              <button type="button" className="vd-btn vd-btn-ghost" disabled={busy || isVirtualId(cwd)} onClick={openNewFolder}>
                <Icon name="FolderPlus" size={15} /> New folder
              </button>
              <button type="button" className="vd-btn vd-btn-primary" disabled={busy || isVirtualId(cwd)} onClick={() => fileRef.current?.click()}>
                <Icon name="Upload" size={15} /> Upload
              </button>
              <input ref={fileRef} type="file" multiple hidden onChange={onPickFiles} />
            </div>
          </div>

          {/* Listing — Shelf at the root, Index inside a folder */}
          <div className="vd-list">
            {loading ? (
              <div className="vd-empty">Loading…</div>
            ) : !cwd ? (
              <>
                <div className="vd-shelf">
                  {(shelf?.folders || []).map(renderCard)}
                  {renderLinkedCard(VIRT_HOR, 'Hours of Rest', 'Signed monthly MLC records', shelf?.linked?.hor || 0, 'month')}
                  {renderLinkedCard(VIRT_CREW, 'Crew Documents', 'Certs, contracts & docs, by crew member', shelf?.linked?.crew || 0, 'crew member')}
                  {renderLinkedCard(VIRT_TEMPLATES, 'Contract Templates', 'Crew SEA & letter templates', shelf?.linked?.templates || 0, 'template')}
                  <button type="button" className="vd-card vd-card-new" disabled={busy} onClick={openNewFolder}>
                    <Icon name="Plus" size={20} />
                    <span>New folder</span>
                  </button>
                </div>
                {shelf?.rootFiles?.length > 0 && (
                  <div className="vd-idx vd-idx-loose">
                    <div className="vd-idx-head"><span className="t">Loose files</span><span className="c">{shelf.rootFiles.length}</span></div>
                    {shelf.rootFiles.map((f, i) => renderFile(f, i + 1))}
                  </div>
                )}
              </>
            ) : inCrewRoot && items.length > 0 ? (
              // Active crew / Former crew folders
              <div className="vd-idx">{items.map(renderFolder)}</div>
            ) : inCrewGroup && items.length > 0 ? (
              // One folder per crew member (with the organise / filter bar)
              <>
                {renderCrewBar()}
                <div className="vd-idx">
                  {crewRows.length === 0
                    ? <div className="vd-empty-inline">No crew in this department.</div>
                    : crewRows.map(renderCrewFolder)}
                </div>
              </>
            ) : inCrewMember && items.length > 0 ? (
              // Certificates / Documents / Expired & historic folders
              <div className="vd-idx">{items.map(renderFolder)}</div>
            ) : inCrewBucket && items.length > 0 ? (
              // The files inside one bucket
              <>
                {renderCrewDocBar()}
                <div className="vd-idx">
                  {crewDocFiles.length === 0
                    ? <div className="vd-empty-inline">No documents in this category.</div>
                    : crewDocFiles.map((f, i) => renderFile(f, i + 1))}
                </div>
              </>
            ) : items.length === 0 ? (
              <div className="vd-empty">
                <Icon name="FolderOpen" size={26} />
                <p>{isVirtualId(cwd) ? 'Nothing filed here yet.' : 'This folder is empty.'}</p>
                <span>
                  {isVirtualId(cwd)
                    ? 'Records appear here automatically as they’re signed or added.'
                    : 'Create a folder or upload the ship’s papers to get started.'}
                </span>
              </div>
            ) : (
              <div className="vd-idx">
                {folders.map(renderFolder)}
                {files.map((f, i) => renderFile(f, i + 1))}
              </div>
            )}
          </div>
        </div>

        {/* Prompt modal (new folder / rename / expiry) */}
        {prompt && (
          <div className="vd-modal-scrim" onClick={() => !busy && setPrompt(null)}>
            <div className="vd-modal" onClick={(e) => e.stopPropagation()}>
              <h2 className="vd-modal-title">
                {prompt.mode === 'new-folder' ? 'New folder'
                  : prompt.mode === 'rename' ? 'Rename'
                    : `Expiry date — ${prompt.item?.name}`}
              </h2>
              {prompt.mode === 'expiry' ? (
                <input type="date" className="vd-input" value={promptValue} onChange={(e) => setPromptValue(e.target.value)} autoFocus />
              ) : (
                <input
                  type="text" className="vd-input" value={promptValue} autoFocus
                  placeholder={prompt.mode === 'new-folder' ? 'Folder name' : 'Name'}
                  onChange={(e) => setPromptValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitPrompt(); }}
                />
              )}
              <div className="vd-modal-actions">
                {prompt.mode === 'expiry' && promptValue && (
                  <button type="button" className="vd-btn vd-btn-ghost vd-modal-clear" disabled={busy} onClick={() => { setPromptValue(''); }}>Clear date</button>
                )}
                <button type="button" className="vd-btn vd-btn-ghost" disabled={busy} onClick={() => setPrompt(null)}>Cancel</button>
                <button type="button" className="vd-btn vd-btn-primary" disabled={busy || (prompt.mode !== 'expiry' && !promptValue.trim())} onClick={submitPrompt}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Move modal — pick a destination folder */}
        {move && (
          <div className="vd-modal-scrim" onClick={() => !busy && setMove(null)}>
            <div className="vd-modal vd-modal-move" onClick={(e) => e.stopPropagation()}>
              <h2 className="vd-modal-title">Move “{move.item.name}”</h2>
              <div className="vd-move-crumbs">
                <button type="button" className={`vd-crumb${move.cwd ? '' : ' is-here'}`} onClick={() => moveBrowse(null)}>
                  <Icon name="Home" size={13} /> Vault
                </button>
                {move.crumbs.map((c) => (
                  <span key={c.id} className="vd-crumb-wrap">
                    <Icon name="ChevronRight" size={12} className="vd-crumb-sep" />
                    <button type="button" className={`vd-crumb${c.id === move.cwd ? ' is-here' : ''}`} onClick={() => moveBrowse(c.id)}>{c.name}</button>
                  </span>
                ))}
              </div>
              <div className="vd-move-list">
                {move.folders.length === 0 ? (
                  <div className="vd-move-empty">No sub-folders here.</div>
                ) : (
                  move.folders.map((f) => (
                    <button type="button" key={f.id} className="vd-move-row" onClick={() => moveBrowse(f.id)}>
                      <Icon name="Folder" size={16} /> <span>{f.name}</span>
                      <Icon name="ChevronRight" size={14} className="vd-move-go" />
                    </button>
                  ))
                )}
              </div>
              <div className="vd-modal-actions">
                <button type="button" className="vd-btn vd-btn-ghost" disabled={busy} onClick={() => setMove(null)}>Cancel</button>
                <button type="button" className="vd-btn vd-btn-primary" disabled={busy} onClick={confirmMove}>
                  {busy ? 'Moving…' : `Move here${move.crumbs.length ? ` · ${move.crumbs[move.crumbs.length - 1].name}` : ' · Vault'}`}
                </button>
              </div>
            </div>
          </div>
        )}

        {toast && <div className="vd-toast">{toast}</div>}
      </div>
    </>
  );
}
