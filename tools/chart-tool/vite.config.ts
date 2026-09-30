import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

// 独立于主站的构建：file:// 加载需要 base './'
export default defineConfig({
  root,
  base: "./",
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  build: {
    outDir: fileURLToPath(new URL("../../electron/chart-tool/dist", import.meta.url)),
    emptyOutDir: true,
    target: "chrome120",
  },
});
