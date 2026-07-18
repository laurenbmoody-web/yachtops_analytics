import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AlertCircle, Check, Copy, Pencil, Info as InfoIcon, Camera, Upload } from 'lucide-react';
import { FLAG_STATES } from '../../data/flagStates';
import { COUNTRIES } from '../../data/countries';
import './vessel-stack.css';

/* ── option sets ── */
const VTYPE = ['Motor Yacht', 'Sailing Yacht', 'Catamaran', 'Explorer', 'Sport Yacht', 'Superyacht'];
const CSTAT = ['Private', 'Commercial', 'Charter', 'Dual'];
const AREA = ['Coastal', 'Near Coastal', 'Unlimited'];
const REGIONS = [
  'Mediterranean', 'West Mediterranean', 'East Mediterranean', 'Adriatic', 'Caribbean',
  'Bahamas', 'US East Coast', 'US West Coast', 'New England', 'Pacific Northwest',
  'Central America', 'South America', 'Northern Europe', 'Baltic', 'Scandinavia',
  'Canary Islands', 'Atlantic crossing', 'Indian Ocean', 'Red Sea', 'Middle East',
  'Southeast Asia', 'Japan', 'South Pacific', 'French Polynesia', 'Australia',
  'New Zealand', 'Antarctica', 'Arctic', 'West Africa', 'East Africa', 'Seychelles', 'Maldives',
];
const opt = (arr) => arr.map((v) => ({ value: v, label: v }));

/* Flag-state name → emoji. Names that aren't a single country fall back to none. */
const FLAG_EMOJI = {
  'Cayman Islands': '🇰🇾', 'Marshall Islands': '🇲🇭', 'Malta': '🇲🇹', 'Jersey': '🇯🇪',
  'Guernsey': '🇬🇬', 'Isle of Man': '🇮🇲', 'Bermuda': '🇧🇲', 'British Virgin Islands': '🇻🇬',
  'Gibraltar': '🇬🇮', 'United Kingdom': '🇬🇧', 'Madeira (Portugal)': '🇵🇹', 'Netherlands': '🇳🇱',
  'Italy': '🇮🇹', 'France': '🇫🇷', 'Spain': '🇪🇸', 'Monaco': '🇲🇨', 'Antigua and Barbuda': '🇦🇬',
  'St Vincent and the Grenadines': '🇻🇨', 'Bahamas': '🇧🇸', 'Panama': '🇵🇦', 'Liberia': '🇱🇷',
  'United States': '🇺🇸', 'Australia': '🇦🇺', 'New Zealand': '🇳🇿', 'Portugal': '🇵🇹',
  'Luxembourg': '🇱🇺', 'Germany': '🇩🇪', 'Norway': '🇳🇴', 'Sweden': '🇸🇪', 'Denmark': '🇩🇰',
  'Turkey': '🇹🇷', 'Greece': '🇬🇷', 'Croatia': '🇭🇷', 'Belize': '🇧🇿',
};
const flagEmoji = (n) => FLAG_EMOJI[n] || '';

const isData = (t) => ['text', 'num', 'code', 'select', 'flag', 'textarea'].includes(t);

const ico = (paths) => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">{paths}</svg>
);

/* ── tooltip (fixed-position so a card's overflow never clips it) ── */
function Info({ text }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    let left = Math.max(10, Math.min(r.left + r.width / 2 - 119, window.innerWidth - 248));
    let top = r.bottom + 8;
    if (top + 130 > window.innerHeight) top = r.top - 130;
    setPos({ left, top });
  };
  const hide = () => setPos(null);
  return (
    <>
      <button ref={ref} type="button" className="vs-info" aria-label="More information"
        onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
        onClick={(e) => e.stopPropagation()}>
        <InfoIcon size={13} />
      </button>
      {pos && <div className="vs-tip" style={{ left: pos.left, top: pos.top }}>{text}</div>}
    </>
  );
}

/* ── one editable field row ── */
function FieldRow({ cfg, value, canEdit, onSave, toast, focusField, onFocused }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState(null); // 'saving' | 'saved'
  const [invalid, setInvalid] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(null); // {left,top,width}
  const [menuQuery, setMenuQuery] = useState('');
  const inputRef = useRef(null);
  const valRef = useRef(null);
  const menuRef = useRef(null);

  const isSelect = cfg.type === 'select' || cfg.type === 'flag';
  const editable = canEdit && !cfg.disabled;
  const empty = value === '' || value == null;

  useEffect(() => {
    if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select?.(); }
  }, [editing]);

  useEffect(() => {
    if (!menu) return undefined;
    const h = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menu]);

  const validate = (v) => {
    if (cfg.validate === 'imo') {
      const ok = /^\d{7}$/.test(String(v).trim()) || !String(v).trim();
      setInvalid(!ok);
      return ok;
    }
    return true;
  };

  const openEdit = () => {
    if (!editable) return;
    if (isSelect) {
      const r = valRef.current?.getBoundingClientRect();
      if (r) { setMenuQuery(''); setMenu({ left: r.left, top: r.bottom + 6, width: Math.max(210, r.width + 40) }); }
      return;
    }
    setDraft(value == null ? '' : String(value));
    setInvalid(false);
    setEditing(true);
  };

  // Open this field's editor when the completion dropdown jumps to it.
  useEffect(() => {
    if (focusField && focusField === cfg.field && editable && !editing && !menu) {
      openEdit();
      onFocused && onFocused();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusField]);

  const runSave = async (nextVal) => {
    setStatus('saving');
    const ok = await onSave(cfg.field, nextVal);
    setStatus(ok ? 'saved' : null);
    toast(ok ? 'Saved' : 'Couldn’t save — try again', !ok);
    if (ok) setTimeout(() => setStatus(null), 1600);
  };

  const commit = async (soft) => {
    if (!editing) return;
    if (!validate(draft)) { if (!soft) inputRef.current?.focus(); return; }
    setEditing(false);
    const nv = typeof draft === 'string' ? draft.trim() : draft;
    if (String(nv) !== String(value == null ? '' : value)) await runSave(nv);
  };

  const pick = async (o) => {
    setMenu(null);
    if (String(o.value) !== String(value)) await runSave(o.value);
  };

  const copy = () => {
    try { navigator.clipboard?.writeText(String(value)); } catch (e) { /* ignore */ }
    setCopied(true);
    toast(`Copied ${value}`);
    setTimeout(() => setCopied(false), 1400);
  };

  const label = isSelect ? (cfg.opts.find((o) => String(o.value) === String(value))?.label ?? value) : value;
  const cls = cfg.type === 'num' ? 'num' : cfg.type === 'code' ? 'code' : isSelect ? 'sel' : '';

  return (
    <div className={`vs-f${cfg.full ? ' full' : ''}${status === 'saved' ? ' saved' : ''}`} id={`vs-f-${cfg.field}`}>
      <p className="vs-fk">
        {cfg.req && <span className="req" title="Required" />}
        {cfg.label}
        {cfg.opt && <span className="vs-opt">optional</span>}
        {cfg.info && <Info text={cfg.info} />}
        {cfg.drives && <span className="drv">→ {cfg.drives}</span>}
      </p>
      <div className="vs-fvw">
        {editing ? (
          cfg.type === 'textarea' ? (
            <textarea ref={inputRef} className="vs-ta" value={draft} rows={4}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); } else if (e.key === 'Escape') { setEditing(false); } }}
              onBlur={() => commit(true)} />
          ) : (
            <input ref={inputRef} className={`vs-inp${invalid ? ' bad' : ''}`}
              inputMode={cfg.type === 'num' || cfg.validate === 'imo' ? 'numeric' : 'text'}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); if (cfg.validate) validate(e.target.value); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { setEditing(false); } }}
              onBlur={() => commit(true)} />
          )
        ) : empty ? (
          <button ref={valRef} type="button" className={`vs-fv empty${editable ? '' : ' ro'}`} onClick={openEdit}>
            <span className="p">＋</span>{cfg.placeholder || 'Add'}
          </button>
        ) : (
          <button ref={valRef} type="button" className={`vs-fv ${cls}${editable ? '' : ' ro'}`} onClick={openEdit}>
            {cfg.type === 'flag' && flagEmoji(value) && <span className="vs-flag">{flagEmoji(value)}</span>}
            <span>{label}</span>
            {cfg.unit && <span className="u">{cfg.unit}</span>}
          </button>
        )}

        <div className="vs-status">
          {status === 'saving' && <div className="vs-spin" />}
          {status === 'saved' && <div className="vs-check"><Check size={11} strokeWidth={3.2} /></div>}
        </div>

        {cfg.copy && !editing && !empty && (
          <button type="button" className={`vs-editaff${copied ? ' vs-copyok' : ''}`} onClick={copy} title="Copy">
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        )}
        {!cfg.copy && !isSelect && editable && !editing && (
          <button type="button" className="vs-editaff" onClick={openEdit} title="Edit"><Pencil size={13} /></button>
        )}
      </div>

      {editing && cfg.validate === 'imo' && (
        <div className={`vs-hintmsg${invalid ? ' err' : ''}`}>{invalid ? 'IMO must be exactly 7 digits' : '7-digit IMO number'}</div>
      )}

      {menu && (
        <div ref={menuRef} className="vs-menu" style={{ position: 'fixed', left: menu.left, top: menu.top, minWidth: menu.width }}>
          {cfg.opts.length > 10 && (
            <input className="vs-menu-search" autoFocus value={menuQuery} placeholder="Search…"
              onClick={(e) => e.stopPropagation()} onChange={(e) => setMenuQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(null); } }} />
          )}
          <div className="vs-menu-list">
            {cfg.opts.filter((o) => o.label.toLowerCase().includes(menuQuery.trim().toLowerCase())).map((o) => (
              <button key={String(o.value)} type="button" className={String(o.value) === String(value) ? 'sel' : ''} onClick={() => pick(o)}>
                {cfg.type === 'flag' && flagEmoji(o.value) && <span className="vs-flag">{flagEmoji(o.value)}</span>}
                <span>{o.label}</span>
                <span className="ck"><Check size={14} /></span>
              </button>
            ))}
            {cfg.opts.filter((o) => o.label.toLowerCase().includes(menuQuery.trim().toLowerCase())).length === 0 && (
              <div className="vs-menu-empty">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleRow({ cfg, value, canEdit, onSave, toast }) {
  const on = !!value;
  const disabled = !canEdit || cfg.disabled;
  const toggle = async () => {
    if (disabled) return;
    const ok = await onSave(cfg.field, !on);
    toast(ok ? `${cfg.label} ${!on ? 'on' : 'off'}` : 'Couldn’t save — try again', !ok);
  };
  return (
    <div className="vs-f tog">
      <div className="tl">
        <div className="n">{cfg.label}{cfg.info && <Info text={cfg.info} />}</div>
        {cfg.d && <div className="d">{cfg.d}</div>}
      </div>
      <button type="button" className={`vs-sw${on ? ' on' : ''}`} disabled={disabled} role="switch" aria-checked={on} onClick={toggle}><i /></button>
    </div>
  );
}

function DeptPills({ cfg, value, options, canEdit, onSave, toast }) {
  const sel = new Set(value || []);
  const toggle = async (id) => {
    if (!canEdit) return;
    const next = new Set(sel);
    next.has(id) ? next.delete(id) : next.add(id);
    const ok = await onSave('departments_in_use', [...next]);
    toast(ok ? 'Departments updated' : 'Couldn’t save — try again', !ok);
  };
  return (
    <div className="vs-f full">
      <p className="vs-fk">{cfg.label}{cfg.info && <Info text={cfg.info} />}</p>
      <div className="vs-pills">
        {(options || []).map((o) => (
          <button key={o.value} type="button" className={`vs-pill${sel.has(o.value) ? ' on' : ''}`} disabled={!canEdit} onClick={() => toggle(o.value)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

/* Multiselect pills backed by a comma-separated text column (e.g. operating regions). */
function TagPills({ cfg, value, canEdit, onSave, toast }) {
  const sel = new Set(String(value || '').split(',').map((s) => s.trim()).filter(Boolean));
  const toggle = async (opt) => {
    if (!canEdit) return;
    const next = new Set(sel);
    next.has(opt) ? next.delete(opt) : next.add(opt);
    const ok = await onSave(cfg.field, [...next].join(', '));
    toast(ok ? `${cfg.label} updated` : 'Couldn’t save — try again', !ok);
  };
  return (
    <div className="vs-f full">
      <p className="vs-fk">{cfg.label}{cfg.info && <Info text={cfg.info} />}{cfg.drv && <span className="drv">→ {cfg.drv}</span>}</p>
      <div className="vs-pills">
        {(cfg.opts || []).map((o) => (
          <button key={o} type="button" className={`vs-pill${sel.has(o) ? ' on' : ''}`} disabled={!canEdit} onClick={() => toggle(o)}>{o}</button>
        ))}
      </div>
    </div>
  );
}

/* ── the deck ── */
export default function VesselProfileStack(props) {
  const {
    rail, navCollapsed,
    vesselData, formState, canEdit, departmentOptions, saveField,
    logoInputRef, onLogoChange, uploadingLogo, logoUploadError, onRemoveLogo,
    heroInputRef, onHeroChange, uploadingHero, heroUploadError, onRevertHero,
    saveError,
  } = props;

  const [openCards, setOpenCards] = useState({ reg: true });
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const fireToast = (msg, bad) => {
    setToast({ msg, bad });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  };

  // Completion dropdown, opened from the % badge on the avatar ring.
  const [popOpen, setPopOpen] = useState(false);
  const popRef = useRef(null);
  useEffect(() => {
    if (!popOpen) return undefined;
    const h = (e) => { if (popRef.current && !popRef.current.contains(e.target)) setPopOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [popOpen]);

  const dayStart = String(formState?.operational_day_start_hour ?? 6).padStart(2, '0');
  const cards = useMemo(() => ([
    {
      id: 'reg', title: 'Registration & identity', sub: 'Flag, port & numbers — shown on the crew list',
      icon: ico(<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>),
      fields: [
        { field: 'vessel_type_label', label: 'Vessel type', type: 'select', opts: opt(VTYPE), req: true },
        { field: 'flag', label: 'Flag state', type: 'flag', opts: FLAG_STATES.map((f) => ({ value: f.name, label: f.name })), req: true },
        { field: 'port_of_registry', label: 'Port of registry', type: 'text', req: true, placeholder: 'Add port' },
        { field: 'imo_number', label: 'IMO number', type: 'code', copy: true, validate: 'imo', drives: 'Crew list', placeholder: 'Add IMO' },
        { field: 'official_number', label: 'Official number', type: 'code', copy: true, placeholder: 'Add number' },
        { field: 'call_sign', label: 'Call sign', type: 'text', placeholder: 'Add call sign', drives: 'Crew list' },
        { field: 'class_notation', label: 'Class / notation', type: 'text', placeholder: 'Add notation', full: true },
      ],
    },
    {
      id: 'dim', title: 'Dimensions & machinery', sub: 'Naval particulars for sea-service testimonials',
      icon: ico(<path d="M3 7h18M3 12h18M3 17h18M7 3v18" />),
      fields: [
        { field: 'loa_m', label: 'Length overall', type: 'num', unit: 'm', req: true, placeholder: 'Add LOA' },
        { field: 'gt', label: 'Gross tonnage', type: 'num', unit: 'GT', req: true, placeholder: 'Add GT' },
        { field: 'propulsion_kw', label: 'Propulsion power', type: 'num', unit: 'kW', drives: 'Testimonials', placeholder: 'Add power' },
        { field: 'main_engine_type', label: 'Main engine', type: 'text', drives: 'Testimonials', placeholder: 'Add engine type' },
        { field: 'year_built', label: 'Year built', type: 'num', placeholder: 'Add year' },
        { field: 'year_refit', label: 'Year refit', type: 'num', placeholder: 'Add year' },
      ],
    },
    {
      id: 'own', title: 'Owning entity', sub: 'The employer as it prints on crew contracts',
      icon: ico(<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5" />),
      fields: [
        { field: 'company_name', label: 'Company / owner', type: 'text', drives: 'Contracts', full: true, placeholder: 'Add company' },
        { field: 'company_address', label: 'Registered address', type: 'textarea', full: true, placeholder: 'Add address' },
        { field: 'company_email', label: 'Company email', type: 'text', placeholder: 'Add email' },
        { field: 'company_phone', label: 'Company phone', type: 'text', placeholder: 'Add phone' },
        { field: 'company_postcode', label: 'Post code', type: 'text', placeholder: 'Add post code' },
        { field: 'company_country', label: 'Country', type: 'select', opts: opt(COUNTRIES), placeholder: 'Select country' },
      ],
    },
    {
      id: 'invoicing', title: 'Invoicing', sub: 'How suppliers bill this vessel — pulled onto their invoices',
      icon: ico(<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2 2-1-1.6V3zM9 8h6M9 12h6M9 16h4" />),
      fields: [
        { field: 'billing_legal_name', label: 'Billed-to name', type: 'text', full: true, placeholder: 'Owning / management company' },
        { field: 'billing_address', label: 'Billing address', type: 'textarea', full: true, placeholder: 'Add address' },
        { field: 'billing_vat_number', label: 'VAT / tax number', type: 'text', opt: true, placeholder: 'Add number' },
        { field: 'billing_reg_number', label: 'Company reg', type: 'text', opt: true, placeholder: 'Add reg number' },
        { field: 'billing_email', label: 'Invoice email', type: 'text', full: true, placeholder: 'Where invoices are sent' },
      ],
    },
    {
      id: 'ops', title: 'Operational profile', sub: 'Where she trades and who she carries',
      icon: ico(<><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20" /></>),
      fields: [
        { field: 'commercial_status', label: 'Commercial status', type: 'select', opts: opt(CSTAT), placeholder: 'Set status' },
        { field: 'area_of_operation', label: 'Area of operation', type: 'select', opts: opt(AREA), placeholder: 'Set area' },
        { field: 'seasonal_pattern', label: 'Seasonal pattern', type: 'text', placeholder: 'e.g. Summer Med, Winter Caribbean' },
        { field: 'typical_guest_count', label: 'Typical guests', type: 'num', placeholder: 'Add count' },
        { field: 'typical_crew_count', label: 'Typical crew', type: 'num', placeholder: 'Add count' },
        { field: 'operating_regions', label: 'Operating regions', type: 'tags', opts: REGIONS, full: true, info: 'The cruising grounds this vessel operates in.' },
        { field: 'departments_in_use', label: 'Departments in use', type: 'pills', full: true, info: 'The crew departments this vessel runs. Drives rota grouping, crew structure and provisioning across Cargo.' },
      ],
    },
    {
      id: 'hor', title: 'Rest & rota rulebook', sub: 'How MLC hours of rest are measured & signed off',
      icon: ico(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
      fields: [
        { field: 'operational_day_start_hour', label: 'Rota day start', type: 'select', opts: Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, '0')}:00` })), info: 'The hour your operational day begins. The rota grid starts here, and — when HOR day basis is Operational — each 24-hour rest period is measured from this time.' },
        { field: 'hor_day_basis', label: 'HOR day basis', type: 'select', opts: [{ value: 'calendar', label: 'Calendar day (00:00–24:00)' }, { value: 'operational', label: `Operational day (from ${dayStart}:00)` }], info: 'How each 24-hour window for the 10h-rest rule is measured. Calendar = midnight to midnight. Operational = a 24-hour day from your rota start, which avoids false breaches when an overnight rest is split by midnight.' },
        { field: 'hor_confirmation_mode', label: 'Rest confirmation', type: 'select', opts: [{ value: 'require', label: 'Require approval' }, { value: 'trust', label: 'Trust crew (auto-confirm)' }], info: 'What happens when crew submit their month of hours. Require approval = an approver signs it off before it’s confirmed. Trust crew = confirmed automatically on submit.' },
        { field: 'hor_approver_tier', label: 'Approver role', type: 'select', opts: [{ value: 'COMMAND', label: 'Command only' }, { value: 'CHIEF', label: 'Chief & above' }, { value: 'HOD', label: 'HOD & above' }], disabled: formState?.hor_confirmation_mode === 'trust', info: 'The lowest rank that can approve HOR months and sign off breaches. Equal or higher ranks always can too.' },
        { field: 'hor_management_company_name', label: 'Management company', type: 'text', drives: 'Month-end pack', placeholder: 'Add company', info: 'The management company / shore office (DPA) that receives the signed Hours-of-Rest pack at month-end. The name is used in the email greeting.' },
        { field: 'hor_management_company_email', label: 'Pack sent to', type: 'text', placeholder: 'Add email', info: 'Recipient address for the end-of-month signed Hours-of-Rest export.' },
      ],
    },
    {
      id: 'defect', title: 'Defects & repairs', sub: 'Who signs off repair-quote spend',
      icon: ico(<path d="M14.7 6.3a4 4 0 01-5.6 5.6L4 17l3 3 5.1-5.1a4 4 0 005.6-5.6l-2.5 2.5-2.4-.6-.6-2.4 2.5-2.5z" />),
      fields: [
        { field: 'defect_quote_approver_tier', label: 'Repair quote sign-off', type: 'select', opts: [{ value: 'COMMAND', label: 'Command only' }, { value: 'CHIEF', label: 'Chief & above' }, { value: 'HOD', label: 'HOD & above' }], info: 'The lowest rank that can sign off a repair quote’s spend — equal or higher ranks always can too. HOD & above lets Heads of Department, Chiefs and Command approve.' },
        { field: 'defect_quote_signoff_threshold', label: 'Sign-off threshold', type: 'num', placeholder: 'e.g. 1000', info: 'A repair quote at or above this amount automatically requires sign-off before the repair can be scheduled. Crew can also request sign-off manually for any quote.' },
      ],
    },
    {
      id: 'comp', title: 'Compliance', sub: 'Certification & the safety / security regime', cosmetic: true,
      icon: ico(<><path d="M12 3l7 4v5c0 4.5-3 8.5-7 9-4-.5-7-4.5-7-9V7z" /><path d="M9 12l2 2 4-4" /></>),
      toggles: [
        { field: 'certified_commercial', label: 'Certified commercial', d: 'Holds a valid commercial / charter certificate', info: 'The vessel holds a valid commercial certificate (e.g. MCA LY3 / REG Yacht Code). Required to operate charters.' },
        { field: 'ism_applicable', label: 'ISM Code', d: 'Applicable to this vessel', info: 'International Safety Management Code applies — the vessel runs a documented Safety Management System.' },
        { field: 'isps_applicable', label: 'ISPS Code', d: 'Applicable to this vessel', info: 'International Ship & Port Facility Security Code applies — sets the vessel’s security regime.' },
      ],
    },
  ]), [dayStart, formState?.hor_confirmation_mode]);

  /* completeness over the data fields only */
  const dataFields = useMemo(() => cards.flatMap((c) => (c.fields || []).filter((f) => isData(f.type))), [cards]);
  const filled = dataFields.filter((f) => { const v = formState?.[f.field]; return v !== '' && v != null; }).length;
  const total = dataFields.length;
  const missing = dataFields.filter((f) => { const v = formState?.[f.field]; return v === '' || v == null; });
  const reqMissing = missing.filter((f) => f.req).length;
  const pct = total ? Math.round((filled / total) * 100) : 100;
  const complete = missing.length === 0;
  const RING_C = 2 * Math.PI * 52;
  const ringOffset = RING_C * (1 - filled / (total || 1));

  const [focusField, setFocusField] = useState(null);
  const toggleCard = (id) => setOpenCards((o) => ({ ...o, [id]: !o[id] }));

  const jumpTo = (field) => {
    setPopOpen(false);
    const card = cards.find((c) => (c.fields || []).some((f) => f.field === field));
    if (card) setOpenCards((o) => ({ ...o, [card.id]: true }));
    setTimeout(() => {
      const el = document.getElementById(`vs-f-${field}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // gentle, slow field-level highlight (not a quick card-border flash)
        el.classList.add('vs-jumpflash');
        setTimeout(() => el.classList.remove('vs-jumpflash'), 2000);
      }
      // drop the cursor into the field once the smooth scroll has settled
      setTimeout(() => setFocusField(field), 380);
    }, 200);
  };

  const name = vesselData?.name || 'Your vessel';
  const flag = formState?.flag;
  const vType = formState?.vessel_type_label;
  const active = vesselData?.onboarding_status === 'READY';

  return (
    <div className="vstack">
      {/* hero — avatar completion ring + editorial headline (mirrors the crew profile) */}
      <div className="vs-hero">
        <div className="vs-avatar-col" ref={popRef}>
          <div className="vs-avatar-ring">
            <svg className="vs-avatar-ring-svg" viewBox="0 0 112 112" aria-hidden="true">
              <circle className="track" cx="56" cy="56" r="52" />
              <circle className={`fill${complete ? ' is-complete' : ''}`} cx="56" cy="56" r="52" transform="rotate(-90 56 56)" strokeDasharray={RING_C} strokeDashoffset={ringOffset} />
            </svg>
            <button type="button" className="vs-avatar-photo" onClick={() => canEdit && logoInputRef?.current?.click()} disabled={!canEdit} title={canEdit ? 'Change vessel logo' : name}>
              {formState?.logo_url ? (
                <img src={formState.logo_url} alt={`${name} logo`} />
              ) : (
                <svg className="vs-ymk" viewBox="0 0 62 22" fill="currentColor" aria-hidden="true"><path d="M2 15 L40 15 C48 15 53 13 60 9 L52 8 L40 8 L40 5 C40 4 39 4 38 4 L27 4 C26 4 25 4 25 5 L24 8 L12 8 L12 6 L7 6 L7 8 L2 8 Z" /></svg>
              )}
              {canEdit && <span className="vs-up">{uploadingLogo ? <span className="vs-spin" /> : <Camera size={18} />}</span>}
            </button>
            <input ref={logoInputRef} type="file" accept="image/png,image/jpeg" onChange={onLogoChange} style={{ display: 'none' }} />
            {complete ? (
              <span className="vs-avatar-pct is-complete" title="Record complete">✓</span>
            ) : (
              <button type="button" className={`vs-avatar-pct vs-avatar-pct-btn${popOpen ? ' is-open' : ''}`} onClick={() => setPopOpen((v) => !v)} aria-expanded={popOpen} title={`${pct}% complete — ${missing.length} to finish`}>{pct}%</button>
            )}
          </div>
          {canEdit && <p className="vs-avatar-cap">Click to upload logo</p>}

          {popOpen && !complete && missing.length > 0 && (
            <div className="vs-completion-pop">
              <div className="head"><span className="pct">{pct}% complete</span><span className="rem">{missing.length} to finish</span></div>
              <ul>
                {missing.map((m) => (
                  <li key={m.field}>
                    <button type="button" onClick={() => jumpTo(m.field)}>
                      <span className="dot" /><span className="lbl">{m.label}</span><span className="go">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="vs-hero-title">
          <div className="editorial-meta">
            <span className="dot">•</span>
            {flag && <span>{flagEmoji(flag) && `${flagEmoji(flag)} `}{flag}</span>}
            {flag && formState?.commercial_status && <span className="bar" />}
            {formState?.commercial_status && <span className="muted">{formState.commercial_status}</span>}
            {formState?.year_built && <><span className="bar" /><span className="muted">Since {formState.year_built}</span></>}
          </div>
          <h1 className="editorial-greeting vs-greeting">
            {vType ? <>{name}<span className="period">,</span>{' '}<em>{vType}</em><span className="period">.</span></> : <>{name}<span className="period">.</span></>}
          </h1>
          <div className="vs-status-row">
            <span className={`vs-status-pill${active ? '' : ' setup'}`}><span className="d" />{active ? 'Active' : 'Setup in progress'}</span>
          </div>
        </div>
      </div>

      {!canEdit && (
        <div className="vs-banner"><AlertCircle size={18} /><div><b>View-only</b> — only Command can edit the vessel record.</div></div>
      )}
      {saveError && (
        <div className="vs-banner err"><AlertCircle size={18} /><div><b>Something went wrong</b> — {saveError}</div></div>
      )}

      {/* rail + deck grid (hero above spans full width, like the crew profile) */}
      <div className={`vs-grid${navCollapsed ? ' collapsed' : ''}`}>
        {rail}
        <div className="vs-deck">
        {cards.map((c) => {
          const miss = (c.fields || []).filter((f) => isData(f.type) && (formState?.[f.field] === '' || formState?.[f.field] == null)).length;
          const isOpen = !!openCards[c.id];
          return (
            <div key={c.id} className={`vs-card${isOpen ? ' open' : ''}`}>
              <button type="button" className="vs-ch" onClick={() => toggleCard(c.id)} aria-expanded={isOpen}>
                <span className="ic">{c.icon}</span>
                <span className="tt"><h3>{c.title}</h3><span className="sub">{c.sub}</span></span>
                {!c.cosmetic && (miss ? <span className="vs-badge warn">{miss} to add</span> : <span className="vs-badge ok">Complete</span>)}
                <span className="vs-chev"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg></span>
              </button>
              <div className="vs-body"><div className="vs-inner">
                <div className="vs-prov">Vessel record</div>
                <div className="vs-fields">
                  {(c.fields || []).map((f) => (
                    f.type === 'pills'
                      ? <DeptPills key={f.field} cfg={f} value={formState?.departments_in_use} options={departmentOptions} canEdit={canEdit} onSave={saveField} toast={fireToast} />
                      : f.type === 'tags'
                        ? <TagPills key={f.field} cfg={f} value={formState?.[f.field]} canEdit={canEdit} onSave={saveField} toast={fireToast} />
                        : <FieldRow key={f.field} cfg={f} value={formState?.[f.field]} canEdit={canEdit} onSave={saveField} toast={fireToast} focusField={focusField} onFocused={() => setFocusField(null)} />
                  ))}
                  {(c.toggles || []).map((t) => (
                    <ToggleRow key={t.field} cfg={t} value={formState?.[t.field]} canEdit={canEdit} onSave={saveField} toast={fireToast} />
                  ))}
                </div>
              </div></div>
            </div>
          );
        })}

        {/* appearance card (custom body) */}
        <div className={`vs-card${openCards.look ? ' open' : ''}`}>
          <button type="button" className="vs-ch" onClick={() => toggleCard('look')} aria-expanded={!!openCards.look}>
            <span className="ic">{ico(<><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 16l5-4 3 2 4-4 4 3" /><circle cx="9" cy="9.5" r="1.3" /></>)}</span>
            <span className="tt"><h3>Appearance &amp; tools</h3><span className="sub">Cosmetic — safe to change any time</span></span>
            <span className="vs-chev"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg></span>
          </button>
          <div className="vs-body"><div className="vs-inner">
            <div className="vs-appear">
              <p className="lab">Dashboard hero</p>
              <div className="vs-frame">
                <img src={(formState?.use_custom_hero && formState?.hero_image_url) ? formState.hero_image_url : '/assets/images/yacht_blueprint-1770460015354.png'} alt="Dashboard hero" onError={(e) => { e.target.style.display = 'none'; }} />
              </div>
              {canEdit && (
                <div className="btns">
                  <input ref={heroInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={onHeroChange} style={{ display: 'none' }} />
                  <button type="button" className="vs-btn" onClick={() => heroInputRef?.current?.click()} disabled={uploadingHero}><Upload size={14} style={{ marginRight: 6, verticalAlign: -2 }} />{uploadingHero ? 'Uploading…' : 'Upload image'}</button>
                  {formState?.use_custom_hero && <button type="button" className="vs-btn" onClick={onRevertHero}>Revert to blueprint</button>}
                </div>
              )}
              {heroUploadError && <div className="vs-err">{heroUploadError}</div>}
              {logoUploadError && <div className="vs-err">{logoUploadError}</div>}
              <div style={{ marginTop: 16 }}>
                <ToggleRow cfg={{ field: 'feedback_widget_enabled', label: 'Feedback tab', d: 'Crew can send a note straight to the Cargo team' }} value={formState?.feedback_widget_enabled !== false} canEdit={canEdit} onSave={saveField} toast={fireToast} />
              </div>
            </div>
          </div></div>
        </div>
        </div>
      </div>

      {toast && (
        <div className={`vs-toast show${toast.bad ? ' bad' : ''}`}>
          <span className="tk">{toast.bad ? <AlertCircle size={12} /> : <Check size={12} strokeWidth={3} />}</span>{toast.msg}
        </div>
      )}
    </div>
  );
}
