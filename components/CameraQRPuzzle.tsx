'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2 } from 'lucide-react';
import type { CameraQRPuzzle } from '../types/node';

/** Minimal shape of the (still experimental) Barcode Detection API. */
interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
}

/**
 * Corner brackets for the viewfinder overlay. Each entry draws only the two
 * edges that meet at that corner.
 *
 * The interface (rather than `as const` alone) is what lets every entry be read
 * for all four booleans — an inferred tuple type would give each object only
 * the keys it literally declares.
 */
interface ViewfinderCorner {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  borderTop: boolean;
  borderRight: boolean;
  borderBottom: boolean;
  borderLeft: boolean;
}

const VIEWFINDER_CORNERS: ViewfinderCorner[] = [
  { top: 12, left: 12, borderTop: true, borderRight: false, borderBottom: false, borderLeft: true },
  { top: 12, right: 12, borderTop: true, borderRight: true, borderBottom: false, borderLeft: false },
  { bottom: 12, left: 12, borderTop: false, borderRight: false, borderBottom: true, borderLeft: true },
  { bottom: 12, right: 12, borderTop: false, borderRight: true, borderBottom: true, borderLeft: false },
];

function getBarcodeDetector(): BarcodeDetectorLike | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as unknown as { BarcodeDetector?: new () => BarcodeDetectorLike })
    .BarcodeDetector;
  return ctor ? new ctor() : null;
}

/**
 * Camera-QR puzzle.
 *
 * The native build overlaid a viewfinder and decoded a QR code from the live
 * camera feed. On the web we attempt the same via `getUserMedia` plus the
 * `BarcodeDetector` API. That API is not in Safari/Firefox, so a manual entry
 * field is always offered as a fallback — without it, these puzzles would be
 * unsolvable outside Chrome.
 */
export function CameraQRPuzzleBody({
  puzzle,
  onSolved,
  submitted,
}: {
  puzzle: CameraQRPuzzle;
  onSolved: (value: string) => void;
  submitted: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /** Holds the live camera stream so it can be stopped on close/unmount. */
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraState, setCameraState] = useState<'idle' | 'starting' | 'active' | 'unsupported'>(
    'idle'
  );
  const [manualValue, setManualValue] = useState('');
  const detector = useRef<BarcodeDetectorLike | null>(null);

  // Stop every camera track on unmount — leaving the light on is a real bug.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraState('idle');
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('unsupported');
      return;
    }

    setCameraState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const BarcodeCtor = getBarcodeDetector();
      if (!BarcodeCtor) {
        // Camera works, but we cannot decode frames on this browser.
        setCameraState('unsupported');
        return;
      }

      detector.current = BarcodeCtor;
      setCameraState('active');

      // Poll frames for a QR payload.
      const tick = async () => {
        if (!streamRef.current || !videoRef.current || !detector.current) return;
        try {
          const results = await detector.current.detect(videoRef.current);
          if (results.length > 0 && results[0].rawValue) {
            stopCamera();
            onSolved(results[0].rawValue);
            return;
          }
        } catch {
          // A frame that can't be decoded is normal; keep polling.
        }
        if (streamRef.current) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      setCameraState('unsupported');
      stopCamera();
    }
  };


  return (
    <>
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, lineHeight: 1.45 }}>
        Scan the code at {puzzle.targetLandmarkName}
      </h3>
      <p className="pageSubtitle" style={{ marginBottom: 14 }}>
        Hint: {puzzle.hintPhrase}
      </p>

      {cameraState === 'active' && (
        <div
          style={{
            position: 'relative',
            borderRadius: 16,
            overflow: 'hidden',
            marginBottom: 14,
            background: '#000',
          }}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            style={{ width: '100%', display: 'block', maxHeight: 300 }}
          />
          {/* Viewfinder corner brackets, matching the native overlay. */}
          {VIEWFINDER_CORNERS.map((corner, i) => (
            <span
              key={i}
              aria-hidden="true"
              style={{
                position: 'absolute',
                width: 20,
                height: 20,
                borderColor: '#38bdf8',
                borderStyle: 'solid',
                borderTopWidth: corner.borderTop ? 3 : 0,
                borderLeftWidth: corner.borderLeft ? 3 : 0,
                borderRightWidth: corner.borderRight ? 3 : 0,
                borderBottomWidth: corner.borderBottom ? 3 : 0,
                top: corner.top,
                left: corner.left,
                right: corner.right,
                bottom: corner.bottom,
              }}
            />
          ))}
        </div>
      )}

      {cameraState === 'idle' && (
        <button
          type="button"
          className="btnPrimary"
          style={{ width: '100%', marginBottom: 14 }}
          onClick={startCamera}
        >
          <Camera size={18} />
          Start Camera Scan
        </button>
      )}

      {cameraState === 'starting' && (
        <div className="banner bannerInfo" style={{ marginBottom: 14 }}>
          Requesting camera access…
        </div>
      )}

      {cameraState === 'unsupported' && (
        <div className="banner bannerWarn" style={{ marginBottom: 14 }}>
          Live QR scanning needs a Chromium browser with camera access. You can also type the
          code below.
        </div>
      )}

      <div className="field">
        <label className="fieldLabel" htmlFor="qr-manual">
          Or enter the code manually
        </label>
        <input
          id="qr-manual"
          className="input mono"
          value={manualValue}
          onChange={(e) => setManualValue(e.target.value)}
          placeholder="Paste or type the scanned code"
          disabled={submitted}
        />
      </div>

      <button
        type="button"
        className="btnPrimary"
        style={{ width: '100%' }}
        onClick={() => onSolved(manualValue)}
        disabled={!manualValue.trim() || submitted}
      >
        {submitted ? <CheckCircle2 size={18} /> : <Camera size={18} />}
        Verify Code
      </button>
    </>
  );
}
