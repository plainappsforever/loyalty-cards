import type { Chain } from '../chains';

export const IN: readonly Chain[] = [
  { id: 'in-bigbazaar', name: 'Big Bazaar', countries: ['IN'], color: '#e4002b', format: 'code128' },
  { id: 'in-reliance', name: 'Reliance One', aliases: ['Reliance Retail', 'Reliance Fresh'], countries: ['IN'], color: '#0054a6', format: 'code128' },
  { id: 'in-dmart', name: 'DMart', countries: ['IN'], color: '#00703c', format: 'none' },
  { id: 'in-spencers', name: "Spencer's", aliases: ['Spencers'], countries: ['IN'], color: '#e4002b', format: 'code128' },
  { id: 'in-shoppersstop', name: 'Shoppers Stop First Citizen', aliases: ['Shoppers Stop'], countries: ['IN'], color: '#000000', format: 'code128' },
  { id: 'in-lifestyle', name: 'Lifestyle', countries: ['IN'], color: '#e4007c', format: 'code128' },
  { id: 'in-apollo', name: 'Apollo Pharmacy', countries: ['IN'], color: '#0054a6', format: 'code128' },
  { id: 'in-pvr', name: 'PVR Privilege', aliases: ['PVR'], countries: ['IN'], color: '#ffd200', format: 'code128' },
  { id: 'in-cafecoffeeday', name: 'Café Coffee Day', aliases: ['CCD'], countries: ['IN'], color: '#e4002b', format: 'qr' },
];
