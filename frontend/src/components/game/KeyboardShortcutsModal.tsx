interface Props {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ["\u2190"], label: "Previous move" },
  { keys: ["\u2192"], label: "Next move" },
  { keys: ["Home"], label: "First move" },
  { keys: ["End"], label: "Last move" },
  { keys: ["?"], label: "Toggle this help" },
  { keys: ["Right-click"], label: "Highlight square" },
  { keys: ["Right-drag"], label: "Draw arrow" },
  { keys: ["Esc"], label: "Close dialog" },
];

export default function KeyboardShortcutsModal({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="keyboard-shortcuts-modal panel" onClick={(e) => e.stopPropagation()}>
        <div className="keyboard-shortcuts-modal__header">
          <h3 className="keyboard-shortcuts-modal__title">Keyboard Shortcuts</h3>
          <button className="keyboard-shortcuts-modal__close" onClick={onClose}>&times;</button>
        </div>
        <div className="keyboard-shortcuts-modal__list">
          {SHORTCUTS.map((s) => (
            <div key={s.label} className="keyboard-shortcuts-modal__row">
              <div className="keyboard-shortcuts-modal__keys">
                {s.keys.map((k) => (
                  <kbd key={k} className="keyboard-shortcuts-modal__kbd">{k}</kbd>
                ))}
              </div>
              <span className="keyboard-shortcuts-modal__label">{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
