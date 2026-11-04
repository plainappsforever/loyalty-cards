import type { Chain } from '../chains';

// Austria (jö Bonus Club covers BILLA, BIPA, PENNY, Libro, Pagro …; cards carry EAN-13).
export const AT: readonly Chain[] = [
  { id: 'at-joe', name: 'jö Bonus Club', aliases: ['joe', 'jo Bonus Club'], countries: ['AT'], color: '#ffd400', format: 'ean13', numberLength: 13 },
  { id: 'at-billa', name: 'BILLA', aliases: ['BILLA Plus'], countries: ['AT'], color: '#ffe500', format: 'ean13' },
  { id: 'at-spar', name: 'SPAR Österreich', aliases: ['SPAR', 'Spar Friends'], countries: ['AT'], color: '#00703c', format: 'qr' },
  { id: 'at-hofer', name: 'HOFER', countries: ['AT'], color: '#00005f', format: 'qr' },
  { id: 'at-bipa', name: 'BIPA', countries: ['AT'], color: '#e4007c', format: 'ean13' },
  { id: 'at-mpreis', name: 'MPREIS', countries: ['AT'], color: '#e30613', format: 'ean13' },
  { id: 'at-unimarkt', name: 'Unimarkt', countries: ['AT'], color: '#e30613', format: 'ean13' },
  { id: 'at-libro', name: 'LIBRO', countries: ['AT'], color: '#e30613', format: 'ean13' },
  { id: 'at-pagro', name: 'PAGRO DISKONT', aliases: ['Pagro'], countries: ['AT'], color: '#e30613', format: 'ean13' },
  { id: 'at-interspar', name: 'INTERSPAR', countries: ['AT'], color: '#00703c', format: 'qr' },
  { id: 'at-kika', name: 'kika/Leiner', aliases: ['kika', 'Leiner'], countries: ['AT'], color: '#e30613', format: 'code128' },
  { id: 'at-hervis', name: 'Hervis', countries: ['AT'], color: '#e30613', format: 'code128' },
  { id: 'at-omv', name: 'OMV', countries: ['AT', 'DE'], color: '#0062a7', format: 'code128' },
  { id: 'at-oebb', name: 'ÖBB Vorteilscard', aliases: ['OEBB', 'Vorteilscard'], countries: ['AT'], color: '#e2002a', format: 'aztec' },
  { id: 'at-bellaflora', name: 'bellaflora', countries: ['AT'], color: '#4caf50', format: 'code128' },
  { id: 'at-baumax', name: 'Lagerhaus', countries: ['AT'], color: '#006b3f', format: 'code128' },
  { id: 'at-gigasport', name: 'Gigasport', countries: ['AT'], color: '#e30613', format: 'code128' },
];
