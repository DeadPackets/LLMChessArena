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
  return (
    <div className="board-theme-selector">
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
  );
}
