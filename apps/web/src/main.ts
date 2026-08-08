import { createPinia } from "pinia";
import { createApp } from "vue";
import { createI18n } from "vue-i18n";
import { createRouter, createWebHashHistory } from "vue-router";
import YAML from "yaml";

import App from "./App.vue";
import { createFirebaseCommandGateway } from "./firebase/client";
import enSource from "./i18n/en.yaml?raw";
import { BrowserOutboxSync } from "./sync/outbox-sync";
import LandingView from "./views/LandingView.vue";
import InterviewView from "./views/InterviewView.vue";
import SummaryView from "./views/SummaryView.vue";
import "./styles.css";

const messages = YAML.parse(enSource);

const i18n = createI18n({
  legacy: false,
  locale: "en",
  fallbackLocale: "en",
  messages: {
    en: messages,
  },
});

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
