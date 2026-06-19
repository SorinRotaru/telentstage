import { useRef, useCallback, useEffect } from 'react';

interface SwipeHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onTouchCancel: (e: React.TouchEvent) => void;
}

interface VelocitySample {
  y: number;
  t: number;
}

const MAX_SAMPLES = 5;

export function useSwipe(
  onSwipeUp: () => void,
  onSwipeDown: () => void,
  isAnimating: boolean,
  onDragMove?: (dy: number) => void,
  onGestureEnd?: (didSwipe: boolean) => void,
  containerRef?: React.RefObject<HTMLDivElement | null>,
  onRelease?: (dy: number, velocityPxPerMs: number) => void,
): SwipeHandlers {
  const ty0 = useRef(0);
  const tx0 = useRef(0);
  const dragActive = useRef(false);
  const swipeThresholdRef = useRef(55);
  const touchTrackingCleanupRef = useRef<(() => void) | null>(null);
  const velocitySamples = useRef<VelocitySample[]>([]);

  const stopTouchTracking = useCallback(() => {
    if (touchTrackingCleanupRef.current) {
      touchTrackingCleanupRef.current();
      touchTrackingCleanupRef.current = null;
    }
  }, []);

  const computeVelocity = useCallback((): number => {
    const samples = velocitySamples.current;
    if (samples.length < 2) return 0;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = last.t - first.t;
    if (dt < 1) return 0;
    return (last.y - first.y) / dt; // px/ms, negative = upward
  }, []);

  const handleMoveByCoords = useCallback((clientY: number, clientX: number) => {
    if (!dragActive.current || isAnimating) return;
    const dy = clientY - ty0.current;
    const dx = clientX - tx0.current;

    // Dead zone: ignore until vertical movement exceeds horizontal
    if (Math.abs(dy) < 10 || Math.abs(dy) < Math.abs(dx)) return;

    // Record velocity sample
    const now = performance.now();
    const samples = velocitySamples.current;
    samples.push({ y: clientY, t: now });
    if (samples.length > MAX_SAMPLES) samples.shift();

    onDragMove?.(dy);
  }, [isAnimating, onDragMove]);

  const handleEndByCoords = useCallback((clientY: number, clientX: number, canceled = false) => {
    dragActive.current = false;
    if (canceled || isAnimating) {
      onGestureEnd?.(false);
      return;
    }

    const dy = clientY - ty0.current;
    const dx = clientX - tx0.current;

    // Ignore mostly-horizontal gestures
    if (Math.abs(dy) < Math.abs(dx)) {
      onGestureEnd?.(false);
      return;
    }

    // If onRelease is provided, use momentum path
    if (onRelease) {
      const velocity = computeVelocity();
      // Only trigger if there was meaningful vertical movement
      if (Math.abs(dy) < swipeThresholdRef.current && Math.abs(velocity) < 0.15) {
        onGestureEnd?.(false);
        return;
      }
      onGestureEnd?.(true);
      onRelease(dy, velocity);
      return;
    }

    // Legacy discrete path (wheel fallback)
    if (Math.abs(dy) < swipeThresholdRef.current) {
      onGestureEnd?.(false);
      return;
    }

    onGestureEnd?.(true);
    if (dy < 0) onSwipeUp();
    else onSwipeDown();
  }, [isAnimating, onGestureEnd, onSwipeDown, onSwipeUp, onRelease, computeVelocity]);

  // Wheel support (desktop) 
  const wheelAccum = useRef(0);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const WHEEL_THRESHOLD = 120;
  const WHEEL_TIMEOUT = 300;

  useEffect(() => {
    const el = containerRef?.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (isAnimating) return;

      wheelAccum.current += e.deltaY;

      const previewDy = -Math.sign(wheelAccum.current) * Math.min(Math.abs(wheelAccum.current), 80);
      onDragMove?.(previewDy);

      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => {
        onGestureEnd?.(false);
        wheelAccum.current = 0;
      }, WHEEL_TIMEOUT);

      if (Math.abs(wheelAccum.current) >= WHEEL_THRESHOLD) {
        const direction = wheelAccum.current > 0 ? 'up' : 'down';
        wheelAccum.current = 0;
        if (wheelTimer.current) clearTimeout(wheelTimer.current);
        onGestureEnd?.(true);
        if (direction === 'up') onSwipeUp();
        else onSwipeDown();
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
    };
  }, [isAnimating, onSwipeUp, onSwipeDown, onDragMove, onGestureEnd, containerRef]);

  // Touch handlers
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (isAnimating) return;
    stopTouchTracking();
    ty0.current = e.touches[0].clientY;
    tx0.current = e.touches[0].clientX;
    velocitySamples.current = [{ y: e.touches[0].clientY, t: performance.now() }];
    const h = (e.currentTarget as HTMLElement | null)?.clientHeight || window.innerHeight || 0;
    swipeThresholdRef.current = Math.max(35, Math.floor(h * 0.02));
    dragActive.current = true;
    const doc = e.currentTarget.ownerDocument || document;

    const onDocMove = (ev: TouchEvent) => {
      if (!dragActive.current) return;
      const t = ev.touches[0] || ev.changedTouches[0];
      if (!t) return;
      handleMoveByCoords(t.clientY, t.clientX);
      if (ev.cancelable) ev.preventDefault();
    };

    const onDocEnd = (ev: TouchEvent) => {
      const t = ev.changedTouches[0] || ev.touches[0];
      handleEndByCoords(t ? t.clientY : ty0.current, t ? t.clientX : tx0.current, false);
      stopTouchTracking();
    };

    const onDocCancel = (ev: TouchEvent) => {
      const t = ev.changedTouches[0] || ev.touches[0];
      handleEndByCoords(t ? t.clientY : ty0.current, t ? t.clientX : tx0.current, true);
      stopTouchTracking();
    };

    doc.addEventListener('touchmove', onDocMove, { passive: false });
    doc.addEventListener('touchend', onDocEnd, { passive: false });
    doc.addEventListener('touchcancel', onDocCancel, { passive: false });
    touchTrackingCleanupRef.current = () => {
      doc.removeEventListener('touchmove', onDocMove);
      doc.removeEventListener('touchend', onDocEnd);
      doc.removeEventListener('touchcancel', onDocCancel);
    };

    if (e.cancelable) e.preventDefault();
  }, [handleEndByCoords, handleMoveByCoords, isAnimating, stopTouchTracking]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragActive.current) return;
    const t = e.touches[0];
    if (!t) return;
    handleMoveByCoords(t.clientY, t.clientX);
    if (e.cancelable) e.preventDefault();
  }, [handleMoveByCoords]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const t = e.changedTouches[0] || e.touches[0];
    handleEndByCoords(t ? t.clientY : ty0.current, t ? t.clientX : tx0.current, false);
    stopTouchTracking();
  }, [handleEndByCoords, stopTouchTracking]);

  const onTouchCancel = useCallback((e: React.TouchEvent) => {
    const t = e.changedTouches[0] || e.touches[0];
    handleEndByCoords(t ? t.clientY : ty0.current, t ? t.clientX : tx0.current, true);
    stopTouchTracking();
  }, [handleEndByCoords, stopTouchTracking]);

  useEffect(() => {
    if (!isAnimating) return;
    dragActive.current = false;
    stopTouchTracking();
  }, [isAnimating, stopTouchTracking]);

  useEffect(() => () => {
    dragActive.current = false;
    stopTouchTracking();
  }, [stopTouchTracking]);

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel };
}
