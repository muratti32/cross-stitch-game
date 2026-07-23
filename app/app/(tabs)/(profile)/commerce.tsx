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

const COIN_PACK_DESCRIPTIONS: Record<string, { coins: number }> = {
  'coin_pack_300': { coins: 300 },
  'coin_pack_900': { coins: 900 },
  'coin_pack_2000': { coins: 2000 },
};

const AI_CREDIT_PACK_DESCRIPTIONS: Record<string, { credits: number }> = {
  'ai_credit_pack_5': { credits: 5 },
  'ai_credit_pack_20': { credits: 20 },
  'ai_credit_pack_50': { credits: 50 },
};

interface PackItem {
  id: string;
  package: PurchasesPackage;
  amount: number;
  label: string;
}

export default function CommerceScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isAccount } = useIdentityStore();
  const { data: coinBalance } = useCoinBalance();
  const { data: aiCreditBalance } = useAiCreditBalance();

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

      for (const pkg of packages) {
        const desc = COIN_PACK_DESCRIPTIONS[pkg.identifier];
        if (desc) {
          coinPacks.push({
            id: pkg.identifier,
            package: pkg,
            amount: desc.coins,
            label: `${desc.coins} Coins`,
          });
        }
      }

      for (const pkg of packages) {
        const desc = AI_CREDIT_PACK_DESCRIPTIONS[pkg.identifier];
        if (desc) {
          aiPacks.push({
            id: pkg.identifier,
            package: pkg,
            amount: desc.credits,
            label: `${desc.credits} AI Credits`,
          });
        }
      }

      setOfferings([...coinPacks, ...aiPacks]);
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
    try {
      await Purchases.purchasePackage(pkg);
      setShowSuccessMessage(true);
      await new Promise(r => setTimeout(r, 500));
      await refetchBalances();
      await new Promise(r => setTimeout(r, 2000));
      await refetchBalances();
      await new Promise(r => setTimeout(r, 2500));
      await refetchBalances();
    } catch (err: unknown) {
      const error = err as any;
      if (error?.userCancelled) {
        return;
      }
      if (error?.message) {
        setPurchaseError(error.message);
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

  const coinPacks = offerings.filter(p => Object.keys(COIN_PACK_DESCRIPTIONS).includes(p.id));
  const aiPacks = offerings.filter(p => Object.keys(AI_CREDIT_PACK_DESCRIPTIONS).includes(p.id));

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
