import { NotImplementedError } from "../util/errors.js";

/**
 * Perceptual hashing (PRD decision D6).
 *
 * Computes a compact hash of a frame's global gradient structure (dHash-style):
 * downscale to a tiny thumbnail, then encode gradient direction. Small local
 * details — most importantly a moving cursor — vanish at this resolution, so
 * cursor-only movement produces the SAME hash and collapses away. Large changes
 * (menus, navigation, selections) change the hash and are kept.
 *
 * Intended implementation uses `sharp` to read and downscale the image.
 */

/** A perceptual hash as a bit string (or bigint) suitable for Hamming comparison. */
export type PerceptualHash = bigint;

/** Compute the perceptual hash of an image file. */
export async function perceptualHash(_imagePath: string): Promise<PerceptualHash> {
  throw new NotImplementedError("frames/hash.perceptualHash");
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
