// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

/**
 * 旧版 WebView 兼容：构建产物里的现代 CSS（oklch / color-mix / 嵌套等）
 * 统一降级到 Chrome 90 可读的写法，避免安卓 13 自带旧内核整页解析失败白屏。
 */
function legacyCssDowngrade(): Plugin {
  return {
    name: "legacy-css-downgrade",
    apply: "build",
    enforce: "post",
    async generateBundle(_options, bundle) {
      const { transform } = await import("lightningcss");
      for (const file of Object.keys(bundle)) {
        if (!file.endsWith(".css")) continue;
        const asset = bundle[file];
        if (!asset || asset.type !== "asset") continue;
        const css = typeof asset.source === "string" ? asset.source : Buffer.from(asset.source);
        try {
          const out = transform({
            filename: file,
            code: Buffer.from(css as string | Uint8Array),
            minify: true,
            // Chrome 90 / Safari 14：覆盖安卓 13 上常见的旧 WebView 内核
            targets: { chrome: 90 << 16, safari: (14 << 16) | (0 << 8), android: 90 << 16 },
          });
          asset.source = out.code.toString();
        } catch {
          // 降级失败就保留原样，不影响构建
        }
      }
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [legacyCssDowngrade()],
  },
});
