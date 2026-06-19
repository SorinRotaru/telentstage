import { useState } from 'react';

export default function Logo() {
  const [imageFailed, setImageFailed] = useState(false);
  const width = 200;
  const height = 100;

  if (!imageFailed) {
    return (
      <img
        src="/icons/logo.png"
        alt="Talents Stage"
        width={width}
        height={height}
        style={{ width, height, objectFit: 'contain' }}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <svg width={width} height={height} viewBox="0 0 60 60" fill="none" aria-hidden="true">
      <circle cx="30" cy="30" r="27" stroke="#7b3fe4" strokeWidth="2" />
      <polygon
        points="30,8 36,23 52,23 39,33 44,49 30,38 16,49 21,33 8,23 24,23"
        fill="none"
        stroke="#c84fd8"
        strokeWidth="1.5"
      />
      <circle cx="30" cy="30" r="5" fill="#c84fd8" opacity=".8" />
      <polygon points="28,28 33,30 28,32" fill="white" />
    </svg>
  );
}
