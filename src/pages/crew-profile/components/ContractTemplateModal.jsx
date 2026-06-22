import React, { useEffect, useState } from 'react';
import Icon from '../../../components/AppIcon';
import ModalShell from '../../../components/ui/ModalShell';
import { supabase } from '../../../lib/supabaseClient';
import { showToast } from '../../../utils/toast';
import {
  fetchTemplates, uploadTemplate, deleteTemplate, updateTemplateRoles,
  templateFitsRole, CONTRACT_TOKEN_GROUPS,
} from '../utils/contractTemplates';
import './contract-template-modal.css';

// Distinct role names available in the tenant, for mapping templates to roles.
async function fetchRoleOptions(tenantId) {
  const names = new Set();
  const [{ data: std }, { data: custom }] = await Promise.all([
    supabase.from('roles').select('name'),
    supabase.from('tenant_custom_roles').select('name').eq('tenant_id', tenantId),
  ]);
  (std || []).forEach((r) => r?.name && names.add(r.name));
  (custom || []).forEach((r) => r?.name && names.add(r.name));
  return [...names].sort((a, b) => a.localeCompare(b));
}

const RoleChips = ({ options, selected, onToggle }) => (
  <div className="ctm-chips">
    {options.length === 0 && <span className="ctm-faint">No roles defined yet — leave blank for any role.</span>}
    {options.map((r) => (
      <button
        key={r}
        type="button"
        className={`ctm-chip${selected.includes(r) ? ' is-sel' : ''}`}
        onClick={() => onToggle(r)}
      >{r}</button>
    ))}
  </div>
);

const ContractTemplateModal = ({ tenantId, crewMember, selectedId, canManage, createdBy, onSelect, onClose }) => {
  const roleTitle = crewMember?.roleTitle || null;
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState([]);
  const [roleOptions, setRoleOptions] = useState([]);
  const [chosenId, setChosenId] = useState(selectedId || null);
  const [busy, setBusy] = useState(false);

  // Upload form
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [uploadRoles, setUploadRoles] = useState([]);
  // Inline role editing
  const [editRolesId, setEditRolesId] = useState(null);
  const [editRoles, setEditRoles] = useState([]);
  const [showFields, setShowFields] = useState(false);

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
    fetchRoleOptions(tenantId).then(setRoleOptions).catch(() => setRoleOptions([]));
  }, [tenantId]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Suggested (role-matching) templates first.
  const sorted = [...templates].sort((a, b) => {
    const af = templateFitsRole(a, roleTitle), bf = templateFitsRole(b, roleTitle);
    if (af !== bf) return af ? -1 : 1;
    return 0;
  });

  const handleUpload = async () => {
    if (!file) { showToast('Choose a .docx file first.', 'error'); return; }
    setBusy(true);
    try {
      const created = await uploadTemplate({ tenantId, file, name, roles: uploadRoles, createdBy });
      setFile(null); setName(''); setUploadRoles([]);
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
          {/* Template list */}
          {loading ? (
            <p className="ctm-faint ctm-pad">Loading templates…</p>
          ) : sorted.length === 0 ? (
            <p className="ctm-faint ctm-pad">
              No templates yet.{canManage ? ' Upload your vessel’s contract template below.' : ' Ask COMMAND to add one.'}
            </p>
          ) : (
            <div className="ctm-list">
              {sorted.map((t) => {
                const fits = templateFitsRole(t, roleTitle);
                const editing = editRolesId === t.id;
                return (
                  <div key={t.id} className={`ctm-row${chosenId === t.id ? ' is-sel' : ''}`}>
                    <button type="button" className="ctm-row-main" onClick={() => setChosenId(t.id)}>
                      <span className={`ctm-radio${chosenId === t.id ? ' on' : ''}`} aria-hidden />
                      <span className="ctm-row-info">
                        <span className="ctm-row-name">
                          {t.name}
                          {fits && <span className="ctm-tag suggest">Suggested</span>}
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
                        <RoleChips options={roleOptions} selected={editRoles}
                          onToggle={(r) => setEditRoles((p) => p.includes(r) ? p.filter((x) => x !== r) : [...p, r])} />
                        <div className="ctm-row-edit-actions">
                          <button type="button" className="ctm-btn ghost sm" onClick={() => setEditRolesId(null)}>Cancel</button>
                          <button type="button" className="ctm-btn fill sm" disabled={busy} onClick={() => saveEditRoles(t)}>Save roles</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Upload (COMMAND) */}
          {canManage && (
            <div className="ctm-upload">
              <div className="ctm-section-label">Add a template</div>
              <p className="ctm-faint">
                Upload a Word <b>.docx</b> with <code>{'{{tokens}}'}</code> where data should go
                (e.g. <code>{'{{crew_name}}'}</code>), or a <b>.pdf</b> with form fields
                <i>named</i> after the tokens. Cargo fills them when generating. A flat PDF
                (no form fields) can’t be auto-filled.
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
              <RoleChips options={roleOptions} selected={uploadRoles}
                onToggle={(r) => setUploadRoles((p) => p.includes(r) ? p.filter((x) => x !== r) : [...p, r])} />
              <button type="button" className="ctm-btn fill" disabled={busy || !file} onClick={handleUpload}>
                {busy ? 'Working…' : 'Upload template'}
              </button>
            </div>
          )}

          {/* Available fields reference */}
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
