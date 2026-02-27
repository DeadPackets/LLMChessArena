# LLM Chess Arena — TODO

## Bugs to Fix

### High Priority

1. **~~WebSocket reconnection uses stale state~~** ✅ — ~~`shouldReconnect: () => state.status === "active"` captures a stale closure. If the game ends while disconnected, it won't know to stop reconnecting. Should use a ref.~~

2. **~~Game list has no pagination~~** ✅ — ~~Hardcoded `limit=50` with no offset. Games beyond 50 are invisible. Need infinite scroll or a "load more" button.~~

3. **~~Human move has no server acknowledgment~~** ✅ — ~~Client shows an optimistic FEN immediately after submitting a move, but if the server rejects it, the board shows a phantom position until the next real move arrives.~~

4. **~~No timeout on API fetches~~** ✅ — ~~`client.ts` uses raw `fetch()` with no AbortController timeout. A hung backend makes the entire UI freeze.~~

5. **~~Stats queries have N+1 problem~~** ✅ — ~~`compute_model_aggregate_stats()` and `compute_platform_overview()` query moves per-game in a loop. A model with 100+ games triggers 100+ DB queries. Should be a single aggregation query with JOINs.~~

6. **~~Illegal move counter increment is not atomic~~** ✅ — ~~`game.white_illegal_moves += 1` in game_manager is a read-modify-write without a lock. Concurrent WebSocket events could lose increments (low probability but real).~~

### Medium Priority

7. **~~`timeAgo()` in GameCard never refreshes~~** ✅ — ~~"2m ago" stays static because there's no timer re-rendering the component. Games that say "just now" for hours.~~

8. **~~TableTalkPanel interleaving is fragile~~** ✅ — ~~Sorting illegal/chaos moves by `moveNumber <= m.moveNumber && color === m.color` can mismatch if an illegal attempt for move 10 white gets attached to move 10 black.~~

9. **~~EvalBar mating score can be misleading~~** ✅ — ~~`mateIn > 0` is always displayed as white advantage regardless of whose turn it is. Should clarify perspective.~~

10. **~~OpenRouter model cache is never invalidated~~** ✅ — ~~`fetchOpenRouterModels()` caches module-level in client.ts with no TTL. Models added mid-session are invisible until page refresh.~~

11. **~~Double game creation possible~~** ✅ — ~~No debounce on "Start Game" button. Rapid clicks can fire `createGame()` twice before `submitting` state kicks in.~~

12. **~~`_migrate_add_columns` swallows all exceptions~~** ✅ — ~~If a migration fails for a reason other than "column already exists," the error is silently ignored.~~

---

## Missing Features

### Gameplay & Engine

13. **Time controls** — No clock system. Games take as long as the LLM wants. Adding per-move or per-game time limits (with forfeit on timeout) would make games more exciting and prevent runaway API costs.

14. **Configurable Stockfish strength** — Stockfish always plays at full depth. An ELO-limited mode (via UCI `Skill Level` 0–20) would let users benchmark LLMs against calibrated difficulty.

15. **Draw offers / adjudication** — No way to detect or declare dead draws (e.g., opposite-color bishop endgames played for 80 moves). An auto-adjudication rule (e.g., eval within ±0.2 for 30 moves) would prevent endless games.

16. **Rematch button** — After a game ends, no way to start a new game with the same settings. User has to manually re-enter everything.

17. **Game spectator count** — No indicator of how many people are watching a live game.

### Frontend UX

18. **~~Mobile responsiveness~~** ✅ — ~~The 3-column grid uses fixed widths. Completely broken on tablets and phones.~~

19. **~~Sound effects~~** ✅ — ~~No audio feedback for moves, captures, checks, or game-over.~~

20. **~~Move animations~~** ✅ — ~~The board jumps between positions. Smooth piece animation would make live viewing more engaging.~~

21. **Board themes** — Only one board/piece style. Users typically expect at least 3-4 options.

22. **Board arrows / highlights** — No way to draw arrows or highlight squares for analysis.

23. **Game search and filtering** — Can only filter by status tab. No search by model name, date range, opening, or outcome.

24. **URL-synced filters** — Filter state isn't in the URL. Refreshing resets everything.

25. **Shareable game links with position** — `/game/{id}?move=15` to link to a specific position.

26. **Keyboard shortcut legend** — Arrow keys work but no UI hint tells users.

### Analysis & Stats

27. **Live engine lines** — Show Stockfish's top 3 candidate moves alongside the eval bar.

28. **Head-to-head comparison page** — Pick any two models and see their record and accuracy comparison.

29. **Opening explorer** — Show win rates by opening across all games per model.

30. **ELO history graph** — Track ELO over time per model. Currently only the current rating is stored.

31. **Game annotations / bookmarks** — Let users mark interesting games or positions.

32. **Export analysis as PDF/image** — Share post-game analysis outside the app.

### Platform & Infrastructure

33. **User accounts / authentication** — No login system. Anyone can create games and spend API credits.

34. **Rate limiting** — No throttle on game creation, API calls, or WebSocket connections.

35. **Tournament system** — Round-robin or Swiss tournaments between a pool of models.

36. **Game queueing** — Multiple simultaneous games all run in parallel with no limit.

37. **Configurable max concurrent games** — No limit on how many games can run at once.

38. **Webhook / notifications** — No way to get notified when a game finishes.

39. **Database backups** — SQLite file with no backup strategy.

40. **API rate limit headers** — Backend doesn't return `X-RateLimit-*` headers.

### Data & Observability

41. **Game replay sharing (embed)** — An embeddable replay widget for sharing on blogs/forums.

42. **Prometheus metrics** — No observability. Response times, game counts, error rates should be exported.

43. **Cost alerts** — No way to set a budget cap.

44. **Model display names** — `LLMModel.display_name` field exists but is never populated.

---

## Code Quality Improvements

45. **No test suite** — Zero unit or integration tests.

46. **Logger levels inconsistent** — Game engine logs routine moves at INFO; should be DEBUG.

47. **Hardcoded magic numbers** — K-factor, Stockfish depth, narration cap buried in code rather than config.

48. **No API versioning** — All endpoints at `/api/` with no version prefix.

---

## Priority Order

1. ~~Mobile responsiveness~~ ✅
2. ~~Pagination on game list~~ ✅
3. Tournament system
4. ~~Sound effects + move animations~~ ✅
5. Rate limiting + cost caps
