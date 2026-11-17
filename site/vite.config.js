import { defineConfig } from "vite";

// En local, el sitio habla con la API y el worker de docker compose a través de
// este proxy: el navegador ve todo en el mismo origen (localhost:5173), así que
// no hace falta configurar CORS en la API.
//
//   /api/...    -> http://localhost:3200/...   (API de pedidos)
//   /worker/... -> http://localhost:3201/...   (health y métricas del worker)
const proxy = {
  "/api": {
    target: process.env.EVENTFLOW_API ?? "http://localhost:3200",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, ""),
  },
  "/worker": {
    target: process.env.EVENTFLOW_WORKER ?? "http://localhost:3201",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/worker/, ""),
  },
};

export default defineConfig({
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
});
