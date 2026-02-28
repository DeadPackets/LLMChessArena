/**
 * Shared model name formatting utilities.
 * Centralizes the logic previously duplicated across 7+ components.
 */

export function formatModelName(
  modelId: string | null,
  displayName?: string | null,
): string {
  if (!modelId) return "Unknown";
  if (displayName) return displayName;
  const parts = modelId.split("/");
  return parts[parts.length - 1];
}

export function formatModelLabel(
  modelId: string | null,
  reasoningEffort: string | null,
  temperature: number | null,
  displayName?: string | null,
): string {
  let label = formatModelName(modelId, displayName);
  const suffixes: string[] = [];
  if (reasoningEffort) suffixes.push(`${reasoningEffort}`);
  if (temperature !== null) suffixes.push(`temp: ${temperature.toFixed(1)}`);
  if (suffixes.length > 0) label += ` (${suffixes.join(", ")})`;
  return label;
}
