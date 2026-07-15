# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

CoreCoder is a minimal AI coding agent (~1,081 line engine, ~1,714 total Python lines) that reads, writes, and edits files, executes shell commands, spawns sub-agents, and compresses context in three tiers. It speaks OpenAI-compatible APIs; an optional LiteLLM backend routes to 100+ providers. The project goal is readability and hackability — it is a runnable reference implementation, not a production tool.

## Commands

This local checkout uses the `corecoder` conda environment. Run Python tooling with:

```bash
conda activate corecoder
# or from non-interactive shells:
conda run -n corecoder python -m pytest tests/ -v
```

```bash
# Install (editable, for development)
pip install -e ".[dev]"

# Run the agent
corecoder                                                # interactive REPL
corecoder -p "fix the bug in parse_config()"             # one-shot mode
corecoder -r <session-id>                                # resume a saved session

# Provider switching (two env vars)
export OPENAI_API_KEY=sk-... OPENAI_BASE_URL=https://api.deepseek.com CORECODER_MODEL=deepseek-chat

# LiteLLM backend (for non-OpenAI-compatible providers)
pip install -e ".[litellm]"
CORECODER_PROVIDER=litellm corecoder -m anthropic/claude-sonnet-4-6

# Tests
python -m pytest tests/ -v                               # all tests
python -m pytest tests/test_tools.py -v                  # single test file
python -m pytest tests/test_tools.py::test_edit_file_basic -v  # single test

# Lint
ruff check corecoder tests
```

## Architecture

### Entry point and CLI (`corecoder/cli.py`, `corecoder/__main__.py`)

`corecoder.cli:main` is the entry point (`pyproject.toml` sets `corecoder = "corecoder.cli:main"`). It parses CLI args, builds a Config from env vars (allowing CLI overrides), instantiates either `LLM` or `LiteLLM` based on `CORECODER_PROVIDER`, creates an Agent, and dispatches to `_run_once` (one-shot) or `_repl` (interactive prompt_toolkit REPL with rich rendering).

### Config (`corecoder/config.py`)

A frozen dataclass built from env vars: `CORECODER_MODEL`, `OPENAI_API_KEY` / `CORECODER_API_KEY` / `DEEPSEEK_API_KEY`, `OPENAI_BASE_URL`, `CORECODER_MAX_TOKENS`, `CORECODER_TEMPERATURE`, `CORECODER_MAX_CONTEXT`, `CORECODER_PROVIDER`. Loads `.env` from cwd (walking up to home) via python-dotenv without failing if it's missing.

### Agent loop (`corecoder/agent.py`)

The heart of the system. Pattern:

```
user message → LLM (with tools) → tool calls? → execute (parallel via ThreadPoolExecutor) → loop
                                → text reply? → return to user
```

Key behaviors:
- **Parallel tool execution**: When the LLM returns multiple tool calls, `_exec_tools_parallel` runs them concurrently via `ThreadPoolExecutor(max_workers=8)`.
- **Ctrl+C safety**: `_answer_pending_tool_calls` backfills `[interrupted]` tool replies so the message history stays valid for the next LLM call.
- **Argument validation**: `inspect.signature(tool.execute).bind(**tc.arguments)` validates before calling, so TypeErrors inside the tool aren't mislabeled as bad-argument errors.
- **Sub-agent wiring**: `Agent.__init__` sets `_parent_agent` on every `AgentTool` instance so it can spawn independent sub-agents sharing the parent's LLM and tools (minus the agent tool itself, to prevent recursion).

### LLM layer (`corecoder/llm.py`)

Two classes:
- **`LLM`**: Thin wrapper over `openai.OpenAI`. Streams completions, accumulates text and streaming tool-call chunks, parses them into `ToolCall` dataclasses. Retries with exponential backoff on `RateLimitError`, `APITimeoutError`, `APIConnectionError`, and 5xx server errors. Falls back gracefully when a provider rejects `stream_options`.
- **`LiteLLM(LLM)`**: Same interface but routes through `litellm.completion`. Avoids creating an OpenAI client. Handles retries by matching error strings.

`LLMResponse` has a `.message` property that converts back to OpenAI format for appending to history. `estimated_cost` uses the built-in `_PRICING` table (OpenAI, DeepSeek, Claude, Qwen, Kimi) to calculate rough dollar cost.

### Context compression (`corecoder/context.py`)

Three-layer strategy mirroring Claude Code's approach:

1. **Tool snip** (50% threshold): Truncates tool outputs >1500 chars to first 3 + last 3 lines.
2. **Summarize** (70% threshold, >10 messages): Asks the LLM to compress old turns into a summary, keeps recent 8 messages intact. Uses `_safe_split` to never orphan a tool reply from its `tool_calls`.
3. **Hard collapse** (90% threshold, >4 messages): Emergency — keeps only last 4 messages + LLM summary, with a fallback regex-based extractor (file paths, errors) when no LLM is available.

Token estimation is `len(text) // 3` (rough approximation for mixed en/zh).

### Tools (`corecoder/tools/`)

All tools subclass `Tool` (ABC with `name`, `description`, `parameters`, `execute(**kwargs) → str`). Registered in `ALL_TOOLS`:

| Tool | Key detail |
|------|-----------|
| `read_file` | Line-numbered output, offset/limit support |
| `write_file` | Creates parent dirs, tracks changed files for `/diff` |
| `edit_file` | Exact-string search-and-replace; requires unique match; generates unified diff |
| `bash` | Dangerous-command blocking (rm -rf /, fork bombs, curl-pipe-to-shell), thread-local cwd tracking through `cd` chains, output truncation preserving head+tail |
| `glob` | Sorted by mtime, caps at 100 results |
| `grep` | Regex search, skips common noise dirs (`.git`, `node_modules`, etc.), 200-match limit |
| `agent` | Spawns a sub-Agent with 20-round max, no recursive agent tool, trims output to 5000 chars |

The `edit_file` tool's `_changed_files` set (module-level, in `corecoder/tools/edit.py`) is shared with `write_file` and read by the `/diff` REPL command.

### Session persistence (`corecoder/session.py`)

JSON files in `~/.corecoder/sessions/`. Sanitizes session IDs (path-traversal neutralized, length capped at 100). `list_sessions` returns newest-first, capped at 20.

### Tests

86 tests across 4 files:
- `tests/test_core.py`: Config, context compression layers, session round-trips, cost estimation, changed-file tracking, agent tool execution edge cases
- `tests/test_tools.py`: All 7 tools — schema validation, bash safety checks (including flag-order variants), thread-local cwd, edit-file uniqueness/rejection, grep skip-dir behavior
- `tests/test_session.py`: Session ID collision, path traversal, sanitization, corruption, unicode
- `tests/test_litellm.py`: LiteLLM class init, `_call_with_retry` parameter forwarding, `chat()` end-to-end (mocked stream), multi-provider model strings

Tests use `pytest` fixtures (`tmp_path`, `monkeypatch`). The LiteLLM tests install/uninstall a fake `litellm` module in `sys.modules` rather than requiring the real package.
