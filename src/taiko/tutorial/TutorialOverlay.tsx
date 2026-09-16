/**
 * 新手教程：全屏遮罩 + 分步引导。
 * 连接适配器 → 连接鼓槌与踏板 → 认识五个部件 → 六节课（动画演示 + 练习 + 鼓励）→ 完成。
 * 从「认识五个部件」开始，鼓位图舞台一直留在画面上，后续说明都以卡片叠在舞台之上。
 */
import { useEffect, useRef, useState } from "react";
import { midiManager } from "../midiInput";
import { PART_BY_ID, partOfNote, type PartId } from "../laneLayouts";
import { renderPadArray } from "../stageRenderer";
import { quality } from "../perf";
import { LESSONS, TUTORIAL_PARTS } from "./steps";
import { TutorialStage } from "./TutorialStage";
import { loadKitEnabled, saveKitEnabled, subscribeKitEnabled } from "../drumKit";


export const TUTORIAL_KEY = "taiko.tutorial.v1";

export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === "done";
  } catch {
    return false;
  }
}

export function markTutorialSeen(): void {
  try {
    localStorage.setItem(TUTORIAL_KEY, "done");
  } catch {
    // 忽略存储不可用
  }
}

const DEVICE_RE = /pd2ultra|pd2max|pd2u|pd2|max/i;
/** 踏板音符（底鼓 36 / 踩镲踏板 44） */
const PEDAL_NOTES = [36, 44];

type Phase = "welcome" | "adapter" | "sticks" | "intro" | "lesson" | "done";
/** learn = 演示与练习合一；praise = 通过后的鼓励 */
type LessonPhase = "learn" | "praise";

const TOTAL_STEPS = 4 + LESSONS.length; // 适配器/鼓槌/部件/课程.../完成

export function TutorialOverlay({ onFinish }: { onFinish: () => void }) {
  const [phase, setPhase] = useState<Phase>("welcome");
  const [lessonIdx, setLessonIdx] = useState(0);
  const [lessonPhase, setLessonPhase] = useState<LessonPhase>("learn");
  const [restartKey, setRestartKey] = useState(0);

  const finish = () => {
    markTutorialSeen();
    onFinish();
  };

  const stepNo =
    phase === "adapter"
      ? 1
      : phase === "sticks"
        ? 2
        : phase === "intro"
          ? 3
          : phase === "lesson"
            ? 4 + lessonIdx
            : TOTAL_STEPS;

  const nextLesson = () => {
    if (lessonIdx + 1 < LESSONS.length) {
      setLessonIdx(lessonIdx + 1);
      setLessonPhase("learn");
      setRestartKey((k) => k + 1);
    } else {
      setPhase("done");
    }
  };

  const lesson = LESSONS[lessonIdx]!;
  const onStage = phase === "intro" || phase === "lesson" || phase === "done";

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-auto bg-[#07070a]/97 px-6 py-6 backdrop-blur">
      <header className="mx-auto flex w-full max-w-4xl items-baseline gap-4">
        <span className="text-sm tracking-[0.3em] text-[var(--taiko-accent)]">PD2U 新手教程</span>
        {phase !== "welcome" && (
          <span className="text-xs tabular-nums text-white/45">
            第 {stepNo} / {TOTAL_STEPS} 步
          </span>
        )}
        <button
          onClick={finish}
          className="ml-auto border border-white/20 px-3 py-1 text-xs text-white/60 transition-colors hover:border-white/60 hover:text-white"
        >
          退出教程
        </button>
      </header>

      <div className="mx-auto mt-6 flex w-full max-w-4xl flex-1 flex-col gap-5">
        {phase === "welcome" && (
          <Card title="欢迎使用 AeroGame 模块！">
            <p className="text-sm text-white/70">
              这个教程会带你连接设备，并练习最基础的敲击方式，大约 5 分钟。
            </p>
            <p className="text-xs text-white/45">
              已经熟悉的话可以直接跳过，随时能从左侧「教程」重新进入。
            </p>
            <div className="flex gap-3 pt-2">
              <PrimaryButton onClick={() => setPhase("adapter")}>开始教学</PrimaryButton>
              <GhostButton onClick={finish}>跳过</GhostButton>
            </div>
          </Card>
        )}

        {phase === "adapter" && <AdapterStep onDone={() => setPhase("sticks")} />}
        {phase === "sticks" && <StickStep onDone={() => setPhase("intro")} />}

        {onStage && (
          <StageFrame
            stage={
              phase === "intro" ? (
                <PartsPreview />
              ) : (
                <TutorialStage
                  key={`${lesson.id}-${restartKey}`}
                  lesson={lesson}
                  restartKey={restartKey}
                  onPass={() => setLessonPhase("praise")}
                />
              )
            }
            card={
              <>
              {phase === "intro" && (
                <>
                  <CardTitle>认识这五个部件</CardTitle>
                  <ul className="grid grid-cols-3 gap-2 text-xs text-white/70 sm:grid-cols-5">
                    {TUTORIAL_PARTS.map((id) => (
                      <li key={id} className="flex items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 rounded-full"
                          style={{ backgroundColor: PART_BY_ID[id].color }}
                        />
                        {PART_BY_ID[id].label}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-white/45">
                    下面两块方形是左右踏板（左脚踩镲、右脚底鼓），上面三块是鼓槌敲的踩镲、军鼓和低通。敲一下实物，画面上对应的鼓面会亮。
                  </p>
                  <div className="flex gap-3 pt-1">
                    <PrimaryButton onClick={() => setPhase("lesson")}>开始第一节</PrimaryButton>
                  </div>
                </>
              )}

              {phase === "lesson" && lessonPhase === "demo" && (
                <>
                  <CardTitle>
                    {lesson.title} · <span className="text-white/50">动画演示</span>
                  </CardTitle>
                  {lesson.demo.map((line) => (
                    <p key={line} className="text-sm text-white/75">
                      {line}
                    </p>
                  ))}
                  <div className="flex gap-3 pt-1">
                    <PrimaryButton
                      onClick={() => {
                        setLessonPhase("practice");
                        setRestartKey((k) => k + 1);
                      }}
                    >
                      明白了，开始练习
                    </PrimaryButton>
                    <GhostButton onClick={() => setRestartKey((k) => k + 1)}>再看一次</GhostButton>
                  </div>
                </>
              )}

              {phase === "lesson" && lessonPhase === "practice" && (
                <>
                  <CardTitle>
                    {lesson.title} · <span className="text-white/50">练习</span>
                  </CardTitle>
                  <p className="text-sm text-white/75">{lesson.hint}</p>
                  <div className="flex gap-3 pt-1">
                    <GhostButton onClick={() => setRestartKey((k) => k + 1)}>重新开始</GhostButton>
                    <GhostButton onClick={nextLesson}>跳过本节</GhostButton>
                  </div>
                </>
              )}

              {phase === "lesson" && lessonPhase === "praise" && (
                <>
                  <CardTitle>做得好！</CardTitle>
                  <p className="text-sm text-white/75">{lesson.praise}</p>
                  <div className="flex gap-3 pt-1">
                    <PrimaryButton onClick={nextLesson}>下一步</PrimaryButton>
                    <GhostButton
                      onClick={() => {
                        setLessonPhase("practice");
                        setRestartKey((k) => k + 1);
                      }}
                    >
                      再练一次
                    </GhostButton>
                  </div>
                </>
              )}

              {phase === "done" && (
                <>
                  <CardTitle>教程完成</CardTitle>
                  <p className="text-sm text-white/75">
                    基础的短音符、长音符和手脚配合都练过了，接下来挑一首歌试试吧。
                  </p>
                  <p className="text-xs text-white/45">
                    画质、判定偏移、鼓音色这些参数都在「谱面」页顶部，随时可以调。
                  </p>
                  <div className="pt-1">
                    <PrimaryButton onClick={finish}>开始游玩</PrimaryButton>
                  </div>
                </>
              )}
              </>
            }
          />
        )}
      </div>
    </div>
  );
}

// ================= 步骤 1：适配器 =================

function AdapterStep({ onDone }: { onDone: () => void }) {
  const [found, setFound] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const scan = () => {
      const hit = midiManager.inputs().find((i) => DEVICE_RE.test(i.name));
      if (!stop) setFound(hit ? hit.name : null);
    };
    void midiManager.init().then(scan);
    const off = midiManager.onState(scan);
    const timer = window.setInterval(scan, 800);
    return () => {
      stop = true;
      off();
      window.clearInterval(timer);
    };
  }, []);

  return (
    <Card title="第一步 · 连接适配器">
      <p className="text-sm text-white/75">
        打开 PD2ULTRA 或 PD2MAX 的适配器，用 USB 线把它接到电脑上。
      </p>
      <StatusLine
        ok={found !== null}
        okText={`已识别到适配器：${found}`}
        waitText="正在等待适配器…"
      />
      <div className="flex gap-3 pt-2">
        {found !== null ? (
          <PrimaryButton onClick={onDone}>下一步</PrimaryButton>
        ) : (
          <GhostButton onClick={onDone}>暂时跳过这步</GhostButton>
        )}
      </div>
    </Card>
  );
}

// ================= 步骤 2：鼓槌与踏板 =================

function StickStep({ onDone }: { onDone: () => void }) {
  const [stickOk, setStickOk] = useState(false);
  const [pedalOk, setPedalOk] = useState(false);

  useEffect(() => {
    void midiManager.init();
    return midiManager.onNote((note) => {
      if (PEDAL_NOTES.includes(note)) setPedalOk(true);
      else if (partOfNote(note)) setStickOk(true);
    });
  }, []);

  return (
    <Card title="第二步 · 连接鼓槌与踏板">
      <p className="text-sm text-white/75">打开鼓槌和踏板的开关，随意敲几下、踩几下。</p>
      <StatusLine ok={stickOk} okText="鼓槌已连接" waitText="等待鼓槌敲击…" />
      <StatusLine ok={pedalOk} okText="踏板已连接" waitText="等待踏板踩下…" />
      <div className="flex gap-3 pt-2">
        {stickOk && pedalOk ? (
          <PrimaryButton onClick={onDone}>下一步</PrimaryButton>
        ) : (
          <GhostButton onClick={onDone}>暂时跳过这步</GhostButton>
        )}
      </div>
    </Card>
  );
}

// ================= 五个部件静态预览 =================

function PartsPreview() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const flashes: Record<string, number> = {};
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, quality.params.maxDpr);
      canvas.width = wrap.clientWidth * dpr;
      canvas.height = wrap.clientHeight * dpr;
      canvas.style.width = `${wrap.clientWidth}px`;
      canvas.style.height = `${wrap.clientHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    // 敲哪个亮哪个，方便对照实物
    const off = midiManager.onNote((note) => {
      const p = partOfNote(note) as PartId | null;
      if (p) flashes[p] = performance.now() + 220;
    });
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      renderPadArray(ctx, canvas.clientWidth, canvas.clientHeight, {
        parts: TUTORIAL_PARTS,
        flashes,
        now,
      });
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      off();
    };
  }, []);

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden bg-[#0a0a0c]">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

// ================= 小组件 =================

/** 固定尺寸的 16:9 舞台框 + 紧贴下方的说明区：教学全程复用同一块画面 */
function StageFrame({ stage, card }: { stage: React.ReactNode; card: React.ReactNode }) {
  return (
    <div
      className="mx-auto flex w-full flex-col"
      style={{ maxWidth: "calc(min(52vh, 480px) * 16 / 9)" }}
    >
      <div
        className="relative w-full overflow-hidden border border-white/12"
        style={{
          aspectRatio: "16 / 9",
          maxHeight: "min(52vh, 480px)",
          backgroundColor: "#0a0a0c",
        }}
      >
        {stage}
        <KitToggle />
      </div>

      <div className="flex flex-col gap-2 border border-t-0 border-white/12 bg-white/[0.03] px-5 py-4">
        {card}
      </div>
    </div>
  );
}

/** 教学舞台角落的鼓音色开关：与谱面页全局参数同一份状态 */
function KitToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    setOn(loadKitEnabled());
    return subscribeKitEnabled(setOn);
  }, []);
  return (
    <button
      onClick={() => saveKitEnabled(!on)}
      className={`absolute right-2 top-2 border px-2 py-1 text-[10px] tracking-wide transition-colors ${
        on
          ? "border-white/25 bg-white/10 text-white/75"
          : "border-white/12 text-white/40 hover:text-white/70"
      }`}
    >
      鼓音色 {on ? "开" : "关"}
    </button>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {

  return <h2 className="text-sm tracking-[0.12em] text-white">{children}</h2>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border border-white/12 bg-white/[0.03] px-6 py-5">
      <h2 className="text-base text-white">{title}</h2>
      {children}
    </section>
  );
}

function StatusLine({ ok, okText, waitText }: { ok: boolean; okText: string; waitText: string }) {
  return (
    <p className={`flex items-center gap-2 text-sm ${ok ? "text-emerald-300" : "text-white/50"}`}>
      <span
        className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "animate-pulse bg-white/40"}`}
      />
      {ok ? okText : waitText}
    </p>
  );
}

function PrimaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="border border-white/70 px-6 py-2 text-sm tracking-[0.15em] text-white transition-colors hover:bg-white hover:text-black"
    >
      {children}
    </button>
  );
}

function GhostButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="border border-white/20 px-5 py-2 text-sm text-white/65 transition-colors hover:border-white/60 hover:text-white"
    >
      {children}
    </button>
  );
}
