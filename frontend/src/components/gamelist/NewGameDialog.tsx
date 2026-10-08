import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { createGame, getQueueStatus } from "../../api/client";
import { getAdminToken } from "../../utils/admin";
import Turnstile from "./Turnstile";
import { useOpenRouterModels } from "../../hooks/useOpenRouterModels";
import type { CreateGameRequest, OpenRouterModel, QueueStatus, RoutingMode } from "../../types/api";
import { normalizeReasoningEffort, supportedReasoningEfforts, temperatureApplies } from "../../utils/reasoning";
import ModelSelector from "./ModelSelector";
import { useModal } from "../../hooks/useModal";
import InfoDot from "../shared/InfoDot";
import { HELP } from "../shared/helpText";

export type PlayerType = "llm" | "human" | "stockfish";

export interface RematchSettings extends Partial<Omit<CreateGameRequest, "routing_mode" | "white_reasoning_effort" | "black_reasoning_effort">> {
  whiteType?: PlayerType;
  blackType?: PlayerType;
  routing_mode?: RoutingMode | null;
  white_reasoning_effort?: string | null;
  black_reasoning_effort?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  initialSettings?: RematchSettings;
}

const STOCKFISH_PRESETS = [
  { label: "Maximum (no limit)", value: "" },
  { label: "Beginner (1320)", value: "1320" },
  { label: "Club (1500)", value: "1500" },
  { label: "Intermediate (1800)", value: "1800" },
  { label: "Advanced (2000)", value: "2000" },
  { label: "Expert (2500)", value: "2500" },
  { label: "Master (2800)", value: "2800" },
];

interface ModelSettings {
  temperature: string;
  reasoningEffort: string;
}

function PlayerTypeToggle({
  value,
  onChange,
  disableNonLLM,
}: {
  value: PlayerType;
  onChange: (v: PlayerType) => void;
  disableNonLLM?: boolean;
}) {
  return (
    <div className="player-type-toggle">
      <button
        type="button"
        className={`player-type-toggle__btn${value === "llm" ? " player-type-toggle__btn--active" : ""}`}
        onClick={() => onChange("llm")}
      >
        LLM
      </button>
      <button
        type="button"
        className={`player-type-toggle__btn${value === "human" ? " player-type-toggle__btn--active" : ""}`}
        onClick={() => !disableNonLLM && onChange("human")}
        disabled={disableNonLLM}
        title={disableNonLLM ? "At least one side must be an LLM" : undefined}
      >
        Human
      </button>
      <button
        type="button"
        className={`player-type-toggle__btn${value === "stockfish" ? " player-type-toggle__btn--active" : ""}`}
        onClick={() => !disableNonLLM && onChange("stockfish")}
        disabled={disableNonLLM}
        title={disableNonLLM ? "At least one side must be an LLM" : undefined}
      >
        Stockfish
      </button>
    </div>
  );
}

function StockfishEloSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="new-game-dialog__stockfish-elo">
      <label className="new-game-dialog__label">
        Stockfish Strength
        <InfoDot label={HELP.stockfishElo} />
      </label>
      <select
        className="new-game-dialog__input new-game-dialog__select"
        value={STOCKFISH_PRESETS.some((p) => p.value === value) ? value : "custom"}
        onChange={(e) => {
          if (e.target.value === "custom") return;
          onChange(e.target.value);
        }}
      >
        {STOCKFISH_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
        {!STOCKFISH_PRESETS.some((p) => p.value === value) && value && (
          <option value="custom">Custom ({value})</option>
        )}
      </select>
      {value && (
        <div className="new-game-dialog__range-row" style={{ marginTop: "0.4rem" }}>
          <span className="new-game-dialog__range-label">1320</span>
          <input
            className="new-game-dialog__range"
            type="range"
            min="1320"
            max="3190"
            step="10"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label="Stockfish ELO strength"
            aria-valuetext={`${value} ELO`}
          />
          <span className="new-game-dialog__range-label">3190</span>
        </div>
      )}
    </div>
  );
}

function ModelSettingsPanel({
  label,
  icon,
  model,
  settings,
  onChange,
}: {
  label: string;
  icon: string;
  model?: OpenRouterModel;
  settings: ModelSettings;
  onChange: (s: ModelSettings) => void;
}) {
  const canSetTemperature = temperatureApplies(settings.reasoningEffort, model);
  const tempDisplay = !canSetTemperature ? "provider controlled"
    : settings.temperature !== ""
      ? parseFloat(settings.temperature).toFixed(1)
      : "default";

  return (
    <div className="new-game-dialog__model-settings">
      <div className="new-game-dialog__model-settings-header">
        <span className="new-game-dialog__model-settings-icon">{icon}</span>
        {label}
      </div>

      <div className="new-game-dialog__field">
        <label className="new-game-dialog__label">
          Temperature
          <InfoDot label={HELP.temperature} />
          <span className="new-game-dialog__label-hint">{tempDisplay}</span>
        </label>
        <div className="new-game-dialog__range-row">
          <span className="new-game-dialog__range-label">0</span>
          <input
            className="new-game-dialog__range"
            type="range"
            disabled={!canSetTemperature}
            min="0"
            max="2"
            step="0.1"
            value={settings.temperature !== "" ? settings.temperature : "0.7"}
            onChange={(e) =>
              onChange({ ...settings, temperature: e.target.value })
            }
            aria-label={`${label} temperature`}
            aria-valuetext={
              !canSetTemperature ? "provider controlled" : settings.temperature !== ""
                ? parseFloat(settings.temperature).toFixed(1)
                : "default (0.7)"
            }
          />
          <span className="new-game-dialog__range-label">2</span>
        </div>
        {!canSetTemperature && (
          <p className="new-game-dialog__setting-help">Temperature is controlled by the provider for this reasoning setting.</p>
        )}
        <button
          type="button"
          className="new-game-dialog__reset-btn"
          onClick={() => onChange({ ...settings, temperature: "" })}
          style={{
            visibility: settings.temperature !== "" ? "visible" : "hidden",
          }}
        >
          Reset to default
        </button>
      </div>

      <div className="new-game-dialog__field">
        <label className="new-game-dialog__label" htmlFor={`${label}-reasoning`}>
          Reasoning Effort
          <InfoDot label={HELP.reasoning} />
        </label>
        <select
          id={`${label}-reasoning`}
          className="new-game-dialog__input new-game-dialog__select"
          value={normalizeReasoningEffort(settings.reasoningEffort, model) ?? ""}
          onChange={(e) =>
            onChange({
              ...settings,
              reasoningEffort: e.target.value,
              temperature: temperatureApplies(e.target.value, model) ? settings.temperature : "",
            })
          }
        >
          <option value="">Provider default</option>
          {supportedReasoningEfforts(model).map((effort) => (
            <option key={effort} value={effort}>
              {effort === "xhigh" ? "Extra high" : effort.charAt(0).toUpperCase() + effort.slice(1)}
            </option>
          ))}
        </select>
        <p className="new-game-dialog__setting-help">
          {!model?.reasoning ? "Reasoning options are not reported for this model."
            : model.reasoning.mandatory ? "This model requires reasoning."
              : "Only efforts reported by this model are available."}
        </p>
      </div>
    </div>
  );
}

export default function NewGameDialog({ open, onClose, initialSettings }: Props) {
  const navigate = useNavigate();
  const { models: openRouterModels, loading: modelsLoading } = useOpenRouterModels(open);
  const [whiteModel, setWhiteModel] = useState("");
  const [blackModel, setBlackModel] = useState("");
  const [whiteType, setWhiteType] = useState<PlayerType>("llm");
  const [blackType, setBlackType] = useState<PlayerType>("llm");
  const [maxMoves, setMaxMoves] = useState("200");
  const [moveTimeLimit, setMoveTimeLimit] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [whiteSettings, setWhiteSettings] = useState<ModelSettings>({
    temperature: "",
    reasoningEffort: "",
  });
  const [blackSettings, setBlackSettings] = useState<ModelSettings>({
    temperature: "",
    reasoningEffort: "",
  });
  const [whiteStockfishElo, setWhiteStockfishElo] = useState("");
  const [blackStockfishElo, setBlackStockfishElo] = useState("");
  const [chaosMode, setChaosMode] = useState(false);
  const [routingMode, setRoutingMode] = useState<RoutingMode | "legacy">("economy");
  const [drawAdjudication, setDrawAdjudication] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [serverInfo, setServerInfo] = useState<QueueStatus | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);
  const { ref: dialogRef, titleId } = useModal(open, onClose);
  const adminToken = getAdminToken();

  useEffect(() => {
    if (!open) return;
    getQueueStatus().then(setServerInfo).catch(() => setServerInfo(null));
  }, [open]);

  // Pre-fill from initialSettings (rematch)
  useEffect(() => {
    if (open && initialSettings) {
      setWhiteModel(initialSettings.white_model || "");
      setBlackModel(initialSettings.black_model || "");
      setWhiteType(initialSettings.whiteType || "llm");
      setBlackType(initialSettings.blackType || "llm");
      setMaxMoves(String(initialSettings.max_moves ?? 200));
      setMoveTimeLimit(initialSettings.move_time_limit ? String(initialSettings.move_time_limit) : "");
      setChaosMode(initialSettings.chaos_mode ?? false);
      setRoutingMode(initialSettings.routing_mode ?? (initialSettings.use_nitro ? "legacy" : "economy"));
      setDrawAdjudication(initialSettings.draw_adjudication ?? true);
      setWhiteStockfishElo(initialSettings.white_stockfish_elo ? String(initialSettings.white_stockfish_elo) : "");
      setBlackStockfishElo(initialSettings.black_stockfish_elo ? String(initialSettings.black_stockfish_elo) : "");
      setWhiteSettings({
        temperature: initialSettings.white_temperature != null ? String(initialSettings.white_temperature) : "",
        reasoningEffort: initialSettings.white_reasoning_effort || "",
      });
      setBlackSettings({
        temperature: initialSettings.black_temperature != null ? String(initialSettings.black_temperature) : "",
        reasoningEffort: initialSettings.black_reasoning_effort || "",
      });
      if (initialSettings.white_temperature != null || initialSettings.white_reasoning_effort
          || initialSettings.black_temperature != null || initialSettings.black_reasoning_effort) {
        setShowAdvanced(true);
      }
    }
  }, [open, initialSettings]);

  const whiteMetadata = openRouterModels.find((model) => model.id === whiteModel);
  const blackMetadata = openRouterModels.find((model) => model.id === blackModel);

  useEffect(() => {
    if (modelsLoading) return;
    setWhiteSettings((settings) => ({
      ...settings,
      reasoningEffort: normalizeReasoningEffort(settings.reasoningEffort, whiteMetadata) ?? "",
      temperature: temperatureApplies(settings.reasoningEffort, whiteMetadata) ? settings.temperature : "",
    }));
    setBlackSettings((settings) => ({
      ...settings,
      reasoningEffort: normalizeReasoningEffort(settings.reasoningEffort, blackMetadata) ?? "",
      temperature: temperatureApplies(settings.reasoningEffort, blackMetadata) ? settings.temperature : "",
    }));
  }, [whiteMetadata, blackMetadata, modelsLoading, whiteSettings.reasoningEffort, blackSettings.reasoningEffort]);

  if (!open) return null;

  const whiteIsLLM = whiteType === "llm";
  const blackIsLLM = blackType === "llm";

  const whiteNonLLMDisabled = !blackIsLLM;
  const blackNonLLMDisabled = !whiteIsLLM;

  const siteKey = adminToken ? null : serverInfo?.turnstile_site_key ?? null;
  const llmUnavailable = serverInfo?.llm_unavailable ?? null;
  const canSubmit =
    (whiteIsLLM ? whiteModel.trim() !== "" : true) &&
    (blackIsLLM ? blackModel.trim() !== "" : true) &&
    (!siteKey || turnstileToken !== null) &&
    !llmUnavailable &&
    !submitting;

  const disabledReason =
    submitting
      ? null
      : llmUnavailable
        ? llmUnavailable
      : whiteIsLLM && whiteModel.trim() === "" && blackIsLLM && blackModel.trim() === ""
        ? "Select a model for both LLM sides to start."
        : whiteIsLLM && whiteModel.trim() === ""
          ? "Select a model for White to start."
          : blackIsLLM && blackModel.trim() === ""
            ? "Select a model for Black to start."
            : siteKey && turnstileToken === null
              ? "Complete the human check to start."
              : null;

  function handleWhiteTypeChange(t: PlayerType) {
    setWhiteType(t);
    if (t !== "llm" && blackType !== "llm") {
      setBlackType("llm");
    }
  }

  function handleBlackTypeChange(t: PlayerType) {
    setBlackType(t);
    if (t !== "llm" && whiteType !== "llm") {
      setWhiteType("llm");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submittingRef.current) return;

    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const wTemp =
        whiteIsLLM && temperatureApplies(whiteSettings.reasoningEffort, whiteMetadata) && whiteSettings.temperature !== ""
          ? parseFloat(whiteSettings.temperature)
          : null;
      const bTemp =
        blackIsLLM && temperatureApplies(blackSettings.reasoningEffort, blackMetadata) && blackSettings.temperature !== ""
          ? parseFloat(blackSettings.temperature)
          : null;

      const resp = await createGame({
        white_model: whiteIsLLM ? whiteModel.trim() : "",
        black_model: blackIsLLM ? blackModel.trim() : "",
        max_moves: maxMoves ? parseInt(maxMoves, 10) : undefined,
        white_temperature: wTemp,
        black_temperature: bTemp,
        white_reasoning_effort: whiteIsLLM ? normalizeReasoningEffort(whiteSettings.reasoningEffort, whiteMetadata) : null,
        black_reasoning_effort: blackIsLLM ? normalizeReasoningEffort(blackSettings.reasoningEffort, blackMetadata) : null,
        white_is_human: whiteType === "human",
        black_is_human: blackType === "human",
        white_is_stockfish: whiteType === "stockfish",
        black_is_stockfish: blackType === "stockfish",
        white_stockfish_elo: whiteType === "stockfish" && whiteStockfishElo ? parseInt(whiteStockfishElo, 10) : null,
        black_stockfish_elo: blackType === "stockfish" && blackStockfishElo ? parseInt(blackStockfishElo, 10) : null,
        chaos_mode: chaosMode,
        move_time_limit: moveTimeLimit ? parseInt(moveTimeLimit, 10) : null,
        draw_adjudication: drawAdjudication,
        ...(routingMode === "legacy" ? { use_nitro: true } : { routing_mode: routingMode }),
        turnstile_token: siteKey ? turnstileToken : null,
      }, adminToken);
      if (resp.player_secret) {
        try {
          localStorage.setItem(`chess_player_secret_${resp.id}`, resp.player_secret);
        } catch {
          // Storage blocked: the game still starts, this browser just spectates.
        }
      }
      onClose();
      navigate(`/game/${resp.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create game");
      // Turnstile tokens are single-use; get a fresh one for the retry.
      setTurnstileToken(null);
      setTurnstileKey((k) => k + 1);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  const hasLLMSide = whiteIsLLM || blackIsLLM;
  const hasLimitedStockfish = (whiteType === "stockfish" && whiteStockfishElo !== "") || (blackType === "stockfish" && blackStockfishElo !== "");

  return (
    <div className="dialog-overlay" onClick={handleOverlayClick}>
      <form
        ref={dialogRef as React.RefObject<HTMLFormElement>}
        className="new-game-dialog panel--elevated"
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId} className="new-game-dialog__title">New Game</h2>

        <div className="new-game-dialog__field">
          <label className="new-game-dialog__label" htmlFor="white-model">
            White
          </label>
          <PlayerTypeToggle
            value={whiteType}
            onChange={handleWhiteTypeChange}
            disableNonLLM={whiteNonLLMDisabled}
          />
          {whiteIsLLM && (
            <ModelSelector
              id="white-model"
              models={openRouterModels}
              loading={modelsLoading}
              value={whiteModel}
              onChange={setWhiteModel}
              placeholder="Search models... (e.g. gpt-4o, claude)"
              autoFocus
            />
          )}
          {whiteType === "stockfish" && (
            <StockfishEloSelector value={whiteStockfishElo} onChange={setWhiteStockfishElo} />
          )}
        </div>

        <div className="new-game-dialog__field">
          <label className="new-game-dialog__label" htmlFor="black-model">
            Black
          </label>
          <PlayerTypeToggle
            value={blackType}
            onChange={handleBlackTypeChange}
            disableNonLLM={blackNonLLMDisabled}
          />
          {blackIsLLM && (
            <ModelSelector
              id="black-model"
              models={openRouterModels}
              loading={modelsLoading}
              value={blackModel}
              onChange={setBlackModel}
              placeholder="Search models... (e.g. gemini, qwen)"
            />
          )}
          {blackType === "stockfish" && (
            <StockfishEloSelector value={blackStockfishElo} onChange={setBlackStockfishElo} />
          )}
        </div>

        <div className="new-game-dialog__field">
          <label className="new-game-dialog__label" htmlFor="max-moves">
            Max Moves (optional)
            <InfoDot label={HELP.maxMoves} />
          </label>
          <input
            id="max-moves"
            className="new-game-dialog__input"
            type="number"
            value={maxMoves}
            onChange={(e) => setMaxMoves(e.target.value)}
            placeholder="200"
            min="10"
            max="500"
          />
        </div>

        <div className="new-game-dialog__field">
          <label className="new-game-dialog__label" htmlFor="move-time-limit">
            Time per Move (seconds, optional)
          </label>
          <input
            id="move-time-limit"
            className="new-game-dialog__input"
            type="number"
            value={moveTimeLimit}
            onChange={(e) => setMoveTimeLimit(e.target.value)}
            placeholder="No limit"
            min="5"
            max="600"
          />
        </div>

        {hasLLMSide && (
          <div className="new-game-dialog__checkbox-row">
            <label className="new-game-dialog__checkbox-label">
              <input
                type="checkbox"
                className="new-game-dialog__checkbox"
                checked={chaosMode}
                onChange={(e) => setChaosMode(e.target.checked)}
              />
              Chaos Mode &mdash; Illegal LLM moves are allowed
            </label>
            <InfoDot label={HELP.chaos} />
          </div>
        )}

        {chaosMode && (
          <div className="new-game-dialog__chaos-warning">
            &#9888; Chaos Mode games do not count toward ELO ratings or model statistics.
          </div>
        )}

        {hasLimitedStockfish && (
          <div className="new-game-dialog__chaos-warning">
            &#9888; Games with strength-limited Stockfish do not count toward ELO ratings or model statistics.
          </div>
        )}

        <div className="new-game-dialog__checkbox-row">
          <label className="new-game-dialog__checkbox-label">
            <input
              type="checkbox"
              className="new-game-dialog__checkbox"
              checked={drawAdjudication}
              onChange={(e) => setDrawAdjudication(e.target.checked)}
            />
            Draw Adjudication &mdash; Auto-draw if eval within &plusmn;0.20 for 30 moves
          </label>
          <InfoDot label={HELP.drawAdjudication} />
        </div>

        {hasLLMSide && (
          <div className="new-game-dialog__field">
            <label className="new-game-dialog__label" htmlFor="routing-mode">
              Provider routing
              <InfoDot label={HELP.routing} />
            </label>
            <select
              id="routing-mode"
              className="new-game-dialog__input new-game-dialog__select"
              value={routingMode}
              onChange={(e) => setRoutingMode(e.target.value as RoutingMode)}
              aria-describedby="routing-help"
            >
              <option value="economy">Economy</option>
              <option value="responsive">Responsive</option>
              {routingMode === "legacy" && <option value="legacy">Legacy Nitro</option>}
            </select>
            <p id="routing-help" className="new-game-dialog__setting-help">
              {routingMode === "legacy"
                ? "Keeps this game's Nitro routing. Choose Economy or Responsive to change it."
                : routingMode === "economy"
                ? "Prioritizes price and includes flex providers."
                : "Prioritizes provider latency for the selected model."}
            </p>
          </div>
        )}

        {hasLLMSide && (
          <button
            type="button"
            className="new-game-dialog__advanced-toggle"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? "Hide" : "Show"} Advanced Settings
            <span
              className={`new-game-dialog__advanced-chevron${showAdvanced ? " new-game-dialog__advanced-chevron--open" : ""}`}
            >
              &#9662;
            </span>
          </button>
        )}

        {showAdvanced && (
          <div className="new-game-dialog__advanced">
            <div className="new-game-dialog__settings-grid">
              {whiteIsLLM && (
                <ModelSettingsPanel
                  label="White"
                  icon="&#9812;"
                  model={whiteMetadata}
                  settings={whiteSettings}
                  onChange={setWhiteSettings}
                />
              )}
              {blackIsLLM && (
                <ModelSettingsPanel
                  label="Black"
                  icon="&#9818;"
                  model={blackMetadata}
                  settings={blackSettings}
                  onChange={setBlackSettings}
                />
              )}
            </div>
          </div>
        )}

        {serverInfo && serverInfo.games_per_day > 0 && !adminToken && (
          <p className="new-game-dialog__setting-help">
            Each person can start {serverInfo.games_per_day} game{serverInfo.games_per_day === 1 ? "" : "s"} every 24 hours.
          </p>
        )}

        {siteKey && (
          <Turnstile key={turnstileKey} siteKey={siteKey} onToken={setTurnstileToken} />
        )}

        {error && (
          <div
            style={{
              color: "var(--blunder)",
              fontSize: "0.82rem",
              marginTop: "0.5rem",
            }}
          >
            {error}
          </div>
        )}

        <div className="new-game-dialog__actions">
          {disabledReason && (
            <span id="start-game-hint" className="new-game-dialog__disabled-hint">{disabledReason}</span>
          )}
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={!canSubmit}
            title={disabledReason ?? undefined}
            aria-describedby={disabledReason ? "start-game-hint" : undefined}
          >
            {submitting ? "Creating..." : "Start Game"}
          </button>
        </div>
      </form>
    </div>
  );
}
