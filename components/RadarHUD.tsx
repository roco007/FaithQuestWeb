'use client';

import {
  Radio,
  Lock,
  ChevronRight,
  Flame,
  Snowflake,
  Zap,
  CheckCircle2,
  Navigation,
} from 'lucide-react';
import { useGame } from '../context/GameContext';
import { formatDistance } from '../utils/geo';
import { triggerHaptic } from '../utils/sound';

/** Palette + copy for each proximity band, matching the native radar HUD. */
const THEMES = {
  IN_RANGE: { color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)', label: 'IN RANGE • DISCOVERABLE', Icon: Radio },
  HOT: { color: '#f97316', bg: 'rgba(249, 115, 22, 0.15)', label: 'HOT • VERY CLOSE!', Icon: Flame },
  WARM: { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)', label: 'GETTING WARMER!', Icon: Zap },
  COLD: { color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.12)', label: 'COLD • KEEP EXPLORING', Icon: Snowflake },
} as const;

interface RadarHUDProps {
  onDiscoverPress: () => void;
  onSelectAnotherTarget?: () => void;
}

/**
 * Proximity card anchored over the map.
 *
 * Replaces the native Reanimated radar sweep: distance, band, and unlock state
 * are surfaced as text, which carries the same information without the bundle
 * cost of a WebGL/canvas animation layered on top of the map.
 */
export function RadarHUD({ onDiscoverPress, onSelectAnotherTarget }: RadarHUDProps) {
  const { activeTargetNode, proximity, progress } = useGame();

  if (!activeTargetNode || !proximity) return null;

  const isCompleted = progress.completedNodeIds.includes(activeTargetNode.id);
  const isInRange = proximity.isWithinRadius;
  const theme = THEMES[proximity.level];
  const { Icon } = theme;

  const handleDiscover = () => {
    triggerHaptic('success');
    onDiscoverPress();
  };

  return (
    <div className="hudCard" style={{ borderColor: theme.color }}>
      <div className="hudTopRow">
        <div>
          <div className="hudTargetSub">Active Target</div>
          <div className="hudTargetTitle">{activeTargetNode.title}</div>
        </div>

        <div
          className="hudDistanceBadge"
          style={{ color: theme.color, borderColor: theme.color, background: theme.bg }}
        >
          <Navigation size={14} />
          {formatDistance(proximity.distanceMeters)}
        </div>
      </div>

      <div className="hudStatusStrip" style={{ color: theme.color, background: theme.bg }}>
        <Icon size={14} />
        {theme.label}
      </div>

      <p className="hudHint">{proximity.message}</p>

      {isCompleted ? (
        <div className="hudCompletedBar">
          <CheckCircle2 size={16} />
          Clue solved — pick another target
        </div>
      ) : isInRange ? (
        <button type="button" className="hudDiscoverBtn" onClick={handleDiscover}>
          DISCOVER HOLY CLUE!
          <ChevronRight size={20} />
        </button>
      ) : (
        <div className="hudLockedBar">
          <Lock size={15} />
          <span>
            Walk within {activeTargetNode.radiusMeters}m to unlock puzzle (
            {formatDistance(proximity.distanceMeters)} to go)
          </span>
          {onSelectAnotherTarget && (
            <button
              type="button"
              className="chipBtn"
              onClick={onSelectAnotherTarget}
              aria-label="Choose another target"
            >
              Change
            </button>
          )}
        </div>
      )}
    </div>
  );
}