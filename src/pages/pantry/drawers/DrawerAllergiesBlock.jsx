import React from 'react';

// Splits a comma-separated string into trimmed pill values. Empty strings
// filtered out so "Shellfish, , Peanuts" doesn't render a ghost pill.
function splitPills(text) {
  if (!text) return [];
  return text.split(',').map(s => s.trim()).filter(Boolean);
}

// Top-of-drawer Allergies & Medical block. Hidden entirely when the guest
// has neither allergies nor health conditions — we deliberately do NOT
// render a "no allergies" placeholder per the drawer spec.
//
// Data source: guests.allergies and guests.health_conditions (structured
// columns maintained by src/utils/preferencesSync.js). Each comma-separated
// value becomes its own pill — never collapse "Shellfish, Peanuts" into an
// aggregate "nut allergy" label.
export default function DrawerAllergiesBlock({ allergies, healthConditions }) {
  const allergyPills = Array.isArray(allergies) ? allergies : splitPills(allergies);
  const healthPills  = Array.isArray(healthConditions) ? healthConditions : splitPills(healthConditions);

  if (allergyPills.length === 0 && healthPills.length === 0) return null;

  return (
    <div className="p-drawer-allergies" role="group" aria-label="Allergies and medical conditions">
      <div className="p-drawer-allergies-heading">Allergies &amp; Medical</div>
      <div className="p-drawer-allergies-pills">
        {allergyPills.map((pill, i) => (
          <span key={`a-${i}`} className="p-drawer-pill-allergy" aria-label={`Allergy: ${pill}`}>
            {pill}
          </span>
        ))}
        {healthPills.map((pill, i) => (
          <span key={`h-${i}`} className="p-drawer-pill-health" aria-label={`Health condition: ${pill}`}>
            {pill}
          </span>
        ))}
      </div>
    </div>
  );
}
