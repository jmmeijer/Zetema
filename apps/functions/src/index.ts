import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { CommandGatewayError, CommandGatewayService } from "./command-service.js";
import { FirestoreCommandStore } from "./firestore-command-store.js";
import {
  parseAppendResponseRevisionRequest,
  parseFinalizeInterviewSessionRequest,
  parseStartInterviewSessionRequest,
} from "./validation.js";

if (getApps().length === 0) {
  initializeApp();
}

const commandService = new CommandGatewayService(
  new FirestoreCommandStore(getFirestore()),
);

const callableOptions = {
  region: "europe-west4",
  enforceAppCheck: true,
} as const;

function requireAuthenticatedUid(uid: string | undefined): string {
  if (uid === undefined || uid.length === 0) {
    throw new CommandGatewayError(
      "UNAUTHENTICATED",
      "Authentication is required to mutate interview data.",
    );
  }
  return uid;
}

function throwHttpsError(error: unknown): never {
  if (error instanceof HttpsError) {
    throw error;
  }

  if (error instanceof CommandGatewayError) {
    switch (error.code) {
      case "UNAUTHENTICATED":
        throw new HttpsError("unauthenticated", error.message);
      case "INVALID_ARGUMENT":
        throw new HttpsError("invalid-argument", error.message);
      case "SESSION_NOT_FOUND":
        throw new HttpsError("not-found", error.message);
      case "PERMISSION_DENIED":
        throw new HttpsError("permission-denied", error.message);
      case "SESSION_CONFLICT":
      case "SESSION_NOT_ACTIVE":
      case "OPERATION_ID_CONFLICT":
      case "REVISION_ID_CONFLICT":
        throw new HttpsError("failed-precondition", error.message);
    }
  }

  console.error("Unhandled command gateway failure", error);
  throw new HttpsError("internal", "The command could not be applied.");
}

export const startInterviewSession = onCall(callableOptions, async (request) => {
  try {
    const uid = requireAuthenticatedUid(request.auth?.uid);
    const command = parseStartInterviewSessionRequest(request.data);
    return await commandService.startInterviewSession(uid, command);
  } catch (error) {
    return throwHttpsError(error);
  }
});

export const appendResponseRevision = onCall(callableOptions, async (request) => {
  try {
    const uid = requireAuthenticatedUid(request.auth?.uid);
    const command = parseAppendResponseRevisionRequest(request.data);
    return await commandService.appendResponseRevision(uid, command);
  } catch (error) {
    return throwHttpsError(error);
  }
});

export const finalizeInterviewSession = onCall(callableOptions, async (request) => {
  try {
    const uid = requireAuthenticatedUid(request.auth?.uid);
    const command = parseFinalizeInterviewSessionRequest(request.data);
    return await commandService.finalizeInterviewSession(uid, command);
  } catch (error) {
    return throwHttpsError(error);
  }
});
