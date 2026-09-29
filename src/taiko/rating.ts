export type PlayRating = "C" | "B" | "A" | "S" | "SS" | "SSS";

export interface RatingContext {
  /** 歌曲进度 0~100；实时评级用它限制开局最高档。 */
  progress?: number;
  /** 是否完整结束；SSS 只在完整结束时出现。 */
  completed?: boolean;
  /** 是否完整结束且无 Miss；SSS 必须全连。 */
  fullCombo?: boolean;
}

export const RATING_ORDER: readonly PlayRating[] = ["C", "B", "A", "S", "SS", "SSS"];

/** 统一严格评级：选歌、演奏 HUD、结算与排行榜共用。 */
export function ratingOfAccuracy(accuracy: number, context: RatingContext = {}): PlayRating {
  const value = Math.max(0, Math.min(100, accuracy));
  let rating: PlayRating = value >= 99.5 && context.completed === true && context.fullCombo === true
    ? "SSS"
    : value >= 97
      ? "SS"
      : value >= 93
        ? "S"
        : value >= 85
          ? "A"
          : value >= 75
            ? "B"
            : "C";

  if (context.progress !== undefined && context.completed !== true) {
    const progress = Math.max(0, Math.min(100, context.progress));
    const maxRating: PlayRating = progress < 10 ? "C" : progress < 25 ? "B" : progress < 45 ? "A" : progress < 70 ? "S" : "SS";
    if (RATING_ORDER.indexOf(rating) > RATING_ORDER.indexOf(maxRating)) rating = maxRating;
  }
  return rating;
}

/** C=0 … SSS=5，供舞台渐进效果使用。 */
export function ratingLevel(rating: PlayRating | null | undefined): number {
  return rating ? Math.max(0, RATING_ORDER.indexOf(rating)) : 0;
}