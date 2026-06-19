import { useEffect, useRef, useState, useCallback } from 'react';

let _showToast: (msg: string) => void = () => {};

export function toast(msg: string) {
  _showToast(msg);
}

export default function Toast() {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((msg: string) => {
    setMessage(msg);
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), 2800);
  }, []);

  useEffect(() => {
    _showToast = show;
    return () => { _showToast = () => {}; };
  }, [show]);

  return (
    <div className={`toast ${visible ? 'show' : ''}`}>
      {message}
    </div>
  );
}
