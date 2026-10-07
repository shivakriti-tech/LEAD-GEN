"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** A button that opens a small panel under it; click outside or press Esc to close. */
export function Popover({
  button,
  label,
  className = "",
  align = "left",
  children,
}: {
  button: (open: boolean) => ReactNode;
  label: string;
  className?: string;
  align?: "left" | "right";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className={`pop-wrap ${className}`} ref={ref}>
      <span onClick={() => setOpen(!open)}>{button(open)}</span>
      {open && (
        <div className={`pop ${align}`} role="dialog" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
