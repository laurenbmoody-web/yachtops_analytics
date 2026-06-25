// Canonical nationality (demonym) list — the single source of truth shared by
// the crew profile Personal Details dropdown and the passport document field,
// so a passport scan and the profile speak the same vocabulary (e.g. a UK
// passport reads as "British", never "United Kingdom").

export const NATIONALITIES = [
  'Afghan', 'Albanian', 'Algerian', 'American', 'Andorran', 'Angolan', 'Argentinian',
  'Armenian', 'Australian', 'Austrian', 'Azerbaijani', 'Bahamian', 'Bahraini',
  'Bangladeshi', 'Barbadian', 'Belarusian', 'Belgian', 'Belizean', 'Beninese',
  'Bhutanese', 'Bolivian', 'Bosnian', 'Brazilian', 'British', 'Bruneian', 'Bulgarian',
  'Burkinabe', 'Burmese', 'Burundian', 'Cambodian', 'Cameroonian', 'Canadian',
  'Cape Verdean', 'Central African', 'Chadian', 'Chilean', 'Chinese', 'Colombian',
  'Comoran', 'Congolese', 'Costa Rican', 'Croatian', 'Cuban', 'Cypriot', 'Czech',
  'Danish', 'Djiboutian', 'Dominican', 'Dutch', 'East Timorese', 'Ecuadorian',
  'Egyptian', 'Emirati', 'Equatorial Guinean', 'Eritrean', 'Estonian', 'Ethiopian',
  'Fijian', 'Filipino', 'Finnish', 'French', 'Gabonese', 'Gambian', 'Georgian',
  'German', 'Ghanaian', 'Greek', 'Grenadian', 'Guatemalan', 'Guinean', 'Guyanese',
  'Haitian', 'Honduran', 'Hungarian', 'Icelandic', 'Indian', 'Indonesian', 'Iranian',
  'Iraqi', 'Irish', 'Israeli', 'Italian', 'Ivorian', 'Jamaican', 'Japanese',
  'Jordanian', 'Kazakh', 'Kenyan', 'Kuwaiti', 'Kyrgyz', 'Laotian', 'Latvian',
  'Lebanese', 'Liberian', 'Libyan', 'Liechtensteiner', 'Lithuanian', 'Luxembourgish',
  'Macedonian', 'Malagasy', 'Malawian', 'Malaysian', 'Maldivian', 'Malian', 'Maltese',
  'Marshallese', 'Mauritanian', 'Mauritian', 'Mexican', 'Micronesian', 'Moldovan',
  'Monacan', 'Mongolian', 'Montenegrin', 'Moroccan', 'Mozambican', 'Namibian',
  'Nauruan', 'Nepalese', 'New Zealander', 'Nicaraguan', 'Nigerian', 'Nigerien',
  'North Korean', 'Norwegian', 'Omani', 'Pakistani', 'Palauan', 'Palestinian',
  'Panamanian', 'Papua New Guinean', 'Paraguayan', 'Peruvian', 'Polish', 'Portuguese',
  'Qatari', 'Romanian', 'Russian', 'Rwandan', 'Saint Lucian', 'Salvadoran', 'Samoan',
  'San Marinese', 'Sao Tomean', 'Saudi', 'Senegalese', 'Serbian', 'Seychellois',
  'Sierra Leonean', 'Singaporean', 'Slovak', 'Slovenian', 'Solomon Islander', 'Somali',
  'South African', 'South Korean', 'South Sudanese', 'Spanish', 'Sri Lankan', 'Sudanese',
  'Surinamese', 'Swazi', 'Swedish', 'Swiss', 'Syrian', 'Taiwanese', 'Tajik', 'Tanzanian',
  'Thai', 'Togolese', 'Tongan', 'Trinidadian', 'Tunisian', 'Turkish', 'Turkmen',
  'Tuvaluan', 'Ugandan', 'Ukrainian', 'Uruguayan', 'Uzbek', 'Vanuatuan', 'Venezuelan',
  'Vietnamese', 'Yemeni', 'Zambian', 'Zimbabwean',
];

// {value,label} shape for the profile's Select component.
export const nationalityOptions = NATIONALITIES.map((n) => ({ value: n, label: n }));
