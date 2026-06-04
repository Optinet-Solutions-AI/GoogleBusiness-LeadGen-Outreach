/**
 * ui/toast-store.ts — tiny dependency-free toast store + imperative `toast()` API.
 *
 * Inputs:  toast.success/error/warning/info(message, { title?, duration? })
 * Outputs: an external store (subscribe/getToasts) the <Toaster/> renders from.
 * Used by: components/ui/Toaster.tsx (renderer) + any client component that
 *          wants feedback (replaces window.alert()).
 *
 * No React context/provider: the store lives at module scope so `toast()` can be
 * called from any client event handler. Mount <Toaster/> once in the layout.
 */

export type ToastVariant = "success" | "error" | "warning" | "info" | "message";

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  title?: string;
  message: string;
  /** ms before auto-dismiss; 0 = sticky until manually closed. */
  duration: number;
}

export interface ToastOptions {
  title?: string;
  duration?: number;
}

type Listener = (toasts: ToastItem[]) => void;

const MAX_STACK = 4;
const DEFAULT_DURATION = 4500;

let toasts: ToastItem[] = [];
const listeners = new Set<Listener>();
let counter = 0;

function emit(): void {
  for (const listener of listeners) listener(toasts);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Stable reference between mutations — required by useSyncExternalStore. */
export function getToasts(): ToastItem[] {
  return toasts;
}

export function dismissToast(id: string): void {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length !== toasts.length) {
    toasts = next;
    emit();
  }
}

function add(
  variant: ToastVariant,
  message: string,
  opts?: ToastOptions,
): string {
  counter += 1;
  const id = `t${counter}`;
  const item: ToastItem = {
    id,
    variant,
    message,
    title: opts?.title,
    duration: opts?.duration ?? DEFAULT_DURATION,
  };
  // Newest on top; cap the visible stack.
  toasts = [item, ...toasts].slice(0, MAX_STACK);
  emit();
  return id;
}

interface ToastApi {
  (message: string, opts?: ToastOptions): string;
  success: (message: string, opts?: ToastOptions) => string;
  error: (message: string, opts?: ToastOptions) => string;
  warning: (message: string, opts?: ToastOptions) => string;
  info: (message: string, opts?: ToastOptions) => string;
  message: (message: string, opts?: ToastOptions) => string;
  dismiss: (id: string) => void;
}

export const toast: ToastApi = Object.assign(
  (message: string, opts?: ToastOptions) => add("message", message, opts),
  {
    success: (message: string, opts?: ToastOptions) =>
      add("success", message, opts),
    error: (message: string, opts?: ToastOptions) =>
      add("error", message, { duration: 6000, ...opts }),
    warning: (message: string, opts?: ToastOptions) =>
      add("warning", message, opts),
    info: (message: string, opts?: ToastOptions) => add("info", message, opts),
    message: (message: string, opts?: ToastOptions) =>
      add("message", message, opts),
    dismiss: dismissToast,
  },
);
