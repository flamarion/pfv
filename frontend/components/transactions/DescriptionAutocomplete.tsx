"use client";

import {
  ChangeEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { apiFetch } from "@/lib/api";
import { input } from "@/lib/styles";

/**
 * Description autocomplete (L3.2 Wave 2A).
 *
 * Wraps the single-transaction add/edit form's description input with
 * a typeahead. Server contract:
 *   GET /api/v1/transactions/suggestions/descriptions
 *     ?type=...&q=...&limit=...
 *
 * Frontend rules (frozen at
 * ~/.claude/projects/-Users-fjorge-src-pfv/specs/2026-05-12-l3-2-import-contracts.md §5.3):
 *   - 300 ms debounce.
 *   - Skip fetch when query length < 2 (the server would 422 it).
 *   - Render up to 8 entries (server caps at 25 but the UX dropdown
 *     stays compact).
 *   - When a suggestion is picked, callers may take its category_id to
 *     pre-populate their own category selector.
 *
 * Accessibility (W3C combobox pattern):
 *   - input has role="combobox", aria-expanded, aria-controls,
 *     aria-activedescendant.
 *   - listbox uses role="listbox"; options use role="option".
 *   - Arrow keys + Enter + Escape are wired.
 *   - aria-live="polite" region announces result counts to screen
 *     readers without stealing focus.
 */

export type DescriptionSuggestion = {
  description: string;
  category_id: number;
  category_name: string;
  use_count: number;
  last_used: string;
};

type ApiResponse = { suggestions: DescriptionSuggestion[] };

export interface DescriptionAutocompleteProps {
  id: string;
  type: "income" | "expense" | "transfer";
  value: string;
  onChange: (next: string) => void;
  onPick?: (s: DescriptionSuggestion) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  /** Override fetch in tests. */
  fetcher?: (
    type: DescriptionAutocompleteProps["type"],
    q: string,
  ) => Promise<DescriptionSuggestion[]>;
  /** Override the debounce in tests (default 300ms). */
  debounceMs?: number;
  /** Max items rendered in the dropdown (default 8). */
  maxItems?: number;
}

const DEFAULT_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const DEFAULT_MAX_ITEMS = 8;

async function defaultFetcher(
  type: DescriptionAutocompleteProps["type"],
  q: string,
): Promise<DescriptionSuggestion[]> {
  const params = new URLSearchParams({ type, q, limit: "25" });
  const data = await apiFetch<ApiResponse>(
    `/api/v1/transactions/suggestions/descriptions?${params}`,
  );
  return data.suggestions ?? [];
}

export default function DescriptionAutocomplete({
  id,
  type,
  value,
  onChange,
  onPick,
  placeholder,
  required,
  disabled,
  className = input,
  ariaLabel,
  fetcher = defaultFetcher,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  maxItems = DEFAULT_MAX_ITEMS,
}: DescriptionAutocompleteProps) {
  const listboxId = useId();
  const [suggestions, setSuggestions] = useState<DescriptionSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [announce, setAnnounce] = useState("");
  const lastRequestId = useRef(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Debounced fetch on value change.
  useEffect(() => {
    if (disabled) return;
    if (!value || value.trim().length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setHighlightIdx(-1);
      return;
    }
    const requestId = ++lastRequestId.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const list = await fetcher(type, value.trim());
        // Drop stale responses if a newer request fired.
        if (requestId !== lastRequestId.current) return;
        setSuggestions(list.slice(0, maxItems));
        setHighlightIdx(list.length > 0 ? 0 : -1);
        setOpen(true);
        setAnnounce(
          list.length === 0
            ? "No suggestions"
            : `${list.length} ${list.length === 1 ? "suggestion" : "suggestions"} available`,
        );
      } catch {
        // Silent failure: autocomplete is non-critical UX. The user
        // can keep typing; the field still accepts free-form input.
        if (requestId !== lastRequestId.current) return;
        setSuggestions([]);
        setHighlightIdx(-1);
      } finally {
        if (requestId === lastRequestId.current) setLoading(false);
      }
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [value, type, debounceMs, fetcher, maxItems, disabled]);

  // Close on click outside.
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const commitPick = useCallback(
    (s: DescriptionSuggestion) => {
      onChange(s.description);
      onPick?.(s);
      setOpen(false);
      setSuggestions([]);
      setHighlightIdx(-1);
    },
    [onChange, onPick],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) {
      if (e.key === "ArrowDown" && suggestions.length > 0) {
        setOpen(true);
        setHighlightIdx(0);
        e.preventDefault();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightIdx((i) => (i + 1) % suggestions.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightIdx((i) =>
          i <= 0 ? suggestions.length - 1 : i - 1,
        );
        break;
      case "Enter":
        if (highlightIdx >= 0 && highlightIdx < suggestions.length) {
          e.preventDefault();
          commitPick(suggestions[highlightIdx]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        setHighlightIdx(-1);
        break;
      case "Tab":
        // Close the popup but let focus move naturally.
        setOpen(false);
        break;
    }
  };

  const handleInput = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    if (e.target.value.trim().length < MIN_QUERY_LENGTH) {
      setOpen(false);
    }
  };

  const handleFocus = () => {
    if (suggestions.length > 0) setOpen(true);
  };

  const activeId =
    open && highlightIdx >= 0 ? `${listboxId}-opt-${highlightIdx}` : undefined;

  return (
    <div ref={wrapperRef} className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listboxId}
        aria-activedescendant={activeId}
        aria-label={ariaLabel}
        autoComplete="off"
        required={required}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        className={className}
      />
      {open && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Description suggestions"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-surface-raised shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li
              key={`${s.description}-${i}`}
              id={`${listboxId}-opt-${i}`}
              role="option"
              aria-selected={i === highlightIdx}
              onMouseDown={(e) => {
                // mousedown (not click) so we run before the input
                // loses focus and closes the dropdown.
                e.preventDefault();
                commitPick(s);
              }}
              onMouseEnter={() => setHighlightIdx(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${
                i === highlightIdx
                  ? "bg-accent/10 text-text-primary"
                  : "text-text-primary"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{s.description}</span>
                <span className="shrink-0 text-[10px] text-text-muted">
                  {s.category_name}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {/* Polite live region: announces result counts to AT users
          without stealing keyboard focus. */}
      <div role="status" aria-live="polite" className="sr-only">
        {loading ? "Loading suggestions" : announce}
      </div>
    </div>
  );
}
