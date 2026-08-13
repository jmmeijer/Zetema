import { createRouter, createWebHashHistory } from "vue-router";

import LandingView from "./views/LandingView.vue";
import PreflightView from "./views/PreflightView.vue";
import InterviewView from "./views/InterviewView.vue";
import SummaryView from "./views/SummaryView.vue";

export const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    { path: "/", name: "landing", component: LandingView },
    { path: "/start", name: "preflight", component: PreflightView },
    { path: "/session/:sessionId", name: "interview", component: InterviewView },
    { path: "/session/:sessionId/summary", name: "summary", component: SummaryView },
  ],
});
