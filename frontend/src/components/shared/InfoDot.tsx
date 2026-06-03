import { useId, useState, useRef, useEffect } from "react";

interface Props {
  /** The help text shown in the tooltip and exposed to screen readers. */
  label: string;
  /** Optional accessible name for the trigger; defaults to "More information". */
  triggerLabel?: string;
}

export default function InfoDot({ label, triggerLabel = "More information" }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  // Tap-outside / Escape to dismiss the touch-toggled tooltip.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span
      className="info-dot"
      ref={wrapRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="info-dot__trigger"
        aria-label={triggerLabel}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ?
      </button>
      <span
        id={id}
        role="tooltip"
        className={`info-dot__tip${open ? " info-dot__tip--open" : ""}`}
      >
        {label}
      </span>
    </span>
  );
}
