import { createFileRoute } from "@tanstack/react-router";
import { TaikoShell } from "@/taiko/TaikoShell";
import { LanguageProvider } from "@/taiko/i18n";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PD2U AeroGame 空气鼓游玩台" },
      {
        name: "description",
        content:
          "PD2U AeroGame 空气鼓模块：全屏舞台游玩、谱面设置、MIDI 映射与鼓棒位置捕捉。",
      },
      { property: "og:title", content: "PD2U AeroGame 空气鼓游玩台" },
      {
        property: "og:description",
        content: "全屏空气鼓游玩、谱面设置、MIDI 映射与鼓棒位置捕捉的一体化界面。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  // 语言与本地设置只有在浏览器里才知道，预渲染阶段先留空，
  // 挂载后再一次性渲染真实界面，避免首屏文字与预渲染内容不一致的警告。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div style={{ minHeight: "100vh", background: "#100c0a" }} />;

  return (
    <LanguageProvider>
      <TaikoShell />
    </LanguageProvider>
  );
}

