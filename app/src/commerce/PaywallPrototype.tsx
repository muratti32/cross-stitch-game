// PROTOTYPE — throw away after choosing a paywall direction.
// Three structural answers to “Should Premium have a dedicated paywall?”,
// switchable with ?variant=A|B|C on the existing Commerce route.
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Screen } from '@/components';
import { Theme } from '@/theme/theme';

export type PaywallPrototypeVariant = 'A' | 'B' | 'C';

export const PAYWALL_PROTOTYPE_NAMES: Record<PaywallPrototypeVariant, string> = {
  A: 'Focused Premium',
  B: 'Unified Store',
  C: 'Guided Hybrid',
};

const plans = [
  { id: 'weekly', name: 'Weekly', price: '$2.99', cadence: '/ week', credits: 3 },
  { id: 'monthly', name: 'Monthly', price: '$7.99', cadence: '/ month', credits: 15, trial: '3 days free' },
  { id: 'annual', name: 'Annual', price: '$39.99', cadence: '/ year', credits: 180, badge: 'Best value' },
] as const;

const packs = [
  { id: 'coins', icon: 'leaf-outline' as const, name: 'Stitch Coins', detail: '300 · 900 · 2,000', color: Theme.colors.accentHoney },
  { id: 'credits', icon: 'sparkles-outline' as const, name: 'AI Credits', detail: '5 · 20 · 50', color: Theme.colors.accentRose },
] as const;

interface Props {
  variant: PaywallPrototypeVariant;
}

export function PaywallPrototype({ variant }: Props) {
  if (variant === 'B') return <UnifiedStore />;
  if (variant === 'C') return <GuidedHybrid />;
  return <FocusedPremium />;
}

function FocusedPremium() {
  const [selected, setSelected] = useState('annual');
  const selectedPlan = useMemo(() => plans.find((plan) => plan.id === selected) ?? plans[2], [selected]);

  return (
    <Screen scrollable contentContainerStyle={styles.screen}>
      <PrototypeFlag label="A · Dedicated paywall" />
      <View style={styles.heroA}>
        <View style={styles.threadMark}>
          <Ionicons name="diamond-outline" size={26} color={Theme.colors.textLight} />
        </View>
        <Text style={styles.eyebrowLight}>STITCH WISH PREMIUM</Text>
        <Text style={styles.heroTitleLight}>More ways to create.{`\n`}A little reward every day.</Text>
        <Text style={styles.heroBodyLight}>AI Credits each paid period, collectible themes, and a daily Coin claim.</Text>
      </View>

      <View style={styles.benefitStrip}>
        <Benefit icon="sparkles-outline" value="180" label="AI credits / year" />
        <Benefit icon="calendar-outline" value="Daily" label="Coin claim" />
        <Benefit icon="color-palette-outline" value="3" label="Premium themes" />
      </View>

      <View style={styles.planStack}>
        {plans.map((plan) => (
          <PlanRow key={plan.id} plan={plan} selected={selected === plan.id} onPress={() => setSelected(plan.id)} />
        ))}
      </View>

      <Button title={`Continue with ${selectedPlan.name}`} onPress={() => {}} variant="rose" />
      <Text style={styles.legalCopy}>Auto-renewing subscription. Cancel anytime. Restore purchases</Text>
    </Screen>
  );
}

function UnifiedStore() {
  const [selected, setSelected] = useState('annual');

  return (
    <Screen scrollable contentContainerStyle={styles.screen}>
      <PrototypeFlag label="B · One commerce store" />
      <View style={styles.walletHeader}>
        <View>
          <Text style={styles.eyebrowDark}>YOUR WALLET</Text>
          <Text style={styles.storeTitle}>Get more from Stitch Wish</Text>
        </View>
        <View style={styles.walletPill}><Text style={styles.walletPillText}>120 ◉   4 ✦</Text></View>
      </View>

      <Card style={styles.memberShelf}>
        <View style={styles.memberShelfHeader}>
          <View style={styles.iconTitle}>
            <Ionicons name="diamond-outline" size={22} color={Theme.colors.accentRose} />
            <Text style={styles.memberShelfTitle}>Premium Membership</Text>
          </View>
          <Text style={styles.smallLink}>Compare</Text>
        </View>
        <Text style={styles.shelfBody}>Recurring credits + daily Coins + themes</Text>
        <View style={styles.compactPlanRow}>
          {plans.map((plan) => (
            <Pressable key={plan.id} onPress={() => setSelected(plan.id)} style={[styles.compactPlan, selected === plan.id && styles.compactPlanSelected]}>
              <Text style={styles.compactPlanName}>{plan.name}</Text>
              <Text style={styles.compactPlanPrice}>{plan.price}</Text>
            </Pressable>
          ))}
        </View>
        <Button title="Join Premium" onPress={() => {}} variant="rose" style={styles.shelfButton} />
      </Card>

      <Text style={styles.sectionHeading}>One-time packs</Text>
      {packs.map((pack) => (
        <Card key={pack.id} style={styles.packShelf}>
          <View style={[styles.packIcon, { backgroundColor: `${pack.color}22` }]}>
            <Ionicons name={pack.icon} size={24} color={pack.color} />
          </View>
          <View style={styles.flexOne}>
            <Text style={styles.packName}>{pack.name}</Text>
            <Text style={styles.packDetail}>{pack.detail}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Theme.colors.textSecondary} />
        </Card>
      ))}

      <View style={styles.utilityRow}>
        <Text style={styles.smallLink}>Restore purchases</Text>
        <Text style={styles.smallLink}>Purchase help</Text>
      </View>
    </Screen>
  );
}

function GuidedHybrid() {
  const [mode, setMode] = useState<'membership' | 'topup'>('membership');
  const [selected, setSelected] = useState('monthly');

  return (
    <Screen scrollable contentContainerStyle={styles.screen}>
      <PrototypeFlag label="C · Guided hybrid" />
      <Text style={styles.eyebrowDark}>CHOOSE WHAT YOU NEED</Text>
      <Text style={styles.hybridTitle}>How do you want to create?</Text>

      <View style={styles.segmented}>
        <Pressable onPress={() => setMode('membership')} style={[styles.segment, mode === 'membership' && styles.segmentActive]}>
          <Text style={[styles.segmentText, mode === 'membership' && styles.segmentTextActive]}>Create regularly</Text>
        </Pressable>
        <Pressable onPress={() => setMode('topup')} style={[styles.segment, mode === 'topup' && styles.segmentActive]}>
          <Text style={[styles.segmentText, mode === 'topup' && styles.segmentTextActive]}>Just top up</Text>
        </Pressable>
      </View>

      {mode === 'membership' ? (
        <>
          <Card style={styles.hybridFeature}>
            <View style={styles.hybridFeatureTop}>
              <Ionicons name="sparkles" size={24} color={Theme.colors.accentRose} />
              <Text style={styles.hybridFeatureTitle}>A steady creative rhythm</Text>
            </View>
            <Text style={styles.shelfBody}>Credits arrive each paid period. Daily Coins and themes stay available while Premium is active.</Text>
          </Card>
          <View style={styles.planStack}>
            {plans.map((plan) => (
              <PlanRow key={plan.id} plan={plan} selected={selected === plan.id} onPress={() => setSelected(plan.id)} />
            ))}
          </View>
          <Button title="Start Premium" onPress={() => {}} variant="rose" />
        </>
      ) : (
        <>
          <Text style={styles.modeHelp}>No subscription. Pick a balance to top up once.</Text>
          {packs.map((pack) => (
            <Card key={pack.id} style={styles.topupCard}>
              <View style={[styles.packIcon, { backgroundColor: `${pack.color}22` }]}>
                <Ionicons name={pack.icon} size={24} color={pack.color} />
              </View>
              <View style={styles.flexOne}>
                <Text style={styles.packName}>{pack.name}</Text>
                <Text style={styles.packDetail}>{pack.detail}</Text>
              </View>
              <Button title="View" onPress={() => {}} variant={pack.id === 'coins' ? 'honey' : 'rose'} style={styles.viewButton} />
            </Card>
          ))}
          <Text style={styles.modeHelp}>Premium is optional. AI Credits never expire when membership ends.</Text>
        </>
      )}
    </Screen>
  );
}

function PrototypeFlag({ label }: { label: string }) {
  return <View style={styles.prototypeFlag}><Text style={styles.prototypeFlagText}>PROTOTYPE · {label}</Text></View>;
}

function Benefit({ icon, value, label }: { icon: React.ComponentProps<typeof Ionicons>['name']; value: string; label: string }) {
  return (
    <View style={styles.benefit}>
      <Ionicons name={icon} size={20} color={Theme.colors.accentRose} />
      <Text style={styles.benefitValue}>{value}</Text>
      <Text style={styles.benefitLabel}>{label}</Text>
    </View>
  );
}

function PlanRow({ plan, selected, onPress }: { plan: typeof plans[number]; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.planRow, selected && styles.planRowSelected]}>
      <View style={[styles.radio, selected && styles.radioSelected]}>{selected && <View style={styles.radioDot} />}</View>
      <View style={styles.flexOne}>
        <View style={styles.iconTitle}>
          <Text style={styles.planName}>{plan.name}</Text>
          {'badge' in plan && plan.badge ? <Text style={styles.badge}>{plan.badge}</Text> : null}
          {'trial' in plan && plan.trial ? <Text style={styles.trialBadge}>{plan.trial}</Text> : null}
        </View>
        <Text style={styles.planDetail}>{plan.credits} AI Credits per paid period</Text>
      </View>
      <View style={styles.priceBlock}>
        <Text style={styles.planPrice}>{plan.price}</Text>
        <Text style={styles.cadence}>{plan.cadence}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { padding: Theme.spacing.lg, paddingTop: Theme.spacing.xl, gap: Theme.spacing.lg },
  prototypeFlag: { alignSelf: 'flex-start', backgroundColor: Theme.colors.textPrimary, borderRadius: Theme.radii.full, paddingHorizontal: 10, paddingVertical: 5 },
  prototypeFlagText: { color: Theme.colors.textLight, fontSize: 10, fontWeight: Theme.typography.weights.bold, letterSpacing: 0.8 },
  heroA: { backgroundColor: Theme.colors.accentTeal, borderRadius: Theme.radii.xl, padding: Theme.spacing.xl, gap: Theme.spacing.sm, overflow: 'hidden' },
  threadMark: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center', marginBottom: Theme.spacing.sm },
  eyebrowLight: { color: '#E8DCC7', fontSize: 11, fontWeight: Theme.typography.weights.bold, letterSpacing: 1.3 },
  eyebrowDark: { color: Theme.colors.accentRose, fontSize: 11, fontWeight: Theme.typography.weights.bold, letterSpacing: 1.3 },
  heroTitleLight: { color: Theme.colors.textLight, fontSize: 28, lineHeight: 34, fontWeight: Theme.typography.weights.bold },
  heroBodyLight: { color: '#F1EAE0', fontSize: Theme.typography.sizes.sm, lineHeight: 21 },
  benefitStrip: { flexDirection: 'row', gap: Theme.spacing.sm },
  benefit: { flex: 1, alignItems: 'center', backgroundColor: Theme.colors.card, borderRadius: Theme.radii.md, borderWidth: 1, borderColor: Theme.colors.border, paddingVertical: Theme.spacing.md, paddingHorizontal: Theme.spacing.xs },
  benefitValue: { color: Theme.colors.textPrimary, fontWeight: Theme.typography.weights.bold, marginTop: 4 },
  benefitLabel: { color: Theme.colors.textSecondary, fontSize: 9, textAlign: 'center', marginTop: 2 },
  planStack: { gap: Theme.spacing.sm },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.md, backgroundColor: Theme.colors.card, borderRadius: Theme.radii.lg, borderWidth: 1, borderColor: Theme.colors.border, padding: Theme.spacing.md },
  planRowSelected: { borderWidth: 2, borderColor: Theme.colors.accentRose, backgroundColor: '#FFF8F8' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: Theme.colors.textSecondary, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: Theme.colors.accentRose },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Theme.colors.accentRose },
  planName: { color: Theme.colors.textPrimary, fontWeight: Theme.typography.weights.bold, fontSize: Theme.typography.sizes.sm },
  planDetail: { color: Theme.colors.textSecondary, fontSize: 11, marginTop: 3 },
  priceBlock: { alignItems: 'flex-end' },
  planPrice: { color: Theme.colors.textPrimary, fontWeight: Theme.typography.weights.bold, fontSize: Theme.typography.sizes.md },
  cadence: { color: Theme.colors.textSecondary, fontSize: 10 },
  badge: { color: Theme.colors.textLight, backgroundColor: Theme.colors.accentTeal, borderRadius: Theme.radii.full, paddingHorizontal: 7, paddingVertical: 2, fontSize: 9, fontWeight: Theme.typography.weights.bold },
  trialBadge: { color: Theme.colors.success, backgroundColor: '#EDF7EF', borderRadius: Theme.radii.full, paddingHorizontal: 7, paddingVertical: 2, fontSize: 9, fontWeight: Theme.typography.weights.bold },
  legalCopy: { textAlign: 'center', color: Theme.colors.textSecondary, fontSize: 10, lineHeight: 15 },
  walletHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Theme.spacing.md },
  storeTitle: { color: Theme.colors.textPrimary, fontSize: Theme.typography.sizes.xxl, lineHeight: 29, fontWeight: Theme.typography.weights.bold, maxWidth: 235, marginTop: 4 },
  walletPill: { backgroundColor: Theme.colors.accentHoneySoft, borderRadius: Theme.radii.full, paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.sm },
  walletPillText: { color: Theme.colors.textPrimary, fontSize: 11, fontWeight: Theme.typography.weights.bold },
  memberShelf: { gap: Theme.spacing.md, borderColor: '#E8C8CD', borderWidth: 1.5 },
  memberShelfHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  iconTitle: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm, flexWrap: 'wrap' },
  memberShelfTitle: { fontSize: Theme.typography.sizes.lg, color: Theme.colors.textPrimary, fontWeight: Theme.typography.weights.bold },
  smallLink: { fontSize: Theme.typography.sizes.xs, color: Theme.colors.accentTeal, fontWeight: Theme.typography.weights.semibold },
  shelfBody: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.sm, lineHeight: 20 },
  compactPlanRow: { flexDirection: 'row', gap: Theme.spacing.sm },
  compactPlan: { flex: 1, borderWidth: 1, borderColor: Theme.colors.border, borderRadius: Theme.radii.md, padding: Theme.spacing.sm, alignItems: 'center' },
  compactPlanSelected: { borderColor: Theme.colors.accentRose, backgroundColor: '#FFF4F5' },
  compactPlanName: { color: Theme.colors.textSecondary, fontSize: 10, fontWeight: Theme.typography.weights.semibold },
  compactPlanPrice: { color: Theme.colors.textPrimary, fontSize: Theme.typography.sizes.sm, fontWeight: Theme.typography.weights.bold, marginTop: 3 },
  shelfButton: { marginTop: Theme.spacing.xs },
  sectionHeading: { color: Theme.colors.textPrimary, fontSize: Theme.typography.sizes.lg, fontWeight: Theme.typography.weights.bold },
  packShelf: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.md },
  packIcon: { width: 48, height: 48, borderRadius: Theme.radii.md, alignItems: 'center', justifyContent: 'center' },
  packName: { color: Theme.colors.textPrimary, fontWeight: Theme.typography.weights.bold },
  packDetail: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.xs, marginTop: 3 },
  flexOne: { flex: 1 },
  utilityRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: Theme.spacing.md },
  hybridTitle: { color: Theme.colors.textPrimary, fontSize: 30, lineHeight: 36, fontWeight: Theme.typography.weights.bold, marginTop: -10 },
  segmented: { flexDirection: 'row', backgroundColor: '#EEE5D8', borderRadius: Theme.radii.full, padding: 4 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: Theme.radii.full },
  segmentActive: { backgroundColor: Theme.colors.card },
  segmentText: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.sm, fontWeight: Theme.typography.weights.semibold },
  segmentTextActive: { color: Theme.colors.textPrimary },
  hybridFeature: { backgroundColor: '#FFF7EF', borderColor: '#EEDBC6', gap: Theme.spacing.sm },
  hybridFeatureTop: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm },
  hybridFeatureTitle: { color: Theme.colors.textPrimary, fontSize: Theme.typography.sizes.lg, fontWeight: Theme.typography.weights.bold },
  modeHelp: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.sm, lineHeight: 20 },
  topupCard: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.md },
  viewButton: { height: 40, paddingHorizontal: Theme.spacing.md },
});
