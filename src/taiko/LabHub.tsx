/**
 * 测试版主界面（实验室）：多游戏模式卡片。
 * 只能由选歌页顶部「选择歌曲」连续点击 12 次进入，不影响正式版本流程。
 */
import { useLanguage } from "./i18n";
import { Activity, Hammer, LogOut, Radio, Rows3 } from "lucide-react";
import { toast } from "sonner";

export type LabGame = "rhythm" | "flat" | "mole" | "theremin";

const CARD_BG: Record<LabGame, string> = {
  rhythm: "linear-gradient(150deg, #4c3a28 0%, #8a5d2a 55%, #2a1d10 100%)",
  flat: "linear-gradient(150deg, #3a2840 0%, #7a3d6a 55%, #1f1424 100%)",
  mole: "linear-gradient(150deg, #2c4a47 0%, #3f6d63 55%, #1e3230 100%)",
  theremin: "linear-gradient(150deg, #33305c 0%, #4d4a86 55%, #211f3c 100%)",
};

export function LabHub({ onPick, onBack }: { onPick: (game: LabGame) => void; onBack?: () => void }) {
  const { tr } = useLanguage();

  const cards: {
    id: LabGame;
    icon: typeof Activity;
    title: string;
    tag: string;
    body: string;
    ready: boolean;
  }[] = [
    {
      id: "rhythm",
      icon: Activity,
      title: tr("律动大师", "Rhythm Master"),
      tag: tr("角度触发实验版", "Gesture-triggered build"),
      body: tr(
        "现在的鼓游戏，但手上七个鼓面改由鼓棒角度实时判定，踏板仍用 MIDI。",
        "The drum game, with the seven hand pads triggered by stick angle; pedals still use MIDI.",
      ),
      ready: true,
    },
    {
      id: "flat",
      icon: Rows3,
      title: tr("横排缩圈", "Flat Lanes"),
      tag: tr("横排手势实验版", "Gesture flat-lane build"),
      body: tr(
        "手部鼓面按难度一字排开下落，左右挥棒决定打哪一列；两个踏板在第二排，用缩圈提示。",
        "Hand pads in one row with falling notes, chosen by swinging left or right; pedals sit below with shrinking rings.",
      ),
      ready: true,
    },
    {
      id: "mole",
      icon: Hammer,
      title: tr("打地鼠", "Whack-a-Mole"),
      tag: tr("空间反应玩法", "Spatial reaction"),
      body: tr("随机亮起一个鼓位，挥棒砸中得分。", "A random pad lights up; swing to smash it."),
      ready: false,
    },
    {
      id: "theremin",
      icon: Radio,
      title: tr("特雷门", "Theremin"),
      tag: tr("连续手势乐器", "Continuous gesture instrument"),
      body: tr("右踏板发声，右手左右定音高、上下定音量；左踏板切三角波，左手控制颤音。", "Right pedal sounds; right stick sets pitch and volume; left pedal morphs to triangle; left stick adds vibrato."),
      ready: true,
    },
  ];

  return (
    <div className="absolute inset-0 z-20 flex flex-col overflow-y-auto bg-[var(--taiko-picker-glass)] backdrop-blur-[16px]">
      <div className="flex shrink-0 items-center gap-3 px-4 py-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-md border border-[var(--taiko-glass-line)] bg-[var(--taiko-glass)] px-3 py-2 text-sm text-[rgba(255,255,255,0.76)] transition-colors hover:border-[var(--taiko-accent)] hover:text-[var(--taiko-accent)]"
          >
            <LogOut size={15} />
            {tr("返回正式版", "Back to release")}
          </button>
        )}
        <div className="ml-auto text-xs tracking-widest text-[var(--taiko-accent)]">
          {tr("实验室模式", "LAB MODE")}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-wrap content-center items-center justify-center gap-4 px-4 pb-6">
        {cards.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              if (c.ready) onPick(c.id);
              else toast(tr("功能开发中，敬请期待", "Under development — coming soon"));
            }}
            className="group relative flex h-[min(62vh,300px)] w-[min(86vw,260px)] flex-col justify-end overflow-hidden rounded-2xl border border-[var(--taiko-glass-line)] p-4 text-left transition-transform hover:-translate-y-1"
            style={{ background: CARD_BG[c.id], opacity: c.ready ? 1 : 0.62 }}
          >
            <c.icon size={26} className="absolute left-4 top-4 text-[rgba(255,255,255,0.8)]" />
            <span className="text-[11px] uppercase tracking-widest text-[rgba(255,255,255,0.6)]">
              {c.tag}
            </span>
            <span className="mt-1 text-xl font-semibold text-white">{c.title}</span>
            <span className="mt-2 text-xs leading-5 text-[rgba(255,255,255,0.72)]">{c.body}</span>
            {!c.ready && (
              <span className="mt-3 w-fit rounded-md bg-[rgba(0,0,0,0.35)] px-2 py-1 text-[11px] text-[rgba(255,255,255,0.8)]">
                {tr("开发中", "In development")}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
