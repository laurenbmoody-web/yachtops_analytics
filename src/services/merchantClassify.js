// Cargo Accounts — merchant intelligence for the live bank feed (Enable Banking).
//
// The bank feed hands us only two things per line: a `payee` (the counterparty
// name — Enable Banking's `creditor.name`/`debtor.name`) and a free-text
// `description` (the remittance information). There is NO bank-provided category
// to lean on — unlike Plaid, Enable Banking does not classify. So the yachting
// category has to be inferred here, from the merchant and the words on the line.
//
// Three deterministic tiers, weakest signal last (a caller layers the learned
// per-merchant map on top — see financeService — as the strongest tier):
//
//   B · MERCHANT SEED  — a starter dictionary of well-known marine/yachting
//                        vendors → MYBA line, matched on the normalised payee, so
//                        a cold feed still gets sensible guesses on day one.
//   C · DESCRIPTION    — mine the remittance text for product words (DIESEL,
//                        PROVISIONS, BERTH…) via the existing spend classifier.
//
// Everything routes onto the real STANDARD_CHART_OF_ACCOUNTS codes — never an
// invented category — so a suggestion always lands on a line a budget already has.
// Deterministic and explainable on purpose: money should never be filed by a
// black box, and every suggestion carries a human-readable `reason`.

import { classifySpend } from './budgetClassify.js';
import { STANDARD_CHART_OF_ACCOUNTS } from '../pages/accounts/budgets/data/mybaChartOfAccounts.js';

// code -> { bucket, category, code } resolver, built from the canonical chart so
// the seed table below can reference lines by their 3-letter code alone.
const LINE = STANDARD_CHART_OF_ACCOUNTS.reduce((m, l) => {
  m[l.code] = { bucket: l.bucket, category: l.category, code: l.code };
  return m;
}, {});

const line = (code) => LINE[code] || null;

// ── Merchant name normalisation ──────────────────────────────────────────────
// Strip the noise that varies between charges for the SAME vendor — legal
// suffixes, a trailing city/branch, card-scheme artefacts, punctuation — so
// "MED PROVISIONS SARL ANTIBES" and "Med Provisions S.A.R.L." collapse to one key
// that the seed dictionary and the learned map can both match and remember.
const LEGAL_SUFFIX = /\b(?:s\.?a\.?r\.?l|s\.?a\.?s|s\.?a|s\.?l|s\.?r\.?l|b\.?v|n\.?v|gmbh|ag|ltd|limited|llc|inc|co|company|plc|spa|srl|oy|ab|as|pte|pty|sarl|sas)\b/g;
const CARD_NOISE = /\b(?:card|carte|visa|mastercard|maestro|paypal|pos|sepa|dd|direct\s*debit|payment|pmt|ref|txn|purchase|contactless|gbr|fra|esp|ita|nld|deu)\b/g;

export const normalizeMerchant = (payee) => {
  let s = String(payee ?? '').toLowerCase();
  s = s.replace(/[.''`´]/g, '');                        // drop dots/apostrophes FIRST: s.a.r.l → sarl
  s = s.replace(/[*#/\\|@,;:"“”«»()\[\]{}&+_–—-]/g, ' '); // other separators → space (keep accented letters)
  s = s.replace(/\b\d{2,}\b/g, ' ');                    // long digit runs (dates, card frags, refs)
  s = s.replace(LEGAL_SUFFIX, ' ');                     // now catches the collapsed "sarl", "gmbh", …
  s = s.replace(CARD_NOISE, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
};

// ── B · Merchant seed dictionary ─────────────────────────────────────────────
// Each entry: a matcher (regex, tested against the normalised payee), the target
// MYBA code, a confidence, and a short reason. HIGH is reserved for vendors whose
// trade is unambiguous for a yacht (a bunker major only ever sells fuel); LOW
// flags the genuinely two-sided ones (a supermarket could be guest or crew food,
// an airline could be guest or crew travel) so a human confirms the split.
const MERCHANT_SEED = [
  // Fuel & bunkers — a bunker supplier only sells one thing.
  { re: /\b(total\s*marine|totalenergies|shell|esso|exxon|bp\b|repsol|cepsa|q8|eni\b|dan\s*bunkering|world\s*fuel|peninsula\s*petroleum|bomin|bunker|marine\s*fuel|petrol|station\s*service)\b/, code: 'FLE', confidence: 'high', reason: 'known fuel / bunker supplier' },

  // Insurance — marine underwriters/brokers.
  { re: /\b(pantaenius|allianz|generali|axa|willis|marsh|gard|mecwacare|yacht\s*insurance|assurance|versicherung)\b/, code: 'INS', confidence: 'high', reason: 'marine insurer / broker' },

  // Class & certification societies.
  { re: /\b(lloyd\w*\s*register|bureau\s*veritas|dnv|rina|american\s*bureau|abs\s*class)\b/, code: 'CRT', confidence: 'high', reason: 'classification society' },

  // Yacht transport / freight / logistics.
  { re: /\b(peters\s*(?:&|and)?\s*may|sevenstar|dockwise|dyt|yacht\s*transport|kuehne|dhl|fedex|ups\b|freight|schenker)\b/, code: 'FRG', confidence: 'high', reason: 'freight / yacht transport' },

  // Satellite AIRTIME — a monthly bill for bandwidth, not a box. Sits above the
  // electronics rule because the airtime houses are matched by name.
  { re: /\b(kvh|inmarsat|starlink|iridium|thuraya|speedcast|marlink|navarino|satcom)\b/, code: 'SAT', confidence: 'high', reason: 'satellite airtime provider' },

  // Navigation electronics — the hardware itself.
  { re: /\b(raymarine|furuno|garmin|navionics|simrad|b\s*&\s*g)\b/, code: 'NAV', confidence: 'high', reason: 'navigation equipment' },

  // Charts & nautical publications.
  { re: /\b(admiralty|ukho|imray|witherby|nautical\s*publi|chart\s*(?:agent|correction))\b/, code: 'CHP', confidence: 'high', reason: 'charts / nautical publications' },

  // Life-saving & fire fighting.
  { re: /\b(viking\s*life|survitec|zodiac|liferaft|life\s*raft|fire\s*fighting|extinguisher)\b/, code: 'LSF', confidence: 'high', reason: 'life-saving / fire equipment' },

  // Marinas — a berth booked from an operator, which is a contract, not a due.
  { re: /\b(marina|port\s*vauban|yacht\s*harbou?r|igy|ocean\s*village|puerto|porto\s*(?:mont|cervo)|quay|berth(?:ing|s)?)\b/, code: 'BRT', confidence: 'high', reason: 'marina / berthing' },

  // The port authority itself — dues, not a berth.
  { re: /\b(capitainerie|harbou?r\s*(?:master|dues|authority)|port\s*(?:authority|dues)|dock\s*dues)\b/, code: 'HAR', confidence: 'high', reason: 'harbour dues' },

  // Pilotage & towage, canal transit, customs — the rest of a port call.
  { re: /\b(pilotage|pilot\s*station|towage|tug\b|remorqu)\b/, code: 'PIL', confidence: 'high', reason: 'pilotage / towage' },
  { re: /\b(canal\s*(?:de\s*)?(?:panama|suez|corinth|transit)|panama\s*canal|suez\s*canal|waterway\s*transit)\b/, code: 'CNL', confidence: 'high', reason: 'canal / waterway transit' },
  { re: /\b(douane|customs|clearance|immigration|aduana|zoll)\b/, code: 'CUS', confidence: 'high', reason: 'customs / clearance' },

  // Waste, sludge and pump-out contractors.
  { re: /\b(waste|garbage|d[ée]chets|sludge|slops?|pump\s*out|recycling|sanitation\s*service)\b/, code: 'WST', confidence: 'high', reason: 'waste / sludge disposal' },

  // Chandlers & deck suppliers.
  { re: /\b(chandler\w*|west\s*marine|marinepool|marlow|ropes?|svb|nautic\w*|deck\s*)\b/, code: 'DCN', confidence: 'high', reason: 'chandlery / deck supplier' },

  // Engineering suppliers — engines, hydraulics, electrical trade houses.
  { re: /\b(mtu|caterpillar|cat\s*marine|volvo\s*penta|wartsila|man\s*energy|rexroth|technische\s*unie|hydraulic|marine\s*engineer)\b/, code: 'ECN', confidence: 'high', reason: 'engineering / machinery supplier' },

  // Wine & spirits merchants → guest wine stock.
  { re: /\b(nicolas|oddbins|millesima|majestic\s*wine|berry\s*bros|cave\s*de|vin\w*|winery|wine\s*merchant)\b/, code: 'GWS', confidence: 'high', reason: 'wine / spirits merchant' },

  // Florists → guest flowers.
  { re: /\b(fleuriste|monceau\s*fleurs|interflora|florist|flower)\b/, code: 'FLO', confidence: 'high', reason: 'florist' },

  // Uniform / workwear.
  { re: /\b(uniform|workwear|crewsaver|musto|helly\s*hansen|slam\b)\b/, code: 'CUF', confidence: 'high', reason: 'crew uniform / workwear' },

  // Yacht agents.
  { re: /\b(yacht\s*agent|ship\s*agent|agence\s*maritime|catalano|baia\s*yacht)\b/, code: 'AGT', confidence: 'high', reason: 'yacht agent' },

  // Telecoms → communication expenses.
  { re: /\b(vodafone|orange|telecom|telefonica|movistar|o2\b|ee\b|sfr\b|bouygues)\b/, code: 'COM', confidence: 'high', reason: 'telecom provider' },

  // Streaming / AV subscriptions → audiovisual & entertainment.
  { re: /\b(netflix|spotify|disney\s*plus|apple\.com\/bill|itunes|sky\b)\b/, code: 'AUD', confidence: 'high', reason: 'AV / entertainment subscription' },

  // Business software & IT — distinct from the guest-facing AV subscriptions above.
  { re: /\b(microsoft|office\s*365|adobe|dropbox|google\s*(?:workspace|cloud)|xero|quickbooks|sage\b|slack\s*technolog|zoom\s*video|1password|godaddy|atlassian)\b/, code: 'ITS', confidence: 'high', reason: 'software / IT subscription' },

  // Antifoul & hull coatings — a yard job, above the general paint rule because the
  // same supplier sells both and the word decides which.
  { re: /\b(antifoul\w*|anti\s*fouling|hull\s*coating|propspeed|coppercoat)\b/, code: 'AFL', confidence: 'high', reason: 'antifoul / hull coating' },

  // Paint & varnish houses.
  { re: /\b(awlgrip|awlcraft|international\s*paint|jotun|hempel|boero|akzo\s*nobel|alexseal|varnish|peinture)\b/, code: 'DPT', confidence: 'high', reason: 'paint / varnish supplier' },

  // Yards, dry dock and hull work.
  { re: /\b(shipyard|chantier\s*naval|astillero|cantiere|dry\s*dock|drydock|travelift|haul\s*out|slipway)\b/, code: 'DDK', confidence: 'high', reason: 'shipyard / dry dock' },

  // Laundry & dry cleaning houses.
  { re: /\b(blanchisserie|pressing|laundr(?:y|ette)|dry\s*clean\w*|lavander|wash\s*(?:house|club))\b/, code: 'ILA', confidence: 'high', reason: 'laundry / dry cleaning' },

  // Registry, flag state and the corporate side.
  { re: /\b(ship\s*registr\w*|yacht\s*registr\w*|flag\s*state|red\s*ensign|maritime\s*authority|marshall\s*islands|cayman\s*(?:registry|maritime))\b/, code: 'REG', confidence: 'high', reason: 'registry / flag state' },
  { re: /\b(avocat|notaire|solicitor\w*|law\s*(?:firm|office)|legal\s*services|abogado|rechtsanwalt)\b/, code: 'LEG', confidence: 'high', reason: 'legal / professional' },
  { re: /\b(expert\s*comptable|comptab\w*|accountant\w*|accounting|bookkeep\w*)\b/, code: 'ACC', confidence: 'high', reason: 'accountancy / bookkeeping' },

  // Crew agencies & maritime schools — the two ends of a crew hire.
  { re: /\b(crew\s*(?:agency|agencies|recruit\w*|placement)|recruitment\s*agency|ypi\s*crew|wilsonhalligan|viking\s*crew)\b/, code: 'CRE', confidence: 'high', reason: 'crew agency / recruitment' },
  { re: /\b(stcw|maritime\s*(?:academy|training|school)|training\s*(?:centre|center)|sea\s*school|deckhand\s*course)\b/, code: 'CTR', confidence: 'high', reason: 'crew training / certification' },

  // Tenders, toys and dive kit.
  { re: /\b(seabob|jet\s*ski|jetski|waverunner|sea\s*doo|cayago)\b/, code: 'TJS', confidence: 'high', reason: 'jet ski / seabob' },
  { re: /\b(scuba|dive\s*(?:centre|center|shop|store)|diving\s*(?:centre|center|equipment)|aqualung|bauer\s*komp)\b/, code: 'TDV', confidence: 'high', reason: 'diving equipment' },
  { re: /\b(paddle\s*board|water\s*toys?|inflatable\w*|funair|nautibuoy|sea\s*pool)\b/, code: 'TOY', confidence: 'high', reason: 'water toys' },
  // NB: no `zodiac` here — the life-saving rule above claims it, which is the
  // right call when the two trades share a name and one of them is safety gear.
  { re: /\b(williams\s*jet|castoldi|novurania|outboard|tender\s*(?:service|refit))\b/, code: 'TRM', confidence: 'high', reason: 'tender builder / servicing' },

  // ── Two-sided vendors: real match, but who benefits is genuinely ambiguous ─
  // We do NOT pre-commit a guess for these — the resolver returns both plausible
  // lines as a choice so a human picks the side (guest vs crew). `alts` = the two
  // candidate codes, most-likely first.
  // Supermarkets / provisioners: guest food or crew food?
  { re: /\b(carrefour|mercadona|metro\b|transgourmet|grand\s*frais|monoprix|lidl|aldi|coop\b|migros|supermarch|provision|grocer|deli\b)\b/, alts: ['GFE', 'CFC'], reason: 'provisioner — guest or crew food?' },

  // Airlines: crew travel or guest travel?
  { re: /\b(ryanair|easyjet|air\s*france|klm|lufthansa|emirates|british\s*airways|iberia|vueling|wizz|swiss\s*air|airlines?)\b/, alts: ['CTE', 'GCT'], reason: 'airline — crew or guest travel?' },

  // Department stores sell food AND clothing — M&S is the classic case, so the line
  // could be provisions or crew uniform. Ask rather than guess.
  { re: /\b(marks\s*(?:and\s*)?spencer|\bm\s+s\b|john\s*lewis|primark|next\s*retail|debenhams|uniqlo|h\s*m\b|zara)\b/, alts: ['GFE', 'CUF'], reason: 'department store — provisions or uniform?' },

  // Car hire / taxi / transport: ship transport or guest car hire?
  { re: /\b(uber|taxi|hertz|avis|europcar|sixt|enterprise\s*rent|car\s*hire|rental)\b/, alts: ['CAR', 'GCT'], reason: 'transport — ship or guest?' },

  // A pharmacy run is either topping up the ship's medical locker or one crew
  // member's prescription — and those are different lines to an owner.
  { re: /\b(pharmac\w*|apotheke|farmacia|chemist|drugstore|medical\s*suppl\w*)\b/, alts: ['MED', 'CMD'], reason: 'pharmacy — ship stores or crew medical?' },

  // The big brokerage houses both sell charters and manage boats, so their invoice
  // is either commission on a charter or the monthly management fee.
  { re: /\b(burgess|edmiston|fraser\s*yacht\w*|camper\s*(?:&|and)?\s*nicholson\w*|ocean\s*independence|northrop\s*(?:&|and)?\s*johnson|yachting\s*partners)\b/, alts: ['CBC', 'MGE'], reason: 'brokerage — charter commission or management fee?' },
];

// Returns { kind: 'single', suggestion } for an unambiguous vendor, or
// { kind: 'choice', options: [lineA, lineB], reason } for a two-sided one, else null.
const matchMerchantSeed = (norm) => {
  for (const s of MERCHANT_SEED) {
    if (!s.re.test(norm)) continue;
    if (s.alts) {
      const options = s.alts.map(line).filter(Boolean);
      if (options.length === 2) return { kind: 'choice', options, reason: s.reason };
    } else {
      const l = line(s.code);
      if (l) return { kind: 'single', suggestion: { ...l, confidence: 'high', reason: s.reason, source: 'merchant' } };
    }
  }
  return null;
};

// ── C · Description keyword pass ──────────────────────────────────────────────
// Reuse the provisioning spend classifier by feeding it the remittance text as
// the `category` signal — it already knows the product vocabulary (fuel, produce,
// wine, cleaning, flowers) and returns a line + confidence. Guard that whatever it
// returns is a real chart line before trusting it.
const matchDescription = (description, department) => {
  const s = classifySpend({ category: description, department });
  if (s && line(s.code)) {
    return { ...line(s.code), confidence: s.confidence, reason: `text: ${s.reason}`, source: 'description' };
  }
  return null;
};

// ── Public: seed/description suggestion for one bank-feed transaction ──────────
// Deterministic tiers B → C. Returns one of:
//   { kind: 'single', suggestion }  — a confident, unambiguous line
//   { kind: 'choice', options, reason } — a two-sided vendor: pick guest vs crew
//   { kind: 'none' } — nothing confident (line stays in the review queue)
// The learned per-merchant map is layered on top by resolveSuggestion below.
export const suggest = ({ payee, description, department } = {}) => {
  const norm = normalizeMerchant(payee);
  if (norm) {
    const seed = matchMerchantSeed(norm);
    if (seed) return seed;
  }
  const desc = matchDescription(description, department);
  if (desc) return { kind: 'single', suggestion: desc };
  return { kind: 'none' };
};

// ── Public: full resolve with the learned map ─────────────────────────────────
// `rules` is a Map of normalised merchant_key -> { bucket, category, code } (built
// from ledger_merchant_rules). Behaviour by vendor type:
//   • Two-sided vendor (airline, supermarket, taxi) → ALWAYS a 'choice', even once
//     filed before. A prior choice is remembered only as `preferred` (the side to
//     pre-highlight) — we still ask, because these genuinely go both ways.
//   • Unambiguous vendor, or any merchant Command has filed before → 'single',
//     auto-suggested at high confidence (a learned rule is authoritative).
// Always carries `merchantKey` so the caller can learn/backfill from the raw payee.
export const resolveSuggestion = (txn = {}, rules) => {
  const merchantKey = normalizeMerchant(txn.payee) || null;
  const learned = merchantKey && rules
    ? (typeof rules.get === 'function' ? rules.get(merchantKey) : rules[merchantKey])
    : null;
  const base = suggest(txn);

  if (base.kind === 'choice') {
    return { kind: 'choice', merchantKey, options: base.options, reason: base.reason,
      preferred: learned ? learned.category : null };
  }
  if (learned) {
    return { kind: 'single', merchantKey,
      suggestion: { bucket: learned.bucket, category: learned.category, code: learned.code || null,
        confidence: 'high', reason: 'learned — filed here before', source: 'learned' } };
  }
  if (base.kind === 'single') return { kind: 'single', merchantKey, suggestion: base.suggestion };
  return { kind: 'none', merchantKey };
};
