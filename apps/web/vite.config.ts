import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// In Docker the page is opened through Caddy at https://motus.local, so hot reload has to
// connect back through port 443 (VITE_HMR_HOST is set in docker-compose.dev.yml).
const hmrHost = process.env.VITE_HMR_HOST;

export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: ["motus.local", "localhost"],
    // Polling notices edits that replace the file (editors, sed -i), which file events in a container can miss.
    watch: process.env.WATCH_POLL ? { usePolling: true, interval: 300 } : undefined,
    hmr: hmrHost ? { host: hmrHost, protocol: "wss", clientPort: 443 } : undefined,
    proxy: { "/api": process.env.API_URL ?? "http://localhost:8080", "/exercise-images": process.env.API_URL ?? "http://localhost:8080" },
  },
});
