/**
 * 鼓面 / 踏板 / 舞台背景贴图（来自 AeroBand 实拍素材，CDN 指针）。
 * 贴图异步加载，未就绪时渲染器自动退回原有代码画法，不会白屏。
 */
import type { PartId } from "./laneLayouts";

import yellow from "@/assets/pads/yellow.png.asset.json";
import pink from "@/assets/pads/pink.png.asset.json";
import cyan from "@/assets/pads/cyan.png.asset.json";
import purple from "@/assets/pads/purple.png.asset.json";
import orange from "@/assets/pads/orange.png.asset.json";
import blue from "@/assets/pads/blue.png.asset.json";
import green from "@/assets/pads/green.png.asset.json";
import pedalLUp from "@/assets/pads/pedalL_up.png.asset.json";
import pedalLDown from "@/assets/pads/pedalL_down.png.asset.json";
import pedalRUp from "@/assets/pads/pedalR_up.png.asset.json";
import pedalRDown from "@/assets/pads/pedalR_down.png.asset.json";
import stageBg from "@/assets/pads/stage-bg.jpg.asset.json";

/** 手击鼓面贴图（按部件） */
const PAD_URL: Partial<Record<PartId, string>> = {
  crash: yellow.url,
  highTom: pink.url,
  midTom: cyan.url,
  ride: purple.url,
  hihat: orange.url,
  snare: blue.url,
  floorTom: green.url,
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
  for (const u of Object.values(PAD_URL)) if (u) img(u);
  for (const p of Object.values(PEDAL_URL)) {
    img(p.up);
    img(p.down);
  }
  img(stageBg.url);
}

export function padSprite(id: PartId): HTMLImageElement | null {
  const url = PAD_URL[id];
  return url ? ready(img(url)) : null;
}

export function pedalSprite(id: PartId, pressed: boolean): HTMLImageElement | null {
  const set = PEDAL_URL[id as "pedalHat" | "kick"];
  if (!set) return null;
  return ready(img(pressed ? set.down : set.up));
}

export function stageBgSprite(): HTMLImageElement | null {
  return ready(img(stageBg.url));
}
