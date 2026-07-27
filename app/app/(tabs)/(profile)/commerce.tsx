import React, { useEffect, useState, useCallback } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, SectionList, Pressable, Alert } from 'react-native';
import { Screen, Card, Button, EmptyState } from '@/components';
import { Theme } from '@/theme/theme';
import { Ionicons } from '@expo/vector-icons';
import { useIdentityStore } from '@/identity/guestIdentity';
import { useCoinBalance } from '@/api/economy';
import { useAiCreditBalance } from '@/api/commerce';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import Purchases, { PurchasesPackage } from 'react-native-purchases';
import { useMembership, usePremiumDailyClaim } from '@/api/membership';
import {
  MEMBERSHIP_THEMES,
  useActiveMembershipTheme,
} from '@/membership/themes';
import { captureGameplayEvent } from '@/analytics/gameplayEvents';
import type { PurchaseProductKind } from '@/analytics/schema';

// Keys are the store product identifiers exactly as registered in App Store
// Connect and Google Play (ADR-0043).
const PREMIUM_PLAN_DESCRIPTIONS: Record<string, { label: string; credits: number; trial: boolean }> = {
  'com.avk.stitchwish.premium_weekly': { label: 'Weekly Premium', credits: 3, trial: false },
  'com.avk.stitchwish.premium_monthly': { label: 'Monthly Premium', credits: 15, trial: true },
  'com.avk.stitchwish.premium_annual': { label: 'Annual Premium', credits: 180, trial: false },
};

const COIN_PACK_DESCRIPTIONS: Record<string, { coins: number }> = {
  'com.avk.stitchwish.coin_pack_300': { coins: 300 },
  'com.avk.stitchwish.coin_pack_900': { coins: 900 },
  'com.avk.stitchwish.coin_pack_2000': { coins: 2000 },
};

const AI_CREDIT_PACK_DESCRIPTIONS: Record<string, { credits: number }> = {
  'com.avk.stitchwish.ai_credit_pack_5': { credits: 5 },
  'com.avk.stitchwish.ai_credit_pack_20': { credits: 20 },
  'com.avk.stitchwish.ai_credit_pack_50': { credits: 50 },
};

interface PackItem {
  id: string;
  productId: string;
  package: PurchasesPackage;
  amount: number;
  label: string;
}

function productKindForPackage(pkg: PurchasesPackage): PurchaseProductKind | null {
  if (matchingProductId(pkg, PREMIUM_PLAN_DESCRIPTIONS)) {
    return 'premium_membership';
  }
  if (matchingProductId(pkg, COIN_PACK_DESCRIPTIONS)) {
    return 'stitch_coin_pack';
  }
  if (matchingProductId(pkg, AI_CREDIT_PACK_DESCRIPTIONS)) {
    return 'ai_credit_pack';
  }
  return null;
}

function isPurchaseCancelled(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'userCancelled' in error
    && error.userCancelled === true
  );
}

function purchaseErrorMessage(error: unknown): string | null {
  return (
    typeof error === 'object'
    && error !== null
    && 'message' in error
    && typeof error.message === 'string'
  )
    ? error.message
    : null;
}

export default function CommerceScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isAccount } = useIdentityStore();
  const { data: coinBalance } = useCoinBalance();
  const { data: aiCreditBalance } = useAiCreditBalance();
  const { data: membership } = useMembership();
  const dailyClaim = usePremiumDailyClaim();
  const { theme, themeAccess, selectTheme } = useActiveMembershipTheme();

  const [offerings, setOfferings] = useState<PackItem[]>([]);
  const [loadingOfferings, setLoadingOfferings] = useState(true);
  const [offeringsError, setOfferingsError] = useState<string | null>(null);
  const [purchasingPackageId, setPurchasingPackageId] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [restoringPurchases, setRestoringPurchases] = useState(false);

  useEffect(() => {
    if (!isAccount) return;
    loadOfferings();
  }, [isAccount]);

  const loadOfferings = async () => {
    try {
      setLoadingOfferings(true);
      setOfferingsError(null);
      const data = await Purchases.getOfferings();

      if (data.current === null) {
        setOfferingsError('No offerings available.');
        return;
      }

      const packages = data.current.availablePackages;
      const coinPacks: PackItem[] = [];
      const aiPacks: PackItem[] = [];
      const premiumPlans: PackItem[] = [];

      for (const pkg of packages) {
        const productId = matchingProductId(pkg, PREMIUM_PLAN_DESCRIPTIONS);
        const desc = productId ? PREMIUM_PLAN_DESCRIPTIONS[productId] : undefined;
        if (desc && productId) {
          premiumPlans.push({
            id: pkg.identifier,
            productId,
            package: pkg,
            amount: desc.credits,
            label: desc.label,
          });
        }
      }

      for (const pkg of packages) {
        const productId = matchingProductId(pkg, COIN_PACK_DESCRIPTIONS);
        const desc = productId ? COIN_PACK_DESCRIPTIONS[productId] : undefined;
        if (desc && productId) {
          coinPacks.push({
            id: pkg.identifier,
            productId,
            package: pkg,
            amount: desc.coins,
            label: `${desc.coins} Coins`,
          });
        }
      }

      for (const pkg of packages) {
        const productId = matchingProductId(pkg, AI_CREDIT_PACK_DESCRIPTIONS);
        const desc = productId ? AI_CREDIT_PACK_DESCRIPTIONS[productId] : undefined;
        if (desc && productId) {
          aiPacks.push({
            id: pkg.identifier,
            productId,
            package: pkg,
            amount: desc.credits,
            label: `${desc.credits} AI Credits`,
          });
        }
      }

      setOfferings([...premiumPlans, ...coinPacks, ...aiPacks]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load offerings';
      setOfferingsError(message);
      console.error('Failed to load RevenueCat offerings:', err);
    } finally {
      setLoadingOfferings(false);
    }
  };

  const handlePurchase = useCallback(async (pkg: PurchasesPackage) => {
    setPurchaseError(null);
    setPurchasingPackageId(pkg.identifier);
    const productKind = productKindForPackage(pkg);
    if (productKind) {
      await captureGameplayEvent('purchase_started', { product_kind: productKind });
    }
    try {
      await Purchases.purchasePackage(pkg);
      if (productKind) {
        await captureGameplayEvent('purchase_completed', { product_kind: productKind });
      }
      setShowSuccessMessage(true);
      await new Promise(r => setTimeout(r, 500));
      await refetchBalances();
      await new Promise(r => setTimeout(r, 2000));
      await refetchBalances();
      await new Promise(r => setTimeout(r, 2500));
      await refetchBalances();
    } catch (err: unknown) {
      if (isPurchaseCancelled(err)) {
        if (productKind) {
          await captureGameplayEvent('purchase_cancelled', { product_kind: productKind });
        }
        return;
      }
      if (productKind) {
        await captureGameplayEvent('purchase_failed', {
          product_kind: productKind,
          failure_stage: 'store',
        });
      }
      const message = purchaseErrorMessage(err);
      if (message) {
        setPurchaseError(message);
      } else if (err instanceof Error) {
        setPurchaseError(err.message);
      } else {
        setPurchaseError('Purchase failed. Please try again.');
      }
      console.error('Purchase error:', err);
    } finally {
      setPurchasingPackageId(null);
      setShowSuccessMessage(false);
    }
  }, [queryClient]);

  const refetchBalances = async () => {
    await queryClient.refetchQueries({ queryKey: ['economy', 'balance'] });
    await queryClient.refetchQueries({ queryKey: ['economy', 'aiCreditBalance'] });
    await queryClient.refetchQueries({ queryKey: ['commerce', 'membership'] });
  };

  const handleRestorePurchases = useCallback(async () => {
    setRestoringPurchases(true);
    setPurchaseError(null);
    try {
      await Purchases.restorePurchases();
      setShowSuccessMessage(true);
      await new Promise(r => setTimeout(r, 500));
      await refetchBalances();
      await new Promise(r => setTimeout(r, 2000));
      await refetchBalances();
      Alert.alert('Success', 'Purchases restored successfully');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to restore purchases';
      setPurchaseError(message);
      console.error('Restore purchases error:', err);
    } finally {
      setRestoringPurchases(false);
      setShowSuccessMessage(false);
    }
  }, [queryClient]);

  if (!isAccount) {
    return (
      <Screen scrollable contentContainerStyle={styles.container}>
        <EmptyState
          icon="lock-closed-outline"
          title="Sign in to Purchase"
          body="A Registered Account is required to purchase Stitch Coins and AI Credits. Sign in to protect your progress and unlock commerce features."
          actionLabel="Sign in"
          onAction={() => router.push('/(tabs)/(settings)/sign-in')}
          actionVariant="rose"
        />
      </Screen>
    );
  }

  const premiumPlans = offerings.filter(p => p.productId in PREMIUM_PLAN_DESCRIPTIONS);
  const coinPacks = offerings.filter(p => p.productId in COIN_PACK_DESCRIPTIONS);
  const aiPacks = offerings.filter(p => p.productId in AI_CREDIT_PACK_DESCRIPTIONS);

  return (
    <Screen scrollable contentContainerStyle={styles.container}>
      {/* Balances Section */}
      <View style={styles.balanceSection}>
        <View style={styles.balanceCard}>
          <View style={styles.balanceContent}>
            <Ionicons name="wallet-outline" size={20} color={Theme.colors.accentHoney} />
            <View style={styles.balanceTextGroup}>
              <Text style={styles.balanceLabel}>Stitch Coins</Text>
              <Text style={styles.balanceValue}>{coinBalance ?? 0}</Text>
            </View>
          </View>
        </View>

        <View style={styles.balanceCard}>
          <View style={styles.balanceContent}>
            <Ionicons name="sparkles-outline" size={20} color={Theme.colors.accentRose} />
            <View style={styles.balanceTextGroup}>
              <Text style={styles.balanceLabel}>AI Credits</Text>
              <Text style={styles.balanceValue}>{aiCreditBalance ?? 0}</Text>
            </View>
          </View>
        </View>
      </View>

      <Card style={styles.membershipCard}>
        <View style={styles.membershipHeader}>
          <View style={styles.membershipTitleRow}>
            <Ionicons name="diamond-outline" size={22} color={Theme.colors.accentRose} />
            <Text style={styles.membershipTitle}>Premium Membership</Text>
          </View>
          {membership?.active && (
            <View style={styles.activeBadge}>
              <Text style={styles.activeBadgeText}>
                {membership.lifecycle === 'trial' ? 'TRIAL' : 'ACTIVE'}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.membershipDescription}>
          AI Credits each paid period, one daily shared-pool Coin claim, and cosmetic themes.
        </Text>
        {membership?.active && (
          <>
            <Text style={styles.membershipMeta}>
              {membership.plan ? `${capitalize(membership.plan)} plan` : 'Premium'}
              {membership.expiresAt
                ? ` · current period ends ${new Date(membership.expiresAt).toLocaleDateString()}`
                : ''}
            </Text>
            <Button
              title={
                membership.dailyClaim.claimed
                  ? 'Daily Coin Claimed'
                  : membership.dailyClaim.coinsAvailable > 0
                    ? `Claim ${membership.dailyClaim.coinsAvailable} Coins`
                    : "Complete Today's Claim"
              }
              onPress={() => dailyClaim.mutate()}
              disabled={membership.dailyClaim.claimed || dailyClaim.isPending}
              loading={dailyClaim.isPending}
              variant="honey"
              style={styles.dailyClaimButton}
            />
            {dailyClaim.data && !dailyClaim.isPending && (
              <Text style={styles.claimResult}>
                {dailyClaim.data.amount > 0
                  ? `${dailyClaim.data.amount} Coins added.`
                  : "Today's pool was already exhausted; the claim is recorded."}
              </Text>
            )}
            {dailyClaim.error && (
              <Text style={styles.claimError}>{dailyClaim.error.message}</Text>
            )}
          </>
        )}

        <Text style={styles.themeTitle}>Theme Collection</Text>
        <View style={styles.themeRow}>
          {MEMBERSHIP_THEMES.map((candidate) => {
            const locked = candidate.premium && !themeAccess;
            const selected = theme.id === candidate.id;
            return (
              <Pressable
                key={candidate.id}
                onPress={() => {
                  if (!locked) void selectTheme(candidate.id);
                }}
                disabled={locked}
                style={[
                  styles.themeOption,
                  { backgroundColor: candidate.gridBackground },
                  selected && styles.themeOptionSelected,
                  locked && styles.themeOptionLocked,
                ]}
              >
                <Ionicons
                  name={locked ? 'lock-closed-outline' : 'color-palette-outline'}
                  size={18}
                  color={candidate.celebrationAccent}
                />
                <Text style={styles.themeOptionText}>{candidate.name}</Text>
              </Pressable>
            );
          })}
        </View>
        {!themeAccess && (
          <Text style={styles.themeHelp}>Premium themes automatically revert to Classic Linen when access ends.</Text>
        )}
      </Card>

      {/* Error Message */}
      {purchaseError && (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle-outline" size={18} color={Theme.colors.error} />
          <Text style={styles.errorText}>{purchaseError}</Text>
        </View>
      )}

      {/* Success Message */}
      {showSuccessMessage && (
        <View style={styles.successBanner}>
          <Ionicons name="checkmark-circle-outline" size={18} color={Theme.colors.success} />
          <Text style={styles.successText}>Purchase complete — your balance will update shortly</Text>
        </View>
      )}

      {/* Loading State */}
      {loadingOfferings ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Theme.colors.accentRose} />
          <Text style={styles.loadingText}>Loading available packs...</Text>
        </View>
      ) : offeringsError ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorLabel}>Unable to load offerings</Text>
          <Text style={styles.errorDescription}>{offeringsError}</Text>
          <Button
            title="Try Again"
            onPress={loadOfferings}
            variant="rose"
            style={styles.retryButton}
          />
        </View>
      ) : (
        <>
          {premiumPlans.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Premium Plans</Text>
              <View style={styles.packsList}>
                {premiumPlans.map((item) => {
                  const description = PREMIUM_PLAN_DESCRIPTIONS[item.productId];
                  return (
                    <Card key={item.id} style={styles.packCard}>
                      <View style={styles.packInfo}>
                        <View style={styles.packTextGroup}>
                          <Text style={styles.packLabel}>{item.label}</Text>
                          <Text style={styles.packDetail}>
                            {description.credits} AI Credits per paid period
                            {description.trial
                              ? ' · eligible players: 3-day trial, 0 trial credits'
                              : ''}
                          </Text>
                          <Text style={styles.packPrice}>{item.package.product.priceString}</Text>
                        </View>
                      </View>
                      <Button
                        title={purchasingPackageId === item.id ? '' : 'Choose'}
                        onPress={() => void handlePurchase(item.package)}
                        variant="rose"
                        loading={purchasingPackageId === item.id}
                        disabled={purchasingPackageId !== null}
                        style={styles.buyButton}
                      />
                    </Card>
                  );
                })}
              </View>
            </>
          )}

          {/* Coin Packs */}
          {coinPacks.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Stitch Coin Packs</Text>
              <View style={styles.packsList}>
                {coinPacks.map((item) => (
                  <Card key={item.id} style={styles.packCard}>
                    <View style={styles.packInfo}>
                      <View style={styles.packTextGroup}>
                        <Text style={styles.packLabel}>{item.label}</Text>
                        <Text style={styles.packPrice}>
                          {item.package.product.priceString}
                        </Text>
                      </View>
                    </View>
                    <Button
                      title={purchasingPackageId === item.id ? '' : 'Buy'}
                      onPress={() => void handlePurchase(item.package)}
                      variant="honey"
                      loading={purchasingPackageId === item.id}
                      disabled={purchasingPackageId !== null}
                      style={styles.buyButton}
                    />
                  </Card>
                ))}
              </View>
            </>
          )}

          {/* AI Credit Packs */}
          {aiPacks.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>AI Credit Packs</Text>
              <View style={styles.packsList}>
                {aiPacks.map((item) => (
                  <Card key={item.id} style={styles.packCard}>
                    <View style={styles.packInfo}>
                      <View style={styles.packTextGroup}>
                        <Text style={styles.packLabel}>{item.label}</Text>
                        <Text style={styles.packPrice}>
                          {item.package.product.priceString}
                        </Text>
                      </View>
                    </View>
                    <Button
                      title={purchasingPackageId === item.id ? '' : 'Buy'}
                      onPress={() => void handlePurchase(item.package)}
                      variant="rose"
                      loading={purchasingPackageId === item.id}
                      disabled={purchasingPackageId !== null}
                      style={styles.buyButton}
                    />
                  </Card>
                ))}
              </View>
            </>
          )}

          {/* Restore Purchases */}
          <View style={styles.restoreSection}>
            <Button
              title={restoringPurchases ? '' : 'Restore Previous Purchases'}
              onPress={handleRestorePurchases}
              loading={restoringPurchases}
              disabled={restoringPurchases}
              variant="secondary"
              style={styles.restoreButton}
            />
            <Text style={styles.restoreHelpText}>
              If you've purchased on another device or after reinstalling, tap here to restore your purchases.
            </Text>
          </View>
        </>
      )}
    </Screen>
  );
}

function matchingProductId(
  pkg: PurchasesPackage,
  catalog: Readonly<Record<string, unknown>>,
): string | null {
  return [pkg.identifier, pkg.product.identifier].find((candidate) => candidate in catalog) ?? null;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Theme.spacing.lg,
    paddingTop: Theme.spacing.xl,
    paddingBottom: Theme.spacing.xxl,
  },
  balanceSection: {
    gap: Theme.spacing.md,
    marginBottom: Theme.spacing.xl,
  },
  balanceCard: {
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.lg,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    padding: Theme.spacing.lg,
  },
  balanceContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.md,
  },
  balanceTextGroup: {
    flex: 1,
  },
  balanceLabel: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    fontWeight: Theme.typography.weights.medium,
  },
  balanceValue: {
    fontSize: Theme.typography.sizes.lg,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
    marginTop: Theme.spacing.xs,
  },
  membershipCard: {
    marginBottom: Theme.spacing.lg,
    gap: Theme.spacing.sm,
  },
  membershipHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  membershipTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
  },
  membershipTitle: {
    fontSize: Theme.typography.sizes.lg,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  activeBadge: {
    backgroundColor: '#EDF7EF',
    borderRadius: Theme.radii.full,
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: Theme.spacing.xs,
  },
  activeBadgeText: {
    fontSize: 10,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.success,
  },
  membershipDescription: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    lineHeight: 20,
  },
  membershipMeta: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textPrimary,
    fontWeight: Theme.typography.weights.semibold,
  },
  dailyClaimButton: {
    marginTop: Theme.spacing.sm,
  },
  claimResult: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.success,
    textAlign: 'center',
  },
  claimError: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.error,
    textAlign: 'center',
  },
  themeTitle: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
    marginTop: Theme.spacing.md,
  },
  themeRow: {
    flexDirection: 'row',
    gap: Theme.spacing.sm,
  },
  themeOption: {
    flex: 1,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Theme.spacing.xs,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.md,
    padding: Theme.spacing.xs,
  },
  themeOptionSelected: {
    borderWidth: 2,
    borderColor: Theme.colors.accentRose,
  },
  themeOptionLocked: {
    opacity: 0.5,
  },
  themeOptionText: {
    fontSize: 10,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textPrimary,
    textAlign: 'center',
  },
  themeHelp: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    lineHeight: 16,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    backgroundColor: '#FDF2F2',
    borderWidth: 1,
    borderColor: '#FBD5D5',
    borderRadius: Theme.radii.md,
    padding: Theme.spacing.md,
    marginBottom: Theme.spacing.lg,
  },
  errorText: {
    flex: 1,
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.error,
    fontWeight: Theme.typography.weights.medium,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    backgroundColor: '#F0F7F0',
    borderWidth: 1,
    borderColor: '#C8E6C9',
    borderRadius: Theme.radii.md,
    padding: Theme.spacing.md,
    marginBottom: Theme.spacing.lg,
  },
  successText: {
    flex: 1,
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.success,
    fontWeight: Theme.typography.weights.medium,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Theme.spacing.xxl,
  },
  loadingText: {
    marginTop: Theme.spacing.md,
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
  },
  errorContainer: {
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.lg,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    padding: Theme.spacing.lg,
    alignItems: 'center',
    marginVertical: Theme.spacing.md,
  },
  errorLabel: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
    marginBottom: Theme.spacing.sm,
  },
  errorDescription: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: Theme.spacing.lg,
  },
  retryButton: {
    minWidth: 140,
  },
  sectionTitle: {
    fontSize: Theme.typography.sizes.lg,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
    marginTop: Theme.spacing.lg,
    marginBottom: Theme.spacing.md,
  },
  packsList: {
    gap: Theme.spacing.md,
    marginBottom: Theme.spacing.lg,
  },
  packCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.lg,
    paddingVertical: Theme.spacing.md,
  },
  packInfo: {
    flex: 1,
  },
  packTextGroup: {
    gap: Theme.spacing.xs,
  },
  packLabel: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textPrimary,
  },
  packDetail: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    lineHeight: 16,
  },
  packPrice: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    fontWeight: Theme.typography.weights.medium,
  },
  buyButton: {
    width: 80,
    height: 40,
  },
  restoreSection: {
    marginTop: Theme.spacing.xl,
    marginBottom: Theme.spacing.lg,
  },
  restoreButton: {
    marginBottom: Theme.spacing.md,
  },
  restoreHelpText: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 16,
  },
});
