import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import TransferForm from "@/components/floating/TransferForm";
import { apiFetch } from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: vi.fn() };
});

const CHECKING = {
  id: 1,
  name: "Checking",
  account_type_id: 1,
  account_type_name: "Checking",
  account_type_slug: "checking",
  balance: 1000,
  currency: "EUR",
  is_active: true,
  close_day: null,
  is_default: true,
};

const SAVINGS = {
  id: 2,
  name: "Savings",
  account_type_id: 2,
  account_type_name: "Savings",
  account_type_slug: "savings",
  balance: 5000,
  currency: "EUR",
  is_active: true,
  close_day: null,
  is_default: false,
};

const TRANSFER_CAT = {
  id: 99,
  name: "Transfer",
  type: "expense" as const,
  parent_id: null,
  parent_name: null,
  description: null,
  slug: "transfer",
  is_system: true,
  transaction_count: 0,
};

describe("TransferForm", () => {
  it("renders the empty state when fewer than two active accounts exist", () => {
    render(
      <TransferForm
        accounts={[CHECKING]}
        categories={[TRANSFER_CAT]}
        onSaved={() => {}}
      />,
    );
    expect(
      screen.getByText(/Transfers move money between two accounts/i),
    ).toBeInTheDocument();
  });

  it("renders the form when there are two active accounts", () => {
    render(
      <TransferForm
        accounts={[CHECKING, SAVINGS]}
        categories={[TRANSFER_CAT]}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByLabelText("From account")).toBeInTheDocument();
    expect(screen.getByLabelText("To account")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount")).toBeInTheDocument();
  });

  it("filters the destination account select to exclude the source", () => {
    render(
      <TransferForm
        accounts={[CHECKING, SAVINGS]}
        categories={[TRANSFER_CAT]}
        onSaved={() => {}}
      />,
    );
    // Source is Checking (default). Destination select must not list Checking.
    const toSelect = screen.getByLabelText("To account") as HTMLSelectElement;
    const optionNames = Array.from(toSelect.options).map((o) => o.textContent);
    expect(optionNames).toContain("Savings");
    expect(optionNames).not.toContain("Checking");
  });

  it("submits a valid transfer and calls onSaved on default Save", async () => {
    const apiFetchMock = vi.mocked(apiFetch);
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({} as never);

    const onSaved = vi.fn();
    const onTransactionAdded = vi.fn();

    render(
      <TransferForm
        accounts={[CHECKING, SAVINGS]}
        categories={[TRANSFER_CAT]}
        onSaved={onSaved}
        onTransactionAdded={onTransactionAdded}
      />,
    );

    fireEvent.change(screen.getByLabelText("To account"), {
      target: { value: String(SAVINGS.id) },
    });
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "200.00" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    });

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    expect(onTransactionAdded).toHaveBeenCalledTimes(1);

    // Asserts the form posts to the L3.x transfer endpoint, not a new one.
    const call = apiFetchMock.mock.calls.find(
      ([url]) => url === "/api/v1/transactions/transfer",
    );
    expect(call).toBeTruthy();
    const body = JSON.parse(call![1]!.body as string);
    expect(body.from_account_id).toBe(CHECKING.id);
    expect(body.to_account_id).toBe(SAVINGS.id);
    expect(body.amount).toBe("200.00");
    expect(body.status).toBe("settled");
    // category_id is omitted when no override picked. Defaults server-side.
    expect(body.category_id).toBeUndefined();
  });

  it("keeps the panel open and clears fields on Save and add new", async () => {
    const apiFetchMock = vi.mocked(apiFetch);
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({} as never);

    const onSaved = vi.fn();
    const onTransactionAdded = vi.fn();

    render(
      <TransferForm
        accounts={[CHECKING, SAVINGS]}
        categories={[TRANSFER_CAT]}
        onSaved={onSaved}
        onTransactionAdded={onTransactionAdded}
      />,
    );

    fireEvent.change(screen.getByLabelText("To account"), {
      target: { value: String(SAVINGS.id) },
    });
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "75.00" },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Save and add new/i }),
      );
    });

    await waitFor(() => {
      expect(onTransactionAdded).toHaveBeenCalledTimes(1);
    });
    // Default Save's onSaved must NOT fire under add-new intent.
    expect(onSaved).not.toHaveBeenCalled();
    // Amount cleared so the user can keep typing.
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe(
      "",
    );
    // From account preserved (typical from-one-account, multiple-legs pattern).
    expect(
      (screen.getByLabelText("From account") as HTMLSelectElement).value,
    ).toBe(String(CHECKING.id));
  });

  it("omits category_id from the request when no override is picked (server applies the Transfer default)", async () => {
    const apiFetchMock = vi.mocked(apiFetch);
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({} as never);

    render(
      <TransferForm
        accounts={[CHECKING, SAVINGS]}
        categories={[TRANSFER_CAT]}
        onSaved={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("To account"), {
      target: { value: String(SAVINGS.id) },
    });
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "10.00" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    });

    const call = apiFetchMock.mock.calls.find(
      ([url]) => url === "/api/v1/transactions/transfer",
    );
    const body = JSON.parse(call![1]!.body as string);
    // Server-side default is the "Transfer" category, so the client
    // intentionally omits the key when the user did not override it.
    expect(body.category_id).toBeUndefined();
  });
});
