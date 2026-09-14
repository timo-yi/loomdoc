import sharp from "sharp";

/**
 * Frame signatures for change detection (PRD decision D6, §4).
 *
 * A signature is a downscaled grayscale thumbnail (SIGNATURE_SIZE²  cells). Comparing two
 * signatures by the fraction of cells that changed beyond a per-cell noise floor gives a
 * metric that is:
 *   - blind to the cursor (a ~15px pointer is sub-cell after downscale, so it moves no
 *     cell past the noise floor), and
 *   - sensitive to localized UI changes (a dropdown, a selection, typed text change enough
 *     cells to register) — which a coarse whole-frame hash misses.
 *
 * This replaces an earlier 9x8 dHash, which review showed collapsed exactly those localized
 * steps a how-to doc must capture.
 */

/** Signature grid is SIGNATURE_SIZE x SIGNATURE_SIZE grayscale cells. */
export const SIGNATURE_SIZE = 64;

export type Signature = Uint8Array;

/** Compute the grayscale signature of an image file. */
export async function computeSignature(imagePath: string): Promise<Signature> {
  const data = await sharp(imagePath)
    .greyscale()
    .resize(SIGNATURE_SIZE, SIGNATURE_SIZE, { fit: "fill" })
    .raw()
    .toBuffer();
  return new Uint8Array(data);
}

/**
 * Fraction (0..1) of cells whose intensity changed by more than `pixelDelta`.
 * `pixelDelta` is the per-cell noise floor that ignores compression artifacts.
 */
export function changedFraction(a: Signature, b: Signature, pixelDelta: number): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let changed = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(a[i]! - b[i]!) > pixelDelta) changed++;
  }
  return changed / n;
}
