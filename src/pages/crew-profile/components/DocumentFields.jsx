import React from 'react';
import Input from '../../../components/ui/Input';
import DateInput from '../../../components/ui/DateInput';
import { groupedDocumentTypes, getDocType, suggestedExpiry } from '../documentTypes';

const labelCls = 'block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5';
const boxCls = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

// Shared editable field grid for a crew document — used by the single Add/Edit
// modal and by each row of the batch review, so they stay identical. Renders
// the type picker and exactly the fields the chosen type calls for. The
// file/advisory UI lives in the caller.
const DocumentFields = ({ form, onSet, onSetDetail, lockType = false }) => {
  const typeDef = getDocType(form.docType);
  // Honour the type's config; still show a field if a value was already saved
  // (don't strand legacy data on a type that now hides it).
  const showNumber = typeDef?.number !== false || !!form.documentNumber;
  const showExpiry = typeDef?.expiry !== false || !!form.expiryDate;
  const authorityLabel = typeDef?.authorityLabel || 'Issuing authority';
  const expiryLabel = typeDef?.expiryLabel || 'Expiry date';

  // For refresher-type certs, auto-fill the expiry/refresher date from the issue
  // date (issue + N years) when expiry is empty or still holds the previously
  // auto-derived value — never clobber a date the user set by hand.
  const onSetWithDerive = (k, v) => {
    onSet(k, v);
    if (k === 'issueDate') {
      const next = suggestedExpiry(form.docType, v);
      const prev = suggestedExpiry(form.docType, form.issueDate);
      if (next && (!form.expiryDate || form.expiryDate === prev)) onSet('expiryDate', next);
    } else if (k === 'docType') {
      const next = suggestedExpiry(v, form.issueDate);
      if (next && !form.expiryDate) onSet('expiryDate', next);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Type picker (categorised) */}
      <div className="md:col-span-2">
        <label className={labelCls}>Document type</label>
        <select className={boxCls} value={form.docType} disabled={lockType} onChange={(e) => onSetWithDerive('docType', e.target.value)}>
          <option value="">Select a document type…</option>
          {groupedDocumentTypes().map((g) => (
            <optgroup key={g.id} label={g.label}>
              {g.types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      {showNumber && (
        <div>
          <label className={labelCls}>Document number</label>
          <Input value={form.documentNumber} onChange={(e) => onSet('documentNumber', e.target.value)} placeholder="—" />
        </div>
      )}
      <div>
        <label className={labelCls}>{authorityLabel}</label>
        <Input value={form.issuingAuthority} onChange={(e) => onSet('issuingAuthority', e.target.value)} placeholder="—" />
      </div>

      {typeDef?.flagState && (
        <div>
          <label className={labelCls}>Issuing flag state</label>
          <Input value={form.flagState} onChange={(e) => onSet('flagState', e.target.value)} placeholder="e.g. Marshall Islands" />
        </div>
      )}

      <div>
        <label className={labelCls}>Issue date</label>
        <DateInput className={boxCls} value={form.issueDate || ''} onChange={(e) => onSetWithDerive('issueDate', e.target.value)} />
      </div>
      {showExpiry && (
        <div>
          <label className={labelCls}>{expiryLabel}</label>
          <DateInput className={boxCls} value={form.expiryDate || ''} onChange={(e) => onSet('expiryDate', e.target.value)} />
        </div>
      )}

      {/* Type-specific fields → details jsonb */}
      {(typeDef?.fields || []).map((f) => (
        <div key={f.key} className={f.type === 'select' ? 'md:col-span-2' : ''}>
          <label className={labelCls}>{f.label}</label>
          {f.type === 'select' ? (
            <select className={boxCls} value={form.details?.[f.key] || ''} onChange={(e) => onSetDetail(f.key, e.target.value)}>
              <option value="">Select…</option>
              {/* Keep a parsed/saved value that isn't in the preset list (e.g. an
                  AI-read licence grade) so it still shows as selected. */}
              {form.details?.[f.key] && !f.options.includes(form.details[f.key]) && (
                <option value={form.details[f.key]}>{form.details[f.key]}</option>
              )}
              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : f.type === 'date' ? (
            <DateInput className={boxCls} value={form.details?.[f.key] || ''} onChange={(e) => onSetDetail(f.key, e.target.value)} />
          ) : (
            <Input value={form.details?.[f.key] || ''} onChange={(e) => onSetDetail(f.key, e.target.value)} placeholder={f.placeholder || '—'} />
          )}
        </div>
      ))}
    </div>
  );
};

export default DocumentFields;
