import { useState, useEffect, useCallback } from 'react';
import { addToastListener } from '../hooks/useToast';

interface ToastItem {
  id: number;
  msg: string;
  type: string;
}

let nextId = 0;

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const add = useCallback((msg: string, type: string) => {
    const id = nextId++;
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  }, []);

  useEffect(() => {
    return addToastListener(add);
  }, [add]);

  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>
      ))}
    </div>
  );
}
