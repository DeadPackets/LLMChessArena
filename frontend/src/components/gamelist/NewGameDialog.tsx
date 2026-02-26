import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createGame } from "../../api/client";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function NewGameDialog({ open, onClose }: Props) {
  const navigate = useNavigate();
  const [whiteModel, setWhiteModel] = useState("");
  const [blackModel, setBlackModel] = useState("");
  const [maxMoves, setMaxMoves] = useState("200");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const canSubmit = whiteModel.trim() && blackModel.trim() && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);

    try {
      const resp = await createGame({
        white_model: whiteModel.trim(),
        black_model: blackModel.trim(),
        max_moves: maxMoves ? parseInt(maxMoves, 10) : undefined,
      });
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

  return (
    <div className="dialog-overlay" onClick={handleOverlayClick} role="dialog" aria-modal="true" aria-label="New Game">
      <form className="new-game-dialog panel--elevated" onSubmit={handleSubmit}>
        <div className="new-game-dialog__title">New Game</div>

        <div className="new-game-dialog__field">
          <label className="new-game-dialog__label" htmlFor="white-model">
            White Model
          </label>
          <input
            id="white-model"
            className="new-game-dialog__input"
            value={whiteModel}
            onChange={(e) => setWhiteModel(e.target.value)}
            placeholder="e.g. openai/gpt-4o"
            autoFocus
          />
        </div>

        <div className="new-game-dialog__field">
          <label className="new-game-dialog__label" htmlFor="black-model">
            Black Model
          </label>
          <input
            id="black-model"
            className="new-game-dialog__input"
            value={blackModel}
            onChange={(e) => setBlackModel(e.target.value)}
            placeholder="e.g. anthropic/claude-sonnet-4"
          />
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

        {error && (
          <div style={{ color: "var(--blunder)", fontSize: "0.82rem", marginTop: "0.5rem" }}>
            {error}
          </div>
        )}

        <div className="new-game-dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
            {submitting ? "Creating..." : "Start Game"}
          </button>
        </div>
      </form>
    </div>
  );
}
