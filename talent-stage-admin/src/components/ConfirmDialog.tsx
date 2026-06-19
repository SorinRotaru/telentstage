import { useState, useCallback, useEffect } from 'react';

interface ConfirmState {
  open: boolean;
  title: string;
  msg: string;
  cb: (() => void) | null;
}

let globalSetConfirm: ((s: ConfirmState) => void) | null = null;

export function confirmDialog(title: string, msg: string, cb: () => void) {
  if (globalSetConfirm) globalSetConfirm({ open: true, title, msg, cb });
}

export default function ConfirmDialog() {
  const [state, setState] = useState<ConfirmState>({ open: false, title: '', msg: '', cb: null });

  useEffect(() => {
    globalSetConfirm = setState;
    return () => { globalSetConfirm = null; };
  }, []);

  const close = useCallback(() => setState({ open: false, title: '', msg: '', cb: null }), []);

  const doConfirm = useCallback(() => {
    const cb = state.cb;
    close();
    if (cb) cb();
  }, [state.cb, close]);

  if (!state.open) return null;

  return (
    <div className="confirm-overlay open" onClick={close}>
      <div className="confirm-box" onClick={e => e.stopPropagation()}>
        <div className="confirm-title">{state.title}</div>
        <div className="confirm-msg">{state.msg}</div>
        <div className="confirm-btns">
          <button className="btn btn-ghost" onClick={close}>Cancel</button>
          <button className="btn btn-danger" onClick={doConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  );
}
