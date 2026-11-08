import type { PatternData } from '../../pattern-artifact';
import { ChartDataUnavailableError, loadChartPattern, type ChartSourceDeps } from '../loadChartPattern';

const data: PatternData = { schemaVersion: 1, width: 1, height: 1, palette: [], grid: new Uint8Array([0]) };

function deps(overrides: Partial<ChartSourceDeps> = {}): jest.Mocked<ChartSourceDeps> {
  return {
    readOffline: jest.fn().mockResolvedValue(null),
    requestGrant: jest.fn().mockResolvedValue({ url: '/v1/artifacts/p', checksum: 'remote' }),
    download: jest.fn().mockResolvedValue(new Uint8Array([9])),
    decode: jest.fn().mockReturnValue(data),
    ...overrides,
  } as jest.Mocked<ChartSourceDeps>;
}

describe('loadChartPattern', () => {
  it('prefers on-device data and never touches the network', async () => {
    const d = deps({ readOffline: jest.fn().mockResolvedValue(new Uint8Array([1])) });
    await expect(loadChartPattern(d, { patternId: 'p', localChecksum: 'local' })).resolves.toBe(data);
    expect(d.decode).toHaveBeenCalledWith(new Uint8Array([1]), 'local');
    expect(d.requestGrant).not.toHaveBeenCalled();
  });

  it('fetches via the entitlement grant when no local checksum is known', async () => {
    const d = deps();
    await loadChartPattern(d, { patternId: 'p' });
    expect(d.readOffline).not.toHaveBeenCalled();
    expect(d.download).toHaveBeenCalledWith('/v1/artifacts/p');
    expect(d.decode).toHaveBeenCalledWith(new Uint8Array([9]), 'remote');
  });

  it('fetches when the local file is missing', async () => {
    const d = deps();
    await loadChartPattern(d, { patternId: 'p', localChecksum: 'local' });
    expect(d.requestGrant).toHaveBeenCalledWith('p');
  });

  it('falls back to the fetch when the local copy fails to decode', async () => {
    const decode = jest.fn().mockImplementationOnce(() => { throw new Error('checksum-mismatch'); }).mockReturnValue(data);
    const d = deps({ readOffline: jest.fn().mockResolvedValue(new Uint8Array([1])), decode });
    await expect(loadChartPattern(d, { patternId: 'p', localChecksum: 'local' })).resolves.toBe(data);
    expect(d.requestGrant).toHaveBeenCalled();
  });

  it('propagates a refused grant with nothing drawn', async () => {
    const err = new Error('pattern_unavailable');
    const d = deps({ requestGrant: jest.fn().mockRejectedValue(err) });
    await expect(loadChartPattern(d, { patternId: 'p' })).rejects.toBe(err);
    expect(d.download).not.toHaveBeenCalled();
  });

  it('propagates a corrupt remote artifact', async () => {
    const d = deps({ decode: jest.fn(() => { throw new Error('malformed'); }) });
    await expect(loadChartPattern(d, { patternId: 'p' })).rejects.toThrow('malformed');
  });

  it('never fetches when remote fetch is disallowed and local data is missing or corrupt', async () => {
    const d = deps();
    await expect(loadChartPattern(d, { patternId: 'p', localChecksum: 'local', allowRemoteFetch: false })).rejects.toBeInstanceOf(ChartDataUnavailableError);
    expect(d.requestGrant).not.toHaveBeenCalled();
    const bad = deps({ readOffline: jest.fn().mockResolvedValue(new Uint8Array([1])), decode: jest.fn(() => { throw new Error('x'); }) });
    await expect(loadChartPattern(bad, { patternId: 'p', localChecksum: 'local', allowRemoteFetch: false })).rejects.toBeInstanceOf(ChartDataUnavailableError);
    expect(bad.requestGrant).not.toHaveBeenCalled();
  });

  it('still draws from local data when remote fetch is disallowed', async () => {
    const d = deps({ readOffline: jest.fn().mockResolvedValue(new Uint8Array([1])) });
    await expect(loadChartPattern(d, { patternId: 'p', localChecksum: 'local', allowRemoteFetch: false })).resolves.toBe(data);
  });
});
