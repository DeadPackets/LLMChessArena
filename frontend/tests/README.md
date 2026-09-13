Run from `frontend/`:

```sh
node --test tests/sdk-efficiency.test.mjs
npm run build
```

The regression checks use Node assertions, the existing TypeScript compiler, and React's server renderer. No added dependencies are needed.

The optional browser check uses an externally available Playwright installation and installed Google Chrome:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/sdk-efficiency.browser.mjs
```

It starts and stops a local Vite server and intercepts every API request and game WebSocket with fixtures. It makes no paid game calls. Checks cover routing, model switches, mandatory reasoning, rematches, legacy Nitro, partial and unknown totals, historical absence, polling, completion refresh, retry, and stale-game cleanup.

Screenshots are saved to `node_modules/.cache/sdk-efficiency-browser/`: desktop and mobile dialog/viewer views, mobile reasoning controls, and completed games with unknown token totals. These are fixture evidence, not cost or latency measurements.
