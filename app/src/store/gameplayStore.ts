import { create } from 'zustand';

interface GameplayState {
  selectedColorIndex: number;
  setSelectedColorIndex: (index: number) => void;
  zoomLevel: number;
  setZoomLevel: (level: number) => void;
  showGridLines: boolean;
  toggleGridLines: () => void;
  handedness: 'left' | 'right';
  setHandedness: (pref: 'left' | 'right') => void;
  resetGameplay: () => void;
}

export const useGameplayStore = create<GameplayState>((set) => ({
  selectedColorIndex: 0,
  setSelectedColorIndex: (index) => set({ selectedColorIndex: index }),
  zoomLevel: 1.0,
  setZoomLevel: (level) => set({ zoomLevel: level }),
  showGridLines: true,
  toggleGridLines: () => set((state) => ({ showGridLines: !state.showGridLines })),
  handedness: 'right',
  setHandedness: (pref) => set({ handedness: pref }),
  resetGameplay: () => set({ selectedColorIndex: 0, zoomLevel: 1.0, showGridLines: true, handedness: 'right' }),
}));
