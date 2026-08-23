import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  commerceProductIdentity,
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
  getRevenueCatSubscriberId,
  isRevenueCatTrialEligible,
  missingCanonicalRevenueCatProducts,
  purchaseRevenueCatPackage,
  restoreRevenueCatPurchases,
  showRevenueCatManageSubscriptions,
  useRevenueCatRuntime,
} from '@/commerce/revenueCat';
import { Button, Card, GuestDataRiskNotice, Screen } from '@/components';
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
  const [confirmingCoinPack, setConfirmingCoinPack] = useState<CommerceProduct | null>(null);
  const [confirmingAiCreditPack, setConfirmingAiCreditPack] = useState<CommerceProduct | null>(null);
  const [trialEligibleKeys, setTrialEligibleKeys] = useState<readonly PurchaseProductKey[]>([]);
  const [purchasePending, setPurchasePending] = useState<PremiumReconciliation | null>(null);
  const [coinPurchasePending, setCoinPurchasePending] = useState<CoinPackReconciliation | null>(null);
  const [aiCreditPurchasePending, setAiCreditPurchasePending] = useState<AiCreditPackReconciliation | null>(null);
  const [guestCommerceProduct, setGuestCommerceProduct] = useState<CommerceProduct | null>(null);
  const [restoringPurchases, setRestoringPurchases] = useState(false);

  // The pack sheet is a native RN <Modal>, and the Premium/Coin/AI Credit
  // confirmations and the GuestDataRiskNotice are Modals too. iOS never
  // presents a routed screen over an already-presented Modal, so anything
  // that navigates away from this screen (sign-in included) must close every
  // commerce overlay first or the destination renders unreachable behind it.
  const closeCommerceOverlays = useCallback(() => {
    setOpenCategory(null);
    setGuestCommerceProduct(null);
    setConfirmingPremium(null);
    setConfirmingCoinPack(null);
    setConfirmingAiCreditPack(null);
  }, []);

  const viewedSourceRef = useRef<string | null>(null);
  const pendingPremiumPurchaseRef = useRef<CommerceProduct | null>(null);
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

  const reconcilePremium = useCallback(async (attempt: PremiumReconciliation) => {
    if (reconciliationRef.current?.id !== attempt.id) return;
    let verifiedMembership: MembershipView | null = null;
    try {
      if (attempt.guestAttemptId !== null) {
        const guestAttempt = await fetchGuestPurchaseAttempt(attempt.guestAttemptId);
        if (guestAttempt.status === 'created' || guestAttempt.status === 'verifying') {
          if (Date.now() - attempt.startedAt >= RECONCILIATION_DELAY_MS) updateReconciliation({ ...attempt, prolonged: true });
          else scheduleReconciliation(attempt);
          return;
        }
        if (guestAttempt.status !== 'granted') {
          updateReconciliation({ ...attempt, failureStage: 'verification' });
          setPurchaseError('The Game Backend could not verify this purchase. Retry reconciliation; do not buy it again.');
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
    guestAttempt: GuestPurchaseAttemptReference | null = null,
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
      setPurchaseError(
        'Purchase reconciliation could not reach the Game Backend. Retry reconciliation; do not buy it again.',
      );
    }
  }, [reconcilePremium, updateReconciliation]);

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
        setPurchaseError(
          'The store transaction did not match this Coin Pack. Retry verification or contact support; do not buy it again.',
        );
        return;
      }
      if (reconciliation.status === 'grant_failed') {
        await captureGameplayEvent('purchase_failed', {
          product_kind: 'stitch_coin_pack',
          product_key: attempt.product.productKey,
          failure_stage: 'grant',
        });
        updateCoinReconciliation({ ...attempt, failureStage: 'grant' });
        setPurchaseError(
          'The purchase was verified, but the Stitch Coin grant is unavailable. Retry reconciliation; do not buy it again.',
        );
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
    } catch {
      const failureStage = grantVerified ? 'grant' : 'verification';
      await captureGameplayEvent('purchase_failed', {
        product_kind: 'stitch_coin_pack',
        product_key: attempt.product.productKey,
        failure_stage: failureStage,
      });
      updateCoinReconciliation({ ...attempt, failureStage });
      setPurchaseError(grantVerified
        ? 'The Coin grant was verified, but the current Stitch Coin balance could not be refreshed. Retry reconciliation.'
        : 'The Game Backend could not verify this Coin Pack yet. Retry reconciliation; do not buy it again.');
    }
  }, [clearIntent, guestId, isAccount, queryClient, scheduleCoinReconciliation, updateCoinReconciliation]);

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
      setPurchaseError(
        'Coin Pack reconciliation could not reach the Game Backend. Retry reconciliation; do not buy it again.',
      );
    }
  }, [reconcileCoinPack, updateCoinReconciliation]);

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
        setPurchaseError(
          'The store transaction did not match this AI Credit Pack. Retry verification or contact support; do not buy it again.',
        );
        return;
      }
      if (reconciliation.status === 'grant_failed') {
        await captureGameplayEvent('purchase_failed', {
          product_kind: 'ai_credit_pack',
          product_key: attempt.product.productKey,
          failure_stage: 'grant',
        });
        updateAiCreditReconciliation({ ...attempt, failureStage: 'grant' });
        setPurchaseError(
          'The purchase was verified, but the AI Credit grant is unavailable. Retry reconciliation; do not buy it again.',
        );
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
    } catch {
      const failureStage = grantVerified ? 'grant' : 'verification';
      await captureGameplayEvent('purchase_failed', {
        product_kind: 'ai_credit_pack',
        product_key: attempt.product.productKey,
        failure_stage: failureStage,
      });
      updateAiCreditReconciliation({ ...attempt, failureStage });
      setPurchaseError(grantVerified
        ? 'The AI Credit grant was verified, but the current balance could not be refreshed. Retry reconciliation.'
        : 'The Game Backend could not verify this AI Credit Pack yet. Retry reconciliation; do not buy it again.');
    }
  }, [clearIntent, guestId, isAccount, queryClient, scheduleAiCreditReconciliation, updateAiCreditReconciliation]);

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
      supportReference: null,
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
      setPurchaseError(
        'AI Credit Pack reconciliation could not reach the Game Backend. Retry reconciliation; do not buy it again.',
      );
    }
  }, [reconcileAiCreditPack, updateAiCreditReconciliation]);

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

  const purchase = useCallback(async (product: CommerceProduct) => {
    setPurchaseError(null);
    setPurchaseSuccess(null);
    setPurchasingKey(product.productKey);
    setConfirmingPremium(null);
    setConfirmingCoinPack(null);
    setConfirmingAiCreditPack(null);
    await captureGameplayEvent('purchase_started', {
      product_kind: product.productKind,
      product_key: product.productKey,
    });
    let failureStage: 'store' | 'verification' = product.category === 'premium'
      ? 'verification'
      : 'store';
    try {
      let guestAttempt: GuestPurchaseAttemptReference | null = null;
      if (!isAccount) {
        if (Platform.OS !== 'ios') throw new Error('Guest Stitch Coin purchases are available on iOS only.');
        const subscriberId = await getRevenueCatSubscriberId();
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
      if (product.category === 'premium') {
        await beginPremiumReconciliation(product, 'purchase', baselineMembership, guestAttempt);
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
    void purchase(product).finally(() => {
      premiumPurchaseInFlightRef.current = false;
    });
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
    const subscriberId = await getRevenueCatSubscriberId();
    await mapGuestRevenueCatSubscriber(subscriberId);
    await restoreRevenueCatPurchases(null);
    await queryClient.refetchQueries({ queryKey: ['commerce', 'membership'] });
    await queryClient.refetchQueries({ queryKey: ['economy'] });
    Alert.alert(
      'Restore requested',
      'Verified Premium access will appear after the store webhook is reconciled. '
        + 'Stitch Coin and AI Credit packs are never restored.',
    );
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

        {isAccount && membership?.active && (
          <Card style={styles.membershipActionsCard}>
            <Text style={styles.membershipActionsTitle}>Active Premium Membership</Text>
            <Text style={styles.membershipActionsBody}>
              Daily rewards are in Profile. Themes are under Settings › Appearance.
            </Text>
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
                <Text selectable style={styles.supportReference}>
                  Support Reference: {coinPurchasePending.supportReference}
                </Text>
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
                <Text selectable style={styles.supportReference}>
                  Support Reference: {aiCreditPurchasePending.supportReference}
                </Text>
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
            {premiumPlans.length > 0 && (
              <View style={styles.planSection}>
                <Text style={styles.sectionTitle}>Choose a Premium plan</Text>
                <View style={styles.planRow}>
                  {premiumPlans.map((plan) => {
                    const selected = plan.productKey === selectedPremium?.productKey;
                    const trialOffer = premiumTrialOffer(plan, trialEligibleKeys);
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
                {selectedPremium !== undefined && (
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
      <PremiumConfirmation
        onDismiss={handlePremiumConfirmationDismiss}
        product={confirmingPremium}
        trialOffer={confirmingPremium === null
          ? null
          : premiumTrialOffer(confirmingPremium, trialEligibleKeys)}
        onCancel={() => setConfirmingPremium(null)}
        onConfirm={confirmPremiumPurchase}
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
  onPurchase,
}: {
  category: CommerceCategory | null;
  products: readonly CommerceProduct[];
  pendingProductKey: string | null;
  purchasingKey: string | null;
  reconcilingProductKey: string | null;
  confirmation: React.ReactNode;
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
                  disabled={purchasingKey !== null || reconcilingProductKey === product.productKey}
                  variant={category === 'stitch_coin' ? 'honey' : 'rose'}
                  style={styles.sheetBuyButton}
                />
              </View>
            ))}
          </View>
        </View>
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
