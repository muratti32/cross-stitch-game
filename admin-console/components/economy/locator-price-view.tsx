'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocatorPrice, useUpdateLocatorPrice } from '@/hooks/use-locator-price';
import { ApiError } from '@/lib/client/fetcher';
import { formatDateTime } from '@/lib/format';
import type { LocatorPriceSetting } from '@/lib/types';

export function LocatorPriceView() {
  const query = useLocatorPrice();

  return (
    <div>
      <PageHeader
        title="Economy"
        description="Operator-managed Stitch Coin values. Every change takes effect immediately and is recorded in the audit log."
      />
      <Card className="max-w-xl p-4">
        {query.isPending && (
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        {query.isError && (
          <ErrorState
            message={query.error instanceof ApiError ? query.error.message : 'Failed to load the Locator Price.'}
            onRetry={() => void query.refetch()}
          />
        )}
        {query.data !== undefined && <LocatorPriceForm key={query.data.updatedAt} setting={query.data} />}
      </Card>
    </div>
  );
}

function LocatorPriceForm({ setting }: { setting: LocatorPriceSetting }) {
  const mutation = useUpdateLocatorPrice();
  const [draft, setDraft] = useState(String(setting.price));

  const parsed = Number(draft);
  const validationError =
    draft.trim() === '' || !Number.isInteger(parsed) || parsed < setting.minPrice || parsed > setting.maxPrice
      ? `Enter a whole number from ${setting.minPrice} to ${setting.maxPrice}.`
      : null;
  const unchanged = validationError === null && parsed === setting.price;

  async function handleConfirm(): Promise<void> {
    // A failure stays open in the confirm dialog, which shows the server message.
    const updated = await mutation.mutateAsync(parsed);
    toast.success(`Locator Price set to ${updated.price} Stitch Coin.`);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-medium">Remaining Cell Locator price</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Charged once per successful locator use for every Guest Player and Registered Account, with no Premium
          discount. Reservations already open keep the price they were made at; players still seeing the old price
          are asked to tap again, never charged.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-muted-foreground">Current price</dt>
        <dd className="font-medium">{setting.price} Stitch Coin</dd>
        <dt className="text-muted-foreground">Last changed</dt>
        <dd>{formatDateTime(setting.updatedAt)}</dd>
      </dl>

      <div className="space-y-1.5">
        <Label htmlFor="locator-price">New price</Label>
        <div className="flex items-start gap-2">
          <Input
            id="locator-price"
            className="w-32"
            type="number"
            inputMode="numeric"
            min={setting.minPrice}
            max={setting.maxPrice}
            step={1}
            value={draft}
            aria-invalid={validationError !== null}
            onChange={(event) => setDraft(event.target.value)}
          />
          <ConfirmActionDialog
            trigger={
              <Button disabled={validationError !== null || unchanged || mutation.isPending}>
                {mutation.isPending ? 'Saving…' : 'Save price'}
              </Button>
            }
            title={`Change the Locator Price to ${draft} Stitch Coin?`}
            description={`Players are charged ${draft} Stitch Coin per successful locator use starting with their next reservation (currently ${setting.price}).`}
            confirmLabel="Change price"
            onConfirm={handleConfirm}
          />
        </div>
        {validationError !== null && <p className="text-sm text-destructive">{validationError}</p>}
      </div>
    </div>
  );
}
