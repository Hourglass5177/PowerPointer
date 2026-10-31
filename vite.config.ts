import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { defaultPort } from "./scripts/port.mjs";
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", proxy: { "/api": `http://127.0.0.1:${defaultPort}` } },
});
