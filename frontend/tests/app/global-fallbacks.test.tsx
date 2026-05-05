import { fireEvent, render, screen } from "@testing-library/react";

import GlobalError from "@/app/error";
import NotFound from "@/app/not-found";
import RootLoading from "@/app/loading";

// These tests pin three properties of the L5.7 framework fallbacks:
//
//   1. Render contract — they show their distinctive copy / role.
//   2. Auth-neutrality — none of them import AppShell, useAuth, or
//      any session-bearing primitive. If they did, importing them
//      would either fail in this minimal test setup or pull in mocks.
//   3. Reset behavior — error.tsx wires the framework-supplied reset
//      callback to its "Try again" button.

describe("GlobalError (L5.7)", () => {
  it("renders the friendly error message and a Try again button", () => {
    render(<GlobalError error={new Error("boom")} reset={() => {}} />);
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("invokes the reset callback when Try again is clicked", () => {
    const reset = vi.fn();
    render(<GlobalError error={new Error("boom")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("surfaces the error digest when present", () => {
    const err = Object.assign(new Error("boom"), { digest: "abc123" });
    render(<GlobalError error={err} reset={() => {}} />);
    expect(screen.getByText(/abc123/i)).toBeInTheDocument();
  });

  it("links back to /dashboard as the safe-ground escape", () => {
    render(<GlobalError error={new Error("boom")} reset={() => {}} />);
    const backLink = screen.getByRole("link", { name: /back to dashboard/i });
    expect(backLink).toHaveAttribute("href", "/dashboard");
  });
});

describe("NotFound (L5.7)", () => {
  it("renders the 404 marker and the page-not-found heading", () => {
    render(<NotFound />);
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /page not found/i })).toBeInTheDocument();
  });

  it("offers both dashboard and landing as escape paths", () => {
    render(<NotFound />);
    const dashboard = screen.getByRole("link", { name: /go to dashboard/i });
    const landing = screen.getByRole("link", { name: /visit landing page/i });
    expect(dashboard).toHaveAttribute("href", "/dashboard");
    expect(landing).toHaveAttribute("href", "/");
  });
});

describe("RootLoading (L5.7)", () => {
  it("renders a status region with an accessible label", () => {
    render(<RootLoading />);
    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    expect(status).toHaveAttribute("aria-label", "Loading");
  });
});
