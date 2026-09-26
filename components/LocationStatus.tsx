'use client';

import { useCallback, useEffect, useState } from 'react';
import { Crosshair, RefreshCw } from 'lucide-react';
import { useGame } from '../context/GameContext';
import { useLocation } from '../context/LocationContext';
import { calculateHaversineDistance, formatDistance } from '../utils/geo';
import { triggerHaptic, playSoundEffect } from '../utils/sound';
import { LocationCoordinates } from '../types/game';

/** The stop a manual range check measures against. */
export interface LocationTarget {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

interface LocationStatusProps {
  /** Stop to measure against; omit for a readout with no verdict. */
  target?: LocationTarget | null;
  /** `card` = full panel inside a play card; `compact` = one row on the AR frame. */
  variant?: 'card' | 'compact';
}

/** Outcome of the last manual check. */
interface Verdict {
  ok: boolean;
  text: string;
}

/**
 * Live position readout + manual "am I in range?" check.
 *
 * Both parts answer the same failure: auto-detection going quiet. The raw
 * coordinates, their accuracy and their age make it obvious whether the feed is
 * alive at all, and the button forces a brand-new fix (never the browser's
 * cached one), so a player standing inside the discovery radius — but never
 * detected as being in range — can prove it and move the hunt on.
 *
 * The verdict only ever appears after the player asks for it: the coordinates
 * are the player's own, but the distance to an undiscovered character is
 * normally hidden by the strict-visibility rules, so it stays behind the tap.
 */
export function LocationStatus({ target = null, variant = 'card' }: LocationStatusProps) {
  const { userLocation } = useGame();
  const { errorMsg, permissionStatus, isWatching, lastFixAt, requestFreshFix } = useLocation();

  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  /** Ticks the "updated 12s ago" label; local state keeps parent screens quiet. */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /** Measures one position against the stop — the whole point of the button. */
  const measure = useCallback(
    (coords: LocationCoordinates): Verdict => {
      if (!target) {
        return {
          ok: true,
          text: `Position confirmed: ${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}.`,
        };
      }
      const distance = calculateHaversineDistance(coords, target);
      const inside = distance <= target.radiusMeters;
      return {
        ok: inside,
        text: inside
          ? `In range — ${formatDistance(distance)} away, inside the ${target.radiusMeters}m discovery zone.`
          : `Not in range yet — ${formatDistance(distance)} away. You must be within ${target.radiusMeters}m of the stop.`,
      };
    },
    [target]
  );

  const handleCheck = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    triggerHaptic('light');
    try {
      const fresh = await requestFreshFix();
      if (!fresh) {
        setVerdict({
          ok: false,
          text:
            permissionStatus === 'denied'
              ? 'Location access is blocked for this site. Allow it in your browser settings, then check again.'
              : 'Could not read your location just now. Step into the open and check again.',
        });
        triggerHaptic('warning');
        return;
      }

      const next = measure(fresh);
      setVerdict(next);
      triggerHaptic(next.ok ? 'success' : 'warning');
      void playSoundEffect(next.ok ? 'in_range' : 'radar_ping');
    } finally {
      setChecking(false);
    }
  }, [checking, measure, permissionStatus, requestFreshFix]);

  const fixAgeS = lastFixAt === null ? null : Math.max(0, Math.round((now - lastFixAt) / 1000));
  const fixAge =
    fixAgeS === null
      ? null
      : fixAgeS < 5
        ? 'just now'
        : fixAgeS < 60
          ? `${fixAgeS}s ago`
          : `${Math.round(fixAgeS / 60)} min ago`;

  const coordsLabel = userLocation
    ? `${userLocation.latitude.toFixed(6)}, ${userLocation.longitude.toFixed(6)}`
    : 'Waiting for a position…';
  const accuracyLabel =
    userLocation?.accuracy != null ? `±${Math.round(userLocation.accuracy)}m` : null;
  const sourceLabel = isWatching
    ? fixAge
      ? `Live GPS · ${fixAge}`
      : 'Live GPS · starting…'
    : 'GPS idle';

  if (variant === 'compact') {
    return (
      <>
        <div className="arLocBar">
          <span className="arLocCoords mono">{coordsLabel}</span>
          <span className="arLocMeta">{accuracyLabel ?? ''}</span>
          <button
            type="button"
            className="arLocCheck"
            onClick={() => void handleCheck()}
            disabled={checking}
          >
            <RefreshCw size={12} className={checking ? 'locSpin' : undefined} />
            {checking ? 'Checking' : 'Check range'}
          </button>
        </div>

        {verdict && (
          <p
            className={`arLocVerdict ${verdict.ok ? 'arLocVerdictOk' : 'arLocVerdictFar'}`}
            role="status"
          >
            {verdict.text}
          </p>
        )}

        {errorMsg && (
          <p className="arLocVerdict arLocVerdictError" role="status">
            {errorMsg}
          </p>
        )}
      </>
    );
  }

  return (
    <div className="locPanel">
      <div className="locHead">
        <Crosshair size={13} />
        <span className="locHeadLabel">Your live position</span>
        <span className="locBadge">{sourceLabel}</span>
      </div>

      <div className="locCoords mono">{coordsLabel}</div>
      {accuracyLabel && <div className="locMeta">Accuracy {accuracyLabel}</div>}

      <div className="locActions">
        <button
          type="button"
          className="locCheckBtn"
          onClick={() => void handleCheck()}
          disabled={checking}
        >
          <RefreshCw size={13} className={checking ? 'locSpin' : undefined} />
          {checking ? 'Checking…' : target ? 'Check if I am in range' : 'Check my position'}
        </button>
      </div>

      {verdict && (
        <p className={`locVerdict ${verdict.ok ? 'locVerdictOk' : 'locVerdictFar'}`} role="status">
          {verdict.text}
        </p>
      )}

      {errorMsg && (
        <p className="locVerdict locVerdictError" role="status">
          {errorMsg}
        </p>
      )}

      <p className="locNote">
        In-range detection runs on the live GPS watch. If you have walked in and the game has
        not noticed, check now.
      </p>
    </div>
  );
}
