import { defineConfig } from "vite";

export default defineConfig({
  // Cloudflare Pages serves the project at the site root.
  base: "/",
  build: {
    outDir: "dist",
    // The live site is public; omit maps so this private repo's sources stay private.
    sourcemap: false,
  },
});
