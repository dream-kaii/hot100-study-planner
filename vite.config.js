import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { localRunner } from "./src/server/local-runner.mjs";

export default defineConfig({
  base: "./",
  server: { host: "127.0.0.1" },
  plugins: [react(), localRunner()]
});
