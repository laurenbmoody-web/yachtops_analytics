import React, { useState, useRef, useCallback, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { loadTrips } from '../../trips-management-dashboard/utils/tripStorage';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EXPORT_MEAL_ORDER = ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Late Night'];

const formatDate = (dateStr) => {
  if (!dateStr) return null;
  try {
    return new Date(dateStr)?.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
  } catch {
    return dateStr;
  }
};

const capitalize = (str) => str ? str?.charAt(0)?.toUpperCase() + str?.slice(1) : '';

const naturalText = (val) => {
  if (!val) return '';
  return val?.replace(/_/g, ' ')?.replace(/-/g, ' ')?.replace(/\b\w/g, c => c?.toUpperCase())?.trim();
};

const parseDiningServiceStyleExport = (value) => {
  if (!value) return null;
  // Use greedy match so the LAST parenthetical is always the meal context
  // e.g. "American (Plated) (Dinner)" → meal: "Dinner", style: "American (Plated)"
  const parenMatch = value?.match(/^(.+)\s*\(([^)]+)\)$/);
  if (parenMatch) {
    return { meal: naturalText(parenMatch?.[2]?.trim()), style: naturalText(parenMatch?.[1]?.trim()) };
  }
  const dashMatch = value?.match(/^(.+?)\s*[\u2014\-]{1,2}\s*(.+)$/);
  if (dashMatch) {
    return { meal: naturalText(dashMatch?.[1]?.trim()), style: naturalText(dashMatch?.[2]?.trim()) };
  }
  const bulletMatch = value?.match(/^(.+?)\s*[\u2022]\s*(.+)$/);
  if (bulletMatch) {
    return { meal: naturalText(bulletMatch?.[1]?.trim()), style: naturalText(bulletMatch?.[2]?.trim()) };
  }
  return null;
};

const groupByTag = (prefs, tagGroups) => {
  const result = {};
  tagGroups?.forEach(({ label, tags }) => {
    const matched = prefs?.filter(p =>
      p?.tags?.some(t => tags?.includes(t?.toLowerCase()))
    );
    if (matched?.length > 0) result[label] = matched;
  });
  const allMatchedIds = new Set(Object.values(result).flat().map(p => p.id));
  const remaining = prefs?.filter(p => !allMatchedIds?.has(p?.id));
  if (remaining?.length > 0) result['Other'] = remaining;
  return result;
};

// ─── Report Sub-components (all white/light, no dark theme) ──────────────────

const SubSection = ({ title, prefs, showConfidence, includeImages }) => {
  if (!prefs || prefs?.length === 0) return null;
  return (
    <div style={{ marginBottom: '12px' }}>
      <p style={{
        fontSize: '11px', fontWeight: '700', color: '#64748b',
        textTransform: 'uppercase', letterSpacing: '0.5px',
        margin: '0 0 4px 0', paddingLeft: '10px'
      }}>{title}</p>
      <div style={{ border: '1px solid #e2e8f0', borderRadius: '4px', overflow: 'hidden', background: '#ffffff' }}>
        {prefs?.map((p, i) => <PrefRow key={p?.id || i} pref={p} showConfidence={showConfidence} includeImages={includeImages} />)}
      </div>
    </div>
  );
};

const AvoidsSubHeader = () => (
  <p style={{
    fontSize: '11px', fontWeight: '700', color: '#dc2626',
    textTransform: 'uppercase', letterSpacing: '0.5px',
    margin: '0 0 4px 0', paddingLeft: '10px'
  }}>⚠ Avoids</p>
);

const InlineAvoids = ({ avoids, includeImages }) => {
  if (!avoids || avoids?.length === 0) return null;
  return (
    <div style={{ marginTop: '8px' }}>
      <AvoidsSubHeader />
      <div style={{ border: '1px solid #fecaca', borderRadius: '4px', overflow: 'hidden', background: '#fff8f8' }}>
        {avoids?.map((p, i) => <PrefRow key={p?.id || i} pref={p} showConfidence={false} includeImages={includeImages} />)}
      </div>
    </div>
  );
};

const ReportHeader = ({ guest, reportTitle }) => {
  const fullName = `${guest?.firstName || ''} ${guest?.lastName || ''}`?.trim();
  const initials = `${guest?.firstName?.[0] || ''}${guest?.lastName?.[0] || ''}`?.toUpperCase() || '?';
  const photoUrl = guest?.photo?.dataUrl || guest?.photo || guest?.photoUrl || guest?.avatarUrl || guest?.photo_url || guest?.avatar_url || guest?.profilePhoto || guest?.profile_photo;
  return (
    <div style={{ marginBottom: '16px', paddingBottom: '12px', borderBottom: '2px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '14px' }}>
      {/* Avatar */}
      <div style={{ flexShrink: 0 }}>
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={fullName || 'Guest'}
            style={{ width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #e2e8f0' }}
          />
        ) : (
          <div style={{
            width: '56px', height: '56px', borderRadius: '50%',
            background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '20px', fontWeight: '700', color: '#64748b', border: '2px solid #e2e8f0'
          }}>
            {initials}
          </div>
        )}
      </div>
      {/* Text */}
      <div>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 3px 0', lineHeight: '1.2' }}>
          {fullName || 'Guest'}
        </h1>
        <p style={{ fontSize: '15px', color: '#64748b', margin: '0', fontWeight: '500' }}>{reportTitle}</p>
      </div>
    </div>
  );
};

const SectionHeader = ({ title }) => (
  <div style={{ marginTop: '16px', marginBottom: '8px' }}>
    <h2 style={{
      fontSize: '14px',
      fontWeight: '700',
      color: '#0f172a',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      margin: '0',
      display: 'flex',
      alignItems: 'center',
      gap: '6px'
    }}>
      {title}
    </h2>
  </div>
);

const PrefRow = ({ pref, showConfidence, includeImages }) => (
  <div style={{
    padding: '6px 10px',
    borderBottom: '1px solid #f1f5f9',
    display: 'flex', alignItems: 'flex-start', gap: '8px',
    background: '#ffffff'
  }}>
    {pref?.prefType === 'avoid' && (
      <span style={{ color: '#dc2626', fontWeight: '700', fontSize: '11px', flexShrink: 0, marginTop: '1px' }}>✕</span>
    )}
    <div style={{ flex: 1 }}>
      <span style={{ fontSize: '12px', fontWeight: '600', color: '#0f172a' }}>{naturalText(pref?.key)}</span>
      {pref?.value && (
        <span style={{ fontSize: '12px', color: '#475569', marginLeft: '6px' }}>{naturalText(pref?.value)}</span>
      )}
      {includeImages && pref?.preferenceImageUrl && (
        <div style={{ marginTop: '6px' }}>
          <img
            src={pref?.preferenceImageUrl}
            alt={naturalText(pref?.key) || 'Preference image'}
            style={{ maxWidth: '100%', maxHeight: '180px', borderRadius: '4px', border: '1px solid #e2e8f0', objectFit: 'contain', display: 'block' }}
          />
        </div>
      )}
    </div>
    {showConfidence && pref?.confidence && (
      <span style={{
        fontSize: '10px', fontWeight: '600', padding: '1px 6px', borderRadius: '10px',
        background: pref?.confidence === 'confirmed' ? '#dcfce7' : pref?.confidence === 'observed' ? '#dbeafe' : '#f1f5f9',
        color: pref?.confidence === 'confirmed' ? '#166534' : pref?.confidence === 'observed' ? '#1e40af' : '#475569',
        flexShrink: 0
      }}>
        {capitalize(pref?.confidence)}
      </span>
    )}
  </div>
);

const GroupedDiningServiceStyleBlock = ({ prefs, showConfidence }) => {
  if (!prefs || prefs?.length === 0) return null;
  const rows = prefs
    ?.map(pref => ({ pref, parsed: parseDiningServiceStyleExport(pref?.value) }))
    ?.filter(r => r?.parsed)
    ?.sort((a, b) => {
      const ai = EXPORT_MEAL_ORDER?.indexOf(a?.parsed?.meal);
      const bi = EXPORT_MEAL_ORDER?.indexOf(b?.parsed?.meal);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  const unparsed = prefs
    ?.map(pref => ({ pref, parsed: parseDiningServiceStyleExport(pref?.value) }))
    ?.filter(r => !r?.parsed);
  return (
    <div style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9', background: '#ffffff' }}>
      <div style={{ marginBottom: '4px' }}>
        <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Dining Service Style</span>
      </div>
      {rows?.map(({ pref, parsed }, idx) => (
        <div key={pref?.id || idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 0' }}>
          <span style={{ fontSize: '12px', color: '#0f172a' }}>
            <span style={{ fontWeight: '600' }}>{parsed?.meal}</span>
            <span style={{ color: '#94a3b8', margin: '0 6px' }}>&mdash;</span>
            <span>{parsed?.style}</span>
          </span>
          {showConfidence && pref?.confidence && (
            <span style={{
              fontSize: '10px', fontWeight: '600', padding: '1px 6px', borderRadius: '10px',
              background: pref?.confidence === 'confirmed' ? '#dcfce7' : pref?.confidence === 'observed' ? '#dbeafe' : '#f1f5f9',
              color: pref?.confidence === 'confirmed' ? '#166534' : pref?.confidence === 'observed' ? '#1e40af' : '#475569',
            }}>
              {capitalize(pref?.confidence)}
            </span>
          )}
        </div>
      ))}
      {unparsed?.map(({ pref }, idx) => (
        <div key={pref?.id || idx} style={{ fontSize: '12px', color: '#0f172a', padding: '2px 0' }}>
          {naturalText(pref?.value)}
        </div>
      ))}
    </div>
  );
};

// ─── FULL GUEST REPORT ────────────────────────────────────────────────────────
const FullGuestReport = ({ guest, preferences, includeImages, guestTrips = [] }) => {
  const byCategory = (cat) =>
    preferences?.filter(p => p?.category === cat && p?.prefType !== 'avoid');
  const avoidsByCategory = (cat) =>
    preferences?.filter(p => p?.category === cat && p?.prefType === 'avoid');

  const snapshotLines = [];
  if (guest?.charterStatus) {
    const csMap = {
      first_time: 'First time charter', first_charter: 'First time charter',
      repeat: 'Repeat charter guest', repeat_charter: 'Repeat charter guest',
      owner: 'Owner / Owner family', owner_family: 'Owner / Owner family',
    };
    const csKey = guest?.charterStatus?.toLowerCase()?.replace(/\s+/g, '_');
    snapshotLines?.push(csMap?.[csKey] || naturalText(guest?.charterStatus));
  }
  const servicePrefsAll = preferences?.filter(p => p?.category === 'Service' && p?.prefType !== 'avoid');
  const personalityPrefs = servicePrefsAll?.filter(p =>
    ['personality', 'guest type', 'guest style', 'character', 'temperament']?.some(k => p?.key?.toLowerCase()?.includes(k))
  );
  personalityPrefs?.forEach(p => { if (p?.value) snapshotLines?.push(naturalText(p?.value)); else if (p?.key) snapshotLines?.push(naturalText(p?.key)); });
  const crewFamiliarityPrefs = servicePrefsAll?.filter(p =>
    ['crew familiarity', 'crew interaction', 'crew relationship', 'familiarity with crew']?.some(k => p?.key?.toLowerCase()?.includes(k))
  );
  crewFamiliarityPrefs?.forEach(p => {
    snapshotLines?.push(p?.value ? `Crew familiarity: ${naturalText(p?.value)}` : `Crew familiarity: ${naturalText(p?.key)}`);
  });
  const serviceStylePrefs = servicePrefsAll?.filter(p =>
    ['crew presence', 'service level', 'service preference', 'attentiveness']?.some(k => p?.key?.toLowerCase()?.includes(k))
  );
  serviceStylePrefs?.forEach(p => {
    snapshotLines?.push(p?.value ? `Crew presence/service style: ${naturalText(p?.value)}` : naturalText(p?.key));
  });
  const diningServiceStylePrefs = servicePrefsAll?.filter(p =>
    p?.key?.toLowerCase() === 'dining service style' || p?.key?.toLowerCase()?.replace(/\s+/g, '_') === 'dining_service_style'
  );
  if (diningServiceStylePrefs?.length > 0) {
    const parsedMeals = diningServiceStylePrefs
      ?.map(p => parseDiningServiceStyleExport(p?.value))
      ?.filter(Boolean)
      ?.filter(r => r?.meal?.toLowerCase() !== 'brunch')
      ?.sort((a, b) => {
        const ai = EXPORT_MEAL_ORDER?.indexOf(a?.meal);
        const bi = EXPORT_MEAL_ORDER?.indexOf(b?.meal);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
    if (parsedMeals?.length > 0) {
      snapshotLines?.push(`Dining service style: ${parsedMeals?.map(r => `${r?.meal} \u2014 ${r?.style}`)?.join(', ')}`);
    }
  }
  const diningPacePrefs = servicePrefsAll?.filter(p =>
    ['dining pace', 'meal pace', 'eating pace']?.some(k => p?.key?.toLowerCase()?.includes(k))
  );
  diningPacePrefs?.forEach(p => {
    snapshotLines?.push(p?.value ? `Dining pace: ${naturalText(p?.value)}` : naturalText(p?.key));
  });
  const notesPrefsAll = preferences?.filter(p => p?.category === 'Other' && p?.prefType !== 'avoid');
  const guestTypePrefs = notesPrefsAll?.filter(p =>
    ['guest type', 'overall', 'summary', 'general', 'personality']?.some(k => p?.key?.toLowerCase()?.includes(k))
  );
  guestTypePrefs?.forEach(p => { if (p?.value) snapshotLines?.push(naturalText(p?.value)); });
  const uniqueSnapshotLines = [...new Set(snapshotLines)];

  const routinePrefs = byCategory('Routine');
  const routineAvoids = avoidsByCategory('Routine');
  const ROUTINE_ORDER = ['wake up time','morning routine','breakfast time','lunch time','dinner time','late night behaviour','nap habits','bed time'];
  const routineItems = routinePrefs?.slice()?.sort((a, b) => {
    const aIdx = ROUTINE_ORDER?.findIndex(k => a?.key?.toLowerCase()?.includes(k));
    const bIdx = ROUTINE_ORDER?.findIndex(k => b?.key?.toLowerCase()?.includes(k));
    return (aIdx === -1 ? ROUTINE_ORDER?.length : aIdx) - (bIdx === -1 ? ROUTINE_ORDER?.length : bIdx);
  });

  const servicePrefs = byCategory('Service');
  const serviceAvoids = avoidsByCategory('Service');
  const foodPrefs = byCategory('Food & Beverage');
  const foodAvoids = avoidsByCategory('Food & Beverage');
  const foodTagGroups = [
    { label: 'Coffee', tags: ['coffee'] }, { label: 'Tea', tags: ['tea'] },
    { label: 'Cocktails', tags: ['cocktail', 'cocktails'] }, { label: 'Wine', tags: ['wine'] },
    { label: 'Spirits', tags: ['spirit', 'spirits'] }, { label: 'Snacks', tags: ['snack', 'snacks'] },
    { label: 'Meals', tags: ['galley', 'meal', 'meals', 'breakfast', 'lunch', 'dinner'] },
    { label: 'Desserts', tags: ['dessert', 'desserts'] }, { label: 'Cuisine', tags: ['cuisine'] },
  ];
  const foodGrouped = groupByTag(foodPrefs, foodTagGroups);
  const cabinPrefs = byCategory('Cabin');
  const cabinAvoids = avoidsByCategory('Cabin');
  const activityPrefs = byCategory('Activities');
  const activityAvoids = avoidsByCategory('Activities');
  const notesPrefs = byCategory('Other');
  const notesAvoids = avoidsByCategory('Other');

  // guestTrips passed in as a prop now — loadTrips is async post-A3.1
  // and can't be called synchronously during render. The parent modal
  // hydrates this list once on open and passes it down.

  return (
    <div style={{ fontFamily: 'Georgia, serif', color: '#1a1a1a', lineHeight: '1.5', background: '#ffffff' }}>
      <ReportHeader guest={guest} reportTitle="Guest Preferences Report" />
      {uniqueSnapshotLines?.length > 0 && (
        <>
          <SectionHeader title="Guest Snapshot" />
          <div style={{ padding: '8px 10px', background: '#f8fafc', borderRadius: '4px', marginBottom: '4px', border: '1px solid #e2e8f0' }}>
            {uniqueSnapshotLines?.map((line, i) => (
              <p key={i} style={{ fontSize: '12px', color: '#374151', margin: '0 0 4px 0' }}>{line}</p>
            ))}
          </div>
        </>
      )}
      {(routineItems?.length > 0 || routineAvoids?.length > 0) && (
        <>
          <SectionHeader title="Routine" />
          {routineItems?.length > 0 && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '4px', overflow: 'hidden', marginBottom: '4px', background: '#ffffff' }}>
              {routineItems?.map((p, i) => <PrefRow key={p?.id || i} pref={p} showConfidence={false} includeImages={includeImages} />)}
            </div>
          )}
          <InlineAvoids avoids={routineAvoids} includeImages={includeImages} />
        </>
      )}
      {(servicePrefs?.length > 0 || serviceAvoids?.length > 0) && (
        <>
          <SectionHeader title="Service Information" />
          {servicePrefs?.length > 0 && (() => {
            const diningPrefs = servicePrefs?.filter(p => p?.key?.toLowerCase() === 'dining service style' || p?.key?.toLowerCase()?.replace(/\s+/g, '_') === 'dining_service_style');
            const otherPrefs = servicePrefs?.filter(p => !(p?.key?.toLowerCase() === 'dining service style' || p?.key?.toLowerCase()?.replace(/\s+/g, '_') === 'dining_service_style'));
            return (
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '4px', overflow: 'hidden', marginBottom: '4px', background: '#ffffff' }}>
                {otherPrefs?.map((p, i) => <PrefRow key={p?.id || i} pref={p} showConfidence={true} includeImages={includeImages} />)}
                {diningPrefs?.length > 0 && <GroupedDiningServiceStyleBlock prefs={diningPrefs} showConfidence={true} />}
              </div>
            );
          })()}
          <InlineAvoids avoids={serviceAvoids} includeImages={includeImages} />
        </>
      )}
      {(Object.keys(foodGrouped)?.length > 0 || foodAvoids?.length > 0) && (
        <>
          <SectionHeader title="Food & Drink" />
          {Object.entries(foodGrouped)?.map(([label, prefs]) => (
            <SubSection key={label} title={label} prefs={prefs} showConfidence={true} includeImages={includeImages} />
          ))}
          <InlineAvoids avoids={foodAvoids} includeImages={includeImages} />
        </>
      )}
      {(cabinPrefs?.length > 0 || cabinAvoids?.length > 0) && (
        <>
          <SectionHeader title="Cabin & Comfort" />
          {cabinPrefs?.length > 0 && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '4px', overflow: 'hidden', marginBottom: '4px', background: '#ffffff' }}>
              {cabinPrefs?.map((p, i) => <PrefRow key={p?.id || i} pref={p} showConfidence={true} includeImages={includeImages} />)}
            </div>
          )}
          <InlineAvoids avoids={cabinAvoids} includeImages={includeImages} />
        </>
      )}
      {(activityPrefs?.length > 0 || activityAvoids?.length > 0) && (
        <>
          <SectionHeader title="Activities" />
          {activityPrefs?.length > 0 && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '4px', overflow: 'hidden', marginBottom: '4px', background: '#ffffff' }}>
              {activityPrefs?.map((p, i) => <PrefRow key={p?.id || i} pref={p} showConfidence={true} includeImages={includeImages} />)}
            </div>
          )}
          <InlineAvoids avoids={activityAvoids} includeImages={includeImages} />
        </>
      )}
      {(notesPrefs?.length > 0 || notesAvoids?.length > 0) && (
        <>
          <SectionHeader title="Notes" />
          {notesPrefs?.length > 0 && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '4px', overflow: 'hidden', marginBottom: '4px', background: '#ffffff' }}>
              {notesPrefs?.map((p, i) => <PrefRow key={p?.id || i} pref={p} showConfidence={false} includeImages={includeImages} />)}
            </div>
          )}
          <InlineAvoids avoids={notesAvoids} includeImages={includeImages} />
        </>
      )}
      {guestTrips?.length > 0 && (
        <>
          <SectionHeader title="Trip History" />
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '4px', overflow: 'hidden', marginBottom: '4px', background: '#ffffff' }}>
            {guestTrips?.map((trip, i) => (
              <div key={trip?.id || i} style={{
                padding: '6px 10px', borderBottom: '1px solid #f1f5f9',
                display: 'flex', alignItems: 'center', gap: '12px', background: '#ffffff'
              }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#0f172a' }}>{trip?.name || 'Unnamed Trip'}</span>
                  {trip?.vesselName && <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '8px' }}>— {trip?.vesselName}</span>}
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8', flexShrink: 0 }}>
                  {trip?.startDate && formatDate(trip?.startDate)}
                  {trip?.startDate && trip?.endDate && ' – '}
                  {trip?.endDate && formatDate(trip?.endDate)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ─── CHEF REPORT ──────────────────────────────────────────────────────────────
const ChefReport = ({ guest, preferences, includeImages }) => {
  const routinePrefs = preferences?.filter(p => p?.category === 'Routine' && p?.prefType !== 'avoid');
  const mealRoutine = routinePrefs?.filter(p =>
    ['breakfast time', 'lunch time', 'dinner time']?.some(k => p?.key?.toLowerCase()?.includes(k))
  );
  const foodPrefs = preferences?.filter(p => p?.category === 'Food & Beverage' && p?.prefType !== 'avoid');
  const chefFoodGroups = [
    { label: 'Coffee', tags: ['coffee'] }, { label: 'Tea', tags: ['tea'] },
    { label: 'Breakfast', tags: ['breakfast'] }, { label: 'Lunch', tags: ['lunch'] },
    { label: 'Dinner', tags: ['dinner', 'galley', 'meal', 'meals'] },
    { label: 'Snacks', tags: ['snack', 'snacks'] }, { label: 'Desserts', tags: ['dessert', 'desserts'] },
    { label: 'Wine', tags: ['wine'] }, { label: 'Cocktails', tags: ['cocktail', 'cocktails'] },
    { label: 'Spirits', tags: ['spirit', 'spirits'] },
  ];
  const foodGrouped = groupByTag(foodPrefs, chefFoodGroups);
  const foodAvoids = preferences?.filter(p =>
    p?.prefType === 'avoid' && ['Food & Beverage', 'Dietary', 'Allergies']?.includes(p?.category)
  );
  const hasProfileAllergies = guest?.allergies && guest?.allergies?.trim() !== '';
  const servicePrefs = preferences?.filter(p => p?.category === 'Service' && p?.prefType !== 'avoid');
  const diningService = servicePrefs?.filter(p =>
    ['dining service style', 'dining pace', 'plating', 'portion', 'spice', 'dining style', 'meal pace', 'presentation']?.some(k => p?.key?.toLowerCase()?.includes(k))
  );

  return (
    <div style={{ fontFamily: 'Georgia, serif', color: '#1a1a1a', lineHeight: '1.5', background: '#ffffff' }}>
      <ReportHeader guest={guest} reportTitle="Chef Report" />
      {mealRoutine?.length > 0 && (
        <>
          <SectionHeader title="Meal Routine" />
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '4px', overflow: 'hidden', marginBottom: '4px', background: '#ffffff' }}>
            {mealRoutine?.map((p, i) => <PrefRow key={p?.id || i} pref={p} showConfidence={false} includeImages={includeImages} />)}
          </div>
        </>
      )}
      {diningService?.length > 0 && (
        <>
          <SectionHeader title="Service Snapshot" />
          {(() => {
            const diningStylePrefs = diningService?.filter(p => p?.key?.toLowerCase() === 'dining service style' || p?.key?.toLowerCase()?.replace(/\s+/g, '_') === 'dining_service_style');
            const otherServicePrefs = diningService?.filter(p => !(p?.key?.toLowerCase() === 'dining service style' || p?.key?.toLowerCase()?.replace(/\s+/g, '_') === 'dining_service_style'));
            return (
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '4px', overflow: 'hidden', marginBottom: '4px', background: '#ffffff' }}>
                {otherServicePrefs?.map((p, i) => <PrefRow key={p?.id || i} pref={p} showConfidence={true} includeImages={includeImages} />)}
                {diningStylePrefs?.length > 0 && <GroupedDiningServiceStyleBlock prefs={diningStylePrefs} showConfidence={true} />}
              </div>
            );
          })()}
        </>
      )}
      {(Object.keys(foodGrouped)?.length > 0 || hasProfileAllergies || foodAvoids?.length > 0) && (
        <>
          <SectionHeader title="Food & Drink Preferences" />
          {Object.entries(foodGrouped)?.map(([label, prefs]) => (
            <SubSection key={label} title={label} prefs={prefs} showConfidence={true} includeImages={includeImages} />
          ))}
          {(hasProfileAllergies || foodAvoids?.length > 0) && (
            <div style={{ marginTop: '8px' }}>
              <AvoidsSubHeader />
              {hasProfileAllergies && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '4px', padding: '8px 12px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: '#991b1b', textTransform: 'uppercase' }}>⚠ Allergies: </span>
                  <span style={{ fontSize: '12px', color: '#991b1b' }}>{guest?.allergies}</span>
                </div>
              )}
              {foodAvoids?.length > 0 && (
                <div style={{ border: '1px solid #fecaca', borderRadius: '4px', overflow: 'hidden', background: '#fff8f8' }}>
                  {foodAvoids?.map((p, i) => <PrefRow key={p?.id || i} pref={p} showConfidence={false} includeImages={includeImages} />)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ─── Report Content (shared between preview and print) ────────────────────────
const ReportContent = ({ reportType, guest, preferences, includeImages, guestTrips }) => {
  if (reportType === 'full') return <FullGuestReport guest={guest} preferences={preferences} includeImages={includeImages} guestTrips={guestTrips} />;
  return <ChefReport guest={guest} preferences={preferences} includeImages={includeImages} />;
};

// ─── Main Modal ───────────────────────────────────────────────────────────────
const ExportPreferencesModal = ({ isOpen, onClose, guest, preferences }) => {
  const [reportType, setReportType] = useState('full');
  const [showPreview, setShowPreview] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [includeImages, setIncludeImages] = useState(false);
  // loadTrips is async post-A3.1 — hydrate the per-guest trip list on
  // open and pass down as a prop. FullGuestReport renders synchronously
  // and can't await, hence the modal-level effect.
  const [guestTrips, setGuestTrips] = useState([]);
  const previewRef = useRef(null);

  useEffect(() => {
    if (!isOpen || !guest?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const allTrips = await loadTrips();
        if (cancelled) return;
        setGuestTrips((allTrips || [])
          .filter(t => !t?.isDeleted && (t?.guestIds || []).includes(guest?.id)));
      } catch (err) {
        console.warn('[ExportPreferencesModal] loadTrips failed:', err);
        if (!cancelled) setGuestTrips([]);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, guest?.id]);

  if (!isOpen) return null;

  const handlePrint = useCallback(() => {
    if (!previewRef?.current) return;
    setIsPrinting(true);

    // Get the inner HTML of the preview content
    const content = previewRef?.current?.innerHTML;

    // Open a new window with only the report content — completely isolated from dark theme
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
      setIsPrinting(false);
      return;
    }

    printWindow?.document?.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Guest Preferences Report</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            html, body {
              background: #ffffff !important;
              color: #1a1a1a !important;
              font-family: Georgia, serif;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            body { padding: 10mm; }
            @page { size: A4; margin: 10mm; }
            @media print {
              html, body { background: #ffffff !important; }
            }
          </style>
        </head>
        <body>
          ${content}
        </body>
      </html>
    `);
    printWindow?.document?.close();

    printWindow.onload = () => {
      printWindow?.focus();
      printWindow?.print();
      printWindow.onafterprint = () => {
        printWindow?.close();
        setIsPrinting(false);
      };
      // Fallback close after 3s if onafterprint doesn't fire
      setTimeout(() => {
        setIsPrinting(false);
      }, 3000);
    };
  }, []);

  const reportOptions = [
    {
      id: 'full',
      label: 'Guest Preferences Report',
      description: 'Complete profile including routine, food & drink, cabin, activities, and trip history.',
      icon: 'FileText'
    },
    {
      id: 'chef',
      label: 'Chef Report',
      description: 'Galley-focused: meal routine, food preferences, avoids, and dining service notes.',
      icon: 'ChefHat'
    }
  ];

  // ── Preview Screen ──────────────────────────────────────────────────────────
  if (showPreview) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.7)' }}
      >
        <div className="bg-card border border-border rounded-2xl shadow-2xl flex flex-col" style={{ width: '700px', maxWidth: '95vw', height: '90vh' }}>
          {/* Preview Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowPreview(false)}
                className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Icon name="ArrowLeft" size={18} />
              </button>
              <div>
                <h2 className="text-base font-semibold text-foreground">Report Preview</h2>
                <p className="text-xs text-muted-foreground">
                  {reportType === 'full' ? 'Guest Preferences Report' : 'Chef Report'} — {guest?.firstName} {guest?.lastName}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Icon name="X" size={18} />
            </button>
          </div>

          {/* Preview Body — white background, scrollable */}
          <div className="flex-1 overflow-y-auto" style={{ background: '#f1f5f9' }}>
            <div
              ref={previewRef}
              style={{
                background: '#ffffff',
                color: '#1a1a1a',
                margin: '16px auto',
                padding: '20mm 16mm',
                maxWidth: '210mm',
                minHeight: '297mm',
                boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
                borderRadius: '4px',
              }}
            >
              <ReportContent reportType={reportType} guest={guest} preferences={preferences} includeImages={includeImages} guestTrips={guestTrips} />
            </div>
          </div>

          {/* Preview Footer */}
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border flex-shrink-0">
            <p className="text-xs text-muted-foreground">Looking good? Click Print to open the print dialog.</p>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => setShowPreview(false)}>Back</Button>
              <Button
                variant="primary"
                iconName="Printer"
                onClick={handlePrint}
                disabled={isPrinting}
              >
                {isPrinting ? 'Opening...' : 'Print / Save PDF'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Selection Screen ────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e?.target === e?.currentTarget) onClose(); }}
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <Icon name="Download" size={18} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Export Guest Preferences</h2>
              <p className="text-xs text-muted-foreground">
                {guest?.firstName} {guest?.lastName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Icon name="X" size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Report Type */}
          <div>
            <p className="text-sm font-medium text-foreground mb-3">Report Type</p>
            <div className="space-y-2">
              {reportOptions?.map(opt => (
                <button
                  key={opt?.id}
                  onClick={() => setReportType(opt?.id)}
                  className={`w-full flex items-start gap-3 p-3.5 rounded-xl border-2 text-left transition-all ${
                    reportType === opt?.id
                      ? 'border-primary bg-primary/5' :'border-border hover:border-primary/40 hover:bg-muted/30'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    reportType === opt?.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}>
                    <Icon name={opt?.icon} size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-semibold ${
                        reportType === opt?.id ? 'text-primary' : 'text-foreground'
                      }`}>{opt?.label}</p>
                      {reportType === opt?.id && (
                        <Icon name="CheckCircle" size={14} className="text-primary flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{opt?.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Include Images Checkbox */}
          <div>
            <label className="flex items-center gap-3 cursor-pointer group">
              <div
                onClick={() => setIncludeImages(v => !v)}
                className={`w-5 h-5 rounded flex items-center justify-center border-2 flex-shrink-0 transition-colors ${
                  includeImages
                    ? 'bg-primary border-primary' :'border-border bg-background group-hover:border-primary/50'
                }`}
              >
                {includeImages && <Icon name="Check" size={12} className="text-primary-foreground" />}
              </div>
              <div onClick={() => setIncludeImages(v => !v)} className="flex-1">
                <p className="text-sm font-medium text-foreground">Include uploaded images</p>
                <p className="text-xs text-muted-foreground">Preference cards with an attached image will display it inline in the report.</p>
              </div>
            </label>
          </div>

          {/* Info note */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
            <Icon name="Info" size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700 dark:text-blue-400">
              Preview the report first, then print or save as PDF from the preview screen.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            iconName="Eye"
            onClick={() => setShowPreview(true)}
          >
            Preview Report
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ExportPreferencesModal;
