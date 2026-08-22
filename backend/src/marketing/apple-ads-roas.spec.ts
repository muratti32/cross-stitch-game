import { calculateAppleAdsRoas } from './apple-ads-roas';

describe('calculateAppleAdsRoas', () => {
  it('calculates net RevenueCat proceeds divided by Apple Ads spend', () => {
    const [row] = calculateAppleAdsRoas({
      cohortWindowDays: 30,
      spendRows: [{
        date: '2026-08-01',
        campaignId: 'campaign-1',
        spendUsd: 1_000,
      }],
      revenueRows: [{
        cohortDate: '2026-08-01',
        revenueDate: '2026-08-29',
        campaignId: 'campaign-1',
        netRevenueUsd: 2_500,
      }],
    });

    expect(row).toMatchObject({
      spendUsd: 1_000,
      netRevenueUsd: 2_500,
      roas: 2.5,
      roasPercent: 250,
    });
  });

  it('includes day zero, excludes revenue on the cohort window boundary, and keeps IDs separate', () => {
    const rows = calculateAppleAdsRoas({
      cohortWindowDays: 7,
      spendRows: [
        { date: '2026-08-01', campaignId: 'campaign-1', adGroupId: 'group-a', spendUsd: 100 },
        { date: '2026-08-01', campaignId: 'campaign-1', adGroupId: 'group-b', spendUsd: 200 },
      ],
      revenueRows: [
        { cohortDate: '2026-08-01', revenueDate: '2026-08-01', campaignId: 'campaign-1', adGroupId: 'group-a', netRevenueUsd: 50 },
        { cohortDate: '2026-08-01', revenueDate: '2026-08-08', campaignId: 'campaign-1', adGroupId: 'group-a', netRevenueUsd: 500 },
        { cohortDate: '2026-08-01', revenueDate: '2026-08-07', campaignId: 'campaign-1', adGroupId: 'group-b', netRevenueUsd: 100 },
      ],
    });

    expect(rows).toEqual([
      expect.objectContaining({ adGroupId: 'group-a', netRevenueUsd: 50, roas: 0.5 }),
      expect.objectContaining({ adGroupId: 'group-b', netRevenueUsd: 100, roas: 0.5 }),
    ]);
  });

  it('returns undefined ROAS when an attributed cohort has no spend', () => {
    const [row] = calculateAppleAdsRoas({
      cohortWindowDays: 90,
      spendRows: [],
      revenueRows: [{
        cohortDate: '2026-08-01',
        revenueDate: '2026-08-02',
        campaignId: 'campaign-without-spend',
        netRevenueUsd: 10,
      }],
    });

    expect(row).toMatchObject({ spendUsd: 0, netRevenueUsd: 10, roas: null, roasPercent: null });
  });

  it('rejects dates that match the shape but are not calendar dates', () => {
    expect(() => calculateAppleAdsRoas({
      cohortWindowDays: 30,
      spendRows: [{ date: '2026-02-30', campaignId: 'campaign-1', spendUsd: 10 }],
      revenueRows: [],
    })).toThrow('Apple Ads spend date must be an ISO date (YYYY-MM-DD).');
  });
});
