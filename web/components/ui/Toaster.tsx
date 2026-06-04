"use client";

/**
 * ui/Toaster.tsx — the single toast renderer. Mount once in the dashboard layout.
 *
 * Inputs:  the module-scope toast store (components/ui/toast-store.ts)
 * Outputs: a fixed bottom-right stack of toasts with variant icon, copy, close
 *          button, auto-dismiss, and enter/exit transitions. aria-live="polite".
 * Used by: app/(dashboard)/layout.tsx
 *
 * Token-bound, dependency-free. Transitions use transform+opacity only and are
 * neutralised by the global prefers-reduced-motion rule in globals.css.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Bell,
  X,
  type LucideIcon,
} from "lucide-react";
import { cx } from "@/lib/cx";
import {
  subscribe,
  getToasts,
  dismissToast,
  type ToastItem,
  type ToastVariant,
} from "./toast-store";

const VARIANT_META: Record<ToastVariant, { Icon: LucideIcon; tone: string }> = {
  success: { Icon: CheckCircle2, tone: "text-positive" },
  error: { Icon: XCircle, tone: "text-urgent" },
  warning: { Icon: AlertTriangle, tone: "text-warning" },
  info: { Icon: Info, tone: "text-action" },
  message: { Icon: Bell, tone: "text-ink-muted" },
};

const EMPTY: ToastItem[] = [];

export function Toaster() {
  const toasts = useSyncExternalStore(subscribe, getToasts, () => EMPTY);

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2 pointer-events-none"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastCard({ toast: t }: { toast: ToastItem }) {
  const [shown, setShown] = useState(false);
  const closing = useRef(false);
  const { Icon, tone } = VARIANT_META[t.variant];

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setShown(false);
    // Let the exit transition (180ms) play before removing from the store.
    setTimeout(() => dismissToast(t.id), 180);
  }, [t.id]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (t.duration > 0) timer = setTimeout(close, t.duration);
    return () => {
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
  }, [t.duration, close]);

  return (
    <div
      role="status"
      className={cx(
        "card pointer-events-auto flex items-start gap-3 p-3.5 pr-2.5",
        "shadow-[0_10px_28px_-14px_rgba(17,17,15,0.30)] transition-all duration-200 ease-out",
        shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
      )}
    >
      <span className={cx("mt-0.5 flex-shrink-0", tone)}>
        <Icon className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        {t.title && (
          <p className="text-[13px] font-semibold leading-snug text-ink">
            {t.title}
          </p>
        )}
        <p className="break-words text-[13px] leading-snug text-ink-muted">
          {t.message}
        </p>
      </div>
      <button
        type="button"
        onClick={close}
        aria-label="Dismiss notification"
        className="flex-shrink-0 rounded p-1 text-ink-subtle transition-colors hover:bg-surface-alt hover:text-ink"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}
