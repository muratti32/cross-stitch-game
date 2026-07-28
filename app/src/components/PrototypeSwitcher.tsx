// PROTOTYPE infrastructure — keep out of production UI.
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '@/theme/theme';

interface Props<T extends string> {
  variants: readonly T[];
  current: T;
  names: Record<T, string>;
  onChange: (variant: T) => void;
}

export function PrototypeSwitcher<T extends string>({ variants, current, names, onChange }: Props<T>) {
  const cycle = (direction: -1 | 1) => {
    const currentIndex = variants.indexOf(current);
    const nextIndex = (currentIndex + direction + variants.length) % variants.length;
    onChange(variants[nextIndex]);
  };

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const target = globalThis as typeof globalThis & {
      addEventListener?: (type: string, listener: (event: { key?: string; target?: { tagName?: string; isContentEditable?: boolean } }) => void) => void;
      removeEventListener?: (type: string, listener: (event: { key?: string; target?: { tagName?: string; isContentEditable?: boolean } }) => void) => void;
    };
    const onKeyDown = (event: { key?: string; target?: { tagName?: string; isContentEditable?: boolean } }) => {
      const tagName = event.target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || event.target?.isContentEditable) return;
      if (event.key === 'ArrowLeft') cycle(-1);
      if (event.key === 'ArrowRight') cycle(1);
    };
    target.addEventListener?.('keydown', onKeyDown);
    return () => target.removeEventListener?.('keydown', onKeyDown);
  });

  if (process.env.NODE_ENV === 'production') return null;

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <View style={styles.bar}>
        <Pressable accessibilityLabel="Previous prototype" onPress={() => cycle(-1)} style={styles.arrow}>
          <Ionicons name="arrow-back" size={18} color={Theme.colors.textLight} />
        </Pressable>
        <Text style={styles.label}>{current} — {names[current]}</Text>
        <Pressable accessibilityLabel="Next prototype" onPress={() => cycle(1)} style={styles.arrow}>
          <Ionicons name="arrow-forward" size={18} color={Theme.colors.textLight} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 88, alignItems: 'center' },
  bar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1F1D1A', borderRadius: Theme.radii.full, padding: 5, shadowColor: '#000', shadowOpacity: 0.24, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 8 },
  arrow: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: '#34312C' },
  label: { color: Theme.colors.textLight, minWidth: 164, paddingHorizontal: Theme.spacing.md, textAlign: 'center', fontSize: Theme.typography.sizes.xs, fontWeight: Theme.typography.weights.bold },
});
