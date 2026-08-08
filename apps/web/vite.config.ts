import vue from "@vitejs/plugin-vue";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");

  return {
    base: environment.VITE_BASE_PATH || "/",
    plugins: [vue()],
  };
});
