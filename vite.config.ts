import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Content-Security-Policy for the built site. GitHub Pages cannot send headers, so it is a meta tag, and it reaches
 * the judge workers because they start from blob URLs and inherit it (src/judge/client.ts). Submitted code runs in
 * those workers: connect-src and script-src keep it from reaching any host but this site and the Pyodide CDN.
 * 'unsafe-eval' is the judge itself (new Function), 'wasm-unsafe-eval' is Pyodide, and 'unsafe-inline' styles are
 * CodeMirror's injected stylesheets. Build only: the dev server relies on inline scripts for hot reload.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
  "connect-src 'self' https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

function contentSecurityPolicy(): Plugin {
  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" }],
  };
}

export default defineConfig({
  base: "/coding-dojo/",
  plugins: [
    react(),
    contentSecurityPolicy(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Coding Dojo",
        short_name: "Dojo",
        description: "브라우저에서 풀고 채점하는 코딩 테스트 연습 사이트",
        lang: "ko",
        start_url: "/coding-dojo/",
        scope: "/coding-dojo/",
        display: "standalone",
        background_color: "#0f1115",
        theme_color: "#0f1115",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell and problem data are precached; the CodeMirror chunk is larger than Workbox's 2 MiB default.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            // Pyodide runtime (~15 MB) is fetched from the CDN once, then served from cache so Python works offline.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/pyodide\//,
            handler: "CacheFirst",
            options: {
              cacheName: "pyodide",
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  worker: { format: "es" },
});
