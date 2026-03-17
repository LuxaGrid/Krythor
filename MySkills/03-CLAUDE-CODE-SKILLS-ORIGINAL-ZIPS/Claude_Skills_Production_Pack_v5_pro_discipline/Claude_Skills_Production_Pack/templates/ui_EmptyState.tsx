import * as React from "react";
import { Button } from "./Button";

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center">
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      {description ? <p className="mt-2 text-sm text-neutral-600">{description}</p> : null}
      {actionLabel && onAction ? (
        <div className="mt-5 flex justify-center">
          <Button variant="secondary" onClick={onAction}>{actionLabel}</Button>
        </div>
      ) : null}
    </div>
  );
}
