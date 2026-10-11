// What each App Store screenshot shows, and its caption. Order = store order.
export const DEVICES = {
  // iPhone 6.9" — 1320 × 2868
  iphone: { canvas: [1320, 2868], tileZoom: 170, context: { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  // iPad 13" — 2064 × 2752
  ipad: { canvas: [2064, 2752], tileZoom: 220, context: { viewport: { width: 1032, height: 1376 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
};

const CAPTAIN = 'dece0000-0000-4000-8000-000000000101';
const CHARTER_LIST = 'dece0000-0000-4000-8000-000000000301';

export const SHOTS = [
  { name: '1_dashboard', route: '/dashboard', scroll: { iphone: 430 },
    eyebrow: 'The whole boat', title: 'Run the boat,', em: 'from your pocket.' },
  { name: '2_jobs', route: '/team-jobs-management', offline: true,
    eyebrow: 'Works offline', title: 'At sea,', em: 'still working.' },
  { name: '3_hor', route: `/profile/${CAPTAIN}`, clicks: ['text=Hours of Rest (HOR)'], scroll: { iphone: 1900, ipad: 1300 },
    eyebrow: 'Hours of rest', title: 'Rest hours,', em: 'inspection-ready.' },
  { name: '4_defects', route: '/defects', scroll: { iphone: 1350 },
    eyebrow: 'Defects', title: 'Every defect,', em: 'tracked to fixed.' },
  { name: '5_laundry', route: '/laundry-management-dashboard',
    eyebrow: 'Laundry', title: 'From the wash,', em: 'to the wardrobe.' },
  { name: '6_inventory', route: '/inventory/location/Interior/Glassware',
    eyebrow: 'Inventory', title: 'Every glass,', em: 'accounted for.' },
  { name: '7_board', route: `/provisioning/${CHARTER_LIST}`, scroll: { iphone: 420 },
    eyebrow: 'Provisioning', title: 'Order it,', em: 'receive it.' },
];
