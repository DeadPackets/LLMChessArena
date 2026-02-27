import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { OpenRouterModel } from "../../types/api";

interface Props {
  id: string;
  models: OpenRouterModel[];
  loading: boolean;
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

function formatPrice(perToken: string): string {
  const perMillion = parseFloat(perToken) * 1_000_000;
  if (perMillion === 0) return "free";
  if (perMillion < 0.01) return "<$0.01";
  return `$${perMillion.toFixed(2)}`;
}

function formatContext(ctx: number): string {
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(1)}M`;
  if (ctx >= 1_000) return `${Math.round(ctx / 1_000)}k`;
  return String(ctx);
}

export default function ModelSelector({
  id,
  models,
  loading,
  value,
  onChange,
  placeholder,
  autoFocus,
}: Props) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedModel = models.find((m) => m.id === value);
  const displayValue = isOpen ? query : (selectedModel?.name ?? value);

  const filtered = useMemo(() => {
    if (!query.trim()) return models;
    const q = query.toLowerCase();
    return models.filter(
      (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
    );
  }, [models, query]);

  // Reset highlight when filtered list changes
  useEffect(() => {
    setHighlightIndex(0);
  }, [filtered]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const item = listRef.current.children[highlightIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightIndex, isOpen]);

  const selectModel = useCallback(
    (model: OpenRouterModel) => {
      onChange(model.id);
      setQuery("");
      setIsOpen(false);
    },
    [onChange],
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[highlightIndex]) selectModel(filtered[highlightIndex]);
        break;
      case "Escape":
        setIsOpen(false);
        break;
    }
  }

  return (
    <div className="model-selector" ref={containerRef}>
      <input
        id={id}
        ref={inputRef}
        className="new-game-dialog__input model-selector__input"
        value={displayValue}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange("");
          if (!isOpen) setIsOpen(true);
        }}
        onFocus={() => {
          setQuery("");
          setIsOpen(true);
        }}
        placeholder={loading ? "Loading models..." : (placeholder ?? "Search models...")}
        disabled={loading}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={
          isOpen && filtered[highlightIndex]
            ? `${id}-option-${highlightIndex}`
            : undefined
        }
        onKeyDown={handleKeyDown}
      />

      {value && !isOpen && (
        <button
          type="button"
          className="model-selector__clear"
          onClick={() => {
            onChange("");
            setQuery("");
            inputRef.current?.focus();
          }}
          aria-label="Clear selection"
        >
          &times;
        </button>
      )}

      {isOpen && (
        <ul
          id={`${id}-listbox`}
          ref={listRef}
          className="model-selector__dropdown"
          role="listbox"
        >
          {filtered.length === 0 ? (
            <li className="model-selector__empty">
              {query ? "No models match your search" : "No models available"}
            </li>
          ) : (
            filtered.map((m, i) => (
              <li
                key={m.id}
                id={`${id}-option-${i}`}
                className={`model-selector__option${
                  i === highlightIndex ? " model-selector__option--highlighted" : ""
                }${m.id === value ? " model-selector__option--selected" : ""}`}
                role="option"
                aria-selected={m.id === value}
                onMouseEnter={() => setHighlightIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectModel(m);
                }}
              >
                <div className="model-selector__option-top">
                  <span className="model-selector__option-name">{m.name}</span>
                  <span className="model-selector__option-ctx">
                    {formatContext(m.context_length)}
                  </span>
                </div>
                <div className="model-selector__option-bottom">
                  <span className="model-selector__option-id">{m.id}</span>
                  <span className="model-selector__option-price">
                    {formatPrice(m.pricing_prompt)} / {formatPrice(m.pricing_completion)}
                  </span>
                </div>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
