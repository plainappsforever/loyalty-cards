import type { Chain } from '../chains';

export const RU: readonly Chain[] = [
  { id: 'ru-pyaterochka', name: 'Пятёрочка', aliases: ['Pyaterochka', 'Выручай-карта'], countries: ['RU'], color: '#e4002b', format: 'ean13' },
  { id: 'ru-magnit', name: 'Магнит', aliases: ['Magnit'], countries: ['RU'], color: '#e4002b', format: 'ean13' },
  { id: 'ru-perekrestok', name: 'Перекрёсток', aliases: ['Perekrestok'], countries: ['RU'], color: '#00703c', format: 'ean13' },
  { id: 'ru-lenta', name: 'Лента', aliases: ['Lenta'], countries: ['RU'], color: '#0054a6', format: 'ean13' },
  { id: 'ru-dixy', name: 'Дикси', aliases: ['Dixy'], countries: ['RU'], color: '#f26b21', format: 'ean13' },
  { id: 'ru-sportmaster', name: 'Спортмастер', aliases: ['Sportmaster'], countries: ['RU'], color: '#0054a6', format: 'code128' },
  { id: 'ru-letual', name: "Л'Этуаль", aliases: ['Letoile', 'L Etoile'], countries: ['RU'], color: '#1d1d8f', format: 'code128' },
  { id: 'ru-mvideo', name: 'М.Видео', aliases: ['M.Video', 'Mvideo'], countries: ['RU'], color: '#e4002b', format: 'code128' },
  { id: 'ru-vkusvill', name: 'ВкусВилл', aliases: ['VkusVill'], countries: ['RU'], color: '#00a040', format: 'ean13' },
];
