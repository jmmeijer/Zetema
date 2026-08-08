<script setup lang="ts">
import { onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";

import { useInterviewStore } from "../stores/interview";

const { t } = useI18n();
const router = useRouter();
const interview = useInterviewStore();

onMounted(() => interview.checkResume());

async function start(): Promise<void> {
  const sessionId = await interview.startSession();
  await router.push({ name: "interview", params: { sessionId } });
}

async function resume(): Promise<void> {
  const sessionId = await interview.resumeLastSession();
  if (sessionId !== null) {
    await router.push({ name: "interview", params: { sessionId } });
  }
}
</script>

<template>
  <main class="page landing-page">
    <div class="landing-language" aria-label="Language">◎ EN</div>

    <section class="landing-card">
      <div class="brand-mark" aria-hidden="true">○</div>
      <p class="brand-name">{{ t("brand.name") }}</p>
      <h1>{{ t("brand.tagline") }}</h1>
      <p class="lead">{{ t("landing.intro") }}</p>

      <button class="button button-primary button-large" :disabled="interview.busy" @click="start">
        {{ t("landing.start") }} <span aria-hidden="true">→</span>
      </button>

      <button
        v-if="interview.resumeAvailable"
        class="button button-secondary button-large"
        :disabled="interview.busy"
        @click="resume"
      >
        {{ t("landing.resume") }}
      </button>

      <p v-if="interview.errorMessage" class="error-message" role="alert">
        {{ interview.errorMessage }}
      </p>
    </section>

    <section class="landing-facts" aria-label="Interview information">
      <div>
        <span class="fact-icon" aria-hidden="true">○</span>
        <p>{{ t("landing.noWrong") }}</p>
      </div>
      <div>
        <span class="fact-icon" aria-hidden="true">↷</span>
        <p>{{ t("landing.canSkip") }}</p>
      </div>
      <div>
        <span class="fact-icon" aria-hidden="true">◷</span>
        <p>{{ t("landing.duration") }}</p>
      </div>
    </section>

    <footer class="landing-footer">
      <span>EN</span>
      <span class="muted">NL</span>
      <span class="muted">RO</span>
      <span class="footer-spacer" />
      <span>{{ t("landing.about") }}</span>
    </footer>
  </main>
</template>
