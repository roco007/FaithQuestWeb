'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, MoreHorizontal } from 'lucide-react';
import {
  EmailGlyph,
  FacebookGlyph,
  LinkedinGlyph,
  MessagesGlyph,
  PinterestGlyph,
  RedditGlyph,
  WhatsappGlyph,
  XGlyph,
} from './shareBrandGlyphs';
import { triggerHaptic } from '../utils/sound';

/** A glyph in the app row: a brand mark or a generic stand-in, both 24x24. */
type ShareGlyph = (props: { size?: number; className?: string }) => ReactNode;

/** What every target is handed to build its destination. */
interface ShareArgs {
  /** The deep join link. */
  url: string;
  /** The words to say about it: the hunt's title and the one-line summary. */
  body: string;
  /** The same, with the link appended, for platforms taking a single blob. */
  withLink: string;
  /** Subject line, for the platform that takes one. */
  subject: string;
}

/** One app in the share row. */
interface ShareTarget {
  id: string;
  /** Visible name under the disc, as native share sheets show it. */
  label: string;
  /** Brand colour of the disc. */
  color: string;
  Glyph: ShareGlyph;
  /**
   * True when the OS handles the destination itself, so the page must navigate
   * in place — a scheme URL handed to `window.open` is dropped by every browser.
   */
  scheme?: boolean;
  /** Builds the destination from the shared link and its words. */
  build: (args: ShareArgs) => string;
}

/**
 * The apps offered, in the order native share sheets list them: the messaging
 * apps an invite actually travels through first, then the socials a creator
 * posts their hunt to, then Email as the fallback for everyone else. "More" is
 * deliberately not in this list — see `ShareLink` — because the apps installed
 * on a given device are exactly what a static row cannot know.
 *
 * Each target builds its own URL because no two platforms want the same
 * arguments. Facebook's sharer takes the link and nothing else. X and Reddit
 * take the link and the message separately, and would print the link twice if it
 * were also inlined in the text. Pinterest takes a description. LinkedIn's
 * share-offsite endpoint takes the link alone and titles the post itself.
 */
const TARGETS: readonly ShareTarget[] = [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    color: '#25d366',
    Glyph: WhatsappGlyph,
    build: ({ withLink }) => `https://wa.me/?text=${encodeURIComponent(withLink)}`,
  },
  {
    id: 'messages',
    label: 'Messages',
    color: '#34c759',
    Glyph: MessagesGlyph,
    scheme: true,
    build: ({ withLink }) => `sms:?&body=${encodeURIComponent(withLink)}`,
  },
  {
    id: 'facebook',
    label: 'Facebook',
    color: '#1877f2',
    Glyph: FacebookGlyph,
    build: ({ url }) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
  {
    id: 'x',
    label: 'X',
    color: '#18181b',
    Glyph: XGlyph,
    build: ({ url, body }) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(
        body
      )}&url=${encodeURIComponent(url)}`,
  },
  {
    id: 'reddit',
    label: 'Reddit',
    color: '#ff4500',
    Glyph: RedditGlyph,
    build: ({ url, body }) =>
      `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(body)}`,
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    color: '#0a66c2',
    Glyph: LinkedinGlyph,
    build: ({ url }) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  },
  {
    id: 'pinterest',
    label: 'Pinterest',
    color: '#e60023',
    Glyph: PinterestGlyph,
    // Pinterest builds its preview card by fetching the URL, so a link whose
    // hunt lives in the fragment (never sent to a server) arrives as a bare app
    // shell. The pin and its description still post; only the image is blank.
    build: ({ url, body }) =>
      `https://www.pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}&description=${encodeURIComponent(body)}`,
  },
  {
    id: 'email',
    label: 'Email',
    color: '#ea4335',
    Glyph: EmailGlyph,
    scheme: true,
    build: ({ subject, withLink }) =>
      `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(withLink)}`,
  },
];

interface ShareLinkProps {
  /** The artefact being shared — the deep join link. */
  url: string;
  /** First line of the message: the hunt's title. */
  title: string;
  /** Optional second line: a one-line summary of what is being shared. */
  text?: string;
  /** Subject line for the platforms that take one. */
  subject?: string;
  /** Shown above the row; the sheet's heading. */
  heading?: string;
  /** Fired after a successful clipboard write, so the host can toast as well. */
  onCopied?: () => void;
  /** Fired when the clipboard is unavailable, so the host can explain why. */
  onCopyBlocked?: () => void;
}

/**
 * Share sheet in the shape players already know from YouTube and iOS: a row of
 * app icons you tap, with the link itself underneath for copying by hand.
 *
 * The row is a set of deep links rather than the OS share sheet because a
 * browser page should not be the only path to an installed app — a tap on
 * WhatsApp goes to WhatsApp whether or not `navigator.share` exists. The
 * native sheet is still offered, as "More", when the device has one, because
 * it is the only way to reach apps no static list can enumerate.
 *
 * Nothing here records anything or needs a network call: the deep links carry
 * the hunt itself in the URL fragment (see `buildGameJoinUrl`).
 */
export function ShareLink({
  url,
  title,
  text,
  subject,
  heading = 'Share',
  onCopied,
  onCopyBlocked,
}: ShareLinkProps) {
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolved after mount rather than during render: `navigator` does not exist
  // while the page is prerendered, and branching on it inline would render a
  // different tree on the server than on the client.
  useEffect(() => {
    setCanNativeShare(
      typeof navigator !== 'undefined' && typeof navigator.share === 'function'
    );
  }, []);

  // The "Copied!" flash must not fire into an unmounted sheet — the creator's
  // publish modal closes on its own once sharing is done.
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    []
  );
const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      onCopied?.();
      void triggerHaptic('success');
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Blocked by an insecure origin or a denied permission. The link stays
         on screen, selectable, so an invite is never trapped by a failure. */
      onCopyBlocked?.();
    }
  }, [url, onCopied, onCopyBlocked]);

  const handleNativeShare = useCallback(async () => {
    try {
      await navigator.share({ title, text, url });
    } catch (err) {
      /* An AbortError is the player closing the OS sheet — not a failure, and
         certainly not something to shout about. Anything else (no share sheet,
         a transient OS error) leaves the icons and the copy field working. */
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }, [title, text, url]);

  const openTarget = useCallback(
    (target: ShareTarget) => {
      const body = [title, text].filter(Boolean).join('\n\n');
      const href = target.build({
        url,
        body,
        withLink: `${body}\n\n${url}`,
        subject: subject || title,
      });
      void triggerHaptic('light');

      if (target.scheme) {
        window.location.href = href;
        return;
      }

      /* A centred popup, like every desktop share dialog. Note that `noopener`
         is deliberately absent from the feature string: it makes browsers
         return `null` even on success, which would read as "blocked" and throw
         the player out of the app they were sharing into. The opener is nulled
         by hand instead, which is the same protection. */
      const width = 640;
      const height = 640;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        href,
        'fq-share',
        `width=${width},height=${height},left=${left},top=${top}`
      );
      if (popup) {
        popup.opener = null;
      } else {
        // Genuinely blocked, or opened on a phone where a window cannot open at
        // all. Navigating in place still delivers the invite.
        window.location.href = href;
      }
    },
    [url, title, text, subject]
  );

  return (
    <div className="shareSheet">
      <span className="shareSheetHeading">{heading}</span>

      <div className="shareSheetApps" role="group" aria-label="Share this hunt">
        {TARGETS.map(target => {
          const Glyph = target.Glyph;
          return (
            <button
              key={target.id}
              type="button"
              className="shareApp"
              onClick={() => openTarget(target)}
              aria-label={`Share to ${target.label}`}
            >
              <span
                className="shareAppIcon"
                style={{ background: target.color }}
                aria-hidden="true"
              >
                <Glyph size={22} />
              </span>
              <span className="shareAppLabel">{target.label}</span>
            </button>
          );
        })}

        {canNativeShare && (
          <button
            type="button"
            className="shareApp"
            onClick={handleNativeShare}
            aria-label="More sharing options"
          >
            <span className="shareAppIcon shareAppIconMore" aria-hidden="true">
              <MoreHorizontal size={22} />
            </span>
            <span className="shareAppLabel">More</span>
          </button>
        )}
      </div>

      <div className="shareCopyRow">
        <span className="shareCopyField mono" title={url}>
          {url}
        </span>
        <button
          type="button"
          className={copied ? 'shareCopyBtn shareCopyBtnDone' : 'shareCopyBtn'}
          onClick={handleCopy}
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}