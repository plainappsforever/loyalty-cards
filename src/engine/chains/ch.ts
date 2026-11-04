import type { Chain } from '../chains';

// Switzerland (Cumulus and Supercard are the two big programmes; both cards carry EAN-13).
export const CH: readonly Chain[] = [
  { id: 'ch-migros', name: 'Migros Cumulus', aliases: ['Migros', 'Cumulus'], countries: ['CH'], color: '#ff6600', format: 'ean13', numberLength: 13 },
  { id: 'ch-coop', name: 'Coop Supercard', aliases: ['Coop', 'Supercard'], countries: ['CH'], color: '#e30613', format: 'ean13', numberLength: 13 },
  { id: 'ch-denner', name: 'Denner', countries: ['CH'], color: '#e30613', format: 'ean13' },
  { id: 'ch-volg', name: 'Volg', countries: ['CH'], color: '#e30613', format: 'ean13' },
  { id: 'ch-manor', name: 'Manor', countries: ['CH'], color: '#000000', format: 'code128' },
  { id: 'ch-globus', name: 'Globus (CH)', aliases: ['Globus'], countries: ['CH'], color: '#000000', format: 'code128' },
  { id: 'ch-landi', name: 'LANDI', countries: ['CH'], color: '#009a44', format: 'code128' },
  { id: 'ch-jumbo', name: 'Jumbo', countries: ['CH'], color: '#e30613', format: 'code128' },
  { id: 'ch-interdiscount', name: 'Interdiscount', countries: ['CH'], color: '#e30613', format: 'code128' },
  { id: 'ch-ochsner', name: 'Ochsner Sport', countries: ['CH'], color: '#e30613', format: 'code128' },
  { id: 'ch-dosenbach', name: 'Dosenbach', countries: ['CH'], color: '#00783c', format: 'code128' },
  { id: 'ch-sbb', name: 'SBB SwissPass', aliases: ['SwissPass', 'SBB'], countries: ['CH'], color: '#eb0000', format: 'aztec' },
  { id: 'ch-migrolino', name: 'migrolino', countries: ['CH'], color: '#ff6600', format: 'ean13' },
  { id: 'ch-aperto', name: 'avec', countries: ['CH'], color: '#e30613', format: 'code128' },
  { id: 'ch-bibliothek', name: 'Bibliothek (CH)', aliases: ['Bibliothek'], countries: ['CH'], color: '#2c3e50', format: 'code39' },
];
