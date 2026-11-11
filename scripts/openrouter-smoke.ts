/**
 * The web-chat brain runs DeepSeek V4.1 Flash on OpenRouter (same pin as the platform's
 * LiteLLM group cfg-deepseek41flash-v1) and drives the MCP tools. No network — fetch is stubbed.
 *
 * Run: npm run openrouter-smoke
 */
import { ChatEngine } from "../src/chat/engine.js";

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!cond) failures++;
}

const sent: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
let turn = 0;
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? "{}"));
  sent.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string>, body });
  turn++;
  const message =
    turn === 1
      ? { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "search_products", arguments: '{"query":"edinburgh"}' } }] }
      : { role: "assistant", content: "Here are day trips from Edinburgh." };
  return new Response(JSON.stringify({ choices: [{ message, finish_reason: turn === 1 ? "tool_calls" : "stop" }] }), { status: 200 });
}) as typeof fetch;

async function main(): Promise<void> {
  const toolCalls: Array<[string, Record<string, unknown>]> = [];
  const engine = new ChatEngine({
    callTool: async (name, args) => {
      toolCalls.push([name, args]);
      return "Found 2 products";
    },
    toolList: [{ name: "search_products", description: "Search", inputSchema: { type: "object", properties: { query: { type: "string" } } } }],
    openrouterKey: "or-key",
    anthropicKey: "ant-key", // OpenRouter wins when both are set
  });

  check("brain is deepseek when an OpenRouter key is set", engine.brain === "deepseek", engine.brain);
  const res = await engine.respond("s1", "day trips from Edinburgh");

  const first = sent[0];
  check("calls OpenRouter chat completions", first?.url === "https://openrouter.ai/api/v1/chat/completions", first?.url);
  check("never calls Anthropic", !sent.some((s) => s.url.includes("anthropic.com")));
  check("sends the OpenRouter key as a Bearer token", first?.headers["Authorization"] === "Bearer or-key");
  check("model is DeepSeek V4.1 Flash (platform pin)", first?.body.model === "deepseek/deepseek-v4.1-flash-1017", first?.body.model);
  check(
    "provider pinned like the platform, no fallbacks, no data collection",
    JSON.stringify(first?.body.provider) === JSON.stringify({ only: ["morph/fp8"], allow_fallbacks: false, data_collection: "deny" }),
    JSON.stringify(first?.body.provider),
  );
  check("tools sent in function format", first?.body.tools?.[0]?.type === "function" && first?.body.tools?.[0]?.function?.name === "search_products");
  check("system prompt is the first message", first?.body.messages?.[0]?.role === "system");
  check("max_tokens bounded", first?.body.max_tokens === 1024);
  check("the model's tool call ran against MCP", toolCalls.length === 1 && toolCalls[0][0] === "search_products" && toolCalls[0][1].query === "edinburgh");
  const second = sent[1]?.body.messages ?? [];
  const toolMsg = second.find((m: any) => m.role === "tool");
  check("tool result goes back with its call id", toolMsg?.tool_call_id === "call_1" && toolMsg?.content === "Found 2 products");
  check("final reply is the model's text", res.reply === "Here are day trips from Edinburgh.", res.reply);
  check("reply is labelled deepseek", res.brain === "deepseek", String(res.brain));

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
