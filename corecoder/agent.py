"""Core agent loop.

This is the heart of CoreCoder.  The pattern is simple:

    user message -> LLM (with tools) -> tool calls? -> execute -> loop
                                      -> text reply? -> return to user

It keeps looping until the LLM responds with plain text (no tool calls),
which means it's done working and ready to report back.
"""

import concurrent.futures
import inspect
from .llm import LLM
from .tools import ALL_TOOLS
from .tools.base import Tool
from .tools.agent import AgentTool
from .prompt import system_prompt
from .context import ContextManager
from .tracing import TraceSink, utc_now_iso


class Agent:
    def __init__(
        self,
        llm: LLM,
        tools: list[Tool] | None = None,
        max_context_tokens: int = 128_000,
        max_rounds: int = 50,
        tracer: TraceSink | None = None,
    ):
        self.llm = llm
        self.tools = tools if tools is not None else ALL_TOOLS
        self._tool_by_name = {t.name: t for t in self.tools}
        self.messages: list[dict] = []
        self.context = ContextManager(max_tokens=max_context_tokens)
        self.max_rounds = max_rounds
        self.tracer = tracer
        self._system = system_prompt(self.tools)

        # wire up sub-agent capability
        for t in self.tools:
            if isinstance(t, AgentTool):
                t._parent_agent = self

    def _full_messages(self) -> list[dict]:
        return [{"role": "system", "content": self._system}] + self.messages

    def _tool_schemas(self) -> list[dict]:
        return [t.schema() for t in self.tools]

    def chat(self, user_input: str, on_token=None, on_tool=None) -> str:
        """Process one user message. May involve multiple LLM/tool rounds."""
        self.messages.append({"role": "user", "content": user_input})
        self.context.maybe_compress(self.messages, self.llm)

        for round_index in range(1, self.max_rounds + 1):
            resp = self.llm.chat(
                messages=self._full_messages(),
                tools=self._tool_schemas(),
                on_token=on_token,
            )

            # no tool calls -> LLM is done, return text
            if not resp.tool_calls:
                self.messages.append(resp.message)
                if self.tracer:
                    self.tracer.final_answer(round_index=round_index, answer=resp.content)
                return resp.content

            # tool calls -> execute (parallel when multiple, like Claude Code's
            # StreamingToolExecutor which runs independent tools concurrently)
            self.messages.append(resp.message)

            try:
                if len(resp.tool_calls) == 1:
                    tc = resp.tool_calls[0]
                    if on_tool:
                        on_tool(tc.name, tc.arguments)
                    result = self._exec_tool(tc, round_index=round_index)
                    self.messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": result,
                    })
                else:
                    # parallel execution for multiple tool calls
                    results = self._exec_tools_parallel(resp.tool_calls, on_tool, round_index)
                    for tc, result in zip(resp.tool_calls, results):
                        self.messages.append({
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": result,
                        })
            except KeyboardInterrupt:
                # Ctrl+C mid-execution would leave the assistant tool_calls
                # message without replies, poisoning the next request; backfill
                self._answer_pending_tool_calls(resp.tool_calls)
                raise

            # compress if tool outputs are big
            self.context.maybe_compress(self.messages, self.llm)

        answer = "(reached maximum tool-call rounds)"
        if self.tracer:
            self.tracer.max_steps(max_rounds=self.max_rounds, answer=answer)
        return answer

    def _exec_tool(self, tc, round_index: int | None = None) -> str:
        """Execute a single tool call, returning the result string."""
        started_at = utc_now_iso()
        result = ""
        success = False
        error = ""
        tool = self._tool_by_name.get(tc.name)
        try:
            if tool is None:
                result = f"Error: unknown tool '{tc.name}'"
                error = result
                return result
            # validate arguments first so a TypeError raised *inside* the tool isn't
            # mislabelled as a bad-arguments error from the caller
            try:
                inspect.signature(tool.execute).bind(**tc.arguments)
            except TypeError as e:
                result = f"Error: bad arguments for {tc.name}: {e}"
                error = result
                return result
            try:
                result = tool.execute(**tc.arguments)
                success = not _looks_like_error_result(result)
                if not success:
                    error = result
                return result
            except Exception as e:
                result = f"Error executing {tc.name}: {e}"
                error = result
                return result
        finally:
            if self.tracer:
                self.tracer.tool_result(
                    round_index=round_index or 0,
                    tool_call_id=tc.id,
                    tool_name=tc.name,
                    arguments=tc.arguments,
                    started_at=started_at,
                    finished_at=utc_now_iso(),
                    success=success,
                    error=error,
                    result_text=result,
                )

    def _exec_tools_parallel(self, tool_calls, on_tool=None, round_index: int | None = None) -> list[str]:
        """Run multiple tool calls concurrently using threads.

        This is inspired by Claude Code's StreamingToolExecutor which starts
        executing tools while the model is still generating.  We simplify to:
        when the model returns N tool calls at once, run them in parallel.
        """
        for tc in tool_calls:
            if on_tool:
                on_tool(tc.name, tc.arguments)

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            futures = [pool.submit(self._exec_tool, tc, round_index) for tc in tool_calls]
            return [f.result() for f in futures]

    def _answer_pending_tool_calls(self, tool_calls):
        """Backfill a tool reply for every call that didn't get one.

        OpenAI-compatible APIs reject a request where an assistant message has
        tool_calls without a matching tool reply for each id, so this keeps the
        history valid when execution is interrupted partway through.
        """
        answered = {m.get("tool_call_id") for m in self.messages if m.get("role") == "tool"}
        for tc in tool_calls:
            if tc.id not in answered:
                self.messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": "[interrupted]",
                })

    def reset(self):
        """Clear conversation history."""
        self.messages.clear()


def _looks_like_error_result(result: str) -> bool:
    return result.startswith("Error:") or result.startswith("Error executing ") or result.startswith("Error from ")
