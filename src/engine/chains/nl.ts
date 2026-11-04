import type { Chain } from '../chains';

export const NL: readonly Chain[] = [
  { id: 'nl-ah', name: 'Albert Heijn', aliases: ['AH', 'AH Bonuskaart'], countries: ['NL'], color: '#00ade6', format: 'ean13', numberLength: 13 },
  { id: 'nl-jumbo', name: 'Jumbo (NL)', aliases: ['Jumbo'], countries: ['NL'], color: '#ffd200', format: 'ean13' },
  { id: 'nl-plus', name: 'PLUS', countries: ['NL'], color: '#e4002b', format: 'ean13' },
  { id: 'nl-dirk', name: 'Dirk', countries: ['NL'], color: '#e4002b', format: 'ean13' },
  { id: 'nl-kruidvat', name: 'Kruidvat', countries: ['NL'], color: '#e4002b', format: 'ean13' },
  { id: 'nl-etos', name: 'Etos', countries: ['NL'], color: '#e4002b', format: 'ean13' },
  { id: 'nl-hema', name: 'HEMA', aliases: ['Meer HEMA'], countries: ['NL', 'DE', 'FR'], color: '#e4002b', format: 'ean13' },
  { id: 'nl-blokker', name: 'Blokker', countries: ['NL'], color: '#004b8d', format: 'ean13' },
  { id: 'nl-gamma', name: 'GAMMA', countries: ['NL'], color: '#0054a6', format: 'code128' },
  { id: 'nl-praxis', name: 'Praxis', countries: ['NL'], color: '#f26b21', format: 'code128' },
  { id: 'nl-bol', name: 'Bol', countries: ['NL'], color: '#0000a4', format: 'code128' },
  { id: 'nl-ns', name: 'NS', aliases: ['NS Flex'], countries: ['NL'], color: '#ffc917', format: 'aztec' },
  { id: 'nl-airmiles', name: 'Air Miles', countries: ['NL'], color: '#0054a6', format: 'ean13' },
];
