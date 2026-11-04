import type { Chain } from '../chains';

export const TR: readonly Chain[] = [
  { id: 'tr-migros', name: 'Migros Money', aliases: ['Migros (TR)'], countries: ['TR'], color: '#ff6a00', format: 'qr' },
  { id: 'tr-carrefoursa', name: 'CarrefourSA', countries: ['TR'], color: '#004e9f', format: 'ean13' },
  { id: 'tr-bim', name: 'BİM', aliases: ['BIM'], countries: ['TR'], color: '#e4002b', format: 'none' },
  { id: 'tr-a101', name: 'A101', countries: ['TR'], color: '#0054a6', format: 'qr' },
  { id: 'tr-sok', name: 'ŞOK', aliases: ['SOK'], countries: ['TR'], color: '#ffd200', format: 'qr' },
  { id: 'tr-gratis', name: 'Gratis', countries: ['TR'], color: '#e4007c', format: 'ean13' },
  { id: 'tr-watsons', name: 'Watsons', countries: ['TR', 'ID', 'VN'], color: '#00a19a', format: 'ean13' },
  { id: 'tr-opet', name: 'Opet', countries: ['TR'], color: '#e4002b', format: 'code128' },
  { id: 'tr-lcwaikiki', name: 'LC Waikiki', countries: ['TR', 'RU'], color: '#0054a6', format: 'code128' },
];
