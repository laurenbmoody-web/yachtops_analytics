import React, { useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import ModalShell from '../../../components/ui/ModalShell';
import { supabase } from '../../../lib/supabaseClient';
import { showToast } from '../../../utils/toast';
import {
  fetchTemplates, uploadTemplate, deleteTemplate, updateTemplateRoles,
  templateFitsRole, CONTRACT_TOKEN_GROUPS, ALL_TOKENS,
  analyzeDocxForTemplate, analyzePdfForTemplate, buildTemplateDocxFile,
} from '../utils/contractTemplates';
import './contract-template-modal.css';

// Tenant roles grouped by department, for mapping templates to roles.
async function fetchRoleGroups(tenantId) {
  const [{ data: std }, { data: custom }, { data: deps }] = await Promise.all([
    supabase.from('roles').select('name, department_id'),
    supabase.from('tenant_custom_roles').select('name, department_id').eq('tenant_id', tenantId),
    supabase.from('departments').select('id, name'),
  ]);
  const depName = new Map((deps || []).map((d) => [d.id, d.name]));
  const byDep = new Map();
  const add = (name, depId) => {
    if (!name) return;
    const key = depName.get(depId) || 'Other';
    if (!byDep.has(key)) byDep.set(key, new Set());
    byDep.get(key).add(name);
  };
  (std || []).forEach((r) => add(r.name, r.department_id));
  (custom || []).forEach((r) => add(r.name, r.department_id));
  return [...byDep.entries()]
    .map(([department, set]) => ({ department, roles: [...set].sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => (a.department === 'Other' ? 1 : b.department === 'Other' ? -1 : a.department.localeCompare(b.department)));
}

// Department-grouped, multi-select dropdown. Replaces a wall of role pills:
// selected roles show as removable chips; the rest live behind a dropdown.
const RoleSelect = ({ groups, selected, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const toggle = (r) => onChange(selected.includes(r) ? selected.filter((x) => x !== r) : [...selected, r]);
  const label = selected.length ? `${selected.length} role${selected.length > 1 ? 's' : ''} selected` : 'Any role';
  const q = query.trim().toLowerCase();
  const filtered = q
    ? groups.map((g) => ({ ...g, roles: g.roles.filter((r) => r.toLowerCase().includes(q)) })).filter((g) => g.roles.length)
    : groups;
  return (
    <div className={`ctm-roles${open ? ' is-open' : ''}`}>
      <button type="button" className="ctm-roles-trigger" onClick={() => setOpen((o) => !o)}>
        <span>{label}</span>
        <Icon name="ChevronDown" size={16} />
      </button>
      {selected.length > 0 && (
        <div className="ctm-roles-selected">
          {selected.map((r) => (
            <span key={r} className="ctm-chip is-sel">
              {r}
              <button type="button" onClick={() => toggle(r)} aria-label={`Remove ${r}`}><Icon name="X" size={11} /></button>
            </span>
          ))}
        </div>
      )}
      {open && (
        <div className="ctm-roles-panel">
          <input className="ctm-roles-search" autoFocus placeholder="Search roles…"
            value={query} onChange={(e) => setQuery(e.target.value)} />
          {groups.length === 0 && <span className="ctm-faint ctm-pad">No roles defined yet — leave blank for any role.</span>}
          {groups.length > 0 && filtered.length === 0 && <span className="ctm-faint ctm-pad">No roles match “{query}”.</span>}
          {filtered.map((g) => (
            <div key={g.department} className="ctm-roles-group">
              <div className="ctm-section-label">{g.department}</div>
              {g.roles.map((r) => (
                <label key={r} className="ctm-roles-opt">
                  <input type="checkbox" checked={selected.includes(r)} onChange={() => toggle(r)} />
                  <span>{r}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ContractTemplateModal = ({ tenantId, crewMember, selectedId, canManage, createdBy, onSelect, onClose }) => {
  const roleTitle = crewMember?.roleTitle || null;
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState([]);
  const [roleGroups, setRoleGroups] = useState([]);
  const [chosenId, setChosenId] = useState(selectedId || null);
  const [busy, setBusy] = useState(false);

  // Upload form
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [uploadRoles, setUploadRoles] = useState([]);
  const [showUpload, setShowUpload] = useState(false);   // reveal the upload-existing form
  // Vessel-templates list: collapsible + searchable
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  // Inline role editing
  const [editRolesId, setEditRolesId] = useState(null);
  const [editRoles, setEditRoles] = useState([]);
  const [showFields, setShowFields] = useState(false);
  // AI "templatize" review draft
  const [aiBusy, setAiBusy] = useState(false);
  const [draft, setDraft] = useState(null);   // { kind, mappings|templateText, buf }
  const [draftName, setDraftName] = useState('');
  const [draftRoles, setDraftRoles] = useState([]);

  const reload = async () => {
    setLoading(true);
    try {
      setTemplates(await fetchTemplates(tenantId));
    } catch (e) {
      console.error('[templates] load failed', e);
      showToast('Could not load templates.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    fetchRoleGroups(tenantId).then(setRoleGroups).catch(() => setRoleGroups([]));
  }, [tenantId]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Suggested (role-matching) templates first.
  const sorted = [...templates].sort((a, b) => {
    const af = templateFitsRole(a, roleTitle), bf = templateFitsRole(b, roleTitle);
    if (af !== bf) return af ? -1 : 1;
    return 0;
  });

  // role name → department, for grouping templates the same way as the selector.
  const roleDept = {};
  roleGroups.forEach((g) => g.roles.forEach((r) => { roleDept[r.toLowerCase()] = g.department; }));
  const deptOf = (t) => {
    const roles = t.roles || [];
    if (!roles.length) return 'Any role';
    return roleDept[roles[0].toLowerCase()] || 'Other';
  };
  // Search + group the templates by department for the collapsible list.
  const q = templateSearch.trim().toLowerCase();
  const visible = sorted.filter((t) => !q
    || (t.name || '').toLowerCase().includes(q)
    || (t.file_name || '').toLowerCase().includes(q)
    || (t.roles || []).some((r) => r.toLowerCase().includes(q)));
  const grouped = [];
  visible.forEach((t) => {
    const d = deptOf(t);
    let g = grouped.find((x) => x.department === d);
    if (!g) { g = { department: d, items: [] }; grouped.push(g); }
    g.items.push(t);
  });
  grouped.sort((a, b) => (a.department === 'Any role' ? 1 : b.department === 'Any role' ? -1 : a.department.localeCompare(b.department)));

  const handleUpload = async () => {
    if (!file) { showToast('Choose a .docx file first.', 'error'); return; }
    setBusy(true);
    try {
      const created = await uploadTemplate({ tenantId, file, name, roles: uploadRoles, createdBy });
      setFile(null); setName(''); setUploadRoles([]); setShowUpload(false); setTemplatesOpen(true);
      if (!created?.tokens?.length) {
        showToast(
          /\.pdf$/i.test(created?.file_name || '')
            ? 'Added — but this PDF has no fillable form fields, so generating will produce an unchanged copy. Add form fields in a PDF editor, or upload a .docx.'
            : 'Added — but no {{tokens}} were found, so generating will produce an unchanged copy.',
          'info',
        );
      } else {
        showToast('Template added.', 'success');
      }
      await reload();
    } catch (e) {
      console.error('[templates] upload failed', e);
      showToast(e?.message || 'Upload failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  // AI: analyse a completed contract and open the review draft.
  const handleAnalyze = async (f) => {
    if (!f) return;
    const lower = f.name.toLowerCase();
    if (!lower.endsWith('.docx') && !lower.endsWith('.pdf')) {
      showToast('Upload a completed contract as .docx or .pdf.', 'error');
      return;
    }
    setAiBusy(true);
    try {
      const result = lower.endsWith('.pdf')
        ? await analyzePdfForTemplate(f)
        : await analyzeDocxForTemplate(f);
      setDraft(result);
      setDraftName('');   // let the user name it
      setDraftRoles([]);  // let the user assign roles — don't assume the current profile's role
      if (result.kind === 'map' && !result.mappings.length) {
        showToast('No particulars were detected — you can still review and adjust.', 'info');
      }
    } catch (e) {
      console.error('[templatize] failed', e);
      showToast(e?.message || 'Could not analyse that contract.', 'error');
    } finally {
      setAiBusy(false);
    }
  };

  const updateMappingToken = (i, token) =>
    setDraft((d) => ({ ...d, mappings: d.mappings.map((m, idx) => idx === i ? { ...m, token } : m) }));
  const removeMapping = (i) =>
    setDraft((d) => ({ ...d, mappings: d.mappings.filter((_, idx) => idx !== i) }));

  const handleSaveDraft = async () => {
    if (!draft) return;
    if (!draftName.trim()) { showToast('Give the template a name first.', 'error'); return; }
    setBusy(true);
    try {
      // A rebuilt (PDF) template gets the vessel logo embedded in its header.
      let logoUrl = null;
      if (draft.kind === 'rebuild') {
        const { data: v } = await supabase.from('vessels').select('logo_url').eq('tenant_id', tenantId).maybeSingle();
        logoUrl = v?.logo_url || null;
      }
      const { file: docxFile, notFound } = await buildTemplateDocxFile(draft, draftName.trim(), { logoUrl });
      await uploadTemplate({ tenantId, file: docxFile, name: draftName, roles: draftRoles, createdBy });
      setDraft(null); setDraftName(''); setDraftRoles([]); setTemplatesOpen(true);
      if (notFound?.length) {
        showToast(`Template saved. ${notFound.length} value(s) couldn’t be auto-replaced (likely split formatting) — open the .docx and check.`, 'info');
      } else {
        showToast('Template created from contract.', 'success');
      }
      await reload();
    } catch (e) {
      console.error('[templatize] save failed', e);
      showToast(e?.message || 'Could not save the template.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (t) => {
    if (!window.confirm(`Delete template “${t.name}”?`)) return;
    setBusy(true);
    try {
      await deleteTemplate(t);
      if (chosenId === t.id) setChosenId(null);
      showToast('Template deleted.', 'success');
      await reload();
    } catch (e) {
      console.error('[templates] delete failed', e);
      showToast('Delete failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveEditRoles = async (t) => {
    setBusy(true);
    try {
      await updateTemplateRoles(t.id, editRoles);
      setEditRolesId(null);
      await reload();
    } catch (e) {
      showToast('Could not update roles.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmSelect = () => {
    const t = templates.find((x) => x.id === chosenId);
    if (!t) return;
    onSelect(t);
    onClose();
  };

  const renderReview = () => (
    <div className="ctm-review">
      <button type="button" className="ctm-back" onClick={() => setDraft(null)} disabled={busy}>
        <Icon name="ChevronLeft" size={15} /> Back
      </button>
      <div className="ctm-section-label">Review the template Cargo built</div>
      <p className="ctm-faint">
        {draft.kind === 'map'
          ? 'These particulars were detected and will be swapped for tokens in your original document, keeping its formatting. Adjust the token for any row, or remove rows you don’t want tokenised.'
          : 'The contract was rebuilt as editable text with tokens (PDF formatting isn’t preserved). Edit anything below before saving.'}
      </p>

      {draft.kind === 'map' ? (
        <div className="ctm-map">
          {draft.mappings.length === 0 && <span className="ctm-faint">No particulars detected.</span>}
          {draft.mappings.map((m, i) => (
            <div key={i} className="ctm-map-row">
              <span className="ctm-map-val" title={m.value}>{m.value}</span>
              <Icon name="ArrowRight" size={13} />
              <select className="ctm-select" value={m.token} onChange={(e) => updateMappingToken(i, e.target.value)}>
                {!ALL_TOKENS.includes(m.token) && <option value={m.token}>{m.token}</option>}
                {ALL_TOKENS.map((tk) => <option key={tk} value={tk}>{tk}</option>)}
              </select>
              <button type="button" className="ctm-icon danger" onClick={() => removeMapping(i)} title="Remove">
                <Icon name="X" size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <>
          {(draft.coverText || '').trim() !== '' && (
            <>
              <span className="ctm-label">Cover page <span className="ctm-faint">(centred, on its own page)</span></span>
              <textarea className="ctm-textarea" value={draft.coverText || ''}
                onChange={(e) => setDraft((d) => ({ ...d, coverText: e.target.value }))} rows={6} />
              <span className="ctm-label">Body</span>
            </>
          )}
          <textarea className="ctm-textarea" value={draft.templateText}
            onChange={(e) => setDraft((d) => ({ ...d, templateText: e.target.value }))} rows={12} />
          <span className="ctm-label">Page header <span className="ctm-faint">(prints on every page)</span></span>
          <textarea className="ctm-textarea" value={draft.headerText || ''}
            onChange={(e) => setDraft((d) => ({ ...d, headerText: e.target.value }))} rows={2} />
          <span className="ctm-label">Page footer <span className="ctm-faint">(prints on every page)</span></span>
          <textarea className="ctm-textarea" value={draft.footerText || ''}
            onChange={(e) => setDraft((d) => ({ ...d, footerText: e.target.value }))} rows={2} />
        </>
      )}

      <span className="ctm-label">Template name</span>
      <input className="ctm-input" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
      <span className="ctm-label">Applies to roles <span className="ctm-faint">(optional)</span></span>
      <RoleSelect groups={roleGroups} selected={draftRoles} onChange={setDraftRoles} />

      <div className="ctm-row-edit-actions" style={{ marginTop: 16 }}>
        <button type="button" className="ctm-btn ghost" onClick={() => setDraft(null)} disabled={busy}>Discard</button>
        <button type="button" className="ctm-btn fill" onClick={handleSaveDraft} disabled={busy}>
          {busy ? 'Saving…' : 'Create template'}
        </button>
      </div>
    </div>
  );

  const renderRow = (t) => {
    // "Suggested" = the template explicitly lists this crew member's role. An
    // unrestricted (Any role) template is eligible but not specifically suggested.
    const suggested = !!(roleTitle && (t.roles || []).some((r) => r.toLowerCase() === String(roleTitle).toLowerCase()));
    const editing = editRolesId === t.id;
    return (
      <div key={t.id} className={`ctm-row${chosenId === t.id ? ' is-sel' : ''}`}>
        <button type="button" className="ctm-row-main" onClick={() => setChosenId(t.id)}>
          <span className={`ctm-radio${chosenId === t.id ? ' on' : ''}`} aria-hidden />
          <span className="ctm-row-info">
            <span className="ctm-row-name">
              {t.name}
              {suggested && <span className="ctm-tag suggest">Suggested</span>}
              {!t.tokens?.length && <span className="ctm-tag warn">No fillable fields</span>}
            </span>
            <span className="ctm-row-meta">
              <span className="ctm-pill format">{/\.pdf$/i.test(t.file_name || '') ? 'PDF' : 'DOCX'}</span>
              {(t.roles?.length ? t.roles : ['Any role']).map((r) => (
                <span key={r} className="ctm-pill">{r}</span>
              ))}
              <span className="ctm-faint">· {t.tokens?.length || 0} fields · {t.file_name}</span>
            </span>
          </span>
        </button>
        {canManage && (
          <div className="ctm-row-actions">
            <button type="button" className="ctm-icon" title="Edit roles" disabled={busy}
              onClick={() => { setEditRolesId(editing ? null : t.id); setEditRoles(t.roles || []); }}>
              <Icon name="Tag" size={15} />
            </button>
            <button type="button" className="ctm-icon danger" title="Delete" disabled={busy}
              onClick={() => handleDelete(t)}>
              <Icon name="Trash2" size={15} />
            </button>
          </div>
        )}
        {editing && (
          <div className="ctm-row-edit">
            <span className="ctm-label">Applies to roles</span>
            <RoleSelect groups={roleGroups} selected={editRoles} onChange={setEditRoles} />
            <div className="ctm-row-edit-actions">
              <button type="button" className="ctm-btn ghost sm" onClick={() => setEditRolesId(null)}>Cancel</button>
              <button type="button" className="ctm-btn fill sm" disabled={busy} onClick={() => saveEditRoles(t)}>Save roles</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <ModalShell onClose={onClose} isBusy={busy} panelClassName="ctm-panel">
      <div className="ctm">
        <div className="ctm-head">
          <div>
            <h3 className="ctm-title">Contract templates</h3>
            <p className="ctm-sub">
              {crewMember?.fullName || 'Crew member'}{roleTitle ? ` · ${roleTitle}` : ''}
            </p>
          </div>
          <button className="ctm-close" onClick={onClose} disabled={busy} aria-label="Close">
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="ctm-body">
          {draft ? renderReview() : (<>
          {/* Vessel templates — collapsible, searchable, grouped by department */}
          <button type="button" className="ctm-section-toggle" onClick={() => setTemplatesOpen((o) => !o)}>
            <Icon name={templatesOpen ? 'ChevronDown' : 'ChevronRight'} size={16} />
            <span className="ctm-section-label" style={{ margin: 0 }}>Vessel templates</span>
            <span className="ctm-faint">({templates.length})</span>
          </button>
          {templatesOpen && (
            <div className="ctm-templates">
              {loading ? (
                <p className="ctm-faint ctm-pad">Loading templates…</p>
              ) : templates.length === 0 ? (
                <p className="ctm-faint ctm-pad">
                  No templates yet.{canManage ? ' Add one below.' : ' Ask COMMAND to add one.'}
                </p>
              ) : (
                <>
                  <input className="ctm-search" placeholder="Search templates…"
                    value={templateSearch} onChange={(e) => setTemplateSearch(e.target.value)} />
                  {grouped.length === 0 && <p className="ctm-faint ctm-pad">No templates match “{templateSearch}”.</p>}
                  {grouped.map((g) => (
                    <div key={g.department} className="ctm-tpl-group">
                      <div className="ctm-section-label">{g.department}</div>
                      <div className="ctm-list">{g.items.map(renderRow)}</div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Add a template (COMMAND) — upload an existing one, or build from a contract */}
          {canManage && (
            <div className="ctm-upload">
              <div className="ctm-section-label">Add a template</div>
              <div className="ctm-add-actions">
                <button type="button" className={`ctm-add-btn${showUpload ? ' is-on' : ''}`} onClick={() => setShowUpload((s) => !s)}>
                  <Icon name="Upload" size={16} />
                  <span className="t">Upload a .docx / .pdf template</span>
                  <span className="d">An existing template with {'{{tokens}}'} or named PDF fields</span>
                </button>
                <label className={`ctm-add-btn${aiBusy ? ' busy' : ''}`}>
                  <input type="file" accept=".docx,.pdf" disabled={aiBusy}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; handleAnalyze(f); }} />
                  <Icon name="Sparkles" size={16} />
                  <span className="t">{aiBusy ? 'Analysing contract…' : 'Upload a contract — we’ll build it'}</span>
                  <span className="d">We tokenise a completed contract into a template for you</span>
                </label>
              </div>

              {showUpload && (
                <div className="ctm-upload-form">
                  <p className="ctm-faint">
                    Upload a Word <b>.docx</b> with <code>{'{{tokens}}'}</code> where data should go
                    (e.g. <code>{'{{crew_name}}'}</code>), or a <b>.pdf</b> with form fields
                    <i>named</i> after the tokens. A flat PDF (no form fields) can’t be auto-filled.
                  </p>
                  <label className="ctm-file">
                    <input type="file" accept=".docx,.pdf" onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      setFile(f);
                      if (f && !name) setName(f.name.replace(/\.(docx|pdf)$/i, ''));
                    }} />
                    <Icon name="Upload" size={15} />
                    <span>{file ? file.name : 'Choose .docx or .pdf file'}</span>
                  </label>
                  <input className="ctm-input" placeholder="Template name (e.g. Deckhand SEA)"
                    value={name} onChange={(e) => setName(e.target.value)} />
                  <span className="ctm-label">Applies to roles <span className="ctm-faint">(optional — blank = any)</span></span>
                  <RoleSelect groups={roleGroups} selected={uploadRoles} onChange={setUploadRoles} />
                  <button type="button" className="ctm-btn fill" disabled={busy || !file} onClick={handleUpload}>
                    {busy ? 'Working…' : 'Upload template'}
                  </button>

                  {/* Token reference — only relevant when hand-building a template */}
                  <button type="button" className="ctm-fields-toggle" onClick={() => setShowFields((s) => !s)}>
                    <Icon name={showFields ? 'ChevronDown' : 'ChevronRight'} size={15} />
                    Available fields ({CONTRACT_TOKEN_GROUPS.reduce((n, g) => n + g.tokens.length, 0)})
                  </button>
                  {showFields && (
                    <div className="ctm-fields">
                      <p className="ctm-faint" style={{ marginBottom: 10 }}>
                        In a <b>.docx</b>, write <code>{'{{token}}'}</code>. In a <b>.pdf</b>, name the
                        form field with the token (e.g. a field called <code>crew_name</code>).
                      </p>
                      {CONTRACT_TOKEN_GROUPS.map((g) => (
                        <div key={g.group} className="ctm-fields-group">
                          <span className="ctm-section-label">{g.group}</span>
                          <div className="ctm-fields-list">
                            {g.tokens.map(([k, label]) => (
                              <span key={k} className="ctm-token" title={label}><code>{`{{${k}}}`}</code> {label}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          </>)}
        </div>

        <div className="ctm-foot">
          <button type="button" className="ctm-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="ctm-btn fill" disabled={busy || !chosenId} onClick={confirmSelect}>
            Use this template
          </button>
        </div>
      </div>
    </ModalShell>
  );
};

export default ContractTemplateModal;
