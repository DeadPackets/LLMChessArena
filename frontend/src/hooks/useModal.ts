import { useCallback, useEffect, useId, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export interface UseModalResult {
  /** Attach to the dialog container element. */
  ref: React.RefObject<HTMLElement | null>;
  /** id to attach to the dialog's heading element. */
  titleId: string;
  /** Props to spread onto the dialog container. */
  dialogProps: {
    ref: React.RefObject<HTMLElement | null>;
    role: "dialog";
    "aria-modal": true;
    "aria-labelledby": string;
    tabIndex: -1;
  };
}

/**
 * Accessible-modal behavior: restore focus on close, move focus in on open,
 * trap Tab/Shift+Tab, close on Escape, and lock body scroll while open.
 * The caller owns the `open` flag and renders `null` when closed.
 */
export function useModal(open: boolean, onClose: () => void): UseModalResult {
  const ref = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const previousActive = useRef<HTMLElement | null>(null);

  // Stable Escape handler.
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const focusable = Array.from(
        ref.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => el.offsetParent !== null || el === ref.current);
      if (focusable.length === 0) {
        e.preventDefault();
        ref.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || active === ref.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;

    previousActive.current = document.activeElement as HTMLElement | null;

    // Move focus into the dialog (first focusable, else the container).
    const node = ref.current;
    if (node) {
      const first = node.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? node).focus();
    }

    // Lock body scroll.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      previousActive.current?.focus?.();
    };
  }, [open, onKeyDown]);

  return {
    ref,
    titleId,
    dialogProps: {
      ref,
      role: "dialog",
      "aria-modal": true,
      "aria-labelledby": titleId,
      tabIndex: -1,
    },
  };
}
