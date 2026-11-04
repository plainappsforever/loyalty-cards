import type { Chain } from '../chains';

export const JP: readonly Chain[] = [
  { id: 'jp-tpoint', name: 'V Point (T-Point)', aliases: ['T-Point', 'Tポイント', 'Vポイント'], countries: ['JP'], color: '#ffd200', format: 'code128' },
  { id: 'jp-ponta', name: 'Ponta', aliases: ['ポンタ'], countries: ['JP'], color: '#ff6a00', format: 'code128' },
  { id: 'jp-dpoint', name: 'd POINT', aliases: ['dポイント'], countries: ['JP'], color: '#e4002b', format: 'code128' },
  { id: 'jp-rakuten', name: 'Rakuten Point', aliases: ['楽天ポイント'], countries: ['JP'], color: '#bf0000', format: 'code128' },
  { id: 'jp-aeon', name: 'AEON WAON', aliases: ['AEON', 'イオン'], countries: ['JP'], color: '#b4007c', format: 'code128' },
  { id: 'jp-lawson', name: 'Lawson', aliases: ['ローソン'], countries: ['JP'], color: '#0054a6', format: 'code128' },
  { id: 'jp-familymart', name: 'FamilyMart', aliases: ['ファミリーマート'], countries: ['JP'], color: '#00a040', format: 'code128' },
  { id: 'jp-matsukiyo', name: 'Matsumoto Kiyoshi', aliases: ['マツキヨ'], countries: ['JP'], color: '#ffd200', format: 'code128' },
  { id: 'jp-yodobashi', name: 'Yodobashi', aliases: ['ヨドバシ'], countries: ['JP'], color: '#e4002b', format: 'code128' },
  { id: 'jp-bic', name: 'Bic Camera', aliases: ['ビックカメラ'], countries: ['JP'], color: '#e4002b', format: 'code128' },
  { id: 'jp-tsutaya', name: 'TSUTAYA', countries: ['JP'], color: '#ffd200', format: 'code128' },
];
