import { createPinia } from "pinia";
import { createApp } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";

import App from "./App.vue";
import { createFirebaseCommandGateway } from "./firebase/client";
import { i18n } from "./i18n";
import { BrowserOutboxSync } from "./sync/outbox-sync";
import LandingView from "./views/LandingView.vue";
import InterviewView from "./views/InterviewView.vue";
import SummaryView from "./views/SummaryView.vue";
import "./styles/tokens.css";
import "./styles.css";
import "./styles/brand-assets.css";

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      name: "landing",
      component: LandingView,
    },
    {
      path: "/session/:sessionId",
      name: "interview",
      component: InterviewView,
    },
    {
      path: "/session/:sessionId/summary",
      name: "summary",
      component: SummaryView,
    },
  ],
});

createApp(App).use(createPinia()).use(router).use(i18n).mount("#app");

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register(
          `${import.meta.env.BASE_URL}service-worker.js`,
          { scope: import.meta.env.BASE_URL },
        );
        const readyRegistration = await navigator.serviceWorker.ready;

        const appBase = new URL(import.meta.env.BASE_URL, window.location.origin);
        const resourceUrls = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((value) => {
            try {
              const url = new URL(value);
              return url.origin === appBase.origin && url.pathname.startsWith(appBase.pathname);
            } catch {
              return false;
            }
          });

        readyRegistration.active?.postMessage({
          type: "CACHE_URLS",
          urls: [...new Set(resourceUrls)],
        });

        void registration.update();
      } catch (error) {
        console.info("Offline app shell could not be registered.", error);
      }
    })();
  });
}

try {
  const gateway = createFirebaseCommandGateway();
  const outboxSync = new BrowserOutboxSync(gateway);
  outboxSync.start();
} catch (error) {
  console.info(
    "Firebase synchronization is not configured for this build; local-first interview capture remains available.",
    error,
  );
}
