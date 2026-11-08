import type { PatternData } from '../pattern-artifact';

/**
 * Where a Pattern Chart gets its pattern data (ADR-0068, ADR-0031). On-device
 * Offline Pattern Data wins, so a Catalog-Withdrawn Pattern still draws from
 * data already on the device. Otherwise the bytes come through the entitlement
 * artifact grant and are decoded in memory: never stored as Offline Pattern
 * Data and never tied to a Stitching Session.
 */
export interface ChartSourceDeps {
  /** Verified-by-caller bytes of the on-device copy for a known checksum, or null if absent. */
  readOffline(patternId: string, checksum: string): Promise<Uint8Array | null>;
  requestGrant(patternId: string): Promise<{ url: string; checksum: string }>;
  download(url: string): Promise<Uint8Array>;
  decode(bytes: Uint8Array, checksum: string): PatternData;
}

export interface ChartSourceRequest {
  patternId: string;
  /** Checksum of a Pattern Artifact this device already holds for the pattern, if any. */
  localChecksum?: string | null;
  /** False under Catalog Withdrawal or when not entitled: draw from local data or fail, never fetch. */
  allowRemoteFetch?: boolean;
}

export class ChartDataUnavailableError extends Error {
  constructor() {
    super('chart_data_unavailable');
    this.name = 'ChartDataUnavailableError';
  }
}

export async function loadChartPattern(deps: ChartSourceDeps, request: ChartSourceRequest): Promise<PatternData> {
  if (request.localChecksum) {
    try {
      const local = await deps.readOffline(request.patternId, request.localChecksum);
      if (local) return deps.decode(local, request.localChecksum);
    } catch {
      // A missing or corrupt local copy falls through to the entitlement fetch.
    }
  }
  if (request.allowRemoteFetch === false) throw new ChartDataUnavailableError();
  const grant = await deps.requestGrant(request.patternId);
  const bytes = await deps.download(grant.url);
  return deps.decode(bytes, grant.checksum);
}
