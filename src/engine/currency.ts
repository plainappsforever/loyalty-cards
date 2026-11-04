// Currency codes we store and export (SPEC §4.2 "ISO 4217 or '' = points"; review M5). Catima parses `balancetype` with
// java.util.Currency.getInstance and aborts the WHOLE import on an unknown code (CatimaImporter.java line 443 at
// 07b385d), so only codes Java/Android know may leave the app. List: ISO 4217 List One (active, 2026) plus recently
// withdrawn codes ICU still lists (ANG, BGN, CUC, HRK, SLL, ZWL). Test: every code is in Node's ICU 78
// Intl.supportedValuesOf('currency') — Android's Currency is ICU-backed. Older codes (DEM, FRF, …) import as a note.
const ACTIVE =
  'AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XOF XCG XPF YER ZAR ZMW ZWG';
const WITHDRAWN = 'ANG BGN CUC HRK SLL ZWL';

export const ISO_4217: readonly string[] = [...ACTIVE.split(' '), ...WITHDRAWN.split(' ')];
const SET = new Set(ISO_4217);

export function isCurrencyCode(code: string): boolean {
  return SET.has(code);
}
