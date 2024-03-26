/**
 * The base error class for idempotent operations.
 */
export class IdempotentExecutorErrorBase extends Error {
  /**
   * Constructs an instance of IdempotentExecutorErrorBase.
   * @param message The error message describing what went wrong.
   * @param idempotencyKey The unique key used to identify and enforce idempotency for an operation.
   * @param cause (Optional) The underlying error or reason for this error, if any.
   */
  constructor(
    message: string,
    public readonly idempotencyKey: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'IdempotentExecutorErrorBase';
  }
}

/**
 * Represents a critical error related to idempotent operations, potentially leading to non-idempotent executions.
 */
export class IdempotentExecutorCriticalError extends IdempotentExecutorErrorBase {
  /**
   * Constructs an instance of IdempotentExecutorCriticalError.
   * This error class should be used for critical issues that might lead to non-idempotent executions.
   * @param message The error message describing the critical issue.
   * @param idempotencyKey The unique key used to identify and enforce idempotency for an operation.
   * @param cause (Optional) The underlying error or reason for this critical error, if any.
   */
  constructor(message: string, idempotencyKey: string, cause?: unknown) {
    super(
      `Possibly non-idempotent execution: ${message}`,
      idempotencyKey,
      cause,
    );
    this.name = 'IdempotentExecutorCriticalError';
  }
}

/**
 * Represents an error related to serialization issues during idempotent operations.
 */
export class IdempotentExecutorSerializationError extends IdempotentExecutorErrorBase {
  /**
   * Constructs an instance of IdempotentExecutorSerializationError.
   * This error class should be used for issues related to serialization during idempotent operations.
   * @param message The error message describing the serialization issue.
   * @param idempotencyKey The unique key used to identify and enforce idempotency for an operation.
   * @param cause (Optional) The underlying error or reason for this serialization error, if any.
   */
  constructor(message: string, idempotencyKey: string, cause?: unknown) {
    super(message, idempotencyKey, cause);
    this.name = 'IdempotentExecutorSerializationError';
  }
}

/**
 * Represents an error related to cache issues during idempotent operations.
 */
export class IdempotentExecutorCacheError extends IdempotentExecutorErrorBase {
  /**
   * Constructs an instance of IdempotentExecutorCacheError.
   * This error class should be used for issues related to caching during idempotent operations.
   * @param message The error message describing the cache issue.
   * @param idempotencyKey The unique key used to identify and enforce idempotency for an operation.
   * @param cause (Optional) The underlying error or reason for this cache error, if any.
   */
  constructor(message: string, idempotencyKey: string, cause?: unknown) {
    super(message, idempotencyKey, cause);
    this.name = 'IdempotentExecutorCacheError';
  }
}

/**
 * Represents an error related to callback issues during idempotent operations.
 */
export class IdempotentExecutorCallbackError extends IdempotentExecutorErrorBase {
  /**
   * Constructs an instance of IdempotentExecutorCallbackError.
   * This error class should be used for issues related to executing user-provided
   * callback functions during idempotent operations.
   * @param message The error message describing the callback issue.
   * @param idempotencyKey The unique key used to identify and enforce idempotency for an operation.
   * @param cause (Optional) The underlying error or reason for this callback error, if any.
   */
  constructor(
    message: string,
    idempotencyKey: string,
    public readonly callback:
      | 'onActionSuccess'
      | 'onActionError'
      | 'onSuccessReplay'
      | 'onErrorReplay',
    cause?: unknown,
  ) {
    super(message, idempotencyKey, cause);
    this.name = 'IdempotentExecutorCallbackError';
  }
}

/**
 * Represents a wrapper around non-error objects thrown by the action function.
 */
export class IdempotentExecutorNonErrorWrapperError extends IdempotentExecutorErrorBase {
  constructor(message: string, idempotencyKey: string, cause?: unknown) {
    super(message, idempotencyKey, cause);
    this.name = 'IdempotentExecutorNonErrorWrapperError';
  }
}

/**
 * Represents an error related to executor issues during idempotent operations.
 */
export class IdempotentExecutorUnknownError extends IdempotentExecutorErrorBase {
  /**
   * Constructs an instance of IdempotentExecutorUnknownError.
   * This error class should be used for unknown issues during idempotent operations.
   * @param message The error message describing the unknown issue.
   * @param idempotencyKey The unique key used to identify and enforce idempotency for an operation.
   * @param cause (Optional) The underlying error or reason for this unknown error, if any.
   */
  constructor(message: string, idempotencyKey: string, cause?: unknown) {
    super(message, idempotencyKey, cause);
    this.name = 'IdempotentExecutorUnknownError';
  }
}
