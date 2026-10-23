export type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * Spatial navigation for a 10-foot UI: picks the nearest focusable element in the
 * pressed (visual) direction. Works for grids, lists and dialogs without per-screen wiring.
 */
export function nextInDirection(current: Element | null, dir: Direction, candidates: Element[]): Element | null {
  const visible = candidates.filter((c) => {
    const r = c.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  if (!current || !visible.includes(current)) return visible[0] ?? null;
  const from = current.getBoundingClientRect();
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  let best: Element | null = null;
  let bestScore = Infinity;
  for (const c of visible) {
    if (c === current) continue;
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = cx - fx;
    const dy = cy - fy;
    let primary: number;
    let ortho: number;
    switch (dir) {
      case 'up':
        primary = -dy;
        ortho = Math.abs(dx);
        break;
      case 'down':
        primary = dy;
        ortho = Math.abs(dx);
        break;
      case 'left':
        primary = -dx;
        ortho = Math.abs(dy);
        break;
      case 'right':
        primary = dx;
        ortho = Math.abs(dy);
        break;
    }
    if (primary <= 1) continue;
    const score = primary + ortho * 2;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}
