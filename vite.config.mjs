import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// https://vitejs.dev/config/
export default defineConfig({
  // This changes the out put dir from dist to build
  // comment this out if that isn't relevant for your project
  build: {
    outDir: "build",
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Split the heaviest vendor libs out of the single ~14MB bundle. Smaller
        // chunks keep the minify + sourcemap step from spiking past Netlify's
        // 4GB build heap (which was OOMing the whole build).
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          const after = id.split("node_modules/")[1] || "";
          const pkg = after.startsWith("@")
            ? after.split("/").slice(0, 2).join("/")
            : after.split("/")[0];
          // Only split self-contained, React-FREE libraries. Splitting React
          // (or libraries that read React at module-init, e.g. recharts /
          // framer-motion) into separate chunks breaks load order and throws
          // "Cannot read properties of undefined (reading 'forwardRef')".
          if (pkg === "three" || pkg === "@sparkjsdev/spark") return "v3d";
          if (pkg === "pdfjs-dist") return "vpdf";
          if (pkg === "html2canvas") return "vhtml2canvas";
          if (pkg === "jspdf" || pkg === "jspdf-autotable" || pkg === "pdf-lib") return "vjspdf";
          if (pkg === "xlsx" || pkg === "exceljs") return "vsheets";
          return undefined; // react + everything that consumes it stays in place
        },
      },
    },
  },
  plugins: [tsconfigPaths(), react()],
  server: {
    port: "4028",
    host: "0.0.0.0",
    strictPort: true,
    allowedHosts: ['.amazonaws.com']
  }
});