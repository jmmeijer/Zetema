# MVP-0.1 development deployment

This runbook deploys the synthetic-only MVP-0.1 walking skeleton. Do not use real participant or belief data in this environment.

## Firebase project

Development project: `zetema-4853d`.

The development Firestore database and Cloud Functions are co-located in `europe-west4` (Netherlands).

Before deployed browser synchronization is enabled:

1. Upgrade the Firebase project to a plan that permits Cloud Functions deployment.
2. Enable **Authentication > Sign-in method > Anonymous**.
3. Create the default Cloud Firestore database in the intended region.
4. Register the web app with Firebase App Check using the reCAPTCHA v3 provider. Keep App Check enforcement disabled until valid requests have been observed during the development smoke test.
5. Add the public reCAPTCHA v3 site key to the GitHub repository secret `VITE_FIREBASE_APPCHECK_SITE_KEY`. The corresponding reCAPTCHA secret key stays in Firebase/Google configuration and must not be committed or exposed to the browser.
6. Deploy Cloud Functions and Firestore rules from the repository root with the Firebase CLI using the `dev` alias or explicit `--project zetema-4853d`.

The reCAPTCHA v3 site key is browser-visible and is not a server credential. It is nevertheless injected at build time so deployment-specific configuration stays out of application source.

Never store the reCAPTCHA secret key, service-account JSON, private keys, App Check debug tokens, or Firebase Admin credentials in the repository.

## Firebase backend

The repository root contains `firebase.json` and `.firebaserc`. The Functions deployment source is `apps/functions/deploy`, a standalone artifact prepared by the predeploy hooks:

```text
pnpm --dir apps/functions run build
node apps/functions/scripts/prepare-deploy.mjs
```

Then deploy the authoritative gateway and Firestore controls:

```text
firebase deploy --project zetema-4853d --only functions,firestore:rules,firestore:indexes
```

The callable Functions are explicitly deployed to `europe-west4`, and the browser Functions client targets the same region.

The deployed package intentionally excludes the monorepo `workspace:*` development dependencies. Type-only domain/shared contracts are erased during TypeScript compilation; the deployment manifest contains only Firebase runtime dependencies.

## GitHub Pages

The `Deploy GitHub Pages` workflow builds `apps/web` with the project-site base path `/Zetema/` and deploys `apps/web/dist` using GitHub Pages Actions.

Repository settings required once:

1. In **Settings > Pages**, select **GitHub Actions** as the source.
2. Add `VITE_FIREBASE_APPCHECK_SITE_KEY` under **Settings > Secrets and variables > Actions > Secrets** when available.
3. Merge the deployment workflow to `main` or run it manually with `workflow_dispatch`.

Until the App Check site key is configured, the static UI can still load and use local IndexedDB capture, but deployed Firebase synchronization remains disabled by the client bootstrap.

## Synthetic-only acceptance check

After backend and Pages deployment:

1. Open the GitHub Pages site in a clean browser profile.
2. Start a synthetic interview; verify a Firebase anonymous user is created.
3. Answer several questions and reload the page; verify the local session resumes.
4. Verify the server has one session record and ordered append-only response revisions.
5. Retry/reload and confirm idempotent commands do not duplicate revisions.
6. Complete the interview and confirm finalization reaches the server.
7. Verify direct browser writes to authoritative Firestore records remain denied.
8. Confirm valid App Check requests are visible before enabling App Check enforcement for the deployed gateway.

This is a development smoke test only and does not authorize real-user processing.
