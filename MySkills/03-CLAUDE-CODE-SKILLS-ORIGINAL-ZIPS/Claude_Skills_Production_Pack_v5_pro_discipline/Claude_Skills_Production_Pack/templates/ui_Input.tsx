import * as React from "react";

export function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={
        "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm " +
        "placeholder:text-neutral-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 " +
        "disabled:opacity-50 " +
        className
      }
      {...props}
    />
  );
}
