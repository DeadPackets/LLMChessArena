import type { ReactNode } from "react";
import type { AsyncState } from "../../hooks/useAsync";

interface Props<T> {
  state: AsyncState<T>;
  /** Rendered on success. Receives the non-null data. */
  children: (data: T) => ReactNode;
  /** Rendered when the fetch succeeds but the result is empty. */
  empty: ReactNode;
  /** Optional loading skeleton; defaults to a centered spinner in a panel. */
  skeleton?: ReactNode;
}

export default function AsyncBoundary<T>({ state, children, empty, skeleton }: Props<T>) {
  if (state.status === "loading") {
    return (
      <>
        {skeleton ?? (
          <div className="spinner-page">
            <div className="spinner-lg" />
          </div>
        )}
      </>
    );
  }

  if (state.status === "error") {
    return (
      <div className="empty-state panel async-error">
        <div className="empty-state__icon">&#9888;</div>
        <div className="empty-state__text">
          {state.error?.message || "Something went wrong."}
        </div>
        <button className="btn btn--ghost btn--sm async-error__retry" onClick={state.reload}>
          Retry
        </button>
      </div>
    );
  }

  if (state.status === "empty") {
    return <>{empty}</>;
  }

  // status === "ready" — data is non-null here.
  return <>{children(state.data as T)}</>;
}
