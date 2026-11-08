import { buildQrMatrix } from '../qrMatrix';

describe('buildQrMatrix', () => {
  const matrix = buildQrMatrix('https://stitchwish.example/pattern/abc');

  it('is square with a valid QR size (21 + 4n)', () => {
    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect((matrix.length - 21) % 4).toBe(0);
    matrix.forEach((row) => expect(row).toHaveLength(matrix.length));
  });

  it('has the 7x7 finder pattern in the top-left corner', () => {
    for (let i = 0; i < 7; i += 1) {
      expect(matrix[0][i]).toBe(true);
      expect(matrix[6][i]).toBe(true);
      expect(matrix[i][0]).toBe(true);
      expect(matrix[i][6]).toBe(true);
    }
    expect(matrix[1][1]).toBe(false);
    expect(matrix[3][3]).toBe(true);
  });

  it('is deterministic for the same input and differs for another', () => {
    expect(buildQrMatrix('a')).toEqual(buildQrMatrix('a'));
    expect(buildQrMatrix('a')).not.toEqual(buildQrMatrix('b'));
  });
});
