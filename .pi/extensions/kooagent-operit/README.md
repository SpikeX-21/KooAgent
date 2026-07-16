# kooagent-operit

Project-local Pi extension that exposes the existing Operit Android Remote Tool API as Pi tools.

The extension is auto-discovered from:

```text
.pi/extensions/kooagent-operit/index.ts
```

Pi must trust the KooAgent project before it loads project-local extensions.

## Configuration

Set the connection values in the shell that starts Pi:

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

Approve the project trust prompt once. The extension registers the 28 `android_*` tools currently exposed by the CoreCoder adapter.

Use the following command inside Pi to check connectivity without asking the model to call a tool:

```text
/operit-status
```

## Design

- Pi tool names keep the `android_` prefix.
- Remote Operit names remain unchanged.
- Pi's `toolCallId` is sent as the remote `requestId`.
- Operit arguments are converted to `Map<String, String>` compatible values.
- The request carries `timeoutMs` and propagates Pi's cancellation signal.
- Android tools execute sequentially in Pi because they share device state.
- Successful responses retain the complete Operit response in tool `details`.
- Operit business failures and HTTP/timeout failures are raised as Pi tool errors.

## Tests

```bash
./pi/node_modules/.bin/tsx --test .pi/extensions/kooagent-operit/test/*.test.ts
```
