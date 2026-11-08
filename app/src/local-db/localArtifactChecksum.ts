import { getSessions } from './index';

/** Checksum of the newest Pattern Artifact this device holds for a pattern, from its Stitching Sessions. */
export async function findLocalArtifactChecksum(patternId: string): Promise<string | null> {
  const sessions = await getSessions();
  const match = sessions
    .filter((session) => session.patternId === patternId && session.status !== 'preparing')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return match?.artifactChecksum ?? null;
}
