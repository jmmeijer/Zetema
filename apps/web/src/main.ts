import { createPinia } from "pinia";
import { createApp } from "vue";
import { createI18n } from "vue-i18n";
import { createRouter, createWebHistory } from "vue-router";
import YAML from "yaml";

import App from "./App.vue";
import enSource from "./i18n/en.yaml?raw";
import LandingView from "./views/LandingView.vue";
import InterviewView from "./views/InterviewView.vue";
import SummaryView from "./views/SummaryView.vue";
import "./styles.css";

const messages = YAML.parse(enSource) as Record<string, unknown>;

const i18n = createI18n({
  legacy: false,
  locale: "en",
  fallbackLocale: "en",
  messages: {
    en: messages,
  },
});

const router = createRouter({
  history: createWebHistory(),
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
