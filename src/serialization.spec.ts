import { DefaultErrorSerializer, JSONSerializer } from './serialization';
import { SerializerError } from './serialization.errors';

describe('JSONSerializer', () => {
  const serializer = new JSONSerializer();

  it('should serialize value to JSON', () => {
    expect(serializer.serialize('test')).toBe('"test"');
    expect(serializer.serialize(123)).toBe('123');
    expect(serializer.serialize(true)).toBe('true');
    expect(serializer.serialize(null)).toBe('null');
    expect(
      serializer.serialize({
        key: 'value',
      }),
    ).toBe('{"key":"value"}');
  });

  it('should deserialize JSON to value', () => {
    expect(serializer.deserialize('"test"')).toBe('test');
    expect(serializer.deserialize('123')).toBe(123);
    expect(serializer.deserialize('true')).toBe(true);
    expect(serializer.deserialize('null')).toBe(null);
    expect(serializer.deserialize('{"key":"value"}')).toEqual({
      key: 'value',
    });
  });

  it('should throw an error for invalid JSON', () => {
    expect(() => serializer.deserialize('.')).toThrow(
      new SerializerError(
        'Invalid JSON',
        new SyntaxError('Unexpected token . in JSON at position 0'),
      ),
    );
  });

  it('should throw an error for non-JSON serializable value', () => {
    const value = { circular: {} };
    value.circular = value;

    expect(() => serializer.serialize(value)).toThrow(
      new SerializerError(
        'Not JSON serializable',
        new TypeError(
          "Converting circular structure to JSON\n    --> starting at object with constructor 'Object'\n    --- property 'circular' closes the circle",
        ),
      ),
    );
  });
});

describe('DefaultErrorSerializer', () => {
  const serializer = new DefaultErrorSerializer();

  it('should serialize error to JSON', () => {
    const error = new Error('Test error');

    const result = serializer.serialize(error);
    const { name, message, stack } = JSON.parse(result);

    expect(name).toBe('Error');
    expect(message).toBe('Test error');
    expect(stack).toBe(error.stack);
  });

  it('should not serialize custom properties', () => {
    const error = new Error('Test error');
    (error as unknown as Record<string, string>).custom = 'custom';

    const result = serializer.serialize(error);
    const { custom } = JSON.parse(result);

    expect(custom).toBeUndefined();
  });

  it('should deserialize JSON to error', () => {
    const serializedError = JSON.stringify({
      name: 'Error',
      message: 'Test error',
      stack: 'Test stack',
    });

    const error = serializer.deserialize(serializedError);

    expect(error).toEqual(new Error('Test error'));
  });

  it('should throw an error for invalid error format', () => {
    const invalidSerializedError = '{ "some": "object" }';

    expect(() => serializer.deserialize(invalidSerializedError)).toThrow(
      new SerializerError('Invalid serialized error format'),
    );
  });

  it('should throw an error for invalid JSON', () => {
    const invalidSerializedError = '.';

    expect(() => serializer.deserialize(invalidSerializedError)).toThrow(
      new SerializerError(
        'Invalid JSON',
        new SyntaxError('Unexpected token . in JSON at position 0'),
      ),
    );
  });
});
