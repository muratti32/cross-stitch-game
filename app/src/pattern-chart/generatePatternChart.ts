import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { catalogShareLink } from '../navigation/catalogShareLink';
import { uint8ArrayToBase64 } from '../local-db/helpers';
import type { PatternData } from '../pattern-artifact';
import { ChartSharingUnavailableError } from './chartErrors';
import { buildChartDrawPlan } from './chartDrawPlan';
import { chartSourceDeps, findLocalArtifactChecksum } from './chartPatternDeps';
import { renderChartPng } from './chartRenderer';
import { loadChartPattern } from './loadChartPattern';
import { buildQrMatrix } from './qrMatrix';

export interface GeneratePatternChartInput {
  patternId: string;
  /** Pattern data already in memory (e.g. an open stitching session); skips any read or fetch. */
  pattern?: PatternData;
  /** Checksum of a Pattern Artifact this device holds, if the caller knows it. */
  localChecksum?: string | null;
  /** False draws only from data on the device (Catalog Withdrawal, or not entitled). */
  allowRemoteFetch?: boolean;
  dialogTitle: string;
}

/**
 * Pattern Chart Image: loads pattern data, draws the PNG with Skia, and hands
 * it to the share sheet. Throws typed errors (PatternChartError from the grant,
 * PatternCodecError, ChartRenderError, ChartSharingUnavailableError); the file
 * lives only in the cache directory.
 */
export async function generatePatternChart(input: GeneratePatternChartInput): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new ChartSharingUnavailableError();
  const pattern = input.pattern ?? await loadChartPattern(chartSourceDeps, {
    patternId: input.patternId,
    localChecksum: input.localChecksum ?? await findLocalArtifactChecksum(input.patternId),
    allowRemoteFetch: input.allowRemoteFetch,
  });
  const plan = buildChartDrawPlan(pattern, buildQrMatrix(catalogShareLink(input.patternId)));
  const png = renderChartPng(plan);
  const uri = `${FileSystem.cacheDirectory}pattern-chart-${input.patternId}.png`;
  await FileSystem.writeAsStringAsync(uri, uint8ArrayToBase64(png), { encoding: FileSystem.EncodingType.Base64 });
  await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: input.dialogTitle });
}
