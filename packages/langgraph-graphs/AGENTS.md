# langgraph-graphs · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @Cogni-DAO
- **Status:** draft

## Purpose

LangGraph runtime utilities for agentic AI execution: message converters, tool wrappers, MCP clients, streaming utilities and the in-proc runner. Defines no graphs: LevelUp's catalog is the published `cogni` and `work-prioritizer`, composed in `graphs/` (`@cogni/node-template-graphs`).

## Pointers

- [LangGraph AI Guide](https://node-template.cognidao.org/knowledge/graph-execution-invariants)
- [Tool Use Spec](https://github.com/cogni-dao/cogni/blob/2321821e61dd12aa0cf75d235bd668ff65739109/docs/spec/tool-use.md)
- [Packages Architecture](https://github.com/cogni-dao/cogni/blob/2321821e61dd12aa0cf75d235bd668ff65739109/docs/spec/packages-architecture.md)

## Boundaries

```json
{
  "layer": "packages",
  "may_import": ["packages"],
  "must_not_import": [
    "app",
    "features",
    "ports",
    "core",
    "adapters",
    "shared",
    "services"
  ]
}
```

**External deps:** `@langchain/core`, `@langchain/langgraph`, `@langchain/mcp-adapters`, `zod`. Imports `@cogni/ai-core`, `@cogni/ai-tools`.

## Public Surface

- **Exports (subpaths):**
  - `@cogni/langgraph-graphs` — Barrel re-export of common types plus:
    - `McpToolSource` — ToolSourcePort implementation for MCP-discovered tools
    - `loadMcpTools()`, `parseMcpConfigFromEnv()` — MCP client connection + config parsing
    - `McpHttpServerConfig`, `McpSseServerConfig`, `McpStdioServerConfig` — Transport config types
  - `@cogni/langgraph-graphs/inproc` — InProc execution runner:
    - `createInProcGraphRunner()` — Generic InProc graph runner factory
    - `InProcRunnerOptions`, `InProcGraphRequest`, `GraphResult` (includes optional `structuredOutput`) — Runner types
    - `CompletionFn`, `CompletionResult` — Injected completion function types
    - `CreateGraphFn`, `CreateGraphOptions` — Graph factory types
    - `ToolExecFn`, `ToolExecResult` — Tool execution types
  - `@cogni/langgraph-graphs/runtime` — LangChain utilities (split: `core/` generic, `cogni/` ALS-based):
    - **Core (no ALS):** `makeLangChainTool()`, `toLangChainToolsCaptured()`, `toBaseMessage()`, `fromBaseMessage()`, `AsyncQueue`, `makeServerGraph()`
    - **Cogni (uses ALS):** `CogniCompletionAdapter` (with `withStructuredOutput()` for Zod/JSON Schema response parsing), `runWithCogniExecContext()`, `getCogniExecContext()`, `hasCogniExecContext()`, `toLangChainToolsFromContext()`, `makeCogniGraph()`
    - `CogniExecContext` — Runtime context type (completionFn, tokenSink, toolExecFn; NO model per #35)
  - `@cogni/langgraph-graphs/graphs` — Shared graph types only:
    - `InvokableGraph<I,O>`, `MessageGraphInput`, `MessageGraphOutput` — Type firewall
    - `GraphInvokeOptions`, `CreateReactAgentGraphOptions` — Factory types
- **Env/Config keys:** none (all deps injected)
- **Files considered API:** `index.ts`, `inproc/index.ts`, `runtime/index.ts`, `graphs/index.ts`

## Ports

- **Uses ports:** none (pure package, no ports)
- **Implements ports:** none

## Responsibilities

- This directory **does**: Wrap tools for LangChain, convert message formats, run graphs in-proc
- This directory **does not**: Import from `src/`, execute graphs (runners in `src/`), own billing logic

## Usage

```bash
pnpm --filter @cogni/langgraph-graphs typecheck
pnpm --filter @cogni/langgraph-graphs build
pnpm --filter @cogni/langgraph-graphs test
```

## Standards

- All `@langchain/*` imports must stay in this package (NO_LANGCHAIN_IN_SRC)
- Graph factories are pure functions — no env reads, no side effects
- PURE_GRAPH_FACTORY: `graph.ts` has no env/ALS/entrypoint wiring
- TYPE_TRANSPARENT_RETURN: Graph factories have NO explicit return type annotation to preserve `CompiledStateGraph` for CLI schema extraction
- ENTRYPOINT_IS_THIN: `server.ts` and `cogni-exec.ts` are ~1-liners calling `makeServerGraph`/`makeCogniGraph`
- NO_CROSSING_THE_STREAMS: `server.ts` uses `initChatModel`; `cogni-exec.ts` uses ALS — never mix
- TOOLS_DENY_BY_DEFAULT: toLangChainTool checks configurable.toolIds; returns policy_denied if not in list
- TOOL_CATALOG_IS_CANONICAL: `LANGGRAPH_CATALOG` entries use `toolIds: string[]` references; providers resolve from `TOOL_CATALOG`

## Dependencies

- **Internal:** `@cogni/ai-core` (AiEvent types), `@cogni/ai-tools` (ToolContract, BoundTool)
- **External:** `@langchain/core`, `@langchain/langgraph`, `zod`

## Change Protocol

- Update this file when public exports change
- Changes to graph contracts require updating `src/adapters/server/ai/langgraph/inproc.provider.ts`
- Coordinate with LANGGRAPH_AI.md invariants

## Notes

- Per NO_LANGCHAIN_IN_SRC: `src/**` cannot import `@langchain/*` — only this package
- Per PACKAGES_NO_SRC_IMPORTS: This package cannot import from `src/**`
- `LangGraphInProcProvider` in `src/adapters/server/ai/langgraph/` wires this package
- Package isolation enables LangGraph Server to import graphs without Next.js deps
- **Dual tsconfig:** LangGraph CLI generates runtime `.ts` files (`__langgraph__*.ts`) that break `composite` mode. This package uses `tsconfig.json` (noEmit, for CLI) + `tsconfig.build.json` (composite, for `tsc -b`). Root tsconfig.json references the build config explicitly. This is not proper form, but a valid workaround.
