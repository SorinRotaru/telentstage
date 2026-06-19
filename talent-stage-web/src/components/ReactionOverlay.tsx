import { useEffect, useState, useRef } from 'react';

interface Props {
  type: 'like' | 'dislike' | null;
}

export default function ReactionOverlay({ type }: Props) {
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (type) {
      setShow(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setShow(false), 700);
    }
  }, [type]);

  const icon = type === 'like' ? '/icons/like-hand.png' : '/icons/dislike-hand.png';
  const filter = type === 'like'
    ? 'brightness(0) invert(1)'
    : 'brightness(0) saturate(100%) invert(27%) sepia(51%) saturate(2878%) hue-rotate(346deg) brightness(104%)';

  return (
    <div className={`react-overlay ${show ? 'show' : ''}`}>
      <span className="react-emoji">
        {type && (
          <img src={icon}
            style={{ width: 120, height: 120, objectFit: 'contain', filter }}
            alt={type} />
        )}
      </span>
    </div>
  );
}
