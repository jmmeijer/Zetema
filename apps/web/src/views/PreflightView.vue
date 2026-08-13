<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import LanguageSelector from "../components/LanguageSelector.vue";
import { participantNoticeText } from "../privacy/notices/2026.08.1";

const router = useRouter();
const phase = ref<"first" | "second">("first");
const text = participantNoticeText;
</script>

<template>
  <main class="page preflight-page">
    <LanguageSelector />
    <section class="content-shell preflight-shell">
      <h1>{{ phase === 'first' ? text('ageTitle') : text('consentTitle') }}</h1>
      <button type="button" @click="phase = 'second'">{{ text('ageYes') }}</button>
      <button type="button" @click="router.push({ name: 'landing' })">{{ text('returnHome') }}</button>
    </section>
  </main>
</template>
