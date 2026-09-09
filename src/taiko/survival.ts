/**
 * 生存模式规则（纯逻辑，不含渲染）：
 * 满血起步，Miss 扣血、命中回少量血，连击每上一档下落速度略快，
 * 血量归零立刻结算。
 */

export const HP_MAX = 100;
/** Miss 扣血 */
export const HP_MISS = -12;
/** Good 回血 */
export const HP_GOOD = 1.2;
/** Perfect 回血 */
export const HP_PERFECT = 2.4;

/** 连击加速：每 25 连击 +6%，最多 +50% */
export function survivalSpeed(base: number, combo: number): number {
  const boost = Math.min(0.5, Math.floor(combo / 25) * 0.06);
  return base * (1 + boost);
}

export function clampHp(hp: number): number {
  return Math.max(0, Math.min(HP_MAX, hp));
}
