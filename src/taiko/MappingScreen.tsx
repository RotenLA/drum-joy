import { useState } from "react";
import {
  CHART_NOTES,
  DRUM_LANE_MAP,
  getDrumNoteName,
  type DrumLane,
} from "@/shared/drumLaneMap";

type LaneSetting = DrumLane | "ignore";

const ALL_NOTES = [35, 36, 38, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52];

function defaultSettings(): Record<number, LaneSetting> {
  const out: Record<number, LaneSetting> = {};
  for (const n of ALL_NOTES) out[n] = DRUM_LANE_MAP[n] ?? "ignore";
  return out;
}

/** 简化俯视鼓组图：每个鼓件的位置与半径 */
const PIECES: { note: number; x: number; y: number; r: number; label: string }[] = [
  { note: 49, x: 42, y: 46, r: 26, label: "Crash" },
  { note: 51, x: 158, y: 46, r: 26, label: "Ride" },
  { note: 52, x: 100, y: 26, r: 20, label: "China" },
  { note: 48, x: 78, y: 86, r: 20, label: "T1" },
  { note: 50, x: 122, y: 86, r: 20, label: "T2" },
  { note: 42, x: 34, y: 98, r: 20, label: "HH" },
  { note: 38, x: 62, y: 132, r: 24, label: "Snare" },
  { note: 43, x: 152, y: 130, r: 26, label: "Floor" },
  { note: 41, x: 176, y: 96, r: 22, label: "Floor2" },
  { note: 36, x: 108, y: 146, r: 30, label: "Kick" },
  { note: 44, x: 30, y: 156, r: 18, label: "Pedal" },
];

export function MappingScreen() {
  const [settings, setSettings] = useState<Record<number, LaneSetting>>(defaultSettings);

  const colorOf = (note: number) => {
    const s = settings[note];
    if (s === "don") return "var(--taiko-don)";
    if (s === "ka") return "var(--taiko-ka)";
    return "var(--taiko-surface)";
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
      <div className="flex flex-col gap-4">
        <svg viewBox="0 0 210 185" className="w-full border border-[var(--taiko-line)] p-2">
          {PIECES.map((p) => (
            <g key={p.note}>
              <circle
                cx={p.x}
                cy={p.y}
                r={p.r}
                fill={colorOf(p.note)}
                stroke="var(--taiko-ink)"
                strokeOpacity={0.4}
                strokeWidth={1}
              />
              <text
                x={p.x}
                y={p.y + 3}
                textAnchor="middle"
                fontSize="7"
                fill="var(--taiko-ink)"
                opacity={0.75}
              >
                {p.note}
              </text>
            </g>
          ))}
        </svg>
        <p className="text-xs leading-relaxed text-[var(--taiko-ink)]/55">
          默认规则：双脚（36 底鼓、44 踩镲踏板）为咚，其余鼓件为嗒。未列出的音符不生成谱面音符。
        </p>
        <button
          onClick={() => setSettings(defaultSettings())}
          className="border border-[var(--taiko-ink)] px-4 py-2 text-sm text-[var(--taiko-ink)] transition-colors hover:bg-[var(--taiko-ink)] hover:text-[var(--taiko-paper)]"
        >
          恢复默认
        </button>
      </div>

      <div className="border border-[var(--taiko-line)]">
        <div className="flex items-center gap-3 border-b border-[var(--taiko-line)] px-4 py-2 text-xs uppercase tracking-[0.15em] text-[var(--taiko-ink)]/50">
          <span className="w-10">音符</span>
          <span className="flex-1">鼓件</span>
          <span>分组</span>
        </div>
        <ul className="divide-y divide-[var(--taiko-line)]">
          {ALL_NOTES.map((note) => (
            <li key={note} className="flex items-center gap-3 px-4 py-2">
              <span className="w-10 tabular-nums text-sm text-[var(--taiko-ink)]/70">
                {note}
              </span>
              <span className="flex-1 text-sm text-[var(--taiko-ink)]">
                {getDrumNoteName(note)}
              </span>
              <div className="flex">
                {(["don", "ka", "ignore"] as LaneSetting[]).map((opt) => {
                  const active = settings[note] === opt;
                  return (
                    <button
                      key={opt}
                      onClick={() => setSettings((s) => ({ ...s, [note]: opt }))}
                      className={`-ml-px border border-[var(--taiko-line)] px-3 py-1 text-xs transition-colors ${
                        active
                          ? "text-[var(--taiko-paper)]"
                          : "text-[var(--taiko-ink)]/55 hover:text-[var(--taiko-ink)]"
                      }`}
                      style={
                        active
                          ? {
                              backgroundColor:
                                opt === "don"
                                  ? "var(--taiko-don)"
                                  : opt === "ka"
                                    ? "var(--taiko-ka)"
                                    : "var(--taiko-ink)",
                              borderColor: "transparent",
                            }
                          : undefined
                      }
                    >
                      {opt === "don" ? "咚" : opt === "ka" ? "嗒" : "忽略"}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
        <p className="border-t border-[var(--taiko-line)] px-4 py-2 text-xs text-[var(--taiko-ink)]/45">
          共 {CHART_NOTES.length} 个默认参与谱面的音符。本轮修改仅存于内存，不写入配置。
        </p>
      </div>
    </div>
  );
}
