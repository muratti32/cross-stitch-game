import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { fetchAiCreditBalance, useAiCreditBalance } from '@/api/commerce';
import { useCoinBalance } from '@/api/economy';
import {
  createPremiumReconciliation,
  fetchMembership,
  useMembership,
  usePremiumDailyClaim,
  type MembershipView,
} from '@/api/membership';
import { captureGameplayEvent } from '@/analytics/gameplayEvents';
import {
  commerceProductsFromOfferings,
  productsInCategory,
  type CommerceCategory,
  type CommerceProduct,
} from '@/commerce/catalog';
import {
  commerceEntrySource,
  useCommerceIntentStore,
} from '@/commerce/commerceIntent';
import {
  getRevenueCatOfferings,
  isRevenueCatTrialEligible,
  missingCanonicalRevenueCatProducts,
  purchaseRevenueCatPackage,
  restoreRevenueCatPurchases,
  showRevenueCatManageSubscriptions,
  useRevenueCatRuntime,
} from '@/commerce/revenueCat';
import { Button, Card, Screen } from '@/components';
import { useIdentityStore } from '@/identity/guestIdentity';
import {
  MEMBERSHIP_THEMES,
  type MembershipThemeId,
  useActiveMembershipTheme,
} from '@/membership/themes';
import { Theme } from '@/theme/theme';

const RECONCILIATION_POLL_MS = 2_000;
const RECONCILIATION_DELAY_MS = 10_000;

interface PremiumReconciliation {
  readonly baselineMembership: string | null;
  readonly failureStage: 'verification' | 'grant' | null;
  readonly id: string;
  readonly operation: 'purchase' | 'restore';
  readonly product: CommerceProduct;
  readonly prolonged: boolean;
  readonly startedAt: number;
  readonly supportReference: string | null;
}

export default function CommerceScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ source?: string }>();
  const queryClient = useQueryClient();
  const { accountId, isAccount } = useIdentityStore();
  const revenueCatRuntime = useRevenueCatRuntime();
  const pendingIntent = useCommerceIntentStore((state) => state.intent);
  const preserveIntent = useCommerceIntentStore((state) => state.preserveIntent);
  const clearIntent = useCommerceIntentStore((state) => state.clearIntent);
  const source = commerceEntrySource(params.source);

  const { data: coinBalance } = useCoinBalance();
  const { data: aiCreditBalance } = useAiCreditBalance(isAccount);
  const { data: membership } = useMembership(isAccount);
  const dailyClaim = usePremiumDailyClaim();
  const { theme, themeAccess, selectTheme } = useActiveMembershipTheme(isAccount);

  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [loadingStore, setLoadingStore] = useState(true);
  const [storeUnavailable, setStoreUnavailable] = useState(false);
  const [selectedPremiumKey, setSelectedPremiumKey] = useState<string>(
    pendingIntent?.category === 'premium' ? pendingIntent.productKey : 'premium_annual',
  );
  const [openCategory, setOpenCategory] = useState<CommerceCategory | null>(null);
  const [purchasingKey, setPurchasingKey] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseSuccess, setPurchaseSuccess] = useState<string | null>(null);
  const [confirmingPremium, setConfirmingPremium] = useState<CommerceProduct | null>(null);
  const [monthlyTrialEligible, setMonthlyTrialEligible] = useState(false);
  const [purchasePending, setPurchasePending] = useState<PremiumReconciliation | null>(null);
  const [restoringPurchases, setRestoringPurchases] = useState(false);
  const viewedSourceRef = useRef<string | null>(null);
  const reconciliationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconciliationRef = useRef<PremiumReconciliation | null>(null);
  const reconciliationRunnerRef = useRef<(attempt: PremiumReconciliation) => Promise<void>>(
    async () => undefined,
  );

  const loadStore = useCallback(async () => {
    setLoadingStore(true);
    setStoreUnavailable(false);
    try {
      const offerings = await getRevenueCatOfferings();
      if (offerings.current === null || missingCanonicalRevenueCatProducts(offerings).length > 0) {
        setProducts([]);
        setStoreUnavailable(true);
        return;
      }
      const nextProducts = commerceProductsFromOfferings(offerings);
      setProducts(nextProducts);
      const monthly = nextProducts.find((product) => product.productKey === 'premium_monthly');
      setMonthlyTrialEligible(monthly === undefined
        ? false
        : await isRevenueCatTrialEligible(monthly.package.product.identifier));
    } catch (error: unknown) {
      setProducts([]);
      setStoreUnavailable(true);
      console.warn(
        'Commerce Store catalog unavailable:',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setLoadingStore(false);
    }
  }, []);

  useEffect(() => {
    if (viewedSourceRef.current === source) return;
    viewedSourceRef.current = source;
    void captureGameplayEvent('commerce_store_viewed', { source });
  }, [source]);

  useEffect(() => {
    if (revenueCatRuntime.status === 'ready') {
      void loadStore();
      return;
    }
    if (revenueCatRuntime.status === 'disabled' || revenueCatRuntime.status === 'error') {
      setLoadingStore(false);
      setStoreUnavailable(true);
    }
  }, [loadStore, revenueCatRuntime.status]);

  useEffect(() => {
    if (source !== 'sign_in_return' || pendingIntent === null) return;
    setSelectedPremiumKey(pendingIntent.productKey);
    if (pendingIntent.category !== 'premium') {
      setOpenCategory(pendingIntent.category);
    }
  }, [pendingIntent, source]);

  useEffect(() => () => {
    if (reconciliationTimerRef.current !== null) {
      clearTimeout(reconciliationTimerRef.current);
    }
  }, []);

  const updateReconciliation = useCallback((next: PremiumReconciliation | null) => {
    reconciliationRef.current = next;
    setPurchasePending(next);
  }, []);

  const premiumPlans = useMemo(
    () => productsInCategory(products, 'premium'),
    [products],
  );
  const coinPacks = useMemo(
    () => productsInCategory(products, 'stitch_coin'),
    [products],
  );
  const aiCreditPacks = useMemo(
    () => productsInCategory(products, 'ai_credit'),
    [products],
  );
  const selectedPremium = premiumPlans.find(
    (product) => product.productKey === selectedPremiumKey,
  ) ?? premiumPlans[0];
  const returnedProduct = pendingIntent === null
    ? null
    : products.find((product) => product.productKey === pendingIntent.productKey) ?? null;

  const refetchCommerceState = useCallback(async () => {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['economy', 'balance'] }),
      queryClient.refetchQueries({ queryKey: ['economy', 'aiCreditBalance'] }),
      queryClient.refetchQueries({ queryKey: ['commerce', 'membership'] }),
    ]);
  }, [queryClient]);

  const scheduleReconciliation = useCallback((attempt: PremiumReconciliation) => {
    if (reconciliationTimerRef.current !== null) {
      clearTimeout(reconciliationTimerRef.current);
    }
    reconciliationTimerRef.current = setTimeout(() => {
      void reconciliationRunnerRef.current(attempt);
    }, RECONCILIATION_POLL_MS);
  }, []);

  const reconcilePremium = useCallback(async (attempt: PremiumReconciliation) => {
    if (reconciliationRef.current?.id !== attempt.id) return;
    let verifiedMembership: MembershipView | null = null;
    try {
      verifiedMembership = await fetchMembership();
      const observedProductKey = premiumProductKey(verifiedMembership.plan);
      const backendVerified = verifiedMembership.active
        && observedProductKey !== null
        && (attempt.operation === 'restore'
          || (observedProductKey === attempt.product.productKey
            && membershipFingerprint(verifiedMembership) !== attempt.baselineMembership));

      if (!backendVerified) {
        if (Date.now() - attempt.startedAt >= RECONCILIATION_DELAY_MS) {
          updateReconciliation({ ...attempt, prolonged: true });
        } else {
          scheduleReconciliation(attempt);
        }
        return;
      }

      await fetchAiCreditBalance();
      await refetchCommerceState();
      const completedProduct = attempt.operation === 'restore'
        ? products.find((product) => product.productKey === observedProductKey) ?? attempt.product
        : attempt.product;
      await captureGameplayEvent('purchase_completed', {
        product_kind: 'premium_membership',
        product_key: completedProduct.productKey,
      });
      updateReconciliation(null);
      clearIntent();
      setPurchaseError(null);
      setPurchaseSuccess(`${completedProduct.label} Premium is verified and active.`);
    } catch (error: unknown) {
      const failureStage = verifiedMembership === null ? 'verification' : 'grant';
      await captureGameplayEvent('purchase_failed', {
        product_kind: 'premium_membership',
        product_key: attempt.product.productKey,
        failure_stage: failureStage,
      });
      updateReconciliation({ ...attempt, failureStage });
      setPurchaseError(failureStage === 'verification'
        ? 'The Game Backend could not verify this purchase yet. Retry reconciliation; do not buy it again.'
        : 'Premium was verified, but membership and AI Credit state could not be refreshed. Retry reconciliation.');
    }
  }, [clearIntent, products, refetchCommerceState, scheduleReconciliation, updateReconciliation]);

  const beginPremiumReconciliation = useCallback(async (
    product: CommerceProduct,
    operation: 'purchase' | 'restore',
    baselineMembership: string | null = null,
  ) => {
    const attempt: PremiumReconciliation = {
      baselineMembership,
      failureStage: null,
      id: `${Date.now()}-${product.productKey}-${operation}`,
      operation,
      product,
      prolonged: false,
      startedAt: Date.now(),
      supportReference: null,
    };
    updateReconciliation(attempt);
    setPurchaseSuccess(null);
    await captureGameplayEvent('purchase_reconciliation_pending', {
      product_kind: 'premium_membership',
      product_key: product.productKey,
    });
    try {
      const reference = await createPremiumReconciliation(
        operation,
        operation === 'purchase' ? product.productKey : null,
      );
      const next = { ...attempt, supportReference: reference.supportReference };
      updateReconciliation(next);
      await reconcilePremium(next);
    } catch {
      await captureGameplayEvent('purchase_failed', {
        product_kind: 'premium_membership',
        product_key: product.productKey,
        failure_stage: 'verification',
      });
      updateReconciliation({ ...attempt, failureStage: 'verification' });
      setPurchaseError(
        'Purchase reconciliation could not reach the Game Backend. Retry reconciliation; do not buy it again.',
      );
    }
  }, [reconcilePremium, updateReconciliation]);

  reconciliationRunnerRef.current = reconcilePremium;

  const purchase = useCallback(async (product: CommerceProduct) => {
    setPurchaseError(null);
    setPurchaseSuccess(null);
    setPurchasingKey(product.productKey);
    setConfirmingPremium(null);
    await captureGameplayEvent('purchase_started', {
      product_kind: product.productKind,
      product_key: product.productKey,
    });
    let failureStage: 'store' | 'verification' = product.category === 'premium'
      ? 'verification'
      : 'store';
    try {
      const baselineMembership = product.category === 'premium'
        ? membershipFingerprint(await fetchMembership())
        : null;
      failureStage = 'store';
      await purchaseRevenueCatPackage(product.package, accountId);
      if (product.category === 'premium') {
        await beginPremiumReconciliation(product, 'purchase', baselineMembership);
      } else {
        await refetchCommerceState();
      }
    } catch (error: unknown) {
      if (isPurchaseCancelled(error)) {
        await captureGameplayEvent('purchase_cancelled', {
          product_kind: product.productKind,
          product_key: product.productKey,
        });
        return;
      }
      await captureGameplayEvent('purchase_failed', {
        product_kind: product.productKind,
        product_key: product.productKey,
        failure_stage: failureStage,
      });
      setPurchaseError(purchaseErrorMessage(error));
    } finally {
      setPurchasingKey(null);
    }
  }, [accountId, beginPremiumReconciliation, refetchCommerceState]);

  const attemptPurchase = useCallback((product: CommerceProduct) => {
    void captureGameplayEvent('commerce_product_selected', {
      product_kind: product.productKind,
      product_key: product.productKey,
    });

    const originalSource = source === 'sign_in_return' && pendingIntent !== null
      ? pendingIntent.entrySource
      : source;
    preserveIntent({
      category: product.category,
      entrySource: originalSource,
      productKey: product.productKey,
      productKind: product.productKind,
    });

    if (!isAccount) {
      router.push({
        pathname: '/(tabs)/(settings)/sign-in',
        params: { returnTo: 'commerce' },
      });
      return;
    }

    if (product.category === 'premium') {
      setConfirmingPremium(product);
      return;
    }
    void purchase(product);
  }, [isAccount, pendingIntent, preserveIntent, purchase, router, source]);

  const restorePurchases = useCallback(async () => {
    if (!isAccount) {
      router.push({
        pathname: '/(tabs)/(settings)/sign-in',
        params: { returnTo: 'commerce' },
      });
      return;
    }
    setRestoringPurchases(true);
    setPurchaseError(null);
    try {
      await restoreRevenueCatPurchases(accountId);
      if (selectedPremium !== undefined) {
        await beginPremiumReconciliation(selectedPremium, 'restore');
      }
    } catch (error: unknown) {
      if (selectedPremium !== undefined) {
        await captureGameplayEvent('purchase_failed', {
          product_kind: 'premium_membership',
          product_key: selectedPremium.productKey,
          failure_stage: 'store',
        });
      }
      setPurchaseError(purchaseErrorMessage(error));
    } finally {
      setRestoringPurchases(false);
    }
  }, [accountId, beginPremiumReconciliation, isAccount, router, selectedPremium]);

  const retryPremiumReconciliation = useCallback(async () => {
    const attempt = reconciliationRef.current;
    if (attempt === null) return;
    setPurchaseError(null);
    const reset = { ...attempt, failureStage: null, prolonged: false, startedAt: Date.now() };
    updateReconciliation(reset);
    if (reset.supportReference === null) {
      try {
        const reference = await createPremiumReconciliation(
          reset.operation,
          reset.operation === 'purchase' ? reset.product.productKey : null,
        );
        const next = { ...reset, supportReference: reference.supportReference };
        updateReconciliation(next);
        await reconcilePremium(next);
      } catch {
        setPurchaseError('The Game Backend is still unavailable. Try reconciliation again later.');
        updateReconciliation({ ...reset, failureStage: 'verification' });
      }
      return;
    }
    await reconcilePremium(reset);
  }, [reconcilePremium, updateReconciliation]);

  return (
    <>
      <Screen scrollable contentContainerStyle={styles.container}>
        <View style={styles.titleRow} testID="commerce-store-screen">
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Ionicons name="arrow-back" size={22} color={Theme.colors.accentTeal} />
          </Pressable>
          <View style={styles.titleCopy}>
            <Text style={styles.title}>Commerce Store</Text>
            <Text style={styles.subtitle}>Membership and one-time top-ups</Text>
          </View>
          <View style={styles.walletSummary}>
            <WalletValue icon="leaf" value={coinBalance ?? 0} color={Theme.colors.accentHoney} />
            <WalletValue icon="sparkles" value={isAccount ? aiCreditBalance ?? 0 : 0} color={Theme.colors.accentRose} />
          </View>
        </View>

        {source === 'sign_in_return' && returnedProduct !== null && (
          <View style={styles.returnNotice} testID="sign-in-return-notice">
            <Ionicons name="checkmark-circle" size={20} color={Theme.colors.success} />
            <Text style={styles.returnNoticeText}>
              You’re signed in. {returnedProduct.label} is still selected. Review it and tap Buy when ready.
            </Text>
          </View>
        )}

        <View style={styles.premiumHero}>
          <View style={styles.premiumHeroTop}>
            <View style={styles.premiumIcon}>
              <Ionicons name="diamond-outline" size={24} color={Theme.colors.accentRose} />
            </View>
            <View style={styles.premiumHeroCopy}>
              <Text style={styles.eyebrow}>PREMIUM MEMBERSHIP</Text>
              <Text style={styles.premiumTitle}>Create more. Collect a little reward every day.</Text>
            </View>
          </View>
          <Text style={styles.premiumBody}>
            AI Credits each paid period, Premium themes, and a daily Stitch Coin claim.
          </Text>
          <View style={styles.benefitRow}>
            <Benefit icon="sparkles-outline" label="AI Credits" />
            <Benefit icon="calendar-outline" label="Daily Coins" />
            <Benefit icon="color-palette-outline" label="Themes" />
          </View>
          <Text style={styles.membershipStatus}>
            {membership?.active
              ? `${membershipLifecycleLabel(membership.lifecycle)}${membership.plan ? ` · ${capitalize(membership.plan)}` : ''}`
              : isAccount
                ? 'No active membership'
                : 'Browse plans as a Guest Player'}
          </Text>
          {membership?.active && membership.expiresAt && (
            <Text style={styles.membershipPeriod}>
              {membershipPeriodLabel(membership.lifecycle)}{' '}
              {new Date(membership.expiresAt).toLocaleDateString()}
            </Text>
          )}
        </View>

        {isAccount && membership?.active && (
          <MembershipBenefits
            membership={membership}
            claimPending={dailyClaim.isPending}
            claimError={dailyClaim.error?.message ?? null}
            onClaim={() => dailyClaim.mutate()}
            selectedThemeId={theme.id}
            themeAccess={themeAccess}
            onSelectTheme={(themeId) => void selectTheme(themeId)}
            onManage={() => {
              void showRevenueCatManageSubscriptions().catch(() => {
                Alert.alert('Unable to open subscriptions', 'Try again from your device store account.');
              });
            }}
          />
        )}

        {purchaseError !== null && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={18} color={Theme.colors.error} />
            <Text style={styles.errorText}>{purchaseError}</Text>
          </View>
        )}
        {purchaseSuccess !== null && (
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle-outline" size={18} color={Theme.colors.success} />
            <Text style={styles.successText}>{purchaseSuccess}</Text>
          </View>
        )}
        {purchasePending !== null && (
          <View style={styles.pendingBanner}>
            <Ionicons name="time-outline" size={18} color={Theme.colors.accentTeal} />
            <View style={styles.pendingCopy}>
              <Text style={styles.pendingTitle}>Purchase Reconciliation Pending</Text>
              <Text style={styles.pendingText}>
                The store response is received. Premium activates only after Game Backend verification.
                Do not purchase this plan again.
              </Text>
              {purchasePending.supportReference !== null && (
                <Text selectable style={styles.supportReference}>
                  Support Reference: {purchasePending.supportReference}
                </Text>
              )}
              {(purchasePending.prolonged || purchasePending.failureStage !== null) && (
                <Button
                  title="Retry reconciliation"
                  onPress={() => void retryPremiumReconciliation()}
                  variant="secondary"
                />
              )}
            </View>
          </View>
        )}

        {loadingStore ? (
          <View style={styles.storeState}>
            <ActivityIndicator size="large" color={Theme.colors.accentRose} />
            <Text style={styles.storeStateBody}>Loading current store prices…</Text>
          </View>
        ) : storeUnavailable ? (
          <Card style={styles.storeState}>
            <Ionicons name="cloud-offline-outline" size={28} color={Theme.colors.textSecondary} />
            <Text style={styles.storeStateTitle}>Store temporarily unavailable</Text>
            <Text style={styles.storeStateBody}>
              Your wallet and membership information are still available.
            </Text>
            <Button
              title="Retry"
              onPress={() => void loadStore()}
              variant="rose"
              style={styles.retryButton}
            />
          </Card>
        ) : (
          <>
            <View style={styles.planSection}>
              <Text style={styles.sectionTitle}>Choose a Premium plan</Text>
              <View style={styles.planRow}>
                {premiumPlans.map((plan) => {
                  const selected = plan.productKey === selectedPremium?.productKey;
                  return (
                    <Pressable
                      key={plan.id}
                      accessibilityRole="button"
                      onPress={() => {
                        setSelectedPremiumKey(plan.productKey);
                        void captureGameplayEvent('commerce_product_selected', {
                          product_kind: plan.productKind,
                          product_key: plan.productKey,
                        });
                      }}
                      style={({ pressed }) => [
                        styles.planCard,
                        selected && styles.planCardSelected,
                        pressed && styles.pressed,
                      ]}
                      testID={`premium-${plan.productKey}`}
                    >
                      {plan.productKey === 'premium_annual' && (
                        <Text style={styles.bestValue}>BEST VALUE</Text>
                      )}
                      <Text style={styles.planName}>{plan.label}</Text>
                      <Text style={styles.planPrice}>{plan.priceString}</Text>
                      {plan.billingPeriod !== null && (
                        <Text style={styles.planPeriod}>Billed every {plan.billingPeriod}</Text>
                      )}
                      <Text style={styles.planCredits}>{plan.credits} credits / paid period</Text>
                      {plan.trial && monthlyTrialEligible && (
                        <Text style={styles.trial}>Eligible for a 3-day free trial</Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
              {selectedPremium !== undefined && (
                <Button
                  title={isAccount ? `Choose ${selectedPremium.label}` : `Sign in for ${selectedPremium.label}`}
                  onPress={() => attemptPurchase(selectedPremium)}
                  loading={purchasingKey === selectedPremium.productKey}
                  disabled={purchasingKey !== null || purchasePending !== null}
                  variant="rose"
                />
              )}
            </View>

            <Text style={styles.sectionTitle}>One-time packs</Text>
            <CategoryCard
              icon="leaf-outline"
              title="Stitch Coin Packs"
              detail="300 · 900 · 2,000 Coins"
              price={coinPacks[0]?.priceString}
              color={Theme.colors.accentHoney}
              onPress={() => setOpenCategory('stitch_coin')}
              testID="open-stitch-coin-packs"
            />
            <CategoryCard
              icon="sparkles-outline"
              title="AI Credit Packs"
              detail="5 · 20 · 50 Credits"
              price={aiCreditPacks[0]?.priceString}
              color={Theme.colors.accentRose}
              onPress={() => setOpenCategory('ai_credit')}
              testID="open-ai-credit-packs"
            />

            <Pressable
              accessibilityRole="button"
              disabled={restoringPurchases || purchasePending !== null}
              onPress={() => void restorePurchases()}
              style={({ pressed }) => [styles.restoreButton, pressed && styles.pressed]}
            >
              {restoringPurchases ? (
                <ActivityIndicator size="small" color={Theme.colors.accentTeal} />
              ) : (
                <Text style={styles.restoreText}>Restore purchases</Text>
              )}
            </Pressable>
          </>
        )}
      </Screen>

      <ProductSheet
        category={openCategory}
        products={openCategory === 'stitch_coin' ? coinPacks : aiCreditPacks}
        pendingProductKey={source === 'sign_in_return' ? pendingIntent?.productKey ?? null : null}
        purchasingKey={purchasingKey}
        onClose={() => setOpenCategory(null)}
        onPurchase={attemptPurchase}
      />
      <PremiumConfirmation
        product={confirmingPremium}
        trialEligible={monthlyTrialEligible}
        onCancel={() => setConfirmingPremium(null)}
        onConfirm={(product) => void purchase(product)}
      />
    </>
  );
}

function WalletValue({
  icon,
  value,
  color,
}: {
  icon: 'leaf' | 'sparkles';
  value: number;
  color: string;
}) {
  return (
    <View style={styles.walletValue}>
      <Ionicons name={icon} size={13} color={color} />
      <Text style={styles.walletValueText}>{value.toLocaleString()}</Text>
    </View>
  );
}

function Benefit({ icon, label }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string }) {
  return (
    <View style={styles.benefit}>
      <Ionicons name={icon} size={16} color={Theme.colors.textLight} />
      <Text style={styles.benefitText}>{label}</Text>
    </View>
  );
}

function MembershipBenefits({
  membership,
  claimPending,
  claimError,
  onClaim,
  selectedThemeId,
  themeAccess,
  onSelectTheme,
  onManage,
}: {
  membership: NonNullable<ReturnType<typeof useMembership>['data']>;
  claimPending: boolean;
  claimError: string | null;
  onClaim: () => void;
  selectedThemeId: MembershipThemeId;
  themeAccess: boolean;
  onSelectTheme: (themeId: MembershipThemeId) => void;
  onManage: () => void;
}) {
  return (
    <Card style={styles.benefitsCard}>
      <View style={styles.benefitsHeader}>
        <Text style={styles.benefitsTitle}>Your Premium benefits</Text>
        {membership.expiresAt && (
          <Text style={styles.benefitsMeta}>
            Period ends {new Date(membership.expiresAt).toLocaleDateString()}
          </Text>
        )}
      </View>
      <Button
        title={membership.dailyClaim.claimed
          ? 'Daily Coin Claimed'
          : `Claim ${membership.dailyClaim.coinsAvailable} Coins`}
        onPress={onClaim}
        disabled={membership.dailyClaim.claimed || membership.dailyClaim.coinsAvailable === 0}
        loading={claimPending}
        variant="honey"
      />
      <Button title="Manage Subscription" onPress={onManage} variant="secondary" />
      {claimError && <Text style={styles.claimError}>{claimError}</Text>}
      <Text style={styles.themeTitle}>Theme Collection</Text>
      <View style={styles.themeRow}>
        {MEMBERSHIP_THEMES.map((candidate) => {
          const locked = candidate.premium && !themeAccess;
          return (
            <Pressable
              key={candidate.id}
              disabled={locked}
              onPress={() => onSelectTheme(candidate.id)}
              style={[
                styles.themeOption,
                { backgroundColor: candidate.gridBackground },
                selectedThemeId === candidate.id && styles.themeOptionSelected,
                locked && styles.themeOptionLocked,
              ]}
            >
              <Ionicons
                name={locked ? 'lock-closed-outline' : 'color-palette-outline'}
                size={17}
                color={candidate.celebrationAccent}
              />
              <Text style={styles.themeOptionText}>{candidate.name}</Text>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

function PremiumConfirmation({
  product,
  trialEligible,
  onCancel,
  onConfirm,
}: {
  product: CommerceProduct | null;
  trialEligible: boolean;
  onCancel: () => void;
  onConfirm: (product: CommerceProduct) => void;
}) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible={product !== null}
    >
      <View style={styles.confirmationRoot}>
        <View accessibilityViewIsModal style={styles.confirmationCard}>
          <Text style={styles.confirmationTitle}>Confirm Premium purchase</Text>
          {product !== null && (
            <>
              <Text style={styles.confirmationPlan}>
                {product.label} · {product.priceString}
                {product.billingPeriod === null ? '' : ` every ${product.billingPeriod}`}
              </Text>
              {product.productKey === 'premium_monthly' && trialEligible && (
                <Text style={styles.trial}>Your store reports that you are eligible for a 3-day free trial.</Text>
              )}
              <Text style={styles.confirmationBody}>
                Premium appears only after the Game Backend verifies the store transaction.
              </Text>
              <View style={styles.confirmationActions}>
                <Button title="Cancel" onPress={onCancel} variant="secondary" />
                <Button title={`Confirm ${product.label}`} onPress={() => onConfirm(product)} variant="rose" />
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function CategoryCard({
  icon,
  title,
  detail,
  price,
  color,
  onPress,
  testID,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  detail: string;
  price: string | undefined;
  color: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Card onPress={onPress} style={styles.categoryCard}>
      <View testID={testID} style={styles.categoryContent}>
        <View style={[styles.categoryIcon, { backgroundColor: `${color}20` }]}>
          <Ionicons name={icon} size={24} color={color} />
        </View>
        <View style={styles.categoryCopy}>
          <Text style={styles.categoryTitle}>{title}</Text>
          <Text style={styles.categoryDetail}>{detail}</Text>
          {price && <Text style={styles.categoryPrice}>From {price}</Text>}
        </View>
        <Ionicons name="chevron-forward" size={20} color={Theme.colors.textSecondary} />
      </View>
    </Card>
  );
}

function ProductSheet({
  category,
  products,
  pendingProductKey,
  purchasingKey,
  onClose,
  onPurchase,
}: {
  category: CommerceCategory | null;
  products: readonly CommerceProduct[];
  pendingProductKey: string | null;
  purchasingKey: string | null;
  onClose: () => void;
  onPurchase: (product: CommerceProduct) => void;
}) {
  const title = category === 'stitch_coin' ? 'Stitch Coin Packs' : 'AI Credit Packs';
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={category === 'stitch_coin' || category === 'ai_credit'}
    >
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="Close product sheet"
          onPress={onClose}
          style={styles.modalBackdrop}
        />
        <View accessibilityViewIsModal style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.sheetTitle}>{title}</Text>
              <Text style={styles.sheetSubtitle}>Current prices from the app store</Text>
            </View>
            <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.sheetClose}>
              <Ionicons name="close" size={22} color={Theme.colors.textPrimary} />
            </Pressable>
          </View>
          <View style={styles.sheetProducts}>
            {products.map((product) => (
              <View key={product.id} style={styles.sheetProduct}>
                <View style={styles.sheetProductCopy}>
                  <Text style={styles.sheetProductTitle}>{product.label}</Text>
                  <Text style={styles.sheetProductPrice}>{product.priceString}</Text>
                  {pendingProductKey === product.productKey && (
                    <Text style={styles.preservedLabel}>Selected before sign-in</Text>
                  )}
                </View>
                <Button
                  title="Buy"
                  onPress={() => onPurchase(product)}
                  loading={purchasingKey === product.productKey}
                  disabled={purchasingKey !== null}
                  variant={category === 'stitch_coin' ? 'honey' : 'rose'}
                  style={styles.sheetBuyButton}
                />
              </View>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function isPurchaseCancelled(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'userCancelled' in error
    && error.userCancelled === true;
}

function purchaseErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Purchase failed. Please try again.';
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function premiumProductKey(plan: MembershipView['plan']): CommerceProduct['productKey'] | null {
  return plan === null ? null : `premium_${plan}`;
}

function membershipFingerprint(membership: MembershipView | undefined): string | null {
  if (membership === undefined) return null;
  return JSON.stringify([
    membership.active,
    membership.plan,
    membership.lifecycle,
    membership.expiresAt,
  ]);
}

function membershipPeriodLabel(lifecycle: MembershipView['lifecycle']): string {
  return lifecycle === 'cancelled' || lifecycle === 'paused'
    || lifecycle === 'expired' || lifecycle === 'refunded'
    ? 'Current period ends'
    : 'Renews';
}

function membershipLifecycleLabel(lifecycle: MembershipView['lifecycle']): string {
  return lifecycle === null
    ? 'Active'
    : lifecycle.split('_').map(capitalize).join(' ');
}

const styles = StyleSheet.create({
  container: {
    gap: Theme.spacing.lg,
    paddingBottom: Theme.spacing.xxl,
    paddingHorizontal: Theme.spacing.lg,
    paddingTop: Theme.spacing.md,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Theme.spacing.sm,
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: Theme.colors.card,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.full,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  titleCopy: { flex: 1 },
  title: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.xl,
    fontWeight: Theme.typography.weights.bold,
  },
  subtitle: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.xs,
    marginTop: 2,
  },
  walletSummary: {
    alignItems: 'flex-end',
    gap: Theme.spacing.xs,
  },
  walletValue: {
    alignItems: 'center',
    backgroundColor: Theme.colors.card,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.full,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Theme.spacing.xs,
    minWidth: 60,
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: 5,
  },
  walletValueText: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.bold,
  },
  returnNotice: {
    alignItems: 'center',
    backgroundColor: '#F0F7F0',
    borderColor: '#C8E6C9',
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Theme.spacing.sm,
    padding: Theme.spacing.md,
  },
  returnNoticeText: {
    color: Theme.colors.textPrimary,
    flex: 1,
    fontSize: Theme.typography.sizes.sm,
    lineHeight: 19,
  },
  premiumHero: {
    backgroundColor: Theme.colors.accentTeal,
    borderRadius: Theme.radii.xl,
    gap: Theme.spacing.md,
    padding: Theme.spacing.xl,
    shadowColor: Theme.colors.accentTeal,
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 5,
  },
  premiumHeroTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Theme.spacing.md,
  },
  premiumIcon: {
    alignItems: 'center',
    backgroundColor: Theme.colors.textLight,
    borderRadius: Theme.radii.full,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  premiumHeroCopy: { flex: 1 },
  eyebrow: {
    color: '#F3CAD0',
    fontSize: 11,
    fontWeight: Theme.typography.weights.bold,
    letterSpacing: 1.2,
  },
  premiumTitle: {
    color: Theme.colors.textLight,
    fontSize: Theme.typography.sizes.xxl,
    fontWeight: Theme.typography.weights.bold,
    lineHeight: 30,
    marginTop: Theme.spacing.xs,
  },
  premiumBody: {
    color: '#E8F1EF',
    fontSize: Theme.typography.sizes.sm,
    lineHeight: 20,
  },
  benefitRow: { flexDirection: 'row', gap: Theme.spacing.sm },
  benefit: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: Theme.radii.full,
    flexDirection: 'row',
    gap: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: 7,
  },
  benefitText: {
    color: Theme.colors.textLight,
    fontSize: 11,
    fontWeight: Theme.typography.weights.semibold,
  },
  membershipStatus: {
    color: '#F6E7C8',
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.semibold,
  },
  membershipPeriod: { color: '#E8F1EF', fontSize: Theme.typography.sizes.xs },
  benefitsCard: { gap: Theme.spacing.md },
  benefitsHeader: { gap: Theme.spacing.xs },
  benefitsTitle: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
  },
  benefitsMeta: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.xs },
  claimError: { color: Theme.colors.error, fontSize: Theme.typography.sizes.xs },
  themeTitle: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.bold,
  },
  themeRow: { flexDirection: 'row', gap: Theme.spacing.sm },
  themeOption: {
    alignItems: 'center',
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    flex: 1,
    gap: Theme.spacing.xs,
    justifyContent: 'center',
    minHeight: 68,
    padding: Theme.spacing.xs,
  },
  themeOptionSelected: { borderColor: Theme.colors.accentRose, borderWidth: 2 },
  themeOptionLocked: { opacity: 0.5 },
  themeOptionText: {
    color: Theme.colors.textPrimary,
    fontSize: 10,
    fontWeight: Theme.typography.weights.semibold,
    textAlign: 'center',
  },
  errorBanner: {
    alignItems: 'center',
    backgroundColor: '#FDF2F2',
    borderColor: '#FBD5D5',
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Theme.spacing.sm,
    padding: Theme.spacing.md,
  },
  errorText: { color: Theme.colors.error, flex: 1, fontSize: Theme.typography.sizes.sm },
  successBanner: {
    alignItems: 'center',
    backgroundColor: '#F0F7F0',
    borderColor: '#C8E6C9',
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Theme.spacing.sm,
    padding: Theme.spacing.md,
  },
  successText: { color: Theme.colors.textPrimary, flex: 1, fontSize: Theme.typography.sizes.sm },
  pendingBanner: {
    alignItems: 'center',
    backgroundColor: '#EEF5F4',
    borderColor: '#BCD2CF',
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Theme.spacing.sm,
    padding: Theme.spacing.md,
  },
  pendingText: { color: Theme.colors.textPrimary, flex: 1, fontSize: Theme.typography.sizes.sm },
  pendingCopy: { flex: 1, gap: Theme.spacing.sm },
  pendingTitle: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.bold,
  },
  supportReference: {
    color: Theme.colors.textSecondary,
    fontFamily: 'monospace',
    fontSize: Theme.typography.sizes.xs,
  },
  storeState: {
    alignItems: 'center',
    gap: Theme.spacing.md,
    paddingVertical: Theme.spacing.xxl,
  },
  storeStateTitle: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.lg,
    fontWeight: Theme.typography.weights.bold,
  },
  storeStateBody: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.sm,
    textAlign: 'center',
  },
  retryButton: { minWidth: 140 },
  planSection: { gap: Theme.spacing.md },
  sectionTitle: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.lg,
    fontWeight: Theme.typography.weights.bold,
  },
  planRow: { flexDirection: 'row', gap: Theme.spacing.sm },
  planCard: {
    backgroundColor: Theme.colors.card,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    flex: 1,
    minHeight: 132,
    padding: Theme.spacing.sm,
  },
  planCardSelected: { borderColor: Theme.colors.accentRose, borderWidth: 2 },
  bestValue: {
    color: Theme.colors.accentRose,
    fontSize: 9,
    fontWeight: Theme.typography.weights.bold,
    marginBottom: Theme.spacing.xs,
  },
  planName: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.bold,
  },
  planPrice: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
    marginTop: Theme.spacing.sm,
  },
  planPeriod: { color: Theme.colors.textSecondary, fontSize: 10, marginTop: 2 },
  planCredits: {
    color: Theme.colors.textSecondary,
    fontSize: 10,
    lineHeight: 14,
    marginTop: Theme.spacing.xs,
  },
  trial: { color: Theme.colors.success, fontSize: 10, marginTop: Theme.spacing.xs },
  categoryCard: { padding: 0 },
  categoryContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Theme.spacing.md,
    padding: Theme.spacing.lg,
  },
  categoryIcon: {
    alignItems: 'center',
    borderRadius: Theme.radii.md,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  categoryCopy: { flex: 1, gap: 2 },
  categoryTitle: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
  },
  categoryDetail: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.xs },
  categoryPrice: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.semibold,
    marginTop: Theme.spacing.xs,
  },
  restoreButton: { alignItems: 'center', paddingVertical: Theme.spacing.md },
  restoreText: {
    color: Theme.colors.accentTeal,
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
  },
  confirmationRoot: {
    alignItems: 'center',
    backgroundColor: 'rgba(25, 24, 22, 0.42)',
    flex: 1,
    justifyContent: 'center',
    padding: Theme.spacing.lg,
  },
  confirmationCard: {
    backgroundColor: Theme.colors.background,
    borderRadius: Theme.radii.xl,
    gap: Theme.spacing.md,
    padding: Theme.spacing.xl,
    width: '100%',
  },
  confirmationTitle: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.xl,
    fontWeight: Theme.typography.weights.bold,
  },
  confirmationPlan: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.semibold,
  },
  confirmationBody: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.sm },
  confirmationActions: { flexDirection: 'row', gap: Theme.spacing.sm, justifyContent: 'flex-end' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { backgroundColor: 'rgba(25, 24, 22, 0.42)', flex: 1 },
  sheet: {
    backgroundColor: Theme.colors.background,
    borderTopLeftRadius: Theme.radii.xl,
    borderTopRightRadius: Theme.radii.xl,
    gap: Theme.spacing.lg,
    paddingBottom: Theme.spacing.xxl,
    paddingHorizontal: Theme.spacing.lg,
    paddingTop: Theme.spacing.sm,
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: Theme.colors.border,
    borderRadius: Theme.radii.full,
    height: 4,
    width: 44,
  },
  sheetHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.xl,
    fontWeight: Theme.typography.weights.bold,
  },
  sheetSubtitle: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.xs,
    marginTop: Theme.spacing.xs,
  },
  sheetClose: {
    alignItems: 'center',
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.full,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  sheetProducts: { gap: Theme.spacing.sm },
  sheetProduct: {
    alignItems: 'center',
    backgroundColor: Theme.colors.card,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Theme.spacing.md,
    padding: Theme.spacing.md,
  },
  sheetProductCopy: { flex: 1, gap: 2 },
  sheetProductTitle: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.semibold,
  },
  sheetProductPrice: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.sm },
  preservedLabel: {
    color: Theme.colors.success,
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.semibold,
    marginTop: Theme.spacing.xs,
  },
  sheetBuyButton: { width: 84 },
  pressed: { opacity: 0.78 },
});
