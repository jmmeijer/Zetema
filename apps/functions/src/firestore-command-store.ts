import type { Firestore, Transaction } from "firebase-admin/firestore";

import type { SessionId, OperationId, ResponseRevisionId } from "@zetema/domain";
import type {
  CommandStore,
  CommandTransaction,
  StoredConsentEvent,
  StoredEligibilityEvent,
  StoredOperation,
  StoredRevision,
  StoredSession,
} from "./command-service.js";

const SESSIONS_COLLECTION = "interviewSessions";

class FirestoreCommandTransaction implements CommandTransaction {
  constructor(
    private readonly database: Firestore,
    private readonly transaction: Transaction,
  ) {}

  async getSession(sessionId: SessionId): Promise<StoredSession | undefined> {
    const snapshot = await this.transaction.get(
      this.database.collection(SESSIONS_COLLECTION).doc(sessionId),
    );
    return snapshot.exists ? (snapshot.data() as StoredSession) : undefined;
  }

  async getOperation(
    sessionId: SessionId,
    operationId: OperationId,
  ): Promise<StoredOperation | undefined> {
    const snapshot = await this.transaction.get(
      this.database
        .collection(SESSIONS_COLLECTION)
        .doc(sessionId)
        .collection("operations")
        .doc(operationId),
    );
    return snapshot.exists ? (snapshot.data() as StoredOperation) : undefined;
  }

  async getRevision(
    sessionId: SessionId,
    revisionId: ResponseRevisionId,
  ): Promise<StoredRevision | undefined> {
    const snapshot = await this.transaction.get(
      this.database
        .collection(SESSIONS_COLLECTION)
        .doc(sessionId)
        .collection("responseRevisions")
        .doc(revisionId),
    );
    return snapshot.exists ? (snapshot.data() as StoredRevision) : undefined;
  }

  async putSession(session: StoredSession): Promise<void> {
    this.transaction.set(
      this.database.collection(SESSIONS_COLLECTION).doc(session.sessionId),
      session,
    );
  }

  async putOperation(sessionId: SessionId, operation: StoredOperation): Promise<void> {
    this.transaction.set(
      this.database
        .collection(SESSIONS_COLLECTION)
        .doc(sessionId)
        .collection("operations")
        .doc(operation.operationId),
      operation,
    );
  }

  async putRevision(revision: StoredRevision): Promise<void> {
    this.transaction.set(
      this.database
        .collection(SESSIONS_COLLECTION)
        .doc(revision.sessionId)
        .collection("responseRevisions")
        .doc(revision.revisionId),
      revision,
    );
  }

  async putEligibilityEvent(
    sessionId: SessionId,
    event: StoredEligibilityEvent,
  ): Promise<void> {
    this.transaction.set(
      this.database
        .collection(SESSIONS_COLLECTION)
        .doc(sessionId)
        .collection("eligibilityEvents")
        .doc(event.eventId),
      event,
    );
  }

  async putConsentEvent(sessionId: SessionId, event: StoredConsentEvent): Promise<void> {
    this.transaction.set(
      this.database
        .collection(SESSIONS_COLLECTION)
        .doc(sessionId)
        .collection("participationEvents")
        .doc(event.eventId),
      event,
    );
  }
}

export class FirestoreCommandStore implements CommandStore {
  constructor(private readonly database: Firestore) {}

  transact<T>(work: (transaction: CommandTransaction) => Promise<T>): Promise<T> {
    return this.database.runTransaction((transaction) =>
      work(new FirestoreCommandTransaction(this.database, transaction)),
    );
  }
}
