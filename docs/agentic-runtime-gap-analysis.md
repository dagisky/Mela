# Agentic Runtime Gap Analysis

This document tracks the main production/runtime gaps in `mela-agentic-runtime` compared with a mature coding-agent runtime such as `claude-code-rev`.

The runtime already has strong core primitives: a multi-turn `ConversationEngine`, typed terminal results, tool registry and executor, approvals, policy checks, resource tracking, persistence stores, observability events, workflow orchestration, output validation, and child-run support. The gaps below are mostly depth and hardening work.

## Agent Loop

Current strengths:

- Multi-turn execution with max-turn limits.
- Terminal statuses for success, cancellation, validation failure, model failure, resource limits, and context budget failure.
- Tool calls are converted into model-visible tool result messages.
- Resource limits and circuit breakers reduce runaway behavior.

Gaps:

- Automatic context recovery is missing. The loop currently stops on `max_context_budget` instead of compacting, summarizing, or retrying with reduced context.
- Model failure recovery is shallow. The loop reports `model_error_retry_exhausted`, but does not own retries, fallback models, exponential backoff, or degraded-mode execution.
- Tool-result pairing is implicit. The runtime should enforce and repair the invariant that every model tool call receives exactly one model-visible tool result.
- Streaming model output is not supported. The loop assumes a full model response before tool execution.
- Stuck-loop prevention is basic. Max turns exist, but there is no repeated-action detection, duplicate tool-call suppression, or low-progress heuristic.
- Resume support is incomplete. Snapshots are saved, but the loop does not reconstruct persisted messages and continue a partially completed conversation.

Recommended improvements:

- Add a `LoopState` model that records turn number, pending tool calls, prompt usage, completion usage, transition reason, and last progress signal.
- Add a `ToolPairingGuard` that validates and repairs assistant tool-call/tool-result pairing before every model call.
- Add model retry and fallback policy to the loop.
- Add repeated-action detection keyed by tool name, normalized input, and recent result.
- Make `resume` reload messages, tool calls, approvals, and loop state from persistence.

## Tools

Current strengths:

- Runtime tool registry.
- Per-tool input validation.
- Per-tool permission checks.
- Runtime policy checks.
- Approval gates.
- Tool timeout enforcement.
- Tool output budgeting.
- Model-visible tool error results.
- Tool call persistence and events.

Gaps:

- Tool calls are executed sequentially by `ConversationEngine`, even when tools are concurrency-safe.
- There is no per-tool retry policy or retryable error classification.
- Large tool outputs are replaced, but the full output is not persisted as a retrievable artifact.
- Tool lifecycle hooks are limited to events. There are no pluggable before/after hooks for tracing, mutation, policy, cleanup, or audit enrichment.
- Schema handling is simple. The runtime passes JSON schema-like objects through, but does not normalize, version, or deeply validate schemas.
- Tool output budgeting is byte-based. There is no semantic summarization for large outputs.
- Tool cancellation depends on the tool honoring the provided signal. There is no cleanup contract for tools that launch external work.
- Tool provenance is partial. The runtime stores input and result, but not the full chain of original input, approved/modified input, output replacement, and storage reference.

Recommended improvements:

- Add a parallel tool execution path for independent concurrency-safe tool calls.
- Add `ToolRetryPolicy` with max attempts, backoff, retryable error codes, and per-tool overrides.
- Add `ToolArtifactStore` for large outputs, with model-visible summaries and durable references.
- Add `ToolLifecycleHook` extension points.
- Add schema normalization and schema version metadata to `RuntimeTool`.
- Track original input, final approved input, result mapping, output replacement, and artifact references in persisted tool call records.

## Context Recovery

Current strengths:

- Token estimation exists.
- Context budget checks happen before model calls.
- Tool output budgeting prevents large results from flooding the model context.

Gaps:

- Context overflow is terminal instead of recoverable.
- There is no transcript summarizer or compactor.
- There is no retrieval path for older run/session state after truncation.
- Source tracking is shallow. Summaries do not map back to original messages, tool calls, or artifacts because summaries do not exist yet.
- Context isolation rules are not explicit for parent runs, child runs, tools, hidden state, or sensitive messages.
- Tool output replacement does not provide a retrievable reference to the full result.
- Budgeting is static. The runtime does not dynamically reserve budget for system prompt, user request, tools, history, and final answer.

Recommended improvements:

- Add `ContextCompactor` that can summarize older messages when the budget is exceeded.
- Add `ContextRecoveryPolicy` with strategies such as summarize, drop low-value messages, retain recent tool calls, or fail closed.
- Add source maps for compacted content.
- Add artifact-backed context references for large tool outputs.
- Add dynamic budget allocation across system, user, history, tools, and final output.
- Define context visibility rules for parent/child agents and tools.

## Permissions

Current strengths:

- Runtime-level deny list.
- Approval-required tool list.
- Per-run hard-deny tools.
- Per-tool `checkPermissions`.
- Approval manager integration.
- Permission-denied and approval events.

Gaps:

- Policy rules are tool-name based and do not deeply inspect input.
- There is no first-class user/project/tenant/resource/action permission model.
- There are no scoped capability tokens for least-privilege tool execution.
- Approval grants do not have explicit scopes, expiry, reuse rules, or revocation.
- There are no global runtime permission modes such as read-only, safe-write, offline, or unrestricted.
- Audit records do not fully capture who approved, what changed, original input, final input, and why the policy decision was made.
- Risk scoring is missing. Destructive, external, expensive, or sensitive actions are not classified centrally.

Recommended improvements:

- Replace simple tool-name policy with contextual policy rules.
- Add `PermissionSubject`, `PermissionResource`, and `PermissionAction` types.
- Add global permission modes.
- Add risk classification for tool calls.
- Add scoped approval grants with expiry and revocation.
- Persist full policy decision records and approval audit records.
- Let policy inspect normalized tool input before approval or execution.

## Subagent Behavior

Current strengths:

- `ChildRunManager` can load and run child agents.
- Parent metadata is attached to child runs.
- Linked cancellation can reuse the parent signal.
- Child run requested/completed/cancelled events are emitted.
- Parent permission context can be passed to the child.

Gaps:

- There is no full parent/child run tree model.
- Linked cancellation only covers direct signal reuse, not cascading cancellation across a tree of descendants.
- Recursion limits, max child count, max depth, and delegated budget limits are not centrally enforced.
- Child result contracts are generic terminal results rather than structured delegation outputs.
- Parallel delegation and fan-in/fan-out orchestration are not first-class.
- Child context isolation is not explicit. Children currently inherit session and permission context without a formal visibility policy.
- Child permissions are not automatically narrowed for least privilege.
- Observability lacks detailed child spans, hierarchy traces, and delegation provenance.

Recommended improvements:

- Add `RunTree` or `DelegationGraph` persistence.
- Add recursion and delegation limits to `RuntimeBudgets`.
- Add child-specific context and permission narrowing.
- Add structured child result schemas for parent consumption.
- Add fan-out/fan-in support for parallel child agents.
- Add cascading cancellation for descendant runs.
- Emit hierarchy-aware observability spans and provenance events.

## Priority Roadmap

1. Add context compaction and recovery.
2. Add model retry, fallback, and backoff behavior.
3. Add explicit tool-result pairing enforcement.
4. Execute concurrency-safe tool calls in parallel.
5. Persist large tool outputs as retrievable artifacts.
6. Upgrade permissions to contextual policy rules.
7. Add scoped approval grants and richer audit records.
8. Add full parent/child run tree management.
9. Add recursion, delegation, and descendant cancellation limits.
10. Make resume reconstruct and continue persisted loop state.

