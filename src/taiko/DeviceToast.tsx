import { useEffect, useState } from "react";
import { deviceState, type DeviceEvent, type DeviceKey } from "./deviceState";
import { debugLog } from "./debugLog";

import { useLanguage } from "./i18n";

/** 每条提示显示时长（毫秒） */
const SHOW_MS = 2000;

/**
 * 设备连接/断开提示条：宿主播一条 __pd2uDeviceEvent 就弹一条，
 * 文案在页面本地化，两秒后自行消失（不做去重，宿主已过滤）。
 */
export function DeviceToast() {
  const { tr } = useLanguage();
  const [items, setItems] = useState<DeviceEvent[]>([]);

  useEffect(() => {
    const off = deviceState.onEvent((e) => {
      debugLog.push("system", `弹窗提示 ${e.d} ${e.c ? "已连接" : "已断开"}`);
      setItems((list) => [...list, e]);
      window.setTimeout(() => setItems((list) => list.filter((i) => i.at !== e.at)), SHOW_MS);
    });
    return off;
  }, []);


  const ZH: Record<DeviceKey, string> = {
    m: "适配器",
    l: "左鼓棒",
    r: "右鼓棒",
    f: "踏板",
  };
  const EN: Record<DeviceKey, string> = {
    m: "Adapter",
    l: "Left stick",
    r: "Right stick",
    f: "Pedal",
  };

  const text = (e: DeviceEvent) =>
    tr(
      `${ZH[e.d]}${e.c ? "已连接" : "已断开"}`,
      `${EN[e.d]} ${e.c ? "connected" : "disconnected"}`,
    );

  if (items.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-1"
      style={{ top: "calc(var(--safe-top) + 8px)" }}
    >
      {items.map((e) => (
        <div
          key={e.at}
          className={`rounded border px-3 py-1 text-xs backdrop-blur-sm ${
            e.c
              ? "border-[var(--taiko-accent)] bg-[var(--taiko-paper)]/90 text-[var(--taiko-accent)]"
              : "border-[var(--taiko-line)] bg-[var(--taiko-paper)]/90 text-[var(--taiko-ink)]/75"
          }`}
        >
          {text(e)}
        </div>
      ))}
    </div>
  );
}
