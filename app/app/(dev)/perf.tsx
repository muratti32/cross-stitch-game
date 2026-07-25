import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import PerfHarnessScreen from '@/perf/harness/PerfHarnessScreen';

export default function PerfRoute() {
  const isEnabled = __DEV__ || process.env.EXPO_PUBLIC_PERF_HARNESS === '1';

  if (!isEnabled) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Perf harness disabled</Text>
      </View>
    );
  }

  return <PerfHarnessScreen />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAF6F0',
  },
  text: {
    fontSize: 16,
    color: '#857D75',
  },
});
