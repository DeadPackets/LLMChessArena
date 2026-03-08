import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("recharts")) return "charts";
          if (
            id.includes("react-chessboard") ||
            id.includes("chess.js") ||
            id.includes("react-dnd")
          ) {
            return "board";
          }
          if (id.includes("html2canvas")) return "export";
          if (id.includes("react-router")) return "router";
          return "vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
    allowedHosts: ["llmchess.deadpackets.pw", "dev.deadpackets.pw"],
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/ws": {
        target: "http://localhost:8000",
        ws: true,
      },
    },
  },
});
