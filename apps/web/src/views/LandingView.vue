<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";

import zetemaLogoSymbol from "../assets/brand/zetema-logo-symbol.png";
import LanguageSelector from "../components/LanguageSelector.vue";
import { useInterviewStore } from "../stores/interview";

const { t } = useI18n();
const router = useRouter();
const interview = useInterviewStore();

const taglineParts = computed(() => {
  const tagline = t("brand.tagline");
  const sentenceBoundary = tagline.indexOf(". ");

  if (sentenceBoundary === -1) {
    return { primary: tagline, emphasis: "" };
  }

  return {
    primary: tagline.slice(0, sentenceBoundary + 1),
    emphasis: tagline.slice(sentenceBoundary + 2),
  };
});

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
    <LanguageSelector class="landing-language" />

    <section class="landing-card">
      <div class="brand-lockup">
        <img class="brand-symbol brand-symbol-large" :src="zetemaLogoSymbol" alt="" aria-hidden="true" />
        <p class="brand-name">{{ t("brand.name") }}</p>
      </div>

      <h1 class="landing-tagline">
        <span>{{ taglineParts.primary }}</span>
        <em v-if="taglineParts.emphasis">{{ taglineParts.emphasis }}</em>
      </h1>
      <p class="lead">{{ t("landing.intro") }}</p>

      <button class="button button-primary button-large" :disabled="interview.busy" @click="start">
        {{ t("landing.start") }} <span aria-hidden="true">→</span>
      </button>

      <button
        v-if="interview.resumeAvailable"
        class="button button-secondary button-large resume-button"
        :disabled="interview.busy"
        @click="resume"
      >
        <span aria-hidden="true">◷</span>
        {{ t("landing.resume") }}
      </button>

      <p v-if="interview.errorMessage" class="error-message" role="alert">
        {{ interview.errorMessage }}
      </p>
    </section>

    <section class="landing-facts" :aria-label="t('landing.interviewInfo')">
      <div>
        <span class="fact-icon fact-icon-blush" aria-hidden="true">○</span>
        <p>{{ t("landing.noWrong") }}</p>
      </div>
      <div>
        <span class="fact-icon fact-icon-seafoam" aria-hidden="true">↷</span>
        <p>{{ t("landing.canSkip") }}</p>
      </div>
      <div>
        <span class="fact-icon fact-icon-slate" aria-hidden="true">◷</span>
        <p>{{ t("landing.duration") }}</p>
      </div>
    </section>

    <footer class="landing-footer">
      <span class="footer-spacer" />
      <span>{{ t("landing.about") }}</span>
    </footer>
  </main>
</template>
