import assert from "node:assert/strict";
import { after, test } from "node:test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
const cache = resolve(root, "node_modules/.cache");
mkdirSync(cache, { recursive: true });
const output = mkdtempSync(resolve(cache, "sdk-efficiency-"));
after(() => rmSync(output, { recursive: true, force: true }));
execFileSync(process.execPath, [
  resolve(root, "node_modules/typescript/bin/tsc"),
  "--outDir", output, "--module", "commonjs", "--target", "es2020",
  "--jsx", "react-jsx", "--esModuleInterop", "--skipLibCheck", "--strict",
  "src/utils/reasoning.ts", "src/utils/rematch.ts", "src/utils/efficiency.ts",
  "src/components/game/GameEfficiencyPanel.tsx", "src/api/client.ts",
  "src/utils/formatModel.ts",
], { cwd: root, stdio: "pipe" });
writeFileSync(resolve(output, "package.json"), '{"type":"commonjs"}');
const { supportedReasoningEfforts, normalizeReasoningEffort, temperatureApplies } = require(resolve(output, "utils/reasoning.js"));
const { rematchRequest } = require(resolve(output, "utils/rematch.js"));
const { formatRequestCost, formatRequestTokens } = require(resolve(output, "utils/efficiency.js"));
const Panel = require(resolve(output, "components/game/GameEfficiencyPanel.js")).default;
const { getGameEfficiency } = require(resolve(output, "api/client.js"));
const { formatModelLabel } = require(resolve(output, "utils/formatModel.js"));

const model = (reasoning) => ({ id: "test/model", reasoning });
const usage = {
  request_count: 3, retry_count: 1, input_tokens: 100, output_tokens: 20,
  cache_read_tokens: 50, cache_write_tokens: null, cache_hit_ratio: 0.5,
  known_cost_usd: 0.12, total_cost_usd: 0.12, retry_cost_usd: 0.04,
  cost_known_requests: 3, cache_known_requests: 2, avg_move_ms: 12345,
  providers: ["Fixture provider"],
};

test("missing metadata offers no explicit effort and sends provider default", () => {
  for (const metadata of [undefined, model(undefined), model({}), model({ default_effort: "high" })]) {
    assert.deepEqual(supportedReasoningEfforts(metadata), []);
    assert.equal(normalizeReasoningEffort("high", metadata), null);
  }
});

test("reported efforts are intersected with SDK choices and mandatory reasoning", () => {
  const metadata = model({ supported_efforts: ["high", "none", "minimal", "low", "medium", "xhigh", "max", "invalid", "high"], mandatory: true });
  assert.deepEqual(supportedReasoningEfforts(metadata), ["minimal", "low", "medium", "high", "xhigh"]);
  assert.equal(normalizeReasoningEffort("none", metadata), null);
  assert.equal(normalizeReasoningEffort("max", metadata), null);
  assert.equal(normalizeReasoningEffort("minimal", metadata), "minimal");
  assert.equal(normalizeReasoningEffort("", metadata), null);
  assert.equal(normalizeReasoningEffort("high", model({ supported_efforts: ["low"] })), null);
  assert.equal(normalizeReasoningEffort("none", model({ supported_efforts: ["none"] })), "none");
});

test("rematches swap participants, preserve routing and remove unsupported efforts", () => {
  const state = {
    whiteModel: "test/white", blackModel: "test/black", whiteTemperature: 0.3, blackTemperature: null,
    whiteReasoningEffort: "high", blackReasoningEffort: "none", whiteIsHuman: false, blackIsHuman: false,
    whiteIsStockfish: false, blackIsStockfish: false, whiteStockfishElo: null, blackStockfishElo: null,
    chaosMode: false, moveTimeLimit: 60, drawAdjudication: true, routingMode: "responsive",
  };
  const models = [
    { id: "test/white", reasoning: { supported_efforts: ["high"] } },
    { id: "test/black", reasoning: { supported_efforts: ["none", "low"], mandatory: true } },
  ];
  const request = rematchRequest(state, models);
  assert.equal(request.white_model, "test/black");
  assert.equal(request.black_model, "test/white");
  assert.equal(request.white_reasoning_effort, null);
  assert.equal(request.black_reasoning_effort, "high");
  assert.equal(request.black_temperature, null);
  assert.equal(request.routing_mode, "responsive");
  assert.equal(request.use_nitro, undefined);
  assert.equal(rematchRequest({ ...state, routingMode: "economy" }, []).routing_mode, "economy");
  assert.equal(rematchRequest(state, []).black_reasoning_effort, null);
  assert.equal(rematchRequest({ ...state, whiteIsHuman: true }, models).black_reasoning_effort, null);
  const legacy = rematchRequest({ ...state, routingMode: null, useNitro: true }, models);
  assert.equal(legacy.use_nitro, true);
  assert.equal(legacy.routing_mode, undefined);
  assert.equal(rematchRequest({ ...state, routingMode: "economy", useNitro: true }, models).use_nitro, undefined);
});

test("temperature is available only when reasoning resolves to none", () => {
  assert.equal(temperatureApplies(null), false);
  assert.equal(temperatureApplies("none", model({ supported_efforts: ["none", "high"] })), true);
  assert.equal(temperatureApplies("high", model({ supported_efforts: ["none", "high"] })), false);
  assert.equal(temperatureApplies(null, model({ default_effort: "none" })), true);
  assert.equal(temperatureApplies(null, model({ default_effort: "none", default_enabled: true })), false);
  assert.equal(temperatureApplies(null, model({ default_enabled: false, supported_efforts: ["none"] })), true);
  assert.equal(temperatureApplies(null, model({ default_enabled: false })), false);
  assert.equal(temperatureApplies("none", model({ mandatory: true, supported_efforts: ["none", "high"] })), false);
  assert.equal(rematchRequest({ whiteModel: "test/model", whiteReasoningEffort: "none", whiteTemperature: 0.3 }, [model({ supported_efforts: ["none"] })]).black_temperature, 0.3);
});

test("internal provider defaults have a readable label and never enter request effort", () => {
  assert.equal(formatModelLabel("test/model", "provider_default", null), "model (Provider default)");
  assert.equal(normalizeReasoningEffort("provider_default", model({ supported_efforts: ["high"] })), null);
});

test("cost formatting distinguishes complete, partial, unknown, zero and historical", () => {
  assert.equal(formatRequestCost(usage), "$0.1200");
  assert.equal(formatRequestCost({ ...usage, total_cost_usd: null, cost_known_requests: 2 }), "$0.1200 known · partial");
  assert.equal(formatRequestCost({ ...usage, total_cost_usd: null, cost_known_requests: 0 }), "Unknown");
  assert.equal(formatRequestCost({ ...usage, total_cost_usd: 0 }), "$0.0000");
  assert.equal(formatRequestCost({ ...usage, request_count: 0, total_cost_usd: 0 }), "Not recorded");
});

test("request token totals preserve nulls and distinguish zero from historical absence", () => {
  assert.equal(formatRequestTokens(usage), "120");
  assert.equal(formatRequestTokens({ ...usage, input_tokens: null }), "Unknown");
  assert.equal(formatRequestTokens({ ...usage, output_tokens: null }), "Unknown");
  assert.equal(formatRequestTokens({ ...usage, input_tokens: 0, output_tokens: 0 }), "0");
  assert.equal(formatRequestTokens({ ...usage, request_count: 0 }), "Not recorded");
});

test("panel reports coverage, retries, latency and unknown cache without inventing zero", () => {
  const render = (data, extra = {}) => renderToStaticMarkup(createElement(Panel, { data, error: null, active: false, onRetry() {}, ...extra }));
  const html = render({ ...usage, total_cost_usd: null, cost_known_requests: 2, cache_hit_ratio: null, retry_cost_usd: null });
  assert.match(html, /Spend · all attempts/);
  assert.match(html, /known · partial/);
  assert.match(html, /Retry spend<\/dt><dd>Unknown/);
  assert.match(html, /Cached input<\/dt><dd>Not reported/);
  assert.match(html, /12.3 s/);
  assert.match(html, /Cost reported for 2\/3 requests/);
  assert.match(render(usage), /50.0%/);
  const historical = render({ ...usage, request_count: 0 });
  assert.match(historical, /not recorded for this game/);
  assert.doesNotMatch(historical, /\$/);
  assert.match(render(null), /Loading request usage/);
  assert.match(render(null, { error: "Unavailable" }), /Unavailable/);
});

test("efficiency requests respect caller cancellation", async () => {
  const originalFetch = globalThis.fetch;
  let requestSignal;
  globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
    requestSignal = init.signal;
    init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });
  try {
    const controller = new AbortController();
    const pending = getGameEfficiency("fixture", controller.signal);
    controller.abort();
    assert.equal(requestSignal.aborted, true);
    await assert.rejects(pending);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
