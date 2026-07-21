import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '@/theme/theme';

export const TAB_BAR_HEIGHT = 72;
export const TAB_BAR_BOTTOM_GAP = Theme.spacing.lg;

export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  const barBottom = insets.bottom > 0 ? insets.bottom : Theme.spacing.lg;
  return barBottom + TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_GAP;
}
