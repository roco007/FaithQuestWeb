'use client';

import { Sparkles } from 'lucide-react';
import { useGame } from '../context/GameContext';

/** Floating player card: level, rank, XP bar, and discovery count. */
export function XPProgressBar() {
  const { progress, nodes } = useGame();

  const completedCount = progress.completedNodeIds.length;
  const totalCount = nodes.length;
  const progressRatio = Math.min(1, Math.max(0, progress.currentXp / progress.xpForNextLevel));

  return (
    <div className="xpCard">
      <div className="xpLevel" aria-label={`Level ${progress.level}`}>
        {progress.level}
      </div>

      <div className="xpInfo">
        <div className="xpHeaderRow">
          <span>
            <span className="xpRank">{progress.rankTitle}</span>
            <span className="xpPlayer">• {progress.playerName}</span>
          </span>
          <span className="xpNumbers">
            {progress.currentXp}{' '}
            <span className="xpNumbersMax">/ {progress.xpForNextLevel} XP</span>
          </span>
        </div>

        <div
          className="xpTrack"
          role="progressbar"
          aria-valuenow={progress.currentXp}
          aria-valuemin={0}
          aria-valuemax={progress.xpForNextLevel}
        >
          <div className="xpFill" style={{ width: `${progressRatio * 100}%` }} />
        </div>

        <div className="xpStatsRow">
          <span className="xpStat">
            <Sparkles size={12} color="#f59e0b" />
            {completedCount}/{totalCount} Discovered
          </span>
        </div>
      </div>
    </div>
  );
}