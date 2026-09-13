import type { OpenRouterModel, ReasoningEffort } from "../types/api";

const EFFORTS: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh"];

export function supportedReasoningEfforts(model?: OpenRouterModel): ReasoningEffort[] {
  return EFFORTS.filter((effort) =>
    model?.reasoning?.supported_efforts?.includes(effort)
    && !(effort === "none" && model.reasoning.mandatory),
  );
}

export function normalizeReasoningEffort(
  effort: string | null | undefined,
  model?: OpenRouterModel,
): ReasoningEffort | null {
  return supportedReasoningEfforts(model).find((supported) => supported === effort) ?? null;
}

export function temperatureApplies(effort: string | null | undefined, model?: OpenRouterModel): boolean {
  const selected = normalizeReasoningEffort(effort, model);
  if (selected !== null) return selected === "none";
  const reasoning = model?.reasoning;
  if (!reasoning || reasoning.mandatory) return false;
  const supportsNone = reasoning.supported_efforts?.includes("none") === true;
  if (reasoning.default_enabled === false) return supportsNone;
  return reasoning.default_effort === "none" && reasoning.default_enabled !== true
    && (!reasoning.supported_efforts?.length || supportsNone);
}
