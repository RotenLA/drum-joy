import { createFileRoute } from "@tanstack/react-router";
import { TaikoShell } from "@/taiko/TaikoShell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "太鼓谱面工作台 — LovableSynth" },
      {
        name: "description",
        content:
          "空气鼓太鼓模块：游玩轨道、谱面预览与鼓件咚/嗒映射设置，双脚为咚、双手为嗒。",
      },
      { property: "og:title", content: "太鼓谱面工作台 — LovableSynth" },
      {
        property: "og:description",
        content: "游玩轨道、谱面预览与鼓件咚/嗒映射设置的一体化界面。",
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
