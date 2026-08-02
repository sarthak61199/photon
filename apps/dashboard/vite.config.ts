import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Matches DASHBOARD_PORT / BETTER_AUTH_URL's default (apps/dashboard/src/server/config.ts) —
  // better-auth validates the request Origin against baseURL, so the dev server's actual port
  // has to agree with it, not fall back to Vite's default 5173.
  server: {
    port: Number(process.env.DASHBOARD_PORT ?? process.env.PORT ?? 3000),
  },
  plugins: [tanstackStart(), viteReact(), tailwindcss()],
});
