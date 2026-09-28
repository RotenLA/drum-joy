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
        content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
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
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var u=navigator.userAgent||'';if(!/android/i.test(u))return;var m=/(?:chrome|crios)\\/(\\d+)/i.exec(u)||/version\\/(\\d+)/i.exec(u);var v=m?parseInt(m[1],10):0;var c=document.createElement('canvas');var a=window.AudioContext||window.webkitAudioContext;var bad=(v>0&&v<90)||!c.getContext||!a;if(bad)document.documentElement.setAttribute('data-pd2u-unsupported',String(v||0));}catch(e){}})();`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
             __html: `(function(){var ID='pd2u-startup-failure';var errs=[];var timer=0;function remove(){var d=document.getElementById(ID);if(d&&d.parentNode)d.parentNode.removeChild(d)}window.__pd2uMarkBooted=function(){window.__pd2uBooted=true;remove();if(timer)clearInterval(timer)};function rec(m){try{errs.push(String(m).slice(0,300));if(errs.length>6)errs.shift();}catch(e){}}window.addEventListener('error',function(e){rec((e&&e.message)||'error')});window.addEventListener('unhandledrejection',function(e){rec('promise: '+((e&&e.reason&&(e.reason.message||e.reason))||''))});var preview=/(?:lovableproject|lovableproject-dev|lovable\.app|gpt-eng|gptengineer\.run)$/i.test(location.hostname);var wait=preview?45000:20000;setTimeout(function(){if(window.__pd2uBooted||document.documentElement.hasAttribute('data-pd2u-unsupported'))return;try{if(document.getElementById(ID))return;var d=document.createElement('div');d.id=ID;d.style.cssText='position:fixed;inset:0;z-index:99999;background:#100c0a;color:#f4f1ed;font:14px/1.6 sans-serif;padding:24px;overflow:auto';d.innerHTML='<h2 style="margin:0 0 8px">页面启动失败 / Failed to start</h2><p>请截图反馈给开发，或尝试更新系统 WebView / Chrome 后重试。</p><pre style="white-space:pre-wrap;font-size:12px;opacity:.75"></pre><button style="margin-top:12px;padding:8px 16px">重新加载 / Reload</button>';d.querySelector('pre').textContent='UA: '+navigator.userAgent+'\\n\\n'+(errs.join('\\n')||'no error captured');d.querySelector('button').onclick=function(){location.reload()};document.body.appendChild(d);}catch(e){}},wait);timer=setInterval(function(){if(window.__pd2uBooted){remove();clearInterval(timer)}},500)})();`,
          }}
        />
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
    // React 内部的水合重测警告（#418/#421/#422/#423/#425）属于良性提示，
    // 框架会自动在客户端重建这棵树，不需要在屏幕上打扰用户。
    const benign = (text: string) =>
      /Minified React error #(418|421|422|423|425)/.test(text) ||
      /hydrat/i.test(text) ||
      /did not match/i.test(text) ||
      /ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)/i.test(text);

    const report = (text: string) => {
      try {
        const host = window as unknown as { __pd2uLog?: (s: string) => void };
        host.__pd2uLog?.(text);
      } catch {
        // 宿主未注入日志通道
      }
      if (benign(text)) return;
      setMsg((prev) => prev ?? text);
    };
    const onErr = (e: ErrorEvent) =>
      report(`${e.message} @ ${e.filename}:${e.lineno}`);
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
