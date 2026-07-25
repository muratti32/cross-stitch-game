import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Switch,
  Share,
  ActivityIndicator,
} from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import { Screen, Button } from '@/components';
import { Theme } from '@/theme/theme';
import { StitchRenderer } from '@/renderer/StitchRenderer';
import { RendererState } from '@/renderer/RendererState';
import {
  SCENARIOS,
  runScenario,
  ScenarioContext,
} from '../scenarios';
import {
  REQUIRED_SCENARIOS,
  REFERENCE_DEVICES,
  ScenarioId,
} from '../budgets';
import {
  evaluateScenario,
  buildRunReport,
  formatRunReport,
  ScenarioMeasurement,
  ScenarioResult,
  PerfRunReport,
  DeviceInfo,
} from '../report';
import {
  FrameSampler,
  LatencySampler,
  ThermalSampler,
} from '../metrics';
import { getDeviceProfile } from '../../../modules/perf-thermal';
import { getDatabase } from '@/local-db';
import { Ionicons } from '@expo/vector-icons';
import { buildLatePlayFixture, buildFullyCompletedFixture } from '../fixtures';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function PerfHarnessScreen() {
  const frameSampler = useRef(new FrameSampler()).current;
  const latencySampler = useRef(new LatencySampler()).current;
  const thermalSampler = useRef(new ThermalSampler()).current;

  const [runStatus, setRunStatus] = useState<
    'idle' | 'running' | 'operator-action-required' | 'cancelled' | 'error' | 'completed'
  >('idle');
  const [currentScenarioId, setCurrentScenarioId] = useState<ScenarioId | null>(null);
  const [progressText, setProgressText] = useState<string>('');
  const [isRefDeviceConfirmed, setIsRefDeviceConfirmed] = useState<boolean>(false);
  const [results, setResults] = useState<Record<string, ScenarioResult>>({});
  const [measurements, setMeasurements] = useState<ScenarioMeasurement[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [reportPath, setReportPath] = useState<string | null>(null);
  const [savedReport, setSavedReport] = useState<PerfRunReport | null>(null);

  // Renderer setup
  const [pattern, setPattern] = useState<any>(null);
  const [rendererState, setRendererState] = useState<RendererState | null>(null);
  const [, setRevision] = useState(0);
  const [remountKey, setRemountKey] = useState(0);

  // Shared values
  const gridShared = useSharedValue<Uint8Array>(new Uint8Array(0));
  const completedShared = useSharedValue<Uint8Array>(new Uint8Array(0));
  const activeColorIndexShared = useSharedValue<number>(0);
  const isColorCompletedShared = useSharedValue<boolean>(false);

  // Transform shared values to pass to StitchRenderer
  const scaleShared = useSharedValue(1.0);
  const translateXShared = useSharedValue(0.0);
  const translateYShared = useSharedValue(0.0);
  const containerWidthShared = useSharedValue(0);
  const containerHeightShared = useSharedValue(0);

  useEffect(() => {
    const profile = getDeviceProfile();
    const matching = REFERENCE_DEVICES.find(
      (refDev) => refDev.platform === profile.platform
    );
    if (matching && !profile.isEmulator) {
      setIsRefDeviceConfirmed(true);
    } else {
      setIsRefDeviceConfirmed(false);
    }
  }, []);

  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Recorded on every measurement so the report states how the ADR-0031 "active background sync queue" was produced. */
  const BACKGROUND_LOAD_NOTE =
    'Background load: periodic local-database read loop every 2s (fixture session has no server counterpart, so a live Progress Sync is not available).';

  const startBackgroundSyncLoad = () => {
    if (syncTimerRef.current) return;
    syncTimerRef.current = setInterval(async () => {
      try {
        const db = await getDatabase();
        await db.getAllAsync('SELECT * FROM sessions LIMIT 5');
        await db.getAllAsync('SELECT * FROM progress_ops LIMIT 10');
      } catch (e) {
        // Ignored
      }
    }, 2000);
  };

  const stopBackgroundSyncLoad = () => {
    if (syncTimerRef.current) {
      clearInterval(syncTimerRef.current);
      syncTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      stopBackgroundSyncLoad();
    };
  }, []);

  const cancelRef = useRef<(() => void) | null>(null);

  const handleStartRun = async () => {
    setRunStatus('running');
    setMeasurements([]);
    setResults({});
    setErrorMsg(null);
    setReportPath(null);
    setSavedReport(null);

    startBackgroundSyncLoad();

    let cancelled = false;
    cancelRef.current = () => {
      cancelled = true;
      stopBackgroundSyncLoad();
      setRunStatus('cancelled');
    };

    const list: ScenarioMeasurement[] = [];

    try {
      for (const scenarioDef of SCENARIOS) {
        if (cancelled) {
          break;
        }

        setCurrentScenarioId(scenarioDef.id);
        setProgressText(`Preparing fixture for ${scenarioDef.title}...`);

        const fixtureData =
          scenarioDef.fixture === 'late-play'
            ? buildLatePlayFixture()
            : buildFullyCompletedFixture();

        setPattern(fixtureData.pattern);
        const state = new RendererState(
          fixtureData.pattern.width,
          fixtureData.pattern.height,
          fixtureData.completed
        );
        setRendererState(state);

        gridShared.value = fixtureData.pattern.grid;
        completedShared.value = state.getCompletedArray();
        activeColorIndexShared.value = 0;
        isColorCompletedShared.value = false;

        await delay(200);

        if (scenarioDef.requiresOperatorAction) {
          setRunStatus('operator-action-required');
          setProgressText(scenarioDef.operatorInstruction || 'Operator action required.');
        } else {
          setRunStatus('running');
          setProgressText('Running scenario driver...');
        }

        const ctx: ScenarioContext = {
          rendererState: state,
          pattern: fixtureData.pattern,
          translateX: translateXShared,
          translateY: translateYShared,
          scale: scaleShared,
          containerWidth: containerWidthShared,
          containerHeight: containerHeightShared,
          completedShared,
          activeColorIndexShared,
          frameSampler,
          latencySampler,
          thermalSampler,
          bumpRevision: () => {
            setRevision((r) => r + 1);
          },
          stitchCell: (x, y) => {
            const success = state.setCompleted(x, y, true);
            if (success) {
              const idx = y * fixtureData.pattern.width + x;
              completedShared.value[idx] = 1;
              completedShared.value = Uint8Array.from(completedShared.value);
              setRevision((r) => r + 1);
            }
          },
          undoLast: () => {
            const completed = state.getCompletedArray();
            const activeColor = activeColorIndexShared.value + 1;
            for (let i = completed.length - 1; i >= 0; i--) {
              if (completed[i] === 1 && fixtureData.pattern.grid[i] === activeColor) {
                const x = i % fixtureData.pattern.width;
                const y = Math.floor(i / fixtureData.pattern.width);
                state.setCompleted(x, y, false);
                completedShared.value[i] = 0;
                completedShared.value = Uint8Array.from(completedShared.value);
                setRevision((r) => r + 1);
                break;
              }
            }
          },
          remountCanvas: () => {
            setRemountKey((k) => k + 1);
          },
        };

        const measurement = await runScenario(scenarioDef, ctx, {
          onProgress: (msg) => {
            setProgressText(msg);
          },
        });

        if (cancelled) {
          break;
        }

        // ADR-0031 fixture requires an active background sync queue. The harness
        // runs on a fixture session that has no server-side counterpart, so the
        // background load is an equivalent periodic local-database read loop
        // rather than a live Progress Sync; record that in the report.
        measurement.notes = BACKGROUND_LOAD_NOTE;

        list.push(measurement);
        setMeasurements([...list]);

        const res = evaluateScenario(measurement);
        setResults((prev) => ({ ...prev, [scenarioDef.id]: res }));
      }

      if (!cancelled) {
        await handleCompleteRun(list);
      }
    } catch (err) {
      console.error('Performance run failed:', err);
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setRunStatus('error');
    } finally {
      stopBackgroundSyncLoad();
    }
  };

  const handleCompleteRun = async (list: ScenarioMeasurement[]) => {
    setRunStatus('completed');

    const profile = getDeviceProfile();
    const device: DeviceInfo = {
      platform: profile.platform,
      osVersion: profile.osVersion,
      model: profile.model,
      isReferenceDevice: isRefDeviceConfirmed,
    };

    const report = buildRunReport({
      appVersion:
        Constants.expoConfig?.version ||
        Constants.manifest2?.extra?.expoClient?.version ||
        '1.0.0',
      gitSha: undefined,
      device,
      fixture: {
        width: 300,
        height: 300,
        paletteSize: 60,
        completedRatio: 0.85,
      },
      measurements: list,
      generatedAtIso: new Date().toISOString(),
    });

    setSavedReport(report);

    const timestamp = Date.now();
    const filename = `perf-report-${device.platform}-${timestamp}.json`;
    const dirPath = `${FileSystem.documentDirectory}perf-reports/`;
    const filePath = `${dirPath}${filename}`;

    try {
      const dirInfo = await FileSystem.getInfoAsync(dirPath);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
      }
      await FileSystem.writeAsStringAsync(filePath, JSON.stringify(report, null, 2));
      setReportPath(filePath);
      console.log(formatRunReport(report));
    } catch (err) {
      console.error('Failed to save performance report:', err);
      setErrorMsg(
        `Failed to save report: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleShare = async () => {
    if (!savedReport) return;
    try {
      await Share.share({
        message: JSON.stringify(savedReport, null, 2),
        title: 'Stitch Performance Report',
      });
    } catch (err) {
      console.error('Sharing failed:', err);
    }
  };

  const getStatusBadge = (id: ScenarioId) => {
    const res = results[id];
    if (!res) {
      if (currentScenarioId === id) {
        return (
          <View style={[styles.badge, styles.badgeRunning]}>
            <ActivityIndicator size="small" color="#FFF" style={styles.spinner} />
            <Text style={styles.badgeText}>RUNNING</Text>
          </View>
        );
      }
      return (
        <View style={[styles.badge, styles.badgePending]}>
          <Text style={styles.badgeText}>PENDING</Text>
        </View>
      );
    }
    return res.passed ? (
      <View style={[styles.badge, styles.badgePass]}>
        <Ionicons name="checkmark-circle-outline" size={14} color="#FFF" />
        <Text style={styles.badgeText}>PASS</Text>
      </View>
    ) : (
      <View style={[styles.badge, styles.badgeFail]}>
        <Ionicons name="close-circle-outline" size={14} color="#FFF" />
        <Text style={styles.badgeText}>FAIL</Text>
      </View>
    );
  };

  return (
    <Screen style={styles.container}>
      {/* Background Skia Canvas */}
      <View style={StyleSheet.absoluteFill}>
        {pattern && rendererState ? (
          <StitchRenderer
            key={remountKey}
            pattern={pattern}
            rendererState={rendererState}
            onCellTapped={() => {}}
            onSweepStitch={() => {}}
            gridShared={gridShared}
            completedShared={completedShared}
            activeColorIndexShared={activeColorIndexShared}
            isColorCompletedShared={isColorCompletedShared}
            scaleShared={scaleShared}
            translateXShared={translateXShared}
            translateYShared={translateYShared}
            containerWidthShared={containerWidthShared}
            containerHeightShared={containerHeightShared}
          />
        ) : (
          <View style={styles.placeholderCanvas}>
            <Ionicons name="stats-chart-outline" size={80} color={Theme.colors.border} />
            <Text style={styles.placeholderText}>Renderer inactive</Text>
          </View>
        )}
      </View>

      {/* Sleek Overlay panel */}
      <View style={styles.overlayContainer} pointerEvents="box-none">
        <View style={styles.controlPanel}>
          <View style={styles.header}>
            <Ionicons name="speedometer-outline" size={24} color={Theme.colors.accentTeal} />
            <Text style={styles.title}>Interaction Budget Harness</Text>
          </View>

          <View style={styles.deviceSettings}>
            <Text style={styles.settingsLabel}>Reference Device Mode</Text>
            <View style={styles.switchRow}>
              <Text style={styles.switchText}>
                {isRefDeviceConfirmed ? 'Designated Reference' : 'Non-Reference Device'}
              </Text>
              <Switch
                value={isRefDeviceConfirmed}
                onValueChange={setIsRefDeviceConfirmed}
                trackColor={{ false: Theme.colors.disabledBackground, true: Theme.colors.accentSage }}
                thumbColor="#FFF"
              />
            </View>
          </View>

          {/* Status banner */}
          <View style={[styles.statusBanner, styles[`banner_${runStatus}` as keyof typeof styles] as any]}>
            <Text style={styles.statusLabel}>STATUS: {runStatus.toUpperCase()}</Text>
            {progressText ? <Text style={styles.progressText}>{progressText}</Text> : null}
            {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
            {reportPath ? <Text style={styles.reportPathText}>Saved: {reportPath}</Text> : null}
          </View>

          <ScrollView style={styles.scenariosList} contentContainerStyle={styles.scrollContent}>
            {REQUIRED_SCENARIOS.map((id) => {
              const def = SCENARIOS.find((s) => s.id === id);
              if (!def) return null;
              return (
                <View key={id} style={styles.scenarioRow}>
                  <View style={styles.scenarioInfo}>
                    <Text style={styles.scenarioTitle}>{def.title}</Text>
                    <Text style={styles.scenarioDesc}>{def.description}</Text>
                  </View>
                  {getStatusBadge(id)}
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.footerActions}>
            {runStatus === 'idle' || runStatus === 'completed' || runStatus === 'cancelled' || runStatus === 'error' ? (
              <Button
                title="Start Performance Run"
                onPress={handleStartRun}
                variant="sage"
                style={styles.actionBtn}
              />
            ) : null}

            {runStatus === 'running' || runStatus === 'operator-action-required' ? (
              <Button
                title="Cancel Run"
                onPress={() => cancelRef.current?.()}
                variant="secondary"
                style={styles.actionBtn}
              />
            ) : null}

            {savedReport ? (
              <Button
                title="Share JSON Report"
                onPress={handleShare}
                variant="sage"
                style={styles.actionBtn}
              />
            ) : null}
          </View>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF6F0',
  },
  placeholderCanvas: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAF6F0',
  },
  placeholderText: {
    marginTop: 12,
    fontSize: 16,
    color: '#857D75',
    fontWeight: '500',
  },
  overlayContainer: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    padding: Theme.spacing.md,
  },
  controlPanel: {
    backgroundColor: 'rgba(30, 27, 24, 0.93)',
    borderRadius: Theme.radii.lg,
    borderWidth: 1,
    borderColor: '#EADFC9',
    padding: Theme.spacing.md,
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    marginBottom: Theme.spacing.md,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FAF6F0',
  },
  deviceSettings: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: Theme.radii.sm,
    padding: Theme.spacing.sm,
    marginBottom: Theme.spacing.sm,
  },
  settingsLabel: {
    fontSize: 12,
    color: '#857D75',
    marginBottom: 4,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchText: {
    fontSize: 14,
    color: '#FAF6F0',
    fontWeight: '500',
  },
  statusBanner: {
    padding: Theme.spacing.sm,
    borderRadius: Theme.radii.sm,
    marginBottom: Theme.spacing.md,
  },
  banner_idle: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  banner_running: {
    backgroundColor: 'rgba(122, 154, 130, 0.25)',
  },
  banner_operator_action_required: {
    backgroundColor: 'rgba(212, 163, 92, 0.25)',
  },
  banner_cancelled: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  banner_error: {
    backgroundColor: 'rgba(211, 93, 93, 0.25)',
  },
  banner_completed: {
    backgroundColor: 'rgba(91, 140, 90, 0.25)',
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FAF6F0',
    marginBottom: 2,
  },
  progressText: {
    fontSize: 13,
    color: '#FAF6F0',
  },
  errorText: {
    fontSize: 13,
    color: '#FF8888',
  },
  reportPathText: {
    fontSize: 11,
    color: '#7A9A82',
    marginTop: 4,
  },
  scenariosList: {
    maxHeight: 250,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderRadius: Theme.radii.sm,
    marginBottom: Theme.spacing.md,
  },
  scrollContent: {
    padding: Theme.spacing.sm,
    gap: Theme.spacing.sm,
  },
  scenarioRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  scenarioInfo: {
    flex: 1,
    marginRight: Theme.spacing.sm,
  },
  scenarioTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FAF6F0',
  },
  scenarioDesc: {
    fontSize: 11,
    color: '#857D75',
    marginTop: 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    minWidth: 70,
    justifyContent: 'center',
  },
  badgePending: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  badgeRunning: {
    backgroundColor: '#7A9A82',
  },
  badgePass: {
    backgroundColor: '#5B8C5A',
  },
  badgeFail: {
    backgroundColor: '#D35D5D',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#FAF6F0',
  },
  spinner: {
    marginRight: 2,
  },
  footerActions: {
    flexDirection: 'row',
    gap: Theme.spacing.sm,
  },
  actionBtn: {
    flex: 1,
  },
});
