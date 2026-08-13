import { useMemo, useState } from "react";
import { measureDurationMs, splitByMeasure, type TaikoChart } from "@/shared/taikoChart";

const SUBDIVISIONS = 8;

export function ChartScreen({
  chart,
  onSeekMeasure,
}: {
  chart: TaikoChart;
  onSeekMeasure?: (index: number) => void;
}) {
  const [selected, setSelected] = useState(0);
  const measures = useMemo(() => splitByMeasure(chart), [chart]);
  const measureMs = measureDurationMs(chart);

  const donCount = chart.notes.filter((n) => n.lane === "don").length;
  const kaCount = chart.notes.length - donCount;

  return (
    <div className="flex flex-col gap-6">
      {/* 缩略条 */}
      <div className="flex gap-[2px] border border-[var(--taiko-line)] p-2">
        {measures.map((m, i) => (
          <button
            key={i}
            onClick={() => {
              setSelected(i);
              onSeekMeasure?.(i);
            }}
            title={`第 ${i + 1} 小节`}
            className={`flex h-10 flex-1 flex-col justify-end gap-[2px] p-[2px] transition-colors ${
              selected === i ? "bg-[var(--taiko-ink)]/10" : "hover:bg-[var(--taiko-ink)]/5"
            }`}
          >
            {m.slice(0, 4).map((n, j) => (
              <span
                key={j}
                className="block h-1 w-full"
                style={{
                  backgroundColor:
                    n.lane === "don" ? "var(--taiko-don)" : "var(--taiko-ka)",
                }}
              />
            ))}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_220px]">
        {/* 小节网格 */}
        <div className="flex flex-col divide-y divide-[var(--taiko-line)] border border-[var(--taiko-line)]">
          {measures.map((m, i) => {
            const cells = Array.from({ length: SUBDIVISIONS }, (_, s) => {
              const start = i * measureMs + (s * measureMs) / SUBDIVISIONS;
              const end = start + measureMs / SUBDIVISIONS;
              return m.find((n) => n.timeMs >= start && n.timeMs < end) ?? null;
            });
            return (
              <div
                key={i}
                onClick={() => {
                  setSelected(i);
                  onSeekMeasure?.(i);
                }}
                className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${
                  selected === i ? "bg-[var(--taiko-ink)]/5" : ""
                }`}
              >
                <span className="w-8 shrink-0 text-xs tabular-nums text-[var(--taiko-ink)]/45">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="grid flex-1 grid-cols-8 gap-[3px]">
                  {cells.map((n, s) => (
                    <span
                      key={s}
                      className="flex h-7 items-center justify-center border border-[var(--taiko-line)]"
                    >
                      {n ? (
                        <i
                          className="block rounded-full"
                          style={{
                            width: n.big ? 18 : 12,
                            height: n.big ? 18 : 12,
                            backgroundColor:
                              n.lane === "don"
                                ? "var(--taiko-don)"
                                : "var(--taiko-ka)",
                          }}
                        />
                      ) : null}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* 侧栏 */}
        <aside className="h-fit border border-[var(--taiko-line)] p-4 text-sm text-[var(--taiko-ink)]">
          <dl className="flex flex-col gap-3">
            <Stat label="BPM" value={String(chart.bpm)} />
            <Stat
              label="拍号"
              value={`${chart.timeSignature[0]}/${chart.timeSignature[1]}`}
            />
            <Stat label="小节数" value={String(measures.length)} />
            <Stat label="音符总数" value={String(chart.notes.length)} />
            <Stat label="咚" value={`${donCount}`} accent="var(--taiko-don)" />
            <Stat label="嗒" value={`${kaCount}`} accent="var(--taiko-ka)" />
          </dl>
        </aside>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-[var(--taiko-line)] pb-2 last:border-0">
      <dt className="flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-[var(--taiko-ink)]/50">
        {accent ? (
          <i
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: accent }}
          />
        ) : null}
        {label}
      </dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
