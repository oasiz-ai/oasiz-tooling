import { defineConfig } from "vite";

export default defineConfig({
  base: "/developers/",
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_OASIZ_API_PROXY ?? "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: true,
  },
});
