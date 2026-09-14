/**
 * Scale an image to fit within a box, preserving aspect ratio and never enlarging. Bounds
 * BOTH width and height — a tall/scrolling screenshot must not blow up the page (a docx bug
 * review caught was capping width only, yielding 30-inch-tall images).
 */
export function fitWithin(
  width: number | undefined,
  height: number | undefined,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const w = width && width > 0 ? width : maxWidth;
  const h = height && height > 0 ? height : Math.round(maxWidth * 0.6);
  const scale = Math.min(1, maxWidth / w, maxHeight / h);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}
