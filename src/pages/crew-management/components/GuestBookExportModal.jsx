import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import { showToast } from '../../../utils/toast';
import { fetchGuestBookEntries, exportGuestBookPDF, buildGuestBookPDF, exportGuestBookDOCX, adaptTemplateFromImage, fetchVesselBrand, loadLogoForPdf, loadAvatarForPdf, autoPerPage } from '../utils/guestBookExport';
import './guest-book-export.css';

const TEMPLATES = [
  { key: 'side', name: 'Classic', blurb: 'Photo left · 4 per page', per: 4 },
  { key: 'classic', name: 'Alternating', blurb: 'Photo alternates · 3 per page', per: 3 },
];

// Editorial swatches for headings (names/title) and the accent (role labels).
const COLOURS = [
  { hex: '#1C1B3A', name: 'Navy' },
  { hex: '#C65A1A', name: 'Terracotta' },
  { hex: '#2E5A4B', name: 'Forest' },
  { hex: '#7B2D3B', name: 'Burgundy' },
  { hex: '#9A6A00', name: 'Gold' },
  { hex: '#44506A', name: 'Slate' },
  { hex: '#2A2A2A', name: 'Charcoal' },
];

const initials = (n) => String(n || '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '—';

const GuestBookExportModal = ({ open, onClose, tenantId, crew = [], vesselName = 'Our crew' }) => {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState([]);
  const [order, setOrder] = useState([]);
  const [template, setTemplate] = useState('classic');
  const [orientation, setOrientation] = useState('portrait');
  const [perPage, setPerPage] = useState(3);
  const [valign, setValign] = useState('center'); // card spacing: center | top
  const [minFont, setMinFont] = useState(10);
  const [headingColor, setHeadingColor] = useState('#1C1B3A');
  const [accentColor, setAccentColor] = useState('#C65A1A');
  const [titleSize, setTitleSize] = useState(20);
  const [subtitleSize, setSubtitleSize] = useState(8);
  const [docxBusy, setDocxBusy] = useState(false);
  const [includeMissing, setIncludeMissing] = useState(false);
  const [title, setTitle] = useState(vesselName);
  const [showTitle, setShowTitle] = useState(true);
  const [subtitle, setSubtitle] = useState('Your crew');
  const [pdfUrl, setPdfUrl] = useState('');
  const [previewPage, setPreviewPage] = useState(1);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [logo, setLogo] = useState(null); // { dataUrl, aspect } for the PDF
  const [avatars, setAvatars] = useState({}); // userId -> circular PNG data-URL
  const dragFrom = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => { setTitle(vesselName); }, [vesselName]);

  const load = useCallback(async () => {
    setLoading(true);
    const [data, brand] = await Promise.all([
      fetchGuestBookEntries(tenantId, crew),
      fetchVesselBrand(tenantId),
    ]);
    // statements first, then crew without one
    data.sort((a, b) => (b.hasStatement - a.hasStatement));
    setEntries(data);
    setOrder(data.map((_, i) => i));
    if (brand.name) setTitle(brand.name);
    setLogoUrl(brand.logoUrl || '');
    setLogo(null);
    if (brand.logoUrl) loadLogoForPdf(brand.logoUrl).then(setLogo);
    // Pre-load crew photos as circular PNGs for the PDF (best-effort).
    setAvatars({});
    Promise.all(data.filter((e) => e.photo).map(async (e) => [e.userId, await loadAvatarForPdf(e.photo)]))
      .then((pairs) => setAvatars(Object.fromEntries(pairs.filter(([, v]) => v))));
    setLoading(false);
  }, [tenantId, crew]);

  useEffect(() => { if (open) load(); }, [open, load]);

  // Live preview IS the real PDF — build it (debounced) and show it in an
  // iframe, so the preview can never drift from the export.
  useEffect(() => {
    if (!open || loading) return undefined;
    const ordered = order.map((i) => entries[i]).filter(Boolean);
    const vis = includeMissing ? ordered : ordered.filter((e) => e.hasStatement);
    if (!vis.length) { setPdfUrl((old) => { if (old) URL.revokeObjectURL(old); return ''; }); return undefined; }
    const t = setTimeout(() => {
      try {
        const { doc } = buildGuestBookPDF({ title, subtitle, entries: vis, template, orientation, perPage, minFont, includeMissing, logo, avatars, valign, showTitle, headingColor, accentColor, titleSize, subtitleSize });
        if (doc) setPdfUrl((old) => { if (old) URL.revokeObjectURL(old); return String(doc.output('bloburl')); });
      } catch { /* ignore transient build errors while typing */ }
    }, 250);
    return () => clearTimeout(t);
  }, [open, loading, entries, order, includeMissing, template, orientation, perPage, minFont, title, subtitle, logo, avatars, valign, showTitle, headingColor, accentColor, titleSize, subtitleSize]);

  // Revoke the preview blob URL when the modal unmounts.
  useEffect(() => () => { setPdfUrl((old) => { if (old) URL.revokeObjectURL(old); return ''; }); }, []);

  if (!open) return null;

  const pickTemplate = (t) => { setTemplate(t.key); setPerPage(t.per); };

  // drag-drop reorder
  const onDrop = (toPos) => {
    const from = dragFrom.current;
    if (from == null || from === toPos) return;
    setOrder((prev) => {
      const next = [...prev];
      const [m] = next.splice(from, 1);
      next.splice(toPos, 0, m);
      return next;
    });
    dragFrom.current = null;
  };

  const orderedEntries = order.map((i) => entries[i]).filter(Boolean);
  const visible = includeMissing ? orderedEntries : orderedEntries.filter((e) => e.hasStatement);
  const missingCount = orderedEntries.length - orderedEntries.filter((e) => e.hasStatement).length;
  // Same auto logic the PDF uses, so the page count matches the export.
  const perResolved = perPage === 'auto' ? autoPerPage(visible, orientation) : Number(perPage);
  const totalPages = Math.max(1, Math.ceil(visible.length / perResolved));
  const safePage = Math.min(Math.max(1, previewPage), totalPages);

  const doExport = () => {
    const res = exportGuestBookPDF({
      title, subtitle, entries: visible, template, orientation, perPage, minFont, includeMissing, logo, avatars, valign, showTitle, headingColor, accentColor, titleSize, subtitleSize,
    });
    if (!res.count) { showToast('No statements to export yet', 'error'); return; }
    showToast(`Guest book exported — ${res.count} crew across ${res.pages} page${res.pages === 1 ? '' : 's'}`, 'success');
  };

  const doExportWord = async () => {
    if (!visible.length) return;
    setDocxBusy(true);
    try {
      const res = await exportGuestBookDOCX({ title, subtitle, entries: visible, includeMissing, logo, avatars, showTitle, headingColor, accentColor, titleSize, subtitleSize });
      if (!res.count) { showToast('No statements to export yet', 'error'); return; }
      showToast(`Word document exported — ${res.count} crew`, 'success');
    } catch (e) {
      showToast(e.message || 'Could not build the Word document', 'error');
    } finally { setDocxBusy(false); }
  };

  // upload-your-own → AI reads the sample and maps it to our layout engine
  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Upload an image of your layout (PNG/JPG)', 'error'); return; }
    setAiBusy(true); setAiNote('');
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const out = await adaptTemplateFromImage({ imageBase64: base64, mediaType: file.type });
      if (out?.template && TEMPLATES.some((t) => t.key === out.template)) setTemplate(out.template);
      if (out?.orientation) setOrientation(out.orientation === 'landscape' ? 'landscape' : 'portrait');
      if (out?.perPage) setPerPage(Number(out.perPage) || 3);
      setAiNote(out?.rationale || 'Matched your layout to the closest built-in template.');
      showToast('Layout matched — tweak anything below', 'success');
    } catch (err) {
      showToast(err.message || 'Could not read that layout', 'error');
    } finally { setAiBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const stepper = (label, val, set, min, max, suffix = '') => (
    <div>
      <div className="gbx-lbl">{label}</div>
      <div className="gbx-stepper">
        <button type="button" onClick={() => set(Math.max(min, val - 1))} disabled={val <= min} aria-label={`${label} down`}>−</button>
        <span>{val}{suffix}</span>
        <button type="button" onClick={() => set(Math.min(max, val + 1))} disabled={val >= max} aria-label={`${label} up`}>+</button>
      </div>
    </div>
  );
  const swatchRow = (label, val, set) => (
    <div className="gbx-colorrow">
      <div className="gbx-lbl">{label}</div>
      <div className="gbx-swatches">
        {COLOURS.map((c) => (
          <button type="button" key={c.hex} title={c.name} className={`gbx-sw${val === c.hex ? ' on' : ''}`} style={{ background: c.hex }} onClick={() => set(c.hex)} />
        ))}
      </div>
    </div>
  );

  return createPortal(
    <div className="gbx-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`gbx-panel${orientation === 'landscape' ? ' landscape' : ''}`} role="dialog" aria-modal="true">
        <header className="gbx-head">
          <div>
            <div className="gbx-eyebrow">Guest information book</div>
            <h2>Export crew profiles</h2>
          </div>
          <button className="gbx-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </header>

        {loading ? (
          <div className="gbx-loading"><LogoSpinner size={30} /></div>
        ) : (
          <div className={`gbx-body${orientation === 'landscape' ? ' landscape' : ''}`}>
            {/* ------- controls ------- */}
            <div className="gbx-controls">
              <section>
                <div className="gbx-lbl">Template</div>
                <div className="gbx-tpls">
                  {TEMPLATES.map((t) => (
                    <button key={t.key} className={`gbx-tpl${template === t.key ? ' on' : ''}`} onClick={() => pickTemplate(t)}>
                      <span className={`gbx-tpl-thumb t-${t.key}`}>
                        <span className="tpl-mini">
                          <span className="tpl-row"><i className="d" /><i className="b" /></span>
                          <span className={`tpl-row${t.key === 'classic' ? ' rev' : ''}`}><i className="d" /><i className="b" /></span>
                        </span>
                      </span>
                      <b>{t.name}</b><span>{t.blurb}</span>
                    </button>
                  ))}
                  <button className="gbx-tpl gbx-upload" onClick={() => fileRef.current?.click()} disabled={aiBusy}>
                    <span className="gbx-tpl-thumb t-upload">
                      <Icon name={aiBusy ? 'Loader2' : 'Upload'} size={18} className={aiBusy ? 'animate-spin' : ''} />
                    </span>
                    <b>Match my own</b><span>{aiBusy ? 'Reading…' : 'AI reads & matches'}</span>
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={onUpload} />
                </div>
                {aiNote && <div className="gbx-ainote"><Icon name="Sparkles" size={13} /> {aiNote}</div>}
              </section>

              <section>
                <div className="gbx-lbl">Order the crew — drag to rearrange</div>
                <div className="gbx-order">
                  {order.map((entryIdx, pos) => {
                    const en = entries[entryIdx];
                    if (!en) return null;
                    const dim = !en.hasStatement && !includeMissing;
                    return (
                      <div
                        key={en.userId} className={`gbx-row${dim ? ' dim' : ''}`} draggable
                        onDragStart={() => { dragFrom.current = pos; }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => onDrop(pos)}
                      >
                        <span className="gbx-grip">⠿</span>
                        <span className="gbx-av">{initials(en.name)}</span>
                        <span className="gbx-row-name"><b>{en.name}</b><i>{en.role}</i></span>
                        {en.hasStatement
                          ? <span className={`gbx-wc${en.words > 80 ? ' warn' : ''}`}>{en.words}w</span>
                          : <span className="gbx-nostmt">no statement</span>}
                      </div>
                    );
                  })}
                </div>
                {missingCount > 0 && (
                  <label className="gbx-check">
                    <input type="checkbox" checked={includeMissing} onChange={(e) => setIncludeMissing(e.target.checked)} />
                    Include {missingCount} crew without a statement yet
                  </label>
                )}
              </section>

              <section className="gbx-fit">
                <div>
                  <div className="gbx-lbl">Orientation</div>
                  <div className="gbx-seg">
                    <button className={orientation === 'portrait' ? 'on' : ''} onClick={() => setOrientation('portrait')}>Portrait</button>
                    <button className={orientation === 'landscape' ? 'on' : ''} onClick={() => setOrientation('landscape')}>Landscape</button>
                  </div>
                </div>
                <div>
                  <div className="gbx-lbl">Crew per page</div>
                  <div className="gbx-seg">
                    {[2, 3, 4, 'auto'].map((n) => (
                      <button key={n} className={String(perPage) === String(n) ? 'on' : ''} onClick={() => setPerPage(n)}>{n === 'auto' ? 'Auto' : n}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="gbx-lbl">Spacing</div>
                  <div className="gbx-seg">
                    <button className={valign === 'center' ? 'on' : ''} onClick={() => setValign('center')}>Balanced</button>
                    <button className={valign === 'top' ? 'on' : ''} onClick={() => setValign('top')}>Top</button>
                  </div>
                </div>
                {stepper('Statement font', minFont, setMinFont, 8, 14, 'pt')}
                {stepper('Title size', titleSize, setTitleSize, 12, 34, 'pt')}
                {stepper('Subtitle size', subtitleSize, setSubtitleSize, 6, 14, 'pt')}
                {swatchRow('Headings', headingColor, setHeadingColor)}
                {swatchRow('Accent', accentColor, setAccentColor)}
                <div className="gbx-titles">
                  <label>
                    <span className="gbx-title-row">Document title
                      <button type="button" className={`gbx-toggle${showTitle ? ' on' : ''}`} onClick={() => setShowTitle((v) => !v)}>{showTitle ? 'Shown' : 'Hidden'}</button>
                    </span>
                    <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!showTitle} placeholder={showTitle ? '' : 'Hidden — logo only'} />
                  </label>
                  <label><span>Subtitle</span><input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} /></label>
                </div>
              </section>
            </div>

            {/* ------- live preview — the actual exported PDF, so WYSIWYG ------- */}
            <div className="gbx-preview-wrap">
              <div className="gbx-preview-top">
                <span className="gbx-lbl" style={{ margin: 0 }}>Live preview</span>
                <div className="gbx-pager">
                  <button type="button" disabled={safePage <= 1} onClick={() => setPreviewPage(safePage - 1)} aria-label="Previous page"><Icon name="ChevronLeft" size={15} /></button>
                  <span className="gbx-pg">Page {safePage} of {totalPages}</span>
                  <button type="button" disabled={safePage >= totalPages} onClick={() => setPreviewPage(safePage + 1)} aria-label="Next page"><Icon name="ChevronRight" size={15} /></button>
                </div>
              </div>
              <div className={`gbx-pdfwrap ${orientation}`}>
                {pdfUrl
                  ? <iframe title="Guest book preview" className="gbx-pdf" src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0&statusbar=0&view=Fit&page=${safePage}`} />
                  : <div className="gbx-empty">{visible.length ? 'Building preview…' : 'No statements to show yet.'}</div>}
              </div>
            </div>
          </div>
        )}

        {!loading && (
          <footer className="gbx-foot">
            <span className="gbx-foot-note">
              {TEMPLATES.find((t) => t.key === template)?.name || 'Custom'} · {orientation} · {perPage === 'auto' ? `auto (${perResolved})` : perResolved} per page · {visible.length} crew → {totalPages} page{totalPages === 1 ? '' : 's'}
            </span>
            <button className="gbx-btn ghost" onClick={onClose}>Cancel</button>
            <button className="gbx-btn ghost" onClick={doExportWord} disabled={!visible.length || docxBusy} title="Editable Word document">
              <Icon name={docxBusy ? 'Loader2' : 'FileText'} size={15} className={docxBusy ? 'animate-spin' : ''} /> {docxBusy ? 'Building…' : 'Export Word'}
            </button>
            <button className="gbx-btn primary" onClick={doExport} disabled={!visible.length}>
              <Icon name="Download" size={15} /> Export PDF
            </button>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default GuestBookExportModal;
