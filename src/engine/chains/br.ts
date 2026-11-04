import type { Chain } from '../chains';

export const BR: readonly Chain[] = [
  { id: 'br-paodeacucar', name: 'Pão de Açúcar', aliases: ['Pao de Acucar'], countries: ['BR'], color: '#00703c', format: 'code128' },
  { id: 'br-extra', name: 'Extra', countries: ['BR'], color: '#e4002b', format: 'code128' },
  { id: 'br-carrefour-br', name: 'Carrefour (BR)', aliases: ['Carrefour'], countries: ['BR'], color: '#004e9f', format: 'ean13' },
  { id: 'br-drogasil', name: 'Drogasil', countries: ['BR'], color: '#e4002b', format: 'code128' },
  { id: 'br-drogaraia', name: 'Droga Raia', countries: ['BR'], color: '#e4002b', format: 'code128' },
  { id: 'br-paguemenos', name: 'Pague Menos', countries: ['BR'], color: '#0054a6', format: 'code128' },
  { id: 'br-renner', name: 'Renner', countries: ['BR'], color: '#e4002b', format: 'code128' },
  { id: 'br-dotz', name: 'Dotz', countries: ['BR'], color: '#f26b21', format: 'code128' },
  { id: 'br-ipiranga', name: 'Ipiranga Km de Vantagens', aliases: ['Ipiranga'], countries: ['BR'], color: '#ffd200', format: 'code128' },
];
