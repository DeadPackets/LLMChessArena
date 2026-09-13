import type { GameEfficiency } from "../types/api";

export function formatRequestCost(data: GameEfficiency): string {
  if (data.request_count === 0) return "Not recorded";
  if (data.total_cost_usd !== null) return `$${data.total_cost_usd.toFixed(4)}`;
  if (data.cost_known_requests === 0) return "Unknown";
  return `$${data.known_cost_usd.toFixed(4)} known · partial`;
}

export function formatRequestTokens(data: GameEfficiency): string {
  if (data.request_count === 0) return "Not recorded";
  if (data.input_tokens === null || data.output_tokens === null) return "Unknown";
  return (data.input_tokens + data.output_tokens).toLocaleString();
}
