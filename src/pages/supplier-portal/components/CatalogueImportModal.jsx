import React, { useRef, useState } from 'react';
import { X, UploadCloud, FileSpreadsheet, FileText, Image as ImageIcon, Sparkles, AlertTriangle, Check } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { bulkCreateCatalogueItems } from '../utils/supplierStorage';
import { STANDARD_CATEGORIES, orderCategories } from '../../../utils/catalogueConstants';
import './catalogue-import.css';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];

// Minimal CSV parser that survives quoted fields and embedded commas.
const parseCsv = (text) => {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(c => c.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(c => c.trim())) rows.push(row);
  return rows;
};

const readXlsx = async (file) => {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const cells = [];
    r.eachCell({ includeEmpty: true }, (c) => {
      const v = c.value;
      if (v == null) cells.push('');
      else if (typeof v === 'object' && v.richText) cells.push(v.richText.map(t => t.text).join(''));
      else if (typeof v === 'object' && v.text) cells.push(String(v.text));
      else if (typeof v === 'object' && v.result != null) cells.push(String(v.result));
      else cells.push(String(v));
    });
    if (cells.some(c => c.trim())) rows.push(cells);
  });
  return rows;
};

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const fmtPack = (item) => {
  if (!item.pack_size && !item.unit_size) return '—';
  const inner = [item.pack_size, item.pack_unit].filter(Boolean).join(' × ');
  return [inner || null, item.unit_size].filter(Boolean).join(' · ');
};

const CatalogueImportModal = ({ supplierId, existingItems, onImported, onClose }) => {
  const [step, setStep] = useState('upload'); // upload | parsing | review | saving
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [rows, setRows] = useState([]); // parsed items + {include, duplicate}
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const existingKeys = React.useMemo(() => {
    const keys = new Set();
    (existingItems || []).forEach(i => {
      if (i.name) keys.add(`n:${i.name.trim().toLowerCase()}`);
      if (i.barcode) keys.add(`b:${i.barcode}`);
      if (i.sku) keys.add(`s:${i.sku.trim().toLowerCase()}`);
    });
    return keys;
  }, [existingItems]);

  const handleFile = async (file) => {
    if (!file) return;
    setError(null);
    setFileName(file.name);
    setStep('parsing');
    try {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      let payload;
      if (ext === 'csv' || file.type === 'text/csv') {
        const parsed = parseCsv(await file.text());
        if (parsed.length < 2) throw new Error('The CSV needs a header row plus at least one product row.');
        payload = { kind: 'rows', headers: parsed[0], rows: parsed.slice(1) };
      } else if (['xlsx', 'xls'].includes(ext)) {
        const parsed = await readXlsx(file);
        if (parsed.length < 2) throw new Error('The spreadsheet needs a header row plus at least one product row.');
        payload = { kind: 'rows', headers: parsed[0], rows: parsed.slice(1) };
      } else if (ext === 'pdf' || file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext)) {
        if (file.size > 20 * 1024 * 1024) throw new Error('File is too large (20MB max). Try a smaller export or photo.');
        payload = {
          kind: 'document',
          base64: await fileToBase64(file),
          mediaType: file.type || (ext === 'pdf' ? 'application/pdf' : 'image/jpeg'),
        };
      } else {
        throw new Error('Unsupported file type. Use CSV, Excel (.xlsx), PDF, or a photo.');
      }

      const { data, error: fnError } = await supabase.functions.invoke('parseCatalogueImport', { body: payload });
      if (fnError) throw new Error(fnError.message || 'Parsing failed. Try again.');
      if (data?.error) throw new Error(data.error);

      const items = (data?.items || []).map(item => {
        const duplicate =
          existingKeys.has(`n:${item.name.trim().toLowerCase()}`) ||
          (item.barcode && existingKeys.has(`b:${item.barcode}`)) ||
          (item.sku && existingKeys.has(`s:${item.sku.trim().toLowerCase()}`));
        return { ...item, include: !duplicate, duplicate };
      });
      if (!items.length) throw new Error(data?.warnings?.[0] || 'No products could be extracted from this file.');

      setWarnings(data?.warnings || []);
      setRows(items);
      setStep('review');
    } catch (e) {
      setError(e.message);
      setStep('upload');
    }
  };

  const setRow = (idx, patch) => setRows(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const selectedCount = rows.filter(r => r.include).length;
  const allSelected = selectedCount === rows.length;

  const handleImport = async () => {
    const num = (v) => (v != null && v !== '' ? parseFloat(v) : null);
    const toInsert = rows.filter(r => r.include).map(({ include, duplicate, ...item }) => ({
      ...item,
      name: item.name.trim(),
      category: (item.category || '').trim() || 'Other',
      unit_price: num(item.unit_price),
      stock_qty: num(item.stock_qty),
      pack_size: num(item.pack_size),
      lead_time_days: item.lead_time_days != null && item.lead_time_days !== '' ? parseInt(item.lead_time_days, 10) : null,
      min_order_qty: num(item.min_order_qty),
      in_stock: true,
    }));
    if (!toInsert.length) return;
    setStep('saving');
    setError(null);
    try {
      const created = await bulkCreateCatalogueItems(supplierId, toInsert);
      onImported(created);
    } catch (e) {
      setError(e.message);
      setStep('review');
    }
  };

  return (
    <div className="cim-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cim-panel" role="dialog" aria-label="Import price list">
        <div className="cim-head">
          <div>
            <div className="cim-eyebrow"><Sparkles size={11} /> AI import</div>
            <h3 className="cim-title">Import your <em>price list</em></h3>
          </div>
          <button className="cim-close" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>

        {error && <div className="cim-error"><AlertTriangle size={13} />{error}</div>}

        {step === 'upload' && (
          <>
            <p className="cim-sub">
              Upload the price list you already have — a spreadsheet, a PDF, even a photo of a printed list.
              Cargo reads it and builds your catalogue entries for you to review before anything is saved.
            </p>
            <div
              className={`cim-drop ${dragOver ? 'over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
              onClick={() => inputRef.current?.click()}
            >
              <UploadCloud size={26} strokeWidth={1.5} />
              <div className="cim-drop-main">Drop your file here, or <span>browse</span></div>
              <div className="cim-drop-types">
                <span><FileSpreadsheet size={12} /> CSV / Excel</span>
                <span><FileText size={12} /> PDF</span>
                <span><ImageIcon size={12} /> Photo</span>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,.xls,.pdf,image/*"
                style={{ display: 'none' }}
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </div>
          </>
        )}

        {step === 'parsing' && (
          <div className="cim-busy">
            <div className="cim-spinner" />
            <div className="cim-busy-title">Reading {fileName}…</div>
            <div className="cim-busy-sub">Extracting products, pack sizes and prices. Large lists can take a minute.</div>
          </div>
        )}

        {step === 'saving' && (
          <div className="cim-busy">
            <div className="cim-spinner" />
            <div className="cim-busy-title">Adding {selectedCount} products…</div>
          </div>
        )}

        {step === 'review' && (
          <>
            <datalist id="cim-category-suggestions">
              {orderCategories(Array.from(new Set([
                ...STANDARD_CATEGORIES,
                ...(existingItems || []).map(i => i.category).filter(Boolean),
                ...rows.map(r => r.category).filter(Boolean),
              ]))).map(c => <option key={c} value={c} />)}
            </datalist>
            <div className="cim-review-bar">
              <label className="cim-checkline">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => setRows(prev => prev.map(r => ({ ...r, include: e.target.checked })))}
                />
                <span>{selectedCount} of {rows.length} selected</span>
              </label>
              <span className="cim-filename">{fileName}</span>
            </div>

            {warnings.map((w, i) => (
              <div key={i} className="cim-warning"><AlertTriangle size={12} />{w}</div>
            ))}
            {rows.some(r => r.duplicate) && (
              <div className="cim-warning">
                <AlertTriangle size={12} />
                Rows marked “in catalogue” match a product you already have (by name, SKU or barcode) and are unticked — tick them to import anyway.
              </div>
            )}

            <div className="cim-table-wrap">
              <table className="cim-table">
                <thead>
                  <tr>
                    <th />
                    <th>Product</th>
                    <th>Category</th>
                    <th>Unit</th>
                    <th>Pack</th>
                    <th className="num">Price</th>
                    <th className="num">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={idx} className={r.include ? '' : 'off'}>
                      <td>
                        <input type="checkbox" checked={r.include} onChange={(e) => setRow(idx, { include: e.target.checked })} />
                      </td>
                      <td>
                        <input className="cim-cell-input name" value={r.name} onChange={(e) => setRow(idx, { name: e.target.value })} />
                        <div className="cim-cell-meta">
                          {r.sku && <span>SKU {r.sku}</span>}
                          {r.barcode && <span>EAN {r.barcode}</span>}
                          {r.duplicate && <span className="cim-dup">in catalogue</span>}
                        </div>
                      </td>
                      <td>
                        <input
                          className="cim-cell-input"
                          list="cim-category-suggestions"
                          value={r.category ?? ''}
                          onChange={(e) => setRow(idx, { category: e.target.value })}
                        />
                      </td>
                      <td>
                        <input className="cim-cell-input sm" value={r.unit ?? ''} onChange={(e) => setRow(idx, { unit: e.target.value })} />
                      </td>
                      <td className="cim-pack">{fmtPack(r)}</td>
                      <td className="num">
                        <div className="cim-price">
                          <input
                            className="cim-cell-input sm num"
                            type="number" step="0.01" min="0"
                            value={r.unit_price ?? ''}
                            onChange={(e) => setRow(idx, { unit_price: e.target.value })}
                          />
                          <select className="cim-cell-input ccy" value={r.currency} onChange={(e) => setRow(idx, { currency: e.target.value })}>
                            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                      </td>
                      <td className="num">
                        <input
                          className="cim-cell-input sm num"
                          type="number" step="1" min="0"
                          value={r.stock_qty ?? ''}
                          placeholder="—"
                          onChange={(e) => setRow(idx, { stock_qty: e.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="cim-foot">
              <button className="cim-btn ghost" onClick={() => { setRows([]); setStep('upload'); }}>Start over</button>
              <button className="cim-btn primary" disabled={selectedCount === 0} onClick={handleImport}>
                <Check size={13} /> Add {selectedCount} product{selectedCount === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CatalogueImportModal;
