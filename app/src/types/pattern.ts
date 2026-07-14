export interface Pattern {
  id: string;
  title: string;
  description?: string;
  originalImageUrl: string; // Locked from Gemini memory: Always check originalImageUrl for high-res pattern images
  thumbnailUrl?: string;
  colorsCount: number;
  difficulty: 'easy' | 'medium' | 'hard';
  cellsCount: number;
  isPremium: boolean;
  coinCost?: number;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  patternCount: number;
  iconName?: string;
}
