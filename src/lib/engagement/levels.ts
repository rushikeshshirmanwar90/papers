// Levels: reaching level L takes 50 × L × (L − 1) XP in total (L1 = 0, L2 = 100, L5 = 1,000, L10 = 4,500).

export const xpForLevel = (level: number) => 50 * level * (level - 1);

export function levelForXp(xp: number) {
  const total = Math.max(0, Math.floor(xp));
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * total) / 50)) / 2));
  // Guard against floating-point error at the exact boundaries.
  while (xpForLevel(level + 1) <= total) level++;
  while (level > 1 && xpForLevel(level) > total) level--;
  return level;
}

/** Where a total sits within its level, for the level chip's bar. */
export function levelProgress(xp: number) {
  const total = Math.max(0, Math.floor(xp));
  const level = levelForXp(total);
  const start = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return {
    level,
    levelStartXp: start,
    nextLevelXp: next,
    intoLevel: total - start,
    toNext: next - total,
    /** 0 ≤ progress < 1 */
    progress: (total - start) / (next - start),
  };
}
