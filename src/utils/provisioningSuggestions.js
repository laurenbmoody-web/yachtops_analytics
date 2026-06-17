/**
 * Smart Provisioning Suggestions Engine
 *
 * Generates provisioning item suggestions from 4 sources:
 *  1. guest_preference — dietary requirements and food/drink preferences for guests on a trip
 *  2. low_stock        — inventory items at or below reorder threshold
 *  3. invoice_pattern  — items ordered regularly based on delivery history
 *  4. location_aware   — staples to stock up on for remote ports / long passages
 */

import { supabase } from '../lib/supabaseClient';
import { getTripById } from '../pages/trips-management-dashboard/utils/tripStorage';

// ── Query 1: Guest Preferences ────────────────────────────────────────────────

const FOOD_PREFERENCE_CATEGORIES = [
  'Food & Beverage', 'Dietary', 'Wine/Spirits', 'Allergies', 'Galley',
];

// Preference keys the wizard inserts (PreferenceAssistantWizard.jsx) that
// describe service/routine/personality state, NOT a buy item. Even when
// they're stored under Food & Beverage / Dietary categories they're
// metadata — surface them and you get "Communication Style" or "Wake Up
// Time" as suggested items.
const NON_ITEM_KEYS = new Set([
  // Service
  'Crew Familiarity', 'Personality Profile', 'Personality Notes',
  'Crew Interaction Style', 'Crew Interaction Notes', 'Communication Style',
  'Crew Presence Preference', 'Dining Service Style', 'Dining Pace',
  'Table Preferences',
  // Routine
  'Wake Up Time', 'Morning Routine', 'Breakfast Time', 'Lunch Time',
  'Dinner Time', 'Late Night Behaviour', 'Nap Habits', 'Bed Time',
  // Other meta
  'Top Things to Remember', 'Favourite Meals',
]);

// pref.value patterns that signal metadata (NOT a stockable item).
// e.g. "Milk: Regular | Frequency: once_per_day" — config blob, not a
// product. Or steak doneness words ("Rare", "Medium").
const META_VALUE_PATTERN = /^(Allergy|Intolerance|once_per_day|fill with|tall glass|under any circumstance)/i;
const META_VALUE_CONTAINS = /(Frequency:|Milk:|\|)/i;
const SERVE_STYLE_VALUE   = /^(Rare|Medium|Medium rare|Well done|Iced|Hot|Cold)$/i;

// Split a multi-item pref value into its constituent items.
// Guests often enter several drinks/wines/spirits as a single comma-
// separated string ("Vodka, Aperol, Gin" / "Tignanello, Super Tuscans")
// and each should surface as its own suggestion line. Don't split
// metadata values — those use commas as part of the config blob.
function splitMultiValue(value) {
  if (!value) return [];
  if (META_VALUE_PATTERN.test(value) || META_VALUE_CONTAINS.test(value)) return [value];
  return value
    .split(/\s*,\s*|\s*&\s*|\s+and\s+/i)
    .map(s => s.trim())
    .filter(Boolean);
}

// Translate a (preference key, value) pair into a stockable item shape.
// Returns null when the pair doesn't describe a buy item — e.g. a coffee
// preparation instruction like "Iced americano" with key "Coffee" still
// resolves to a generic "Coffee" item (we know coffee needs to be on
// the list), but a steak doneness like "Rare" with key "Steak" doesn't
// resolve at all (the wizard surfaces a dietary note, not an item — the
// galley team know to stock steak).
function prefToBuyItem(pref) {
  const key   = pref?.key || '';
  const value = pref?.value || '';
  if (!key) return null;

  const valueIsMeta = !value
    || META_VALUE_PATTERN.test(value)
    || META_VALUE_CONTAINS.test(value)
    || SERVE_STYLE_VALUE.test(value);

  // Maps drink keys to a generic baseline + how to integrate the
  // guest's specific value when it's a real brand/type (e.g. wine
  // "Sauvignon Blanc", tea "Yorkshire", water "Evian").
  switch (key) {
    case 'Coffee':
      return { name: 'Coffee', category: 'Beverages', department: 'Galley', unit: 'pack', quantity: 1 };
    case 'Tea':
      return valueIsMeta
        ? { name: 'Tea', category: 'Beverages', department: 'Galley', unit: 'box', quantity: 1 }
        : { name: `${value} Tea`, category: 'Beverages', department: 'Galley', unit: 'box', quantity: 1 };
    case 'Wine':
    case 'Favourite Wines':
      // No `department` here (or any of the drinks suggestions below)
      // — the consumer assigns the current user's dept at apply-time.
      // "Bar" used to live here; it was never a real dept.
      return valueIsMeta
        ? { name: 'Wine', category: 'Beverages', unit: 'bottle', quantity: 2 }
        : { name: value, category: 'Beverages', unit: 'bottle', quantity: 2 };
    case 'Spirits':
    case 'Favourite Spirits':
      return valueIsMeta
        ? { name: 'Spirits', category: 'Spirits', unit: 'bottle', quantity: 1 }
        : { name: value, category: 'Spirits', unit: 'bottle', quantity: 1 };
    case 'Evening Drink':
    case 'Favourite Evening Drink':
      return valueIsMeta
        ? null
        : { name: value, category: 'Beverages', unit: 'each', quantity: 1 };
    case 'Cocktail':
    case 'Typical Cocktail':
      // Cocktails are recipes not single items — skip rather than fake.
      return null;
    case 'Water':
      return valueIsMeta
        ? { name: 'Water', category: 'Beverages', department: 'Galley', unit: 'bottle', quantity: 12 }
        : { name: `${value} Water`, category: 'Beverages', department: 'Galley', unit: 'bottle', quantity: 12 };
    default:
      return null;
  }
}

async function getGuestPreferenceSuggestions(tripId, vesselId) {
  try {
    // Get all guest IDs on this trip. getTripById is async post-A3.1
    // (Supabase trips + trip_guests merged with localStorage embedded
    // arrays).
    const trip = await getTripById(tripId);
    if (!trip?.guests?.length) return [];

    // Prefer guests explicitly marked active; fall back to ALL linked
    // guests if none are flagged. trip_guests.is_active_on_trip defaults
    // to false in the storage layer, which used to silently empty the
    // pool when a trip was freshly linked — the user clearly intends
    // every linked guest to inform suggestions even if no-one's been
    // toggled "active on trip" yet. Mirrors the wizard's own guest-count
    // fallback (index.jsx NewBoardColumn).
    const allGuestIds = trip.guests.map(g => g.guestId).filter(Boolean);
    const activeGuestIds = trip.guests.filter(g => g.isActive).map(g => g.guestId).filter(Boolean);
    const guestIds = activeGuestIds.length > 0 ? activeGuestIds : allGuestIds;
    if (!guestIds.length) return [];

    // Load guest details for names
    const { data: guestsData } = await supabase
      ?.from('guests')
      ?.select('id, first_name, last_name, allergies')
      ?.in('id', guestIds)
      ?.eq('tenant_id', vesselId);

    // Load preferences for these guests
    const { data: prefs } = await supabase
      ?.from('guest_preferences')
      ?.select('guest_id, category, key, value, pref_type, priority')
      ?.in('guest_id', guestIds)
      ?.eq('tenant_id', vesselId)
      ?.in('category', FOOD_PREFERENCE_CATEGORIES);

    const suggestions = [];
    const guestMap = {};
    (guestsData || []).forEach(g => {
      guestMap[g.id] = g;
      // Add allergen suggestions — these stay as "[Allergen check]" notes
      // (is_allergen_note: true), not as buy items. SmartSuggestionsPanel
      // renders them with the allergen styling.
      if (g.allergies) {
        const allergens = Array.isArray(g.allergies) ? g.allergies : [g.allergies];
        allergens.filter(Boolean).forEach(a => {
          suggestions.push({
            id: `pref_${g.id}_allergy_${a}`,
            name: `[Allergen check] ${a}`,
            category: 'Allergen',
            source: 'guest_preference',
            reason: `${g.first_name} ${g.last_name} has a ${a} allergy — verify all items`,
            priority: 'high',
            quantity_ordered: 0,
            unit: 'each',
            is_allergen_note: true,
          });
        });
      }
    });

    // Dedupe map — multiple guests asking for the same item should
    // surface ONCE with a combined reason, not once per guest.
    const itemBuckets = new Map(); // itemKey → { suggestion, guests: [name] }

    (prefs || []).forEach(pref => {
      // 1. Avoid prefs are restrictions — not buy items. Surfaced by
      //    the kitchen/service team via the guest profile, not here.
      if (pref.pref_type === 'avoid') return;

      // 2. Allergies category surfaces via the allergen check above.
      if (pref.category === 'Allergies') return;

      // 3. Service / routine / personality keys aren't items even when
      //    stored under Food & Beverage.
      if (NON_ITEM_KEYS.has(pref.key)) return;

      // 4. Split multi-item values into separate buy lines.
      //    "Vodka, Aperol, Gin" becomes three suggestions, one per
      //    spirit, not one row labelled with the whole string. Empty
      //    value falls through as a single iteration so generic prefs
      //    (Wine / Tea without a specific brand) still surface.
      const valueParts = splitMultiValue(pref.value);
      const iterValues = valueParts.length > 0 ? valueParts : [pref.value || ''];

      iterValues.forEach(singleValue => {
        // 5. Translate to a buy item shape — if no mapping, skip rather
        //    than dump raw values like "Rare" or "Iced americano".
        const item = prefToBuyItem({ ...pref, value: singleValue });
        if (!item) return;

        const guest = guestMap[pref.guest_id];
        const guestName = guest ? `${guest.first_name} ${guest.last_name}` : 'Guest';
        const itemKey = item.name.toLowerCase().trim();

        const existing = itemBuckets.get(itemKey);
        if (existing) {
          existing.guests.add(guestName);
          // Promote priority if anyone marks it required.
          if (pref.pref_type === 'requirement') existing.priority = 'high';
        } else {
          itemBuckets.set(itemKey, {
            item,
            guests: new Set([guestName]),
            priority: pref.pref_type === 'requirement' ? 'high' : 'normal',
          });
        }
      });
    });

    itemBuckets.forEach(({ item, guests, priority }, key) => {
      const guestList = Array.from(guests);
      const reason = guestList.length === 1
        ? `${guestList[0]} prefers`
        : `${guestList.slice(0, -1).join(', ')} & ${guestList.slice(-1)[0]} prefer`;
      suggestions.push({
        id: `pref_${key.replace(/\s+/g, '_')}_${Math.random().toString(36).slice(2)}`,
        name: item.name,
        category: item.category,
        department: item.department,
        source: 'guest_preference',
        reason,
        priority,
        quantity_ordered: item.quantity,
        unit: item.unit,
        allergen_flags: [],
      });
    });

    return suggestions;
  } catch (err) {
    console.warn('[provisioningSuggestions] guest preferences query failed:', err);
    return [];
  }
}

// ── Query 2: Low Stock ────────────────────────────────────────────────────────

async function getLowStockSuggestions(vesselId) {
  try {
    const { data: items } = await supabase
      ?.from('inventory_items')
      ?.select('id, name, quantity, total_qty, reorder_point, restock_level, unit, l2_name, l3_name, usage_department')
      ?.eq('tenant_id', vesselId);

    const suggestions = [];
    (items || []).forEach(item => {
      const qty = item.total_qty || item.quantity || 0;
      const threshold = item.reorder_point || item.restock_level || 0;

      let isLow = false;
      let reason = '';

      if (threshold > 0 && qty <= threshold) {
        isLow = true;
        reason = `Low stock: ${qty} ${item.unit || 'units'} remaining (reorder point: ${threshold})`;
      } else if (threshold === 0 && qty === 0) {
        isLow = true;
        reason = `Out of stock`;
      }

      if (isLow) {
        suggestions.push({
          id: `stock_${item.id}`,
          name: item.name,
          category: item.l2_name || item.l3_name || 'Other',
          department: item.usage_department || 'Galley',
          source: 'low_stock',
          reason,
          priority: qty === 0 ? 'high' : 'normal',
          quantity_ordered: Math.max(1, (threshold || 0) * 2 - qty),
          unit: item.unit || 'each',
          allergen_flags: [],
          inventory_item_id: item.id,
        });
      }
    });

    return suggestions;
  } catch (err) {
    console.warn('[provisioningSuggestions] low stock query failed:', err);
    return [];
  }
}

// ── Query 3: Invoice Pattern ──────────────────────────────────────────────────

async function getInvoicePatternSuggestions(vesselId) {
  try {
    const { data: deliveries } = await supabase
      ?.from('provisioning_deliveries')
      ?.select('parsed_data, delivered_at, list_id')
      ?.order('delivered_at', { ascending: false })
      ?.limit(200);

    if (!deliveries?.length) return [];

    // Build item order history from parsed delivery data
    const itemHistory = {};
    deliveries.forEach(delivery => {
      const items = delivery?.parsed_data?.items || [];
      items.forEach(item => {
        const key = item.name?.toLowerCase()?.trim();
        if (!key) return;
        if (!itemHistory[key]) {
          itemHistory[key] = { name: item.name, dates: [], unit: item.unit || 'each' };
        }
        itemHistory[key].dates.push(new Date(delivery.delivered_at));
      });
    });

    const suggestions = [];
    const now = new Date();

    Object.values(itemHistory).forEach(({ name, dates, unit }) => {
      if (dates.length < 2) return;
      dates.sort((a, b) => a - b);

      // Calculate average interval between orders (in days)
      const intervals = [];
      for (let i = 1; i < dates.length; i++) {
        intervals.push((dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24));
      }
      const avgDays = intervals.reduce((s, d) => s + d, 0) / intervals.length;
      const lastOrdered = dates[dates.length - 1];
      const daysSinceLast = (now - lastOrdered) / (1000 * 60 * 60 * 24);

      if (daysSinceLast >= avgDays * 0.8) {
        suggestions.push({
          id: `pattern_${name.replace(/\s/g, '_')}`,
          name,
          category: 'Other',
          department: 'Galley',
          source: 'invoice_pattern',
          reason: `Typically ordered every ${Math.round(avgDays)} days — last ordered ${Math.round(daysSinceLast)} days ago`,
          priority: daysSinceLast >= avgDays * 1.2 ? 'high' : 'normal',
          quantity_ordered: 1,
          unit,
          allergen_flags: [],
        });
      }
    });

    return suggestions;
  } catch (err) {
    console.warn('[provisioningSuggestions] invoice pattern query failed:', err);
    return [];
  }
}

// ── Query 4: Location Awareness ───────────────────────────────────────────────

const REMOTE_PORT_KEYWORDS = ['remote', 'offshore', 'passage', 'crossing', 'atlantic', 'pacific', 'indian ocean'];

const LOCATION_STAPLES = [
  { name: 'Rice', category: 'Dry Goods', department: 'Galley', unit: 'kg', quantity_ordered: 5 },
  { name: 'Pasta', category: 'Dry Goods', department: 'Galley', unit: 'kg', quantity_ordered: 3 },
  { name: 'Canned tomatoes', category: 'Dry Goods', department: 'Galley', unit: 'case', quantity_ordered: 2 },
  { name: 'Olive oil', category: 'Condiments', department: 'Galley', unit: 'litre', quantity_ordered: 3 },
  { name: 'Long-life milk', category: 'Dairy', department: 'Galley', unit: 'litre', quantity_ordered: 6 },
  { name: 'Drinking water (cases)', category: 'Beverages', department: 'Galley', unit: 'case', quantity_ordered: 10 },
  { name: 'First aid supplies', category: 'Medical', department: 'Admin', unit: 'pack', quantity_ordered: 1 },
];

async function getLocationAwareSuggestions(tripId) {
  try {
    const trip = await getTripById(tripId);
    if (!trip) return [];

    // Check itinerary for remote ports or long passages
    const itinerary = trip.itinerary || trip.itineraryDays || [];
    const isRemote = itinerary.some(day => {
      const loc = (day.location || day.port || day.destination || '').toLowerCase();
      return REMOTE_PORT_KEYWORDS.some(kw => loc.includes(kw));
    });

    // Check trip duration — suggest stock-up if > 7 days
    const start = trip.startDate ? new Date(trip.startDate) : null;
    const end = trip.endDate ? new Date(trip.endDate) : null;
    const durationDays = start && end ? (end - start) / (1000 * 60 * 60 * 24) : 0;
    const isLongPassage = durationDays > 7;

    if (!isRemote && !isLongPassage) return [];

    const portName = isRemote
      ? itinerary.find(d => REMOTE_PORT_KEYWORDS.some(kw => (d.location || d.port || '').toLowerCase().includes(kw)))?.location || 'remote location'
      : `${Math.round(durationDays)}-day passage`;

    return LOCATION_STAPLES.map((item, i) => ({
      id: `location_${i}`,
      ...item,
      source: 'location_aware',
      reason: `Suggested for ${portName} — stock up on essentials`,
      priority: 'normal',
      allergen_flags: [],
    }));
  } catch (err) {
    console.warn('[provisioningSuggestions] location suggestions failed:', err);
    return [];
  }
}

// ── Query 5: Master History ────────────────────────────────────────────────────

/**
 * Surface items ordered 3+ times historically that are not on the current list
 * and not already covered by low_stock suggestions.
 */
export async function getMasterHistorySuggestions(vesselId, currentItems = []) {
  try {
    const { data: lists } = await supabase
      ?.from('provisioning_lists')
      ?.select('id')
      ?.eq('vessel_id', vesselId)
      ?.eq('status', 'delivered');

    if (!lists?.length) return [];
    const listIds = lists.map(l => l.id);

    const { data: items } = await supabase
      ?.from('provisioning_items')
      ?.select('name, brand, size, category, sub_category, department, unit, quantity_ordered, created_at')
      ?.in('list_id', listIds);

    if (!items?.length) return [];

    const historyMap = {};
    items.forEach(item => {
      const key = (item.name || '').toLowerCase().trim();
      if (!key) return;
      if (!historyMap[key]) {
        historyMap[key] = {
          name: item.name,
          brand: item.brand || '',
          size: item.size || '',
          category: item.category || '',
          sub_category: item.sub_category || '',
          department: item.department || 'Galley',
          unit: item.unit || 'each',
          count: 0,
          dates: [],
        };
      }
      historyMap[key].count += 1;
      if (item.created_at) historyMap[key].dates.push(new Date(item.created_at));
    });

    // Items already on the current list (by lowercase name)
    const currentNames = new Set((currentItems || []).map(i => (i.name || '').toLowerCase().trim()));

    const suggestions = [];
    Object.values(historyMap).forEach(h => {
      if (h.count < 3) return;
      if (currentNames.has(h.name.toLowerCase().trim())) return;

      const lastDate = h.dates.length ? new Date(Math.max(...h.dates)) : null;
      const daysAgo = lastDate ? Math.round((Date.now() - lastDate) / 86400000) : null;

      suggestions.push({
        id: `master_${h.name.replace(/\s/g, '_')}_${Math.random().toString(36).slice(2)}`,
        name: h.name,
        brand: h.brand,
        size: h.size,
        category: h.category,
        sub_category: h.sub_category,
        department: h.department,
        source: 'master_history',
        reason: `Ordered ${h.count} time${h.count !== 1 ? 's' : ''} previously${daysAgo != null ? `, last ordered ${daysAgo} days ago` : ''}`,
        priority: 'normal',
        quantity_ordered: 1,
        unit: h.unit,
        allergen_flags: [],
        times_ordered: h.count,
        last_ordered_days_ago: daysAgo,
      });
    });

    return suggestions.sort((a, b) => b.times_ordered - a.times_ordered);
  } catch (err) {
    console.warn('[provisioningSuggestions] master history query failed:', err);
    return [];
  }
}

// ── Query 6: Occasions (guest birthdays falling inside the trip) ─────────────

// guests.date_of_birth is TEXT. Common shapes:
//   "1990-06-18"   ISO YYYY-MM-DD
//   "18/06/1990"   DD/MM/YYYY (UK form, fleet default)
//   "06/18/1990"   MM/DD/YYYY (we can't distinguish from DD/MM cleanly,
//                  so we accept the UK form and ignore ambiguous strings
//                  with month > 12)
// Returns { month, day } or null when unparseable.
function extractMonthDay(dob) {
  if (!dob) return null;
  const iso = String(dob).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const m = parseInt(iso[2], 10);
    const d = parseInt(iso[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { month: m, day: d };
  }
  const slash = String(dob).match(/^(\d{1,2})[\/\-](\d{1,2})/);
  if (slash) {
    const a = parseInt(slash[1], 10);
    const b = parseInt(slash[2], 10);
    // UK form first: day/month
    if (a >= 1 && a <= 31 && b >= 1 && b <= 12) return { month: b, day: a };
  }
  return null;
}

// Walk each day in trip [start, end] inclusive; return the Date the
// birthday lands on, or null when no day in the range matches MM-DD.
function findOccasionDate(monthDay, startISO, endISO) {
  if (!monthDay || !startISO || !endISO) return null;
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cur.getTime() <= endDay.getTime()) {
    if (cur.getMonth() + 1 === monthDay.month && cur.getDate() === monthDay.day) {
      return new Date(cur);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return null;
}

const OCCASION_FANOUT = [
  { name: 'Birthday cake', category: 'Bakery', department: 'Galley',  unit: 'each',    quantity: 1, signalText: 'Surprise',    signalCls: 'is-orange' },
  { name: 'Champagne',     category: 'Beverages', department: 'Galley', unit: 'bottle',  quantity: 2, signalText: 'Surprise',    signalCls: 'is-orange' },
  { name: 'Candles',       category: 'Decor', department: 'Interior', unit: 'pack',    quantity: 1, signalText: 'Celebration', signalCls: 'is-muted'  },
];

// Birthdays just before or just after the trip are often celebrated
// during it ("we'll do the dinner on the last night"). Widen the
// match window by this many days on each side; the reason text
// surfaces the distance so the crew knows it's an early/late case.
const OCCASION_WINDOW_DAYS = 7;

async function getOccasionsSuggestions(tripId, vesselId) {
  try {
    const trip = await getTripById(tripId);
    if (!trip?.guests?.length) return [];
    const startISO = trip.startDate || trip.start_date;
    const endISO   = trip.endDate   || trip.end_date;
    if (!startISO || !endISO) return [];

    // Same active-then-fallback pattern as guest prefs.
    const allGuestIds = trip.guests.map(g => g.guestId).filter(Boolean);
    const activeGuestIds = trip.guests.filter(g => g.isActive).map(g => g.guestId).filter(Boolean);
    const guestIds = activeGuestIds.length > 0 ? activeGuestIds : allGuestIds;
    if (!guestIds.length) return [];

    const { data: guestsData } = await supabase
      ?.from('guests')
      ?.select('id, first_name, last_name, date_of_birth, cake_preference')
      ?.in('id', guestIds)
      ?.eq('tenant_id', vesselId);

    // Widen the match window by ±OCCASION_WINDOW_DAYS so birthdays the
    // week before/after the trip surface too. The reason text below
    // makes the relationship explicit so the crew knows whether it's
    // an early celebration, on-day, or post-trip celebration.
    const tripStart = new Date(startISO);
    const tripEnd   = new Date(endISO);
    const widenedStart = new Date(tripStart.getTime() - OCCASION_WINDOW_DAYS * 86400000);
    const widenedEnd   = new Date(tripEnd.getTime()   + OCCASION_WINDOW_DAYS * 86400000);

    const suggestions = [];
    (guestsData || []).forEach(g => {
      const md = extractMonthDay(g.date_of_birth);
      if (!md) return;
      const occasionDate = findOccasionDate(md, widenedStart.toISOString(), widenedEnd.toISOString());
      if (!occasionDate) return;

      const guestName = `${g.first_name || ''} ${g.last_name || ''}`.trim() || 'Guest';
      const dateLabel = occasionDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

      // Build a context-aware reason line.
      let reasonText;
      if (occasionDate >= tripStart && occasionDate <= tripEnd) {
        reasonText = `${guestName}'s birthday on ${dateLabel}`;
      } else if (occasionDate < tripStart) {
        const daysBefore = Math.round((tripStart - occasionDate) / 86400000);
        reasonText = `${guestName}'s birthday on ${dateLabel} — ${daysBefore} day${daysBefore === 1 ? '' : 's'} before trip starts (early celebration?)`;
      } else {
        const daysAfter = Math.round((occasionDate - tripEnd) / 86400000);
        reasonText = `${guestName}'s birthday on ${dateLabel} — ${daysAfter} day${daysAfter === 1 ? '' : 's'} after trip ends (celebrate on last night?)`;
      }

      OCCASION_FANOUT.forEach((tpl, i) => {
        // Augment cake with guest's cake_preference if recorded.
        const name = (tpl.name === 'Birthday cake' && g.cake_preference)
          ? `Birthday cake — ${g.cake_preference}`
          : tpl.name;
        suggestions.push({
          id: `occ_${g.id}_${i}`,
          name,
          category: tpl.category,
          department: tpl.department,
          source: 'occasions',
          reason: reasonText,
          priority: 'normal',
          quantity_ordered: tpl.quantity,
          unit: tpl.unit,
          allergen_flags: [],
          _signal: { text: tpl.signalText, cls: tpl.signalCls },
        });
      });
    });

    return suggestions;
  } catch (err) {
    console.warn('[provisioningSuggestions] occasions query failed:', err);
    return [];
  }
}

// ── Query 7: Expiring Soon (inventory_items.expiry_date inside trip window) ──

// Taxonomy categories that aren't provisioning consumables — items here
// often have expiry dates for compliance/sterility reasons (medical kit
// components, pyrotechnic flares, life-raft service dates) but they're
// stocked through medical/safety/engineering channels, not the
// provisioning board. Surfacing them here pollutes the picker with
// forceps / splints / life-raft components.
//
// Match is case-insensitive against the joined text of:
//   • l1..l4 taxonomy names (when populated)
//   • stock_locations[].locationName / location paths (often holds
//     "Vessel > Medical > First Aid" for items with empty taxonomy)
//   • the item name itself, as a last-resort heuristic for items with
//     neither taxonomy nor location metadata (forceps/splint/etc.)
//
// Adding a pattern here automatically scopes the filter down the tree.
const NON_PROVISIONING_TAXONOMY = /\b(Medical|First[ -]?Aid|Safety|Fire|Pyrotechnic|Life[ -]?Saving|Life[ -]?Raft|EEBD|MFAG|Spare[ -]?Parts|Engineering|Defibrillat|Sphygmo|Stethoscop)\b/i;

// Item-name patterns that strongly suggest medical/safety equipment
// even when taxonomy + location are blank. Conservative — only
// patterns where false positives are very unlikely (e.g. don't match
// "Scissors" alone since galley scissors exist; do match "splint",
// "forceps", "clamp" prefixed by medical-context tokens).
const MEDICAL_NAME_PATTERN = /\b(forceps|splint|gauze|bandage|tourniquet|suture|sphygmo|stethoscop|defibrillat|nebuliz|EpiPen|adrenalin|epinephrin|antiseptic|saline|tweezers\s+(?:medical|first[ -]aid))\b/i;

function isProvisioningRelevant(item) {
  // Canonical inventory folder path lives in the top-level `location`
  // (L1 folder name, e.g. "Medical") and `sub_location` (rest of the
  // path, e.g. "First Aid > Splints"). Items imported via the parser
  // and items added via the inventory modal both write here even when
  // l1..l4 taxonomy is empty. This is the most reliable single signal.
  const folder = [item.location, item.sub_location].filter(Boolean).join(' > ');
  if (folder && NON_PROVISIONING_TAXONOMY.test(folder)) return false;

  // l1..l4 taxonomy (secondary signal for items added via the
  // category-based UI rather than the folder UI).
  const tax = [item.l1_name, item.l2_name, item.l3_name, item.l4_name]
    .filter(Boolean).join(' / ');
  if (NON_PROVISIONING_TAXONOMY.test(tax)) return false;

  // stock_locations JSONB array of { locationName, vesselLocationId, qty }
  // — locationName usually a room/cabinet, sometimes carries the full
  // folder path. Same denylist.
  if (Array.isArray(item.stock_locations)) {
    const paths = item.stock_locations
      .map(sl => sl?.locationName || sl?.location_name || sl?.path || '')
      .filter(Boolean).join(' / ');
    if (paths && NON_PROVISIONING_TAXONOMY.test(paths)) return false;
  }

  // Item-name heuristic — only for items with empty taxonomy AND no
  // folder data. Conservative pattern set; bias toward false negatives
  // (let a borderline item through) over false positives.
  if (!tax && !folder && MEDICAL_NAME_PATTERN.test(item.name || '')) return false;

  return true;
}

async function getExpiringSoonSuggestions(tripId, vesselId) {
  try {
    const trip = await getTripById(tripId);
    const startISO = trip?.startDate || trip?.start_date;
    const endISO   = trip?.endDate   || trip?.end_date;
    if (!startISO || !endISO) return [];

    const tripStart  = new Date(startISO);
    const tripEnd    = new Date(endISO);
    const cutoff     = new Date(tripEnd.getTime() + 7 * 24 * 60 * 60 * 1000); // include 7d past return
    if (Number.isNaN(tripStart.getTime()) || Number.isNaN(tripEnd.getTime())) return [];

    const { data: items } = await supabase
      ?.from('inventory_items')
      ?.select('id, name, unit, total_qty, l1_name, l2_name, l3_name, l4_name, location, sub_location, usage_department, expiry_date, stock_locations')
      ?.eq('tenant_id', vesselId)
      ?.not('expiry_date', 'is', null)
      ?.lte('expiry_date', cutoff.toISOString().slice(0, 10));

    const suggestions = [];
    const tripDays = Math.max(1, Math.round((tripEnd - tripStart) / (1000 * 60 * 60 * 24)));
    const fmtDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    (items || []).forEach(item => {
      // Skip items whose taxonomy is medical / safety / engineering /
      // life-saving — they have expiry dates for compliance reasons,
      // not provisioning. Avoids the picker dumping the entire medical
      // kit (forceps / splints / etc) every time it loads.
      if (!isProvisioningRelevant(item)) return;

      const qty = item.total_qty || 0;
      if (qty <= 0) return; // low_stock covers zero-quantity items
      const exp = new Date(item.expiry_date);
      if (Number.isNaN(exp.getTime())) return;

      let signalText, signalCls, priority, reason;
      if (exp <= tripStart) {
        signalText = `Expires ${fmtDate(exp)}`;
        signalCls  = 'is-high';
        priority   = 'high';
        reason     = `${qty} in inventory — trip starts ${fmtDate(tripStart)}`;
      } else if (exp <= tripEnd) {
        signalText = `Expires ${fmtDate(exp)}`;
        signalCls  = 'is-warn';
        priority   = 'normal';
        reason     = `Won't last the ${tripDays}-day trip`;
      } else {
        signalText = `Expires ${fmtDate(exp)}`;
        signalCls  = 'is-muted';
        priority   = 'normal';
        reason     = `Refresh before departure`;
      }

      suggestions.push({
        id: `exp_${item.id}`,
        name: item.name,
        category: item.l2_name || 'Other',
        department: item.usage_department || 'Galley',
        source: 'expiring_soon',
        reason,
        priority,
        quantity_ordered: Math.max(1, qty),
        unit: item.unit || 'each',
        allergen_flags: [],
        inventory_item_id: item.id,
        _signal: { text: signalText, cls: signalCls },
      });
    });

    return suggestions.sort((a, b) => {
      const ap = a.priority === 'high' ? 0 : 1;
      const bp = b.priority === 'high' ? 0 : 1;
      return ap - bp;
    });
  } catch (err) {
    console.warn('[provisioningSuggestions] expiring-soon query failed:', err);
    return [];
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Fetch smart provisioning suggestions for a given trip + vessel.
 * Returns suggestions grouped by source.
 *
 * @param {string} tripId
 * @param {string} vesselId   — maps to tenant_id in this codebase
 * @param {Array}  currentItems — items already on the list (to exclude from master_history)
 * @returns {Promise<Object>}
 */
export async function getSmartSuggestions(tripId, vesselId, currentItems = []) {
  const [guestPrefs, lowStock, invoicePattern, locationAware, masterHistory, occasions, expiringSoon] = await Promise.allSettled([
    tripId ? getGuestPreferenceSuggestions(tripId, vesselId) : Promise.resolve([]),
    getLowStockSuggestions(vesselId),
    getInvoicePatternSuggestions(vesselId),
    tripId ? getLocationAwareSuggestions(tripId) : Promise.resolve([]),
    getMasterHistorySuggestions(vesselId, currentItems),
    tripId ? getOccasionsSuggestions(tripId, vesselId) : Promise.resolve([]),
    tripId ? getExpiringSoonSuggestions(tripId, vesselId) : Promise.resolve([]),
  ]);

  return {
    occasions:         occasions.status         === 'fulfilled' ? occasions.value         : [],
    expiring_soon:     expiringSoon.status      === 'fulfilled' ? expiringSoon.value      : [],
    guest_preference:  guestPrefs.status        === 'fulfilled' ? guestPrefs.value        : [],
    low_stock:         lowStock.status          === 'fulfilled' ? lowStock.value          : [],
    master_history:    masterHistory.status     === 'fulfilled' ? masterHistory.value     : [],
    invoice_pattern:   invoicePattern.status    === 'fulfilled' ? invoicePattern.value    : [],
    location_aware:    locationAware.status     === 'fulfilled' ? locationAware.value     : [],
  };
}

export const SOURCE_META = {
  occasions:        { label: 'Occasions', icon: 'Cake', color: 'text-orange-500' },
  expiring_soon:    { label: 'Expiring Soon', icon: 'Clock', color: 'text-rose-500' },
  guest_preference: { label: 'Guest Preferences', icon: 'Users', color: 'text-purple-500' },
  low_stock:        { label: 'Low Stock', icon: 'AlertTriangle', color: 'text-amber-500' },
  invoice_pattern:  { label: 'Regular Order', icon: 'RefreshCw', color: 'text-blue-500' },
  location_aware:   { label: 'Location / Passage', icon: 'Map', color: 'text-green-500' },
  master_history:   { label: 'Regular Orders', icon: 'History', color: 'text-teal-500' },
};
