import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import LogoSpinner from '../../../components/LogoSpinner';
import SignaturePad from '../../../components/SignaturePad';
import { showToast } from '../../../utils/toast';
import {
  KIT_CATEGORIES, CONDITIONS, kitCategoryLabel, fmtKitDate,
  fetchCrewKit, saveKitItem, deleteKitItem,
  uploadKitSignature, acknowledgeKitItems, signedKitSignatureUrl, kitSignatureDataUrl,
  recordKitReturn, markKitLost, reinstateKitItem,
  fetchUniformSizes, saveUniformSizes,
} from '../utils/crewKit';
import { exportKitReceipt } from '../utils/kitReceiptExport';

const today = () => new Date().toISOString().slice(0, 10);
const blankForm = () => ({
  category: 'uniform', item: '', size: '', quantity: 1, serial: '',
  conditionIssued: 'New', issuedDate: today(), notes: '',
});
const RETURN_CONDITIONS = ['Good', 'Used', 'Damaged', 'Incomplete'];
const SIZE_FIELDS = [
  { key: 'top', label: 'Shirt / Top', ph: 'e.g. M / 40' },
  { key: 'bottom', label: 'Trousers / Shorts', ph: 'e.g. 32R' },
  { key: 'jacket', label: 'Jacket / Outer', ph: 'e.g. M' },
  { key: 'shoe', label: 'Shoe size', ph: 'e.g. UK 9 / EU 43' },
];

const IssuedKitTab = ({ userId, tenantId, currentUserId, currentUserName, crewName, vesselName, canManage, isOwnProfile }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankForm());

  const [ackOpen, setAckOpen] = useState(false);
  const [ackSig, setAckSig] = useState(null);
  const [ackName, setAckName] = useState(currentUserName || '');

  const [returnOpen, setReturnOpen] = useState(false);
  const [returnTarget, setReturnTarget] = useState([]);
  const [returnForm, setReturnForm] = useState({ returnedDate: today(), condition: 'Good' });
  const [returnSig, setReturnSig] = useState(null);
  const [returnName, setReturnName] = useState(currentUserName || '');

  const [sigUrls, setSigUrls] = useState({});

  // Uniform sizes (moved from the Preferences tab).
  const [sizes, setSizes] = useState({ top: '', bottom: '', jacket: '', shoe: '' });
  const [sizesEditing, setSizesEditing] = useState(false);
  const [sizesForm, setSizesForm] = useState({ top: '', bottom: '', jacket: '', shoe: '' });
  const canEditSizes = canManage || isOwnProfile;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [kit, sz] = await Promise.all([fetchCrewKit(userId), fetchUniformSizes(userId)]);
      setItems(kit);
      setSizes(sz);
    } catch { showToast('Failed to load issued kit', 'error'); }
    finally { setLoading(false); }
  }, [userId]);
  useEffect(() => { if (userId) load(); }, [userId, load]);

  // Resolve signed URLs for signatures so they can be shown inline.
  useEffect(() => {
    const paths = [...new Set(items.flatMap((i) => [i.ack_signature_path, i.return_signature_path]).filter(Boolean))];
    paths.forEach(async (p) => {
      if (sigUrls[p]) return;
      const u = await signedKitSignatureUrl(p);
      if (u) setSigUrls((s) => ({ ...s, [p]: u }));
    });
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const openIssue = () => { setEditing(null); setForm(blankForm()); setFormOpen(true); };
  const openEdit = (it) => {
    setEditing(it);
    setForm({
      category: it.category || 'other', item: it.item || '', size: it.size || '',
      quantity: it.quantity || 1, serial: it.serial || '',
      conditionIssued: it.condition_issued || '', issuedDate: it.issued_date || '', notes: it.notes || '',
    });
    setFormOpen(true);
  };

  const saveForm = async () => {
    if (!form.item.trim()) { showToast('Item name is required', 'error'); return; }
    setBusy(true);
    try {
      await saveKitItem({
        id: editing?.id,
        userId, tenantId, createdBy: currentUserId,
        issuedBy: editing ? editing.issued_by : currentUserId,
        issuedByName: editing ? editing.issued_by_name : currentUserName,
        ...form,
      });
      showToast(editing ? 'Item updated' : 'Item issued', 'success');
      setFormOpen(false);
      load();
    } catch (e) { showToast(e.message || 'Save failed', 'error'); }
    finally { setBusy(false); }
  };

  const remove = async (it) => {
    if (!window.confirm(`Remove "${it.item}" from the kit register? This cannot be undone.`)) return;
    try { await deleteKitItem(it.id); showToast('Item removed', 'success'); load(); }
    catch { showToast('Delete failed', 'error'); }
  };

  const unacked = items.filter((i) => i.status === 'in_service' && !i.acknowledged_at);
  const inService = items.filter((i) => i.status === 'in_service');
  const archived = items.filter((i) => i.status !== 'in_service');

  const doAcknowledge = async () => {
    if (!ackSig) { showToast('Please sign to acknowledge receipt', 'error'); return; }
    setBusy(true);
    try {
      const path = await uploadKitSignature(currentUserId, ackSig, 'ack');
      await acknowledgeKitItems(unacked.map((i) => i.id), { signaturePath: path, signedName: ackName || currentUserName });
      showToast('Receipt acknowledged — thank you', 'success');
      setAckOpen(false); setAckSig(null);
      load();
    } catch (e) { showToast(e.message || 'Acknowledgement failed', 'error'); }
    finally { setBusy(false); }
  };

  const openReturn = (targetItems) => {
    setReturnTarget(targetItems);
    setReturnForm({ returnedDate: today(), condition: 'Good' });
    setReturnSig(null);
    setReturnName(currentUserName || '');
    setReturnOpen(true);
  };

  const doReturn = async () => {
    setBusy(true);
    try {
      let path = null;
      if (returnSig) path = await uploadKitSignature(currentUserId, returnSig, 'return');
      await recordKitReturn(returnTarget.map((i) => i.id), {
        returnedDate: returnForm.returnedDate,
        condition: returnForm.condition,
        signaturePath: path,
        signedName: returnName || currentUserName,
        returnedTo: currentUserId,
      });
      showToast('Return recorded', 'success');
      setReturnOpen(false);
      load();
    } catch (e) { showToast(e.message || 'Could not record return', 'error'); }
    finally { setBusy(false); }
  };

  const lose = async (it) => {
    if (!window.confirm(`Mark "${it.item}" as lost / damaged?`)) return;
    try { await markKitLost(it.id); showToast('Marked lost / damaged', 'success'); load(); }
    catch { showToast('Update failed', 'error'); }
  };
  const reinstate = async (it) => {
    try { await reinstateKitItem(it.id); showToast('Item reinstated', 'success'); load(); }
    catch { showToast('Update failed', 'error'); }
  };

  const saveSizes = async () => {
    setBusy(true);
    try { await saveUniformSizes(userId, sizesForm); setSizes(sizesForm); setSizesEditing(false); showToast('Sizes saved', 'success'); }
    catch (e) { showToast(e.message || 'Could not save sizes', 'error'); }
    finally { setBusy(false); }
  };

  const downloadReceipt = async () => {
    if (items.length === 0) { showToast('No kit to export yet', 'error'); return; }
    setBusy(true);
    try {
      const ackPath = items.filter((i) => i.ack_signature_path).sort((a, b) => String(b.acknowledged_at).localeCompare(String(a.acknowledged_at)))[0]?.ack_signature_path;
      const retPath = items.filter((i) => i.return_signature_path).sort((a, b) => String(b.returned_date).localeCompare(String(a.returned_date)))[0]?.return_signature_path;
      const [ackImg, retImg] = await Promise.all([
        ackPath ? kitSignatureDataUrl(ackPath) : null,
        retPath ? kitSignatureDataUrl(retPath) : null,
      ]);
      exportKitReceipt({
        crewName: crewName || 'Crew member', vesselName,
        generatedAt: fmtKitDate(today()), items, ackSig: ackImg, returnSig: retImg,
      });
    } catch (e) { showToast(e.message || 'Could not generate receipt', 'error'); }
    finally { setBusy(false); }
  };

  const statusPill = (it) => {
    if (it.status === 'returned') return { cls: 'miss', label: `Returned ${fmtKitDate(it.returned_date)}` };
    if (it.status === 'lost') return { cls: 'bad', label: 'Lost / damaged' };
    if (it.acknowledged_at) return { cls: 'ok', label: `Acknowledged ${fmtKitDate(it.acknowledged_at)}` };
    return { cls: 'amber', label: 'Awaiting acknowledgement' };
  };

  const metaBits = (it) => [
    it.size && `Size ${it.size}`,
    it.quantity > 1 && `×${it.quantity}`,
    it.serial && `S/N ${it.serial}`,
    it.condition_issued,
    it.issued_date && `Issued ${fmtKitDate(it.issued_date)}${it.issued_by_name ? ` by ${it.issued_by_name}` : ''}`,
    it.status === 'returned' && it.return_condition && `returned ${it.return_condition.toLowerCase()}`,
  ].filter(Boolean);

  const renderRow = (it) => {
    const pill = statusPill(it);
    const sigPath = it.status === 'returned' ? it.return_signature_path : it.ack_signature_path;
    return (
      <div key={it.id} className="cp-doc-row kit-row">
        <div className="min-w-0">
          <div className="cp-doc-title">{it.item}</div>
          <div className="cp-doc-meta">{metaBits(it).map((b, i) => <span key={i}>{b}</span>)}</div>
          {it.notes && <div className="kit-notes">{it.notes}</div>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {sigPath && sigUrls[sigPath] && (
            <img src={sigUrls[sigPath]} alt="Signature" className="kit-sig-thumb" title="Signature on file" />
          )}
          <span className={`cd-pill ${pill.cls}`}>{pill.label}</span>
          {canManage && it.status === 'in_service' && (
            <>
              <button onClick={() => openReturn([it])} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground" title="Record return"><Icon name="PackageCheck" size={15} /></button>
              <button onClick={() => lose(it)} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground" title="Mark lost / damaged"><Icon name="TriangleAlert" size={15} /></button>
              <button onClick={() => openEdit(it)} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground" title="Edit"><Icon name="Pencil" size={15} /></button>
              <button onClick={() => remove(it)} className="p-1.5 hover:bg-red-50 rounded-lg text-red-500" title="Remove"><Icon name="Trash2" size={15} /></button>
            </>
          )}
          {canManage && it.status !== 'in_service' && (
            <button onClick={() => reinstate(it)} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground" title="Reinstate to in-service"><Icon name="Undo2" size={15} /></button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div className="cp-section-head">
          <span className="cp-section-num">06 /</span>
          <h3>Issued Kit</h3>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {items.length > 0 && (
            <Button variant="outline" iconName="Download" size="sm" onClick={downloadReceipt} disabled={busy}>Receipt</Button>
          )}
          {canManage && <Button iconName="Plus" size="sm" onClick={openIssue}>Issue item</Button>}
        </div>
      </div>
      <p className="kit-sub">Uniform &amp; company kit issued to this crew member, signed for on receipt.</p>

      {loading ? (
        <div className="flex items-center justify-center py-16"><LogoSpinner size={32} /></div>
      ) : (
        <>
          {/* Uniform sizes (moved from Preferences) */}
          <div className="cp-group">
            <div className="cp-group-head">
              <span className="dia">◆</span><span className="t">Uniform sizes</span>
              <span className="t" style={{ fontSize: 13, color: '#9098B1' }}>· for ordering</span>
              <span className="line" />
              {canEditSizes && !sizesEditing && (
                <button className="kit-inline-edit" onClick={() => { setSizesForm(sizes); setSizesEditing(true); }}>Edit</button>
              )}
            </div>
            {sizesEditing ? (
              <>
                <div className="kit-size-grid">
                  {SIZE_FIELDS.map((f) => (
                    <label key={f.key} className="kit-field">
                      <span>{f.label}</span>
                      <input value={sizesForm[f.key]} onChange={(e) => setSizesForm((s) => ({ ...s, [f.key]: e.target.value }))} placeholder={f.ph} />
                    </label>
                  ))}
                </div>
                <div className="flex justify-end gap-2 mt-3">
                  <Button variant="outline" size="sm" onClick={() => setSizesEditing(false)}>Cancel</Button>
                  <Button size="sm" onClick={saveSizes} disabled={busy}>Save sizes</Button>
                </div>
              </>
            ) : (
              <div className="kit-size-grid">
                {SIZE_FIELDS.map((f) => (
                  <div key={f.key} className="kit-size-read">
                    <span className="lbl">{f.label}</span>
                    <span className={`val${sizes[f.key] ? '' : ' empty'}`}>{sizes[f.key] || '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {items.length === 0 ? (
            <div className="kit-empty">
              <Icon name="Shirt" size={26} style={{ color: '#AEB4C2' }} />
              <p>No kit issued yet.</p>
              {canManage && <Button variant="outline" size="sm" iconName="Plus" onClick={openIssue}>Issue the first item</Button>}
            </div>
          ) : (
            <>
              {/* Crew acknowledgement prompt */}
              {isOwnProfile && unacked.length > 0 && (
                <div className="kit-ack-banner">
                  <Icon name="PenLine" size={16} style={{ color: '#C65A1A' }} />
                  <span><strong>{unacked.length} item{unacked.length > 1 ? 's' : ''}</strong> awaiting your acknowledgement of receipt &amp; responsibility.</span>
                  <Button size="xs" onClick={() => { setAckName(currentUserName || ''); setAckOpen(true); }}>Acknowledge receipt</Button>
                </div>
              )}

              {/* Manager batch-return prompt */}
              {canManage && inService.length > 0 && (
                <div className="kit-return-bar">
                  <span>{inService.length} item{inService.length > 1 ? 's' : ''} in service</span>
                  <button onClick={() => openReturn(inService)}><Icon name="PackageCheck" size={14} /> Record return (all)</button>
                </div>
              )}

              {KIT_CATEGORIES.map((cat) => {
                const rows = inService.filter((i) => (i.category || 'other') === cat.id);
                if (rows.length === 0) return null;
                return (
                  <div className="cp-group" key={cat.id}>
                    <div className="cp-group-head"><span className="dia">◆</span><span className="t">{cat.label}</span><span className="line" /></div>
                    <div className="space-y-2">{rows.map(renderRow)}</div>
                  </div>
                );
              })}

              {archived.length > 0 && (
                <div className="cp-group">
                  <div className="cp-group-head"><span className="dia">◆</span><span className="t">Returned &amp; archived</span><span className="line" /></div>
                  <div className="space-y-2">{archived.map(renderRow)}</div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Issue / edit modal */}
      {formOpen && (
        <div className="kit-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setFormOpen(false); }}>
          <div className="kit-panel">
            <div className="kit-panel-head">
              <h4>{editing ? 'Edit item' : 'Issue item'}</h4>
              <button onClick={() => setFormOpen(false)} className="kit-x" title="Close"><Icon name="X" size={18} /></button>
            </div>
            <div className="kit-form">
              <label className="kit-field"><span>Category</span>
                <select value={form.category} onChange={(e) => setF('category', e.target.value)}>
                  {KIT_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
              <label className="kit-field kit-col-2"><span>Item <em>required</em></span>
                <input value={form.item} onChange={(e) => setF('item', e.target.value)} placeholder="e.g. Crew polo, foul-weather jacket, handheld radio" />
              </label>
              <label className="kit-field"><span>Size</span>
                <input value={form.size} onChange={(e) => setF('size', e.target.value)} placeholder="e.g. M, 42, UK 8" />
              </label>
              <label className="kit-field"><span>Quantity</span>
                <input type="number" min="1" value={form.quantity} onChange={(e) => setF('quantity', e.target.value)} />
              </label>
              <label className="kit-field"><span>Serial / asset no.</span>
                <input value={form.serial} onChange={(e) => setF('serial', e.target.value)} placeholder="electronics / keys" />
              </label>
              <label className="kit-field"><span>Condition</span>
                <select value={form.conditionIssued} onChange={(e) => setF('conditionIssued', e.target.value)}>
                  <option value="">—</option>
                  {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="kit-field"><span>Issued date</span>
                <input type="date" value={form.issuedDate} onChange={(e) => setF('issuedDate', e.target.value)} />
              </label>
              <label className="kit-field kit-col-2"><span>Notes <em>optional</em></span>
                <input value={form.notes} onChange={(e) => setF('notes', e.target.value)} placeholder="anything worth recording" />
              </label>
            </div>
            <div className="kit-panel-foot">
              <Button variant="outline" size="sm" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={saveForm} disabled={busy}>{editing ? 'Save' : 'Issue item'}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Acknowledge-receipt modal */}
      {ackOpen && (
        <div className="kit-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setAckOpen(false); }}>
          <div className="kit-panel">
            <div className="kit-panel-head">
              <h4>Acknowledge receipt</h4>
              <button onClick={() => setAckOpen(false)} className="kit-x" title="Close"><Icon name="X" size={18} /></button>
            </div>
            <div className="kit-ack-body">
              <p className="kit-ack-intro">I confirm I have received the following items and accept responsibility for their care and return:</p>
              <ul className="kit-ack-list">
                {unacked.map((i) => (
                  <li key={i.id}><span>{i.item}{i.size ? ` · ${i.size}` : ''}{i.quantity > 1 ? ` · ×${i.quantity}` : ''}</span><span className="kit-ack-cat">{kitCategoryLabel(i.category)}</span></li>
                ))}
              </ul>
              <label className="kit-field"><span>Your name</span>
                <input value={ackName} onChange={(e) => setAckName(e.target.value)} placeholder="Full name" />
              </label>
              <div className="kit-field"><span>Signature</span><SignaturePad onSign={setAckSig} height={120} /></div>
            </div>
            <div className="kit-panel-foot">
              <Button variant="outline" size="sm" onClick={() => setAckOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={doAcknowledge} disabled={busy || !ackSig}>Sign &amp; acknowledge</Button>
            </div>
          </div>
        </div>
      )}

      {/* Record-return modal */}
      {returnOpen && (
        <div className="kit-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setReturnOpen(false); }}>
          <div className="kit-panel">
            <div className="kit-panel-head">
              <h4>Record return</h4>
              <button onClick={() => setReturnOpen(false)} className="kit-x" title="Close"><Icon name="X" size={18} /></button>
            </div>
            <div className="kit-ack-body">
              <p className="kit-ack-intro">Confirming the following {returnTarget.length > 1 ? `${returnTarget.length} items have` : 'item has'} been returned:</p>
              <ul className="kit-ack-list">
                {returnTarget.map((i) => (
                  <li key={i.id}><span>{i.item}{i.size ? ` · ${i.size}` : ''}{i.quantity > 1 ? ` · ×${i.quantity}` : ''}</span><span className="kit-ack-cat">{kitCategoryLabel(i.category)}</span></li>
                ))}
              </ul>
              <div className="kit-form" style={{ padding: 0 }}>
                <label className="kit-field"><span>Returned date</span>
                  <input type="date" value={returnForm.returnedDate} onChange={(e) => setReturnForm((s) => ({ ...s, returnedDate: e.target.value }))} />
                </label>
                <label className="kit-field"><span>Condition on return</span>
                  <select value={returnForm.condition} onChange={(e) => setReturnForm((s) => ({ ...s, condition: e.target.value }))}>
                    {RETURN_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
              <label className="kit-field"><span>Received by (name)</span>
                <input value={returnName} onChange={(e) => setReturnName(e.target.value)} placeholder="Full name" />
              </label>
              <div className="kit-field"><span>Signature <em>optional</em></span><SignaturePad onSign={setReturnSig} height={110} /></div>
            </div>
            <div className="kit-panel-foot">
              <Button variant="outline" size="sm" onClick={() => setReturnOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={doReturn} disabled={busy}>Record return</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default IssuedKitTab;
