// Maritime flag states for yacht registration, with the metadata that drives
// crew-contract standards. Landlocked registries are intentionally omitted.
//   mlc — flag is an MLC 2006 signatory (matters for COMMERCIAL vessels)
//   reg — Red Ensign Group (UK + Crown Dependencies + Overseas Territories);
//         applies the REG Yacht Code (MLC-aligned) even to private yachts
//   us  — United States: no MLC, runs under the Jones Act + US employment law
export const FLAG_STATES = [
  { name: 'Cayman Islands', mlc: true, reg: true },
  { name: 'Marshall Islands', mlc: true },
  { name: 'Malta', mlc: true },
  { name: 'Jersey', mlc: true, reg: true },
  { name: 'Guernsey', mlc: true, reg: true },
  { name: 'Isle of Man', mlc: true, reg: true },
  { name: 'Bermuda', mlc: true, reg: true },
  { name: 'British Virgin Islands', mlc: true, reg: true },
  { name: 'Gibraltar', mlc: true, reg: true },
  { name: 'United Kingdom', mlc: true, reg: true },
  { name: 'Madeira (Portugal)', mlc: true },
  { name: 'Netherlands', mlc: true },
  { name: 'Italy', mlc: true },
  { name: 'France', mlc: true },
  { name: 'Spain', mlc: true },
  { name: 'Monaco', mlc: true },
  { name: 'Antigua and Barbuda', mlc: true },
  { name: 'St Vincent and the Grenadines', mlc: true },
  { name: 'Bahamas', mlc: true },
  { name: 'Panama', mlc: true },
  { name: 'Liberia', mlc: true },
  { name: 'United States', mlc: false, us: true },
  { name: 'Australia', mlc: true },
  { name: 'Cook Islands', mlc: true },
];

export const FLAG_NAMES = FLAG_STATES.map((f) => f.name);

const flagMeta = (flag) => FLAG_STATES.find((f) => f.name === flag) || {};

// Derive the crew-contract standard from flag + commercial status:
//   • US flag        → Jones Act & US employment law
//   • Commercial     → MLC 2006 (MLC flag) else "[flag] national law"
//   • Private        → flag-state standards (REG flags note the MLC-aligned code)
export function crewContractStandard({ flag, commercialStatus, certifiedCommercial }) {
  if (!flag) return null;
  const meta = flagMeta(flag);
  const isCommercial = (!!commercialStatus && commercialStatus !== 'Private') || !!certifiedCommercial;
  if (meta.us) return 'Jones Act & US employment law';
  if (isCommercial) return meta.mlc ? 'MLC 2006' : `${flag} national law`;
  return meta.reg
    ? `Flag-state standards — ${flag} (REG Yacht Code, MLC-aligned)`
    : `Flag-state standards — ${flag}`;
}
