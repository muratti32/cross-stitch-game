import React from 'react';
import { StyleSheet, View, Text, ActivityIndicator, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme/theme';
import { Card } from './Card';
import {
  useDailyTaskBoard,
  DailyTaskKey,
  DailyTaskStatus,
  DAILY_TASK_COIN,
} from '../api/dailyTasks';

const TASK_COPY: Record<
  DailyTaskKey,
  { title: string; body: string; icon: React.ComponentProps<typeof Ionicons>['name'] }
> = {
  cells_100: {
    title: '100 Stitch Actions',
    body: 'Fill 100 matching cells today',
    icon: 'grid-outline',
  },
  three_colors_10: {
    title: '3 Colors, 10 Actions Each',
    body: 'Reach 10 actions in 3 distinct thread colors',
    icon: 'color-palette-outline',
  },
  color_completion: {
    title: 'Complete a Thread Color',
    body: 'Finish stitching any one color completely',
    icon: 'checkmark-done-outline',
  },
};

function formatTimeRemaining(resetsAt: string): string {
  const diffMs = new Date(resetsAt).getTime() - Date.now();
  if (diffMs <= 0) return 'Resetting…';
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `Resets in ${minutes}m`;
  return `Resets in ${hours}h ${minutes}m`;
}

interface DailyTasksCardProps {
  /** Pass the account-vs-guest flag from the caller (e.g. `isAccount` from `useIdentityStore()`). */
  enabled: boolean;
}

export function DailyTasksCard({ enabled }: DailyTasksCardProps) {
  const { data, isLoading, isError, refetch } = useDailyTaskBoard(enabled);

  if (!enabled) {
    return null;
  }

  if (isLoading) {
    return (
      <Card style={styles.card}>
        <View style={styles.centerRow}>
          <ActivityIndicator color={Theme.colors.accentRose} />
        </View>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card style={styles.card}>
        <View style={styles.centerRow}>
          <Ionicons name="cloud-offline-outline" size={20} color={Theme.colors.error} />
          <Text style={styles.errorText}>Couldn't load Daily Tasks</Text>
          <Pressable onPress={() => refetch()} hitSlop={8}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Daily Tasks</Text>
        <View style={styles.balanceBadge}>
          <Ionicons name="disc-outline" size={14} color={Theme.colors.accentHoney} />
          <Text style={styles.balanceText}>{data.balance}</Text>
        </View>
      </View>
      <Text style={styles.resetText}>{formatTimeRemaining(data.resetsAt)}</Text>

      {data.tasks.length === 0 ? (
        <Text style={styles.emptyText}>No tasks available today.</Text>
      ) : (
        data.tasks.map((task) => <DailyTaskRow key={task.key} task={task} />)
      )}
    </Card>
  );
}

function DailyTaskRow({ task }: { task: DailyTaskStatus }) {
  const copy = TASK_COPY[task.key];
  const pct = task.target > 0 ? Math.min(1, task.progress / task.target) : 0;

  return (
    <View style={styles.taskRow}>
      <View style={styles.taskIconWrap}>
        <Ionicons
          name={task.granted ? 'checkmark-circle' : copy.icon}
          size={22}
          color={task.granted ? Theme.colors.success : Theme.colors.accentTeal}
        />
      </View>
      <View style={styles.taskInfo}>
        <Text style={styles.taskTitle}>{copy.title}</Text>
        <Text style={styles.taskBody}>{copy.body}</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct * 100}%` }]} />
        </View>
        <Text style={styles.taskProgress}>
          {task.progress}/{task.target}
        </Text>
      </View>
      <Text style={[styles.taskCoin, task.granted ? styles.taskCoinEarned : styles.taskCoinPending]}>
        +{DAILY_TASK_COIN}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: Theme.spacing.xl,
  },
  centerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Theme.spacing.sm,
    paddingVertical: Theme.spacing.sm,
  },
  errorText: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.error,
  },
  retryText: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.accentTeal,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  balanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.xs,
    backgroundColor: Theme.colors.accentHoneySoft,
    paddingVertical: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.sm,
    borderRadius: Theme.radii.full,
  },
  balanceText: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  resetText: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginTop: Theme.spacing.xs,
    marginBottom: Theme.spacing.md,
  },
  emptyText: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    paddingVertical: Theme.spacing.md,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
    gap: Theme.spacing.sm,
  },
  taskIconWrap: {
    width: 32,
    alignItems: 'center',
  },
  taskInfo: {
    flex: 1,
  },
  taskTitle: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textPrimary,
  },
  taskBody: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginTop: 2,
  },
  progressTrack: {
    height: 6,
    borderRadius: Theme.radii.full,
    backgroundColor: Theme.colors.border,
    marginTop: Theme.spacing.xs,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: Theme.radii.full,
    backgroundColor: Theme.colors.accentSage,
  },
  taskProgress: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginTop: 2,
  },
  taskCoin: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.bold,
  },
  taskCoinEarned: {
    color: Theme.colors.success,
  },
  taskCoinPending: {
    color: Theme.colors.textSecondary,
  },
});
