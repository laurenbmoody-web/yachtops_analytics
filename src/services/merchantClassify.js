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

  // Satellite comms & navigation electronics (marine-specific).
  { re: /\b(kvh|inmarsat|starlink|iridium|thuraya|raymarine|furuno|garmin|navionics|simrad|b\s*&\s*g)\b/, code: 'NAV', confidence: 'high', reason: 'navigation / satcom equipment' },

  // Life-saving & fire fighting.
  { re: /\b(viking\s*life|survitec|zodiac|liferaft|life\s*raft|fire\s*fighting|extinguisher)\b/, code: 'LSF', confidence: 'high', reason: 'life-saving / fire equipment' },

  // Marinas, ports, harbour dues — berthing.
  { re: /\b(marina|port\s*vauban|capitainerie|yacht\s*harbou?r|igy|ocean\s*village|puerto|porto\s*(?:mont|cervo)|harbou?r\s*(?:master|dues)|quay|dock\s*dues)\b/, code: 'HAR', confidence: 'high', reason: 'marina / harbour dues' },

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

  // ── Two-sided vendors: real match, but who benefits is genuinely ambiguous ─
  // We do NOT pre-commit a guess for these — the resolver returns both plausible
  // lines as a choice so a human picks the side (guest vs crew). `alts` = the two
  // candidate codes, most-likely first.
  // Supermarkets / provisioners: guest food or crew food?
  { re: /\b(carrefour|mercadona|metro\b|transgourmet|grand\s*frais|monoprix|lidl|aldi|coop\b|migros|supermarch|provision|grocer|deli\b)\b/, alts: ['GFE', 'CFC'], reason: 'provisioner — guest or crew food?' },

  // Airlines: crew travel or guest travel?
  { re: /\b(ryanair|easyjet|air\s*france|klm|lufthansa|emirates|british\s*airways|iberia|vueling|wizz|swiss\s*air|airlines?)\b/, alts: ['CTE', 'GCT'], reason: 'airline — crew or guest travel?' },

  // Car hire / taxi / transport: ship transport or guest car hire?
  { re: /\b(uber|taxi|hertz|avis|europcar|sixt|enterprise\s*rent|car\s*hire|rental)\b/, alts: ['CAR', 'GCT'], reason: 'transport — ship or guest?' },
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
