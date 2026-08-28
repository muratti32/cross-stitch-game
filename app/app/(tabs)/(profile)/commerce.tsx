import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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

import { isServerApiError, localizeServerError } from '@/api/localizeServerError';
import { formatDate, formatNumber } from '@/i18n';
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
  // A store-accepted downgrade takes effect only at the next renewal, so this
  // attempt is verified against the Scheduled Plan Change the Game Backend
  // projects, never against a new active plan (issue #125).
  readonly deferred: boolean;
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

// Product names are app-authored display text, not the store price, so
// they localize through translation keys like everything else on this
// screen (#164). The Stitch Coin/AI Credit pack quantity is an in-app
// number and goes through formatNumber per the active locale; the three
// Premium Plan names have no count to interpolate.
const PREMIUM_PRODUCT_LABEL_KEYS: Readonly<Record<string, string>> = {
  premium_annual: 'products.premiumAnnual',
  premium_monthly: 'products.premiumMonthly',
  premium_weekly: 'products.premiumWeekly',
};

function productLabel(product: CommerceProduct, t: TFunction, locale: string): string {
  const premiumKey = PREMIUM_PRODUCT_LABEL_KEYS[product.productKey];
  if (premiumKey !== undefined) return t(premiumKey);
  const packKey = product.category === 'stitch_coin' ? 'products.stitchCoinPack' : 'products.aiCreditPack';
  return t(packKey, {
    count: product.quantity,
    formattedCount: formatNumber(product.quantity, locale),
  });
}

// `membership.plan`/`scheduledChange.targetPlan` are the same three Premium
// Plan names as PREMIUM_PRODUCT_LABEL_KEYS above, just keyed by the plan enum
// rather than a productKey, so this reuses the same translated labels instead
// of leaving them as a raw English `capitalize()` of the backend value.
function premiumPlanLabel(plan: string, t: TFunction): string {
  const key = PREMIUM_PRODUCT_LABEL_KEYS[`premium_${plan}`];
  return key === undefined ? capitalize(plan) : t(key);
}

export default function CommerceScreen() {
  const { t, i18n: i18nInstance } = useTranslation('commerce');
  const locale = i18nInstance.language;
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
    readonly kind: PremiumPlanChangeKind;
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
  const pendingPlanChangeRef = useRef<{
    readonly kind: PremiumPlanChangeKind;
    readonly sourcePlanKey: PurchaseProductKey;
  } | null>(null);
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

  // Every entitled lifecycle holds the plan it names, so it is the Current
  // Plan: identified on its card, not repurchasable, and never displaced by an
  // automatic preselection (issue #121 story 1). Only `trial` and `active` can
  // also change plan from here; `grace`, `billing_retry`, `paused`, and
  // `cancelled` keep the identification but expose no plan action at all, with
  // Manage Subscription as their single control. Inactive lifecycles fall
  // through to the ordinary new-plan purchase journey below.
  const entitledLifecycle = membership?.active === true;
  const currentPlanLifecycle = entitledLifecycle
    && (membership.lifecycle === 'active' || membership.lifecycle === 'trial');
  const currentPlanProductKey = entitledLifecycle
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
  const showPremiumPlanGrid = entitledLifecycle ? currentPlanMapped : true;
  // Store acceptance locks every Premium Plan action until the Game Backend
  // settles the outcome (issue #121): a second upgrade or plan change started
  // over an unverified one would overlap in the subscription group.
  const premiumActionsLocked = purchasePending !== null || purchasingKey !== null;

  useEffect(() => {
    if (entitledLifecycle && currentPlanMapped && currentPlanProductKey !== null) {
      setSelectedPremiumKey(currentPlanProductKey);
    }
  }, [currentPlanMapped, currentPlanProductKey, entitledLifecycle]);

  // A Scheduled Plan Change activates at the next renewal, long after the
  // session that requested it and possibly on no device at all, so its
  // `subscription_change_completed` is derived once by the Game Backend from
  // the activation it already projects (issue #126) rather than guessed here
  // from a device-local memory of the scheduled state.
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
      title: t('errors.purchaseFailedTitle'),
      body: message,
      detail: supportReference === null ? null : t('supportReference.label', { reference: supportReference }),
    });
  }, [t]);

  // A prolonged wait is not a failure: the Purchase Reconciliation Pending state
  // says verification is still under way and the balance will update, and offers
  // no retry — retry stays on the page-level banner, one path only.
  const showReconciliationPendingModal = useCallback((body: string) => {
    setResultModal({ variant: 'info', title: t('pendingModal.stillVerifyingTitle'), body, detail: null });
  }, [t]);

  const reconcilePremium = useCallback(async (attempt: PremiumReconciliation) => {
    if (reconciliationRef.current?.id !== attempt.id) return;
    let verifiedMembership: MembershipView | null = null;
    try {
      if (attempt.guestAttemptId !== null) {
        const guestAttempt = await fetchGuestPurchaseAttempt(attempt.guestAttemptId);
        if (guestAttempt.status === 'created' || guestAttempt.status === 'verifying') {
          if (Date.now() - attempt.startedAt >= RECONCILIATION_DELAY_MS) {
            updateReconciliation({ ...attempt, prolonged: true });
            showReconciliationPendingModal(attempt.deferred
              ? t('pendingModal.premiumPlanChangePending')
              : t('pendingModal.premiumPending'));
          } else {
            scheduleReconciliation(attempt);
          }
          return;
        }
        if (guestAttempt.status !== 'granted') {
          updateReconciliation({ ...attempt, failureStage: 'verification' });
          const message = t('errors.premiumVerificationNotYet');
          setPurchaseError(message);
          showFailureModal(message, attempt.supportReference);
          return;
        }
      }
      verifiedMembership = await fetchMembership();
      const observedProductKey = premiumProductKey(verifiedMembership.plan);
      // A deferred downgrade leaves the active plan alone: what the Game
      // Backend eventually exposes is the Scheduled Plan Change, and that is
      // the only outcome this attempt can wait for (issue #125).
      const scheduledProductKey = verifiedMembership.scheduledChange == null
        ? null
        : premiumProductKey(verifiedMembership.scheduledChange.targetPlan);
      const backendVerified = attempt.deferred
        ? verifiedMembership.active && scheduledProductKey === attempt.product.productKey
        : verifiedMembership.active
          && observedProductKey !== null
          && (attempt.operation === 'restore'
            || (observedProductKey === attempt.product.productKey
              && membershipFingerprint(verifiedMembership) !== attempt.baselineMembership));

      if (!backendVerified) {
        if (Date.now() - attempt.startedAt >= RECONCILIATION_DELAY_MS) {
          updateReconciliation({ ...attempt, prolonged: true });
          showReconciliationPendingModal(attempt.deferred
            ? t('pendingModal.premiumPlanChangePending')
            : t('pendingModal.premiumPending'));
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
      // A scheduled change grants nothing yet, so it reports neither the
      // Commerce Ledger grant (`purchase_completed`) nor the change itself
      // (`subscription_change_completed`). Both belong to the activation at the
      // next renewal, which no device is guaranteed to witness: the Game
      // Backend derives `subscription_change_completed` from it instead
      // (issue #126).
      if (!attempt.deferred) {
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
      }
      updateReconciliation(null);
      clearIntent();
      setPurchaseError(null);
      const completedLabel = productLabel(completedProduct, t, locale);
      if (attempt.deferred) {
        const effectiveOn = verifiedMembership.scheduledChange == null
          ? ''
          : t('success.effectiveOnDate', { date: formatDate(new Date(verifiedMembership.scheduledChange.effectiveAt), locale) });
        setPurchaseSuccess(t('success.premiumChanges', { label: completedLabel, effectiveOn }));
        setResultModal({
          variant: 'success',
          title: t('success.planChangeScheduledTitle'),
          body: t('success.planChangeScheduledBody', { label: completedLabel, effectiveOn }),
          detail: null,
        });
      } else {
        setPurchaseSuccess(t('success.premiumVerifiedAndActive', { label: completedLabel }));
        setResultModal({
          variant: 'success',
          title: t('success.premiumIsActiveTitle'),
          body: completedProduct.billingPeriod === null
            ? t('success.premiumNowActiveNoBilling', { label: completedLabel })
            : t('success.premiumNowActiveBilled', { label: completedLabel, period: completedProduct.billingPeriod }),
          detail: null,
        });
      }
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
      const message = isServerApiError(error)
        ? localizeServerError(error)
        : failureStage === 'verification'
          ? t('errors.premiumVerificationFailedRetry')
          : t('errors.premiumGrantRefreshFailed');
      setPurchaseError(message);
      showFailureModal(message, attempt.supportReference);
    }
  }, [clearIntent, locale, products, refetchCommerceState, scheduleReconciliation, showFailureModal, showReconciliationPendingModal, t, updateReconciliation]);

  const beginPremiumReconciliation = useCallback(async (
    product: CommerceProduct,
    operation: 'purchase' | 'restore',
    baselineMembership: string | null = null,
    guestAttempt: GuestPurchaseAttemptReference | null = null,
    sourcePlanKey: PurchaseProductKey | null = null,
    deferred = false,
  ) => {
    const attempt: PremiumReconciliation = {
      baselineMembership,
      deferred,
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
    } catch (error: unknown) {
      await captureGameplayEvent('purchase_failed', {
        product_kind: 'premium_membership',
        product_key: product.productKey,
        failure_stage: 'verification',
      });
      updateReconciliation({ ...attempt, failureStage: 'verification' });
      const message = isServerApiError(error)
        ? localizeServerError(error)
        : t('errors.premiumReconciliationUnreachable');
      setPurchaseError(message);
      showFailureModal(message, attempt.supportReference);
    }
  }, [reconcilePremium, showFailureModal, t, updateReconciliation]);

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
          showReconciliationPendingModal(t('pendingModal.coinPackPending'));
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
        const message = t('errors.coinPackVerificationMismatch');
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
        const message = t('errors.coinPackGrantUnavailable');
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
      const label = productLabel(attempt.product, t, locale);
      setPurchaseSuccess(
        t('success.coinPackGrantVerified', { label, balance: formatNumber(refreshedBalance, locale) }),
      );
      setResultModal({
        variant: 'success',
        title: t('success.coinPackGrantedTitle'),
        body: t('success.coinPackAddedToBalance', { quantity: formatNumber(attempt.product.quantity, locale) }),
        detail: null,
      });
    } catch (error: unknown) {
      const failureStage = grantVerified ? 'grant' : 'verification';
      await captureGameplayEvent('purchase_failed', {
        product_kind: 'stitch_coin_pack',
        product_key: attempt.product.productKey,
        failure_stage: failureStage,
      });
      updateCoinReconciliation({ ...attempt, failureStage });
      const message = isServerApiError(error)
        ? localizeServerError(error)
        : grantVerified
          ? t('errors.coinPackBalanceRefreshFailed')
          : t('errors.coinPackVerificationFailedRetry');
      setPurchaseError(message);
      showFailureModal(message, attempt.supportReference);
    }
  }, [clearIntent, guestId, isAccount, locale, queryClient, scheduleCoinReconciliation, showFailureModal, showReconciliationPendingModal, t, updateCoinReconciliation]);

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
    } catch (error: unknown) {
      await captureGameplayEvent('purchase_failed', {
        product_kind: 'stitch_coin_pack',
        product_key: product.productKey,
        failure_stage: 'verification',
      });
      updateCoinReconciliation({ ...attempt, failureStage: 'verification' });
      const message = isServerApiError(error)
        ? localizeServerError(error)
        : t('errors.coinPackReconciliationUnreachable');
      setPurchaseError(message);
      showFailureModal(message, attempt.supportReference);
    }
  }, [reconcileCoinPack, showFailureModal, t, updateCoinReconciliation]);

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
          showReconciliationPendingModal(t('pendingModal.aiCreditPackPending'));
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
        const message = t('errors.aiCreditPackVerificationMismatch');
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
        const message = t('errors.aiCreditPackGrantUnavailable');
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
      const label = productLabel(attempt.product, t, locale);
      setPurchaseSuccess(
        t('success.aiCreditPackGrantVerified', { label, balance: formatNumber(refreshedBalance, locale) }),
      );
      setResultModal({
        variant: 'success',
        title: t('success.aiCreditPackGrantedTitle'),
        body: t('success.aiCreditPackAddedToBalance', { quantity: formatNumber(attempt.product.quantity, locale) }),
        detail: null,
      });
    } catch (error: unknown) {
      const failureStage = grantVerified ? 'grant' : 'verification';
      await captureGameplayEvent('purchase_failed', {
        product_kind: 'ai_credit_pack',
        product_key: attempt.product.productKey,
        failure_stage: failureStage,
      });
      updateAiCreditReconciliation({ ...attempt, failureStage });
      const message = isServerApiError(error)
        ? localizeServerError(error)
        : grantVerified
          ? t('errors.aiCreditPackBalanceRefreshFailed')
          : t('errors.aiCreditPackVerificationFailedRetry');
      setPurchaseError(message);
      showFailureModal(message, attempt.supportReference);
    }
  }, [clearIntent, guestId, isAccount, locale, queryClient, scheduleAiCreditReconciliation, showFailureModal, showReconciliationPendingModal, t, updateAiCreditReconciliation]);

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
    } catch (error: unknown) {
      await captureGameplayEvent('purchase_failed', {
        product_kind: 'ai_credit_pack',
        product_key: product.productKey,
        failure_stage: 'verification',
      });
      updateAiCreditReconciliation({ ...attempt, failureStage: 'verification' });
      const message = isServerApiError(error)
        ? localizeServerError(error)
        : t('errors.aiCreditPackReconciliationUnreachable');
      setPurchaseError(message);
      showFailureModal(message, attempt.supportReference);
    }
  }, [reconcileAiCreditPack, showFailureModal, t, updateAiCreditReconciliation]);

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
    planChangeKind: PremiumPlanChangeKind | null = null,
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
        if (Platform.OS !== 'ios') throw new Error(t('errors.guestIosOnlyStitchCoin'));
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
      const purchasedLabel = productLabel(product, t, locale);
      setResultModal({
        variant: 'pending',
        title: t('success.purchaseReceivedTitle'),
        body: planChangeKind === 'plan_change'
          ? t('success.storeAcceptedPlanChange', { label: purchasedLabel })
          : t('success.storeAcceptedPurchase', { label: purchasedLabel }),
        detail: null,
      });
      failureStage = 'verification';
      if (product.category === 'premium') {
        await beginPremiumReconciliation(
          product,
          'purchase',
          baselineMembership,
          guestAttempt,
          sourcePlanKey,
          planChangeKind === 'plan_change',
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
      const message = isServerApiError(error) ? localizeServerError(error) : purchaseErrorMessage(error, t);
      setPurchaseError(message);
      // The page-level banner above keeps the durable recovery copy; the modal
      // only reports the outcome and offers dismissal, so there is one retry
      // path rather than two competing ones.
      // The reference is shown for every Guest failure, cancelled attempts
      // included: the Purchase Attempt record outlives its cancellation and is
      // what support looks the player up by.
      setResultModal({
        variant: 'failed',
        title: t('errors.purchaseFailedTitle'),
        body: message,
        detail: guestAttempt === null
          ? null
          : t('supportReference.label', { reference: guestAttempt.supportReference }),
      });
    } finally {
      setPurchasingKey(null);
    }
  }, [accountId, beginAiCreditPackReconciliation, beginCoinPackReconciliation, beginPremiumReconciliation, guestId, isAccount, locale, t]);

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
    const planChange = pendingPlanChangeRef.current;
    pendingPlanChangeRef.current = null;
    void purchase(
      product,
      planChange?.sourcePlanKey ?? null,
      planChange?.kind ?? null,
    ).finally(() => {
      premiumPurchaseInFlightRef.current = false;
    });
  }, [purchase]);

  // A direct Premium Plan change in either direction (issue #125): the store
  // applies an upgrade immediately and defers a downgrade to the next renewal,
  // but both are committed from the same in-app confirmation. Shares the iOS
  // modal-dismiss handshake with a fresh Premium purchase so RevenueCat's store
  // sheet never races the confirmation's own dismissal.
  const confirmPlanChangePurchase = useCallback((
    product: CommerceProduct,
    sourcePlanKey: PurchaseProductKey,
    kind: PremiumPlanChangeKind,
  ) => {
    if (premiumPurchaseInFlightRef.current) return;
    premiumPurchaseInFlightRef.current = true;

    if (Platform.OS !== 'ios') {
      void purchase(product, sourcePlanKey, kind).finally(() => {
        premiumPurchaseInFlightRef.current = false;
      });
      return;
    }

    pendingPremiumPurchaseRef.current = product;
    pendingPlanChangeRef.current = { kind, sourcePlanKey };
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
        setPurchaseError(t('errors.guestIosOnlyGeneric'));
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
  }, [closeCommerceOverlays, isAccount, pendingIntent, preserveIntent, router, setGuestCommerceProduct, source, t]);

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
      title: t('restore.requestedTitle'),
      body: t('restore.requestedBody'),
      detail: null,
    });
  }, [queryClient, t]);

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
      setPurchaseError(isServerApiError(error) ? localizeServerError(error) : purchaseErrorMessage(error, t));
    } finally {
      setRestoringPurchases(false);
    }
  }, [isAccount, restoreAccountPurchases, restoreGuestPremium, selectedPremium, t]);

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
      } catch (error: unknown) {
        setPurchaseError(isServerApiError(error) ? localizeServerError(error) : t('errors.reconciliationStillUnavailable'));
        updateReconciliation({ ...reset, failureStage: 'verification' });
      }
      return;
    }
    await reconcilePremium(reset);
  }, [reconcilePremium, t, updateReconciliation]);

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
      } catch (error: unknown) {
        setPurchaseError(isServerApiError(error) ? localizeServerError(error) : t('errors.reconciliationStillUnavailable'));
        updateCoinReconciliation({ ...reset, failureStage: 'verification' });
      }
      return;
    }
    await reconcileCoinPack(reset);
  }, [reconcileCoinPack, t, updateCoinReconciliation]);

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
      } catch (error: unknown) {
        setPurchaseError(isServerApiError(error) ? localizeServerError(error) : t('errors.reconciliationStillUnavailable'));
        updateAiCreditReconciliation({ ...reset, failureStage: 'verification' });
      }
      return;
    }
    await reconcileAiCreditPack(reset);
  }, [reconcileAiCreditPack, t, updateAiCreditReconciliation]);

  return (
    <>
      <Screen scrollable contentContainerStyle={styles.container}>
        <View style={styles.titleRow} testID="commerce-store-screen">
          <Pressable
            accessibilityLabel={t('screen.backAccessibilityLabel')}
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Ionicons name="arrow-back" size={22} color={Theme.colors.accentTeal} />
          </Pressable>
          <View style={styles.titleCopy}>
            <Text style={styles.title}>{t('screen.title')}</Text>
            <Text style={styles.subtitle}>{t('screen.subtitle')}</Text>
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
              {t('signInReturn.notice', { label: productLabel(returnedProduct, t, locale) })}
            </Text>
          </View>
        )}

        <View style={styles.premiumHero}>
          <View style={styles.premiumHeroTop}>
            <View style={styles.premiumIcon}>
              <Ionicons name="diamond-outline" size={24} color={Theme.colors.accentRose} />
            </View>
            <View style={styles.premiumHeroCopy}>
              <Text style={styles.eyebrow}>{t('premiumHero.eyebrow')}</Text>
              <Text style={styles.premiumTitle}>{t('premiumHero.title')}</Text>
            </View>
          </View>
          <Text style={styles.premiumBody}>
            {t('premiumHero.body')}
          </Text>
          <View style={styles.benefitRow}>
            <Benefit icon="sparkles-outline" label={t('premiumHero.benefitAiCredits')} />
            <Benefit icon="calendar-outline" label={t('premiumHero.benefitDailyCoins')} />
            <Benefit icon="color-palette-outline" label={t('premiumHero.benefitThemes')} />
          </View>
          <Text style={styles.membershipStatus}>
            {membership?.active
              ? `${membershipLifecycleLabel(membership.lifecycle, t)}${membership.plan ? ` · ${premiumPlanLabel(membership.plan, t)}` : ''}`
              : isAccount
                ? t('premiumHero.statusNoActiveMembership')
                : t('premiumHero.statusBrowseAsGuest')}
          </Text>
          {membership?.active && membership.expiresAt && (
            <Text style={styles.membershipPeriod}>
              {membershipPeriodLabel(membership.lifecycle, t)}{' '}
              {formatDate(new Date(membership.expiresAt), locale)}
            </Text>
          )}
        </View>

        {membership?.active === true && (
          <Card style={styles.membershipActionsCard}>
            <Text style={styles.membershipActionsTitle}>{t('membershipActions.title')}</Text>
            <Text style={styles.membershipActionsBody}>
              {t('membershipActions.body')}
            </Text>
            {membership?.scheduledChange != null && (
              <Text style={styles.scheduledChangeNotice} testID="scheduled-plan-change-notice">
                {t('membershipActions.scheduledChangeNotice', {
                  plan: premiumPlanLabel(membership.scheduledChange.targetPlan, t),
                  date: formatDate(new Date(membership.scheduledChange.effectiveAt), locale),
                })}
              </Text>
            )}
            <Button
              title={t('membershipActions.manageSubscription')}
              onPress={() => {
                void withProtectedRoundTrip('subscription-management', () =>
                  showRevenueCatManageSubscriptions(),
                  { keepUntilForeground: true },
                ).catch(() => {
                  Alert.alert(
                    t('membershipActions.manageSubscriptionFailedTitle'),
                    t('membershipActions.manageSubscriptionFailedBody'),
                  );
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
              <Text style={styles.pendingTitle}>{t('pending.title')}</Text>
              {/* The plan under verification is named so the player can tell a
                  plan change apart from a first purchase while every Premium
                  Plan action is locked (issue #121). */}
              <Text style={styles.pendingText}>
                {purchasePending.sourcePlanKey !== null
                  ? t('pending.premiumChangeAccepted', { label: productLabel(purchasePending.product, t, locale) })
                  : t('pending.premiumResponseReceived', { label: productLabel(purchasePending.product, t, locale) })}
                {purchasePending.deferred
                  ? t('pending.premiumDeferredSuffix')
                  : t('pending.premiumSuffix')}
                {t('pending.doNotPurchasePlanAgain')}
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
                    ? t('pending.retryReconciliation')
                    : t('pending.refreshStatus')
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
                  ? t('pending.verifyingTitle')
                  : t('pending.title')}
              </Text>
              <Text style={styles.pendingText}>
                {t('pending.coinPackBody')}
              </Text>
              {coinPurchasePending.supportReference !== null && (
                <SupportReferenceRow reference={coinPurchasePending.supportReference} />
              )}
              {(coinPurchasePending.prolonged || coinPurchasePending.failureStage !== null) && (
                <Button
                  title={t('pending.retryReconciliation')}
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
              <Text style={styles.pendingTitle}>{t('pending.title')}</Text>
              <Text style={styles.pendingText}>
                {t('pending.aiCreditPackBody')}
              </Text>
              {aiCreditPurchasePending.supportReference !== null && (
                <SupportReferenceRow reference={aiCreditPurchasePending.supportReference} />
              )}
              {(aiCreditPurchasePending.prolonged
                || aiCreditPurchasePending.failureStage !== null) && (
                <Button
                  title={t('pending.retryReconciliation')}
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
            <Text style={styles.storeStateBody}>{t('store.loadingPrices')}</Text>
          </View>
        ) : storeUnavailable ? (
          <Card style={styles.storeState}>
            <Ionicons name="cloud-offline-outline" size={28} color={Theme.colors.textSecondary} />
            <Text style={styles.storeStateTitle}>{t('store.unavailableTitle')}</Text>
            <Text style={styles.storeStateBody}>
              {t('store.unavailableBody')}
            </Text>
            <Button
              title={t('store.retry')}
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
                  {entitledLifecycle ? t('plans.yourPremiumPlan') : t('plans.choosePremiumPlan')}
                </Text>
                <View style={styles.planRow}>
                  {premiumPlans.map((plan) => {
                    const isCurrentPlan = entitledLifecycle
                      && plan.productKey === currentPlanProductKey;
                    const selected = entitledLifecycle
                      ? isCurrentPlan
                      : plan.productKey === selectedPremium?.productKey;
                    const trialOffer = premiumTrialOffer(plan, trialEligibleKeys, t);
                    // A held plan can never invoke its own repurchase, and a
                    // restricted lifecycle keeps the identification without any
                    // tappable plan at all. A different plan is tappable only
                    // where a direct change is actually supported (iOS, mapped
                    // catalog, `trial` or `active`), and both directions then
                    // open the same in-app confirmation (issue #125): the store
                    // makes an upgrade immediate and a downgrade deferred, but
                    // the app owns the decision either way.
                    const planChangeKind: PremiumPlanChangeKind | null = directPlanChangeAvailable
                      && !isCurrentPlan
                      && currentPlanProductKey !== null
                      ? classifyPremiumPlanChange(currentPlanProductKey, plan.productKey)
                      : null;
                    const onPressPlan = entitledLifecycle
                      ? (planChangeKind === null
                        || premiumActionsLocked
                        || currentPlanProduct === undefined
                        ? undefined
                        : () => {
                          void captureGameplayEvent('commerce_product_selected', {
                            product_kind: plan.productKind,
                            product_key: plan.productKey,
                          });
                          setConfirmingPlanChange({
                            current: currentPlanProduct,
                            kind: planChangeKind,
                            target: plan,
                          });
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
                          <Text style={styles.bestValue}>{t('plans.currentPlan')}</Text>
                        ) : planChangeKind !== null ? (
                          <Text style={styles.bestValue}>
                            {planChangeKind === 'upgrade' ? t('plans.upgrade') : t('plans.planChange')}
                          </Text>
                        ) : (
                          !entitledLifecycle && plan.productKey === 'premium_annual' && (
                            <Text style={styles.bestValue}>{t('plans.bestValue')}</Text>
                          )
                        )}
                        <Text style={styles.planName}>{productLabel(plan, t, locale)}</Text>
                        <Text style={styles.planPrice}>{plan.priceString}</Text>
                        {plan.billingPeriod !== null && (
                          <Text style={styles.planPeriod}>{t('plans.billedEvery', { period: plan.billingPeriod })}</Text>
                        )}
                        {plan.credits !== undefined && (
                          <Text style={styles.planCredits}>
                            {creditAllowanceLabel(plan.credits, plan.creditPeriod, t, locale)}
                          </Text>
                        )}
                        {trialOffer !== null && (
                          <Text style={styles.trial}>{trialOffer}</Text>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
                {!entitledLifecycle && selectedPremium !== undefined && (
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
                      title={t('plans.chooseLabel', { label: productLabel(selectedPremium, t, locale) })}
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
              <Text style={styles.sectionTitle}>{t('onetime.sectionTitle')}</Text>
            )}
            {/* Packs the store did not return are not advertised, and the summary
                line and "from" price describe only what is purchasable. Category
                order is ascending quantity, so the first pack is the cheapest. */}
            {coinPacks.length > 0 && (
              <CategoryCard
                icon="leaf-outline"
                title={t('onetime.stitchCoinPacksTitle')}
                detail={packSummary(coinPacks, t('onetime.coinsNoun'), locale)}
                price={coinPacks[0]?.priceString}
                color={Theme.colors.accentHoney}
                onPress={() => setOpenCategory('stitch_coin')}
                testID="open-stitch-coin-packs"
              />
            )}
            {aiCreditPacks.length > 0 && (
              <CategoryCard
                icon="sparkles-outline"
                title={t('onetime.aiCreditPacksTitle')}
                detail={packSummary(aiCreditPacks, t('onetime.creditsNoun'), locale)}
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
                  {isAccount ? t('restore.restorePurchases') : t('restore.restoreGuestPremium')}
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
          : premiumTrialOffer(confirmingPremium, trialEligibleKeys, t)}
        onCancel={() => setConfirmingPremium(null)}
        onConfirm={confirmPremiumPurchase}
      />
      <PlanChangeConfirmation
        onDismiss={handlePremiumConfirmationDismiss}
        current={confirmingPlanChange?.current ?? null}
        kind={confirmingPlanChange?.kind ?? 'upgrade'}
        target={confirmingPlanChange?.target ?? null}
        onCancel={() => {
          if (confirmingPlanChange !== null) {
            void captureGameplayEvent('subscription_change_cancelled', {
              source_plan: confirmingPlanChange.current.productKey,
              target_plan: confirmingPlanChange.target.productKey,
              platform: Platform.OS === 'ios' ? 'ios' : 'android',
            });
          }
          setConfirmingPlanChange(null);
        }}
        onConfirm={(target) => {
          if (confirmingPlanChange !== null) {
            confirmPlanChangePurchase(
              target,
              confirmingPlanChange.current.productKey,
              confirmingPlanChange.kind,
            );
          }
        }}
      />
    </>
  );
}

function SupportReferenceRow({ reference }: { readonly reference: string }) {
  const { t } = useTranslation('commerce');
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
        Alert.alert(t('supportReference.copyFailedTitle'), t('supportReference.copyFailedBody'));
      }
    })();
  }, [reference, t]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('supportReference.copyAccessibilityLabel', { reference })}
      accessibilityHint={t('supportReference.copyAccessibilityHint')}
      onPress={copyReference}
      style={({ pressed }) => [styles.supportReferenceRow, pressed && styles.supportReferenceRowPressed]}
    >
      <Text style={styles.supportReference}>{t('supportReference.label', { reference })}</Text>
      <Ionicons
        name={copied ? 'checkmark-outline' : 'copy-outline'}
        size={14}
        color={copied ? Theme.colors.success : Theme.colors.textSecondary}
      />
      {copied && <Text style={styles.supportReferenceCopied}>{t('supportReference.copied')}</Text>}
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
  // A Stitch Coin/AI Credit balance is an in-app number, not a store price,
  // so it formats for the active App Display Language (#164, #157).
  const { i18n: i18nInstance } = useTranslation();
  return (
    <View style={styles.walletValue}>
      <Ionicons name={icon} size={13} color={color} />
      <Text style={styles.walletValueText}>{formatNumber(value, i18nInstance.language)}</Text>
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
  const { t, i18n: i18nInstance } = useTranslation('commerce');
  const locale = i18nInstance.language;
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
            <Text style={styles.confirmationTitle}>{t('confirmation.confirmPremiumTitle')}</Text>
            {product !== null && (
              <>
                <Text style={styles.confirmationPlan}>
                  {`${productLabel(product, t, locale)} · ${paidOfferLabel(product, t)}`}
                </Text>
                {trialOffer !== null && (
                  <Text style={styles.trial}>
                    {t('confirmation.introductoryOffer', { offer: trialOffer })}
                  </Text>
                )}
                <Text style={styles.confirmationBody}>
                  {t('confirmation.premiumAppearsAfterVerification')}
                </Text>
                <SubscriptionDisclosure
                  plan={product}
                  testID="premium-confirmation-disclosure"
                />
                <View style={styles.confirmationActions}>
                  <Button title={t('confirmation.cancel')} onPress={onCancel} variant="secondary" />
                  <Button
                    title={t('confirmation.confirmLabel', { label: productLabel(product, t, locale) })}
                    onPress={() => onConfirm(product)}
                    variant="rose"
                  />
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
/**
 * The one in-app commitment point for a direct Premium Plan change, in either
 * direction (issue #125). The store settles an upgrade immediately and defers a
 * downgrade to the next renewal, so the copy states which of the two the player
 * is committing to and, for a downgrade, that Manage Subscription is where the
 * scheduled change is cancelled (ADR-0049).
 */
function PlanChangeConfirmation({
  current,
  kind,
  target,
  onCancel,
  onConfirm,
  onDismiss,
}: {
  current: CommerceProduct | null;
  kind: PremiumPlanChangeKind;
  target: CommerceProduct | null;
  onCancel: () => void;
  onConfirm: (product: CommerceProduct) => void;
  onDismiss: () => void;
}) {
  const { t, i18n: i18nInstance } = useTranslation('commerce');
  const locale = i18nInstance.language;
  const visible = current !== null && target !== null;
  const upgrade = kind === 'upgrade';
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
            <Text style={styles.confirmationTitle}>
              {upgrade ? t('confirmation.confirmPremiumUpgradeTitle') : t('confirmation.confirmPremiumPlanChangeTitle')}
            </Text>
            {current !== null && target !== null && (
              <>
                <Text style={styles.confirmationPlan}>
                  {t('confirmation.currentPlanLabel', { label: productLabel(current, t, locale) })}
                </Text>
                <Text style={styles.confirmationPlan}>
                  {t(upgrade ? 'confirmation.upgradeToLabel' : 'confirmation.changeToLabel', {
                    label: productLabel(target, t, locale),
                    offer: paidOfferLabel(target, t),
                  })}
                </Text>
                {target.credits !== undefined && (
                  <Text style={styles.planCredits}>
                    {creditAllowanceLabel(target.credits, target.creditPeriod, t, locale)}
                  </Text>
                )}
                <Text style={styles.confirmationBody}>
                  {upgrade
                    ? t('confirmation.upgradeBody', { label: productLabel(target, t, locale) })
                    : t('confirmation.planChangeBody', {
                      currentLabel: productLabel(current, t, locale),
                      targetLabel: productLabel(target, t, locale),
                    })}
                </Text>
                <SubscriptionDisclosure plan={target} testID="plan-change-confirmation-disclosure" />
                <View style={styles.confirmationActions}>
                  <Button title={t('confirmation.cancel')} onPress={onCancel} variant="secondary" />
                  <Button
                    title={upgrade ? t('confirmation.confirmUpgrade') : t('confirmation.confirmPlanChange')}
                    onPress={() => onConfirm(target)}
                    variant="rose"
                  />
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
  const { t, i18n: i18nInstance } = useTranslation('commerce');
  const locale = i18nInstance.language;
  const privacyPolicyLabel = t('disclosure.privacyPolicy');
  const termsOfServiceLabel = t('disclosure.termsOfService');
  return (
    <View
      style={[
        styles.disclosure,
        presentation === 'compact' && styles.disclosureCompact,
      ]}
      testID={testID}
    >
      <Text style={styles.disclosureText}>{subscriptionTerms(plan, t, locale)}</Text>
      <View style={styles.disclosureLinks}>
        <Pressable
          accessibilityRole="link"
          onPress={() => openLegalLink(privacyPolicyLabel, WebLinks.privacyPolicy, t)}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <Text style={styles.disclosureLink}>{privacyPolicyLabel}</Text>
        </Pressable>
        <Text style={styles.disclosureSeparator}>·</Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => openLegalLink(termsOfServiceLabel, WebLinks.termsOfService, t)}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <Text style={styles.disclosureLink}>{termsOfServiceLabel}</Text>
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
function subscriptionTerms(plan: CommerceProduct, t: TFunction, locale: string): string {
  const store = storeAccountName(t);
  return t('disclosure.subscriptionTerms', {
    store,
    label: productLabel(plan, t, locale),
    offer: paidOfferLabel(plan, t),
  });
}

// The disclosure names the store the player is actually holding, so the
// cancellation instructions match the device in their hand.
function storeAccountName(t: TFunction): string {
  return Platform.OS === 'ios' ? t('disclosure.appStore') : t('disclosure.googlePlay');
}

// Same destinations and same failure handling Settings already uses for these
// two documents: a link that cannot be opened tells the player instead of
// failing silently at the point of purchase.
function openLegalLink(title: string, url: string, t: TFunction): void {
  void withProtectedRoundTrip('external-link', () => Linking.openURL(url), {
    keepUntilForeground: true,
  }).catch(() => {
    Alert.alert(title, t('disclosure.linkOpenFailedBody', { url }));
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
  const { t, i18n: i18nInstance } = useTranslation('commerce');
  if (product === null) return null;
  const label = productLabel(product, t, i18nInstance.language);
  return (
    <View style={styles.confirmationOverlay} testID="coin-pack-confirmation">
      <View accessibilityViewIsModal style={styles.confirmationCard}>
        <Text style={styles.confirmationTitle}>{t('confirmation.confirmStitchCoinTitle')}</Text>
        <Text style={styles.confirmationPlan}>
          {label} · {product.priceString}
        </Text>
        <Text style={styles.confirmationBody}>
          {t('confirmation.balanceChangesAfterVerificationCoin')}
        </Text>
        <View style={styles.confirmationActions}>
          <Button title={t('confirmation.cancel')} onPress={onCancel} variant="secondary" />
          <Button
            title={t('confirmation.confirmLabel', { label })}
            onPress={() => onConfirm(product)}
            variant="honey"
          />
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
  const { t, i18n: i18nInstance } = useTranslation('commerce');
  if (product === null) return null;
  const label = productLabel(product, t, i18nInstance.language);
  return (
    <View style={styles.confirmationOverlay} testID="ai-credit-pack-confirmation">
      <View accessibilityViewIsModal style={styles.confirmationCard}>
        <Text style={styles.confirmationTitle}>{t('confirmation.confirmAiCreditTitle')}</Text>
        <Text style={styles.confirmationPlan}>
          {label} · {product.priceString}
        </Text>
        <Text style={styles.confirmationBody}>
          {t('confirmation.balanceChangesAfterVerificationAiCredit')}
        </Text>
        <View style={styles.confirmationActions}>
          <Button title={t('confirmation.cancel')} onPress={onCancel} variant="secondary" />
          <Button
            title={t('confirmation.confirmLabel', { label })}
            onPress={() => onConfirm(product)}
            variant="rose"
          />
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
  const { t } = useTranslation('commerce');
  return (
    <Card onPress={onPress} style={styles.categoryCard}>
      <View testID={testID} style={styles.categoryContent}>
        <View style={[styles.categoryIcon, { backgroundColor: `${color}20` }]}>
          <Ionicons name={icon} size={24} color={color} />
        </View>
        <View style={styles.categoryCopy}>
          <Text style={styles.categoryTitle}>{title}</Text>
          <Text style={styles.categoryDetail}>{detail}</Text>
          {price && <Text style={styles.categoryPrice}>{t('onetime.fromPrice', { price })}</Text>}
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
  const { t, i18n: i18nInstance } = useTranslation('commerce');
  const locale = i18nInstance.language;
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

  const title = category === 'stitch_coin'
    ? t('onetime.stitchCoinPacksTitle')
    : t('onetime.aiCreditPacksTitle');
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
            accessibilityLabel={t('sheet.closeAccessibilityLabel')}
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
              <Text style={styles.sheetSubtitle}>{t('sheet.currentPricesSubtitle')}</Text>
            </View>
            <Pressable
              accessibilityLabel={t('sheet.closeButtonAccessibilityLabel')}
              onPress={closeWithBackdropFade}
              style={styles.sheetClose}
            >
              <Ionicons name="close" size={22} color={Theme.colors.textPrimary} />
            </Pressable>
          </View>
          <View style={styles.sheetProducts}>
            {products.map((product) => (
              <View key={product.id} style={styles.sheetProduct}>
                <View style={styles.sheetProductCopy}>
                  <Text style={styles.sheetProductTitle}>{productLabel(product, t, locale)}</Text>
                  <Text style={styles.sheetProductPrice}>{product.priceString}</Text>
                  {pendingProductKey === product.productKey && (
                    <Text style={styles.preservedLabel}>{t('sheet.selectedBeforeSignIn')}</Text>
                  )}
                </View>
                <Button
                  title={t('sheet.buy')}
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

// Quantities are in-app numbers, not store prices, so they format for the
// active locale (#164, #157) - the same locale the pack labels beside this
// summary now use, so the two never disagree.
function packSummary(packs: readonly CommerceProduct[], noun: string, locale: string): string {
  return `${packs.map((pack) => formatNumber(pack.quantity, locale)).join(' · ')} ${noun}`;
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
  t: TFunction,
): string | null {
  if (product.freeIntroductoryOffer === null) return null;
  if (!eligibleProductKeys.includes(product.productKey)) return null;
  return t('plans.freeTrial', {
    offer: product.freeIntroductoryOffer,
    paidOffer: paidOfferLabel(product, t),
  });
}

// One rendering of a plan's recurring charge — "$7.99 every 1 month" — shared by
// the disclosure, the confirmation and the trial line, so the same plan can
// never be quoted three different ways. `priceString` is the store price and
// is interpolated verbatim, never reformatted (#164's hard line).
function paidOfferLabel(product: CommerceProduct, t: TFunction): string {
  return product.billingPeriod === null
    ? product.priceString
    : t('products.billedEveryOffer', { price: product.priceString, period: product.billingPeriod });
}

// A Membership Credit Grant is attached to each verified *paid* Membership
// Period, so the allowance stays qualified as paid while naming this plan's own
// period instead of a generic one.
function creditAllowanceLabel(
  credits: number,
  creditPeriod: string | null,
  t: TFunction,
  locale: string,
): string {
  const formattedCredits = formatNumber(credits, locale);
  return creditPeriod === null
    ? t('products.creditAllowancePaidPeriod', { credits: formattedCredits })
    : t('products.creditAllowancePaidNoun', { credits: formattedCredits, period: creditPeriod });
}

function isPurchaseCancelled(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'userCancelled' in error
    && error.userCancelled === true;
}

function purchaseErrorMessage(error: unknown, t: TFunction): string {
  const code = purchaseErrorCode(error);

  switch (code) {
    case '2':
      return t('errors.storeTemporarilyUnavailable');
    case '3':
      return t('errors.purchasesNotAllowed');
    case '4':
    case '5':
      return t('errors.itemNotAvailable');
    case '6':
      return t('errors.alreadyOwned');
    case '10':
    case '35':
      return t('errors.couldNotConnectToStore');
    case '20':
      return t('errors.paymentPendingApproval');
    case '42':
      return t('errors.testPurchaseDeclined');
    default:
      return error instanceof Error && error.message
        ? error.message
        : t('errors.genericPurchaseFailure');
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

function membershipPeriodLabel(lifecycle: MembershipView['lifecycle'], t: TFunction): string {
  return lifecycle === 'cancelled' || lifecycle === 'paused'
    || lifecycle === 'expired' || lifecycle === 'refunded'
    ? t('premiumHero.periodEndsLabel')
    : t('premiumHero.periodRenewsLabel');
}

// The lifecycle value itself (`trial`, `billing_retry`, ...) is a backend
// enum, not app-authored prose, so it keeps its English wording here exactly
// as before; only the `null` default routes through a translation key.
function membershipLifecycleLabel(lifecycle: MembershipView['lifecycle'], t: TFunction): string {
  return lifecycle === null
    ? t('premiumHero.lifecycleActive')
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
  // A fixed width clipped or wrapped the longer Turkish label ("Satın Al" vs.
  // "Buy"); minWidth keeps the English sizing while letting a longer
  // translation grow the button instead of truncating inside it (#164).
  sheetBuyButton: { minWidth: 84 },
  pressed: { opacity: 0.78 },
});
