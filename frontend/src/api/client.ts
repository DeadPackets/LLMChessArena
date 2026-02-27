import type { GameDetail, ModelStats, EnhancedModelStats, ModelDetailStats, HeadToHeadRecord, CreateGameRequest, GameCreatedResponse, PlatformOverview, OpenRouterModel, PaginatedGamesResponse } from "../types/api";

const BASE = "/api";
const DEFAULT_TIMEOUT_MS = 15_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${res.status}: ${body}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function listGames(params?: {
  status?: string;
  model?: string;
  limit?: number;
  offset?: number;
}): Promise<PaginatedGamesResponse> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.model) qs.set("model", params.model);
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  const query = qs.toString();
  return request<PaginatedGamesResponse>(`/games${query ? `?${query}` : ""}`);
}

export async function getGame(gameId: string): Promise<GameDetail> {
  return request<GameDetail>(`/games/${gameId}`);
}

export async function createGame(req: CreateGameRequest): Promise<GameCreatedResponse> {
  return request<GameCreatedResponse>("/games", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function stopGame(gameId: string, playerSecret: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/games/${gameId}/stop`, {
    method: "POST",
    body: JSON.stringify({ player_secret: playerSecret }),
  });
}

export async function listModels(): Promise<ModelStats[]> {
  return request<ModelStats[]>("/models");
}

export async function getLeaderboard(): Promise<EnhancedModelStats[]> {
  return request<EnhancedModelStats[]>("/models/leaderboard");
}

export async function getModelDetail(modelId: string): Promise<ModelDetailStats> {
  return request<ModelDetailStats>(`/models/${modelId}`);
}

export async function getModelHeadToHead(modelId: string): Promise<HeadToHeadRecord[]> {
  return request<HeadToHeadRecord[]>(`/models/${modelId}/head-to-head`);
}

export async function getStatsOverview(): Promise<PlatformOverview> {
  return request<PlatformOverview>("/stats/overview");
}

// Module-level cache for OpenRouter models (persists across dialog open/close)
let _openRouterCache: OpenRouterModel[] | null = null;

export async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  if (_openRouterCache !== null) return _openRouterCache;
  const models = await request<OpenRouterModel[]>("/openrouter/models");
  _openRouterCache = models;
  return models;
}
