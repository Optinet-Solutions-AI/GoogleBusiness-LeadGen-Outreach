"use client";

/**
 * ui/Button.tsx — the one button primitive (variants + sizes + loading).
 *
 * Inputs:  variant ('primary'|'secondary'|'ghost'|'danger'), size ('sm'|'md'|'lg'),
 *          loading flag, plus all native <button> props.
 * Outputs: a token-bound <button> using the .btn utilities in globals.css.
 *          Keyboard focus comes from the global :focus-visible ring.
 * Used by: dashboard pages/components that need a consistent CTA.
 */

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cx } from "@/lib/cx";

type Variant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "positive"
  | "dark"
  | "soft"
  | "soft-action"
  | "soft-positive"
  | "soft-danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  danger: "btn-danger",
  positive: "btn-positive",
  dark: "btn-dark",
  soft: "btn-soft",
  "soft-action": "btn-soft-action",
  "soft-positive": "btn-soft-positive",
  "soft-danger": "btn-soft-danger",
};

const SIZE: Record<Size, string> = {
  sm: "btn-sm",
  md: "",
  lg: "btn-lg",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and blocks interaction while an async action runs. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      className,
      children,
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        className={cx("btn", VARIANT[variant], SIZE[size], className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && <Loader2 className="animate-spin" aria-hidden />}
        {children}
      </button>
    );
  },
);
