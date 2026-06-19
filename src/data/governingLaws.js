// Governing-law options for vessel employment agreements (SEAs), ordered by how
// commonly they apply to yacht SEAs. England & Wales leads (Red Ensign Group
// flags sit under the British legal umbrella); flag-state laws follow.
export const GOVERNING_LAWS = [
  'England & Wales',
  'Scotland',
  'Cayman Islands law',
  'Isle of Man law',
  'Jersey law',
  'Guernsey law',
  'British Virgin Islands law',
  'Bermuda law',
  'Gibraltar law',
  'Marshall Islands (RMI) law',
  'Maltese law',
  'Monaco law',
  'Italian law',
  'French law',
  'Spanish law',
  'Netherlands law',
];

// Suggested governing law from the vessel's flag (editable, never locked):
//   • Red Ensign Group flags (UK + Crown Dependencies + Overseas Territories)
//     → England & Wales is the natural SEA governing law.
//   • Independent registries → their own (common-law-derived) law.
export const FLAG_TO_GOVERNING_LAW = {
  'United Kingdom': 'England & Wales',
  'Cayman Islands': 'England & Wales',
  'Isle of Man': 'England & Wales',
  'Jersey': 'England & Wales',
  'Guernsey': 'England & Wales',
  'British Virgin Islands': 'England & Wales',
  'Bermuda': 'England & Wales',
  'Gibraltar': 'England & Wales',
  'Marshall Islands': 'Marshall Islands (RMI) law',
  'Malta': 'Maltese law',
  'Monaco': 'Monaco law',
  'Italy': 'Italian law',
  'France': 'French law',
  'Spain': 'Spanish law',
  'Netherlands': 'Netherlands law',
};
