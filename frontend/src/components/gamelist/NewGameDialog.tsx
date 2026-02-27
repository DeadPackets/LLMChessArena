import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createGame } from "../../api/client";
import { useOpenRouterModels } from "../../hooks/useOpenRouterModels";
import ModelSelector from "./ModelSelector";

interface Props {
  open: boolean;
  onClose: () => void;
}

const REASONING_OPTIONS = [
  { value: "", label: "Default" },
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

type PlayerType = "llm" | "human" | "stockfish";

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

function ModelSettingsPanel({
  label,
  icon,
  settings,
  onChange,
}: {
  label: string;
  icon: string;
  settings: ModelSettings;
  onChange: (s: ModelSettings) => void;
}) {
  const tempDisplay =
    settings.temperature !== ""
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
          <span className="new-game-dialog__label-hint">{tempDisplay}</span>
        </label>
        <div className="new-game-dialog__range-row">
          <span className="new-game-dialog__range-label">0</span>
          <input
            className="new-game-dialog__range"
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={settings.temperature !== "" ? settings.temperature : "1"}
            onChange={(e) =>
              onChange({ ...settings, temperature: e.target.value })
            }
          />
          <span className="new-game-dialog__range-label">2</span>
        </div>
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
        <label className="new-game-dialog__label">Reasoning Effort</label>
        <select
          className="new-game-dialog__input new-game-dialog__select"
          value={settings.reasoningEffort}
          onChange={(e) =>
            onChange({ ...settings, reasoningEffort: e.target.value })
          }
        >
          {REASONING_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default function NewGameDialog({ open, onClose }: Props) {
  const navigate = useNavigate();
  const { models: openRouterModels, loading: modelsLoading } = useOpenRouterModels();
  const [whiteModel, setWhiteModel] = useState("");
  const [blackModel, setBlackModel] = useState("");
  const [whiteType, setWhiteType] = useState<PlayerType>("llm");
  const [blackType, setBlackType] = useState<PlayerType>("llm");
  const [maxMoves, setMaxMoves] = useState("200");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [whiteSettings, setWhiteSettings] = useState<ModelSettings>({
    temperature: "",
    reasoningEffort: "",
  });
  const [blackSettings, setBlackSettings] = useState<ModelSettings>({
    temperature: "",
    reasoningEffort: "",
  });
  const [chaosMode, setChaosMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const whiteIsLLM = whiteType === "llm";
  const blackIsLLM = blackType === "llm";

  // At least one side must be LLM — disable non-LLM options on the other side
  const whiteNonLLMDisabled = !blackIsLLM;
  const blackNonLLMDisabled = !whiteIsLLM;

  const canSubmit =
    (whiteIsLLM ? whiteModel.trim() !== "" : true) &&
    (blackIsLLM ? blackModel.trim() !== "" : true) &&
    !submitting;

  function handleWhiteTypeChange(t: PlayerType) {
    setWhiteType(t);
    // If both sides would be non-LLM, force the other to LLM
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
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);

    try {
      const wTemp =
        whiteIsLLM && whiteSettings.temperature !== ""
          ? parseFloat(whiteSettings.temperature)
          : null;
      const bTemp =
        blackIsLLM && blackSettings.temperature !== ""
          ? parseFloat(blackSettings.temperature)
          : null;

      const resp = await createGame({
        white_model: whiteIsLLM ? whiteModel.trim() : "",
        black_model: blackIsLLM ? blackModel.trim() : "",
        max_moves: maxMoves ? parseInt(maxMoves, 10) : undefined,
        white_temperature: wTemp,
        black_temperature: bTemp,
        white_reasoning_effort: whiteIsLLM && whiteSettings.reasoningEffort ? whiteSettings.reasoningEffort : null,
        black_reasoning_effort: blackIsLLM && blackSettings.reasoningEffort ? blackSettings.reasoningEffort : null,
        white_is_human: whiteType === "human",
        black_is_human: blackType === "human",
        white_is_stockfish: whiteType === "stockfish",
        black_is_stockfish: blackType === "stockfish",
        chaos_mode: chaosMode,
      });
      if (resp.player_secret) {
        localStorage.setItem(`chess_player_secret_${resp.id}`, resp.player_secret);
      }
      onClose();
      navigate(`/game/${resp.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create game");
    } finally {
      setSubmitting(false);
    }
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  const hasLLMSide = whiteIsLLM || blackIsLLM;

  return (
    <div
      className="dialog-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label="New Game"
    >
      <form className="new-game-dialog panel--elevated" onSubmit={handleSubmit}>
        <div className="new-game-dialog__title">New Game</div>

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
        </div>

        <div className="new-game-dialog__field">
          <label className="new-game-dialog__label" htmlFor="max-moves">
            Max Moves (optional)
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

        {hasLLMSide && (
          <label className="new-game-dialog__checkbox-label">
            <input
              type="checkbox"
              className="new-game-dialog__checkbox"
              checked={chaosMode}
              onChange={(e) => setChaosMode(e.target.checked)}
            />
            Chaos Mode &mdash; Illegal LLM moves are allowed
          </label>
        )}

        {chaosMode && (
          <div className="new-game-dialog__chaos-warning">
            &#9888; Chaos Mode games do not count toward ELO ratings or model statistics.
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
                  settings={whiteSettings}
                  onChange={setWhiteSettings}
                />
              )}
              {blackIsLLM && (
                <ModelSettingsPanel
                  label="Black"
                  icon="&#9818;"
                  settings={blackSettings}
                  onChange={setBlackSettings}
                />
              )}
            </div>
          </div>
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
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={!canSubmit}
          >
            {submitting ? "Creating..." : "Start Game"}
          </button>
        </div>
      </form>
    </div>
  );
}
