// Resolve a free-text travel location — "Nice (NCE)", "Palma (PMI)", or
// "Antibes, France" — to an ISO-2 country. Tries the IATA code in parentheses
// first, then a country name in the text. Returns null when it can't tell, so
// the day stays uncounted rather than guessed.

const IATA = {
  // United Kingdom
  LHR: 'GB', LGW: 'GB', LCY: 'GB', STN: 'GB', LTN: 'GB', MAN: 'GB', BHX: 'GB', BRS: 'GB', SOU: 'GB', EDI: 'GB', GLA: 'GB',
  // France
  NCE: 'FR', CDG: 'FR', ORY: 'FR', MRS: 'FR', TLN: 'FR', LYS: 'FR', BOD: 'FR', AJA: 'FR', BIA: 'FR',
  // Monaco
  MCM: 'MC',
  // Italy
  NAP: 'IT', FCO: 'IT', CIA: 'IT', MXP: 'IT', LIN: 'IT', BGY: 'IT', GOA: 'IT', VCE: 'IT', OLB: 'IT', PMO: 'IT', CAG: 'IT', AHO: 'IT', BRI: 'IT', FLR: 'IT', PSA: 'IT',
  // Spain
  PMI: 'ES', BCN: 'ES', IBZ: 'ES', MAH: 'ES', AGP: 'ES', MAD: 'ES', VLC: 'ES', ALC: 'ES',
  // Portugal
  LIS: 'PT', OPO: 'PT', FAO: 'PT', FNC: 'PT',
  // Greece
  ATH: 'GR', CFU: 'GR', JMK: 'GR', JTR: 'GR', RHO: 'GR', HER: 'GR', CHQ: 'GR', SKG: 'GR', KGS: 'GR', ZTH: 'GR',
  // Croatia / Montenegro / Turkey
  SPU: 'HR', DBV: 'HR', ZAG: 'HR', TIV: 'ME', IST: 'TR', SAW: 'TR', AYT: 'TR', BJV: 'TR', DLM: 'TR',
  // Malta / Cyprus / Gibraltar
  MLA: 'MT', LCA: 'CY', GIB: 'GI',
  // Northern Europe
  AMS: 'NL', FRA: 'DE', MUC: 'DE', DUS: 'DE', ZRH: 'CH', GVA: 'CH', VIE: 'AT', DUB: 'IE', CPH: 'DK', OSL: 'NO', ARN: 'SE', HEL: 'FI', BRU: 'BE',
  // Gulf
  DXB: 'AE', AUH: 'AE', DOH: 'QA',
  // USA
  MIA: 'US', FLL: 'US', JFK: 'US', EWR: 'US', LGA: 'US', LAX: 'US', SFO: 'US', BOS: 'US', PBI: 'US', TPA: 'US', SAV: 'US',
  // Caribbean
  SXM: 'SX', ANU: 'AG', SLU: 'LC', BGI: 'BB', PTP: 'GP', FDF: 'MQ', STT: 'VI', SJU: 'PR', NAS: 'BS', PLS: 'TC', AUA: 'AW',
};

const NAMES = {
  'united kingdom': 'GB', uk: 'GB', england: 'GB', scotland: 'GB', britain: 'GB',
  france: 'FR', monaco: 'MC', italy: 'IT', spain: 'ES', portugal: 'PT', greece: 'GR',
  croatia: 'HR', montenegro: 'ME', turkey: 'TR', 'türkiye': 'TR', malta: 'MT', cyprus: 'CY', gibraltar: 'GI',
  netherlands: 'NL', germany: 'DE', switzerland: 'CH', austria: 'AT', ireland: 'IE',
  belgium: 'BE', denmark: 'DK', norway: 'NO', sweden: 'SE', finland: 'FI',
  'united states': 'US', usa: 'US', america: 'US', 'united arab emirates': 'AE', uae: 'AE', qatar: 'QA',
  bahamas: 'BS', 'sint maarten': 'SX', 'st maarten': 'SX', antigua: 'AG', 'st lucia': 'LC', barbados: 'BB',
};

export const resolveCountry = (text) => {
  if (!text) return null;
  const t = String(text);
  const m = t.match(/\(([A-Za-z]{3})\)/);
  if (m) { const c = IATA[m[1].toUpperCase()]; if (c) return c; }
  const low = t.toLowerCase();
  for (const [name, iso] of Object.entries(NAMES)) { if (low.includes(name)) return iso; }
  return null;
};
