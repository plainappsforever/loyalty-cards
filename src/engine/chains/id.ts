import type { Chain } from '../chains';

export const ID: readonly Chain[] = [
  { id: 'id-indomaret', name: 'Indomaret', aliases: ['i.saku'], countries: ['ID'], color: '#0054a6', format: 'ean13' },
  { id: 'id-alfamart', name: 'Alfamart', aliases: ['Alfagift'], countries: ['ID'], color: '#e4002b', format: 'ean13' },
  { id: 'id-superindo', name: 'Super Indo', countries: ['ID'], color: '#e4002b', format: 'ean13' },
  { id: 'id-hypermart', name: 'Hypermart', countries: ['ID'], color: '#e4002b', format: 'ean13' },
  { id: 'id-guardian', name: 'Guardian', countries: ['ID', 'VN'], color: '#ff6a00', format: 'ean13' },
  { id: 'id-matahari', name: 'Matahari', countries: ['ID'], color: '#e4002b', format: 'code128' },
  { id: 'id-gramedia', name: 'Gramedia', countries: ['ID'], color: '#0054a6', format: 'code128' },
  { id: 'id-kopikenangan', name: 'Kopi Kenangan', countries: ['ID'], color: '#2c1a0e', format: 'qr' },
];
