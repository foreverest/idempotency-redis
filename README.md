# idempotency-redis

[![CI](https://github.com/foreverest/idempotency-redis/actions/workflows/ci.yml/badge.svg)](https://github.com/foreverest/idempotency-redis/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/foreverest/idempotency-redis/graph/badge.svg?token=6G4SOMC2WK)](https://codecov.io/gh/foreverest/idempotency-redis)
[![npm version](https://img.shields.io/npm/v/idempotency-redis.svg?style=flat-square)](https://www.npmjs.com/package/idempotency-redis)
[![npm](https://img.shields.io/npm/dm/idempotency-redis.svg?style=flat-square)](https://npm-stat.com/charts.html?package=idempotency-redis)

`idempotency-redis` is a Node.js package designed to ensure idempotent operations in distributed systems, with Redis at its core for state management and distributed locks. It provides a straightforward way to execute operations exactly once and replay results of previously completed operations. This package is particularly useful for applications that require idempotency guarantees, such as financial transactions, API request processing, and more.

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
  - [Basic Usage](#basic-usage)
  - [The `run` Method](#the-run-method)
  - [Serialization](#serialization)
  - [Custom Callbacks for Enhanced Control](#custom-callbacks-for-enhanced-control)
- [Contributing](#contributing)
- [License](#license)

## Installation

Install `idempotency-redis` using npm:

```bash
npm install idempotency-redis
```

This package requires [`ioredis`](https://www.npmjs.com/package/ioredis) as a peer dependency.

## Usage

### Basic Usage

First, create a Redis client and an executor:

```js
const Redis = require('ioredis');
const { IdempotentExecutor } = require('idempotency-redis');

const redisClient = new Redis();

const executor = new IdempotentExecutor(redisClient);
```

Execute an operation idempotently:

```js
async function successfulOperation() {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return Math.random();
}

await Promise.all(
  Array.from({ length: 5 }, () =>
    executor
      .run('unique-idempotency-key-1', successfulOperation)
      .then((result) => console.log('Success:', result)),
  ),
);

// Output:
// Success: 0.07141382071552882
// Success: 0.07141382071552882
// Success: 0.07141382071552882
// Success: 0.07141382071552882
// Success: 0.07141382071552882
```

Failed operations are replayed as well:

```js
async function failingOperation() {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  throw new Error(Math.random());
}

await Promise.all(
  Array.from({ length: 5 }, () =>
    executor
      .run('unique-idempotency-key-2', failingOperation)
      .catch((e) => console.log('Failure:', e.message)),
  ),
);

// Output:
// Failure: 0.4333214870751385
// Failure: 0.4333214870751385
// Failure: 0.4333214870751385
// Failure: 0.4333214870151385
// Failure: 0.4333214870751385
```

### The `run` Method

The `run` method is a core function of the `IdempotentExecutor`, responsible for executing operations idempotently. It accepts the following arguments:

- `idempotencyKey`: A unique string that identifies the operation. This key ensures that the operation is executed exactly once, regardless of how many times the run method is called with the same key.

- `action`: This is the operation that you want to execute idempotently. It should be an asynchronous function or a function that returns a promise.

- `options` (Optional): An object that allows for further customization of the operation execution. It can have the following properties:

  - `timeout`: (Optional) The maximum time, in milliseconds, that the concurrent executions wait for the single in-progress task to complete before they get terminated. Default is 1 minute.
  - `valueSerializer`: (Optional) A custom serializer for the result of the operation. Must implement the `Serializer<T>` interface. Defaults to JSON serialization.
  - `errorSerializer`: (Optional) A custom serializer for errors generated by the operation. Must implement the `Serializer<Error>` interface. Defaults to using [`serialize-error-cjs`](https://www.npmjs.com/package/serialize-error-cjs).
  - `onActionSuccess`: A callback invoked when the action is executed successfully.
  - `onActionError`: A callback invoked when the action fails during execution.
  - `onSuccessReplay`: A callback invoked when a successful action is replayed.
  - `onErrorReplay`: A callback invoked when a failed action is replayed.
  - `shouldIgnoreError`: A callback invoked when an error is encountered. If it returns `true`, the error will not be cached and will not be replayed.

### Serialization

The serialization process involves converting values and errors produced by the action function into a format suitable for storage, enabling their later retrieval and replay. While serialization and deserialization of simple objects and standard Error instances are relatively straightforward, handling custom instances and errors requires a more nuanced approach. Specifically, if your operation throws custom errors or returns instances of custom classes, directly serializing and deserializing these objects might not accurately preserve their types or states. To address this challenge, the run method accepts two specialized serializers: one for handling successful operation results and another for errors.

By default, `idempotency-redis` uses the `JSONSerializer` for values, utilizing JavaScript's built-in `JSON.stringify` and `JSON.parse methods` for serialization and deserialization, respectively. For errors, the default serializer is `DefaultErrorSerializer`, which builds upon the [`serialize-error-cjs`](https://www.npmjs.com/package/serialize-error-cjs) package to facilitate error object serialization/deserialization, including support for common error types. While these defaults are generally sufficient for many use cases, they may not fully capture the fidelity of custom errors or complex objects.

To ensure that your serialized data maintains as much of its original structure and type information as possible, you can define and use custom serializers. These custom serializers allow for the precise control over how objects are transformed into strings and subsequently reconstituted. Below is an example illustrating how to create and use a custom serializer capable of handling both instances of a `CustomClass` and numeric values:

```ts
class CustomClass {
  constructor(public property: string) {}
}

// A serializer capable of handling both CustomClass instances and numbers.
class CustomSerializer extends JSONSerializer<CustomClass | number> {
  serialize(value: CustomClass | number): string {
    if (value instanceof CustomClass) {
      // Implement a custom serialization format that converts the value to a string.
      // This could be JSON, YAML, or any custom format as long as you can accurately
      // deserialize it back to the original value.
      return `custom-class:${value.property}`;
    }
    // For numbers, defer to the base class's serialization logic.
    return super.serialize(value);
  }

  deserialize(value: string): CustomClass | number {
    if (value.startsWith('custom-class:')) {
      // Custom logic to reconstruct a CustomClass instance.
      const property = value.slice('custom-class:'.length);
      return new CustomClass(property);
    }
    // Use the base class's deserialization logic for numbers.
    return super.deserialize(value);
  }
}
```

### Custom Callbacks for Enhanced Control

`idempotency-redis` introduces four optional callback functions in the options parameter of the `run` method, providing enhanced control and flexibility over operation execution. This capability is particularly useful for implementing custom logging, modifying responses or errors, and integrating additional operational metrics.

- `onActionSuccess`: This callback is invoked when the action completes successfully. It enables the insertion of custom logic, such as logging or response transformation, right after a successful operation. It receives two parameters: the idempotency key and the operation's result, allowing for context-aware processing.

- `onActionError`: When the action encounters an error, this callback is called. It provides an opportunity to log errors, augment error information, or transform the error before it is thrown by the executor. The callback receives the idempotencyKey and the error object as parameters.

- `onSuccessReplay`: This callback is triggered when a previously successful action is replayed. It can be used to modify the replayed success response or to log that a replay has occurred.

- `onErrorReplay`: Similar to `onSuccessReplay`, but for failed operations. This callback allows for custom logic when a failed action is replayed, such as error transformation or logging specific replay errors.

Below is an example illustrating the use of these callbacks for logging:

```js
await executor.run('unique-idempotency-key', someOperation, {
  onActionSuccess: (idempotencyKey, result) => {
    console.log(
      `Operation with key ${idempotencyKey} succeeded with result:`,
      result,
    );
    return result;
  },
  onActionError: (idempotencyKey, error) => {
    console.error(
      `Operation with key ${idempotencyKey} failed with error:`,
      error,
    );
    return error;
  },
  onSuccessReplay: (idempotencyKey, result) => {
    console.log(
      `Replayed success for key ${idempotencyKey} with result:`,
      result,
    );
    return result;
  },
  onErrorReplay: (idempotencyKey, error) => {
    console.error(
      `Replayed failure for key ${idempotencyKey} with error:`,
      error,
    );
    return error;
  },
});
```

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on GitHub.

## License

This project is licensed under the MIT License.
