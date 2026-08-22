import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  // Dependensi di bawah ini hanya terjangkau dari route chunk (autoCodeSplitting),
  // jadi Vite baru menemukannya saat navigasi pertama lalu re-optimize deps dan
  // mengganti hash `?v=`. Dynamic import yang sedang berjalan jadi gagal
  // ("Failed to fetch dynamically imported module"). Pre-bundle sejak awal.
  optimizeDeps: {
    include: [
      "@dnd-kit/core",
      "@dnd-kit/sortable",
      "@dnd-kit/utilities",
      "@hookform/resolvers/zod",
      "@radix-ui/react-alert-dialog",
      "@radix-ui/react-slot",
      "@radix-ui/react-tooltip",
      "@tanstack/react-query",
      "@tanstack/react-table",
      "@tanstack/react-virtual",
      "lucide-react",
      "pdfjs-dist",
      "react-dropzone",
      "react-hook-form",
      "zod",
      "zustand",
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
    css: true,
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
