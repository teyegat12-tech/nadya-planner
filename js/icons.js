// Набор линейных иконок (24×24, обводка 1.7, скруглённые концы)
const P = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="8.5" cy="14.5" r=".6" fill="currentColor"/><circle cx="12" cy="14.5" r=".6" fill="currentColor"/>',
  heart: '<path d="M12 20s-7.5-4.4-7.5-10.1A4.4 4.4 0 0 1 12 7.3a4.4 4.4 0 0 1 7.5 2.6C19.5 15.6 12 20 12 20Z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  more: '<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  pause: '<rect x="6.5" y="5" width="3.5" height="14" rx="1.2"/><rect x="14" y="5" width="3.5" height="14" rx="1.2"/>',
  play: '<path d="M7.5 5.3v13.4a1 1 0 0 0 1.5.86l11-6.7a1 1 0 0 0 0-1.72l-11-6.7a1 1 0 0 0-1.5.86Z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h6.2a1.5 1.5 0 0 0 1.5-1.3L17.5 7"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15L6 16.5ZM10 20.5h4"/>',
  repeat: '<path d="M17 3.5 20 6.5l-3 3"/><path d="M4 12V10a3.5 3.5 0 0 1 3.5-3.5H20M7 20.5 4 17.5l3-3"/><path d="M20 12v2a3.5 3.5 0 0 1-3.5 3.5H4"/>',
  note: '<path d="M6 3.5h8.5L19 8v12.5H6Z"/><path d="M14 3.5V8.5h5M9 13h6M9 16.5h4"/>',
  folder: '<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2.2h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3L9.5 4.5h5L16.2 7h2.3A1.5 1.5 0 0 1 20 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18Z"/><circle cx="12" cy="13" r="3.5"/>',
  pen: '<path d="M4 20l1-4.2L15.6 5.2a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.2 19 4 20Z"/><path d="M13.5 7.3l3.2 3.2"/>',
  drop: '<path d="M12 3.5s6 6.4 6 10.7A6 6 0 0 1 6 14.2C6 9.9 12 3.5 12 3.5Z"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"/>',
  flame: '<path d="M12 21a6 6 0 0 0 6-6c0-4-3.5-6.5-4.5-10-2 1.5-3 3.5-3 5.5-1-.5-1.8-1.5-2-2.7C6.8 9.6 6 12 6 15a6 6 0 0 0 6 6Z"/>',
  run: '<circle cx="14.5" cy="4.5" r="1.8"/><path d="m8 21 3-6 3 2.5V21M6 12l3-3.5 4 .5 2.5 3.5 3 1"/><path d="m11 15-1-5"/>',
  steps: '<path d="M7.5 3.5c1.6 0 2.5 1.8 2.5 4s-1 3.5-2.5 3.5S5 9.7 5 7.5s.9-4 2.5-4ZM16.5 9.5c1.6 0 2.5 1.8 2.5 4s-1 3.5-2.5 3.5S14 15.7 14 13.5s.9-4 2.5-4Z"/><path d="M5.5 14.5h4M14.5 20.5h4"/>',
  stairs: '<path d="M3.5 19.5h4v-4h4v-4h4v-4h5"/>',
  route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5l-9 9a2.1 2.1 0 0 1-3-3l9-9a4 4 0 0 1-2-2Z"/>',
  hourglass: '<path d="M6.5 3.5h11M6.5 20.5h11M7.5 3.5v3a4.5 4.5 0 0 0 9 0v-3M7.5 20.5v-3a4.5 4.5 0 0 1 9 0v3"/>',
  inbox: '<path d="M3.5 13.5 6 5.5h12l2.5 8V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19Z"/><path d="M3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5"/>',
  alert: '<path d="M12 4.5 21 19.5H3Z"/><path d="M12 10v4M12 16.8v.2"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  tag: '<path d="M3.5 12.3V4.5h7.8l9 9-7.8 7.8Z"/><circle cx="8" cy="9" r="1.3"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.8"/><path d="M10.5 18.5h3"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M8 14h8"/>',
  left: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
  right: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  undo: '<path d="M8 5 4 9l4 4"/><path d="M4 9h10a5.5 5.5 0 0 1 0 11h-3"/>',
  sparkle: '<path d="M12 3c.6 4.6 3.4 7.4 9 9-5.6 1.6-8.4 4.4-9 9-.6-4.6-3.4-7.4-9-9 5.6-1.6 8.4-4.4 9-9Z"/>',
  food: '<path d="M7 3.5v17M4.5 3.5V8a2.5 2.5 0 0 0 5 0V3.5M17 20.5V3.5c-2 0-3.5 2.5-3.5 6s1.5 4.5 3.5 4.5"/>',
  star: '<path d="m12 3.8 2.5 5.2 5.6.7-4.1 3.9 1 5.6L12 16.5l-5 2.7 1-5.6-4.1-3.9 5.6-.7Z"/>',
  bolt: '<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6Z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  walk: '<path d="M4 16v-2.4C4 11.5 3 10.5 3 8c0-2.7 1.5-6 4.5-6C9.4 2 10 3.8 10 5.5c0 3.1-2 5.7-2 8.7V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.4c0-2.1 1-3.1 1-5.6 0-2.7-1.5-6-4.5-6C14.6 6 14 7.8 14 9.5c0 3.1 2 5.7 2 8.7V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4M4 13h4"/>',
  yoga: '<path d="M12 19.5c-2.6-1.6-3.6-4.2-3.6-6.8 0-3 1.5-5.6 3.6-7.2 2.1 1.6 3.6 4.2 3.6 7.2 0 2.6-1 5.2-3.6 6.8Z"/><path d="M12 19.5c-4.2 0-8-2-8.5-5.3 2.2-.2 4.3.4 5.9 1.6M12 19.5c4.2 0 8-2 8.5-5.3-2.2-.2-4.3.4-5.9 1.6"/>',
  bike: '<circle cx="6" cy="16.5" r="3.5"/><circle cx="18" cy="16.5" r="3.5"/><path d="M6 16.5 9.5 9h5l3.5 7.5M9.5 9 12 16.5h-6M14 5.5h2.5"/>',
  swim: '<circle cx="15.5" cy="6" r="1.8"/><path d="M3 18c1.5 0 2-1 3.5-1s2 1 3.5 1 2-1 3.5-1 2 1 3.5 1 2-1 3.5-1M6 14l4-4 3 2 2-3"/>',
  telegram: '<path d="m21 4.5-3 15.2c-.2 1-1 1.3-1.8.8l-4.6-3.4-2.2 2.1c-.3.3-.5.4-.9.4l.3-4.7 8.6-7.8c.4-.3-.1-.5-.6-.2L6.2 13.6l-4.6-1.4c-1-.3-1-1 .2-1.5L19.7 3.6c.8-.3 1.6.2 1.3.9Z"/>',
  book: '<path d="M4.5 5.5A2 2 0 0 1 6.5 3.5H19.5v14H6.5a2 2 0 0 0-2 2Z"/><path d="M4.5 19.5a2 2 0 0 0 2 2h13v-4"/><path d="M9 8h6"/>',
  dumbbell: '<path d="M6.5 7.5v9M17.5 7.5v9M3.5 10v4M20.5 10v4M6.5 12h11"/>',
  puzzle: '<path d="M4.5 7h4.3a2.3 2.3 0 1 1 4.4 0h4.3v4.3a2.3 2.3 0 1 1 0 4.4v4.3h-4.3a2.3 2.3 0 1 0-4.4 0H4.5Z"/>',
  leaf: '<path d="M5 19c0-8 5.5-13.5 14.5-14.5C19 13.5 13.5 19 5 19Z"/><path d="M5 19 13 11"/>',
  home: '<path d="M4 11 12 4.5 20 11v8.5a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1Z"/>',
  briefcase: '<rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M9 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5v2M3.5 13h17"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.9 1.4-2l-.4-1a1.5 1.5 0 0 1 1.4-2h2.1a4 4 0 0 0 4-4C20.5 7 16.7 3.5 12 3.5Z"/><circle cx="7.8" cy="11" r="1" fill="currentColor"/><circle cx="10.5" cy="7.5" r="1" fill="currentColor"/><circle cx="15" cy="7.8" r="1" fill="currentColor"/>',
  music: '<path d="M9 18V5.5l11-2v12.5"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  cart: '<path d="M3 4.5h2.5l2 11h11l2-7.5H7"/><circle cx="9" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>',
  plane: '<path d="M10.5 13.5 4 11.5l1.5-2 6 1L16 5.5a2 2 0 0 1 3 3l-5 4.5 1 6-2 1.5-2-6.5-3 3v2.5L6.5 20 5.5 16 3 15l1.5-1.5H7Z"/>',
  coffee: '<path d="M4.5 9h12v5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5Z"/><path d="M16.5 10.5h1.5a2.5 2.5 0 0 1 0 5h-1.8M8 3.5v2.5M11.5 3.5v2.5"/>',
  child: '<circle cx="12" cy="10" r="5.5"/><path d="M9.8 9.5h.01M14.2 9.5h.01M10 12.5a2.8 2.8 0 0 0 4 0M12 4.5c-.5-1 0-2 1-2M8 21l1.5-5.5M16 21l-1.5-5.5"/>',
  brain: '<path d="M9.5 4.5a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 5 1.5V5.5a2.5 2.5 0 0 0-2-1ZM14.5 4.5a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-5 1.5V5.5a2.5 2.5 0 0 1 2-1Z"/>',
  gift: '<rect x="3.5" y="8.5" width="17" height="4" rx="1.2"/><path d="M5 12.5v6.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-6.5M12 8.5v12M12 8.5C10.5 5 7 4.5 7 6.5S10 8.5 12 8.5ZM12 8.5c1.5-3.5 5-4 5-2s-3 2-5 2Z"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h10A1.5 1.5 0 0 1 18 6.5V8"/><rect x="4" y="8" width="16.5" height="11.5" rx="2.5"/><path d="M20.5 12h-4a2 2 0 0 0 0 4h4"/><circle cx="16.5" cy="14" r=".6" fill="currentColor"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/><circle cx="16.5" cy="9.5" r="2.6"/><path d="M15.5 14.3a4.6 4.6 0 0 1 5 5.2"/>',
  ticket: '<path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v2.5a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4Z"/><path d="M14 6.5v1.5M14 11v2M14 16v1.5"/>',
};

// иконки для категорий (выбор в настройках)
export const CAT_ICONS = ['book', 'dumbbell', 'puzzle', 'sparkle', 'leaf', 'heart', 'home', 'briefcase', 'palette', 'music', 'cart', 'plane', 'coffee', 'child', 'brain', 'camera', 'pen', 'run', 'star', 'gift', 'wallet', 'users', 'ticket', 'moon'];
// спокойная палитра плашек (из гаммы референса, белая иконка читается на каждой)
// готовые категории для быстрого добавления
export const CAT_PRESETS = [
  ['Покупки', 'cart'], ['Путешествия', 'plane'], ['Праздники', 'gift'],
  ['События', 'ticket'], ['Дом', 'home'], ['Здоровье', 'heart'],
  ['Работа', 'briefcase'], ['Финансы', 'wallet'], ['Друзья', 'users'],
];
export const CAT_MAX = 9;
// старые «грязные» цвета → новые чистые (для уже сохранённых категорий)
export const COLOR_FIX = {"#9d8ad6": "#9a7cfa", "#ec9a72": "#ff914d", "#8fb59a": "#5ccb8a", "#e38fae": "#fa7bae", "#8fa6cc": "#6c9ef5", "#a7a3b8": "#a69cd6", "#a08af0": "#9a7cfa", "#fa9a5e": "#ff914d", "#76c592": "#5ccb8a", "#f288b3": "#fa7bae", "#7ea9ec": "#6c9ef5", "#aaa5c8": "#a69cd6"};
export const fixColor = (c) => COLOR_FIX[(c || '').toLowerCase()] || c;
export const CAT_COLORS = ['#9a7cfa', '#ff914d', '#5ccb8a', '#fa7bae', '#6c9ef5', '#a69cd6', '#6f6d7a'];
const EMOJI_MAP = { '📚': 'book', '💪': 'dumbbell', '🧩': 'puzzle', '✨': 'sparkle', '🌿': 'leaf' };
export const catIcon = (c) => (P[c?.emoji] ? c.emoji : EMOJI_MAP[c?.emoji] || 'tag');
export function plate(c, cls = '') {
  return `<span class="plate ${cls}" style="--pc:${c?.color || '#a69cd6'}">${I(catIcon(c))}</span>`;
}

export function I(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}
