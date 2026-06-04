import { useId, useState, useRef, useEffect, useCallback } from "react";

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);

  // Position the tip relative to the trigger using fixed (viewport) coordinates.
  // The tip lives in the top layer (popover) so it is never clipped by an
  // ancestor's overflow:hidden nor painted under a later stacking context —
  // which is what made the old absolutely-positioned tooltip render "behind"
  // panels, tables and the fixed-height game columns.
  const position = useCallback(() => {
    const trigger = triggerRef.current;
    const tip = tipRef.current;
    if (!trigger || !tip) return;
    const t = trigger.getBoundingClientRect();
    const tip_ = tip.getBoundingClientRect();
    const edge = 8; // viewport gutter
    const gap = 6; // space between trigger and tip

    // Prefer above the trigger; flip below when there isn't room.
    let top = t.top - gap - tip_.height;
    let placement: "above" | "below" = "above";
    if (top < edge) {
      top = t.bottom + gap;
      placement = "below";
    }

    // Horizontally centre on the trigger, clamped into the viewport.
    let left = t.left + t.width / 2 - tip_.width / 2;
    left = Math.max(edge, Math.min(left, window.innerWidth - tip_.width - edge));

    tip.style.top = `${Math.round(top)}px`;
    tip.style.left = `${Math.round(left)}px`;
    tip.dataset.placement = placement;
  }, []);

  // Show/hide in the top layer and (re)position when opened.
  useEffect(() => {
    const tip = tipRef.current;
    if (!tip) return;
    const supportsPopover =
      tip.hasAttribute("popover") && typeof tip.showPopover === "function";
    if (open) {
      if (supportsPopover) {
        try {
          tip.showPopover();
        } catch {
          /* already shown */
        }
      }
      position();
    } else if (supportsPopover) {
      try {
        tip.hidePopover();
      } catch {
        /* already hidden */
      }
    }
  }, [open, position]);

  // While open: keep the tip pinned to the trigger and dismiss on Escape / outside.
  useEffect(() => {
    if (!open) return;
    const reflow = () => position();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onPointer(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    // capture:true so we also catch scrolls inside overflow containers.
    window.addEventListener("scroll", reflow, true);
    window.addEventListener("resize", reflow);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("scroll", reflow, true);
      window.removeEventListener("resize", reflow);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, position]);

  return (
    <span
      className="info-dot"
      ref={wrapRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={triggerRef}
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
        ref={tipRef}
        role="tooltip"
        popover="manual"
        className={`info-dot__tip${open ? " info-dot__tip--open" : ""}`}
      >
        {label}
      </span>
    </span>
  );
}
