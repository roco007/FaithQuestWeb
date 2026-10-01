'use client';

import { useMemo, useState } from 'react';
import {
  Camera,
  Check,
  CircleAlert,
  Crosshair,
  HelpCircle,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  useDevicePermissions,
  type DevicePermission,
  type DevicePermissionKey,
  type DevicePermissionState,
} from '../hooks/useDevicePermissions';

interface JoinPreflightProps {
  /** Runs the actual join — called only once the checklist is satisfied. */
  onJoin: () => void;
  /** Backs out to the invite, without joining. */
  onCancel: () => void;
  /** True while the join itself is in flight (the checklist is done by then). */
  joining: boolean;
}

/** Presentational spec for each checklist row. */
interface RowSpec {
  key: DevicePermissionKey;
  label: string;
  /** Why the hunt needs it at all. */
  blurb: string;
}

/**
 * The two things a hunt cannot run without. Location first because it is the
 * one that silently breaks everything: a denied GPS watch leaves the player
 * walking around a map that never notices they arrived.
 */
const ROWS: RowSpec[] = [
  {
    key: 'location',
    label: 'Precise location access',
    blurb: 'Finds the characters pinned around you. Coarse location is not enough — the discovery zones are only metres wide.',
  },
  {
    key: 'camera',
    label: 'Camera access',
    blurb: 'Shows the characters in the world in front of you through the AR view.',
  },
];

/** Label + tone of the status pill, per state. */
const STATUS_META: Record<DevicePermissionState, { label: string; className: string }> = {
  granted: { label: 'Allowed', className: 'permPillOk' },
  prompt: { label: 'Needed', className: 'permPillPending' },
  unknown: { label: 'Needed', className: 'permPillPending' },
  denied: { label: 'Blocked', className: 'permPillBad' },
  error: { label: 'Not working', className: 'permPillBad' },
  unsupported: { label: 'Unavailable', className: 'permPillBad' },
};

/** Enough of a browser sniff to name the right settings path, nothing more. */
type Platform = 'ios' | 'android' | 'desktop';

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  // iPadOS 13+ reports a desktop Safari UA, so the touch-point count is the
  // only thing that tells it apart from a real Mac.
  const isIpadOs = /Macintosh/.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || isIpadOs) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

/**
 * The steps that actually restore a blocked permission.
 *
 * A blocked origin is refused silently forever — no code path can re-trigger the
 * dialog — so the only route back is the browser's own settings, which live in
 * a different place on every platform. Guessing wrong would send a player down
 * a dead end, so each step is written to be recognisable even if the labels
 * have shifted slightly in their browser's version.
 */
const UNBLOCK_STEPS: Record<DevicePermissionKey, Record<Platform, string[]>> = {
  location: {
    ios: [
      'Open Settings → Privacy & Security → Location Services.',
      'Tap Safari (Websites) and turn it on. Turn on Precise Location too if it is off.',
      'Come back here and press Check again.',
    ],
    android: [
      'Tap the ⋮ menu in Chrome → Settings → Site settings → Location.',
      'Set it to Allow, and make sure Location permission is Precise, not Approximate.',
      'Come back here and press Check again.',
    ],
    desktop: [
      'Click the icon at the left of the address bar → Site settings.',
      'Set Location to Allow, then reload the page.',
      'Come back here and press Check again.',
    ],
  },
  camera: {
    ios: [
      'Open Settings → Privacy & Security → Camera.',
      'Turn on Safari (Websites).',
      'Come back here and press Check again.',
    ],
    android: [
      'Tap the ⋮ menu in Chrome → Settings → Site settings → Camera.',
      'Set it to Allow, then reload the page.',
      'Come back here and press Check again.',
    ],
    desktop: [
      'Click the icon at the left of the address bar → Site settings.',
      'Set Camera to Allow, then reload the page.',
      'Come back here and press Check again.',
    ],
  },
};

/** Shown when the API is not merely switched off but not available at all. */
const UNSUPPORTED_STEPS: Record<DevicePermissionKey, string[]> = {
  location: [
    'Reopen this hunt over https:// — browsers only expose location on a secure page.',
    'On a computer, http://localhost counts as secure too.',
    'In-app browsers (links opened from WhatsApp or Instagram) often block it — use “Open in Safari / Chrome”.',
  ],
  camera: [
    'Open this hunt in Safari or Chrome — not every in-app browser exposes a camera.',
    'Make sure you are on https://, not plain http://.',
    'Check that another app is not holding the camera.',
  ],
};

/** The numbered "here is how to unblock it" panel. */
function UnblockSteps({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div className="permHelp">
      <p className="permHelpTitle">{title}</p>
      <ol className="permHelpList">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

/**
 * One checklist row: icon, what it is for, its status, and the button that
 * moves it forward.
 *
 * The button is deliberately *not* always a re-request. Once a browser has
 * blocked an origin it refuses forever and shows no dialog, so a "Try again"
 * there does nothing at all and reads as a broken button. The row therefore
 * asks the Permissions API whether another request would still prompt:
 * `apiState === 'prompt'` means retry is worth offering, `denied` means the only
 * route back is browser settings, so the button opens those steps instead.
 */
function PermissionRow({
  spec,
  permission,
  busy,
  onRequest,
  helpOpen,
  onToggleHelp,
}: {
  spec: RowSpec;
  permission: DevicePermission;
  busy: boolean;
  onRequest: () => void;
  helpOpen: boolean;
  onToggleHelp: () => void;
}) {
  const { state, detail, apiState } = permission;
  const status = STATUS_META[state];
  const granted = state === 'granted';

  // Unsupported can never be fixed by retrying, so it always gets the guide.
  // A refusal only loses its retry button once the browser confirms the origin
  // is blocked; where it does not expose the permission, retry stays, because
  // the next request is the only way to find out.
  const needsHelp = state === 'unsupported' || (state === 'denied' && apiState === 'denied');
  /**
   * A blocked permission gets *both* actions, side by side.
   *
   * "How to allow" is the route that reliably works, but retrying is still worth
   * offering rather than hiding: the player may already have unblocked the site
   * in their settings without reloading, and in several browsers a dismissal
   * (as opposed to a hard block) is resolved by asking again. Hiding it would
   * strand anyone in that situation.
   *
   * `unsupported` is the exception — with no API on the origin, another request
   * cannot change anything, so it gets the guide alone rather than a dead button.
   */
  const showRetryAlongsideHelp = state === 'denied' && apiState === 'denied';
  // Only sniffed while the panel is actually open — the platform never changes
  // and the answer is only used to phrase steps the player is reading.
  const steps = useMemo(
    () =>
      state === 'unsupported'
        ? UNSUPPORTED_STEPS[spec.key]
        : UNBLOCK_STEPS[spec.key][detectPlatform()],
    [spec.key, state]
  );

  const spinner = (
    <>
      <Loader2 size={14} className="permSpin" />
      Asking…
    </>
  );

  return (
    <>
      <li className={`permRow ${granted ? 'permRowOk' : 'permRowTodo'}`}>
        <span className="permRowIcon" aria-hidden="true">
          {spec.key === 'location' ? <Crosshair size={17} /> : <Camera size={17} />}
        </span>

        <div className="permRowMain">
          <div className="permRowHead">
            <span className="permRowLabel">{spec.label}</span>
            <span className={`permPill ${status.className}`}>{status.label}</span>
          </div>
          <p className="permRowBlurb">{detail ?? spec.blurb}</p>
        </div>

        <div className="permRowActions">
          <button
            type="button"
            className={granted ? 'permBtn permBtnDone' : 'permBtn'}
            onClick={onRequest}
            disabled={busy}
          >
            {busy
              ? spinner
              : granted
                ? (
                  <>
                    <Check size={14} />
                    Check again
                  </>
                )
                : showRetryAlongsideHelp || state === 'denied' || state === 'error'
                  ? 'Try again'
                  : 'Allow'}
          </button>

          {needsHelp && (
            <button
              type="button"
              className="permBtn permBtnHelp"
              onClick={onToggleHelp}
              aria-expanded={helpOpen}
            >
              <HelpCircle size={14} />
              {helpOpen ? 'Hide steps' : state === 'unsupported' ? 'How to fix' : 'How to allow'}
            </button>
          )}
        </div>
      </li>

      {needsHelp && helpOpen && (
        <li className="permHelpWrap">
          <UnblockSteps
            title={
              state === 'unsupported'
                ? `This device cannot reach ${spec.label.toLowerCase()}`
                : `${spec.label} is blocked for this site`
            }
            steps={steps}
          />
        </li>
      )}
    </>
  );
}

/**
 * The permission checklist a player passes through before joining a hunt.
 *
 * The join button stays locked until both permissions are granted. Where the
 * app has to ask, it treats "granted" as *proven*: it waits for a real GPS fix
 * and a real camera frame rather than trusting the prompt's answer, because
 * both answers can be hollow — a player can allow location and still be indoors
 * with no fix, and the camera can be allowed but busy in another app. A
 * permission the browser already reported as granted from a previous session is
 * taken at its word, so a returning player is never asked twice.
 *
 * Every row starts with a visible **Allow** button rather than firing the
 * prompts on mount: browsers only raise a geolocation/camera prompt inside a
 * user gesture, so an automatic request would be silently dropped and the
 * checklist would sit on "Needed" forever. Each grant is a deliberate tap.
 *
 * A player whose browser will never grant one of these (no camera hardware, a
 * policy-blocked device, an in-app browser that withholds prompts) is not
 * trapped: *Join anyway* stays available and hands them to the hunt with
 * whatever did work.
 */
export function JoinPreflight({ onJoin, onCancel, joining }: JoinPreflightProps) {
  const { permissions, allGranted, requesting, requestLocation, requestCamera } =
    useDevicePermissions();

  /**
   * Which row, if any, is showing its unblock steps.
   *
   * Opened by hand from the row's button, and opened *automatically* when a
   * request comes back refused: that is the moment the browser has made it
   * clear it will not prompt again, and leaving the player on a button that
   * does nothing is the exact dead end this state exists to avoid.
   */
  const [helpKey, setHelpKey] = useState<DevicePermissionKey | null>(null);

  const requestFor: Record<DevicePermissionKey, () => void> = {
    location: () =>
      void requestLocation().then(({ blocked }) => {
        // `blocked` is the hook's fresh read of the Permissions API, not a
        // value held in state — so it is reliable even though the browser's
        // `change` event has not fired yet. Show the steps rather than leaving
        // the player on a button that would do nothing.
        if (blocked) setHelpKey('location');
      }),
    camera: () =>
      void requestCamera().then(({ blocked }) => {
        if (blocked) setHelpKey('camera');
      }),
  };

  const toggleHelp = (key: DevicePermissionKey) =>
    setHelpKey((prev) => (prev === key ? null : key));

  return (
    <div className="preflight">
      <ul className="permList">
        {ROWS.map((spec) => (
          <PermissionRow
            key={spec.key}
            spec={spec}
            permission={permissions[spec.key]}
            busy={requesting === spec.key}
            onRequest={requestFor[spec.key]}
            helpOpen={helpKey === spec.key}
            onToggleHelp={() => toggleHelp(spec.key)}
          />
        ))}
      </ul>

      {allGranted && (
        <div className="banner bannerInfo" style={{ marginBottom: 0 }}>
          <ShieldCheck size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>All set — location and camera are both ready. Enjoy the hunt.</span>
        </div>
      )}

      <div className="shareActions" style={{ marginTop: 16 }}>
        <button
          type="button"
          className="btnAmber"
          onClick={onJoin}
          disabled={!allGranted || joining}
          title={allGranted ? undefined : 'Allow both location and camera first.'}
        >
          <ShieldCheck size={16} />
          {joining ? 'Joining…' : 'Join the hunt'}
        </button>
        <button type="button" className="btnGhost" onClick={onCancel} disabled={joining}>
          <X size={15} />
          Back
        </button>
      </div>

      {!allGranted && (
        <div className="preflightSkip">
          <p className="preflightSkipNote">
            <CircleAlert size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              No access? The map and the walking between characters still work without it.
            </span>
          </p>
          <button type="button" className="preflightSkipBtn" onClick={onJoin} disabled={joining}>
            Join anyway
          </button>
        </div>
      )}
    </div>
  );
}
