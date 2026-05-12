/**
 * Description-autocomplete component tests (L3.2 Wave 2A).
 *
 * Covers:
 * - Debounce: typing fewer than the debounce window does not fire.
 * - Min-query-length: q < 2 chars never triggers a fetch.
 * - Keyboard nav: ArrowDown / ArrowUp / Enter / Escape.
 * - ARIA wiring: combobox/listbox/option roles, aria-activedescendant,
 *   aria-expanded.
 * - onPick callback fires with the picked suggestion.
 * - Live region announces result counts politely.
 */
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DescriptionAutocomplete, {
  type DescriptionSuggestion,
} from "@/components/transactions/DescriptionAutocomplete";

const SAMPLE: DescriptionSuggestion[] = [
  {
    description: "Albert Heijn",
    category_id: 5,
    category_name: "Groceries",
    use_count: 12,
    last_used: "2026-05-10",
  },
  {
    description: "Albert Cuyp",
    category_id: 5,
    category_name: "Groceries",
    use_count: 4,
    last_used: "2026-05-05",
  },
];

function Harness({
  initial = "",
  fetcher,
  onPick,
}: {
  initial?: string;
  fetcher: (
    type: "income" | "expense" | "transfer",
    q: string,
  ) => Promise<DescriptionSuggestion[]>;
  onPick?: (s: DescriptionSuggestion) => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <DescriptionAutocomplete
      id="tx-desc-test"
      type="expense"
      value={v}
      onChange={setV}
      onPick={onPick}
      fetcher={fetcher}
      debounceMs={20}
    />
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DescriptionAutocomplete", () => {
  it("renders the combobox with the correct ARIA attributes", () => {
    const fetcher = vi.fn().mockResolvedValue([]);
    render(<Harness fetcher={fetcher} />);
    const cb = screen.getByRole("combobox");
    expect(cb).toHaveAttribute("aria-autocomplete", "list");
    expect(cb).toHaveAttribute("aria-expanded", "false");
    expect(cb).toHaveAttribute("aria-controls");
  });

  it("does not fetch when query length is below 2 chars", async () => {
    const fetcher = vi.fn().mockResolvedValue(SAMPLE);
    render(<Harness fetcher={fetcher} />);
    const cb = screen.getByRole("combobox");
    fireEvent.change(cb, { target: { value: "a" } });
    await vi.advanceTimersByTimeAsync(100);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("debounces fetches and pops the listbox open with results", async () => {
    const fetcher = vi.fn().mockResolvedValue(SAMPLE);
    render(<Harness fetcher={fetcher} />);
    const cb = screen.getByRole("combobox");
    fireEvent.change(cb, { target: { value: "Al" } });
    expect(fetcher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(fetcher).toHaveBeenCalledWith("expense", "Al");
    await waitFor(() =>
      expect(screen.getByRole("listbox")).toBeInTheDocument(),
    );
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("Albert Heijn");
    expect(options[1]).toHaveTextContent("Albert Cuyp");
  });

  it("supports ArrowDown / ArrowUp / Enter keyboard navigation", async () => {
    const fetcher = vi.fn().mockResolvedValue(SAMPLE);
    const onPick = vi.fn();
    render(<Harness fetcher={fetcher} onPick={onPick} />);
    const cb = screen.getByRole("combobox");
    fireEvent.change(cb, { target: { value: "Al" } });
    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() =>
      expect(screen.getByRole("listbox")).toBeInTheDocument(),
    );

    // Default highlight is index 0 after fetch resolves.
    expect(cb).toHaveAttribute("aria-activedescendant");

    fireEvent.keyDown(cb, { key: "ArrowDown" });
    fireEvent.keyDown(cb, { key: "Enter" });

    expect(onPick).toHaveBeenCalledWith(SAMPLE[1]);
    // After picking, the input's value should be the picked description.
    expect((cb as HTMLInputElement).value).toBe("Albert Cuyp");
    // And the listbox should be closed.
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes the listbox on Escape", async () => {
    const fetcher = vi.fn().mockResolvedValue(SAMPLE);
    render(<Harness fetcher={fetcher} />);
    const cb = screen.getByRole("combobox");
    fireEvent.change(cb, { target: { value: "Al" } });
    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() =>
      expect(screen.getByRole("listbox")).toBeInTheDocument(),
    );
    fireEvent.keyDown(cb, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("announces result count via polite live region", async () => {
    const fetcher = vi.fn().mockResolvedValue(SAMPLE);
    render(<Harness fetcher={fetcher} />);
    const cb = screen.getByRole("combobox");
    fireEvent.change(cb, { target: { value: "Al" } });
    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        /2 suggestions available/,
      ),
    );
  });

  it("clicking a suggestion selects it", async () => {
    const fetcher = vi.fn().mockResolvedValue(SAMPLE);
    const onPick = vi.fn();
    render(<Harness fetcher={fetcher} onPick={onPick} />);
    const cb = screen.getByRole("combobox");
    fireEvent.change(cb, { target: { value: "Al" } });
    await vi.advanceTimersByTimeAsync(50);
    const options = await screen.findAllByRole("option");
    fireEvent.mouseDown(options[0]);
    expect(onPick).toHaveBeenCalledWith(SAMPLE[0]);
    expect((cb as HTMLInputElement).value).toBe("Albert Heijn");
  });

  it("ignores stale responses when the user keeps typing", async () => {
    const slow = new Promise<DescriptionSuggestion[]>((resolve) =>
      setTimeout(() => resolve([SAMPLE[0]]), 100),
    );
    const fresh = new Promise<DescriptionSuggestion[]>((resolve) =>
      setTimeout(() => resolve([SAMPLE[1]]), 50),
    );
    const fetcher = vi
      .fn<
        (
          type: "income" | "expense" | "transfer",
          q: string,
        ) => Promise<DescriptionSuggestion[]>
      >()
      .mockImplementationOnce(() => slow)
      .mockImplementationOnce(() => fresh);

    render(<Harness fetcher={fetcher} />);
    const cb = screen.getByRole("combobox");
    fireEvent.change(cb, { target: { value: "Al" } });
    await vi.advanceTimersByTimeAsync(30);
    fireEvent.change(cb, { target: { value: "Albe" } });
    await vi.advanceTimersByTimeAsync(200);
    await waitFor(() =>
      expect(screen.getByRole("listbox")).toBeInTheDocument(),
    );
    // The fresh response (single SAMPLE[1] item) is what wins.
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Albert Cuyp");
  });
});
