import type { Chain } from '../chains';

export const ES: readonly Chain[] = [
  { id: 'es-mercadona', name: 'Mercadona', countries: ['ES', 'PT'], color: '#00803d', format: 'none' },
  { id: 'es-dia', name: 'Dia', aliases: ['Club Dia'], countries: ['ES', 'PT', 'BR'], color: '#e4002b', format: 'ean13' },
  { id: 'es-eroski', name: 'Eroski', aliases: ['Eroski Club'], countries: ['ES'], color: '#e4002b', format: 'ean13' },
  { id: 'es-consum', name: 'Consum', countries: ['ES'], color: '#f26b21', format: 'ean13' },
  { id: 'es-alcampo', name: 'Alcampo', countries: ['ES'], color: '#e4002b', format: 'ean13' },
  { id: 'es-elcorteingles', name: 'El Corte Inglés', aliases: ['El Corte Ingles'], countries: ['ES', 'PT'], color: '#007a3d', format: 'code128' },
  { id: 'es-carrefour-es', name: 'Carrefour (ES)', aliases: ['Carrefour'], countries: ['ES'], color: '#004e9f', format: 'ean13' },
  { id: 'es-ahorramas', name: 'Ahorramás', aliases: ['Ahorramas'], countries: ['ES'], color: '#e4002b', format: 'ean13' },
  { id: 'es-repsol', name: 'Repsol Waylet', aliases: ['Repsol'], countries: ['ES', 'PT'], color: '#ff6a00', format: 'qr' },
  { id: 'es-cepsa', name: 'Moeve (Cepsa)', aliases: ['Cepsa'], countries: ['ES', 'PT'], color: '#e4002b', format: 'code128' },
  { id: 'es-druni', name: 'Druni', countries: ['ES'], color: '#e4007c', format: 'ean13' },
  { id: 'es-primor', name: 'Primor', countries: ['ES', 'PT'], color: '#e4007c', format: 'ean13' },
  { id: 'es-renfe', name: 'Renfe', countries: ['ES'], color: '#7b2d8e', format: 'aztec' },
];
