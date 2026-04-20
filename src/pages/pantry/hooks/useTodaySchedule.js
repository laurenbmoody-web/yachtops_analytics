import { useMemo } from 'react';

// v1: returns mock schedule data. Real integration reads from trips/itinerary tables.
const MOCK_EVENTS = [
  { id: 1, time: '07:30', title: 'Continental breakfast set on aft deck.',      sub: 'All guests · weather permitting' },
  { id: 2, time: '09:00', title: 'Anna and Robert depart for Palma Marina spa.', sub: 'Tender booked · 09:00 departure' },
  { id: 3, time: '11:00', title: 'Susan requests a late cappuccino and brioche.', sub: 'Owner's deck · starboard' },
  { id: 4, time: '13:00', title: 'Casual lunch for four on the sundeck.',        sub: 'Chef confirmed · cold starters' },
  { id: 5, time: '14:30', title: 'Anna returns from spa.',                        sub: 'Tender pickup from marina' },
  { id: 6, time: '16:00', title: 'Pre-dinner drinks — cockpit bar.',              sub: 'Champagne + canapés · 4 pax' },
  { id: 7, time: '19:30', title: 'Formal dinner — main saloon.',                  sub: 'Set for 4 · chef's tasting menu' },
  { id: 8, time: '22:00', title: 'Nightcaps in the sky lounge.',                  sub: 'Spirits trolley + cheeseboard' },
];

export function useTodaySchedule() {
  const now = new Date();

  const events = useMemo(() => {
    return MOCK_EVENTS.map(ev => {
      const [h, m] = ev.time.split(':').map(Number);
      const evDate = new Date(now);
      evDate.setHours(h, m, 0, 0);
      return { ...ev, isPast: evDate < now };
    });
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return { events };
}
