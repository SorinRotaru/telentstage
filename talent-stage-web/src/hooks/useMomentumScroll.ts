import { useRef, useCallback } from 'react';

// Physics constants (tunable)
const DRAG_FACTOR = 0.994;            // exponential drag per ms (lower = more friction)
const VELOCITY_COMMIT_THRESHOLD = 0.4; // px/ms — fast flick always commits
const POSITION_COMMIT_THRESHOLD = 0.35; // fraction of containerH — dragged far enough
const VELOCITY_DEAD = 0.05;           // px/ms — consider velocity dead below this
const POSITION_DEAD = 0.25;           // fraction — snap back if below this when velocity dies
const SPRING_STIFFNESS = 0.14;        // spring pull toward target
const SPRING_DAMPING = 0.72;          // velocity damping in spring phase
const OVERSHOOT_CLAMP = 1.0;         // keep motion inside one screen height to avoid end bounce

interface MomentumConfig {
  containerH: number;
  onOffsetChange: (offset: number) => void;
  onCommit: (direction: 'up' | 'down') => void;
  onSnapBack: () => void;
}

export interface MomentumAPI {
  startMomentum: (currentOffset: number, velocityPxPerMs: number) => void;
  isRunning: () => boolean;
  cancel: () => void;
}

export function useMomentumScroll(config: MomentumConfig): MomentumAPI {
  const rafId = useRef<number | null>(null);
  const running = useRef(false);
  const configRef = useRef(config);
  configRef.current = config;

  const cancel = useCallback(() => {
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    running.current = false;
  }, []);

  const startMomentum = useCallback((currentOffset: number, velocityPxPerMs: number) => {
    cancel();
    running.current = true;

    let offset = currentOffset;
    let velocity = velocityPxPerMs;
    let lastTime = performance.now();
    let target: number | null = null; // null = coasting, 0 = snap-back, ±containerH = commit

    const tick = () => {
      if (!running.current) return;

      const { containerH, onOffsetChange, onCommit, onSnapBack } = configRef.current;
      const now = performance.now();
      const dt = Math.min(now - lastTime, 32); // cap at ~30fps minimum to avoid jumps
      lastTime = now;

      if (target === null) {
        // COAST PHASE: decelerate
        offset += velocity * dt;
        velocity *= Math.pow(DRAG_FACTOR, dt);

        const absOffset = Math.abs(offset);
        const absVelocity = Math.abs(velocity);

        // Decision: commit or snap-back?
        if (absVelocity > VELOCITY_COMMIT_THRESHOLD ||
            absOffset > containerH * POSITION_COMMIT_THRESHOLD) {
          target = offset < 0 ? -containerH : containerH;
        } else if (absVelocity < VELOCITY_DEAD) {
          // Always resolve when momentum dies to avoid mid-screen dead zone.
          // Small displacement snaps back; larger displacement commits.
          target = absOffset >= containerH * POSITION_DEAD
            ? (offset < 0 ? -containerH : containerH)
            : 0;
        }
      }

      if (target !== null) {
        // SETTLE PHASE: spring toward target
        const prevOffset = offset;
        const delta = target - offset;
        velocity = velocity * SPRING_DAMPING + delta * SPRING_STIFFNESS;
        offset += velocity * (dt / 16); // normalize spring to ~60fps

        // Do not cross target; crossing produces visible end-of-swipe "jump".
        if (target < 0 && offset < target) {
          offset = target;
          velocity = 0;
        } else if (target > 0 && offset > target) {
          offset = target;
          velocity = 0;
        } else if (target === 0 && ((prevOffset < 0 && offset > 0) || (prevOffset > 0 && offset < 0))) {
          offset = 0;
          velocity = 0;
        }

        // Check if settled
        if (Math.abs(offset - target) < 0.5 && Math.abs(velocity) < 0.05) {
          offset = target;
          onOffsetChange(offset);
          running.current = false;
          rafId.current = null;
          if (target === 0) {
            onSnapBack();
          } else {
            onCommit(target < 0 ? 'up' : 'down');
          }
          return;
        }
      }

      // Clamp overshoot
      const maxOffset = configRef.current.containerH * OVERSHOOT_CLAMP;
      offset = Math.max(-maxOffset, Math.min(maxOffset, offset));

      onOffsetChange(offset);
      rafId.current = requestAnimationFrame(tick);
    };

    rafId.current = requestAnimationFrame(tick);
  }, [cancel]);

  const isRunning = useCallback(() => running.current, []);

  return { startMomentum, isRunning, cancel };
}
