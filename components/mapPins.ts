import type { HuntCharacterType } from '../types/hunt';

/**
 * Marker artwork shared by every map provider.
 *
 * The pins are plain HTML rather than images, which is what lets the quest
 * markers keep their pulsing animation. That works with Leaflet's `divIcon`
 * and with Google's `AdvancedMarkerElement` `content` alike, so both providers
 * draw byte-identical markers and the artwork is defined in exactly one place.
 */

/** Visual state of a quest node pin. */
export type NodePinState = 'active' | 'done' | 'idle';

/** Builds the pin markup for a node marker. */
export function nodePinHtml(state: NodePinState): string {
  const glyph = state === 'done' ? '✓' : '✝';
  const color = state === 'active' ? '#38bdf8' : state === 'done' ? '#10b981' : '#f59e0b';
  const pulse = state === 'active' ? 'animation: fq-pulse 1.8s ease-out infinite;' : '';
  return `
    <div style="position:relative;display:grid;place-items:center;width:38px;height:38px;">
      ${
        state === 'active'
          ? '<div style="position:absolute;inset:0;border-radius:50%;background:#38bdf8;opacity:0.45;' +
            pulse + '"></div>'
          : ''
      }
      <div style="
        position:relative;width:34px;height:34px;border-radius:50%;
        background:${color};border:2.5px solid ${state === 'active' ? '#7dd3fc' : '#ffffff'};
        color:#090d16;font-weight:900;font-size:16px;
        display:grid;place-items:center;
        box-shadow:0 3px 10px rgba(0,0,0,0.6);">
        ${glyph}
      </div>
    </div>`;
}

/** Blue accuracy dot for the player's live position. */
export const userPinHtml = `
  <div style="position:relative;display:grid;place-items:center;width:26px;height:26px;">
    <div style="position:absolute;inset:0;border-radius:50%;background:rgba(56,189,248,0.3);"></div>
    <div style="position:relative;width:16px;height:16px;border-radius:50%;
      background:#38bdf8;border:2.5px solid #e0f2fe;box-shadow:0 0 12px #38bdf8;"></div>
  </div>`;

/** The draggable character pin on the creator's placement map. */
export function characterPinHtml(glyph: string): string {
  return `<div style="width:40px;height:40px;border-radius:50%;display:grid;place-items:center;font-size:20px;background:#38bdf8;border:2.5px solid #e0f2fe;box-shadow:0 3px 10px rgba(0,0,0,.6)">${glyph}</div>`;
}

/** The creator's own position on the placement map. */
export const creatorPinHtml =
  '<div title="Your current location" style="width:18px;height:18px;border-radius:50%;background:#38bdf8;border:3px solid #fff;box-shadow:0 0 0 2px rgba(56,189,248,.45),0 2px 6px rgba(0,0,0,.5);box-sizing:border-box"></div>';

export const CHARACTER_GLYPHS: Record<HuntCharacterType, string> = {
  guardian: '🛡',
  angel: '👼',
  monk: '📿',
  flame: '🔥',
  oracle: '🔮',
};

/**
 * Turns pin markup into a DOM element for `AdvancedMarkerElement.content`.
 *
 * Google anchors advanced-marker content by the element's bottom-left corner,
 * so the wrapper is offset by half its own size to centre the artwork on the
 * coordinate — matching the `iconAnchor` Leaflet was given.
 *
 * `pointerEvents` is left enabled by default because node markers are
 * clickable; callers that place a purely decorative dot (the live position)
 * switch it off so it never swallows a tap meant for the map underneath.
 */
export function pinElement(html: string, size: number): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'fq-marker';
  el.style.position = 'relative';
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.transform = `translate(-${size / 2}px, -${size / 2}px)`;
  el.innerHTML = html;
  return el;
}