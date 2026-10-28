"use client";

import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  title: string;
  variant?: "drawer" | "center" | "prison";
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** Модальная или боковая панель на нативном <dialog>: фокус, Esc и затемнение — от браузера. */
export function Modal({ open, title, variant = "drawer", onClose, children, footer }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`modal modal-${variant}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      {open && (
        <div className="modal-inner pixel-box">
          <header className="modal-head">
            <h2 className="pixel-title">{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
              ✕
            </button>
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer className="modal-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
