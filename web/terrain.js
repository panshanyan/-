// 地形高度：機場周圍平坦，外圍有起伏丘陵與遠山
export function terrainHeight(x, z) {
  const r = Math.hypot(x, z * 0.8);
  const flat = 260;
  if (r < flat) return 0;
  const t = Math.min(1, (r - flat) / 500);
  const k = t * t * (3 - 2 * t);
  const n =
    Math.sin(x * 0.006 + 1.3) * Math.cos(z * 0.005 - 0.7) * 28 +
    Math.sin(x * 0.017 + z * 0.011) * 9 +
    Math.cos(x * 0.031 - z * 0.027 + 2) * 4;
  const mountain = Math.max(0, r - 900) * 0.12;
  return k * (n + 22) + mountain;
}
