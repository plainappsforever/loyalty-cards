import type { Chain } from '../chains';

export const VN: readonly Chain[] = [
  { id: 'vn-vinmart', name: 'WinMart', aliases: ['VinMart', 'VinID'], countries: ['VN'], color: '#e4002b', format: 'code128' },
  { id: 'vn-coopmart', name: 'Co.opmart', aliases: ['Coopmart'], countries: ['VN'], color: '#0054a6', format: 'ean13' },
  { id: 'vn-bachhoaxanh', name: 'Bách hóa XANH', aliases: ['Bach hoa Xanh'], countries: ['VN'], color: '#00a040', format: 'code128' },
  { id: 'vn-circlek', name: 'Circle K', countries: ['VN', 'US', 'ID', 'MX', 'PL'], color: '#e4002b', format: 'code128' },
  { id: 'vn-highlands', name: 'Highlands Coffee', countries: ['VN'], color: '#9b1b30', format: 'qr' },
  { id: 'vn-phuclong', name: 'Phúc Long', aliases: ['Phuc Long'], countries: ['VN'], color: '#00703c', format: 'qr' },
  { id: 'vn-thegioididong', name: 'Thế Giới Di Động', aliases: ['The Gioi Di Dong'], countries: ['VN'], color: '#ffd200', format: 'code128' },
  { id: 'vn-lotte-vn', name: 'LOTTE Mart (VN)', aliases: ['Lotte Mart'], countries: ['VN'], color: '#e4002b', format: 'code128' },
];
