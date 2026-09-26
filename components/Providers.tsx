'use client';

import { useEffect, useState } from 'react';
import { ShieldAlert, Terminal, X } from 'lucide-react';
import { GameProvider } from '../context/GameContext';
import { HuntProvider } from '../context/HuntContext';
import { LocationProvider } from '../context/LocationContext';

/**
 * Client boundary for every context-driven screen.
 *
 * Both providers are client components (they read localStorage and hold live
 * React state), so they are mounted here once in the root layout rather than
 * being re-declared per page. `LocationProvider` joins them so the GPS watch
 * outlives page navigation (see `context/LocationContext.tsx`).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GameProvider>
      <LocationProvider>
        <HuntProvider>{children}</HuntProvider>
      </LocationProvider>
    </GameProvider>
  );
}

/**
 * Explains, in-app, why location-based features are dead on an insecure origin.
 *
 * Browsers only expose Geolocation (and Camera/Clipboard/Service Workers) inside
 * a "secure context" — HTTPS, or `localhost`. Reaching the dev server from a
 * phone over `http://<LAN-IP>:3000` is neither, so `navigator.geolocation`
 * rejects with "Only secure origins are allowed".
 *
 * The failure is otherwise silent: without a fix there is nothing to draw, so
 * the app simply waits. This banner names the cause and the fix instead of
 * leaving the player wondering why nothing works.
 */
export function SecureContextBanner() {
  const [insecure, setInsecure] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // `isSecureContext` is false on plain-http LAN origins, true on HTTPS/localhost.
    setInsecure(!window.isSecureContext);
  }, []);

  if (!insecure || dismissed) return null;

  return (
    <div className="secureBanner" role="status">
      <div className="secureBannerHead">
        <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <strong>Insecure connection — GPS is disabled</strong>
        <button
          type="button"
          className="secureBannerClose"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
        >
          <X size={14} />
        </button>
      </div>

      <p>
        You opened this over plain <code>http://</code>, which browsers treat as an insecure
        origin. Geolocation, camera, and clipboard are all blocked until the page is served
        over <code>https://</code> (or <code>localhost</code>).
      </p>

      <p className="secureBannerHint">
        <Terminal size={13} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          Quickest fix — expose the dev server over HTTPS with a tunnel, then open the{' '}
          <code>https://…trycloudflare.com</code> URL on your phone:
          <code className="secureBannerCode">npm run dev:tunnel</code>
        </span>
      </p>

      <p className="secureBannerFoot">
        Already using HTTPS and still seeing this? The page may be running inside an
        in-app browser (a link opened from WhatsApp/Instagram) &mdash; use &ldquo;Open in Safari /
        Chrome&rdquo; instead.
      </p>
    </div>
  );
}