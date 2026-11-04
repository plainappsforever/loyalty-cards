import type { Chain } from '../chains';

export const PL: readonly Chain[] = [
  { id: 'pl-biedronka', name: 'Biedronka Moja', aliases: ['Biedronka'], countries: ['PL'], color: '#e4002b', format: 'ean13' },
  { id: 'pl-zabka', name: 'Żabka', aliases: ['Zabka'], countries: ['PL'], color: '#00703c', format: 'qr' },
  { id: 'pl-rossmann-pl', name: 'Rossmann (PL)', aliases: ['Rossmann'], countries: ['PL'], color: '#c8102e', format: 'qr' },
  { id: 'pl-lidl-pl', name: 'Lidl Plus (PL)', aliases: ['Lidl'], countries: ['PL'], color: '#0050aa', format: 'qr' },
  { id: 'pl-kaufland-pl', name: 'Kaufland (PL)', aliases: ['Kaufland'], countries: ['PL'], color: '#e10915', format: 'qr' },
  { id: 'pl-auchan-pl', name: 'Auchan (PL)', aliases: ['Auchan'], countries: ['PL'], color: '#e4002b', format: 'ean13' },
  { id: 'pl-empik', name: 'Empik', countries: ['PL'], color: '#000000', format: 'code128' },
  { id: 'pl-hebe', name: 'Hebe', countries: ['PL'], color: '#e4007c', format: 'ean13' },
  { id: 'pl-orlen', name: 'ORLEN VITAY', aliases: ['Orlen'], countries: ['PL'], color: '#e4002b', format: 'ean13' },
  { id: 'pl-ccc', name: 'CCC', countries: ['PL'], color: '#000000', format: 'code128' },
  { id: 'pl-stokrotka', name: 'Stokrotka', countries: ['PL'], color: '#e4002b', format: 'ean13' },
];
