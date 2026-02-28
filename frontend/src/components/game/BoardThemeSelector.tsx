import { useState } from "react";
import { BOARD_COLORS, PIECE_STYLES } from "../../hooks/useBoardTheme";
import type { BoardColorPreset } from "../../hooks/useBoardTheme";

interface Props {
  activeBoardColor: string;
  activePieceStyle: string;
  onBoardColorChange: (id: string) => void;
  onPieceStyleChange: (id: string) => void;
}

export default function BoardThemeSelector({
  activeBoardColor,
  activePieceStyle,
  onBoardColorChange,
  onPieceStyleChange,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="board-theme-selector">
      <button
        className="board-theme-selector__toggle"
        onClick={() => setOpen((v) => !v)}
        title="Board &amp; piece theme"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.8-.1 2.6-.4a1 1 0 0 0 .6-1.3c-.4-1 .2-2.3 1.3-2.3h1.5c2.2 0 4-1.8 4-4 0-5-4.5-9-10-9z"/>
          <circle cx="7.5" cy="11.5" r="1.5"/>
          <circle cx="12" cy="7.5" r="1.5"/>
          <circle cx="16.5" cy="11.5" r="1.5"/>
        </svg>
        Theme
      </button>

      {open && (
        <div className="board-theme-selector__dropdown">
          <div className="board-theme-selector__row">
            <span className="board-theme-selector__label">Board</span>
            <div className="board-theme-selector__swatches">
              {BOARD_COLORS.map((preset: BoardColorPreset) => (
                <button
                  key={preset.id}
                  className={`board-theme-selector__swatch${
                    preset.id === activeBoardColor ? " board-theme-selector__swatch--active" : ""
                  }`}
                  onClick={() => onBoardColorChange(preset.id)}
                  title={preset.label}
                >
                  <span
                    className="board-theme-selector__swatch-inner"
                    style={{
                      background: `linear-gradient(135deg, ${preset.light} 50%, ${preset.dark} 50%)`,
                    }}
                  />
                </button>
              ))}
            </div>
          </div>
          <div className="board-theme-selector__row">
            <span className="board-theme-selector__label">Pieces</span>
            <div className="board-theme-selector__pieces">
              {PIECE_STYLES.map((style) => (
                <button
                  key={style.id}
                  className={`board-theme-selector__piece-btn${
                    style.id === activePieceStyle ? " board-theme-selector__piece-btn--active" : ""
                  }`}
                  onClick={() => onPieceStyleChange(style.id)}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
