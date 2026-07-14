export interface Category {
  code: string;
  label: string;
}

export const FIXED_CATEGORIES: Category[] = [
  { code: 'animals', label: 'Animals' },
  { code: 'nature-flowers', label: 'Nature & Flowers' },
  { code: 'people', label: 'People' },
  { code: 'places-architecture', label: 'Places & Architecture' },
  { code: 'food-drink', label: 'Food & Drink' },
  { code: 'holidays-seasons', label: 'Holidays & Seasons' },
  { code: 'fantasy', label: 'Fantasy' },
  { code: 'geometric-abstract', label: 'Geometric & Abstract' },
  { code: 'words-symbols', label: 'Words & Symbols' },
  { code: 'other', label: 'Other' },
];
