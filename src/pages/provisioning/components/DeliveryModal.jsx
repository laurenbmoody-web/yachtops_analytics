import React, { useState, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import { parseDocumentWithAzure } from '../../../services/azureDocumentParser';
import {
  createDelivery,
  updateItemStatus,
  updateProvisioningList,
  computeListStatusAfterDelivery,
  ITEM_STATUS,
} from '../utils/provisioningStorage';
import { useAuth } from '../../../contexts/AuthContext';

const STEPS = ['Upload', 'Match', 'Confirm', 'Summary'];

const DeliveryModal = ({ list, items, onClose, onComplete }) => {
  const { user } = useAuth();
  const fileInputRef = useRef(null);

  const [step, setStep] = useState(0);
  const [uploadTab, setUploadTab] = useState('pdf'); // pdf | photo | csv | email
  const [file, setFile] = useState(null);
  const [parsedItems, setParsedItems] = useState([]);
  const [parsing, setParsin] = useState(false);
  const [parseError, setParseError] = useState(null);
  const [matchedItems, setMatchedItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [updateInventory, setUpdateInventory] = useState(true);
  const [discrepancyNote, setDiscrepancyNote] = useState('');

  // ── Step 1: Parse document ────────────────────────────────────────────────

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  };

  const handleParse = async () => {
    if (!file) return;
    setParsin(true);
    setParseError(null);
    try {
      const result = await parseDocumentWithAzure(file);
      if (result?.error) throw new Error(result.error);

      // Extract item rows from tables
      const extracted = [];
      (result?.tables || []).forEach(table => {
        table.rows?.forEach(row => {
          const nameCell = row.cells?.find(c => /item|product|description/i.test(c.columnHeader || ''));
          const qtyCell = row.cells?.find(c => /qty|quantity/i.test(c.columnHeader || ''));
          if (nameCell?.content) {
            extracted.push({
              name: nameCell.content,
              qty: parseFloat(qtyCell?.content) || 1,
            });
          }
        });
      });

      if (!extracted.length) {
        // Fallback: extract from paragraphs with number patterns
        (result?.paragraphs || []).forEach(p => {
          const match = p.content?.match(/^(.+?)\s+x?\s*(\d+(?:\.\d+)?)\s*(kg|g|l|lt|each|pcs?|bottles?)?$/i);
          if (match) {
            extracted.push({ name: match[1].trim(), qty: parseFloat(match[2]) || 1 });
          }
        });
      }

      if (extracted.length) {
        setParsedItems(extracted);
        setStep(1);
      } else {
        setParseError('Could not read document — please enter items manually.');
        setParsedItems([]);
      }
    } catch (err) {
      setParseError(`Could not read document — please enter items manually. (${err.message})`);
    } finally {
      setParsin(false);
    }
  };

  const handleManualEntry = () => {
    // Skip to manual matching with empty parsed items
    setParsedItems([]);
    buildInitialMatch([]);
    setStep(1);
  };

  // ── Step 2: Match ─────────────────────────────────────────────────────────

  const buildInitialMatch = (parsed) => {
    const matched = items.map(orderItem => {
      // Try to find a parsed item with similar name
      const parsedMatch = parsed.find(p =>
        p.name?.toLowerCase()?.includes(orderItem.name?.toLowerCase()?.substring(0, 5)) ||
        orderItem.name?.toLowerCase()?.includes(p.name?.toLowerCase()?.substring(0, 5))
      );

      return {
        ...orderItem,
        delivered_qty: parsedMatch ? parsedMatch.qty : null,
        matched: !!parsedMatch,
        status: parsedMatch
          ? parsedMatch.qty >= orderItem.quantity_ordered
            ? ITEM_STATUS.RECEIVED
            : ITEM_STATUS.SHORT_DELIVERED
          : ITEM_STATUS.PENDING,
      };
    });
    setMatchedItems(matched);
  };

  // Called after step 1 parse succeeds
  const proceedToMatch = () => {
    buildInitialMatch(parsedItems);
    setStep(1);
  };

  const updateMatch = (itemId, field, value) => {
    setMatchedItems(prev => prev.map(i => {
      if (i.id !== itemId) return i;
      const updated = { ...i, [field]: value };
      if (field === 'delivered_qty') {
        const qty = parseFloat(value) || 0;
        updated.status = qty === 0
          ? ITEM_STATUS.NOT_DELIVERED
          : qty >= i.quantity_ordered
            ? ITEM_STATUS.RECEIVED
            : ITEM_STATUS.SHORT_DELIVERED;
      }
      return updated;
    }));
  };

  // ── Step 3: Confirm ───────────────────────────────────────────────────────

  const handleConfirm = async () => {
    setSaving(true);
    try {
      // Update each item status
      await Promise.all(
        matchedItems.map(item =>
          updateItemStatus(item.id, item.status, item.delivered_qty ?? null)
        )
      );

      // Compute overall list status
      const newListStatus = computeListStatusAfterDelivery(matchedItems);
      await updateProvisioningList(list.id, { status: newListStatus });

      // Create delivery record
      const discrepancies = matchedItems
        .filter(i => i.status !== ITEM_STATUS.RECEIVED)
        .map(i => ({ id: i.id, name: i.name, ordered: i.quantity_ordered, received: i.delivered_qty, status: i.status }));

      await createDelivery({
        list_id: list.id,
        delivery_note_type: uploadTab,
        parsed_data: { items: parsedItems },
        discrepancies: discrepancies.length ? { items: discrepancies } : null,
        received_by: user?.id,
      });

      setStep(3);
    } catch (err) {
      console.error('[DeliveryModal] confirm error:', err);
      alert(`Failed to save delivery: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const received = matchedItems.filter(i => i.status === ITEM_STATUS.RECEIVED).length;
  const short = matchedItems.filter(i => i.status === ITEM_STATUS.SHORT_DELIVERED).length;
  const missing = matchedItems.filter(i => i.status === ITEM_STATUS.NOT_DELIVERED || i.status === ITEM_STATUS.PENDING).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-semibold text-foreground">Log Delivery</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{list?.title}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-colors">
            <Icon name="X" className="w-4 h-4" />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-0 px-6 py-3 border-b border-border shrink-0">
          {STEPS.map((s, i) => (
            <React.Fragment key={s}>
              <div className={`flex items-center gap-1.5 text-xs font-medium ${i === step ? 'text-primary' : i < step ? 'text-success' : 'text-muted-foreground'}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${i === step ? 'bg-primary text-primary-foreground' : i < step ? 'bg-success text-white' : 'bg-muted text-muted-foreground'}`}>
                  {i < step ? '✓' : i + 1}
                </div>
                {s}
              </div>
              {i < STEPS.length - 1 && <div className="flex-1 h-px bg-border mx-2" />}
            </React.Fragment>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* STEP 0 — Upload */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="flex gap-2">
                {['pdf', 'photo', 'csv', 'email'].map(tab => (
                  <button
                    key={tab}
                    onClick={() => setUploadTab(tab)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${uploadTab === tab ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:bg-muted'}`}
                  >
                    {tab === 'pdf' ? 'Upload PDF' : tab === 'photo' ? 'Photo' : tab === 'csv' ? 'Import CSV' : 'Forward Email'}
                  </button>
                ))}
              </div>

              {(uploadTab === 'pdf' || uploadTab === 'photo' || uploadTab === 'csv') && (
                <div>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:bg-muted/30 transition-colors"
                  >
                    <Icon name={uploadTab === 'photo' ? 'Camera' : 'Upload'} className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm font-medium text-foreground mb-1">
                      {file ? file.name : `Click to select ${uploadTab === 'pdf' ? 'PDF' : uploadTab === 'photo' ? 'image' : 'CSV'}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {uploadTab === 'pdf' && 'PDF delivery notes will be read automatically'}
                      {uploadTab === 'photo' && 'JPG, PNG or HEIC — Azure will extract item details'}
                      {uploadTab === 'csv' && 'Export from your supplier system and upload here'}
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={uploadTab === 'csv' ? '.csv' : uploadTab === 'photo' ? 'image/*' : '.pdf'}
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
              )}

              {uploadTab === 'email' && (
                <div className="bg-muted rounded-xl p-4">
                  <p className="text-sm text-foreground font-medium mb-1">Forward delivery confirmation email</p>
                  <p className="text-xs text-muted-foreground">Forward your supplier's email to <strong>deliver@cargo.app</strong> — it will appear here automatically within a few minutes.</p>
                </div>
              )}

              {parseError && (
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg p-3">
                  <p className="text-sm text-red-700 dark:text-red-400">{parseError}</p>
                </div>
              )}
            </div>
          )}

          {/* STEP 1 — Match */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Review and confirm quantities for each item. Adjust any that were incorrectly read.</p>
              <div className="grid grid-cols-[1fr_100px_100px_100px] text-xs font-medium text-muted-foreground gap-2 px-2">
                <span>Item</span>
                <span className="text-center">Ordered</span>
                <span className="text-center">Received</span>
                <span className="text-center">Status</span>
              </div>
              {matchedItems.map(item => (
                <div key={item.id} className="grid grid-cols-[1fr_100px_100px_100px] items-center gap-2 bg-muted/30 rounded-lg px-2 py-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.department} · {item.category}</p>
                  </div>
                  <p className="text-sm text-center text-muted-foreground">{item.quantity_ordered} {item.unit}</p>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={item.delivered_qty ?? ''}
                    onChange={e => updateMatch(item.id, 'delivered_qty', e.target.value)}
                    className="w-full bg-card border border-border rounded px-2 py-1 text-sm text-center text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="0"
                  />
                  <div className="flex justify-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      item.status === ITEM_STATUS.RECEIVED ? 'bg-green-100 text-green-700' :
                      item.status === ITEM_STATUS.SHORT_DELIVERED ? 'bg-amber-100 text-amber-700' :
                      item.status === ITEM_STATUS.NOT_DELIVERED ? 'bg-red-100 text-red-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>
                      {item.status === ITEM_STATUS.RECEIVED ? '✓' :
                       item.status === ITEM_STATUS.SHORT_DELIVERED ? 'Short' :
                       item.status === ITEM_STATUS.NOT_DELIVERED ? 'Missing' : 'Pending'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* STEP 2 — Confirm */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-50 dark:bg-green-950/30 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-green-600">{received}</p>
                  <p className="text-xs text-green-700 dark:text-green-400">Fully received</p>
                </div>
                <div className="bg-amber-50 dark:bg-amber-950/30 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-amber-600">{short}</p>
                  <p className="text-xs text-amber-700 dark:text-amber-400">Short delivered</p>
                </div>
                <div className="bg-red-50 dark:bg-red-950/30 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-red-600">{missing}</p>
                  <p className="text-xs text-red-700 dark:text-red-400">Not delivered</p>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={updateInventory}
                  onChange={e => setUpdateInventory(e.target.checked)}
                  className="rounded border-border"
                />
                <span className="text-sm text-foreground">Update inventory automatically for received items</span>
              </label>

              {(short > 0 || missing > 0) && (
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Discrepancy notes (optional)</label>
                  <textarea
                    value={discrepancyNote}
                    onChange={e => setDiscrepancyNote(e.target.value)}
                    rows={3}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="Add notes about missing or short items…"
                  />
                </div>
              )}
            </div>
          )}

          {/* STEP 3 — Summary */}
          {step === 3 && (
            <div className="text-center space-y-4 py-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <Icon name="CheckCircle" className="w-8 h-8 text-green-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">Delivery logged</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {received} received · {short} short · {missing} not delivered
                </p>
              </div>
              {(short > 0 || missing > 0) && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl p-4 text-left">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400 mb-1">Discrepancy report generated</p>
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    {short + missing} item{(short + missing) !== 1 ? 's' : ''} were not fully delivered. You can email a discrepancy report to the supplier from the list detail view.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0">
          <button
            onClick={step === 0 ? onClose : () => setStep(s => s - 1)}
            className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors"
            disabled={saving}
          >
            {step === 0 ? 'Cancel' : 'Back'}
          </button>

          <div className="flex items-center gap-2">
            {step === 0 && (
              <>
                <button
                  onClick={handleManualEntry}
                  className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors"
                >
                  Enter manually
                </button>
                <button
                  onClick={file ? handleParse : proceedToMatch}
                  disabled={parsing}
                  className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {parsing ? (
                    <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Reading…</>
                  ) : (
                    file ? 'Parse document' : 'Next →'
                  )}
                </button>
              </>
            )}
            {step === 1 && (
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
              >
                Continue →
              </button>
            )}
            {step === 2 && (
              <button
                onClick={handleConfirm}
                disabled={saving}
                className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Saving…</> : 'Confirm delivery'}
              </button>
            )}
            {step === 3 && (
              <button
                onClick={() => onComplete?.()}
                className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeliveryModal;
