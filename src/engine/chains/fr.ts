import type { Chain } from '../chains';

export const FR: readonly Chain[] = [
  { id: 'fr-carrefour', name: 'Carrefour', aliases: ['Carte Carrefour'], countries: ['FR', 'ES', 'IT', 'BR', 'PL', 'TR'], color: '#004e9f', format: 'ean13' },
  { id: 'fr-leclerc', name: 'E.Leclerc', aliases: ['Leclerc'], countries: ['FR'], color: '#0066b3', format: 'ean13' },
  { id: 'fr-auchan', name: 'Auchan', aliases: ['Waaoh'], countries: ['FR', 'ES', 'PL', 'PT', 'RU'], color: '#e4002b', format: 'ean13' },
  { id: 'fr-intermarche', name: 'Intermarché', aliases: ['Intermarche'], countries: ['FR', 'PT', 'PL'], color: '#e4002b', format: 'ean13' },
  { id: 'fr-monoprix', name: 'Monoprix', countries: ['FR'], color: '#000000', format: 'ean13' },
  { id: 'fr-casino', name: 'Casino', countries: ['FR'], color: '#e4002b', format: 'ean13' },
  { id: 'fr-systemeu', name: 'Système U', aliases: ['Super U', 'Hyper U'], countries: ['FR'], color: '#e4002b', format: 'ean13' },
  { id: 'fr-franprix', name: 'Franprix', countries: ['FR'], color: '#ff6a00', format: 'ean13' },
  { id: 'fr-picard', name: 'Picard', countries: ['FR'], color: '#1d3a8a', format: 'ean13' },
  { id: 'fr-fnac', name: 'Fnac', countries: ['FR', 'ES', 'PT'], color: '#e6a800', format: 'code128' },
  { id: 'fr-sephora', name: 'Sephora (FR)', aliases: ['Sephora'], countries: ['FR'], color: '#000000', format: 'code128' },
  { id: 'fr-leroymerlin', name: 'Leroy Merlin', countries: ['FR', 'ES', 'IT', 'PL', 'PT', 'BR', 'RU'], color: '#78be20', format: 'code128' },
  { id: 'fr-castorama', name: 'Castorama', countries: ['FR', 'PL'], color: '#0058a3', format: 'code128' },
  { id: 'fr-yvesrocher', name: 'Yves Rocher', countries: ['FR', 'DE', 'ES', 'IT', 'PL', 'PT', 'RU', 'TR', 'MX'], color: '#2e7d32', format: 'code128' },
  { id: 'fr-total-fr', name: 'TotalEnergies Club', countries: ['FR'], color: '#ed1c24', format: 'code128' },
  { id: 'fr-sncf', name: 'SNCF Connect', aliases: ['SNCF'], countries: ['FR'], color: '#8a2be2', format: 'aztec' },
  { id: 'fr-kiabi', name: 'Kiabi', countries: ['FR', 'ES', 'IT'], color: '#e4002b', format: 'code128' },
];
