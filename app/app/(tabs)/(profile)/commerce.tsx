import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  type AppStateStatus,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { fetchAiCreditBalance, useAiCreditBalance } from '@/api/commerce';
import {
  createAiCreditPackReconciliation,
  fetchAiCreditPackReconciliation,
  type AiCreditPackProductKey,
} from '@/api/aiCreditPack';
import {
  createCoinPackReconciliation,
  fetchCoinPackReconciliation,
  type CoinPackProductKey,
} from '@/api/coinPack';
import {
  cancelGuestPurchaseAttempt,
  createGuestPurchaseAttempt,
  fetchGuestPurchaseAttempt,
  mapGuestRevenueCatSubscriber,
  type GuestPurchaseAttemptReference,
} from '@/api/guestPurchase';
import { fetchCoinBalance, useCoinBalance } from '@/api/economy';
import {
  createPremiumReconciliation,
  fetchMembership,
  useMembership,
  type MembershipView,
} from '@/api/membership';
import { captureGameplayEvent } from '@/analytics/gameplayEvents';
import type { PurchaseProductKey } from '@/analytics/schema';
import {
  classifyPremiumPlanChange,
  commerceProductIdentity,
  commerceProductsFromOfferings,
  productsInCategory,
  type CommerceCategory,
  type CommerceProduct,
  type PremiumPlanChangeKind,
} from '@/commerce/catalog';
import {
  commerceEntrySource,
  useCommerceIntentStore,
} from '@/commerce/commerceIntent';
import {
  getRevenueCatOfferings,
  getRevenueCatSubscriberId,
  prepareGuestRevenueCatSubscriber,
  isRevenueCatTrialEligible,
  missingCanonicalRevenueCatProducts,
  purchaseRevenueCatPackage,
  restoreRevenueCatPurchases,
  showRevenueCatManageSubscriptions,
  useRevenueCatRuntime,
} from '@/commerce/revenueCat';
import { Button, Card, GuestDataRiskNotice, PurchaseResultModal, Screen } from '@/components';
import type { PurchaseResultVariant } from '@/components';
import { WebLinks } from '@/config';
import { useIdentityStore } from '@/identity/guestIdentity';
import { Theme } from '@/theme/theme';
import { withProtectedRoundTrip } from '@/navigation/foregroundEntryNavigation';
import {
  clearGuestPurchaseAttempt,
  readGuestPurchaseAttempt,
  saveGuestPurchaseAttempt,
} from '@/commerce/guestPurchaseRecovery';

const RECONCILIATION_POLL_MS = 2_000;
const RECONCILIATION_DELAY_MS = 10_000;
// Both prolonged branches in reconcilePremium report the same wait, so the copy
// lives in one place rather than being repeated at each site.
const PREMIUM_RECONCILIATION_PENDING_BODY =
  'Verification is still under way. Premium will activate once the Game Backend confirms it.';

interface PremiumReconciliation {
  readonly baselineMembership: string | null;
  readonly failureStage: 'verification' | 'grant' | null;
  readonly id: string;
  readonly operation: 'purchase' | 'restore';
  readonly product: CommerceProduct;
  readonly prolonged: boolean;
  readonly startedAt: number;
  readonly supportReference: string | null;
  readonly guestAttemptId: string | null;
  // Set only when this reconciliation began as a direct Premium Plan change
  // (issue #123's upgrade confirmation), so the `subscription_change_*`
  // analytics events can be reported alongside the ordinary purchase events.
  readonly sourcePlanKey: PurchaseProductKey | null;
}

interface CoinPackReconciliation {
  readonly failureStage: 'verification' | 'grant' | null;
  readonly id: string;
  readonly product: CommerceProduct;
  readonly prolonged: boolean;
  readonly reconciliationId: string | null;
  readonly startedAt: number;
  readonly supportReference: string | null;
  readonly transactionIdentifier: string;
  readonly guestAttemptId: string | null;
}

interface AiCreditPackReconciliation {
  readonly failureStage: 'verification' | 'grant' | null;
  readonly id: string;
  readonly product: CommerceProduct;
  readonly prolonged: boolean;
  readonly reconciliationId: string | null;
  readonly startedAt: number;
  readonly supportReference: string | null;
  readonly transactionIdentifier: string;
  readonly guestAttemptId: string | null;
}

interface PurchaseResultModalState {
  readonly variant: PurchaseResultVariant;
  readonly title: string;
  readonly body: string;
  readonly detail: string | null;
}

export default function CommerceScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string; source?: string }>();
  const queryClient = useQueryClient();
  const { accountId, guestId, isAccount } = useIdentityStore();
  const revenueCatRuntime = useRevenueCatRuntime();
  const pendingIntent = useCommerceIntentStore((state) => state.intent);
  const preserveIntent = useCommerceIntentStore((state) => state.preserveIntent);
  const clearIntent = useCommerceIntentStore((state) => state.clearIntent);
  const source = commerceEntrySource(params.source);

  const { data: coinBalance } = useCoinBalance();
  const { data: aiCreditBalance } = useAiCreditBalance(true);
  const { data: membership } = useMembership(true);

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
  const [confirmingPlanChange, setConfirmingPlanChange] = useState<{
    readonly current: CommerceProduct;
    readonly target: CommerceProduct;
  } | null>(null);
  const [confirmingCoinPack, setConfirmingCoinPack] = useState<CommerceProduct | null>(null);
  const [confirmingAiCreditPack, setConfirmingAiCreditPack] = useState<CommerceProduct | null>(null);
  const [trialEligibleKeys, setTrialEligibleKeys] = useState<readonly PurchaseProductKey[]>([]);
  const [purchasePending, setPurchasePending] = useState<PremiumReconciliation | null>(null);
  const [coinPurchasePending, setCoinPurchasePending] = useState<CoinPackReconciliation | null>(null);
  const [aiCreditPurchasePending, setAiCreditPurchasePending] = useState<AiCreditPackReconciliation | null>(null);
  const [guestCommerceProduct, setGuestCommerceProduct] = useState<CommerceProduct | null>(null);
  const [restoringPurchases, setRestoringPurchases] = useState(false);
  // One imperative slot for the in-game purchase result. The screen's purchase
  // flow is already imperative, so the modal is set at the call sites rather
  // than re-derived from reconciliation and query state.
  const [resultModal, setResultModal] = useState<PurchaseResultModalState | null>(null);
  const [productSheetPresented, setProductSheetPresented] = useState(false);

  // The pack sheet is a native RN <Modal>, and the Premium/Coin/AI Credit
  // confirmations and the GuestDataRiskNotice are Modals too. iOS never
  // presents a routed screen over an already-presented Modal, so anything
  // that navigates away from this screen (sign-in included) must close every
  // commerce overlay first or the destination renders unreachable behind it.
  const closeCommerceOverlays = useCallback(() => {
    setOpenCategory(null);
    setGuestCommerceProduct(null);
    setConfirmingPremium(null);
    setConfirmingPlanChange(null);
    setConfirmingCoinPack(null);
    setConfirmingAiCreditPack(null);
  }, []);

  const viewedSourceRef = useRef<string | null>(null);
  const pendingPremiumPurchaseRef = useRef<CommerceProduct | null>(null);
  const pendingPlanChangeSourceRef = useRef<PurchaseProductKey | null>(null);
  const premiumPurchaseInFlightRef = useRef(false);
  const reconciliationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconciliationRef = useRef<PremiumReconciliation | null>(null);
  const reconciliationRunnerRef = useRef<(attempt: PremiumReconciliation) => Promise<void>>(
    async () => undefined,
  );
  const coinReconciliationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coinReconciliationRef = useRef<CoinPackReconciliation | null>(null);
  const coinReconciliationRunnerRef = useRef<(attempt: CoinPackReconciliation) => Promise<void>>(
    async () => undefined,
  );
  const aiCreditReconciliationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiCreditReconciliationRef = useRef<AiCreditPackReconciliation | null>(null);
  const aiCreditReconciliationRunnerRef = useRef<(
    attempt: AiCreditPackReconciliation,
  ) => Promise<void>>(async () => undefined);
  // Remembers the last observed scheduled downgrade so its eventual RENEWAL
  // activation can be told apart from every other reason `membership` changes
  // (issue #124: `subscription_change_completed` fires exactly once here, not
  // through the in-app reconciliation path #123 uses for a direct upgrade).
  const lastScheduledChangeRef = useRef<{ sourcePlan: PurchaseProductKey; targetPlan: PurchaseProductKey } | null>(null);

  const loadStore = useCallback(async () => {
    setLoadingStore(true);
    setStoreUnavailable(false);
    try {
      const offerings = await getRevenueCatOfferings();
      await reportMissingCanonicalProducts(missingCanonicalRevenueCatProducts(offerings));
      const nextProducts = commerceProductsFromOfferings(offerings);
      setProducts(nextProducts);
      // Availability is not all-or-nothing. Only an absent offering, or one that
      // resolves to no products at all, leaves nothing to sell; a single product
      // awaiting store approval must never hide the rest of the catalogue from a
      // player or from an App Review reviewer.
      if (nextProducts.length === 0) {
        setTrialEligibleKeys([]);
        setStoreUnavailable(true);
        return;
      }
      // Only products the store actually advertises an introductory offer for
      // are worth an eligibility check; everything else keeps the paid offer.
      const offeredTrials = nextProducts.filter(
        (product) => product.category === 'premium' && product.freeIntroductoryOffer !== null,
      );
      const eligibility = await Promise.all(offeredTrials.map(async (product) => ({
        eligible: await isRevenueCatTrialEligible(product.package.product.identifier),
        productKey: product.productKey,
      })));
      setTrialEligibleKeys(
        eligibility.filter((entry) => entry.eligible).map((entry) => entry.productKey),
      );
    } catch (error: unknown) {
      setProducts([]);
      setTrialEligibleKeys([]);
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

  useEffect(() => {
    if (params.category === 'stitch_coin' || source === 'stitch_coin_shortfall') {
      setOpenCategory('stitch_coin');
    } else if (params.category === 'ai_credit' || source === 'ai_credit_shortfall') {
      setOpenCategory('ai_credit');
    }
  }, [params.category, source]);

  useEffect(() => () => {
    if (reconciliationTimerRef.current !== null) {
      clearTimeout(reconciliationTimerRef.current);
    }
    if (coinReconciliationTimerRef.current !== null) {
      clearTimeout(coinReconciliationTimerRef.current);
    }
    if (aiCreditReconciliationTimerRef.current !== null) {
      clearTimeout(aiCreditReconciliationTimerRef.current);
    }
  }, []);

  // A backgrounded app suspends JS timers, so a scheduled reconciliation poll
  // can be stale by the time the app returns. Foreground resumes any unresolved
  // Premium reconciliation immediately rather than waiting out the rest of its
  // poll interval.
  useEffect(() => {
    const handleAppStateChange = (status: AppStateStatus) => {
      if (status !== 'active') return;
      // Scheduled Plan changes are server-authoritative and RevenueCat client
      // entitlement never decides visibility, so foreground has to re-pull the
      // Membership API rather than trust whatever it last held (issue #124).
      void queryClient.refetchQueries({ queryKey: ['commerce', 'membership'] });
      const attempt = reconciliationRef.current;
      if (attempt !== null) void reconciliationRunnerRef.current(attempt);
    };
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [queryClient]);

  // The Commerce Store opening is the other refresh point multi-device
  // convergence relies on: a scheduled change made on another device must
  // become visible here without waiting out the query's normal staleness.
  useEffect(() => {
    void queryClient.refetchQueries({ queryKey: ['commerce', 'membership'] });
  }, [queryClient]);

  const updateReconciliation = useCallback((next: PremiumReconciliation | null) => {
    reconciliationRef.current = next;
    setPurchasePending(next);
  }, []);

  const updateCoinReconciliation = useCallback((next: CoinPackReconciliation | null) => {
    coinReconciliationRef.current = next;
    setCoinPurchasePending(next);
  }, []);

  const updateAiCreditReconciliation = useCallback((next: AiCreditPackReconciliation | null) => {
    aiCreditReconciliationRef.current = next;
    setAiCreditPurchasePending(next);
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

  // A `trial` or `active` lifecycle already holds the plan it names, so it is
  // the Current Plan: not repurchasable, and never displaced by an automatic
  // preselection. `grace`, `billing_retry`, `paused`, and `cancelled` remain
  // entitled but expose no direct plan-change action at all — Manage
  // Subscription is the only control for those, same as inactive lifecycles
  // fall through to the ordinary new-plan purchase journey below.
  const currentPlanLifecycle = membership?.active === true
    && (membership.lifecycle === 'active' || membership.lifecycle === 'trial');
  const restrictedLifecycle = membership?.active === true && !currentPlanLifecycle;
  const currentPlanProductKey = currentPlanLifecycle
    ? premiumProductKey(membership.plan)
    : null;
  const currentPlanMapped = currentPlanProductKey !== null
    && premiumPlans.some((plan) => plan.productKey === currentPlanProductKey);
  const currentPlanProduct = premiumPlans.find(
    (plan) => plan.productKey === currentPlanProductKey,
  );
  // Only iOS carries a single subscription group whose ordering makes an
  // Upgrade vs. Plan Change classification meaningful; Android and an
  // unmappable Current Plan or target package both disable the action while
  // Manage Subscription remains available (the incomplete-catalog warning
  // already covers an unmapped canonical product from the store load above).
  const directPlanChangeAvailable = currentPlanLifecycle
    && currentPlanMapped
    && Platform.OS === 'ios';
  const showPremiumPlanGrid = restrictedLifecycle
    ? false
    : currentPlanLifecycle ? currentPlanMapped : true;
  // Store acceptance locks every Premium Plan action until the Game Backend
  // settles the outcome (issue #121): a second upgrade or plan change started
  // over an unverified one would overlap in the subscription group.
  const premiumActionsLocked = purchasePending !== null || purchasingKey !== null;

  useEffect(() => {
    if (currentPlanLifecycle && currentPlanMapped && currentPlanProductKey !== null) {
      setSelectedPremiumKey(currentPlanProductKey);
    }
  }, [currentPlanLifecycle, currentPlanMapped, currentPlanProductKey]);

  // A scheduled downgrade never gets an in-app confirmation (it is requested
  // through Manage Subscription, outside the app), so it never fires
  // `subscription_change_started`. It does need `subscription_change_completed`
  // fired exactly once, the moment the Membership API reports the target plan
  // active and the scheduled state cleared — recognized here by comparing
  // against the last scheduled change this screen itself observed, since the
  // Membership API exposes no separate "just activated" signal.
  useEffect(() => {
    if (membership === undefined) return;
    const lastScheduled = lastScheduledChangeRef.current;
    const targetKey = membership.scheduledChange != null
      ? premiumProductKey(membership.scheduledChange.targetPlan)
      : null;
    const currentKey = premiumProductKey(membership.plan);
    if (membership.scheduledChange != null && targetKey !== null && currentKey !== null) {
      lastScheduledChangeRef.current = { sourcePlan: currentKey, targetPlan: targetKey };
    } else if (
      membership.scheduledChange == null
      && lastScheduled !== null
      && currentKey === lastScheduled.targetPlan
    ) {
      lastScheduledChangeRef.current = null;
      void captureGameplayEvent('subscription_change_completed', {
        source_plan: lastScheduled.sourcePlan,
        target_plan: lastScheduled.targetPlan,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      });
    } else if (membership.scheduledChange == null) {
      lastScheduledChangeRef.current = null;
    }
  }, [membership]);
  const openCategoryPacks = openCategory === 'stitch_coin'
    ? coinPacks
    : openCategory === 'ai_credit'
      ? aiCreditPacks
      : [];
  // A deep link or shortfall entry may ask for a category the store did not
  // return. An empty sheet is worse than none, so it simply does not open.
  const openablePackCategory = openCategoryPacks.length > 0 ? openCategory : null;
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

  // Every terminal reconciliation failure below already computes the copy it
  // hands to the page-level error banner; this hoists the same string into
  // the in-game result modal instead of duplicating it. Non-terminal
  // "prolonged" waits never call this — they are not a failure.
  const showFailureModal = useCallback((message: string, supportReference: string | null) => {
    setResultModal({
      variant: 'failed',
      title: 'Purchase failed',
      body: message,
      detail: supportReference === null ? null : `Support Reference: ${supportReference}`,
    });
  }, []);

  // A prolonged wait is not a failure: the Purchase Reconciliation Pending state
  // says verification is still under way and the balance will update, and offers
  // no retry — retry stays on the page-level banner, one path only.
  const showReconciliationPendingModal = useCallback((body: string) => {
    setResultModal({ variant: 'info', title: 'Still verifying', body, detail: null });
  }, []);

  const reconcilePremium = useCallback(async (attempt: PremiumReconciliation) => {
    if (reconciliationRef.current?.id !== attempt.id) return;
    let verifiedMembership: MembershipView | null = null;
    try {
      if (attempt.guestAttemptId !== null) {
        const guestAttempt = await fetchGuestPurchaseAttempt(attempt.guestAttemptId);
        if (guestAttempt.status === 'created' || guestAttempt.status === 'verifying') {
          if (Date.now() - attempt.startedAt >= RECONCILIATION_DELAY_MS) {
            updateReconciliation({ ...attempt, prolonged: true });
            showReconciliationPendingModal(PREMIUM_RECONCILIATION_PENDING_BODY);
          } else {
            scheduleReconciliation(attempt);
          }
          return;
        }
        if (guestAttempt.status !== 'granted') {
          updateReconciliation({ ...attempt, failureStage: 'verification' });
          const message = 'The Game Backend could not verify this purchase. Retry reconciliation; do not buy it again.';
          setPurchaseError(message);
          showFailureModal(message, attempt.supportReference);
          return;
        }
      }
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
          showReconciliationPendingModal(PREMIUM_RECONCILIATION_PENDING_BODY);
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
      if (attempt.sourcePlanKey !== null) {
        await captureGameplayEvent('subscription_change_completed', {
          source_plan: attempt.sourcePlanKey,
          target_plan: completedProduct.productKey,
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
        });
      }
      updateReconciliation(null);
      clearIntent();
      setPurchaseError(null);
      setPurchaseSuccess(`${completedProduct.label} Premium is verified and active.`);
      setResultModal({
        variant: 'success',
        title: 'Premium is active',
        body: completedProduct.billingPeriod === null
          ? `${completedProduct.label} Premium is now active.`
          : `${completedProduct.label} Premium is now active, billed every ${completedProduct.billingPeriod}.`,
        detail: null,
      });
    } catch (error: unknown) {
      const failureStage = verifiedMembership === null ? 'verification' : 'grant';
      await captureGameplayEvent('purchase_failed', {
        product_kind: 'premium_membership',
        product_key: attempt.product.productKey,
        failure_stage: failureStage,
      });
      if (attempt.sourcePlanKey !== null) {
        await captureGameplayEvent('subscription_change_failed', {
          source_plan: attempt.sourcePlanKey,
          target_plan: attempt.product.productKey,
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
          failure_stage: failureStage,
        });
      }
      updateReconciliation({ ...attempt, failureStage });
      const message = failureStage === 'verification'
        ? 'The Game Backend could not verify this purchase yet. Retry reconciliation; do not buy it again.'
        : 'Premium was verified, but membership and AI Credit state could not be refreshed. Retry reconciliation.';
      setPurchaseError(message);
      showFailureModal(message, attempt.supportReference);
    }
  }, [clearIntent, products, refetchCommerceState, scheduleReconciliation, showFailureModal, showReconciliationPendingModal, updateReconciliation]);

  const beginPremiumReconciliation = useCallback(async (
    product: CommerceProduct,
    operation: 'purchase' | 'restore',
    baselineMembership: string | null = null,
    guestAttempt: GuestPurchaseAttemptReference | null = null,
    sourcePlanKey: PurchaseProductKey | null = null,
  ) => {
    const attempt: PremiumReconciliation = {
      baselineMembership,
      failureStage: null,
      id: `${Date.now()}-${product.productKey}-${operation}`,
      operation,
      product,
      prolonged: false,
      startedAt: Date.now(),
      supportReference: guestAttempt?.supportReference ?? null,
      guestAttemptId: guestAttempt?.id ?? null,
      sourcePlanKey,
    };
    updateReconciliation(attempt);
    setPurchaseSuccess(null);
    await captureGameplayEvent('purchase_reconciliation_pending', {
      product_kind: 'premium_membership',
      product_key: product.productKey,
    });
    try {
      const reference = guestAttempt === null
        ? await createPremiumReconciliation(operation, operation === 'purchase' ? product.productKey : null)
        : { supportReference: guestAttempt.supportReference };
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
      const message =
        'Purchase reconciliation could not reach the Game Backend. Retry reconciliation; do not buy it again.';
      setPurchaseError(message);
      showFailureModal(message, attempt.supportReference);
    }
  }, [reconcilePremium, showFailureModal, updateReconciliation]);

  reconciliationRunnerRef.current = reconcilePremium;

  const scheduleCoinReconciliation = useCallback((attempt: CoinPackReconciliation) => {
    if (coinReconciliationTimerRef.current !== null) {
      clearTimeout(coinReconciliationTimerRef.current);
    }
    coinReconciliationTimerRef.current = setTimeout(() => {
      void coinReconciliationRunnerRef.current(attempt);
    }, RECONCILIATION_POLL_MS);
  }, []);

  const reconcileCoinPack = useCallback(async (attempt: CoinPackReconciliation) => {
    if (coinReconciliationRef.current?.id !== attempt.id || attempt.reconciliationId === null) {
      return;
    }
    let grantVerified = false;
    try {
      const reconciliation = attempt.guestAttemptId === null
        ? await fetchCoinPackReconciliation(attempt.reconciliationId)
        : await fetchGuestPurchaseAttempt(attempt.reconciliationId);
      if (reconciliation.status === 'pending' || reconciliation.status === 'created' || reconciliation.status === 'verifying') {
        if (Date.now() - attempt.startedAt >= RECONCILIATION_DELAY_MS) {
          updateCoinReconciliation({ ...attempt, prolonged: true });
          showReconciliationPendingModal(
            'Verification is still under way. Your Stitch Coin balance will update once it completes.',
          );
        } else {
          scheduleCoinReconciliation(attempt);
        }
        return;
      }
      if (reconciliation.status === 'verification_failed' || reconciliation.status === 'failed' || reconciliation.status === 'cancelled') {
        await captureGameplayEvent('purchase_failed', {
          product_kind: 'stitch_coin_pack',
          product_key: attempt.product.productKey,
          failure_stage: 'verification',
        });
        updateCoinReconciliation({ ...attempt, failureStage: 'verification' });
        const message =
          'The store transaction did not match this Coin Pack. Retry verification or contact support; do not buy it again.';
        setPurchaseError(message);
        showFailureModal(message, attempt.supportReference);
        return;
      }
      if (reconciliation.status === 'grant_failed') {
        await captureGameplayEvent('purchase_failed', {
          product_kind: 'stitch_coin_pack',
          product_key: attempt.product.productKey,
          failure_stage: 'grant',
        });
        updateCoinReconciliation({ ...attempt, failureStage: 'grant' });
        const message =
          'The purchase was verified, but the Stitch Coin grant is unavailable. Retry reconciliation; do not buy it again.';
        setPurchaseError(message);
        showFailureModal(message, attempt.supportReference);
        return;
      }

      grantVerified = true;
      const refreshedBalance = await fetchCoinBalance();
      queryClient.setQueryData(['economy', 'balance'], refreshedBalance);
      await captureGameplayEvent('purchase_completed', {
        product_kind: 'stitch_coin_pack',
        product_key: attempt.product.productKey,
      });
      updateCoinReconciliation(null);
      if (!isAccount && guestId !== null) await clearGuestPurchaseAttempt(guestId);
      clearIntent();
      setPurchaseError(null);
      setPurchaseSuccess(
        `${attempt.product.label} grant verified. Stitch Coin balance: ${refreshedBalance.toLocaleString()}.`,
      );
      setResultModal({
        variant: 'success',
        title: 'Stitch Coins granted',
        body: `${attempt.product.quantity.toLocaleString()} Stitch Coins have been added to your balance.`,
        detail: null,
      });
    } catch {
      const failureStage = grantVerified ? 'grant' : 'verification';
      await captureGameplayEvent('purchase_failed', {
        product_kind: 'stitch_coin_pack',
        product_key: attempt.product.productKey,
        failure_stage: failureStage,
      });
      updateCoinReconciliation({ ...attempt, failureStage });
      const message = grantVerified
        ? 'The Coin grant was verified, but the current Stitch Coin balance could not be refreshed. Retry reconciliation.'
        : 'The Game Backend could not verify this Coin Pack yet. Retry reconciliation; do not buy it again.';
      setPurchaseError(message);
      showFailureModal(message, attempt.supportReference);
    }
  }, [clearIntent, guestId, isAccount, queryClient, scheduleCoinReconciliation, showFailureModal, showReconciliationPendingModal, updateCoinReconciliation]);

  const beginCoinPackReconciliation = useCallback(async (
    product: CommerceProduct,
    transactionIdentifier: string,
    guestAttempt: GuestPurchaseAttemptReference | null = null,
  ) => {
    const attempt: CoinPackReconciliation = {
      failureStage: null,
      id: `${Date.now()}-${product.productKey}-purchase`,
      product,
      prolonged: false,
      reconciliationId: guestAttempt?.id ?? null,
      startedAt: Date.now(),
      supportReference: guestAttempt?.supportReference ?? null,
      transactionIdentifier,
      guestAttemptId: guestAttempt?.id ?? null,
    };
    updateCoinReconciliation(attempt);
    setOpenCategory(null);
    setPurchaseSuccess(null);
    await captureGameplayEvent('purchase_reconciliation_pending', {
      product_kind: 'stitch_coin_pack',
      product_key: product.productKey,
    });
    if (guestAttempt !== null) {
      updateCoinReconciliation(attempt);
      await reconcileCoinPack(attempt);
      return;
    }
    try {
      const reference = await createCoinPackReconciliation(
        product.productKey as CoinPackProductKey,
        transactionIdentifier,
      );
      const next = {
        ...attempt,
        reconciliationId: reference.id,
        supportReference: reference.supportReference,
      };
      updateCoinReconciliation(next);
      await reconcileCoinPack(next);
    } catch {
      await captureGameplayEvent('purchase_failed', {
        product_kind: 'stitch_coin_pack',
        product_key: product.productKey,
        failure_stage: 'verification',
      });
      updateCoinReconciliation({ ...attempt, failureStage: 'verification' });
      const message =
        'Coin Pack reconciliation could not reach the Game Backend. Retry reconciliation; do not buy it again.';
      setPurchaseError(message);
      showFailureModal(message, attempt.supportReference);
    }
  }, [reconcileCoinPack, showFailureModal, updateCoinReconciliation]);

  coinReconciliationRunnerRef.current = reconcileCoinPack;

  useEffect(() => {
    if (isAccount || guestId === null || products.length === 0 || coinPurchasePending !== null) return;
    let cancelled = false;
    void readGuestPurchaseAttempt(guestId).then(async (stored) => {
      if (cancelled || stored === null) return;
      const product = products.find((candidate) => candidate.productKey === stored.productKey);
      if (product === undefined) return;
      const attempt: CoinPackReconciliation = {
        failureStage: null,
        id: `recovered-${stored.id}`,
        product,
        prolonged: false,
        reconciliationId: stored.id,
        startedAt: Date.now(),
        supportReference: stored.supportReference,
        transactionIdentifier: '',
        guestAttemptId: stored.id,
      };
      updateCoinReconciliation(attempt);
      await reconcileCoinPack(attempt);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [coinPurchasePending, guestId, isAccount, products, reconcileCoinPack, updateCoinReconciliation]);

  const scheduleAiCreditReconciliation = useCallback((attempt: AiCreditPackReconciliation) => {
    if (aiCreditReconciliationTimerRef.current !== null) {
      clearTimeout(aiCreditReconciliationTimerRef.current);
    }
    aiCreditReconciliationTimerRef.current = setTimeout(() => {
      void aiCreditReconciliationRunnerRef.current(attempt);
    }, RECONCILIATION_POLL_MS);
  }, []);

  const reconcileAiCreditPack = useCallback(async (attempt: AiCreditPackReconciliation) => {
    if (aiCreditReconciliationRef.current?.id !== attempt.id
      || attempt.reconciliationId === null) {
      return;
    }
    let grantVerified = false;
    try {
      const reconciliation = attempt.guestAttemptId === null
        ? await fetchAiCreditPackReconciliation(attempt.reconciliationId)
        : await fetchGuestPurchaseAttempt(attempt.guestAttemptId);
      if (reconciliation.status === 'pending' || reconciliation.status === 'created' || reconciliation.status === 'verifying') {
        if (Date.now() - attempt.startedAt >= RECONCILIATION_DELAY_MS) {
          updateAiCreditReconciliation({ ...attempt, prolonged: true });
          showReconciliationPendingModal(
            'Verification is still under way. Your AI Credit balance will update once it completes.',
          );
        } else {
          scheduleAiCreditReconciliation(attempt);
        }
        return;
      }
      if (reconciliation.status === 'verification_failed' || reconciliation.status === 'failed' || reconciliation.status === 'cancelled') {
        await captureGameplayEvent('purchase_failed', {
          product_kind: 'ai_credit_pack',
          product_key: attempt.product.productKey,
          failure_stage: 'verification',
        });
        updateAiCreditReconciliation({ ...attempt, failureStage: 'verification' });
        const message =
          'The store transaction did not match this AI Credit Pack. Retry verification or contact support; do not buy it again.';
        setPurchaseError(message);
        showFailureModal(message, attempt.supportReference);
        return;
      }
      if (reconciliation.status === 'grant_failed') {
        await captureGameplayEvent('purchase_failed', {
          product_kind: 'ai_credit_pack',
          product_key: attempt.product.productKey,
          failure_stage: 'grant',
        });
        updateAiCreditReconciliation({ ...attempt, failureStage: 'grant' });
        const message =
          'The purchase was verified, but the AI Credit grant is unavailable. Retry reconciliation; do not buy it again.';
        setPurchaseError(message);
        showFailureModal(message, attempt.supportReference);
        return;
      }

      grantVerified = true;
      const refreshedBalance = await fetchAiCreditBalance();
      queryClient.setQueryData(['economy', 'aiCreditBalance'], refreshedBalance);
      await captureGameplayEvent('purchase_completed', {
        product_kind: 'ai_credit_pack',
        product_key: attempt.product.productKey,
      });
      updateAiCreditReconciliation(null);
      if (!isAccount && guestId !== null) await clearGuestPurchaseAttempt(guestId);
      clearIntent();
      setPurchaseError(null);
      setPurchaseSuccess(
        `${attempt.product.label} grant verified. AI Credit balance: ${refreshedBalance.toLocaleString()}.`,
      );
      setResultModal({
        variant: 'success',
        title: 'AI Credits granted',
        body: `${attempt.product.quantity.toLocaleString()} AI Credits have been added to your balance.`,
        detail: null,
      });
    } catch {
      const failureStage = grantVerified ? 'grant' : 'verification';
      await captureGameplayEvent('purchase_failed', {
        product_kind: 'ai_credit_pack',
        product_key: attempt.product.productKey,
        failure_stage: failureStage,
      });
      updateAiCreditReconciliation({ ...attempt, failureStage });
      const message = grantVerified
        ? 'The AI Credit grant was verified, but the current balance could not be refreshed. Retry reconciliation.'
        : 'The Game Backend could not verify this AI Credit Pack yet. Retry reconciliation; do not buy it again.';
      setPurchaseError(message);
      showFailureModal(message, attempt.supportReference);
    }
  }, [clearIntent, guestId, isAccount, queryClient, scheduleAiCreditReconciliation, showFailureModal, showReconciliationPendingModal, updateAiCreditReconciliation]);

  const beginAiCreditPackReconciliation = useCallback(async (
    product: CommerceProduct,
    transactionIdentifier: string,
    guestAttempt: GuestPurchaseAttemptReference | null = null,
  ) => {
    const attempt: AiCreditPackReconciliation = {
      failureStage: null,
      id: `${Date.now()}-${product.productKey}-purchase`,
      product,
      prolonged: false,
      reconciliationId: guestAttempt?.id ?? null,
      startedAt: Date.now(),
      supportReference: guestAttempt?.supportReference ?? null,
      transactionIdentifier,
      guestAttemptId: guestAttempt?.id ?? null,
    };
    updateAiCreditReconciliation(attempt);
    setOpenCategory(null);
    setPurchaseSuccess(null);
    await captureGameplayEvent('purchase_reconciliation_pending', {
      product_kind: 'ai_credit_pack',
      product_key: product.productKey,
    });
    try {
      const reference = guestAttempt === null
        ? await createAiCreditPackReconciliation(product.productKey as AiCreditPackProductKey, transactionIdentifier)
        : { id: guestAttempt.id, supportReference: guestAttempt.supportReference };
      const next = {
        ...attempt,
        reconciliationId: reference.id,
        supportReference: reference.supportReference,
      };
      updateAiCreditReconciliation(next);
      await reconcileAiCreditPack(next);
    } catch {
      await captureGameplayEvent('purchase_failed', {
        product_kind: 'ai_credit_pack',
        product_key: product.productKey,
        failure_stage: 'verification',
      });
      updateAiCreditReconciliation({ ...attempt, failureStage: 'verification' });
      const message =
        'AI Credit Pack reconciliation could not reach the Game Backend. Retry reconciliation; do not buy it again.';
      setPurchaseError(message);
      showFailureModal(message, attempt.supportReference);
    }
  }, [reconcileAiCreditPack, showFailureModal, updateAiCreditReconciliation]);

  aiCreditReconciliationRunnerRef.current = reconcileAiCreditPack;

  useEffect(() => {
    if (isAccount || guestId === null || products.length === 0 || aiCreditPurchasePending !== null) return;
    let cancelled = false;
    void readGuestPurchaseAttempt(guestId).then(async (stored) => {
      if (cancelled || stored === null) return;
      const product = products.find((candidate) => candidate.productKey === stored.productKey && candidate.category === 'ai_credit');
      if (product === undefined) return;
      const attempt: AiCreditPackReconciliation = {
        failureStage: null,
        id: `recovered-${stored.id}`,
        product,
        prolonged: false,
        reconciliationId: stored.id,
        startedAt: Date.now(),
        supportReference: stored.supportReference,
        transactionIdentifier: '',
        guestAttemptId: stored.id,
      };
      updateAiCreditReconciliation(attempt);
      await reconcileAiCreditPack(attempt);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [aiCreditPurchasePending, guestId, isAccount, products, reconcileAiCreditPack, updateAiCreditReconciliation]);

  const purchase = useCallback(async (
    product: CommerceProduct,
    sourcePlanKey: PurchaseProductKey | null = null,
  ) => {
    setPurchaseError(null);
    setPurchaseSuccess(null);
    setResultModal(null);
    setPurchasingKey(product.productKey);
    setConfirmingPremium(null);
    setConfirmingPlanChange(null);
    setConfirmingCoinPack(null);
    setConfirmingAiCreditPack(null);
    await captureGameplayEvent('purchase_started', {
      product_kind: product.productKind,
      product_key: product.productKey,
    });
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    if (sourcePlanKey !== null) {
      await captureGameplayEvent('subscription_change_started', {
        source_plan: sourcePlanKey,
        target_plan: product.productKey,
        platform,
      });
    }
    let failureStage: 'store' | 'verification' = product.category === 'premium'
      ? 'verification'
      : 'store';
    let guestAttempt: GuestPurchaseAttemptReference | null = null;
    let guestSubscriberId: string | null = null;
    let storePurchaseAccepted = false;
    try {
      if (!isAccount) {
        if (Platform.OS !== 'ios') throw new Error('Guest Stitch Coin purchases are available on iOS only.');
        const subscriberId = await prepareGuestRevenueCatSubscriber();
        guestSubscriberId = subscriberId;
        await mapGuestRevenueCatSubscriber(subscriberId);
        guestAttempt = await createGuestPurchaseAttempt(
          product.package.product.identifier,
          `${Date.now()}-${product.productKey}`,
          subscriberId,
        );
        if (guestId !== null) {
          await saveGuestPurchaseAttempt(guestId, {
            id: guestAttempt.id,
            productKey: product.productKey,
            supportReference: guestAttempt.supportReference,
          });
        }
      }
      const baselineMembership = product.category === 'premium'
        ? membershipFingerprint(await fetchMembership())
        : null;
      failureStage = 'store';
      const purchaseResult = await withProtectedRoundTrip('commerce', () =>
        purchaseRevenueCatPackage(product.package, accountId, !isAccount),
      );
      storePurchaseAccepted = true;
      // RevenueCat can still rotate the anonymous subscriber while the store
      // sheet is up, and it reports the purchase under whichever identifier is
      // current. Claiming that identifier keeps the webhook resolvable.
      if (guestSubscriberId !== null) {
        const purchasedSubscriberId = await getRevenueCatSubscriberId();
        if (purchasedSubscriberId !== guestSubscriberId) {
          await mapGuestRevenueCatSubscriber(purchasedSubscriberId);
        }
      }
      // Close the pack sheet before presenting the pending modal: iOS never
      // presents a Modal over an already-presented one, and the reconciliation
      // starters below close it too late to cover this first paint.
      setOpenCategory(null);
      setResultModal({
        variant: 'pending',
        title: 'Purchase received',
        body: `The store accepted ${product.label}. Verifying your purchase now.`,
        detail: null,
      });
      failureStage = 'verification';
      if (product.category === 'premium') {
        await beginPremiumReconciliation(
          product, 'purchase', baselineMembership, guestAttempt, sourcePlanKey,
        );
      } else if (product.category === 'stitch_coin') {
        await beginCoinPackReconciliation(
          product,
          purchaseResult.transaction.transactionIdentifier,
          guestAttempt,
        );
      } else {
        await beginAiCreditPackReconciliation(
          product,
          purchaseResult.transaction.transactionIdentifier,
          guestAttempt,
        );
      }
    } catch (error: unknown) {
      if (guestAttempt !== null && !storePurchaseAccepted) {
        const cancelledAttempt = await cancelGuestPurchaseAttempt(guestAttempt.id).catch(() => null);
        if (cancelledAttempt?.status === 'cancelled' && guestId !== null) {
          await clearGuestPurchaseAttempt(guestId).catch(() => undefined);
        }
      }
      if (isPurchaseCancelled(error)) {
        await captureGameplayEvent('purchase_cancelled', {
          product_kind: product.productKind,
          product_key: product.productKey,
        });
        if (sourcePlanKey !== null) {
          await captureGameplayEvent('subscription_change_cancelled', {
            source_plan: sourcePlanKey,
            target_plan: product.productKey,
            platform,
          });
        }
        return;
      }
      // Pack purchases run inside the ProductSheet modal. Close it before
      // showing the page-level error banner; otherwise the failure is hidden
      // behind the still-visible sheet and looks like a no-op.
      setOpenCategory(null);
      await captureGameplayEvent('purchase_failed', {
        product_kind: product.productKind,
        product_key: product.productKey,
        failure_stage: failureStage,
      });
      if (sourcePlanKey !== null) {
        await captureGameplayEvent('subscription_change_failed', {
          source_plan: sourcePlanKey,
          target_plan: product.productKey,
          platform,
          failure_stage: failureStage,
        });
      }
      const message = purchaseErrorMessage(error);
      setPurchaseError(message);
      // The page-level banner above keeps the durable recovery copy; the modal
      // only reports the outcome and offers dismissal, so there is one retry
      // path rather than two competing ones.
      // The reference is shown for every Guest failure, cancelled attempts
      // included: the Purchase Attempt record outlives its cancellation and is
      // what support looks the player up by.
      setResultModal({
        variant: 'failed',
        title: 'Purchase failed',
        body: message,
        detail: guestAttempt === null
          ? null
          : `Support Reference: ${guestAttempt.supportReference}`,
      });
    } finally {
      setPurchasingKey(null);
    }
  }, [accountId, beginAiCreditPackReconciliation, beginCoinPackReconciliation, beginPremiumReconciliation, guestId, isAccount]);

  const confirmPremiumPurchase = useCallback((product: CommerceProduct) => {
    if (premiumPurchaseInFlightRef.current) return;
    premiumPurchaseInFlightRef.current = true;

    // React Native only emits Modal.onDismiss on iOS. Wait for that callback
    // there so RevenueCat's Test Store UIAlertController is not presented from
    // the modal view controller while its fade dismissal is still in flight.
    if (Platform.OS !== 'ios') {
      void purchase(product).finally(() => {
        premiumPurchaseInFlightRef.current = false;
      });
      return;
    }

    pendingPremiumPurchaseRef.current = product;
    setConfirmingPremium(null);
  }, [purchase]);

  const handlePremiumConfirmationDismiss = useCallback(() => {
    const product = pendingPremiumPurchaseRef.current;
    if (product === null) return;
    pendingPremiumPurchaseRef.current = null;
    const sourcePlanKey = pendingPlanChangeSourceRef.current;
    pendingPlanChangeSourceRef.current = null;
    void purchase(product, sourcePlanKey).finally(() => {
      premiumPurchaseInFlightRef.current = false;
    });
  }, [purchase]);

  // A direct Premium Plan upgrade only (issue #123's scope; a downgrade stays a
  // placeholder for #124). Shares the same iOS modal-dismiss handshake as a
  // fresh Premium purchase so RevenueCat's store sheet never races the
  // confirmation's own dismissal.
  const confirmPlanChangePurchase = useCallback((product: CommerceProduct, sourcePlanKey: PurchaseProductKey) => {
    if (premiumPurchaseInFlightRef.current) return;
    premiumPurchaseInFlightRef.current = true;

    if (Platform.OS !== 'ios') {
      void purchase(product, sourcePlanKey).finally(() => {
        premiumPurchaseInFlightRef.current = false;
      });
      return;
    }

    pendingPremiumPurchaseRef.current = product;
    pendingPlanChangeSourceRef.current = sourcePlanKey;
    setConfirmingPlanChange(null);
  }, [purchase]);

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
      if (product.category !== 'premium' && product.category !== 'stitch_coin' && product.category !== 'ai_credit') {
        closeCommerceOverlays();
        router.push({ pathname: '/(tabs)/(settings)/sign-in', params: { returnTo: 'commerce' } });
        return;
      }
      if (Platform.OS !== 'ios') {
        setPurchaseError('Guest purchases are available on iOS only.');
        return;
      }
      // The pack sheet is already a native Modal. Close it before presenting
      // the Guest risk notice; iOS refuses to present a second Modal on top of
      // the currently visible sheet, which makes Buy appear unresponsive.
      setOpenCategory(null);
      setGuestCommerceProduct(product);
      return;
    }

    if (product.category === 'premium') {
      setConfirmingPremium(product);
      return;
    }
    if (product.category === 'stitch_coin') {
      setConfirmingCoinPack(product);
      return;
    }
    setConfirmingAiCreditPack(product);
  }, [closeCommerceOverlays, isAccount, pendingIntent, preserveIntent, router, setGuestCommerceProduct, source]);

  // A Guest restore re-owns provider-verified Premium only, so it maps the
  // anonymous subscriber first and never opens a reconciliation for packs.
  const restoreGuestPremium = useCallback(async () => {
    const subscriberId = await prepareGuestRevenueCatSubscriber();
    await mapGuestRevenueCatSubscriber(subscriberId);
    await restoreRevenueCatPurchases(null);
    const restoredSubscriberId = await getRevenueCatSubscriberId();
    if (restoredSubscriberId !== subscriberId) {
      await mapGuestRevenueCatSubscriber(restoredSubscriberId);
    }
    await queryClient.refetchQueries({ queryKey: ['commerce', 'membership'] });
    await queryClient.refetchQueries({ queryKey: ['economy'] });
    setResultModal({
      variant: 'info',
      title: 'Restore requested',
      body: 'Verified Premium access will appear after the store webhook is reconciled. '
        + 'Stitch Coin and AI Credit packs are never restored.',
      detail: null,
    });
  }, [queryClient]);

  const restoreAccountPurchases = useCallback(async () => {
    await restoreRevenueCatPurchases(accountId);
    if (selectedPremium !== undefined) {
      await beginPremiumReconciliation(selectedPremium, 'restore');
    }
  }, [accountId, beginPremiumReconciliation, selectedPremium]);

  const restorePurchases = useCallback(async () => {
    setRestoringPurchases(true);
    setPurchaseError(null);
    try {
      await withProtectedRoundTrip(
        'commerce',
        () => (isAccount ? restoreAccountPurchases() : restoreGuestPremium()),
      );
    } catch (error: unknown) {
      if (isAccount && selectedPremium !== undefined) {
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
  }, [isAccount, restoreAccountPurchases, restoreGuestPremium, selectedPremium]);

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

  const retryCoinPackReconciliation = useCallback(async () => {
    const attempt = coinReconciliationRef.current;
    if (attempt === null) return;
    setPurchaseError(null);
    const reset = { ...attempt, failureStage: null, prolonged: false, startedAt: Date.now() };
    updateCoinReconciliation(reset);
    if (reset.reconciliationId === null) {
      try {
        const reference = await createCoinPackReconciliation(
          reset.product.productKey as CoinPackProductKey,
          reset.transactionIdentifier,
        );
        const next = {
          ...reset,
          reconciliationId: reference.id,
          supportReference: reference.supportReference,
        };
        updateCoinReconciliation(next);
        await reconcileCoinPack(next);
      } catch {
        setPurchaseError('The Game Backend is still unavailable. Try reconciliation again later.');
        updateCoinReconciliation({ ...reset, failureStage: 'verification' });
      }
      return;
    }
    await reconcileCoinPack(reset);
  }, [reconcileCoinPack, updateCoinReconciliation]);

  const retryAiCreditPackReconciliation = useCallback(async () => {
    const attempt = aiCreditReconciliationRef.current;
    if (attempt === null) return;
    setPurchaseError(null);
    const reset = { ...attempt, failureStage: null, prolonged: false, startedAt: Date.now() };
    updateAiCreditReconciliation(reset);
    if (reset.reconciliationId === null) {
      try {
        const reference = await createAiCreditPackReconciliation(
          reset.product.productKey as AiCreditPackProductKey,
          reset.transactionIdentifier,
        );
        const next = {
          ...reset,
          reconciliationId: reference.id,
          supportReference: reference.supportReference,
        };
        updateAiCreditReconciliation(next);
        await reconcileAiCreditPack(next);
      } catch {
        setPurchaseError('The Game Backend is still unavailable. Try reconciliation again later.');
        updateAiCreditReconciliation({ ...reset, failureStage: 'verification' });
      }
      return;
    }
    await reconcileAiCreditPack(reset);
  }, [reconcileAiCreditPack, updateAiCreditReconciliation]);

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
            <WalletValue icon="sparkles" value={aiCreditBalance ?? 0} color={Theme.colors.accentRose} />
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

        {membership?.active === true && (
          <Card style={styles.membershipActionsCard}>
            <Text style={styles.membershipActionsTitle}>Active Premium Membership</Text>
            <Text style={styles.membershipActionsBody}>
              Daily rewards are in Profile. Themes are under Settings › Appearance.
            </Text>
            {membership?.scheduledChange != null && (
              <Text style={styles.scheduledChangeNotice} testID="scheduled-plan-change-notice">
                {`Changes to ${capitalize(membership.scheduledChange.targetPlan)} on `
                  + new Date(membership.scheduledChange.effectiveAt).toLocaleDateString()}
              </Text>
            )}
            <Button
              title="Manage Subscription"
              onPress={() => {
                void withProtectedRoundTrip('subscription-management', () =>
                  showRevenueCatManageSubscriptions(),
                  { keepUntilForeground: true },
                ).catch(() => {
                  Alert.alert('Unable to open subscriptions', 'Try again from your device store account.');
                });
              }}
              variant="secondary"
            />
          </Card>
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
              {/* The plan under verification is named so the player can tell a
                  plan change apart from a first purchase while every Premium
                  Plan action is locked (issue #121). */}
              <Text style={styles.pendingText}>
                {purchasePending.sourcePlanKey !== null
                  ? `The store accepted the change to ${purchasePending.product.label}. `
                  : `The store response for ${purchasePending.product.label} is received. `}
                Premium activates only after Game Backend verification.
                Do not purchase this plan again.
              </Text>
              {purchasePending.supportReference !== null && (
                <SupportReferenceRow reference={purchasePending.supportReference} />
              )}
              {/* Refresh is offered from the first moment of the wait, not only
                  once it turns prolonged: a short verification that has already
                  landed should not leave the player without a way to ask. */}
              <Button
                title={
                  purchasePending.prolonged || purchasePending.failureStage !== null
                    ? 'Retry reconciliation'
                    : 'Refresh status'
                }
                onPress={() => void retryPremiumReconciliation()}
                variant="secondary"
              />
            </View>
          </View>
        )}
        {coinPurchasePending !== null && (
          <View style={styles.pendingBanner}>
            <Ionicons name="time-outline" size={18} color={Theme.colors.accentTeal} />
            <View style={styles.pendingCopy}>
              <Text style={styles.pendingTitle}>
                {coinPurchasePending.guestAttemptId !== null
                  ? 'Verifying purchase'
                  : 'Purchase Reconciliation Pending'}
              </Text>
              <Text style={styles.pendingText}>
                The store response is received. Stitch Coin updates only after the Game Backend
                exposes the matching Commerce Ledger grant. Do not purchase this pack again.
              </Text>
              {coinPurchasePending.supportReference !== null && (
                <SupportReferenceRow reference={coinPurchasePending.supportReference} />
              )}
              {(coinPurchasePending.prolonged || coinPurchasePending.failureStage !== null) && (
                <Button
                  title="Retry reconciliation"
                  onPress={() => void retryCoinPackReconciliation()}
                  variant="secondary"
                />
              )}
            </View>
          </View>
        )}
        {aiCreditPurchasePending !== null && (
          <View style={styles.pendingBanner}>
            <Ionicons name="time-outline" size={18} color={Theme.colors.accentTeal} />
            <View style={styles.pendingCopy}>
              <Text style={styles.pendingTitle}>Purchase Reconciliation Pending</Text>
              <Text style={styles.pendingText}>
                The store response is received. AI Credit updates only after the Game Backend
                exposes the matching Commerce Ledger grant. Do not purchase this pack again.
              </Text>
              {aiCreditPurchasePending.supportReference !== null && (
                <SupportReferenceRow reference={aiCreditPurchasePending.supportReference} />
              )}
              {(aiCreditPurchasePending.prolonged
                || aiCreditPurchasePending.failureStage !== null) && (
                <Button
                  title="Retry reconciliation"
                  onPress={() => void retryAiCreditPackReconciliation()}
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
            {showPremiumPlanGrid && premiumPlans.length > 0 && (
              <View style={styles.planSection}>
                <Text style={styles.sectionTitle}>
                  {currentPlanLifecycle ? 'Your Premium plan' : 'Choose a Premium plan'}
                </Text>
                <View style={styles.planRow}>
                  {premiumPlans.map((plan) => {
                    const isCurrentPlan = currentPlanLifecycle
                      && plan.productKey === currentPlanProductKey;
                    const selected = currentPlanLifecycle
                      ? isCurrentPlan
                      : plan.productKey === selectedPremium?.productKey;
                    const trialOffer = premiumTrialOffer(plan, trialEligibleKeys);
                    // A held plan can never invoke its own repurchase. A
                    // different plan is tappable only where a direct change is
                    // actually supported (iOS, mapped catalog). An upgrade opens
                    // the in-app confirmation; a downgrade (`plan_change`) has no
                    // app-owned confirmation at all (issue #121) and instead
                    // routes straight to Manage Subscription, the only surface
                    // that can request or cancel a deferred downgrade.
                    const planChangeKind: PremiumPlanChangeKind | null = currentPlanLifecycle
                      && !isCurrentPlan
                      && currentPlanProductKey !== null
                      ? classifyPremiumPlanChange(currentPlanProductKey, plan.productKey)
                      : null;
                    const onPressPlan = currentPlanLifecycle
                      ? (isCurrentPlan
                        || !directPlanChangeAvailable
                        || planChangeKind === null
                        || premiumActionsLocked
                        ? undefined
                        : () => {
                          void captureGameplayEvent('commerce_product_selected', {
                            product_kind: plan.productKind,
                            product_key: plan.productKey,
                          });
                          if (planChangeKind === 'upgrade' && currentPlanProduct !== undefined) {
                            setConfirmingPlanChange({ current: currentPlanProduct, target: plan });
                          } else if (planChangeKind === 'plan_change') {
                            void withProtectedRoundTrip('subscription-management', () =>
                              showRevenueCatManageSubscriptions(),
                              { keepUntilForeground: true },
                            ).catch(() => {
                              Alert.alert('Unable to open subscriptions', 'Try again from your device store account.');
                            });
                          }
                        })
                      : () => {
                        setSelectedPremiumKey(plan.productKey);
                        void captureGameplayEvent('commerce_product_selected', {
                          product_kind: plan.productKind,
                          product_key: plan.productKey,
                        });
                      };
                    return (
                      <Pressable
                        key={plan.id}
                        accessibilityRole="button"
                        disabled={onPressPlan === undefined}
                        onPress={onPressPlan}
                        style={({ pressed }) => [
                          styles.planCard,
                          selected && styles.planCardSelected,
                          pressed && styles.pressed,
                        ]}
                        testID={`premium-${plan.productKey}`}
                      >
                        {isCurrentPlan ? (
                          <Text style={styles.bestValue}>CURRENT PLAN</Text>
                        ) : planChangeKind !== null && directPlanChangeAvailable ? (
                          <Text style={styles.bestValue}>
                            {planChangeKind === 'upgrade' ? 'UPGRADE' : 'PLAN CHANGE'}
                          </Text>
                        ) : (
                          !currentPlanLifecycle && plan.productKey === 'premium_annual' && (
                            <Text style={styles.bestValue}>BEST VALUE</Text>
                          )
                        )}
                        <Text style={styles.planName}>{plan.label}</Text>
                        <Text style={styles.planPrice}>{plan.priceString}</Text>
                        {plan.billingPeriod !== null && (
                          <Text style={styles.planPeriod}>Billed every {plan.billingPeriod}</Text>
                        )}
                        {plan.credits !== undefined && (
                          <Text style={styles.planCredits}>
                            {creditAllowanceLabel(plan.credits, plan.creditPeriod)}
                          </Text>
                        )}
                        {trialOffer !== null && (
                          <Text style={styles.trial}>{trialOffer}</Text>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
                {!currentPlanLifecycle && selectedPremium !== undefined && (
                  <>
                    <SubscriptionDisclosure
                      plan={selectedPremium}
                      presentation="compact"
                      testID="commerce-subscription-disclosure"
                    />
                    <Button
                      // A Guest can complete this purchase without registering: attemptPurchase
                      // routes a Guest through the Guest Data Risk Notice, where sign-in is offered
                      // as an alternative, never a precondition (Guideline 5.1.1(v)).
                      title={`Choose ${selectedPremium.label}`}
                      onPress={() => attemptPurchase(selectedPremium)}
                      loading={purchasingKey === selectedPremium.productKey}
                      disabled={purchasingKey !== null || purchasePending !== null}
                      variant="rose"
                    />
                  </>
                )}
              </View>
            )}

            {(coinPacks.length > 0 || aiCreditPacks.length > 0) && (
              <Text style={styles.sectionTitle}>One-time packs</Text>
            )}
            {/* Packs the store did not return are not advertised, and the summary
                line and "from" price describe only what is purchasable. Category
                order is ascending quantity, so the first pack is the cheapest. */}
            {coinPacks.length > 0 && (
              <CategoryCard
                icon="leaf-outline"
                title="Stitch Coin Packs"
                detail={packSummary(coinPacks, 'Coins')}
                price={coinPacks[0]?.priceString}
                color={Theme.colors.accentHoney}
                onPress={() => setOpenCategory('stitch_coin')}
                testID="open-stitch-coin-packs"
              />
            )}
            {aiCreditPacks.length > 0 && (
              <CategoryCard
                icon="sparkles-outline"
                title="AI Credit Packs"
                detail={packSummary(aiCreditPacks, 'Credits')}
                price={aiCreditPacks[0]?.priceString}
                color={Theme.colors.accentRose}
                onPress={() => setOpenCategory('ai_credit')}
                testID="open-ai-credit-packs"
              />
            )}

            <Pressable
              accessibilityRole="button"
              disabled={restoringPurchases || purchasePending !== null}
              onPress={() => void restorePurchases()}
              style={({ pressed }) => [styles.restoreButton, pressed && styles.pressed]}
            >
              {restoringPurchases ? (
                <ActivityIndicator size="small" color={Theme.colors.accentTeal} />
              ) : (
                <Text style={styles.restoreText}>
                  {isAccount ? 'Restore purchases' : 'Restore Guest Premium'}
                </Text>
              )}
            </Pressable>
          </>
        )}
      </Screen>

      <ProductSheet
        category={openablePackCategory}
        products={openCategoryPacks}
        pendingProductKey={source === 'sign_in_return' ? pendingIntent?.productKey ?? null : null}
        purchasingKey={purchasingKey}
        reconcilingProductKey={openablePackCategory === 'stitch_coin'
          ? coinPurchasePending?.product.productKey ?? null
          : aiCreditPurchasePending?.product.productKey ?? null}
        confirmation={openablePackCategory === 'stitch_coin' ? (
          <CoinPackConfirmation
            product={confirmingCoinPack}
            onCancel={() => setConfirmingCoinPack(null)}
            onConfirm={(product) => void purchase(product)}
          />
        ) : (
          <AiCreditPackConfirmation
            product={confirmingAiCreditPack}
            onCancel={() => setConfirmingAiCreditPack(null)}
            onConfirm={(product) => void purchase(product)}
          />
        )}
        onClose={() => {
          setConfirmingCoinPack(null);
          setConfirmingAiCreditPack(null);
          setOpenCategory(null);
        }}
        onDismiss={() => setProductSheetPresented(false)}
        onShow={() => setProductSheetPresented(true)}
        onPurchase={attemptPurchase}
      />
      <GuestDataRiskNotice
        visible={guestCommerceProduct !== null}
        commerce
        onProceed={() => {
          const product = guestCommerceProduct;
          setGuestCommerceProduct(null);
          if (product === null) return;
          if (product.category === 'premium') {
            setConfirmingPremium(product);
          } else if (product.category === 'stitch_coin') {
            setOpenCategory('stitch_coin');
            setConfirmingCoinPack(product);
          } else {
            setOpenCategory('ai_credit');
            setConfirmingAiCreditPack(product);
          }
        }}
        onSignIn={() => {
          closeCommerceOverlays();
          router.push({ pathname: '/(tabs)/(settings)/sign-in', params: { returnTo: 'commerce' } });
        }}
        onDismiss={() => setGuestCommerceProduct(null)}
      />
      {resultModal !== null && !productSheetPresented && (
        <PurchaseResultModal
          visible
          variant={resultModal.variant}
          title={resultModal.title}
          body={resultModal.body}
          detail={resultModal.detail}
          onDismiss={() => setResultModal(null)}
        />
      )}
      <PremiumConfirmation
        onDismiss={handlePremiumConfirmationDismiss}
        product={confirmingPremium}
        trialOffer={confirmingPremium === null
          ? null
          : premiumTrialOffer(confirmingPremium, trialEligibleKeys)}
        onCancel={() => setConfirmingPremium(null)}
        onConfirm={confirmPremiumPurchase}
      />
      <PlanChangeConfirmation
        onDismiss={handlePremiumConfirmationDismiss}
        current={confirmingPlanChange?.current ?? null}
        target={confirmingPlanChange?.target ?? null}
        onCancel={() => setConfirmingPlanChange(null)}
        onConfirm={(target) => {
          if (confirmingPlanChange !== null) {
            confirmPlanChangePurchase(target, confirmingPlanChange.current.productKey);
          }
        }}
      />
    </>
  );
}

function SupportReferenceRow({ reference }: { readonly reference: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current !== null) {
      clearTimeout(resetTimer.current);
    }
  }, []);

  const copyReference = useCallback(() => {
    void (async () => {
      try {
        await Clipboard.setStringAsync(reference);
        setCopied(true);
        if (resetTimer.current !== null) {
          clearTimeout(resetTimer.current);
        }
        resetTimer.current = setTimeout(() => setCopied(false), 2000);
      } catch {
        Alert.alert('Copy failed', 'The support reference could not be copied. Select the text to copy it manually.');
      }
    })();
  }, [reference]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Copy support reference ${reference}`}
      accessibilityHint="Copies the support reference to the clipboard"
      onPress={copyReference}
      style={({ pressed }) => [styles.supportReferenceRow, pressed && styles.supportReferenceRowPressed]}
    >
      <Text style={styles.supportReference}>Support Reference: {reference}</Text>
      <Ionicons
        name={copied ? 'checkmark-outline' : 'copy-outline'}
        size={14}
        color={copied ? Theme.colors.success : Theme.colors.textSecondary}
      />
      {copied && <Text style={styles.supportReferenceCopied}>Copied</Text>}
    </Pressable>
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

function PremiumConfirmation({
  product,
  trialOffer,
  onCancel,
  onConfirm,
  onDismiss,
}: {
  product: CommerceProduct | null;
  trialOffer: string | null;
  onCancel: () => void;
  onConfirm: (product: CommerceProduct) => void;
  onDismiss: () => void;
}) {
  return (
    <Modal
      animationType="fade"
      onDismiss={onDismiss}
      onRequestClose={onCancel}
      testID="premium-confirmation-modal"
      transparent
      visible={product !== null}
    >
      <View style={styles.confirmationRoot}>
        {/* The disclosure roughly doubles this card, so its content scrolls:
            under a large accessibility text size the terms, both links, and the
            Confirm action all have to stay reachable. */}
        <View
          accessibilityViewIsModal
          style={[styles.confirmationCard, styles.premiumConfirmationCard]}
        >
          <ScrollView contentContainerStyle={styles.premiumConfirmationContent}>
            <Text style={styles.confirmationTitle}>Confirm Premium purchase</Text>
            {product !== null && (
              <>
                <Text style={styles.confirmationPlan}>
                  {`${product.label} · ${paidOfferLabel(product)}`}
                </Text>
                {trialOffer !== null && (
                  <Text style={styles.trial}>
                    {`Your store reports this introductory offer: ${trialOffer}.`}
                  </Text>
                )}
                <Text style={styles.confirmationBody}>
                  Premium appears only after the Game Backend verifies the store transaction.
                </Text>
                <SubscriptionDisclosure
                  plan={product}
                  testID="premium-confirmation-disclosure"
                />
                <View style={styles.confirmationActions}>
                  <Button title="Cancel" onPress={onCancel} variant="secondary" />
                  <Button title={`Confirm ${product.label}`} onPress={() => onConfirm(product)} variant="rose" />
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * The direct iOS upgrade confirmation (issue #123). Shows the Current Plan,
 * the target plan's localized price, billing period, and Membership Credit
 * Grant allowance, and states that the App Store controls the final charge
 * and effective date. Reuses SubscriptionDisclosure rather than writing new
 * trial copy: the store-standard forfeiture clause already covers a plan
 * change without generically promising either trial loss or preservation.
 */
function PlanChangeConfirmation({
  current,
  target,
  onCancel,
  onConfirm,
  onDismiss,
}: {
  current: CommerceProduct | null;
  target: CommerceProduct | null;
  onCancel: () => void;
  onConfirm: (product: CommerceProduct) => void;
  onDismiss: () => void;
}) {
  const visible = current !== null && target !== null;
  return (
    <Modal
      animationType="fade"
      onDismiss={onDismiss}
      onRequestClose={onCancel}
      testID="plan-change-confirmation-modal"
      transparent
      visible={visible}
    >
      <View style={styles.confirmationRoot}>
        <View
          accessibilityViewIsModal
          style={[styles.confirmationCard, styles.premiumConfirmationCard]}
        >
          <ScrollView contentContainerStyle={styles.premiumConfirmationContent}>
            <Text style={styles.confirmationTitle}>Confirm Premium upgrade</Text>
            {current !== null && target !== null && (
              <>
                <Text style={styles.confirmationPlan}>Current Plan: {current.label}</Text>
                <Text style={styles.confirmationPlan}>
                  {`Upgrade to ${target.label} · ${paidOfferLabel(target)}`}
                </Text>
                {target.credits !== undefined && (
                  <Text style={styles.planCredits}>
                    {creditAllowanceLabel(target.credits, target.creditPeriod)}
                  </Text>
                )}
                <Text style={styles.confirmationBody}>
                  The App Store controls the final charge and effective date for this
                  upgrade. Premium reflects {target.label} only after the Game Backend
                  verifies it.
                </Text>
                <SubscriptionDisclosure plan={target} testID="plan-change-confirmation-disclosure" />
                <View style={styles.confirmationActions}>
                  <Button title="Cancel" onPress={onCancel} variant="secondary" />
                  <Button title="Confirm upgrade" onPress={() => onConfirm(target)} variant="rose" />
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * The store-standard subscription terms, rendered above the Premium purchase
 * action and again inside the Premium confirmation: the confirmation covers the
 * screen, so a player who commits from there must still be able to read the
 * terms and reach both legal documents.
 */
function SubscriptionDisclosure({
  plan,
  presentation = 'card',
  testID,
}: {
  plan: CommerceProduct;
  presentation?: 'card' | 'compact';
  testID: string;
}) {
  return (
    <View
      style={[
        styles.disclosure,
        presentation === 'compact' && styles.disclosureCompact,
      ]}
      testID={testID}
    >
      <Text style={styles.disclosureText}>{subscriptionTerms(plan)}</Text>
      <View style={styles.disclosureLinks}>
        <Pressable
          accessibilityRole="link"
          onPress={() => openLegalLink('Privacy Policy', WebLinks.privacyPolicy)}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <Text style={styles.disclosureLink}>Privacy Policy</Text>
        </Pressable>
        <Text style={styles.disclosureSeparator}>·</Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => openLegalLink('Terms of Service', WebLinks.termsOfService)}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <Text style={styles.disclosureLink}>Terms of Service</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The plan's price and billing period are read from its own store package, so a
 * price or period changed in App Store Connect or Play Console cannot make the
 * disclosure lie. A package that carries no subscription period simply drops the
 * period clause rather than asserting one.
 */
function subscriptionTerms(plan: CommerceProduct): string {
  const store = storeAccountName();
  return `Payment is charged to your ${store} account at confirmation. `
    + `${plan.label} Premium renews automatically at ${paidOfferLabel(plan)} unless `
    + 'auto-renew is turned off at least 24 hours before the end of the current period. '
    + 'Any unused portion of a free trial is forfeited when you purchase a subscription. '
    + `You can cancel at any time from your ${store} account.`;
}

// The disclosure names the store the player is actually holding, so the
// cancellation instructions match the device in their hand.
function storeAccountName(): string {
  return Platform.OS === 'ios' ? 'App Store' : 'Google Play';
}

// Same destinations and same failure handling Settings already uses for these
// two documents: a link that cannot be opened tells the player instead of
// failing silently at the point of purchase.
function openLegalLink(title: string, url: string): void {
  void withProtectedRoundTrip('external-link', () => Linking.openURL(url), {
    keepUntilForeground: true,
  }).catch(() => {
    Alert.alert(title, `Could not open link: ${url}`);
  });
}

// Rendered as an overlay inside the open ProductSheet modal, never as a nested
// Modal: iOS silently refuses to present a second modal over an already
// presented one, which made the Buy button look unresponsive.
function CoinPackConfirmation({
  product,
  onCancel,
  onConfirm,
}: {
  product: CommerceProduct | null;
  onCancel: () => void;
  onConfirm: (product: CommerceProduct) => void;
}) {
  if (product === null) return null;
  return (
    <View style={styles.confirmationOverlay} testID="coin-pack-confirmation">
      <View accessibilityViewIsModal style={styles.confirmationCard}>
        <Text style={styles.confirmationTitle}>Confirm Stitch Coin purchase</Text>
        <Text style={styles.confirmationPlan}>
          {product.label} · {product.priceString}
        </Text>
        <Text style={styles.confirmationBody}>
          Your balance changes only after the Game Backend verifies the store transaction
          and records the matching Commerce Ledger grant.
        </Text>
        <View style={styles.confirmationActions}>
          <Button title="Cancel" onPress={onCancel} variant="secondary" />
          <Button title={`Confirm ${product.label}`} onPress={() => onConfirm(product)} variant="honey" />
        </View>
      </View>
    </View>
  );
}

// Overlay inside the open ProductSheet modal for the same reason as
// CoinPackConfirmation: no nested Modal on iOS.
function AiCreditPackConfirmation({
  product,
  onCancel,
  onConfirm,
}: {
  product: CommerceProduct | null;
  onCancel: () => void;
  onConfirm: (product: CommerceProduct) => void;
}) {
  if (product === null) return null;
  return (
    <View style={styles.confirmationOverlay} testID="ai-credit-pack-confirmation">
      <View accessibilityViewIsModal style={styles.confirmationCard}>
        <Text style={styles.confirmationTitle}>Confirm AI Credit purchase</Text>
        <Text style={styles.confirmationPlan}>
          {product.label} · {product.priceString}
        </Text>
        <Text style={styles.confirmationBody}>
          Your balance changes only after the Game Backend verifies the store transaction
          and records the matching Commerce Ledger grant. Premium Membership is not required.
        </Text>
        <View style={styles.confirmationActions}>
          <Button title="Cancel" onPress={onCancel} variant="secondary" />
          <Button title={`Confirm ${product.label}`} onPress={() => onConfirm(product)} variant="rose" />
        </View>
      </View>
    </View>
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
  reconcilingProductKey,
  confirmation,
  onClose,
  onDismiss,
  onShow,
  onPurchase,
}: {
  category: CommerceCategory | null;
  products: readonly CommerceProduct[];
  pendingProductKey: string | null;
  purchasingKey: string | null;
  reconcilingProductKey: string | null;
  confirmation: React.ReactNode;
  onClose: () => void;
  onDismiss: () => void;
  onShow: () => void;
  onPurchase: (product: CommerceProduct) => void;
}) {
  const requestedVisible = category === 'stitch_coin' || category === 'ai_credit';
  const sheetTranslateY = useRef(new Animated.Value(640)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const backdropClosingRef = useRef(false);

  useEffect(() => {
    if (!requestedVisible) {
      sheetTranslateY.stopAnimation();
      backdropOpacity.stopAnimation();
      backdropOpacity.setValue(0);
      backdropClosingRef.current = false;
      return;
    }
    sheetTranslateY.setValue(640);
    backdropOpacity.setValue(0);
    Animated.timing(sheetTranslateY, {
      duration: 260,
      toValue: 0,
      useNativeDriver: true,
    }).start();
    Animated.sequence([
      Animated.delay(70),
      Animated.timing(backdropOpacity, {
        duration: 180,
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropOpacity, requestedVisible, sheetTranslateY]);

  const closeWithBackdropFade = useCallback(() => {
    if (backdropClosingRef.current) return;
    backdropClosingRef.current = true;
    backdropOpacity.stopAnimation();
    Animated.timing(backdropOpacity, {
      duration: 150,
      toValue: 0,
      useNativeDriver: true,
    }).start(() => onClose());
  }, [backdropOpacity, onClose]);

  const title = category === 'stitch_coin' ? 'Stitch Coin Packs' : 'AI Credit Packs';
  return (
    <Modal
      animationType="none"
      onDismiss={onDismiss}
      onRequestClose={closeWithBackdropFade}
      onShow={onShow}
      testID="product-sheet-modal"
      transparent
      visible={requestedVisible}
    >
      <View style={styles.modalRoot}>
        <Animated.View
          style={[styles.modalBackdrop, { opacity: backdropOpacity }]}
          testID="product-sheet-backdrop"
        >
          <Pressable
            accessibilityLabel="Close product sheet"
            onPress={closeWithBackdropFade}
            style={styles.modalBackdropPressable}
          />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={[styles.sheet, { transform: [{ translateY: sheetTranslateY }] }]}
          testID="product-sheet-panel"
        >
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.sheetTitle}>{title}</Text>
              <Text style={styles.sheetSubtitle}>Current prices from the app store</Text>
            </View>
            <Pressable accessibilityLabel="Close" onPress={closeWithBackdropFade} style={styles.sheetClose}>
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
                  disabled={purchasingKey !== null || reconcilingProductKey === product.productKey}
                  variant={category === 'stitch_coin' ? 'honey' : 'rose'}
                  style={styles.sheetBuyButton}
                />
              </View>
            ))}
          </View>
        </Animated.View>
        {confirmation}
      </View>
    </Modal>
  );
}

/**
 * A canonical product the current offering did not return no longer hides
 * anything from the player, so it has to stay visible to the team: it is both
 * warned about locally and reported on the gameplay-event analytics channel.
 * The dedupe key keeps repeated store loads from queueing the same report twice.
 */
async function reportMissingCanonicalProducts(missing: readonly string[]): Promise<void> {
  if (missing.length === 0) return;
  console.warn(`Commerce Store catalog is missing canonical products: ${missing.join(', ')}`);
  await Promise.all(missing.map(async (storeProductIdentifier) => {
    const identity = commerceProductIdentity(storeProductIdentifier);
    if (identity === null) {
      // The canonical identifier list and the product catalog are maintained
      // separately; a drift between them must not drop the report in silence.
      console.warn(`Commerce Store cannot report an unknown store product: ${storeProductIdentifier}`);
      return;
    }
    await captureGameplayEvent(
      'commerce_catalog_incomplete',
      { product_kind: identity.productKind, product_key: identity.productKey },
      `commerce_catalog_incomplete:${storeProductIdentifier}`,
    );
  }));
}

// Quantities are grouped for the English pack copy they sit in, not for the
// device locale, so the summary always matches the pack labels beside it.
function packSummary(packs: readonly CommerceProduct[], noun: string): string {
  return `${packs.map((pack) => pack.quantity.toLocaleString('en-US')).join(' · ')} ${noun}`;
}

// A Guest Player learns why sign-in is being asked of them before anything
// navigates, so the control never reads as a dead button. A single continue
// Guest restore maps the anonymous RevenueCat subscriber first; the backend
// webhook then decides which verified Premium entitlement can be re-owned.

// A trial is advertised only when the store carries a free introductory offer
// for this exact product and reports the player eligible for it. A missing or
// paid offer, a negative report, or unknown eligibility all fall back to the
// ordinary paid offer.
function premiumTrialOffer(
  product: CommerceProduct,
  eligibleProductKeys: readonly PurchaseProductKey[],
): string | null {
  if (product.freeIntroductoryOffer === null) return null;
  if (!eligibleProductKeys.includes(product.productKey)) return null;
  return `Free for ${product.freeIntroductoryOffer}, then ${paidOfferLabel(product)}`;
}

// One rendering of a plan's recurring charge — "$7.99 every 1 month" — shared by
// the disclosure, the confirmation and the trial line, so the same plan can
// never be quoted three different ways.
function paidOfferLabel(product: CommerceProduct): string {
  return product.billingPeriod === null
    ? product.priceString
    : `${product.priceString} every ${product.billingPeriod}`;
}

// A Membership Credit Grant is attached to each verified *paid* Membership
// Period, so the allowance stays qualified as paid while naming this plan's own
// period instead of a generic one.
function creditAllowanceLabel(credits: number, creditPeriod: string | null): string {
  return creditPeriod === null
    ? `${credits} credits / paid period`
    : `${credits} credits / paid ${creditPeriod}`;
}

function isPurchaseCancelled(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'userCancelled' in error
    && error.userCancelled === true;
}

function purchaseErrorMessage(error: unknown): string {
  const code = purchaseErrorCode(error);

  switch (code) {
    case '2':
      return 'The store is temporarily unavailable. Please try again in a few minutes.';
    case '3':
      return 'Purchases are not allowed on this device. Check your store account or parental controls.';
    case '4':
    case '5':
      return 'This item is not available for purchase right now. Please choose another item or try again later.';
    case '6':
      return 'You already own this purchase. Use Restore Purchases to refresh your access.';
    case '10':
    case '35':
      return 'Could not connect to the store. Check your internet connection and try again.';
    case '20':
      return 'Your payment is pending approval. Your purchase will appear after the store completes it.';
    case '42':
      return 'The test purchase was declined. No payment was made. Choose a different Test Store result in Settings, then try again.';
    default:
      return error instanceof Error && error.message
        ? error.message
        : 'We could not complete your purchase. No payment was taken. Please try again.';
  }
}

function purchaseErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const { code } = error;
  return typeof code === 'string' || typeof code === 'number' ? String(code) : null;
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
  membershipActionsCard: { gap: Theme.spacing.md },
  membershipActionsTitle: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
  },
  membershipActionsBody: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.sm,
    lineHeight: 20,
  },
  scheduledChangeNotice: {
    color: Theme.colors.accentTeal,
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
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
    flexShrink: 1,
    fontFamily: 'monospace',
    fontSize: Theme.typography.sizes.xs,
  },
  supportReferenceCopied: {
    color: Theme.colors.success,
    fontSize: Theme.typography.sizes.xs,
  },
  supportReferenceRow: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: Theme.spacing.xs,
    paddingVertical: Theme.spacing.xs,
  },
  supportReferenceRowPressed: {
    opacity: 0.6,
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
  disclosure: {
    backgroundColor: Theme.colors.card,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    gap: Theme.spacing.sm,
    padding: Theme.spacing.md,
  },
  disclosureCompact: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
  },
  disclosureText: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.xs,
    lineHeight: 17,
  },
  disclosureLinks: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Theme.spacing.sm,
  },
  disclosureLink: {
    color: Theme.colors.accentTeal,
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.semibold,
  },
  disclosureSeparator: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.xs,
  },
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
  confirmationOverlay: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(25, 24, 22, 0.42)',
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
  premiumConfirmationCard: { maxHeight: '86%', padding: 0 },
  premiumConfirmationContent: { gap: Theme.spacing.md, padding: Theme.spacing.xl },
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
  modalBackdropPressable: { flex: 1 },
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
