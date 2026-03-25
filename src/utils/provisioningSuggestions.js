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

// ── Query 1: Guest Preferences ────────────────────────────────────────────────

const FOOD_PREFERENCE_CATEGORIES = [
  'Food & Beverage', 'Dietary', 'Wine/Spirits', 'Allergies', 'Galley',
];

async function getGuestPreferenceSuggestions(tripId, vesselId) {
  try {
    // Get all guest IDs on this trip
    const stored = localStorage.getItem('cargo.trips.v1');
    const trips = stored ? JSON.parse(stored) : [];
    const trip = trips.find(t => t.id === tripId);
    if (!trip?.guests?.length) return [];

    const guestIds = trip.guests.filter(g => g.isActive !== false).map(g => g.guestId).filter(Boolean);
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
      // Add allergen suggestions
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

    (prefs || []).forEach(pref => {
      const guest = guestMap[pref.guest_id];
      if (!guest) return;
      const name = `${guest.first_name} ${guest.last_name}`;
      const item = pref.value || pref.key;
      if (!item) return;
      suggestions.push({
        id: `pref_${pref.guest_id}_${pref.key}_${Math.random().toString(36).slice(2)}`,
        name: item,
        category: pref.category === 'Dietary' ? 'Dry Goods' : 'Beverages',
        department: 'Galley',
        source: 'guest_preference',
        reason: `${name} ${pref.pref_type === 'requirement' ? 'requires' : 'prefers'}: ${pref.key || item}`,
        priority: pref.pref_type === 'requirement' ? 'high' : 'normal',
        quantity_ordered: 1,
        unit: 'each',
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
    const stored = localStorage.getItem('cargo.trips.v1');
    const trips = stored ? JSON.parse(stored) : [];
    const trip = trips.find(t => t.id === tripId);
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

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Fetch smart provisioning suggestions for a given trip + vessel.
 * Returns suggestions grouped by source.
 *
 * @param {string} tripId
 * @param {string} vesselId   — maps to tenant_id in this codebase
 * @returns {Promise<Object>} { guest_preference, low_stock, invoice_pattern, location_aware }
 */
export async function getSmartSuggestions(tripId, vesselId) {
  const [guestPrefs, lowStock, invoicePattern, locationAware] = await Promise.allSettled([
    tripId ? getGuestPreferenceSuggestions(tripId, vesselId) : Promise.resolve([]),
    getLowStockSuggestions(vesselId),
    getInvoicePatternSuggestions(vesselId),
    tripId ? getLocationAwareSuggestions(tripId) : Promise.resolve([]),
  ]);

  return {
    guest_preference: guestPrefs.status === 'fulfilled' ? guestPrefs.value : [],
    low_stock: lowStock.status === 'fulfilled' ? lowStock.value : [],
    invoice_pattern: invoicePattern.status === 'fulfilled' ? invoicePattern.value : [],
    location_aware: locationAware.status === 'fulfilled' ? locationAware.value : [],
  };
}

export const SOURCE_META = {
  guest_preference: { label: 'Guest Preferences', icon: 'Users', color: 'text-purple-500' },
  low_stock: { label: 'Low Stock', icon: 'AlertTriangle', color: 'text-amber-500' },
  invoice_pattern: { label: 'Regular Order', icon: 'RefreshCw', color: 'text-blue-500' },
  location_aware: { label: 'Location / Passage', icon: 'Map', color: 'text-green-500' },
};
