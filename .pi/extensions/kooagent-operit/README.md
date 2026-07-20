# kooagent-operit

Project-local Pi extension that exposes the existing Operit Android Remote Tool API as Pi tools.

The extension is auto-discovered from:

```text
.pi/extensions/kooagent-operit/index.ts
```

Pi must trust the KooAgent project before it loads project-local extensions.

## Configuration

The extension includes local development defaults for the current Operit
instance, so no environment variables are required for the checked-out setup.
Environment variables can still override them:

```bash
export OPERIT_URL="http://127.0.0.1:8094"
export OPERIT_TOKEN="<token shown by Operit>"
export OPERIT_TIMEOUT_MS="15000"
```

Do not store `OPERIT_TOKEN` in this repository.

When Operit runs on a USB-connected Android device:

```bash
adb forward tcp:8094 tcp:8094
curl \
  -H "Authorization: Bearer ${OPERIT_TOKEN}" \
  "${OPERIT_URL}/api/device/health"
```

## Run from the Pi fork

From the KooAgent repository root:

```bash
./pi/pi-test.sh
```

Approve the project trust prompt once. The extension registers 27 `android_*`
tools. `run_ui_subagent` is intentionally not exposed because Agent orchestration
belongs to Pi.

Use the following command inside Pi to check connectivity without asking the model to call a tool:

```text
/operit-status
```

## Design

- Pi tool names keep the `android_` prefix.
- Remote Operit names remain unchanged.
- The Extension and Operit use the unpublished v2 remote execution protocol.
- Arguments remain typed JSON across the HTTP seam.
- Every request carries session, run, turn, trace, tool-call, execution, and
  attempt identifiers.
- Operit returns one structured outcome with `status`, model-facing `content`,
  structured `data`, error classification, timing, and runtime metadata.
- Expected business, HTTP, timeout, cancellation, and protocol failures are
  returned from the tool instead of thrown. The Extension's `tool_result` hook
  maps every non-`SUCCEEDED` status to Pi's `isError=true` while preserving
  complete details. Failed outcomes also prepend a compact `[OPERIT_TOOL_ERROR]`
  block to model-visible content with `status`, `code`, `category`, `retryable`,
  `userActionRequired`, and `message`, so the model can choose a recovery action
  without receiving the complete details payload. The projected message is
  bounded to 1,024 characters; malformed failures without an error object use
  conservative non-retryable INTERNAL defaults.
- Read-only tools may execute in parallel. Safe reads and keyed writes can
  repeat one transient transport request with the same `executionId`, subject
  to a per-run retry budget. Unsafe device mutations stay sequential and are
  never retried automatically.
- Set `OPERIT_TRACE_FILE` to write bounded JSONL completion traces. Tool
  arguments and large result data are not written to this trace.

## Tests

```bash
./pi/node_modules/.bin/tsx --test .pi/extensions/kooagent-operit/test/*.test.ts
```
