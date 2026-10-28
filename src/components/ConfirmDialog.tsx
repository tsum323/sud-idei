"use client";

import { useCallback, useRef, useState } from "react";
import { Modal } from "./Modal";

interface Request {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

/** Подтверждение действий в стиле приложения (вместо window.confirm). */
export function useConfirm() {
  const [req, setReq] = useState<Request | null>(null);
  const resolver = useRef<(v: boolean) => void>(undefined);

  const confirm = useCallback((r: Request) => {
    setReq(r);
    return new Promise<boolean>((resolve) => (resolver.current = resolve));
  }, []);

  const done = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = undefined;
    setReq(null);
  };

  const dialog = (
    <Modal
      open={!!req}
      title={req?.title ?? ""}
      variant="center"
      onClose={() => done(false)}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => done(false)}>
            Отмена
          </button>
          <button type="button" className={`btn ${req?.danger ? "btn-danger" : "btn-primary"}`} onClick={() => done(true)} autoFocus>
            {req?.confirmLabel ?? "Подтвердить"}
          </button>
        </>
      }
    >
      <p>{req?.message}</p>
    </Modal>
  );

  return { confirm, dialog };
}
