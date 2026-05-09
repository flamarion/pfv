import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import AddMasterWithSubsModal from "@/components/ui/AddMasterWithSubsModal";
import { ApiResponseError, apiFetch } from "@/lib/api";
import type { Category } from "@/lib/types";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: vi.fn() };
});

const cats: Category[] = [
  // Masters.
  {
    id: 1,
    name: "Food",
    type: "expense",
    parent_id: null,
    parent_name: null,
    description: null,
    slug: "food_dining",
    is_system: true,
    transaction_count: 0,
  },
  {
    id: 2,
    name: "Lifestyle",
    type: "expense",
    parent_id: null,
    parent_name: null,
    description: null,
    slug: "lifestyle",
    is_system: true,
    transaction_count: 0,
  },
  {
    id: 3,
    name: "Income",
    type: "income",
    parent_id: null,
    parent_name: null,
    description: null,
    slug: "income",
    is_system: true,
    transaction_count: 0,
  },
  // Subcategories.
  {
    id: 11,
    name: "Restaurants",
    type: "expense",
    parent_id: 1,
    parent_name: "Food",
    description: null,
    slug: null,
    is_system: false,
    transaction_count: 12,
  },
  {
    id: 12,
    name: "Groceries",
    type: "expense",
    parent_id: 1,
    parent_name: "Food",
    description: null,
    slug: null,
    is_system: false,
    transaction_count: 5,
  },
  {
    id: 21,
    name: "Hobbies",
    type: "expense",
    parent_id: 2,
    parent_name: "Lifestyle",
    description: null,
    slug: null,
    is_system: false,
    transaction_count: 0,
  },
  {
    id: 31,
    name: "Salary",
    type: "income",
    parent_id: 3,
    parent_name: "Income",
    description: null,
    slug: null,
    is_system: false,
    transaction_count: 3,
  },
];

const newMaster: Category = {
  id: 99,
  name: "Dining out",
  type: "expense",
  parent_id: null,
  parent_name: null,
  description: null,
  slug: null,
  is_system: false,
  transaction_count: 0,
};

describe("AddMasterWithSubsModal", () => {
  const apiFetchMock = vi.mocked(apiFetch);

  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it("renders the modal with name field, type selector, and grouped sub list", async () => {
    render(
      <AddMasterWithSubsModal
        categories={cats}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      await screen.findByLabelText(/Master name/i),
    ).toBeInTheDocument();

    // Type radios.
    expect(screen.getByRole("radio", { name: /expense/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /income/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /both/i })).toBeInTheDocument();

    // Default type is expense, so Food + Lifestyle groups should be
    // present, Income group should not (its sub Salary is income-only).
    expect(screen.getByTestId("group-1-label")).toHaveTextContent("Food");
    expect(screen.getByTestId("group-2-label")).toHaveTextContent("Lifestyle");
    expect(screen.queryByTestId("group-3-label")).not.toBeInTheDocument();

    // Each compatible sub renders a checkbox.
    expect(
      screen.getByLabelText("Move subcategory Restaurants under new master"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Move subcategory Groceries under new master"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Move subcategory Hobbies under new master"),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Move subcategory Salary under new master"),
    ).not.toBeInTheDocument();
  });

  it("regroups when the user switches type to income (only income subs visible)", async () => {
    render(
      <AddMasterWithSubsModal
        categories={cats}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /income/i }));
    expect(screen.getByTestId("group-3-label")).toHaveTextContent("Income");
    expect(screen.queryByTestId("group-1-label")).not.toBeInTheDocument();
    expect(screen.queryByTestId("group-2-label")).not.toBeInTheDocument();
  });

  it("disables submit when name is empty", async () => {
    render(
      <AddMasterWithSubsModal
        categories={cats}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Create master/i }),
    ).toBeDisabled();
  });

  it("creates master with no subs selected (no confirm dialog)", async () => {
    apiFetchMock.mockResolvedValueOnce(newMaster as never);
    const onCreated = vi.fn();

    render(
      <AddMasterWithSubsModal
        categories={cats}
        onCreated={onCreated}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Master name/i), {
      target: { value: "Dining out" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Create master$/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(newMaster));
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/v1/categories",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Dining out", type: "expense" }),
      }),
    );
  });

  it("opens a confirm dialog when one or more subs are selected", async () => {
    render(
      <AddMasterWithSubsModal
        categories={cats}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Master name/i), {
      target: { value: "Dining out" },
    });
    fireEvent.click(
      screen.getByLabelText("Move subcategory Restaurants under new master"),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Create master and move/i }),
    );

    // Confirm dialog appears with generic copy (no preview yet because
    // the master hasn't been created).
    const confirmMsg = await screen.findByTestId("confirm-message");
    expect(confirmMsg).toHaveTextContent(/Create master "Dining out"/);
    expect(confirmMsg).toHaveTextContent(/Affected transactions and forecast items/);
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("on confirm Yes: POST master, GET previews, PATCH each move (call sequence)", async () => {
    // Sequence: 1 POST, 2 previews, 2 moves.
    apiFetchMock
      .mockResolvedValueOnce(newMaster as never) // POST /categories
      .mockResolvedValueOnce({
        category_id: 11,
        source_master_id: 1,
        target_master_id: 99,
        affected_transaction_count: 12,
        affected_recurring_count: 1,
        affected_forecast_item_count: 0,
        budget_actuals_shifted: true,
      } as never) // preview sub 11
      .mockResolvedValueOnce({
        category_id: 21,
        source_master_id: 2,
        target_master_id: 99,
        affected_transaction_count: 0,
        affected_recurring_count: 0,
        affected_forecast_item_count: 1,
        budget_actuals_shifted: false,
      } as never) // preview sub 21
      .mockResolvedValueOnce(undefined as never) // PATCH sub 11
      .mockResolvedValueOnce(undefined as never); // PATCH sub 21

    const onCreated = vi.fn();
    render(
      <AddMasterWithSubsModal
        categories={cats}
        onCreated={onCreated}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Master name/i), {
      target: { value: "Dining out" },
    });
    fireEvent.click(
      screen.getByLabelText("Move subcategory Restaurants under new master"),
    );
    fireEvent.click(
      screen.getByLabelText("Move subcategory Hobbies under new master"),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Create master and move/i }),
    );

    const confirmDialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(confirmDialog).getByRole("button", {
        name: /Yes, create and move/i,
      }),
    );

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(newMaster));

    // Verify the call sequence (POST, GET, GET, PATCH, PATCH).
    const calls = apiFetchMock.mock.calls;
    expect(calls).toHaveLength(5);
    expect(calls[0][0]).toBe("/api/v1/categories");
    expect(calls[0][1]).toMatchObject({ method: "POST" });
    expect(calls[1][0]).toBe(
      "/api/v1/categories/11/move/preview?target_parent_id=99",
    );
    expect(calls[2][0]).toBe(
      "/api/v1/categories/21/move/preview?target_parent_id=99",
    );
    expect(calls[3][0]).toBe("/api/v1/categories/11/move");
    expect(calls[3][1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ target_parent_id: 99 }),
    });
    expect(calls[4][0]).toBe("/api/v1/categories/21/move");
  });

  it("partial-success: surfaces failed sub with retry affordance and keeps master", async () => {
    apiFetchMock
      .mockResolvedValueOnce(newMaster as never) // POST master
      .mockResolvedValueOnce({
        category_id: 11,
        source_master_id: 1,
        target_master_id: 99,
        affected_transaction_count: 12,
        affected_recurring_count: 0,
        affected_forecast_item_count: 0,
        budget_actuals_shifted: false,
      } as never) // preview sub 11
      .mockResolvedValueOnce({
        category_id: 12,
        source_master_id: 1,
        target_master_id: 99,
        affected_transaction_count: 5,
        affected_recurring_count: 0,
        affected_forecast_item_count: 0,
        budget_actuals_shifted: false,
      } as never) // preview sub 12
      .mockResolvedValueOnce(undefined as never) // PATCH 11 ok
      .mockRejectedValueOnce(
        new ApiResponseError(
          409,
          'Lifestyle already has a subcategory named "Groceries". Rename one before moving.',
          undefined,
          { detail: "name_collision" },
        ),
      ); // PATCH 12 -> 409

    const onCreated = vi.fn();
    render(
      <AddMasterWithSubsModal
        categories={cats}
        onCreated={onCreated}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Master name/i), {
      target: { value: "Dining out" },
    });
    fireEvent.click(
      screen.getByLabelText("Move subcategory Restaurants under new master"),
    );
    fireEvent.click(
      screen.getByLabelText("Move subcategory Groceries under new master"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Create master and move/i }),
    );
    const confirmDialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(confirmDialog).getByRole("button", {
        name: /Yes, create and move/i,
      }),
    );

    // Wait for the failed sub to render.
    await screen.findByTestId("sub-failed-12");
    expect(screen.getByTestId("sub-failed-12")).toHaveTextContent(
      /name conflicts in target master/i,
    );

    // onCreated should NOT have fired yet because we still have a
    // failure outstanding.
    expect(onCreated).not.toHaveBeenCalled();

    // Primary button should now read "Retry failed moves" and the
    // master input is locked.
    expect(
      screen.getByRole("button", { name: /Retry failed moves/i }),
    ).toBeInTheDocument();
    expect(
      (screen.getByLabelText(/Master name/i) as HTMLInputElement).disabled,
    ).toBe(true);

    // Successful sub should be unselected (not in the still-selected
    // set), failed sub should remain selected.
    const restaurantsCheckbox = screen.getByLabelText(
      "Move subcategory Restaurants under new master",
    ) as HTMLInputElement;
    const groceriesCheckbox = screen.getByLabelText(
      "Move subcategory Groceries under new master",
    ) as HTMLInputElement;
    expect(restaurantsCheckbox.checked).toBe(false);
    expect(groceriesCheckbox.checked).toBe(true);

    // Done button (replaces Cancel) calls onCreated with the master so
    // the parent page refreshes.
    fireEvent.click(screen.getByRole("button", { name: /^Done$/i }));
    expect(onCreated).toHaveBeenCalledWith(newMaster);
  });

  it("surfaces 409 from POST master without committing any moves", async () => {
    apiFetchMock.mockRejectedValueOnce(
      new ApiResponseError(
        409,
        "A master category named Dining out already exists.",
      ),
    );

    render(
      <AddMasterWithSubsModal
        categories={cats}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Master name/i), {
      target: { value: "Dining out" },
    });
    // No subs selected so we skip the confirm dialog.
    fireEvent.click(screen.getByRole("button", { name: /Create master$/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/already exists/i),
    );
    // Only the POST happened; no preview, no move.
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });

  it("Escape closes the modal when not submitting and no master created yet", async () => {
    const onCancel = vi.fn();
    render(
      <AddMasterWithSubsModal
        categories={cats}
        onCreated={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await screen.findByLabelText(/Master name/i);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("Cancel button calls onCancel when no master created yet", async () => {
    const onCancel = vi.fn();
    render(
      <AddMasterWithSubsModal
        categories={cats}
        onCreated={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
