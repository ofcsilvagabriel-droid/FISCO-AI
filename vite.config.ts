// @lovable.dev/vite-tanstack-config already includes the standard Lovable/TanStack
// plugins. The desktop target explicitly uses Nitro's Node runtime so Electron can
// launch the built server locally on Windows.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  nitro: {
    // The Electron build uses Nitro's Node output locally. On Vercel, Nitro must
    // instead emit Vercel's functions/output format rather than a Node server.
    preset: process.env.VERCEL ? "vercel" : "node",
  },
});
