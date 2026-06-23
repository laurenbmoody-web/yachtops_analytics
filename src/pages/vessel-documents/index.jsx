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
  fetchChildren, fetchBreadcrumb, createFolder, uploadFile,
  renameItem, setExpiry, deleteItem, getFileUrl,
  getExpiryStatus, formatDocDate,
} from './vesselDocuments';
import './vessel-documents.css';

// Editorial RAG colours for expiry pills (mirrors the crew-doc thresholds).
const PILL = {
  expired: { bg: '#FBE4DC', fg: '#9A2B12' },
  red:     { bg: '#FBE4DC', fg: '#9A2B12' },
  amber:   { bg: '#FBEFD9', fg: '#8A5A12' },
  green:   { bg: '#E3EFE4', fg: '#3F7A52' },
  none:    { bg: '#F0F1F5', fg: '#8B8478' },
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
  const [crumbs, setCrumbs] = useState([]);      // [{id, name}] root→here
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [prompt, setPrompt] = useState(null);    // { mode, item }  text/date modal
  const [promptValue, setPromptValue] = useState('');
  const fileRef = useRef(null);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2800); };

  const load = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    try {
      const [kids, chain] = await Promise.all([
        fetchChildren({ tenantId: activeTenantId, parentId: cwd }),
        cwd ? fetchBreadcrumb({ tenantId: activeTenantId, folderId: cwd }) : Promise.resolve([]),
      ]);
      setItems(kids);
      setCrumbs(chain);
    } catch (e) {
      console.error(e);
      flash('Couldn’t load the vault');
    } finally {
      setLoading(false);
    }
  }, [activeTenantId, cwd]);

  useEffect(() => { load(); }, [load]);

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
    const url = await getFileUrl(item.storage_path);
    if (url) window.open(url, '_blank', 'noopener');
    else flash('Couldn’t open that file');
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

  // ── Rows ────────────────────────────────────────────────────────────────
  const renderFolder = (f) => (
    <button type="button" key={f.id} className="vd-row vd-row-folder" onDoubleClick={() => setCwd(f.id)} onClick={() => setCwd(f.id)}>
      <span className="vd-ico vd-ico-folder"><Icon name="Folder" size={18} /></span>
      <span className="vd-name">{f.name}</span>
      <span className="vd-meta">Folder</span>
      <span className="vd-actions" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="vd-act" title="Rename" onClick={() => openRename(f)}><Icon name="Pencil" size={15} /></button>
        <button type="button" className="vd-act vd-act-danger" title="Delete" onClick={() => removeItem(f)}><Icon name="Trash2" size={15} /></button>
      </span>
    </button>
  );

  const renderFile = (f) => {
    const st = getExpiryStatus(f.expiry_date);
    const pill = PILL[st.level] || PILL.none;
    return (
      <div key={f.id} className="vd-row vd-row-file" role="button" tabIndex={0} onClick={() => openFile(f)} onKeyDown={(e) => { if (e.key === 'Enter') openFile(f); }}>
        <span className="vd-ico vd-ico-file"><Icon name="FileText" size={18} /></span>
        <span className="vd-name">{f.name}</span>
        <span className="vd-filemeta">
          {f.expiry_date && (
            <span className="vd-pill" style={{ background: pill.bg, color: pill.fg }} title={`Expires ${formatDocDate(f.expiry_date)}`}>
              {st.level === 'green' ? `Valid · ${formatDocDate(f.expiry_date)}` : st.label}
            </span>
          )}
          {f.size_bytes ? <span className="vd-size">{fmtSize(f.size_bytes)}</span> : null}
        </span>
        <span className="vd-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="vd-act" title="Open / download" onClick={() => openFile(f)}><Icon name="Download" size={15} /></button>
          <button type="button" className="vd-act" title="Set expiry date" onClick={() => openExpiry(f)}><Icon name="CalendarClock" size={15} /></button>
          <button type="button" className="vd-act" title="Rename" onClick={() => openRename(f)}><Icon name="Pencil" size={15} /></button>
          <button type="button" className="vd-act vd-act-danger" title="Delete" onClick={() => removeItem(f)}><Icon name="Trash2" size={15} /></button>
        </span>
      </div>
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
            <h1 className="editorial-greeting">Ship&apos;s papers<span className="period">.</span></h1>
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
              <button type="button" className="vd-btn vd-btn-ghost" disabled={busy} onClick={openNewFolder}>
                <Icon name="FolderPlus" size={15} /> New folder
              </button>
              <button type="button" className="vd-btn vd-btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Icon name="Upload" size={15} /> Upload
              </button>
              <input ref={fileRef} type="file" multiple hidden onChange={onPickFiles} />
            </div>
          </div>

          {/* Listing */}
          <div className="vd-list">
            {loading ? (
              <div className="vd-empty">Loading…</div>
            ) : items.length === 0 ? (
              <div className="vd-empty">
                <Icon name="FolderOpen" size={26} />
                <p>This folder is empty.</p>
                <span>Create a folder or upload the ship&apos;s papers to get started.</span>
              </div>
            ) : (
              <>
                {folders.map(renderFolder)}
                {files.map(renderFile)}
              </>
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

        {toast && <div className="vd-toast">{toast}</div>}
      </div>
    </>
  );
}
