import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/coding-dojo/",
  plugins: [react()],
  worker: { format: "es" },
});
