/**
 * Represents an error that occurred during serialization or deserialization.
 */
export class SerializerError extends Error {
  /**
   * Constructs an instance of SerializerError.
   * @param message The error message.
   * @param cause (Optional) The underlying error or reason for this error, if any.
   */
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SerializerError';
  }
}
