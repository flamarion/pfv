"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ApiResponseError, apiFetch, extractErrorMessage } from "@/lib/api";
import {
  btnPrimary,
  btnSecondary,
  card,
  error as errorCls,
  input,
  label as labelCls,
} from "@/lib/styles";
import type { Category } from "@/lib/types";

type MasterType = "income" | "expense" | "both";

interface MovePreviewResult {
  category_id: number;
  source_master_id: number;
  target_master_id: number;
  affected_transaction_count: number;
  affected_recurring_count: number;
  affected_forecast_item_count: number;
  budget_actuals_shifted: boolean;
}

interface AggregateCounts {
  transactions: number;
  recurring: number;
  forecast_items: number;
}

interface FailedMove {
  subcategory_id: number;
  subcategory_name: string;
  status: number;
  message: string;
}

interface Props {
  /** All loaded categories (masters + subcategories). Used to render
   *  the "Move existing subcategories under this master" picker
   *  grouped by current master.
   */
  categories: Category[];
  /** Called when the master has been created (and any selected
   *  subcategories were attempted). The page should refresh its
   *  category list after this fires. May fire after a partial-success
   *  retry when the user clicks Done.
   */
  onCreated: (created: Category) => void;
  onCancel: () => void;
}

/**
 * Modal for the C1 punch-list flow: create a new master category and,
 * in the same flow, move a user-picked set of existing subcategories
 * underneath it.
 *
 * Backend contract (C0 spec, sections 4.1 / 4.2 / 4.5):
 *   1. POST /api/v1/categories                                (create master).
 *   2. GET /api/v1/categories/{id}/move/preview?target_parent_id=N
 *                                                              (preview counts, read-only).
 *   3. PATCH /api/v1/categories/{id}/move {target_parent_id}  (move sub).
 *
 * Order of operations when subs are selected:
 *   - Confirm dialog with generic copy ("Affected transactions and
 *     forecast items will be reassigned. Planned budgets are not
 *     changed.") because we cannot preview before the master exists.
 *   - On Yes: POST creates the master, then we GET the preview for
 *     each selected sub against the new master id and accumulate
 *     counts (best-effort, displayed in the success summary), then
 *     PATCH each sub.
 *
 * Partial-success: if the master creates and one or more moves fail
 * (e.g. 409 name_collision), the master is kept, the failed rows are
 * highlighted, and the primary button switches to "Retry failed
 * moves" so the user can adjust selections (rename a colliding sub on
 * the categories page, or unselect it) and try again.
 */
export default function AddMasterWithSubsModal({
  categories,
  onCreated,
  onCancel,
}: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<MasterType>("expense");
  const [selectedSubIds, setSelectedSubIds] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [failedMoves, setFailedMoves] = useState<FailedMove[]>([]);
  const [createdMaster, setCreatedMaster] = useState<Category | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [aggregateCounts, setAggregateCounts] =
    useState<AggregateCounts | null>(null);
  const [mounted, setMounted] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    previousFocusRef.current = document.activeElement as HTMLElement;
    nameRef.current?.focus();
    nameRef.current?.select();
    return () => {
      previousFocusRef.current?.focus();
    };
  }, [mounted]);

  // Escape closes the confirm dialog if open, otherwise the parent
  // modal. Tab trap stays inside the parent modal.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        e.stopPropagation();
        if (confirmOpen) {
          setConfirmOpen(false);
          return;
        }
        if (createdMaster) {
          // After a partial success the parent should still get the
          // master so its list refreshes; treat Esc as Done.
          onCreated(createdMaster);
          return;
        }
        onCancel();
        return;
      }
      if (e.key === "Tab") {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable || focusable.length === 0) return;
        const visible = Array.from(focusable).filter(
          (el) => !el.hasAttribute("disabled") && el.offsetParent !== null
        );
        if (visible.length === 0) return;
        const first = visible[0];
        const last = visible[visible.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [submitting, confirmOpen, createdMaster, onCancel, onCreated]);

  // Lock body scroll while open.
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const trimmedName = name.trim();
  const nameValid = trimmedName.length > 0 && trimmedName.length <= 100;

  // Group existing subcategories by their current master so the picker
  // mirrors the page's structure. The list only shows subs whose
  // effective type is compatible with the target type the user picked.
  // For type=both the picker shows everything; for income/expense it
  // shows matching subs plus "both"-typed subs (which are compatible
  // either way). Cross-type moves would 400 type_mismatch on the move
  // endpoint per C0 spec section 4.6, so we filter them out in the UI.
  const groups = useMemo(() => {
    const masters = categories.filter((c) => c.parent_id === null);
    const subsByMaster = new Map<number, Category[]>();
    for (const c of categories) {
      if (c.parent_id !== null) {
        const list = subsByMaster.get(c.parent_id) ?? [];
        list.push(c);
        subsByMaster.set(c.parent_id, list);
      }
    }
    const compatible = (sub: Category): boolean => {
      if (type === "both") return true;
      if (sub.type === "both") return true;
      return sub.type === type;
    };
    return masters
      .map((master) => ({
        master,
        subs: (subsByMaster.get(master.id) ?? []).filter(compatible),
      }))
      .filter((g) => g.subs.length > 0);
  }, [categories, type]);

  const totalCandidates = groups.reduce((acc, g) => acc + g.subs.length, 0);

  const toggleSub = (id: number) => {
    setSelectedSubIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Click on the form's primary button. Three flows:
  //   (a) No subs selected and no master yet: create master directly.
  //   (b) Subs selected and no master yet: open confirm dialog with
  //       generic copy. Yes triggers create + previews + moves.
  //   (c) Master already created (partial-success retry path): re-run
  //       the moves for the still-selected subs only.
  function handlePrimaryClick() {
    if (!nameValid || submitting) return;
    setErrorText(null);

    const subIds = Array.from(selectedSubIds);

    if (createdMaster) {
      // Retry path. Master already exists; just move the selection.
      if (subIds.length === 0) {
        onCreated(createdMaster);
        return;
      }
      void runMoves(createdMaster, subIds);
      return;
    }

    if (subIds.length === 0) {
      // Empty selection: create the master with no confirm.
      void runCreate([]);
      return;
    }

    // Subs selected: confirm before mutating anything.
    setAggregateCounts(null);
    setConfirmOpen(true);
  }

  async function handleConfirmYes() {
    setConfirmOpen(false);
    const subIds = Array.from(selectedSubIds);
    await runCreate(subIds);
  }

  // Phase 1: create master. Phase 2: optional previews for the success
  // summary. Phase 3: move each selected sub.
  async function runCreate(subIds: number[]) {
    setSubmitting(true);
    setErrorText(null);
    setFailedMoves([]);

    let master: Category;
    try {
      master = await apiFetch<Category>("/api/v1/categories", {
        method: "POST",
        body: JSON.stringify({ name: trimmedName, type }),
      });
    } catch (err) {
      const message =
        err instanceof ApiResponseError
          ? err.message
          : extractErrorMessage(err, "Failed to create master");
      setErrorText(message);
      setSubmitting(false);
      return;
    }
    setCreatedMaster(master);

    if (subIds.length === 0) {
      setSubmitting(false);
      onCreated(master);
      return;
    }

    // Best-effort preview for the success summary; we already have the
    // user's intent confirmed, so a preview failure here is silent.
    let counts: AggregateCounts | null = {
      transactions: 0,
      recurring: 0,
      forecast_items: 0,
    };
    try {
      for (const subId of subIds) {
        const r = await apiFetch<MovePreviewResult>(
          `/api/v1/categories/${subId}/move/preview?target_parent_id=${master.id}`,
        );
        counts.transactions += r.affected_transaction_count;
        counts.recurring += r.affected_recurring_count;
        counts.forecast_items += r.affected_forecast_item_count;
      }
    } catch {
      counts = null;
    }
    setAggregateCounts(counts);

    await runMoves(master, subIds);
  }

  async function runMoves(master: Category, subIds: number[]) {
    const masterId = master.id;
    setSubmitting(true);
    setErrorText(null);
    setFailedMoves([]);

    const failures: FailedMove[] = [];
    const succeededIds: number[] = [];
    for (const subId of subIds) {
      const subRecord = categories.find((c) => c.id === subId);
      try {
        await apiFetch(`/api/v1/categories/${subId}/move`, {
          method: "PATCH",
          body: JSON.stringify({ target_parent_id: masterId }),
        });
        succeededIds.push(subId);
      } catch (err) {
        const status = err instanceof ApiResponseError ? err.status : 0;
        const message =
          err instanceof ApiResponseError
            ? err.message
            : extractErrorMessage(err, "Move failed");
        failures.push({
          subcategory_id: subId,
          subcategory_name: subRecord?.name ?? `#${subId}`,
          status,
          message,
        });
      }
    }

    // Drop succeeded moves from selection so a retry only repeats the
    // failures.
    if (succeededIds.length > 0) {
      setSelectedSubIds((prev) => {
        const next = new Set(prev);
        for (const id of succeededIds) next.delete(id);
        return next;
      });
    }

    setSubmitting(false);

    if (failures.length === 0) {
      onCreated(master);
      return;
    }

    setFailedMoves(failures);
    setErrorText(
      failures.length === subIds.length
        ? `All ${failures.length} subcategory move${failures.length > 1 ? "s" : ""} failed. The master "${trimmedName}" was created. Adjust your selection and retry.`
        : `${failures.length} of ${subIds.length} subcategory moves failed. The master "${trimmedName}" was created and ${succeededIds.length} subcategor${succeededIds.length === 1 ? "y was" : "ies were"} moved successfully. Adjust and retry, or click Done.`,
    );
  }

  const inRetryState = createdMaster !== null && failedMoves.length > 0;
  const submitLabel = submitting
    ? "Working..."
    : inRetryState
      ? "Retry failed moves"
      : selectedSubIds.size > 0
        ? "Create master and move"
        : "Create master";

  // In retry state we require at least one selected sub (otherwise the
  // user should click Done). In initial state we only require a valid
  // name.
  const canSubmit =
    nameValid &&
    !submitting &&
    (inRetryState ? selectedSubIds.size > 0 : true);

  // Confirm dialog copy. Pre-mutation we have no preview yet, so use
  // generic copy per spec section 4.2.
  const confirmMessage = (() => {
    const count = selectedSubIds.size;
    const lead = `Create master "${trimmedName}" and move ${count} subcategor${count === 1 ? "y" : "ies"} under it?`;
    if (aggregateCounts) {
      return `${lead}\n\nThis will reassign ${aggregateCounts.transactions} transaction${aggregateCounts.transactions === 1 ? "" : "s"}, ${aggregateCounts.recurring} recurring template${aggregateCounts.recurring === 1 ? "" : "s"}, and ${aggregateCounts.forecast_items} forecast plan item${aggregateCounts.forecast_items === 1 ? "" : "s"} at read time. Planned budgets are not changed; run "Refresh from Forecast" on the Forecast Plans page to re-attribute plans.`;
    }
    return `${lead}\n\nAffected transactions and forecast items will be reassigned to the new master. Planned budgets are not changed.`;
  })();

  if (!mounted) return null;

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-bg/80 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-master-with-subs-title"
        className={`${card} flex max-h-[90vh] w-full max-w-2xl flex-col p-6 shadow-xl`}
      >
        <h2
          id="add-master-with-subs-title"
          className="mb-4 text-lg font-semibold text-text-primary"
        >
          New master category
        </h2>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handlePrimaryClick();
          }}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <div>
            <label htmlFor="add-master-name" className={labelCls}>
              Master name
            </label>
            <input
              ref={nameRef}
              id="add-master-name"
              type="text"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={input}
              autoComplete="off"
              disabled={submitting || createdMaster !== null}
            />
            {createdMaster !== null && (
              <p className="mt-1 text-xs text-text-muted">
                Master already created. Adjust the subcategory selection and
                retry, or click Done.
              </p>
            )}
          </div>

          <fieldset disabled={submitting || createdMaster !== null}>
            <legend className={labelCls}>Type</legend>
            <div className="flex gap-4 text-sm text-text-primary">
              {(["expense", "income", "both"] as const).map((t) => (
                <label key={t} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="add-master-type"
                    value={t}
                    checked={type === t}
                    onChange={() => {
                      setType(t);
                      // Clear selections incompatible with the new type
                      // so the user can't carry forward a now-invalid
                      // pick.
                      setSelectedSubIds(new Set());
                    }}
                  />
                  <span className="capitalize">{t}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-surface-raised p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className={labelCls + " mb-0"}>
                Move existing subcategories under this master
              </p>
              <span
                className="text-xs text-text-muted"
                data-testid="selected-count"
              >
                {selectedSubIds.size} selected
              </span>
            </div>

            {totalCandidates === 0 ? (
              <p className="py-4 text-sm text-text-muted">
                No compatible subcategories to move. You can still create the
                master and add subcategories later.
              </p>
            ) : (
              <ul className="space-y-3" data-testid="sub-picker">
                {groups.map(({ master, subs }) => (
                  <li key={master.id} data-testid={`group-${master.id}`}>
                    <p
                      className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted"
                      data-testid={`group-${master.id}-label`}
                    >
                      {master.name}
                    </p>
                    <ul className="space-y-1 pl-2">
                      {subs.map((sub) => {
                        const failed = failedMoves.find(
                          (f) => f.subcategory_id === sub.id,
                        );
                        return (
                          <li key={sub.id}>
                            <label
                              data-testid={`sub-row-${sub.id}`}
                              className={`flex items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface ${failed ? "ring-1 ring-danger" : ""}`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedSubIds.has(sub.id)}
                                onChange={() => toggleSub(sub.id)}
                                disabled={submitting}
                                className="mt-0.5"
                                aria-label={`Move subcategory ${sub.name} under new master`}
                              />
                              <span className="flex-1">
                                <span className="text-text-primary">
                                  {sub.name}
                                </span>
                                {sub.transaction_count > 0 && (
                                  <span className="ml-2 text-xs text-text-muted">
                                    {sub.transaction_count} txn
                                    {sub.transaction_count === 1 ? "" : "s"}
                                  </span>
                                )}
                                {failed && (
                                  <span
                                    className="mt-0.5 block text-xs text-danger"
                                    data-testid={`sub-failed-${sub.id}`}
                                  >
                                    Failed
                                    {failed.status === 409
                                      ? " (name conflicts in target master)"
                                      : failed.status
                                        ? ` (${failed.status})`
                                        : ""}
                                    : {failed.message}
                                  </span>
                                )}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {errorText && (
            <div role="alert" className={errorCls}>
              {errorText}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                if (createdMaster) {
                  onCreated(createdMaster);
                  return;
                }
                onCancel();
              }}
              disabled={submitting}
              className={btnSecondary}
            >
              {createdMaster ? "Done" : "Cancel"}
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={btnPrimary}
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>

      {confirmOpen && (
        <ConfirmInline
          title={`Create "${trimmedName || "master"}" and move ${selectedSubIds.size} subcategor${selectedSubIds.size === 1 ? "y" : "ies"}?`}
          message={confirmMessage}
          onYes={handleConfirmYes}
          onNo={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );

  return createPortal(modal, document.body);
}

/**
 * Tiny confirm dialog stacked over the parent modal. Self-contained so
 * we don't import ConfirmModal and create a portal-inside-portal mess.
 */
function ConfirmInline(props: {
  title: string;
  message: string;
  onYes: () => void;
  onNo: () => void;
}) {
  const { title, message, onYes, onNo } = props;
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-bg/80 p-4"
      onClick={onNo}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="add-master-confirm-title"
        className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="add-master-confirm-title"
          className="text-lg font-semibold text-text-primary"
        >
          {title}
        </h3>
        <p
          className="mt-2 whitespace-pre-line text-sm text-text-secondary"
          data-testid="confirm-message"
        >
          {message}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            onClick={onNo}
            className={`${btnSecondary} min-h-[44px] sm:w-auto`}
          >
            Cancel
          </button>
          <button
            onClick={onYes}
            className={`${btnPrimary} min-h-[44px] sm:w-auto`}
          >
            Yes, create and move
          </button>
        </div>
      </div>
    </div>
  );
}
