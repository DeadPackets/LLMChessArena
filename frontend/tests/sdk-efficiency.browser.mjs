import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = resolve(import.meta.dirname, "..");
const artifacts = resolve(root, "node_modules/.cache/sdk-efficiency-browser");
mkdirSync(artifacts, { recursive: true });
const server = await createServer({ root, logLevel: "silent", server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const models = [
  { id: "fixture/reasoning", name: "Reasoning fixture", reasoning: { supported_efforts: ["none", "minimal", "low", "high", "xhigh", "max"], mandatory: true, default_effort: "high" } },
  { id: "fixture/unknown", name: "Unknown fixture" },
  { id: "fixture/optional", name: "Optional reasoning fixture", reasoning: { supported_efforts: ["none", "high"], default_effort: "none" } },
].map((model) => ({ ...model, context_length: 10000, pricing_prompt: "0.00001", pricing_completion: "0.00002" }));
const summary = {
  request_count: 3, retry_count: 1, input_tokens: 100, output_tokens: 20,
  cache_read_tokens: 50, cache_write_tokens: null, cache_hit_ratio: 0.5,
  known_cost_usd: 0.12, total_cost_usd: null, retry_cost_usd: 0.04,
  cost_known_requests: 2, cache_known_requests: 2, avg_move_ms: 12345,
  providers: ["Fixture provider"],
};
const summaries = new Map();
const counts = new Map();
const sockets = new Map();
let submitted;
let createdCount = 0;
let failUsage = false;
let slowRoute;
let holdUsage = false;
let heldUsageRoute;
function game(id) {
  return {
    id, game_id: id, white_model: "fixture/reasoning", black_model: "fixture/unknown",
    status: ["history", "legacy"].includes(id) ? "completed" : "active",
    outcome: ["history", "legacy"].includes(id) ? "draw" : null,
    termination: "agreement", moves: [], total_moves: 0,
    white_reasoning_effort: "high", black_reasoning_effort: "provider_default",
    white_temperature: null, black_temperature: null,
    routing_mode: id === "legacy" ? null : "responsive", use_nitro: id === "legacy",
    analysis: null, pgn: "", white_is_human: false, black_is_human: false,
  };
}
async function eventually(check) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await delay(50);
  }
  assert.fail("Browser condition did not settle within 5 seconds");
}
async function navigate(id) {
  await page.evaluate((id) => {
    history.pushState({}, "", `/game/${id}`);
    dispatchEvent(new PopStateEvent("popstate"));
  }, id);
}
await page.route(`${base}/api/**`, async (route) => {
  const path = new URL(route.request().url()).pathname;
  let body;
  if (path === "/api/openrouter/models") body = models;
  else if (path === "/api/games" && route.request().method() === "POST") {
    submitted = route.request().postDataJSON();
    body = { id: createdCount++ === 0 ? "created" : "rematch", status: "active", player_secret: "fixture-only" };
  } else if (path.endsWith("/efficiency")) {
    const id = path.split("/")[3];
    counts.set(id, (counts.get(id) || 0) + 1);
    if (id === "slow") { slowRoute = route; return; }
    if (holdUsage) { heldUsageRoute = route; return; }
    if (failUsage) { await route.fulfill({ status: 503, body: "Fixture error" }); return; }
    body = summaries.get(id) || summary;
  } else if (path === "/api/games") body = { games: [], total_count: 0, has_more: false };
  else if (path === "/api/games/queue-status") body = { active: 1, queued: 0, max: 3, total_spectators: 0, total_games: 1 };
  else if (path.startsWith("/api/games/")) body = game(path.split("/")[3]);
  else if (path === "/api/models/compare") body = { total_games: 0 };
  else body = [];
  await route.fulfill({ json: body });
});
await page.routeWebSocket(/\/ws\/games\//, (socket) => {
  const id = new URL(socket.url()).pathname.split("/").pop();
  sockets.set(id, socket);
  socket.send(JSON.stringify({ type: "catch_up", data: game(id) }));
});

try {
  await page.clock.install();
  await page.goto(base);
  await page.getByRole("button", { name: "New Game", exact: true }).first().click();
  await page.locator("#white-model").fill("fixture/reasoning");
  await page.locator("#white-model-listbox").getByRole("option").click();
  await page.locator("#black-model").fill("Unknown fixture");
  await page.locator("#black-model-listbox").getByRole("option").click();
  await page.getByRole("button", { name: "Show Advanced Settings" }).click();
  assert.deepEqual(await page.locator("#White-reasoning option").evaluateAll((options) => options.map((option) => option.value)), ["", "minimal", "low", "high", "xhigh"]);
  assert.deepEqual(await page.locator("#Black-reasoning option").allTextContents(), ["Provider default"]);
  assert.equal(await page.getByRole("slider", { name: "White temperature", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("slider", { name: "Black temperature", exact: true }).isDisabled(), true);
  await page.locator("#white-model").fill("Optional reasoning fixture");
  await page.locator("#white-model-listbox").getByRole("option").click();
  const temperature = page.getByRole("slider", { name: "White temperature", exact: true });
  assert.equal(await temperature.isEnabled(), true);
  await temperature.focus();
  await temperature.press("ArrowRight");
  assert.equal(await temperature.inputValue(), "0.8");
  await page.locator("#White-reasoning").selectOption("high");
  assert.equal(await temperature.isDisabled(), true);
  await page.locator("#White-reasoning").selectOption("none");
  assert.equal(await temperature.isEnabled(), true);
  assert.equal(await temperature.inputValue(), "0.7");
  await page.locator("#white-model").fill("fixture/reasoning");
  await page.locator("#white-model-listbox").getByRole("option").click();
  await page.locator("#White-reasoning").selectOption("xhigh");
  await page.locator("#white-model").fill("Unknown fixture");
  await page.locator("#white-model-listbox").getByRole("option").click();
  assert.equal(await page.locator("#White-reasoning").inputValue(), "");
  await page.locator("#white-model").fill("fixture/reasoning");
  await page.locator("#white-model-listbox").getByRole("option").click();
  assert.equal(await page.locator("#White-reasoning").inputValue(), "");
  await page.locator("#White-reasoning").selectOption("minimal");
  assert.equal(await page.locator("#routing-mode").inputValue(), "economy");
  await page.locator("#routing-mode").selectOption("responsive");
  await page.screenshot({ path: resolve(artifacts, "dialog-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(artifacts, "dialog-mobile.png"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator("#Black-reasoning").scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(artifacts, "reasoning-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Start Game", exact: true }).click();
  await page.waitForURL("**/game/created");
  assert.equal(submitted.routing_mode, "responsive");
  assert.equal(submitted.use_nitro, undefined);
  assert.equal(submitted.white_reasoning_effort, "minimal");
  assert.equal(submitted.black_reasoning_effort, null);
  assert.equal(submitted.white_temperature, null);
  assert.equal(submitted.black_temperature, null);
  await eventually(async () => (await page.locator(".game-efficiency").textContent())?.includes("known · partial"));
  assert.match(await page.locator(".game-info__cost").textContent(), /\$0.1200 known · partial/);
  assert.match(await page.locator(".game-info__players").textContent(), /Provider default/);
  const usageToggle = page.locator("#game-usage-toggle");
  const usageDetails = page.locator("#game-usage-details");
  assert.equal(await usageToggle.getAttribute("aria-expanded"), "false");
  assert.equal(await usageDetails.isVisible(), false);
  assert.equal(await page.locator(".game-summary #game-usage-details").count(), 1);
  assert.ok((await usageToggle.boundingBox()).height >= 40);
  await page.screenshot({ path: resolve(artifacts, "viewer-mobile.png"), fullPage: true });
  await usageToggle.click();
  assert.equal(await usageDetails.isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: resolve(artifacts, "usage-expanded-mobile.png"), fullPage: true });
  await usageToggle.press("Escape");
  assert.equal(await usageToggle.getAttribute("aria-expanded"), "false");
  assert.equal(await usageToggle.evaluate((button) => document.activeElement === button), true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: resolve(artifacts, "viewer-desktop.png"), fullPage: true });
  await usageToggle.press("Enter");
  assert.equal(await usageToggle.getAttribute("aria-expanded"), "true");
  await page.screenshot({ path: resolve(artifacts, "usage-expanded-desktop.png"), fullPage: true });

  const beforePoll = counts.get("created");
  await page.clock.fastForward(11_000);
  await eventually(() => counts.get("created") > beforePoll);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hiddenCount = counts.get("created");
  await page.clock.fastForward(31_000);
  await delay(100);
  assert.equal(counts.get("created"), hiddenCount);
  await page.evaluate(() => {
    delete document.visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await eventually(() => counts.get("created") > hiddenCount);
  await eventually(async () => (await usageDetails.textContent())?.includes("known · partial"));
  summaries.set("created", { ...summary, total_cost_usd: 0.16, known_cost_usd: 0.16, cost_known_requests: 3, input_tokens: null });
  holdUsage = true;
  const beforeCompletion = counts.get("created");
  sockets.get("created").send(JSON.stringify({ type: "game_over", data: { outcome: "draw", termination: "agreement", total_moves: 0, total_cost_usd: null, total_input_tokens: null, total_output_tokens: null, known_cost_usd: 0.16, known_input_tokens: 100, known_output_tokens: 20 } }));
  await eventually(() => counts.get("created") > beforeCompletion);
  await eventually(() => !!heldUsageRoute);
  assert.match(await page.locator(".game-info__cost").textContent(), /\$0.1200 known · partial/);
  assert.equal(await usageToggle.getAttribute("aria-expanded"), "true");
  assert.doesNotMatch(await usageDetails.textContent(), /Loading request usage/);
  holdUsage = false;
  await heldUsageRoute.fulfill({ json: summaries.get("created") });
  heldUsageRoute = undefined;
  await eventually(async () => (await page.locator(".game-info__cost").textContent()) === "$0.1600");
  await eventually(async () => (await page.locator(".game-over-banner").textContent())?.includes("$0.1600"));
  assert.match(await page.locator(".game-over-banner").textContent(), /Unknown request tokens/);
  await page.screenshot({ path: resolve(artifacts, "completed-unknown-tokens.png"), fullPage: true });
  const completedCount = counts.get("created");
  await page.clock.fastForward(21_000);
  assert.equal(counts.get("created"), completedCount);
  await page.getByRole("button", { name: "Rematch (swap colors)" }).click();
  await page.waitForURL("**/game/rematch");
  await eventually(() => submitted.white_model === "fixture/unknown");
  assert.equal(submitted.routing_mode, "responsive");
  assert.equal(submitted.white_reasoning_effort, null);
  assert.equal(submitted.black_reasoning_effort, "high");

  summaries.set("history", { ...summary, request_count: 0, total_cost_usd: null });
  await navigate("history");
  await eventually(async () => (await page.locator(".game-efficiency").textContent())?.includes("not recorded for this game"));
  assert.doesNotMatch(await page.locator(".game-efficiency").textContent(), /\$/);
  await navigate("legacy");
  await page.getByRole("button", { name: "Rematch (swap colors)" }).click();
  await eventually(() => submitted.use_nitro === true);
  await page.waitForURL("**/game/rematch");
  assert.equal(submitted.routing_mode, undefined);

  failUsage = true;
  await navigate("error");
  await usageToggle.click();
  await page.locator(".game-efficiency").getByRole("button", { name: "Retry" }).waitFor();
  assert.match(await usageToggle.textContent(), /Unavailable/);
  failUsage = false;
  await page.locator(".game-efficiency").getByRole("button", { name: "Retry" }).click();
  await eventually(async () => (await page.locator(".game-efficiency").textContent())?.includes("known · partial"));

  failUsage = true;
  await page.clock.fastForward(11_000);
  await page.locator(".game-efficiency").getByRole("button", { name: "Retry", exact: true }).waitFor();
  assert.match(await usageDetails.textContent(), /Showing the last update/);
  assert.match(await page.locator(".game-info__cost").textContent(), /\$0.1200 known · partial · stale/);
  await page.setViewportSize({ width: 320, height: 740 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: resolve(artifacts, "usage-error-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  failUsage = false;
  holdUsage = true;
  await page.locator(".game-efficiency").getByRole("button", { name: "Retry", exact: true }).click();
  await eventually(() => !!heldUsageRoute);
  assert.equal(await page.getByRole("button", { name: "Retrying…" }).isDisabled(), true);
  assert.match(await page.locator(".game-info__cost").textContent(), /\$0.1200 known · partial/);
  holdUsage = false;
  await heldUsageRoute.fulfill({ json: summary });
  heldUsageRoute = undefined;
  await eventually(async () => !(await usageDetails.textContent())?.includes("Could not update"));

  await navigate("slow");
  await eventually(() => !!slowRoute);
  assert.match(await page.locator(".game-efficiency").textContent(), /Loading request usage/);
  await navigate("next");
  await eventually(async () => (await page.locator(".game-efficiency").textContent())?.includes("known · partial"));
  await slowRoute.fulfill({ json: { ...summary, known_cost_usd: 999 } }).catch(() => {});
  await page.clock.fastForward(11_000);
  assert.doesNotMatch(await page.locator(".game-efficiency").textContent(), /999/);
  assert.deepEqual(errors, []);
  console.log("Browser checks passed: routing, reasoning switch, rematches, legacy Nitro, mobile layout, costs, usage disclosure/keyboard, hidden-tab polling, refresh continuity, completion, retry and stale-game cleanup.");
  console.log(`Screenshots: ${artifacts}`);
} catch (error) {
  console.error(errors, await page.locator("body").innerText());
  await page.screenshot({ path: resolve(artifacts, "failure.png"), fullPage: true });
  throw error;
} finally {
  await browser.close();
  await server.close();
}
