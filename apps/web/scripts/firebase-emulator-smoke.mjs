import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  setDoc,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const PROJECT_ID = "demo-zetema";
const FUNCTIONS_REGION = "europe-west4";

function createClient(name) {
  const app = initializeApp(
    {
      apiKey: "demo-api-key",
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
      appId: `1:000000000000:web:${name}`,
    },
    name,
  );

  const auth = getAuth(app);
  const firestore = getFirestore(app);
  const functions = getFunctions(app, FUNCTIONS_REGION);

  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);

  return { app, auth, firestore, functions };
}

async function expectFirebaseError(action, expectedCode) {
  let caught;
  try {
    await action();
  } catch (error) {
    caught = error;
  }

  assert.ok(caught, `Expected Firebase error '${expectedCode}', but the action succeeded.`);
  assert.equal(caught.code, expectedCode);
}

const owner = createClient("owner");
const other = createClient("other");

try {
  const ownerCredential = await signInAnonymously(owner.auth);
  await signInAnonymously(other.auth);

  const sessionId = `smoke-${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const startOperationId = `start-${randomUUID()}`;
  const appendOperationId = `append-${randomUUID()}`;
  const revisionId = `revision-${randomUUID()}`;
  const finalizeOperationId = `finalize-${randomUUID()}`;

  const sessionRef = doc(owner.firestore, "interviewSessions", sessionId);

  await expectFirebaseError(
    () => setDoc(sessionRef, { ownerUid: ownerCredential.user.uid }),
    "permission-denied",
  );

  const startInterviewSession = httpsCallable(
    owner.functions,
    "startInterviewSession",
  );
  const appendResponseRevision = httpsCallable(
    owner.functions,
    "appendResponseRevision",
  );
  const finalizeInterviewSession = httpsCallable(
    owner.functions,
    "finalizeInterviewSession",
  );

  const startCommand = {
    sessionId,
    operationId: startOperationId,
    contentReleaseId: "mvp-0.1.nature-of-god.v1",
    startedAt,
  };

  const startResult = (await startInterviewSession(startCommand)).data;
  assert.deepEqual(startResult, {
    sessionId,
    status: "in_progress",
    sessionVersion: 1,
    idempotentReplay: false,
  });

  const startReplay = (await startInterviewSession(startCommand)).data;
  assert.equal(startReplay.idempotentReplay, true);
  assert.equal(startReplay.sessionVersion, 1);

  const storedSession = await getDoc(sessionRef);
  assert.equal(storedSession.exists(), true);
  assert.equal(storedSession.data().ownerUid, ownerCredential.user.uid);
  assert.equal(storedSession.data().status, "in_progress");

  const appendCommand = {
    sessionId,
    operationId: appendOperationId,
    revisionId,
    questionId: "god-exists",
    answer: { kind: "yes_no", value: "yes" },
    clientCreatedAt: new Date().toISOString(),
  };

  const appendResult = (await appendResponseRevision(appendCommand)).data;
  assert.equal(appendResult.serverSequence, 1);
  assert.equal(appendResult.sessionVersion, 2);
  assert.equal(appendResult.idempotentReplay, false);

  const appendReplay = (await appendResponseRevision(appendCommand)).data;
  assert.equal(appendReplay.serverSequence, 1);
  assert.equal(appendReplay.idempotentReplay, true);

  const operationRef = doc(
    owner.firestore,
    "interviewSessions",
    sessionId,
    "operations",
    appendOperationId,
  );
  await expectFirebaseError(() => getDoc(operationRef), "permission-denied");

  const otherSessionRef = doc(other.firestore, "interviewSessions", sessionId);
  await expectFirebaseError(() => getDoc(otherSessionRef), "permission-denied");

  const appendAsOtherUser = httpsCallable(
    other.functions,
    "appendResponseRevision",
  );
  await expectFirebaseError(
    () =>
      appendAsOtherUser({
        ...appendCommand,
        operationId: `append-other-${randomUUID()}`,
        revisionId: `revision-other-${randomUUID()}`,
      }),
    "functions/permission-denied",
  );

  const finalizeResult = (
    await finalizeInterviewSession({
      sessionId,
      operationId: finalizeOperationId,
      mode: "complete",
      completedAt: new Date().toISOString(),
    })
  ).data;
  assert.equal(finalizeResult.status, "completed");
  assert.equal(finalizeResult.sessionVersion, 3);
  assert.equal(finalizeResult.idempotentReplay, false);

  await expectFirebaseError(
    () =>
      appendResponseRevision({
        ...appendCommand,
        operationId: `append-after-finalize-${randomUUID()}`,
        revisionId: `revision-after-finalize-${randomUUID()}`,
      }),
    "functions/failed-precondition",
  );

  console.log("Firebase emulator smoke test passed.");
} finally {
  await Promise.all([deleteApp(owner.app), deleteApp(other.app)]);
}
