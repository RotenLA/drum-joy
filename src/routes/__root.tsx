import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "color-scheme", content: "dark" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "LovableSynth" },
      { name: "description", content: "LovableSynth 桌面合成器与空气鼓工作台。" },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "LovableSynth" },
      { property: "og:description", content: "桌面合成器与空气鼓工作台。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className="dark"
      // 内联兜底配色：样式表若在旧版 WebView 里解析失败，页面也不会是一片白
      style={{ colorScheme: "dark", backgroundColor: "#100c0a", color: "#f4f1ed" }}
    >
      <head>
        <HeadContent />
      </head>
      <body style={{ backgroundColor: "#100c0a", color: "#f4f1ed", margin: 0 }}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/**
 * 内嵌 WebView 没有开发者工具：任何未捕获异常都在页面上直接显示出来，
 * 白屏时也能看到具体原因（并同步送到宿主日志通道）。
 */
function CrashOverlay() {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const report = (text: string) => {
      setMsg((prev) => prev ?? text);
      try {
        const host = window as unknown as { __pd2uLog?: (s: string) => void };
        host.__pd2uLog?.(text);
      } catch {
        // 宿主未注入日志通道
      }
    };
    const onErr = (e: ErrorEvent) => report(`${e.message} @ ${e.filename}:${e.lineno}`);
    const onRej = (e: PromiseRejectionEvent) => report(String(e.reason));
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);

  if (!msg) return null;
  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 99999,
        padding: "8px 12px",
        background: "#2b1410",
        color: "#ffd9c7",
        font: "12px/1.5 monospace",
        maxHeight: "40%",
        overflow: "auto",
      }}
    >
      {msg}
    </div>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <CrashOverlay />
    </QueryClientProvider>
  );
}
