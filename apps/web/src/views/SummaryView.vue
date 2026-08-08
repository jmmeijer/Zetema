<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";

import { useInterviewStore } from "../stores/interview";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const interview = useInterviewStore();
const showReview = ref(false);
const sessionId = String(route.params.sessionId);

onMounted(async () => {
  try {
    await interview.loadSession(sessionId);
    if (!interview.flowComplete && !interview.finished) {
      await router.replace({ name: "interview", params: { sessionId } });
    }
  } catch {
    // The store exposes a user-facing error message.
  }
});

async function edit(questionId: string): Promise<void> {
  await router.push({
    name: "interview",
    params: { sessionId },
    query: { edit: questionId },
  });
}

async function finish(): Promise<void> {
  try {
    await interview.finishSession();
  } catch {
    // The store exposes a user-facing error message.
  }
}
</script>

<template>
  <main class="page summary-page">
    <header class="app-header">
      <RouterLink class="brand-inline" to="/" aria-label="Zetema home">
        <span class="brand-mark-small" aria-hidden="true">○</span>
        <span>{{ t("brand.name") }}</span>
      </RouterLink>
      <span class="language-chip">◎ EN</span>
    </header>

    <section class="content-shell summary-shell">
      <div class="theme-progress">
        <div class="theme-progress-labels">
          <span>{{ interview.release.theme.title.source }}</span>
          <span class="muted">100%</span>
        </div>
        <div class="progress-track">
          <span class="progress-value" style="width: 100%" />
        </div>
      </div>

      <section v-if="interview.finished" class="completion-card">
        <div class="completion-icon" aria-hidden="true">✓</div>
        <h1>{{ t("summary.completedTitle") }}</h1>
        <p class="lead">{{ t("summary.completedBody") }}</p>
        <RouterLink class="button button-primary button-large" to="/">Return home</RouterLink>
      </section>

      <section v-else class="summary-content">
        <h1>{{ t("summary.title") }}</h1>

        <div class="summary-prose">
          <p v-for="paragraph in interview.summaryParagraphs" :key="paragraph">
            {{ paragraph }}
          </p>
        </div>

        <div class="summary-note">
          <span aria-hidden="true">✎</span>
          <p>You can review or change your answers before finishing.</p>
        </div>

        <button class="button button-secondary button-large" type="button" @click="showReview = !showReview">
          {{ t("summary.review") }} <span aria-hidden="true">→</span>
        </button>

        <section v-if="showReview" class="review-panel">
          <h2>{{ t("summary.reviewHeading") }}</h2>
          <div v-for="item in interview.reviewItems" :key="item.questionId" class="review-row">
            <div>
              <p class="review-question">{{ item.prompt }}</p>
              <p class="review-answer">{{ item.answer }}</p>
            </div>
            <button class="text-button" type="button" @click="edit(item.questionId)">
              {{ t("summary.change") }}
            </button>
          </div>
        </section>

        <button
          class="button button-primary button-large"
          type="button"
          :disabled="interview.busy"
          @click="finish"
        >
          {{ t("summary.finish") }} <span aria-hidden="true">→</span>
        </button>

        <p v-if="interview.errorMessage" class="error-message" role="alert">
          {{ interview.errorMessage }}
        </p>

        <footer class="summary-meta">
          <span>ⓘ {{ t("summary.basedOnResponses") }}</span>
          <span>~{{ interview.answeredCount }} {{ t("summary.questionsAnswered") }}</span>
        </footer>
      </section>
    </section>
  </main>
</template>
