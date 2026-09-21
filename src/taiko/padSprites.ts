/**
 * 鼓面 / 踏板 / 舞台背景贴图（AeroBand 官方部件素材，CDN 指针）。
 * 每个部件两套：未敲击 + 敲击发光（自带彩色泛光）。
 * 贴图异步加载，未就绪时渲染器自动退回原有代码画法，不会白屏。
 *
 * ringFrac / offX / offY 来自素材实测：彩圈（判定落点）在图片中的宽度占比与中心偏移，
 * 渲染时按彩圈对齐锚点，这样素材自带的阴影/透视留白不会让鼓面「偏位」。
 */
import type { PartId } from "./laneLayouts";

import crash from "@/assets/pads/crash.png.asset.json";
import crashHit from "@/assets/pads/crash_hit.png.asset.json";
import ride from "@/assets/pads/ride.png.asset.json";
import rideHit from "@/assets/pads/ride_hit.png.asset.json";
import hihat from "@/assets/pads/hihat.png.asset.json";
import hihatHit from "@/assets/pads/hihat_hit.png.asset.json";
import snare from "@/assets/pads/snare.png.asset.json";
import snareHit from "@/assets/pads/snare_hit.png.asset.json";
import highTom from "@/assets/pads/hightom.png.asset.json";
import highTomHit from "@/assets/pads/hightom_hit.png.asset.json";
import midTom from "@/assets/pads/midtom.png.asset.json";
import midTomHit from "@/assets/pads/midtom_hit.png.asset.json";
import floorTom from "@/assets/pads/floortom.png.asset.json";
import floorTomHit from "@/assets/pads/floortom_hit.png.asset.json";
import pedalLUp from "@/assets/pads/pedalL_up.png.asset.json";
import pedalLDown from "@/assets/pads/pedalL_down.png.asset.json";
import pedalRUp from "@/assets/pads/pedalR_up.png.asset.json";
import pedalRDown from "@/assets/pads/pedalR_down.png.asset.json";
import stageBg from "@/assets/pads/stage-bg.jpg.asset.json";

export interface PadSpriteMeta {
  /** 未敲击贴图 */
  url: string;
  /** 敲击发光贴图 */
  hitUrl: string;
  /** 彩圈宽度 / 图片宽度 */
  ringFrac: number;
  /** 彩圈中心相对图片中心的偏移（以彩圈宽 / 高为单位） */
  offX: number;
  offY: number;
  /** 素材内彩圈长轴相对水平线的实际角度（度），供判定缩圈精确贴合 */
  ringAngleDeg: number;
}

const PAD_SPRITES: Partial<Record<PartId, PadSpriteMeta>> = {
  crash: { url: crash.url, hitUrl: crashHit.url, ringFrac: 0.89, offX: 0.008, offY: -0.056, ringAngleDeg: 9.7 },
  ride: { url: ride.url, hitUrl: rideHit.url, ringFrac: 0.835, offX: -0.002, offY: -0.035, ringAngleDeg: -11.2 },
  hihat: { url: hihat.url, hitUrl: hihatHit.url, ringFrac: 0.828, offX: 0.008, offY: -0.054, ringAngleDeg: 9.6 },
  snare: { url: snare.url, hitUrl: snareHit.url, ringFrac: 0.788, offX: -0.015, offY: -0.053, ringAngleDeg: 0.2 },
  highTom: {
    url: highTom.url,
    hitUrl: highTomHit.url,
    ringFrac: 0.787,
    offX: -0.016,
    offY: -0.035,
    ringAngleDeg: 0.3,
  },
  midTom: { url: midTom.url, hitUrl: midTomHit.url, ringFrac: 0.787, offX: -0.011, offY: -0.035, ringAngleDeg: 0.4 },
  floorTom: {
    url: floorTom.url,
    hitUrl: floorTomHit.url,
    ringFrac: 0.824,
    offX: -0.002,
    offY: -0.043,
    ringAngleDeg: -5.1,
  },
};

/** 踏板贴图：pedalHat 用左踏板，kick 用右踏板；down = 踩下（橙），up = 松开（黑） */
const PEDAL_URL: Record<"pedalHat" | "kick", { up: string; down: string }> = {
  pedalHat: { up: pedalLUp.url, down: pedalLDown.url },
  kick: { up: pedalRUp.url, down: pedalRDown.url },
};

const cache = new Map<string, HTMLImageElement | null>();

function img(url: string): HTMLImageElement | null {
  if (typeof document === "undefined") return null;
  const hit = cache.get(url);
  if (hit !== undefined) return hit;
  const el = new Image();
  el.decoding = "async";
  el.src = url;
  cache.set(url, el);
  return el;
}

function ready(el: HTMLImageElement | null): HTMLImageElement | null {
  return el && el.complete && el.naturalWidth > 0 ? el : null;
}

/** 预载全部贴图（进入界面时调一次即可） */
export function preloadPadSprites(): void {
  for (const m of Object.values(PAD_SPRITES)) {
    if (!m) continue;
    img(m.url);
    img(m.hitUrl);
  }
  for (const p of Object.values(PEDAL_URL)) {
    img(p.up);
    img(p.down);
  }
  img(stageBg.url);
}

export function padSpriteMeta(id: PartId): PadSpriteMeta | null {
  return PAD_SPRITES[id] ?? null;
}

export function padSprite(id: PartId): HTMLImageElement | null {
  const m = PAD_SPRITES[id];
  return m ? ready(img(m.url)) : null;
}

/** 敲击发光贴图（未加载完返回 null，调用方退回未敲击贴图） */
export function padSpriteHit(id: PartId): HTMLImageElement | null {
  const m = PAD_SPRITES[id];
  return m ? ready(img(m.hitUrl)) : null;
}

export function pedalSprite(id: PartId, pressed: boolean): HTMLImageElement | null {
  const set = PEDAL_URL[id as "pedalHat" | "kick"];
  if (!set) return null;
  return ready(img(pressed ? set.down : set.up));
}

export function stageBgSprite(): HTMLImageElement | null {
  return ready(img(stageBg.url));
}
