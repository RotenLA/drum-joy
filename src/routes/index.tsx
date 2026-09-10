import { createFileRoute } from "@tanstack/react-router";
import { TaikoShell } from "@/taiko/TaikoShell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PD2U 谱面工作台 — LovableSynth" },
      {
        name: "description",
        content:
          "PD2U 空气鼓模块：舞台下落游玩、谱面导入分析与鼓件 MIDI 映射设置。",
      },
      { property: "og:title", content: "PD2U 谱面工作台 — LovableSynth" },
      {
        property: "og:description",
        content: "PD2U：游玩轨道、谱面分析与鼓件映射设置的一体化界面。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return <TaikoShell />;
}
