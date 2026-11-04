import type { Chain } from '../chains';

export const PT: readonly Chain[] = [
  { id: 'pt-continente', name: 'Continente', aliases: ['Cartão Continente'], countries: ['PT'], color: '#e4002b', format: 'ean13' },
  { id: 'pt-pingodoce', name: 'Pingo Doce', aliases: ['Poupa Mais'], countries: ['PT'], color: '#00703c', format: 'ean13' },
  { id: 'pt-lidl-pt', name: 'Lidl Plus (PT)', aliases: ['Lidl'], countries: ['PT'], color: '#0050aa', format: 'qr' },
  { id: 'pt-minipreco', name: 'Minipreço', aliases: ['Minipreco'], countries: ['PT'], color: '#e4002b', format: 'ean13' },
  { id: 'pt-wells', name: 'Wells', countries: ['PT'], color: '#00a19a', format: 'ean13' },
  { id: 'pt-worten', name: 'Worten', countries: ['PT'], color: '#e4002b', format: 'code128' },
  { id: 'pt-galp', name: 'Galp', countries: ['PT'], color: '#ff6a00', format: 'code128' },
  { id: 'pt-cp', name: 'CP', countries: ['PT'], color: '#00703c', format: 'aztec' },
];
