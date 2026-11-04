import type { Chain } from '../chains';

export const IT: readonly Chain[] = [
  { id: 'it-coop', name: 'Coop Italia', aliases: ['Coop', 'Socio Coop'], countries: ['IT'], color: '#e4002b', format: 'ean13' },
  { id: 'it-conad', name: 'Conad', aliases: ['Carta Insieme'], countries: ['IT'], color: '#e30613', format: 'ean13' },
  { id: 'it-esselunga', name: 'Esselunga Fìdaty', aliases: ['Esselunga', 'Fidaty'], countries: ['IT'], color: '#0054a6', format: 'ean13' },
  { id: 'it-eurospin', name: 'Eurospin', countries: ['IT'], color: '#0054a6', format: 'ean13' },
  { id: 'it-pam', name: 'Pam Panorama', aliases: ['Pam'], countries: ['IT'], color: '#e30613', format: 'ean13' },
  { id: 'it-despar', name: 'Despar', countries: ['IT'], color: '#00703c', format: 'ean13' },
  { id: 'it-md', name: 'MD', countries: ['IT'], color: '#e30613', format: 'ean13' },
  { id: 'it-feltrinelli', name: 'laFeltrinelli', aliases: ['Feltrinelli'], countries: ['IT'], color: '#e30613', format: 'code128' },
  { id: 'it-unieuro', name: 'Unieuro', countries: ['IT'], color: '#e30613', format: 'code128' },
  { id: 'it-tigota', name: 'Tigotà', aliases: ['Tigota'], countries: ['IT'], color: '#e4007c', format: 'ean13' },
  { id: 'it-ovs', name: 'OVS', countries: ['IT'], color: '#000000', format: 'code128' },
  { id: 'it-eni', name: 'Eni Live', aliases: ['Eni'], countries: ['IT'], color: '#ffd200', format: 'code128' },
  { id: 'it-trenitalia', name: 'Trenitalia CartaFRECCIA', aliases: ['Trenitalia'], countries: ['IT'], color: '#e30613', format: 'aztec' },
  { id: 'it-acqua-sapone', name: 'Acqua & Sapone', aliases: ['Acqua e Sapone'], countries: ['IT'], color: '#0054a6', format: 'ean13' },
];
