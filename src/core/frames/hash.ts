import sharp from "sharp";

/**
 * Perceptual hashing (PRD decision D6) — the dHash algorithm.
 *
 * Downscale the frame to a tiny 9x8 grayscale thumbnail and encode, for each row, whether
 * each pixel is brighter than the one to its right (64 comparisons -> 64 bits). Small local
 * details — most importantly a moving cursor — vanish at this resolution, so cursor-only
 * movement yields the SAME hash and collapses away. Large changes (navigation, menus,
 * selections) change the gradient structure and are kept.
 */

/** A 64-bit perceptual hash. */
export type PerceptualHash = bigint;

const HASH_WIDTH = 9; // one extra column so each row yields 8 horizontal comparisons
const HASH_HEIGHT = 8;

/** Compute the dHash of an image file. */
export async function perceptualHash(imagePath: string): Promise<PerceptualHash> {
  const data = await sharp(imagePath)
    .greyscale()
    .resize(HASH_WIDTH, HASH_HEIGHT, { fit: "fill" })
    .raw()
    .toBuffer();

  let hash = 0n;
  let bit = 0;
  for (let row = 0; row < HASH_HEIGHT; row++) {
    for (let col = 0; col < HASH_WIDTH - 1; col++) {
      const left = data[row * HASH_WIDTH + col]!;
      const right = data[row * HASH_WIDTH + col + 1]!;
      if (left < right) hash |= 1n << BigInt(bit);
      bit++;
    }
  }
  return hash;
}

/** Number of differing bits between two hashes. Lower = more similar. */
export function hammingDistance(a: PerceptualHash, b: PerceptualHash): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}
