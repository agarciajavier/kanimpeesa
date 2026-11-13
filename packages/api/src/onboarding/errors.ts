// Impeesa onboarding: how a job ended when it didn't succeed. The queue
// decides what to do from the class of the error (see queue.ts).

// Temporary (network, rate limit, Google or Resend down): try again later.
export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableError";
  }
}

// Will fail again the same way (missing data, renamed field, rejected
// address...): stop and tell Ángel.
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}

// It may or may not have happened (e.g. an email whose sending can't be
// confirmed): never retried on its own, someone has to check first.
export class UncertainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UncertainError";
  }
}

// Messages are shown in the panel and in alert emails: keep them short and
// never include tokens.
export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+\S+/g, "Bearer ***").slice(0, 1000);
}
