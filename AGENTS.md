# Repository Guidelines

## Project Structure & Module Organization

KooAgent uses Pi as agent brain and Operit as Android runtime.

- `.pi/extensions/kooagent-operit/`: TypeScript adapter, permissions, policy, tracing, and result mapping.
- `.pi/extensions/kooagent-operit/test/`: Tests named `*.test.ts`.
- `Operit/`: Android runtime and Remote Tool API; see `Operit/AGENTS.md`.
- `pi/`: Pi submodule. Do not modify it for KooAgent integration; see `pi/AGENTS.md`.

## Documentation Location

Store future design, test, verification, and project documents under root `doc/`, using topical subdirectories.

## Architecture & Development Boundaries

Pi/KooAgent owns context, sessions/compaction, skills, tool exposure, user permissions, retry budgets, trace interpretation, and result retention/recall.

Operit is the Android execution boundary. It enforces Bearer authentication, its 27-tool allowlist, executor parameter validation, and short-lived idempotency, cancellation, and execution status. The extension initiates retries/cancellation and maps outcomes into observations.

Only the Pi extension sends KooAgent user-approved calls; Operit authenticates callers by Bearer token and cannot verify Pi approval itself. Do not use or describe Operit's Agent, chat, prompt, skill, RAG, or knowledge-base code as KooAgent.

## Planned Improvements

- Remove `android_query_memory` and `android_get_memory_by_title`; KooAgent must not use Operit Memory.
- Build KooAgent Memory and the `llm-wiki` layer at the Pi/extension/host boundary. They are planned work, not current runtime capabilities.

## Build, Test, and Development Commands

Run from the repository root unless noted:

```bash
git submodule update --init --recursive
./pi/pi-test.sh
./pi/node_modules/.bin/tsx --test .pi/extensions/kooagent-operit/test/*.test.ts
adb forward tcp:8094 tcp:8094
```

These initialize dependencies, start Pi, test the extension, and expose Android runtime. For Android compilation, use:

```bash
cd Operit
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew :app:compileDebugKotlin
```

Do not run builds or tests unless the task requests them.

## Coding Style & Naming Conventions

TypeScript uses tabs and the Biome rules in `pi/biome.json`; prefer explicit types and avoid `any`. Use `camelCase`, `PascalCase`, and kebab-case filenames. Keep Pi tools prefixed with `android_`. Never edit generated files.

## Testing Guidelines

Add focused regression tests beside extension tests named `<subject>.test.ts`. Cover success, rejection, timeout, retry, and permission denial. Use fake HTTP/runtime behavior.

## Commit & Pull Request Guidelines

History uses Conventional Commit-style subjects, e.g. `feat(agent): align Operit v2 tool execution results`. Keep commits scoped and imperative. PRs explain changes and affected boundaries, link issues/discussions, and report verification. Remove tokens and sensitive data from UI/device evidence.

## Security & Configuration

Never commit `OPERIT_TOKEN`, device data, screenshots, or verbose traces. Configure `OPERIT_URL`, `OPERIT_TOKEN`, `OPERIT_TIMEOUT_MS`, and optional `OPERIT_TRACE_FILE` through the environment. Preserve Pi's allowlist, permission prompts, bounded result mapping, and minimal trace policy.
