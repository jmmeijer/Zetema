# Zetema

**Zetema** is an adaptive theological dialogue and belief-exploration tool inspired by Socratic questioning and street epistemology.

The application is designed to begin with a common set of baseline questions, then use structured clarification and adaptive follow-up questions to explore what a respondent means by concepts such as omniscience, omnipotence, free will, biblical authority, salvation, morality, and the problem of evil.

The goal is not to treat labels as complete beliefs or to declare contradictions prematurely. Zetema first clarifies definitions, preserves the respondent's explicit answers as authoritative participant data, and treats derived implications or possible tensions as system interpretations that can be presented back for clarification.

## Project status

Zetema is currently in **implementation preparation for MVP-0.1**.

MVP-0.1 is a synthetic-data technical walking skeleton. It is intended to validate the architecture before the application is used with real respondents.

Initial scope includes:

- one study and one immutable content release;
- one theological theme;
- approximately 10–15 synthetic questions;
- English as the canonical content language;
- at least one additional translation;
- baseline and one-level adaptive branching;
- local-first interview capture;
- durable IndexedDB storage and an explicit outbox;
- ordered, idempotent synchronization through Cloud Functions;
- incomplete-interview recovery;
- deterministic question/reasoning logic;
- Firebase Local Emulator Suite integration;
- automated validation and tests.

Real-participant collection, email linking, research exports, advanced reasoning, open-ended LLM interpretation, and administrative tooling are outside MVP-0.1.

## Planned stack

- **Vue 3**
- **Vite**
- **TypeScript**
- **Pinia**
- **Vue Router**
- **Vue I18n**
- **IndexedDB** for durable local interview/outbox state
- **Service Worker** for best-effort synchronization and recovery
- **Firebase Authentication**
- **Cloud Firestore**
- **Cloud Functions**
- **Firebase App Check**
- **Firebase Local Emulator Suite**
- **GitHub Actions**
- **pnpm workspaces**

## Architecture principles

### Local-first capture

During an active interview, the interviewing device is authoritative for the respondent's current answer state. Mutations are persisted to IndexedDB first and represented as idempotent outbox commands. Server synchronization may be delayed when connectivity is poor.

### Server-side command gateway

Authoritative server mutations are performed through Cloud Function commands. The browser is treated as untrusted and does not directly write authoritative interview, response, consent, identity-linking, or research records to Firestore.

### Clarify before infer

Broad theological labels are not assumed to have one fixed meaning. Zetema asks definition and clarification questions before using a proposition as a premise for stronger reasoning.

Potential contradictions are initially treated as hypotheses requiring clarification rather than as verdicts.

### Research-aware branching

A common baseline provides a comparable core. Adaptive deepening questions may differ between respondents. Question eligibility, exposure, and non-exposure reasons are preserved so structural non-presentation is not mistaken for missing data.

## Content and localization

Interview structure uses stable machine identifiers while keeping **canonical English text directly in the structure files** for practical authoring and review.

Additional languages are stored as translation overrides keyed by the stable content IDs.

Conceptually:

```text
content/studies/<study>/
├── questions.yaml          # structure + canonical English
├── propositions.yaml
├── rules.yaml
└── locales/
    ├── nl/
    └── ro/
```

Application UI translations are separate from interview-content translations. UI strings belong to the application version; interview translations belong to an immutable content release.

## Planned repository structure

```text
apps/
  web/                    Vue application / PWA
  functions/              Firebase Cloud Functions

packages/
  domain/                 Framework-independent domain model
  content-schema/         Content schemas and validation
  question-engine/        Eligibility and branching
  reasoning-engine/       Deterministic reasoning
  sync-engine/            IndexedDB/outbox/recovery
  shared-types/

content/
  studies/

firebase/
  firestore.rules
  firestore.indexes.json

docs/
  architecture/
  adr/

tests/
  integration/
  emulator/
  fixtures/
```

The concrete structure will be introduced incrementally as MVP-0.1 is scaffolded.

## Security and privacy

Zetema is intended to process religious or philosophical belief data, which can be sensitive and may constitute special-category personal data when used with real respondents.

**The current MVP-0.1 must use synthetic data only.** Production collection is not enabled merely by completing the technical walking skeleton. Privacy, consent, retention, deployment, security, and release gates must be satisfied separately before any controlled real-participant pilot.

Secrets, Firebase service-account credentials, raw participant data, emulator exports containing real data, and local environment files must never be committed to this repository.

## Development

Development commands will be added when the pnpm workspace and application packages are scaffolded.

Planned quality gates include:

- TypeScript type checking;
- linting;
- unit tests;
- content/schema validation;
- deterministic reasoning tests;
- Firebase emulator integration tests;
- production build verification.

## Name

*Zetema* is derived from the Greek **zētēma**: a question or matter for inquiry.
