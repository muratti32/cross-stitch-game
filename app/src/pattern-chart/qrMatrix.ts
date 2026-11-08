import qrcode from 'qrcode-generator';

/** QR module matrix (true = dark) for a URL; pure JS so it needs no native code. */
export function buildQrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  const rows: boolean[][] = [];
  for (let r = 0; r < size; r += 1) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c += 1) {
      row.push(qr.isDark(r, c));
    }
    rows.push(row);
  }
  return rows;
}
