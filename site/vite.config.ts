import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const app = (p: string) => fileURLToPath(new URL(`../src/${p}`, import.meta.url));
const site = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

/**
 * The site renders Clipt's real components. These are the modules that talk
 * to Tauri or the native window; each is swapped for an in-browser stand-in.
 */
const SWAPS: Record<string, string> = {
  [app("lib/ipc.ts")]: site("shims/ipc.ts"),
  [app("lib/settings.ts")]: site("shims/settings.ts"),
  [app("lib/permissions.ts")]: site("shims/permissions.ts"),
  [app("lib/pictures.ts")]: site("shims/pictures.ts"),
  [app("components/ui/overlays.tsx")]: site("shims/overlays.tsx"),
};

function swap(): Plugin {
  return {
    name: "clipt-swap",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || !source.startsWith(".")) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      const to = resolved && SWAPS[resolved.id];
      // A stand-in may wrap the module it replaces.
      return to && to !== importer ? to : null;
    },
  };
}

export default defineConfig({
  plugins: [swap(), react(), tailwindcss()],
  resolve: {
    alias: { "@tauri-apps/api/core": site("shims/tauri-core.ts") },
    // The app's components live outside this package; resolve their imports here.
    dedupe: ["react", "react-dom", "motion", "@hugeicons/react", "@hugeicons/core-free-icons"],
  },
  server: { fs: { allow: [".."] } },
});
