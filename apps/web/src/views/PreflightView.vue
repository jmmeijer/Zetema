<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";

import zetemaLogoSymbol from "../assets/brand/zetema-logo-organic";
import LanguageSelector from "../components/LanguageSelector.vue";
import {
  createParticipantPreflightEvidence,
  PARTICIPANT_NOTICE_VERSION,
} from "../privacy/participant-consent";
import { participantNoticeText } from "../privacy/notices/2026.08.1";
import { useInterviewStore } from "../stores/interview";

type Step = "age" | "notice" | "ineligible" | "declined";

const router = useRouter();
const interview = useInterviewStore();
const step = ref<Step>("age");
const ageConfirmedAt = ref<string | null>(null);
const approval = ref(false);
const startError = ref<string | null>(null);
const text = participantNoticeText;

function confirmAge(): void {
  ageConfirmedAt.value = new Date().toISOString();
  approval.value = false;
  startError.value = null;
  step.value = "notice";
}

function notEligible(): void {
  ageConfirmedAt.value = null;
  approval.value = false;
  startError.value = null;
  step.value = "ineligible";
}

function decline(): void {
  ageConfirmedAt.value = null;
  approval.value = false;
  startError.value = null;
  step.value = "declined";
}

function back(): void {
  ageConfirmedAt.value = null;
  approval.value = false;
  startError.value = null;
  step.value = "age";
}

async function home(): Promise<void> {
  await router.push({ name: "landing" });
}

async function start(): Promise<void> {
  if (ageConfirmedAt.value === null || !approval.value) {
    return;
  }

  startError.value = null;
  try {
    const sessionId = await interview.startSession(
      createParticipantPreflightEvidence(
        ageConfirmedAt.value,
        new Date().toISOString(),
      ),
    );
    await router.push({ name: "interview", params: { sessionId } });
  } catch (error) {
    startError.value = error instanceof Error ? error.message : String(error);
  }
}
</script>

<template>
  <main class="page preflight-page">
    <header class="app-header">
      <button class="brand-inline preflight-home" type="button" @click="home">
        <img class="brand-symbol brand-symbol-small" :src="zetemaLogoSymbol" alt="" aria-hidden="true" />
        <span>Zetema</span>
      </button>
      <LanguageSelector />
    </header>

    <section class="content-shell preflight-shell">
      <div class="preflight-card">
        <p class="eyebrow">{{ text("eyebrow") }}</p>

        <template v-if="step === 'age'">
          <h1>{{ text("ageTitle") }}</h1>
          <p class="lead">{{ text("ageBody") }}</p>
          <div class="preflight-actions">
            <button class="button button-primary button-large" type="button" @click="confirmAge">{{ text("ageYes") }}</button>
            <button class="button button-secondary button-large" type="button" @click="notEligible">{{ text("ageNo") }}</button>
          </div>
        </template>

        <template v-else-if="step === 'notice'">
          <h1>{{ text("consentTitle") }}</h1>
          <p class="lead">{{ text("consentIntro") }}</p>

          <div class="preflight-details">
            <section v-for="item in ['sensitive', 'data', 'purpose', 'storage', 'retention', 'choice']" :key="item" class="preflight-detail">
              <h2>{{ text(`${item}Title`) }}</h2>
              <p>{{ text(`${item}Body`) }}</p>
            </section>
          </div>

          <label class="preflight-consent">
            <input v-model="approval" type="checkbox" />
            <span>{{ text("consentLabel") }}</span>
          </label>
          <p class="preflight-version">{{ text("noticeVersion", { version: PARTICIPANT_NOTICE_VERSION }) }}</p>
          <p v-if="startError" class="error-message" role="alert">{{ startError }}</p>

          <div class="preflight-actions">
            <button class="button button-primary button-large" type="button" :disabled="!approval || interview.busy" @click="start">{{ text("consentStart") }}</button>
            <button class="button button-secondary button-large" type="button" :disabled="interview.busy" @click="decline">{{ text("decline") }}</button>
            <button class="text-button preflight-back" type="button" :disabled="interview.busy" @click="back">← {{ text("back") }}</button>
          </div>
        </template>

        <template v-else-if="step === 'ineligible'">
          <h1>{{ text("ineligibleTitle") }}</h1>
          <p class="lead">{{ text("ineligibleBody") }}</p>
          <div class="preflight-actions">
            <button class="button button-primary button-large" type="button" @click="home">{{ text("returnHome") }}</button>
          </div>
        </template>

        <template v-else>
          <h1>{{ text("declinedTitle") }}</h1>
          <p class="lead">{{ text("declinedBody") }}</p>
          <div class="preflight-actions">
            <button class="button button-primary button-large" type="button" @click="home">{{ text("returnHome") }}</button>
          </div>
        </template>
      </div>
    </section>
  </main>
</template>
