// Countries and territories (ISO 3166-1 alpha-2, plus Kosovo) and other names people search by.
// Shared by the site (the searchable country pickers) and the server, which only accepts these.
const LIST = `AF Afghanistan
AX Åland Islands|Aland
AL Albania
DZ Algeria
AS American Samoa
AD Andorra
AO Angola
AI Anguilla
AQ Antarctica
AG Antigua and Barbuda
AR Argentina
AM Armenia
AW Aruba
AU Australia
AT Austria|Österreich
AZ Azerbaijan
BS Bahamas
BH Bahrain
BD Bangladesh
BB Barbados
BY Belarus
BE Belgium
BZ Belize
BJ Benin
BM Bermuda
BT Bhutan
BO Bolivia
BA Bosnia and Herzegovina|Bosnia, Herzegovina
BW Botswana
BV Bouvet Island
BR Brazil|Brasil
IO British Indian Ocean Territory|Chagos Islands
VG British Virgin Islands
BN Brunei
BG Bulgaria
BF Burkina Faso
BI Burundi
KH Cambodia
CM Cameroon
CA Canada
CV Cape Verde|Cabo Verde
BQ Caribbean Netherlands|Bonaire, Sint Eustatius, Saba
KY Cayman Islands
CF Central African Republic|CAR
TD Chad
CL Chile
CN China|PRC, People's Republic of China
CX Christmas Island
CC Cocos (Keeling) Islands|Cocos Islands, Keeling Islands
CO Colombia
KM Comoros
CK Cook Islands
CR Costa Rica
CI Côte d'Ivoire|Ivory Coast
HR Croatia|Hrvatska
CU Cuba
CW Curaçao
CY Cyprus
CZ Czechia|Czech Republic
CD Democratic Republic of the Congo|DRC, DR Congo, Congo-Kinshasa, Zaire
DK Denmark
DJ Djibouti
DM Dominica
DO Dominican Republic
EC Ecuador
EG Egypt
SV El Salvador
GQ Equatorial Guinea
ER Eritrea
EE Estonia
SZ Eswatini|Swaziland
ET Ethiopia
FK Falkland Islands|Malvinas
FO Faroe Islands
FJ Fiji
FI Finland|Suomi
FR France
GF French Guiana
PF French Polynesia|Tahiti
TF French Southern Territories
GA Gabon
GM Gambia
GE Georgia
DE Germany|Deutschland
GH Ghana
GI Gibraltar
GR Greece|Hellas
GL Greenland
GD Grenada
GP Guadeloupe
GU Guam
GT Guatemala
GG Guernsey
GN Guinea
GW Guinea-Bissau
GY Guyana
HT Haiti
HM Heard Island and McDonald Islands
HN Honduras
HK Hong Kong
HU Hungary
IS Iceland
IN India|Bharat
ID Indonesia
IR Iran|Persia
IQ Iraq
IE Ireland|Eire
IM Isle of Man
IL Israel
IT Italy|Italia
JM Jamaica
JP Japan
JE Jersey
JO Jordan
KZ Kazakhstan
KE Kenya
KI Kiribati
XK Kosovo
KW Kuwait
KG Kyrgyzstan
LA Laos|Lao
LV Latvia
LB Lebanon
LS Lesotho
LR Liberia
LY Libya
LI Liechtenstein
LT Lithuania
LU Luxembourg
MO Macao|Macau
MG Madagascar
MW Malawi
MY Malaysia
MV Maldives
ML Mali
MT Malta
MH Marshall Islands
MQ Martinique
MR Mauritania
MU Mauritius
YT Mayotte
MX Mexico|México
FM Micronesia|Federated States of Micronesia
MD Moldova
MC Monaco
MN Mongolia
ME Montenegro
MS Montserrat
MA Morocco
MZ Mozambique
MM Myanmar|Burma
NA Namibia
NR Nauru
NP Nepal
NL Netherlands|Holland, Nederland
NC New Caledonia
NZ New Zealand|Aotearoa
NI Nicaragua
NE Niger
NG Nigeria
NU Niue
NF Norfolk Island
KP North Korea|DPRK
MK North Macedonia|Macedonia
MP Northern Mariana Islands
NO Norway|Norge
OM Oman
PK Pakistan
PW Palau
PS Palestine|Palestinian Territories, State of Palestine, Gaza, West Bank
PA Panama
PG Papua New Guinea
PY Paraguay
PE Peru
PH Philippines
PN Pitcairn Islands
PL Poland|Polska
PT Portugal
PR Puerto Rico
QA Qatar
CG Republic of the Congo|Congo, Congo-Brazzaville
RE Réunion
RO Romania
RU Russia|Russian Federation
RW Rwanda
BL Saint Barthélemy|St Barthelemy, St Barts
SH Saint Helena|St Helena, Ascension, Tristan da Cunha
KN Saint Kitts and Nevis|St Kitts and Nevis
LC Saint Lucia|St Lucia
MF Saint Martin|St Martin
PM Saint Pierre and Miquelon|St Pierre and Miquelon
VC Saint Vincent and the Grenadines|St Vincent
WS Samoa
SM San Marino
ST São Tomé and Príncipe|Sao Tome
SA Saudi Arabia|KSA
SN Senegal
RS Serbia|Srbija
SC Seychelles
SL Sierra Leone
SG Singapore
SX Sint Maarten
SK Slovakia
SI Slovenia
SB Solomon Islands
SO Somalia|Somaliland
ZA South Africa|RSA
GS South Georgia and the South Sandwich Islands
KR South Korea|Korea, Republic of Korea
SS South Sudan
ES Spain|España
LK Sri Lanka|Ceylon
SD Sudan
SR Suriname
SJ Svalbard and Jan Mayen
SE Sweden|Sverige
CH Switzerland|Schweiz, Suisse, Svizzera
SY Syria
TW Taiwan
TJ Tajikistan
TZ Tanzania|Zanzibar
TH Thailand|Siam
TL Timor-Leste|East Timor
TG Togo
TK Tokelau
TO Tonga
TT Trinidad and Tobago
TN Tunisia
TR Türkiye|Turkey
TM Turkmenistan
TC Turks and Caicos Islands
TV Tuvalu
UG Uganda
UA Ukraine
AE United Arab Emirates|UAE, Emirates, Dubai, Abu Dhabi
GB United Kingdom|UK, Britain, Great Britain, England, Scotland, Wales, Northern Ireland
US United States|USA, US, America, United States of America
UM United States Minor Outlying Islands
VI United States Virgin Islands|US Virgin Islands
UY Uruguay
UZ Uzbekistan
VU Vanuatu
VA Vatican City|Holy See, Vatican
VE Venezuela
VN Vietnam|Viet Nam
WF Wallis and Futuna
EH Western Sahara|Sahrawi
YE Yemen
ZM Zambia
ZW Zimbabwe`;

// Accents, case, punctuation and spaces don't matter: "cote d ivoire" finds Côte d'Ivoire.
export const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const flat = (s) => s.replace(/ /g, '');

export const COUNTRIES = LIST.split('\n').map((line) => {
  const [head, alts = ''] = line.split('|');
  const code = head.slice(0, 2), name = head.slice(3);
  const keys = [name, ...alts.split(',')].map(norm).filter(Boolean);
  return { code, name, keys, flat: keys.map(flat), words: [...new Set(keys.join(' ').split(' '))] };
});
const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
const byKey = new Map();
COUNTRIES.forEach((c) => c.flat.forEach((k) => { if (!byKey.has(k)) byKey.set(k, c); }));

export const countryByCode = (code) => byCode.get(String(code || '').toUpperCase()) || null;
// An exact pick: a code ("KE"), a name or another name ("Ivory Coast"). Anything else is null.
export function findCountry(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  return (/^[A-Za-z]{2}$/.test(s) && countryByCode(s)) || byKey.get(flat(norm(s))) || null;
}
// Best matches first: the name starts with it, then a code or a word that does, then anywhere.
export function searchCountries(q) {
  const n = norm(q), f = flat(n);
  if (!n) return COUNTRIES;
  const scored = [];
  for (const c of COUNTRIES) {
    const s = c.keys[0].startsWith(n) ? 0 : c.code.toLowerCase() === n || c.keys.some((k) => k.startsWith(n)) ? 1
      : c.words.some((w) => w.startsWith(n)) ? 2 : c.flat.some((k) => k.includes(f)) ? 3 : -1;
    if (s >= 0) scored.push([s, c]);
  }
  return scored.sort((a, b) => a[0] - b[0]).map((x) => x[1]); // stable: alphabetical within a score
}
