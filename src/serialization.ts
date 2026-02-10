import {
  deserializeError,
  SerializedError,
  serializeError,
} from 'serialize-error-cjs';
import { SerializerError } from './serialization.errors';

/**
 * Interface defining a generic serializer.
 */
export interface Serializer<T> {
  serialize(value: T): string;
  deserialize(value: string): T;
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
   * @throws SerializerError if the format is not recognized.
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
   * @throws SerializerError if the value is not JSON serializable.
   */
  serialize(value: T): string {
    try {
      // Assumes the value is already in a JSON serializable format.
      const result = JSON.stringify(value);
      if (typeof result !== 'string') {
        throw new SerializerError('Not JSON serializable');
      }
      return result;
    } catch (err) {
      if (err instanceof SerializerError) {
        throw err;
      }
      throw new SerializerError('Not JSON serializable', err);
    }
  }

  /**
   * Deserializes a string back into a value using JSON.parse.
   * @param value The string to deserialize.
   * @returns The deserialized value.
   * @throws SerializerError if the value is not valid JSON.
   */
  deserialize(value: string): T {
    try {
      // Assumes the value is a serialized JSON string in the shape of T.
      return JSON.parse(value);
    } catch (err) {
      throw new SerializerError('Invalid JSON', err);
    }
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
