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
  { name: '1_dashboard', route: '/dashboard', scroll: { iphone: 600 },
    eyebrow: 'The whole boat', title: 'Run the boat,', em: 'from your pocket.' },
  { name: '2_jobs', route: '/team-jobs-management', offline: true, reveal: 'My jobs',
    eyebrow: 'Works offline', title: 'At sea,', em: 'still working.' },
  { name: '3_hor', route: `/profile/${CAPTAIN}`, clicks: ['text=Hours of Rest (HOR)'], scroll: { iphone: 1900, ipad: 1300 },
    eyebrow: 'Hours of rest', title: 'Rest hours,', em: 'inspection-ready.' },
  { name: '4_defects', route: '/defects', scroll: { iphone: 1650 },
    eyebrow: 'Defects', title: 'Every defect,', em: 'tracked to fixed.' },
  { name: '5_laundry', route: '/laundry-management-dashboard', scroll: { iphone: 560 },
    eyebrow: 'Laundry', title: 'From the wash,', em: 'to the wardrobe.' },
  { name: '6_inventory', route: '/inventory/location/Interior/Glassware', clicks: ['button[title="Grid view"]'],
    eyebrow: 'Inventory', title: 'Every glass,', em: 'accounted for.' },
  { name: '7_board', route: `/provisioning/${CHARTER_LIST}`, scroll: { iphone: 420 },
    eyebrow: 'Provisioning', title: 'Order it,', em: 'receive it.' },
  { name: '8_cabins', route: '/crew-management', clicks: ['button.cm-view:has-text("Movements")', 'button:has-text("Cabins")'],
    eyebrow: 'Crew & cabins', title: 'Every berth,', em: 'allocated.' },
  { name: '9_profile', route: `/profile/${CAPTAIN}`,
    eyebrow: 'Crew profiles', title: 'Your crew,', em: 'in one place.' },
  { name: '10_rota', route: '/crew',
    eyebrow: 'Rota', title: 'Watches set,', em: 'rest protected.' },
  { name: '11_locations', route: '/locations-settings',
    eyebrow: 'Vessel locations', title: 'Every deck,', em: 'mapped.' },
  { name: '12_dutysets', route: '/duty-sets-rotation-management', clicks: ['button.dsr-tool', '.dsr-menu .dsr-menuitem:has-text("Interior")', '.dsr-tab:has-text("Rotation calendar")'],
    eyebrow: 'Duty sets', title: 'Who does what,', em: 'every day.' },
];

// Clean, unframed screens for the "One day. All connected." product film —
// one jacket (Musto Sardinia 2.0, True Navy) followed from job to sign-ashore.
const UNIFORM_ORDER = 'dece0000-0000-4000-8000-000000000303';
export const FILM_SHOTS = [
  { name: '01_jobs', route: '/team-jobs-management', reveal: 'My jobs' },
  { name: '02_job_open', route: '/team-jobs-management', reveal: 'My jobs', clicks: ['text=Receive crew uniforms'] },
  { name: '03_order', route: `/provisioning/${UNIFORM_ORDER}` },
  { name: '04_receive', route: `/provisioning/${UNIFORM_ORDER}`, clicks: ['button:has-text("Receive Items")'] },
  { name: '05_packing_import', route: '/inventory/location/Interior/Uniforms', clicks: ['button[title^="Add items by photo"]'] },
  { name: '06_inventory', route: '/inventory/location/Interior/Uniforms', clicks: ['button[title="Grid view"]'] },
  { name: '07_laundry', route: '/laundry-management-dashboard', scroll: { iphone: 560 } },
  { name: '08_laundry_item', route: '/laundry-management-dashboard', scroll: { iphone: 560 }, clicks: ['text=Musto Sardinia 2.0 Jacket — True Navy'] },
  { name: '09_report_defect', route: '/defects', clicks: ['button:has-text("Report defect")'] },
  { name: '10_defect_saved', route: '/defects', clicks: ['text=Split seam'] },
  { name: '11_sign_ashore', route: '/sign-in-board' },
  // Tap James ashore for the end frame, then tap him back aboard.
  { name: '12_signed_ashore', route: '/sign-in-board', clicks: ['.sib-card:has-text("James Whitfield")'] },
  { name: '13_restore_aboard', route: '/sign-in-board', clicks: ['.sib-card.ashore:has-text("James Whitfield")'] },
];

// The white Cargo wordmark used on the framed images (navy artwork, whitened).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const logoPath = process.env.LOGO || fileURLToPath(new URL('../../public/cargo-wordmark.png', import.meta.url));
export const LOGO = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`;
