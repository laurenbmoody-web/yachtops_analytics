import React, { useState, useEffect } from "react";
import {
  Ship,
  Users,
  Building2,
  Check,
  ChevronRight,
  ChevronLeft,
  Plus,
  Trash2,
  MapPin,
  FolderTree,
  Upload,
  LayoutDashboard,
  ClipboardList,
  Utensils,
  Shirt,
  UserCircle,
  Bug,
  Calendar,
  Package,
  ArrowRight,
  Sparkles,
  X,
  Anchor,
  Plane,
  Shield,
  Heart,
  Briefcase,
} from "lucide-react";

// ---- Cargo brand tokens (mirrored from src/styles/tailwind.css) ----
const NAVY = "#1E3A5F";
const NAVY_DARK = "#141D2E";
const ACCENT = "#00A8CC";
const MARITIME_BG = "#F8FAFC";
const CHARCOAL = "#1A202C";
const CARD = "#FFFFFF";

// Shared font stacks — Outfit for headings, Plus Jakarta Sans body, Archivo for pill labels.
// Mockup injects Google Fonts on mount so the look matches cargotechnology.netlify.app.
const HEADING_FONT = "'Outfit', system-ui, sans-serif";
const BODY_FONT = "'Plus Jakarta Sans', system-ui, sans-serif";
const PILL_FONT = "'Archivo', system-ui, sans-serif";

// ---- Real Cargo data (pulled from vessel-settings/index.jsx + authStorage.js) ----
const VESSEL_TYPES = ["Motor Yacht", "Sailing Yacht", "Catamaran", "Explorer", "Sport Yacht", "Superyacht"];
const COMMERCIAL_STATUSES = ["Private", "Commercial", "Charter", "Dual"];
const AREAS_OF_OPERATION = ["Coastal", "Near Coastal", "Unlimited"];

// Base departments — in production these load from the Supabase `departments` table
// (tenant-wide). Any "Other" department a user adds at onboarding is NOT written to
// that table — it's kept local to the user so their bespoke label doesn't leak across
// the tenant.
const DEPARTMENTS = [
  { id: "BRIDGE", name: "Bridge", icon: Anchor },
  { id: "INTERIOR", name: "Interior", icon: Users },
  { id: "DECK", name: "Deck", icon: Ship },
  { id: "ENGINEERING", name: "Engineering", icon: Building2 },
  { id: "GALLEY", name: "Galley", icon: Utensils },
  { id: "SPA", name: "Spa", icon: Heart },
  { id: "SECURITY", name: "Security", icon: Shield },
  { id: "AVIATION", name: "Aviation", icon: Plane },
  { id: "SHORE_MANAGEMENT", name: "Shore / Management", icon: Briefcase },
];

// Roles keyed by department — mirrors how InviteCrewModal cascades from department -> roles.
const ROLES_BY_DEPT = {
  BRIDGE: ["Captain", "Chief Officer", "2nd Officer", "3rd Officer"],
  INTERIOR: ["Chief Stew", "2nd Stew", "3rd Stew", "Stewardess", "Junior Stew"],
  DECK: ["Bosun", "Lead Deckhand", "Deckhand", "Junior Deckhand"],
  ENGINEERING: ["Chief Engineer", "2nd Engineer", "3rd Engineer", "ETO", "Motorman"],
  GALLEY: ["Head Chef", "Sous Chef", "Crew Chef", "Galley Assistant"],
  SPA: ["Masseuse", "Beautician", "Yoga Instructor", "Nurse"],
  SECURITY: ["Head of Security", "Security Officer"],
  AVIATION: ["Pilot", "Co-Pilot", "Heli Engineer"],
  SHORE_MANAGEMENT: ["Owner", "Management Company", "DPA", "Accountant"],
};

const CARGO_FEATURES = [
  { name: "Provisioning", icon: Package, blurb: "Orders, receipts, suppliers, delivery tracking." },
  { name: "Trips", icon: Calendar, blurb: "Itineraries, guest allocations, preferences." },
  { name: "Guests", icon: UserCircle, blurb: "Preference profiles, allergies, special requests." },
  { name: "Laundry", icon: Shirt, blurb: "Rotations, schedules, history." },
  { name: "Crew", icon: Users, blurb: "Roster, roles, rotations, HoR / sea time." },
  { name: "Defects", icon: Bug, blurb: "Report, assign, track to resolution." },
  { name: "Team Jobs", icon: ClipboardList, blurb: "Department boards, tasks, approvals." },
  { name: "Dashboard", icon: LayoutDashboard, blurb: "Widgets, today view, at-a-glance ops." },
];

// ---- Atoms styled to the Cargo marketing aesthetic ----
const PillPrimary = ({ onClick, disabled, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`inline-flex items-center justify-center gap-2 px-6 py-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${disabled ? "" : "cg-breath"}`}
    style={{
      backgroundColor: disabled ? NAVY : NAVY,
      color: "white",
      borderRadius: 50,
      fontFamily: PILL_FONT,
      fontWeight: 900,
      fontSize: 11,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    }}
    onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.backgroundColor = NAVY_DARK; }}
    onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.backgroundColor = NAVY; }}
  >
    {children}
  </button>
);

const PillSecondary = ({ onClick, children }) => (
  <button
    onClick={onClick}
    className="inline-flex items-center justify-center gap-2 px-6 py-3 transition-colors"
    style={{
      backgroundColor: "transparent",
      color: NAVY,
      border: `2px solid ${NAVY}`,
      borderRadius: 50,
      fontFamily: PILL_FONT,
      fontWeight: 700,
      fontSize: 11,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.backgroundColor = NAVY;
      e.currentTarget.style.color = "white";
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.backgroundColor = "transparent";
      e.currentTarget.style.color = NAVY;
    }}
  >
    {children}
  </button>
);

const LinkButton = ({ onClick, children }) => (
  <button
    onClick={onClick}
    className="inline-flex items-center gap-1.5 text-sm"
    style={{ color: NAVY, fontFamily: BODY_FONT }}
  >
    {children}
  </button>
);

const SectionHeading = ({ children }) => (
  <h2
    className="mb-4"
    style={{
      fontFamily: PILL_FONT,
      fontSize: 11,
      fontWeight: 900,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: NAVY,
    }}
  >
    {children}
  </h2>
);

const Card = ({ children, className = "" }) => (
  <div
    className={`rounded-2xl p-6 ${className}`}
    style={{
      backgroundColor: CARD,
      borderTop: `1px solid ${NAVY}`,
      borderLeft: `1px solid ${NAVY}`,
      borderRight: `1px solid ${NAVY}`,
      borderBottom: `3px solid ${NAVY}`,
    }}
  >
    {children}
  </div>
);

const Field = ({ label, required, hint, tooltip, children }) => (
  <div>
    <label
      className="flex items-center text-sm mb-1.5"
      style={{ color: CHARCOAL, fontFamily: BODY_FONT, fontWeight: 600 }}
    >
      <span>
        {label}
        {required && <span style={{ color: "#DC2626" }}> *</span>}
      </span>
      {tooltip && <Tooltip text={tooltip} />}
    </label>
    {children}
    {hint && (
      <p className="text-xs mt-1" style={{ color: "#64748B", fontFamily: BODY_FONT }}>
        {hint}
      </p>
    )}
  </div>
);

const inputBase = {
  fontFamily: BODY_FONT,
  color: CHARCOAL,
  backgroundColor: "white",
  border: "1px solid #CBD5E1",
  borderRadius: 10,
  padding: "9px 12px",
  fontSize: 14,
  width: "100%",
  outline: "none",
};

const TextInput = (props) => <input {...props} style={{ ...inputBase, ...(props.style || {}) }} />;

// Tiny hover tooltip with a '?' trigger. Plain CSS hover + focus so it works on keyboard.
const Tooltip = ({ text }) => (
  <span className="relative inline-flex items-center group" tabIndex={0}>
    <span
      className="ml-1.5 w-4 h-4 rounded-full inline-flex items-center justify-center text-[10px] cursor-help"
      style={{ backgroundColor: "#E2E8F0", color: "#475569", fontFamily: BODY_FONT, fontWeight: 700 }}
    >
      ?
    </span>
    <span
      className="pointer-events-none absolute left-6 top-0 z-20 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150"
      style={{
        backgroundColor: NAVY,
        color: "white",
        fontFamily: BODY_FONT,
        fontSize: 11,
        lineHeight: 1.4,
        padding: "6px 10px",
        borderRadius: 6,
        width: 220,
        boxShadow: "0 6px 20px rgba(30,58,95,0.25)",
      }}
    >
      {text}
    </span>
  </span>
);
const SelectInput = (props) => (
  <select {...props} style={{ ...inputBase, appearance: "auto", ...(props.style || {}) }} />
);
const Checkbox = ({ checked, onChange, label }) => (
  <label className="inline-flex items-center gap-2 cursor-pointer" style={{ fontFamily: BODY_FONT }}>
    <input type="checkbox" checked={checked} onChange={onChange} className="w-4 h-4 rounded" style={{ accentColor: NAVY }} />
    <span className="text-sm" style={{ color: CHARCOAL }}>{label}</span>
  </label>
);

// ---- Step indicator ----
const StepDot = ({ idx, label, active, done }) => (
  <div className="flex items-center gap-2.5">
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold"
      style={{
        backgroundColor: done ? ACCENT : active ? NAVY : "#E2E8F0",
        color: done || active ? "white" : "#64748B",
        fontFamily: PILL_FONT,
      }}
    >
      {done ? <Check size={14} /> : idx}
    </div>
    <span
      className="text-sm"
      style={{
        color: active ? CHARCOAL : "#64748B",
        fontFamily: BODY_FONT,
        fontWeight: active ? 600 : 500,
      }}
    >
      {label}
    </span>
  </div>
);

const StepHeader = ({ step }) => (
  <div className="py-8 border-b" style={{ backgroundColor: "white", borderColor: "#E2E8F0" }}>
    <div className="max-w-3xl mx-auto px-6 flex items-center gap-2 mb-6">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center"
        style={{ backgroundColor: NAVY }}
      >
        <Anchor size={14} color="white" />
      </div>
      <span
        style={{
          fontFamily: HEADING_FONT,
          fontSize: 18,
          fontWeight: 700,
          color: NAVY,
          letterSpacing: "-0.01em",
        }}
      >
        Cargo
      </span>
    </div>
    <div className="flex items-center justify-center gap-5 md:gap-8 flex-wrap px-6">
      <StepDot idx={1} label="Vessel settings" active={step === 1} done={step > 1} />
      <div className="h-px w-8 md:w-14" style={{ backgroundColor: "#E2E8F0" }} />
      <StepDot idx={2} label="Departments" active={step === 2} done={step > 2} />
      <div className="h-px w-8 md:w-14" style={{ backgroundColor: "#E2E8F0" }} />
      <StepDot idx={3} label="Invite crew" active={step === 3} done={step > 3} />
    </div>
  </div>
);

// ---- Step 1: Vessel Settings (mirrors real /settings/vessel page) ----
// Progressive disclosure across THREE sub-sections: Identity → Specs → Operational Profile.
// Each collapses to a summary row as the user confirms it — feels like rapid momentum instead
// of one giant form.
const VesselSettingsStep = ({ data, onChange, onNext }) => {
  const [section, setSection] = useState("identity"); // 'identity' | 'specs' | 'profile'
  const set = (k, v) => onChange({ ...data, [k]: v });

  const identityDone = section !== "identity";
  const specsDone = section === "profile";

  // Personal greeting — pulls vessel name if it came back from the pre-checkout Equasis lookup.
  const heroTitle = data.vessel_name ? `Welcome aboard ${data.vessel_name}` : "Welcome aboard";

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 cg-step-enter">
      <div className="flex items-start gap-4 mb-2">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: NAVY }}>
          <Ship size={20} color="white" />
        </div>
        <div>
          <h1 style={{ fontFamily: HEADING_FONT, fontSize: 28, fontWeight: 700, color: CHARCOAL, letterSpacing: "-0.02em" }}>
            {heroTitle}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "#64748B", fontFamily: BODY_FONT }}>
            Three quick sections. Everything here is editable later in Vessel Settings.
          </p>
        </div>
      </div>

      {/* ── Section 1: Identity ── */}
      {section === "identity" ? (
        <div className="mt-8 cg-anim-enter">
          <Card>
            <SectionHeading>Who is your boat?</SectionHeading>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Vessel name" required tooltip="Used across Cargo and on crew-facing screens.">
                <TextInput value={data.vessel_name} placeholder="M/Y Belongers" onChange={(e) => set("vessel_name", e.target.value)} />
              </Field>
              <Field label="Vessel Type" required tooltip="Drives which default compliance modules show (sail vs motor vs commercial).">
                <SelectInput value={data.vessel_type_label} onChange={(e) => set("vessel_type_label", e.target.value)}>
                  <option value="">Select type…</option>
                  {VESSEL_TYPES.map((t) => <option key={t}>{t}</option>)}
                </SelectInput>
              </Field>
              <Field label="Flag" required tooltip="Determines which flag-state rules apply — REG, MCA, Marshall, etc.">
                <TextInput value={data.flag} placeholder="e.g., Cayman Islands" onChange={(e) => set("flag", e.target.value)} />
              </Field>
              <Field label="Port of Registry" required tooltip="Shown on official documents. Usually matches the port stamped on your certificate of registry.">
                <TextInput value={data.port_of_registry} placeholder="e.g., George Town" onChange={(e) => set("port_of_registry", e.target.value)} />
              </Field>
            </div>
            <div className="flex items-center justify-end mt-6">
              <PillPrimary onClick={() => setSection("specs")}>Continue</PillPrimary>
            </div>
          </Card>
        </div>
      ) : (
        <CollapsedSection
          title="Who is your boat?"
          summary={`${data.vessel_name || "—"} · ${data.vessel_type_label || "—"} · ${data.flag || "—"}`}
          onEdit={() => setSection("identity")}
        />
      )}

      {/* ── Section 2: Specs ── */}
      {section === "specs" && (
        <div className="mt-6 cg-anim-enter">
          <Card>
            <SectionHeading>Her specs</SectionHeading>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="IMO Number" tooltip="Pre-filled from your vessel verification at checkout. Can be corrected here.">
                <TextInput value={data.imo_number} placeholder="IMO 1234567" onChange={(e) => set("imo_number", e.target.value)} />
              </Field>
              <Field label="Official Number" tooltip="The flag-state assigned number on your certificate of registry. Optional.">
                <TextInput value={data.official_number} placeholder="e.g., 123456" onChange={(e) => set("official_number", e.target.value)} />
              </Field>
              <Field label="LOA (meters)" required tooltip="Length overall. Drives MLC watchkeeping ratios and berth planning.">
                <TextInput type="number" value={data.loa_m} placeholder="e.g., 50.5" onChange={(e) => set("loa_m", e.target.value)} />
              </Field>
              <Field label="Gross Tonnage (GT)" required tooltip="Used to determine tier of certification required for officers and engineers.">
                <TextInput type="number" value={data.gt} placeholder="e.g., 500" onChange={(e) => set("gt", e.target.value)} />
              </Field>
              <Field label="Year Built">
                <TextInput type="number" value={data.year_built} placeholder="e.g., 2015" onChange={(e) => set("year_built", e.target.value)} />
              </Field>
              <Field label="Year Refit">
                <TextInput type="number" value={data.year_refit} placeholder="e.g., 2020" onChange={(e) => set("year_refit", e.target.value)} />
              </Field>
            </div>
            <div className="flex items-center justify-between mt-6">
              <LinkButton onClick={() => setSection("identity")}>
                <ChevronLeft size={14} /> Back
              </LinkButton>
              <PillPrimary onClick={() => setSection("profile")}>Continue</PillPrimary>
            </div>
          </Card>
        </div>
      )}
      {specsDone && (
        <CollapsedSection
          title="Her specs"
          summary={`${data.loa_m ? `LOA ${data.loa_m}m` : "—"} · ${data.gt ? `GT ${data.gt}` : "—"} · ${data.year_built || "—"}`}
          onEdit={() => setSection("specs")}
        />
      )}

      {/* ── Section 3: Operational Profile ── */}
      {section === "profile" && (
        <div className="mt-6 cg-anim-enter">
          <Card>
            <SectionHeading>How does she operate?</SectionHeading>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Commercial Status" tooltip="Private, Commercial, Charter, or Dual use. Changes which compliance workflows are active.">
                <SelectInput value={data.commercial_status} onChange={(e) => set("commercial_status", e.target.value)}>
                  <option value="">Select…</option>
                  {COMMERCIAL_STATUSES.map((s) => <option key={s}>{s}</option>)}
                </SelectInput>
              </Field>
              <div className="flex items-center pt-6">
                <Checkbox
                  checked={!!data.certified_commercial}
                  onChange={(e) => set("certified_commercial", e.target.checked)}
                  label="Certified Commercial"
                />
              </div>
              <Field label="Area of Operation" tooltip="Coastal / Near Coastal / Unlimited — matches what's on your Safe Manning document.">
                <SelectInput value={data.area_of_operation} onChange={(e) => set("area_of_operation", e.target.value)}>
                  <option value="">Select…</option>
                  {AREAS_OF_OPERATION.map((a) => <option key={a}>{a}</option>)}
                </SelectInput>
              </Field>
              <Field label="Operating Regions">
                <TextInput value={data.operating_regions} placeholder="e.g., Mediterranean, Caribbean" onChange={(e) => set("operating_regions", e.target.value)} />
              </Field>
              <Field label="Seasonal Pattern">
                <TextInput value={data.seasonal_pattern} placeholder="e.g., Summer Med, Winter Caribbean" onChange={(e) => set("seasonal_pattern", e.target.value)} />
              </Field>
              <Field label="Typical Guest Count">
                <TextInput type="number" value={data.typical_guest_count} placeholder="e.g., 12" onChange={(e) => set("typical_guest_count", e.target.value)} />
              </Field>
              <Field label="Typical Crew Count">
                <TextInput type="number" value={data.typical_crew_count} placeholder="e.g., 15" onChange={(e) => set("typical_crew_count", e.target.value)} />
              </Field>
            </div>
            <p className="text-xs mt-4" style={{ color: "#64748B", fontFamily: BODY_FONT }}>
              Compliance fields (ISM, ISPS, MLC) and vessel hero image can be filled in later from Vessel Settings.
            </p>
            <div className="flex items-center justify-between mt-6">
              <LinkButton onClick={() => setSection("specs")}>
                <ChevronLeft size={14} /> Back
              </LinkButton>
              <PillPrimary onClick={onNext}>Continue</PillPrimary>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

// Collapsed summary row — reused across the three section splits in step 1.
const CollapsedSection = ({ title, summary, onEdit }) => (
  <div className="mt-6 cg-anim-enter">
    <button
      type="button"
      onClick={onEdit}
      className="w-full flex items-center justify-between rounded-xl px-5 py-4 text-left cg-hover-lift"
      style={{
        backgroundColor: CARD,
        borderTop: `1px solid ${NAVY}`,
        borderLeft: `1px solid ${NAVY}`,
        borderRight: `1px solid ${NAVY}`,
        borderBottom: `3px solid ${NAVY}`,
        fontFamily: BODY_FONT,
      }}
    >
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-full flex items-center justify-center cg-tick-pop" style={{ backgroundColor: ACCENT }}>
          <Check size={15} color="white" strokeWidth={3} />
        </div>
        <div>
          <div style={{ fontFamily: HEADING_FONT, fontWeight: 700, fontSize: 15, color: CHARCOAL }}>{title}</div>
          <div className="text-xs" style={{ color: "#64748B" }}>{summary}</div>
        </div>
      </div>
      <span className="text-xs uppercase" style={{ fontFamily: PILL_FONT, color: NAVY, letterSpacing: "0.08em", fontWeight: 900 }}>
        Edit
      </span>
    </button>
  </div>
);

// ---- Step 2: Departments ----
// Base departments come from Supabase (tenant-wide). "Other" additions are local to
// this user only — never written to the shared departments table.
const DepartmentsStep = ({ selected, onChange, customDepts, onAddCustom, onRemoveCustom, vesselName, onNext, onBack }) => {
  const merged = [...DEPARTMENTS, ...customDepts];
  const toggle = (id) =>
    selected.includes(id) ? onChange(selected.filter((x) => x !== id)) : onChange([...selected, id]);

  const [draft, setDraft] = useState("");
  const submitDraft = () => {
    const name = draft.trim();
    if (!name) return;
    onAddCustom(name);
    setDraft("");
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 cg-step-enter">
      <div className="flex items-start gap-4 mb-2">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: NAVY }}>
          <Building2 size={20} color="white" />
        </div>
        <div>
          <h1 style={{ fontFamily: HEADING_FONT, fontSize: 28, fontWeight: 700, color: CHARCOAL, letterSpacing: "-0.02em" }}>
            {vesselName ? `Which departments run on ${vesselName}?` : "Which departments are onboard?"}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "#64748B", fontFamily: BODY_FONT }}>
            Pick the ones your vessel runs — Cargo tailors visibility and boards to match.
          </p>
        </div>
      </div>

      <Card className="mt-8">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 cg-stagger">
          {merged.map((d, i) => {
            const DIcon = d.icon || Briefcase;
            const isOn = selected.includes(d.id);
            const isCustom = !!d.custom;
            return (
              <button
                key={d.id}
                onClick={() => toggle(d.id)}
                className="relative rounded-xl p-4 text-left transition-all cg-anim-enter cg-hover-lift"
                style={{
                  "--i": i,
                  backgroundColor: isOn ? NAVY : "white",
                  border: `1px solid ${isOn ? NAVY : "#E2E8F0"}`,
                  color: isOn ? "white" : CHARCOAL,
                }}
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                  style={{
                    backgroundColor: isOn ? "rgba(255,255,255,0.12)" : "#F1F5F9",
                    color: isOn ? "white" : NAVY,
                  }}
                >
                  <DIcon size={18} />
                </div>
                <div className="text-sm" style={{ fontFamily: BODY_FONT, fontWeight: 600 }}>
                  {d.name}
                </div>
                {isCustom && (
                  <div
                    className="inline-block mt-1 text-[10px] uppercase px-1.5 py-0.5 rounded"
                    style={{
                      fontFamily: PILL_FONT,
                      letterSpacing: "0.06em",
                      fontWeight: 700,
                      color: isOn ? "white" : "#64748B",
                      backgroundColor: isOn ? "rgba(255,255,255,0.14)" : "#F1F5F9",
                    }}
                  >
                    Custom · only you
                  </div>
                )}
                {isOn && (
                  <div
                    key={`tick-${d.id}`}
                    className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center cg-tick-pop"
                    style={{ backgroundColor: ACCENT }}
                  >
                    <Check size={12} color="white" />
                  </div>
                )}
                {isCustom && (
                  <span
                    onClick={(e) => { e.stopPropagation(); onRemoveCustom(d.id); }}
                    role="button"
                    aria-label="Remove custom department"
                    className="absolute bottom-2 right-2 p-1 rounded"
                    style={{ color: isOn ? "rgba(255,255,255,0.7)" : "#94A3B8" }}
                  >
                    <Trash2 size={12} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Add custom department — stays local to this user, not persisted to the tenant's departments table */}
        <div className="mt-5 pt-5" style={{ borderTop: "1px solid #E2E8F0" }}>
          <div className="flex items-center gap-2">
            <TextInput
              value={draft}
              placeholder="Add a department (e.g., Dive, Toys, Wellness)"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitDraft(); } }}
            />
            <PillSecondary onClick={submitDraft}>
              <Plus size={14} /> Add
            </PillSecondary>
          </div>
        </div>

        <p className="text-xs mt-4" style={{ color: "#64748B", fontFamily: BODY_FONT }}>
          {selected.length} selected. Add or remove departments later in Role Management.
        </p>
      </Card>

      <div className="flex items-center justify-between mt-8">
        <LinkButton onClick={onBack}>
          <ChevronLeft size={14} /> Back
        </LinkButton>
        <PillPrimary onClick={onNext}>
          Continue
        </PillPrimary>
      </div>
    </div>
  );
};

// ---- Step 3: Invite Crew (cascading Department -> Role, mirrors InviteCrewModal) ----
const InviteCrewStep = ({ invites, onChange, onFinish, onBack, allowedDepartments, customDepts, vesselName }) => {
  const merged = [...DEPARTMENTS, ...customDepts];
  const deptById = (id) => merged.find((d) => d.id === id);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteMsg, setPasteMsg] = useState("");

  // Parse pasted rows: "email, department, role". Matches department by fuzzy name
  // against both base DEPARTMENTS and the user's customDepts.
  const parsePaste = () => {
    const lines = pasteText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const lookup = (raw) => {
      if (!raw) return "";
      const n = norm(raw);
      const match = merged.find((d) => norm(d.name) === n || norm(d.id) === n);
      return match ? match.id : "";
    };
    const rows = lines.map((line) => {
      const parts = line.split(/[,\t]/).map((p) => p.trim());
      const [email = "", deptRaw = "", role = ""] = parts;
      return { email, department_id: lookup(deptRaw), role };
    }).filter((r) => r.email);
    if (rows.length === 0) {
      setPasteMsg("No valid rows found. Expected format: email, department, role");
      return;
    }
    // Replace placeholder empty row if present, otherwise append.
    const hasOnlyEmpty = invites.length === 1 && !invites[0].email && !invites[0].department_id && !invites[0].role;
    onChange(hasOnlyEmpty ? rows : [...invites, ...rows]);
    setPasteMsg(`Added ${rows.length} row${rows.length === 1 ? "" : "s"}.`);
    setPasteText("");
  };
  const addRow = () => onChange([...invites, { email: "", department_id: "", role: "" }]);
  const removeRow = (idx) => onChange(invites.filter((_, i) => i !== idx));
  const update = (idx, patch) => onChange(invites.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const anyValid = invites.some((r) => r.email.trim() && r.department_id && r.role);

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 cg-step-enter">
      <div className="flex items-start gap-4 mb-2">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: NAVY }}>
          <Users size={20} color="white" />
        </div>
        <div>
          <h1 style={{ fontFamily: HEADING_FONT, fontSize: 28, fontWeight: 700, color: CHARCOAL, letterSpacing: "-0.02em" }}>
            {vesselName ? `Bring your crew aboard ${vesselName}` : "Invite your crew"}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "#64748B", fontFamily: BODY_FONT }}>
            Poke around solo first, or invite a few key people now — you can always do this later from Crew Management.
          </p>
        </div>
      </div>

      {/* Paste-from-spreadsheet — chief stews live in spreadsheets. */}
      <div className="mt-6">
        <button
          onClick={() => setPasteOpen((v) => !v)}
          className="inline-flex items-center gap-2 text-sm"
          style={{ color: NAVY, fontFamily: BODY_FONT, fontWeight: 600 }}
        >
          <ClipboardList size={14} /> {pasteOpen ? "Hide paste from spreadsheet" : "Paste from spreadsheet"}
        </button>
        {pasteOpen && (
          <div className="mt-3 cg-anim-enter">
            <Card>
              <p className="text-xs mb-2" style={{ color: "#64748B", fontFamily: BODY_FONT }}>
                One invite per line. Columns: <strong>email, department, role</strong> (comma or tab-separated). Department is matched against your selections — custom departments work too.
              </p>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={4}
                placeholder={"captain@vessel.com, Bridge, Captain\nchef@vessel.com, Galley, Head Chef\ncrew@vessel.com, Dive, Divemaster"}
                style={{
                  ...inputBase,
                  height: "auto",
                  padding: "10px 14px",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 12,
                }}
              />
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs" style={{ color: pasteMsg.startsWith("Added") ? "#047857" : "#64748B", fontFamily: BODY_FONT }}>
                  {pasteMsg}
                </span>
                <PillSecondary onClick={parsePaste}>
                  <Plus size={14} /> Add rows
                </PillSecondary>
              </div>
            </Card>
          </div>
        )}
      </div>

      <Card className="mt-8">
        <div className="space-y-4">
          {invites.map((row, idx) => {
            const dept = deptById(row.department_id);
            const isCustomDept = !!dept?.custom;
            const deptRoles = row.department_id && !isCustomDept ? ROLES_BY_DEPT[row.department_id] || [] : [];
            return (
              <div key={idx} className="grid grid-cols-12 gap-3 items-start">
                <div className="col-span-12 md:col-span-5">
                  <TextInput
                    value={row.email}
                    placeholder="crew@example.com"
                    onChange={(e) => update(idx, { email: e.target.value })}
                  />
                </div>
                <div className="col-span-6 md:col-span-3">
                  <SelectInput
                    value={row.department_id}
                    onChange={(e) => update(idx, { department_id: e.target.value, role: "" })}
                  >
                    <option value="">Department…</option>
                    {allowedDepartments.map((id) => {
                      const d = deptById(id);
                      return d ? <option key={id} value={id}>{d.name}{d.custom ? " (custom)" : ""}</option> : null;
                    })}
                  </SelectInput>
                </div>
                <div className="col-span-5 md:col-span-3">
                  {isCustomDept ? (
                    <TextInput
                      value={row.role}
                      placeholder="Role (type any)"
                      onChange={(e) => update(idx, { role: e.target.value })}
                    />
                  ) : (
                    <SelectInput
                      value={row.role}
                      onChange={(e) => update(idx, { role: e.target.value })}
                      disabled={!row.department_id}
                    >
                      <option value="">Role…</option>
                      {deptRoles.map((r) => <option key={r}>{r}</option>)}
                    </SelectInput>
                  )}
                </div>
                <div className="col-span-1 flex justify-end pt-2">
                  {invites.length > 1 && (
                    <button
                      onClick={() => removeRow(idx)}
                      className="p-2 rounded-lg"
                      style={{ color: "#94A3B8" }}
                      aria-label="Remove row"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <button
            onClick={addRow}
            className="inline-flex items-center gap-2 text-sm mt-1"
            style={{ color: NAVY, fontFamily: BODY_FONT, fontWeight: 600 }}
          >
            <Plus size={14} /> Add another
          </button>
        </div>
        <p className="text-xs mt-4" style={{ color: "#64748B", fontFamily: BODY_FONT }}>
          Permission tier auto-populates from the selected role.
        </p>
      </Card>

      <div className="flex items-center justify-between mt-8">
        <LinkButton onClick={onBack}>
          <ChevronLeft size={14} /> Back
        </LinkButton>
        <div className="flex items-center gap-3">
          <PillSecondary onClick={onFinish}>Send invites</PillSecondary>
          <PillPrimary onClick={onFinish}>
            Do this later → Go to dashboard
          </PillPrimary>
        </div>
      </div>
      <p className="text-xs mt-3 text-right" style={{ color: "#94A3B8", fontFamily: BODY_FONT }}>
        Most captains start solo and invite crew once they've had a look around.
      </p>
    </div>
  );
};

// ---- Dashboard with progress tutorial ----
const TUTORIAL_ITEMS = [
  {
    id: "locations",
    title: "Set up vessel locations",
    desc: "Map out your vessel — decks, cabins, storage rooms, lockers, whatever you need. Nest locations as deep as makes sense for your boat. Everything in inventory sits under a location.",
    icon: MapPin,
    cta: "Open Locations",
  },
  {
    id: "folders",
    title: "Build your inventory folders",
    desc: "Organise inventory into folders that mirror how your crew actually works — by department, by usage, or by physical zone.",
    icon: FolderTree,
    cta: "Open Inventory",
  },
  {
    id: "upload",
    title: "Upload your first inventory file",
    desc: "Got a spreadsheet from the last handover? Drop it in and Cargo will parse, de-dup, and auto-assign items into your folders.",
    icon: Upload,
    cta: "Import items",
  },
];

// Count up the percent number smoothly alongside the chain drop.
const LivePercent = ({ percent }) => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const from = count;
    const duration = 1400;
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setCount(Math.round(from + (percent - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [percent]);
  return <>{count}</>;
};

// Anchor + chain. Cleat at the top, chain pays out, anchor drops to the % position
// and sways like an anchor trailing. Reanimates whenever percent changes.
const AnchorChainProgress = ({ percent }) => {
  const height = 180;
  const [dropped, setDropped] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDropped(percent), 120);
    return () => clearTimeout(t);
  }, [percent]);

  const anchorTop = Math.max(0, Math.min(100, dropped)) / 100 * (height - 40);

  return (
      <div className="relative" style={{ width: 48, height }}>
        {/* Cleat — small navy block the chain pays out of */}
        <div
          className="absolute left-1/2 -translate-x-1/2 top-0 rounded-[3px]"
          style={{ width: 22, height: 10, backgroundColor: NAVY }}
        />
        {/* Active chain — whole number of 10px links ending at the anchor's ring */}
        {(() => {
          const linkCount = Math.max(0, Math.floor(anchorTop / 10));
          const chainH = linkCount * 10;
          return (
            <svg
              className="absolute left-1/2 -translate-x-1/2"
              style={{
                top: 10,
                width: 14,
                height: chainH,
                transition: "height 1400ms cubic-bezier(.34,1.2,.64,1)",
              }}
              viewBox={`0 0 14 ${Math.max(chainH, 1)}`}
              preserveAspectRatio="none"
            >
              {Array.from({ length: linkCount }).map((_, i) => (
                <ellipse
                  key={i}
                  cx="7"
                  cy={i * 10 + 5}
                  rx="4"
                  ry="5"
                  fill="none"
                  stroke={NAVY}
                  strokeWidth="1.6"
                />
              ))}
            </svg>
          );
        })()}
        {/* Anchor — sits so its ring hooks the last chain link */}
        <div
          className="absolute left-1/2 -translate-x-1/2 cg-anchor-sway flex items-start justify-center"
          style={{
            top: Math.max(0, Math.floor(anchorTop / 10) * 10) + 4,
            width: 40,
            height: 40,
            transition: "top 1400ms cubic-bezier(.34,1.2,.64,1)",
            transformOrigin: "top center",
          }}
        >
          <Anchor size={32} color={NAVY} strokeWidth={2.25} />
        </div>
      </div>
  );
};

const ProgressBar = ({ percent, onHero = false }) => {
  // Animate bar width 0 → percent, and count the number up alongside it.
  const [rendered, setRendered] = useState(0);
  const [count, setCount] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setRendered(percent), 80);
    // Count-up over ~900ms
    const start = performance.now();
    const from = count;
    const duration = 900;
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setCount(Math.round(from + (percent - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { clearTimeout(t); cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [percent]);
  const labelColor = onHero ? "rgba(255,255,255,0.85)" : NAVY;
  const numberColor = onHero ? "white" : CHARCOAL;
  const trackColor = onHero ? "rgba(255,255,255,0.18)" : "#E2E8F0";
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span
          style={{
            fontFamily: PILL_FONT,
            fontSize: 10,
            fontWeight: 900,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: labelColor,
          }}
        >
          Onboarding progress
        </span>
        <span style={{ fontFamily: HEADING_FONT, fontSize: 22, fontWeight: 700, color: numberColor }}>
          {count}%
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: trackColor }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${rendered}%`,
            background: onHero
              ? "linear-gradient(90deg, #FDD79B 0%, #F8C15F 50%, #00A8CC 100%)"
              : ACCENT,
            transition: "width 1100ms cubic-bezier(.2,.7,.2,1)",
          }}
        />
      </div>
    </div>
  );
};

const TutorialCard = ({ item, done, onStart }) => {
  const ItemIcon = item.icon;
  return (
    <div
      className="relative rounded-2xl p-5 transition-all"
      style={{
        backgroundColor: done ? "#ECFDF5" : "white",
        border: `1px solid ${done ? "#A7F3D0" : "#E2E8F0"}`,
      }}
    >
      <div className="flex items-start gap-4">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: done ? "#10B981" : NAVY }}
        >
          {done ? <Check size={20} color="white" /> : <ItemIcon size={20} color="white" />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 style={{ fontFamily: HEADING_FONT, fontSize: 16, fontWeight: 700, color: CHARCOAL }}>
            {item.title}
          </h3>
          <p className="text-sm mt-1" style={{ color: "#64748B", fontFamily: BODY_FONT, lineHeight: 1.5 }}>
            {item.desc}
          </p>
          {!done && (
            <div className="mt-3">
              <PillSecondary onClick={onStart}>
                {item.cta} <ArrowRight size={12} />
              </PillSecondary>
            </div>
          )}
          {done && (
            <p
              className="mt-3 inline-flex items-center gap-1.5 text-xs"
              style={{ color: "#047857", fontFamily: PILL_FONT, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}
            >
              <Check size={12} /> Done
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

const FeatureTile = ({ feature }) => {
  const FIcon = feature.icon;
  return (
    <div
      className="rounded-xl p-4 transition-colors"
      style={{ backgroundColor: "white", border: "1px solid #E2E8F0" }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
        style={{ backgroundColor: "#F1F5F9", color: NAVY }}
      >
        <FIcon size={18} />
      </div>
      <h4 style={{ fontFamily: HEADING_FONT, fontSize: 14, fontWeight: 700, color: CHARCOAL }}>
        {feature.name}
      </h4>
      <p className="text-xs mt-1" style={{ color: "#64748B", fontFamily: BODY_FONT, lineHeight: 1.5 }}>
        {feature.blurb}
      </p>
    </div>
  );
};

const WelcomeToast = ({ onDismiss }) => (
  <div
    className="fixed top-4 right-4 max-w-sm rounded-xl p-4 flex items-start gap-3 z-50 cg-toast-in"
    style={{ backgroundColor: NAVY, color: "white", boxShadow: "0 10px 40px rgba(30,58,95,0.35)" }}
  >
    <Sparkles size={18} color="#FDE68A" className="flex-shrink-0 mt-0.5" />
    <div className="flex-1 text-sm" style={{ fontFamily: BODY_FONT }}>
      <p style={{ fontFamily: HEADING_FONT, fontSize: 15, fontWeight: 700, marginBottom: 2 }}>
        You're all set.
      </p>
      <p style={{ color: "#CBD5E1" }}>Here's a quick tour. Finish these three to get the most out of Cargo.</p>
    </div>
    <button onClick={onDismiss} style={{ color: "#94A3B8" }}>
      <X size={16} />
    </button>
  </div>
);

const DashboardView = ({ vesselName, onReset }) => {
  const [done, setDone] = useState({});
  const [showToast, setShowToast] = useState(true);
  const completed = Object.values(done).filter(Boolean).length;
  const percent = Math.round(((3 + completed) / 6) * 100);

  return (
    <div className="min-h-screen" style={{ backgroundColor: MARITIME_BG, fontFamily: BODY_FONT }}>
      {showToast && <WelcomeToast onDismiss={() => setShowToast(false)} />}

      {/* Fake app header — matches signed-in Cargo layout */}
      <div className="border-b" style={{ backgroundColor: "white", borderColor: "#E2E8F0" }}>
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ backgroundColor: NAVY }}
            >
              <Anchor size={14} color="white" />
            </div>
            <span style={{ fontFamily: HEADING_FONT, fontSize: 15, fontWeight: 700, color: NAVY }}>
              Cargo — {vesselName || "M/Y Belongers"}
            </span>
          </div>
          <button
            onClick={onReset}
            className="text-xs underline underline-offset-2"
            style={{ color: "#64748B", fontFamily: BODY_FONT }}
          >
            restart mockup
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10 space-y-10">
        {/* Hero — standard Cargo card: 1px sides, thicker navy bottom border for that
            slight 3D raised look. Anchor-and-chain progress indicator on the right. */}
        <div
          className="rounded-2xl px-8 py-8 flex gap-6 items-start"
          style={{
            backgroundColor: CARD,
            borderTop: `1px solid ${NAVY}`,
            borderLeft: `1px solid ${NAVY}`,
            borderRight: `1px solid ${NAVY}`,
            borderBottom: `4px solid ${NAVY}`,
          }}
        >
          {/* Chain column — cleat sits at the top, level with the heading. Anchor
              drops down into the card space as the user progresses. */}
          <div className="flex-shrink-0">
            <AnchorChainProgress percent={percent} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 style={{ fontFamily: HEADING_FONT, fontSize: 26, fontWeight: 700, color: CHARCOAL, letterSpacing: "-0.02em" }}>
              {vesselName ? `Welcome aboard ${vesselName}` : "Welcome, Captain"}
            </h1>
            <div className="mt-4 flex items-baseline gap-3">
              <span
                className="uppercase"
                style={{
                  fontFamily: PILL_FONT,
                  fontSize: 22,
                  fontWeight: 900,
                  letterSpacing: "0.10em",
                  color: NAVY,
                }}
              >
                Onboarding
              </span>
              <span style={{ fontFamily: HEADING_FONT, fontSize: 22, fontWeight: 700, color: CHARCOAL }}>
                <LivePercent percent={percent} />%
              </span>
            </div>
            <p className="text-xs mt-1" style={{ color: "#64748B", fontFamily: BODY_FONT }}>
              {percent === 100 ? "Fully anchored." : "Only a few more shackles to go…"}
            </p>
          </div>
        </div>

        <div>
          <SectionHeading>Finish setting up</SectionHeading>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 cg-stagger">
            {TUTORIAL_ITEMS.map((item, i) => (
              <div key={item.id} className="cg-anim-enter" style={{ "--i": i + 1 }}>
                <TutorialCard
                  item={item}
                  done={!!done[item.id]}
                  onStart={() => setDone({ ...done, [item.id]: true })}
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <SectionHeading>What else is in Cargo</SectionHeading>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 cg-stagger">
            {CARGO_FEATURES.map((f, i) => (
              <div key={f.name} className="cg-anim-enter" style={{ "--i": i + 4 }}>
                <FeatureTile feature={f} />
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-center pt-6" style={{ color: "#94A3B8", fontFamily: BODY_FONT }}>
          Everything above is a mockup — no real data has been saved.
        </p>
      </div>
    </div>
  );
};

// ---- Top-level controller ----
export default function OnboardingMockup() {
  // Load Cargo marketing fonts on mount so the mockup matches cargotechnology.netlify.app
  useEffect(() => {
    const id = "cargo-fonts";
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href =
        "https://fonts.googleapis.com/css2?family=Archivo:wght@700;900&family=Outfit:wght@400;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap";
      document.head.appendChild(link);
    }
    const styleId = "cargo-onboarding-anim";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        @keyframes cgFadeSlideUp { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes cgTickPop { 0% { transform: scale(0); opacity: 0; } 55% { transform: scale(1.35); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes cgToastIn { 0% { opacity: 0; transform: translateY(28px) scale(.96); } 65% { opacity: 1; transform: translateY(-5px) scale(1.02); } 100% { transform: translateY(0) scale(1); } }
        @keyframes cgStepIn { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        /* Breathing glow — slow pulse around the primary CTA. */
        @keyframes cgBreath { 0%,100% { box-shadow: 0 0 0 0 rgba(0,168,204,0.35); } 50% { box-shadow: 0 0 0 10px rgba(0,168,204,0); } }
        .cg-anim-enter { animation: cgFadeSlideUp 520ms cubic-bezier(.2,.7,.2,1) both; }
        .cg-step-enter { animation: cgStepIn 420ms cubic-bezier(.2,.7,.2,1) both; }
        .cg-tick-pop { animation: cgTickPop 420ms cubic-bezier(.34,1.56,.64,1) both; }
        .cg-toast-in { animation: cgToastIn 640ms cubic-bezier(.34,1.56,.64,1) both; }
        .cg-breath { animation: cgBreath 2400ms ease-in-out infinite; }
        .cg-hover-lift { transition: transform 200ms ease, box-shadow 200ms ease; }
        .cg-hover-lift:hover { transform: translateY(-3px); box-shadow: 0 10px 28px rgba(30,58,95,0.12); }
        /* Stagger helpers: apply delay via index */
        .cg-stagger > * { animation-delay: calc(var(--i, 0) * 70ms); }
        /* Anchor sway while dropping — easing damped sine wave, then settles */
        @keyframes cgSway {
          0% { transform: rotate(-10deg); }
          20% { transform: rotate(8deg); }
          40% { transform: rotate(-5deg); }
          60% { transform: rotate(3deg); }
          80% { transform: rotate(-1deg); }
          100% { transform: rotate(0deg); }
        }
        .cg-anchor-sway { animation: cgSway 1600ms ease-out both; }
      `;
      document.head.appendChild(style);
    }
  }, []);

  const [step, setStep] = useState(1);
  const [vessel, setVessel] = useState({
    vessel_name: "",
    vessel_type_label: "",
    flag: "",
    port_of_registry: "",
    imo_number: "",
    official_number: "",
    loa_m: "",
    gt: "",
    year_built: "",
    year_refit: "",
    commercial_status: "",
    certified_commercial: false,
    area_of_operation: "",
    operating_regions: "",
    seasonal_pattern: "",
    typical_guest_count: "",
    typical_crew_count: "",
  });
  const [departments, setDepartments] = useState(["BRIDGE", "INTERIOR", "DECK", "ENGINEERING", "GALLEY"]);
  // Custom departments — stay local to this user, NOT persisted to Supabase departments table
  const [customDepts, setCustomDepts] = useState([]);
  const addCustomDept = (name) => {
    const id = `CUSTOM_${Date.now()}`;
    setCustomDepts((prev) => [...prev, { id, name, custom: true }]);
    setDepartments((prev) => [...prev, id]);
  };
  const removeCustomDept = (id) => {
    setCustomDepts((prev) => prev.filter((d) => d.id !== id));
    setDepartments((prev) => prev.filter((x) => x !== id));
  };
  const [invites, setInvites] = useState([{ email: "", department_id: "", role: "" }]);

  const reset = () => {
    setStep(1);
    setVessel({
      vessel_name: "", vessel_type_label: "", flag: "", port_of_registry: "",
      imo_number: "", official_number: "", loa_m: "", gt: "",
      year_built: "", year_refit: "", commercial_status: "", certified_commercial: false,
      area_of_operation: "", operating_regions: "", seasonal_pattern: "",
      typical_guest_count: "", typical_crew_count: "",
    });
    setDepartments(["BRIDGE", "INTERIOR", "DECK", "ENGINEERING", "GALLEY"]);
    setCustomDepts([]);
    setInvites([{ email: "", department_id: "", role: "" }]);
  };

  if (step === 4) return <DashboardView vesselName={vessel.vessel_name} onReset={reset} />;

  return (
    <div className="min-h-screen" style={{ backgroundColor: MARITIME_BG, fontFamily: BODY_FONT }}>
      <StepHeader step={step} />
      {step === 1 && (
        <VesselSettingsStep data={vessel} onChange={setVessel} onNext={() => setStep(2)} />
      )}
      {step === 2 && (
        <DepartmentsStep
          selected={departments}
          onChange={setDepartments}
          customDepts={customDepts}
          onAddCustom={addCustomDept}
          onRemoveCustom={removeCustomDept}
          vesselName={vessel.vessel_name}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      )}
      {step === 3 && (
        <InviteCrewStep
          invites={invites}
          onChange={setInvites}
          allowedDepartments={departments}
          customDepts={customDepts}
          vesselName={vessel.vessel_name}
          onBack={() => setStep(2)}
          onFinish={() => setStep(4)}
        />
      )}
    </div>
  );
}
