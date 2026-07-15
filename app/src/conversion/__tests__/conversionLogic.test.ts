import { computeCropRectangle, downscaledDimensions } from '../framing';
import { resolveSettings } from '../profiles';

describe('photo Pattern Conversion client logic', () => {
  it('keeps Easy available throughout the legal framing bound', () => {
    expect(
      resolveSettings({
        customMaxColors: 20,
        customShortEdgeCells: 80,
        profile: 'easy',
        sourceHeight: 100,
        sourceWidth: 600,
      }),
    ).toMatchObject({ height: 50, width: 300 });
  });

  it('marks profiles with an over-300 derived long edge unavailable', () => {
    expect(
      resolveSettings({
        customMaxColors: 20,
        customShortEdgeCells: 80,
        profile: 'detailed',
        sourceHeight: 100,
        sourceWidth: 300,
      }),
    ).toBeNull();
  });

  it('maps framing pan and zoom into a bounded source crop', () => {
    const crop = computeCropRectangle({
      frameHeight: 200,
      frameWidth: 300,
      offsetX: 75,
      offsetY: -20,
      sourceHeight: 2000,
      sourceWidth: 3000,
      zoom: 2,
    });
    expect(crop).toEqual({
      height: 1000,
      originX: 375,
      originY: 600,
      width: 1500,
    });
  });

  it('caps only the Conversion Upload derivative, not the Local Photo Source', () => {
    expect(downscaledDimensions(6000, 3000)).toEqual({
      height: 1024,
      width: 2048,
    });
  });
});
