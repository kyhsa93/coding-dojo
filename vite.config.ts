import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/coding-dojo/",
  plugins: [
    react(),
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
