# Contributing

Thanks for contributing to `idempotency-redis`.

## How to Contribute

- Report bugs, regressions, docs gaps, or feature ideas by opening an issue.
- Submit pull requests for fixes, new tests, or documentation improvements.

## Development Setup

1. Fork and clone the repository.
2. Install dependencies with `npm ci`.
3. Run the local checks:

```bash
npm run build
npm run lint:check
npm run format:check
npm test
```

## Pull Request Process

1. Create your branch from `main`.
2. Keep your change focused and include tests when behavior changes.
3. Ensure all checks pass locally before opening the PR:

```bash
npm run build
npm run lint:check
npm run format:check
npm test
```

4. Open the pull request and describe what changed, why it changed, and how it was tested.

## Style Guide

- Follow the repository ESLint and Prettier configuration as the source of truth.
- Write commit messages in the present tense.
- Prefer small, focused commits.
