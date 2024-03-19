import {
  deserializeError,
  SerializedError,
  serializeError,
} from 'serialize-error-cjs';

/**
 * Interface defining a generic serializer.
 */
export interface Serializer<T> {
  serialize(value: T): string;
  deserialize(value: string): T;
}

/**
 * Custom error class for handling serialization-related errors.
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

/**
 * A serializer for Error objects that utilizes serialize-error-cjs for
 * converting Error objects to and from a JSON serializable format.
 * This can be used as a base class for custom error serializers.
 */
export class DefaultErrorSerializer implements Serializer<Error> {
  /**
   * Serializes an Error object into a string using serialize-error-cjs and JSON.stringify.
   * @param value The Error object to serialize.
   * @returns A string representation of the Error.
   */
  serialize(value: Error): string {
    return JSON.stringify(serializeError(value));
  }

  /**
   * Deserializes a string back into an Error object using serialize-error-cjs and JSON.parse.
   * Throws if the format is not recognized as a serialized Error object.
   * @param value The string to deserialize.
   * @returns The deserialized Error object.
   */
  deserialize(value: string): Error {
    let error: unknown;
    try {
      error = JSON.parse(value);
    } catch (err) {
      throw new SerializerError('Invalid JSON', err);
    }
    if (isSerializedError(error)) {
      return deserializeError(error);
    }
    // Likely the value was serialized not by DefaultErrorSerializer,
    // possibly by a derived class.
    throw new SerializerError('Invalid serialized error format');
  }
}

/**
 * A JSON serializer that assumes the value is already in a JSON serializable format.
 */
export class JSONSerializer<T> implements Serializer<T> {
  /**
   * Serializes a value into a string using JSON.stringify.
   * @param value The value to serialize.
   * @returns A string representation of the value.
   */
  serialize(value: T): string {
    // Assumes the value is already in a JSON serializable format.
    return JSON.stringify(value);
  }

  /**
   * Deserializes a string back into a value using JSON.parse.
   * @param value The string to deserialize.
   * @returns The deserialized value.
   */
  deserialize(value: string): T {
    // Assumes the value is a serialized JSON string in the shape of T.
    return JSON.parse(value);
  }
}

/**
 * Type guard function to check if a given object conforms to the SerializedError interface.
 * @param err The object to check.
 * @returns True if the object is a serialized error, false otherwise.
 */
function isSerializedError(err: unknown): err is SerializedError {
  return (
    !!err &&
    typeof err === 'object' &&
    'name' in err &&
    typeof err['name'] === 'string' &&
    'message' in err &&
    typeof err['message'] === 'string' &&
    'stack' in err &&
    typeof err['stack'] === 'string'
  );
}
