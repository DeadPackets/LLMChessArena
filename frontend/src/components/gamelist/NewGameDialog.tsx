import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { createGame } from "../../api/client";
import { useOpenRouterModels } from "../../hooks/useOpenRouterModels";
import type { CreateGameRequest } from "../../types/api";
import ModelSelector from "./ModelSelector";

export type PlayerType = "llm" | "human" | "stockfish";

export interface RematchSettings extends Partial<CreateGameRequest> {
  whiteType?: PlayerType;
  blackType?: PlayerType;
}

interface Props {
  open: boolean;
  onClose: () => void;
  initialSettings?: RematchSettings;
}

const REASONING_OPTIONS = [
  { value: "", label: "Default" },
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

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
      <label className="new-game-dialog__label">Stockfish Strength</label>
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

export default function NewGameDialog({ open, onClose, initialSettings }: Props) {
  const navigate = useNavigate();
  const { models: openRouterModels, loading: modelsLoading } = useOpenRouterModels();
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
  const [drawAdjudication, setDrawAdjudication] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

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

  if (!open) return null;

  const whiteIsLLM = whiteType === "llm";
  const blackIsLLM = blackType === "llm";

  const whiteNonLLMDisabled = !blackIsLLM;
  const blackNonLLMDisabled = !whiteIsLLM;

  const canSubmit =
    (whiteIsLLM ? whiteModel.trim() !== "" : true) &&
    (blackIsLLM ? blackModel.trim() !== "" : true) &&
    !submitting;

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
        white_stockfish_elo: whiteType === "stockfish" && whiteStockfishElo ? parseInt(whiteStockfishElo, 10) : null,
        black_stockfish_elo: blackType === "stockfish" && blackStockfishElo ? parseInt(blackStockfishElo, 10) : null,
        chaos_mode: chaosMode,
        move_time_limit: moveTimeLimit ? parseInt(moveTimeLimit, 10) : null,
        draw_adjudication: drawAdjudication,
      });
      if (resp.player_secret) {
        localStorage.setItem(`chess_player_secret_${resp.id}`, resp.player_secret);
      }
      onClose();
      navigate(`/game/${resp.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create game");
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

        {hasLimitedStockfish && (
          <div className="new-game-dialog__chaos-warning">
            &#9888; Games with strength-limited Stockfish do not count toward ELO ratings or model statistics.
          </div>
        )}

        <label className="new-game-dialog__checkbox-label">
          <input
            type="checkbox"
            className="new-game-dialog__checkbox"
            checked={drawAdjudication}
            onChange={(e) => setDrawAdjudication(e.target.checked)}
          />
          Draw Adjudication &mdash; Auto-draw if eval within &plusmn;0.20 for 30 moves
        </label>

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
