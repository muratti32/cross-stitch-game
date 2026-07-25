'use client';

import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useReconciliation } from '@/hooks/use-reconciliation';
import { ApiError } from '@/lib/client/fetcher';
import { formatDateTime } from '@/lib/format';
import type { ReconciliationFinding, ReconciliationFindingClass } from '@/lib/types';

interface SectionDefinition {
  classes: readonly ReconciliationFindingClass[];
  count: number;
  description: string;
  title: string;
}

export function ReconciliationView() {
  const query = useReconciliation();
  return (
    <div>
      <PageHeader
        title="Reconciliation"
        description="Stored, read-only comparisons between game records and provider or object-storage evidence."
      />
      {query.isPending && <div className="space-y-4">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-48 w-full" />)}</div>}
      {query.isError && <Card className="p-4"><ErrorState message={query.error instanceof ApiError ? query.error.message : 'Failed to load reconciliation findings.'} onRetry={() => void query.refetch()} /></Card>}
      {query.data?.run === null && <Card className="p-4"><EmptyState title="No reconciliation run yet" message="The worker will record the first comparison on its scheduled pass." /></Card>}
      {query.data?.run !== null && query.data !== undefined && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Last run: {formatDateTime(query.data.run.ranAt)}</p>
          <ReconciliationSection
            definition={{
              classes: ['commerce_delivery_without_ledger', 'commerce_ledger_without_delivery'],
              count: query.data.run.commerceDeliveryWithoutLedgerCount + query.data.run.commerceLedgerWithoutDeliveryCount,
              description: `Compared only from ${formatDateTime(query.data.run.commerceWindowStart)} onward, the retained scrubbed webhook archive window.`,
              title: 'Commerce ledger vs provider deliveries',
            }}
            findings={query.data.findings}
            lastRun={query.data.run.ranAt}
          />
          <ReconciliationSection
            definition={{
              classes: ['storage_registry_missing_object', 'storage_orphan_object'],
              count: query.data.run.storageRegistryMissingObjectCount + query.data.run.storageOrphanObjectCount,
              description: 'Registry rows are compared with object storage; this report makes no cleanup changes.',
              title: 'Object registry vs storage',
            }}
            findings={query.data.findings}
            lastRun={query.data.run.ranAt}
          />
          <ReconciliationSection
            definition={{
              classes: ['ai_credit_reservation_stuck'],
              count: query.data.run.aiCreditReservationStuckCount,
              description: 'Reserved AI Credit past its configured lifetime, with its Processing Job status when available.',
              title: 'Stuck AI Credit Reservations',
            }}
            findings={query.data.findings}
            lastRun={query.data.run.ranAt}
          />
        </div>
      )}
    </div>
  );
}

function ReconciliationSection({
  definition,
  findings,
  lastRun,
}: {
  definition: SectionDefinition;
  findings: readonly ReconciliationFinding[];
  lastRun: string;
}) {
  const sectionFindings = findings.filter((finding) => definition.classes.includes(finding.findingClass));
  return (
    <Card className="p-0">
      <div className="space-y-1 border-b p-4">
        <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{definition.title}</h2><Badge variant={definition.count > 0 ? 'destructive' : 'secondary'}>{definition.count}</Badge></div>
        <p className="text-sm text-muted-foreground">{definition.description}</p>
        <p className="text-xs text-muted-foreground">Last run: {formatDateTime(lastRun)}</p>
      </div>
      {sectionFindings.length === 0 ? <div className="p-4"><EmptyState title="No discrepancies" message="No stored findings were recorded for this class in the latest run." /></div> : <FindingTable findings={sectionFindings} />}
    </Card>
  );
}

function FindingTable({ findings }: { findings: readonly ReconciliationFinding[] }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Finding</TableHead><TableHead>Identifier</TableHead><TableHead>Related identifier</TableHead><TableHead>Detail</TableHead></TableRow></TableHeader>
      <TableBody>{findings.map((finding) => <TableRow key={`${finding.findingClass}:${finding.identifier}`}><TableCell>{findingLabel(finding.findingClass)}</TableCell><TableCell className="font-mono text-xs">{finding.identifier}</TableCell><TableCell className="font-mono text-xs">{finding.relatedIdentifier ?? '—'}</TableCell><TableCell>{finding.detail ?? '—'}</TableCell></TableRow>)}</TableBody>
    </Table>
  );
}

function findingLabel(findingClass: ReconciliationFindingClass): string {
  const labels: Record<ReconciliationFindingClass, string> = {
    ai_credit_reservation_stuck: 'Reserved credit past lifetime',
    commerce_delivery_without_ledger: 'Provider delivery without ledger',
    commerce_ledger_without_delivery: 'Ledger without provider delivery',
    storage_orphan_object: 'Storage object without registry',
    storage_registry_missing_object: 'Registry object missing in storage',
  };
  return labels[findingClass];
}
