import React from 'react';
import { ScrollView, View, Pressable, StyleSheet } from 'react-native';
import { Theme } from '@/theme/theme';
import { useTranslation } from 'react-i18next';

export interface DmcColor {
  dmcCode: string;
  name: string;
  rgbHex: string;
}

export interface DmcColorPickerProps {
  colors: DmcColor[];
  selectedDmcCode: string | null;
  onSelect: (color: DmcColor) => void;
}

export function DmcColorPicker({ colors, selectedDmcCode, onSelect }: DmcColorPickerProps) {
  const { t } = useTranslation('create');
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <View style={styles.grid}>
        {colors.map((color) => {
          const isSelected = color.dmcCode === selectedDmcCode;
          return (
            <Pressable
              key={color.dmcCode}
              onPress={() => onSelect(color)}
              accessibilityRole="button"
              accessibilityLabel={t('patternEditor.picker.colorAccessibilityLabel', {
                code: color.dmcCode,
                name: color.name,
              })}
              style={[
                styles.swatchWrapper,
                isSelected && styles.swatchWrapperSelected,
              ]}
            >
              <View style={[styles.swatch, { backgroundColor: color.rgbHex }]} />
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    height: 240,
    maxHeight: 240,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.md,
    backgroundColor: Theme.colors.card,
  },
  container: {
    padding: Theme.spacing.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Theme.spacing.xs,
  },
  swatchWrapper: {
    width: 38,
    height: 38,
    padding: 2,
    borderRadius: Theme.radii.sm + 2,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchWrapperSelected: {
    borderColor: Theme.colors.accentRose,
  },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: Theme.radii.sm,
  },
});
