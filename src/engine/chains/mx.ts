import type { Chain } from '../chains';

export const MX: readonly Chain[] = [
  { id: 'mx-soriana', name: 'Soriana', countries: ['MX'], color: '#e4002b', format: 'code128' },
  { id: 'mx-chedraui', name: 'Chedraui', countries: ['MX'], color: '#f26b21', format: 'code128' },
  { id: 'mx-oxxo', name: 'OXXO', aliases: ['OXXO Premia'], countries: ['MX'], color: '#e4002b', format: 'code128' },
  { id: 'mx-walmart-mx', name: 'Walmart (MX)', aliases: ['Walmart', 'Bodega Aurrera'], countries: ['MX'], color: '#0071ce', format: 'qr' },
  { id: 'mx-liverpool', name: 'Liverpool', countries: ['MX'], color: '#e10098', format: 'code128' },
  { id: 'mx-farmaciasguadalajara', name: 'Farmacias Guadalajara', countries: ['MX'], color: '#0054a6', format: 'code128' },
  { id: 'mx-farmaciasdelahorro', name: 'Farmacias del Ahorro', countries: ['MX'], color: '#e4002b', format: 'code128' },
  { id: 'mx-sanborns', name: 'Sanborns', countries: ['MX'], color: '#e4002b', format: 'code128' },
  { id: 'mx-cinepolis', name: 'Cinépolis Club', aliases: ['Cinepolis'], countries: ['MX'], color: '#0054a6', format: 'code128' },
];
