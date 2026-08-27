/**
 * Pulls the URL string out of a `get_record_graph_url` tool result, and
 * matches the tool by name.
 *
 * Ported from `ichirouganaim_frontend`'s `lib/graph-url.ts` (the reference
 * repo's own `extractGraphUrl`, built up over three real, live-verified
 * shape bugs across different providers -- see that file's docstring and
 * this project's decisions.md). Only the shapes relevant to this Pipe are
 * kept as primary; the others are cheap defensive fallbacks in case
 * `claude_cli.py`'s own emission ever changes shape.
 *
 * **Live-verified for the claude_cli.py Pipe path** (decisions.md, 2026-08-22):
 * `claude_cli.py`'s `_append_tool_result` stores the `tool_result` block's
 * `content` field verbatim into `function_call_output.output[0].text` --
 * for a real `get_record_graph_url` call that's the string
 * `'{"result":"http://127.0.0.1:1246/records/<id>/graph-view/"}'`, so the
 * `result.result` branch below is the one that fires for that integration.
 *
 * Since then a second path is also in use -- native MCP Tool Server
 * registration (decisions.md, 2026-08-23), where the tool reaches the
 * frontend under a different name (`isGraphUrlTool` was widened for it, see
 * below) and the result may arrive as a bare URL string rather than the
 * `{ result: url }` envelope; `extractGraphUrl` handles both. The
 * `structuredContent`/`content[]` branches remain defensive fallbacks.
 */

// The bare MCP tool name. Whatever integration path is active wraps its own
// namespacing around this; all the confirmed shapes so far embed this exact
// string somewhere inside the name:
//
//   get_record_graph_url                                (bare -- early claude-cli)
//   mcp__ichirouganaim_mcp__get_record_graph_url        (claude_cli.py Pipe: its
//                                                        MCP_SERVER_KEY constant,
//                                                        `mcp__<key>__<tool>`,
//                                                        decisions.md 2026-08-22)
//   ichirouganaim_mcp_tool_get_record_graph_url_post    (native MCP Tool Server,
//                                                        decisions.md 2026-08-23:
//                                                        open-webui's
//                                                        `{server_id}_` prefix +
//                                                        the MCP server's own
//                                                        fastapi-mcp
//                                                        `tool_<op>_post`
//                                                        operationId)
//
// The old `=== BARE_NAME || endsWith('__' + BARE_NAME)` check only covered the
// first two and silently missed the third (single-underscore namespacing plus a
// `_post` suffix), so the graph card stopped rendering after the switch to
// native Tool Server registration. The bare name is distinctive enough across
// the whole ~137-tool set that a separator-bounded substring match is safe --
// no sibling tool embeds it.
const BARE_NAME = 'get_record_graph_url';
const NAME_RE = new RegExp(`(?:^|[^a-z0-9])${BARE_NAME}(?:[^a-z0-9]|$)`, 'i');

export function isGraphUrlTool(toolName: string): boolean {
	return NAME_RE.test(toolName);
}

export function extractGraphUrl(output: unknown): string | null {
	if (typeof output === 'string') {
		const trimmed = output.trim();
		// Some transports hand the result back as a bare URL (or a
		// JSON-encoded bare string that parses down to one) rather than the
		// `{ result: "<url>" }` envelope the claude-cli Pipe emits -- take it
		// directly. Guarded tightly enough that a pretty-printed JSON object
		// (starts with `{`) or an error string still falls through.
		if (/^https?:\/\/[^\s"']+$/.test(trimmed)) return trimmed;
		try {
			return extractGraphUrl(JSON.parse(trimmed));
		} catch {
			// Not JSON -- e.g. a plain error string from a failed call.
			return null;
		}
	}

	if (typeof output !== 'object' || output === null) return null;
	const result = output as Record<string, unknown>;

	const structured = result.structuredContent;
	if (
		typeof structured === 'object' &&
		structured !== null &&
		typeof (structured as Record<string, unknown>).result === 'string'
	) {
		return (structured as Record<string, unknown>).result as string;
	}

	const content = result.content;
	if (Array.isArray(content)) {
		const textPart = content.find(
			(part): part is { type: 'text'; text: string } =>
				typeof part === 'object' &&
				part !== null &&
				(part as Record<string, unknown>).type === 'text' &&
				typeof (part as Record<string, unknown>).text === 'string'
		);
		if (textPart) return textPart.text;
	}

	// The claude-cli Pipe's own shape: { result: "<url>" }.
	if (typeof result.result === 'string') return result.result;

	return null;
}
