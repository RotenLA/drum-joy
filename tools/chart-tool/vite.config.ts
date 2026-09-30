import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

// 独立于主站的构建：file:// 加载需要 base './'
export default defineConfig({
  root,
  base: "./",
  plugins: [
    react(),
    {
      // file:// 下不能加载 ES module 脚本：输出普通脚本并放到 body 末尾
      name: "classic-script",
      enforce: "post",
      transformIndexHtml(html) {
        const tags: string[] = [];
        const out = html
          .replace(/<script type="module" crossorigin (src="[^"]+")><\/script>\s*/g, (_m, src: string) => {
            tags.push(`<script defer ${src}></script>`);
            return "";
          })
          .replace(/ crossorigin/g, "");
        return out.replace("</head>", `${tags.join("")}</head>`);
      },
    },
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  build: {
    outDir: fileURLToPath(new URL("../../electron/chart-tool/dist", import.meta.url)),
    emptyOutDir: true,
    target: "chrome120",
    modulePreload: false,
    rollupOptions: { output: { format: "iife", inlineDynamicImports: true } },
  },
});
