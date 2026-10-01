import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Pre-flight device permissions demanded before a hunt starts.
 *
 * The two device features a hunt cannot run without are the GPS watch (every
 * character's discovery zone is a real-world radius) and the camera (the AR
 * view is the live rear-camera feed). Both are permissions the browser withholds
 * until the player says yes, and both fail silently afterwards — a hunt joined
 * without them opens on a map with a frozen position and an AR button that
 * never produces a frame. Asking once, up front, is the difference between a
 * player who can play and a player who is three screens deep wondering why
 * nothing works.
 */
export type DevicePermissionKey = 'location' | 'camera';

/**
 * `prompt`/`granted`/`denied` mirror the W3C `PermissionState`; `unknown` is
 * "never asked", and the last two are failures the browser's own vocabulary does
 * not cover — `error` (asked, but the request failed for another reason: no
 * fix, no camera on the device) and `unsupported` (the API is not exposed here,
 * e.g. geolocation on a plain-http origin).
 */
export type DevicePermissionState =
  | 'unknown'
  | 'prompt'
  | 'granted'
  | 'denied'
  | 'error'
  | 'unsupported';

export interface DevicePermission {
  key: DevicePermissionKey;
  state: DevicePermissionState;
  /** Short player-facing explanation of the current state (or why it failed). */
  detail: string | null;
  /**
   * The browser's own answer from the Permissions API, when it exposes one.
   *
   * This is the only reliable way to tell "you may still be asked" from "you
   * are never being asked again": `prompt` means another request would still
   * raise a dialog, while `denied` means this origin is blocked and **no amount
   * of retrying will ever show a prompt again**. Callers need that distinction
   * to choose between a button that re-requests and one that explains how to
   * unblock in browser settings — otherwise "Try again" silently does nothing
   * and reads as a broken button.
   *
   * `null` where the browser does not expose the permission (Safari and
   * Firefox for `camera`), which leaves the choice to the request's own result.
   */
  apiState: PermissionState | null;
}

/**
 * What a request settled on.
 *
 * `blocked` is the part callers cannot derive themselves: it means the browser
 * has blocked this origin and **will not raise a prompt again**, so re-requesting
 * is pointless and the only route back is browser settings.
 */
export interface PermissionOutcome {
  state: DevicePermissionState;
  blocked: boolean;
}

/** `location` is `geolocation` in the Permissions API. */
const PERMISSION_NAMES: Record<DevicePermissionKey, PermissionName> = {
  location: 'geolocation',
  camera: 'camera',
};

const LOCATION_UNSUPPORTED =
  'Location needs a secure page. Reopen this hunt over https:// (or on localhost).';
const CAMERA_UNSUPPORTED =
  'This browser does not expose a camera to web pages. Reopen this hunt in Safari or Chrome.';
const CAMERA_BUSY = 'The camera is busy in another app. Close it and retry.';
const CAMERA_TIMEOUT =
  'The camera took too long to start. Close other apps using it and try again.';

/**
 * Refusals worded so they never promise a prompt the browser will not show.
 *
 * A blocked origin is refused silently from then on — there is no dialog to
 * re-trigger — so the wording points at browser settings, and the checklist
 * offers those steps rather than another dead "Try again".
 */
const LOCATION_BLOCKED = 'Location is blocked for this site.';
const CAMERA_BLOCKED = 'Camera is blocked for this site.';

/**
 * An accuracy worse than this is Android's *approximate* location (the player
 * picked "Approximate" in the OS prompt, or withheld precise access), not a bad
 * GPS fix — which is why it is called out instead of just accepted: with it a
 * 25 m discovery zone is effectively unenterable.
 */
const APPROXIMATE_ACCURACY_M = 100;

/**
 * Reads a rejection's `name` without trusting `instanceof`.
 *
 * `getUserMedia` is specified to reject with a DOMException, but that is not
 * guaranteed across browsers or realms, and an `instanceof` check that fails
 * quietly collapses every distinct failure into one generic message — losing
 * the difference between "you denied this", "there is no camera" and "another
 * app is holding it", which is the difference between advice that helps and
 * advice that does not.
 */
function readErrorName(err: unknown): string {
  if (typeof err !== 'object' || err === null) return '';
  const { name } = err as { name?: unknown };
  return typeof name === 'string' ? name : '';
}

/**
 * Reads — never prompts for — a permission's current state.
 *
 * Safari exposes `permissions.query` for geolocation but throws for camera, and
 * Firefox does the same for some names, so an unsupported name resolves to
 * `null` rather than an exception. The player is only ever asked through
 * `requestLocation` / `requestCamera`, which need a real user gesture.
 *
 * The live `PermissionStatus` (not just its state) is returned because it emits
 * `change` when the player revokes the permission from browser settings while
 * the app is open.
 */
async function queryPermissionStatus(
  key: DevicePermissionKey
): Promise<PermissionStatus | null> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return null;
  try {
    return await navigator.permissions.query({ name: PERMISSION_NAMES[key] });
  } catch {
    return null;
  }
}

/**
 * Reports — and, on request, obtains — the device access a hunt needs.
 *
 * State is seeded from the Permissions API (so a player who already allowed
 * location months ago is not asked again) and kept live through `change`
 * events, which fire when the player revokes a permission from browser settings
 * while the app is open. An explicit request always wins over the seeded value:
 * the API reports "granted" the moment the OS prompt is answered, before we
 * know whether a fix or a frame actually arrives, so probing is what decides.
 */
export function useDevicePermissions() {
  const [location, setLocation] = useState<DevicePermission>({
    key: 'location',
    state: 'unknown',
    detail: null,
    apiState: null,
  });
  const [camera, setCamera] = useState<DevicePermission>({
    key: 'camera',
    state: 'unknown',
    detail: null,
    apiState: null,
  });
  /**
   * Partial updates, so a probe never clobbers the API view the two are tracked
   * alongside each other.
   */
  const patchLocation = useCallback(
    (next: Partial<DevicePermission>) => setLocation((prev) => ({ ...prev, ...next })),
    []
  );
  const patchCamera = useCallback(
    (next: Partial<DevicePermission>) => setCamera((prev) => ({ ...prev, ...next })),
    []
  );
  /** Which request is in flight, so only that row shows a spinner. */
  const [requesting, setRequesting] = useState<DevicePermissionKey | null>(null);
  /**
   * Whether a key has been probed. Until then the Permissions API may set the
   * state freely; afterwards it only *updates* it, so a player who changes
   * their mind in browser settings sees the checklist react.
   */
  const probed = useRef<Record<DevicePermissionKey, boolean>>({
    location: false,
    camera: false,
  });

  // Seed from the Permissions API and follow later changes to it.
  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];

    /**
     * Records the browser's own view of a permission.
     *
     * The first answer only sets the visible state when nothing has been probed
     * yet: a probe is stronger evidence (it proves a fix or a frame actually
     * arrived), so it must not be undone by a slower query resolving after it.
     * The raw API answer is always kept, because it — and only it — says whether
     * another request would still raise a prompt or whether this origin is
     * permanently blocked.
     *
     * Later `change` events are always honoured: that is the player revoking
     * access from browser settings, which nothing recorded locally can
     * contradict. The probe's `detail` is dropped with the state, since it
     * described the previous answer.
     */
    const watch = async (
      key: DevicePermissionKey,
      apply: (next: Partial<DevicePermission>) => void
    ) => {
      const status = await queryPermissionStatus(key);
      if (!status || disposed) return; // Unsupported here, or already unmounted.
      if (!probed.current[key]) apply({ state: status.state });
      apply({ apiState: status.state });
      const onChange = () => apply({ state: status.state, apiState: status.state, detail: null });
      status.addEventListener('change', onChange);
      cleanups.push(() => status.removeEventListener('change', onChange));
    };

    void watch('location', patchLocation);
    void watch('camera', patchCamera);

    return () => {
      disposed = true;
      cleanups.forEach((off) => off());
    };
  }, []);

  /**
   * Re-reads the Permissions API straight after a refusal.
   *
   * This exists because "denied" from a request is ambiguous on its own: it is
   * the same error whether the player just dismissed a prompt, or the origin is
   * permanently blocked and no prompt will ever appear again. Only the API
   * distinguishes them. Re-reading here — rather than trusting the value held in
   * state — is what makes the answer reliable: the browser's `change` event for
   * the refusal may not have fired yet when the request resolves, so a value
   * read from React state at that moment would still be stale.
   *
   * Returns true only when the origin is genuinely blocked. Where the browser
   * does not expose the permission, returns false, so the caller keeps offering
   * a retry — which is then the only way to find out.
   */
  const confirmBlocked = useCallback(
    async (key: DevicePermissionKey): Promise<boolean> => {
      const status = await queryPermissionStatus(key);
      const patch = key === 'location' ? patchLocation : patchCamera;
      patch({ apiState: status?.state ?? null });
      return status?.state === 'denied';
    },
    [patchCamera, patchLocation]
  );

  /**
   * Asks for a high-accuracy fix. Resolves with the state it settled on and
   * whether the browser has now blocked the origin, so the caller can show
   * unblock steps instead of another request that would do nothing.
   *
   * `enableHighAccuracy` is what makes the prompt offer a *precise* location on
   * Android, and the returned accuracy is how we tell whether the player took
   * it: a fix that lands coarser than ~100 m is Android's approximate mode, and
   * is reported as such rather than quietly accepted.
   *
   * A timeout or an unavailable position is *not* a denial: the permission may
   * well be granted (a building, a cold start), so those stay retryable instead
   * of being recorded as a refusal the player never gave.
   */
  const requestLocation = useCallback(async (): Promise<PermissionOutcome> => {
    if (
      typeof navigator === 'undefined' ||
      !('geolocation' in navigator) ||
      (typeof window !== 'undefined' && !window.isSecureContext)
    ) {
      patchLocation({ state: 'unsupported', detail: LOCATION_UNSUPPORTED });
      return { state: 'unsupported', blocked: false };
    }

    setRequesting('location');
    probed.current.location = true;
    const state = await new Promise<DevicePermissionState>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const accuracy = Math.round(pos.coords.accuracy);
          patchLocation({
            state: 'granted',
            detail:
              accuracy > APPROXIMATE_ACCURACY_M
                ? `Approximate position (±${accuracy}m). Turn on precise location for this site.`
                : `Precise to ±${accuracy}m.`,
          });
          resolve('granted');
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            patchLocation({ state: 'denied', detail: LOCATION_BLOCKED });
            resolve('denied');
          } else {
            patchLocation({
              state: 'error',
              detail:
                err.code === err.TIMEOUT
                  ? 'Location timed out. Move somewhere with a clearer signal and retry.'
                  : 'Your position is unavailable right now. Check your device settings and retry.',
            });
            resolve('error');
          }
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
      );
    });
    setRequesting(null);
    return {
      state,
      blocked: state === 'denied' && (await confirmBlocked('location')),
    };
  }, [confirmBlocked, patchLocation]);

  /**
   * Opens the camera to prove access, then closes it again. Resolves with the
   * state it settled on and whether the origin is now blocked, like
   * `requestLocation`.
   *
   * The probe uses the same rear-facing constraint as the AR view
   * (`HuntARCamera`) so a grant here is a grant there. Stopping the tracks is
   * the point: the camera light must not stay on for a player who is only
   * walking around a map, and the AR view opens its own stream when it needs it.
   */
  const requestCamera = useCallback(async (): Promise<PermissionOutcome> => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      (typeof window !== 'undefined' && !window.isSecureContext)
    ) {
      patchCamera({ state: 'unsupported', detail: CAMERA_UNSUPPORTED });
      return { state: 'unsupported', blocked: false };
    }

    setRequesting('camera');
    probed.current.camera = true;
    let state: DevicePermissionState;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      // Read the label before stopping: once the tracks end it is gone, and it
      // is the only proof we can show of *which* camera was granted.
      const label = stream.getVideoTracks()[0]?.label || null;
      stream.getTracks().forEach((track) => track.stop());
      patchCamera({
        state: 'granted',
        detail: label ? `Rear camera ready — ${label}.` : 'Rear camera ready.',
      });
      state = 'granted';
    } catch (err) {
      // Read `name` structurally rather than via `instanceof DOMException`: the
      // rejection is not reliably a DOMException across browsers or realms, and
      // a failed check silently drops the request into the generic branch — so a
      // missing camera would read as a bare "Not supported" instead of "no rear
      // camera was found", which is the actionable half of the message.
      const name = readErrorName(err);
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        patchCamera({ state: 'denied', detail: CAMERA_BLOCKED });
        state = 'denied';
      } else if (
        name === 'NotFoundError' ||
        name === 'OverconstrainedError' ||
        // `NotSupportedError` is the spec's "this device cannot do that at all"
        // — what desktop and headless browsers throw when there is no usable
        // camera. Easy to miss, and missing it falls through to the browser's raw
        // message ("Not supported") instead of saying what is actually wrong.
        name === 'NotSupportedError'
      ) {
        patchCamera({ state: 'error', detail: 'No rear camera was found on this device.' });
        state = 'error';
      } else if (name === 'NotReadableError') {
        patchCamera({ state: 'error', detail: CAMERA_BUSY });
        state = 'error';
      } else if (name === 'AbortError') {
        patchCamera({ state: 'error', detail: CAMERA_TIMEOUT });
        state = 'error';
      } else {
        patchCamera({
          state: 'error',
          detail: err instanceof Error ? err.message : 'Could not start the camera.',
        });
        state = 'error';
      }
    }
    setRequesting(null);
    return {
      state,
      blocked: state === 'denied' && (await confirmBlocked('camera')),
    };
  }, [confirmBlocked, patchCamera]);

  const allGranted = location.state === 'granted' && camera.state === 'granted';

  return {
    permissions: { location, camera } as Record<DevicePermissionKey, DevicePermission>,
    allGranted,
    requesting,
    requestLocation,
    requestCamera,
  };
}

