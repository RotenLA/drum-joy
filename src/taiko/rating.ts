export type PlayRating = "C" | "B" | "A" | "S" | "SS" | "SSS";

/** 统一评级：选歌、演奏 HUD 与结算页共用。 */
export function ratingOfAccuracy(accuracy: number): PlayRating {
  const value = Math.max(0, Math.min(100, accuracy));
  if (value >= 98) return "SSS";
  if (value >= 95) return "SS";
  if (value >= 90) return "S";
  if (value >= 80) return "A";
  if (value >= 70) return "B";
  return "C";
}