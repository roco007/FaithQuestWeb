'use client';

import { Trophy, Award, CheckCircle2, Lock, Flame, Users } from 'lucide-react';
import { useGame } from '../../context/GameContext';

/** Sample field standings — the native build had no backend for this either. */
const LEADERBOARD_DATA = [
  { rank: 1, team: 'Trailblazers of Light', xp: 2450, badge: '🥇' },
  { rank: 2, team: 'Sanctuary Seekers', xp: 1980, badge: '🥈' },
  { rank: 3, team: 'Belfry Navigators', xp: 1720, badge: '🥉' },
  { rank: 4, team: 'Young Pilgrims (You)', xp: 0, badge: '🌟', isCurrent: true },
];

/** Trophies & stats, ported from the native profile tab. */
export default function ProfilePage() {
  const { progress } = useGame();
  const unlockedBadgesCount = progress.badges.filter((b) => b.isUnlocked).length;

  return (
    <div className="page">
      <div className="pageHeader">
        <div className="pageHeaderRow">
          <div className="pageHeaderIcon" style={{ color: 'var(--amber)' }}>
            <Trophy size={26} />
          </div>
          <div>
            <h1 className="pageTitle">Trophies &amp; Stats</h1>
            <p className="pageSubtitle">
              {unlockedBadgesCount}/{progress.badges.length} badges unlocked
            </p>
          </div>
        </div>
      </div>

      {/* Player summary */}
      <div className="card profileCard">
        <div className="profileAvatarRow">
          <div className="xpLevel">{progress.level}</div>
          <div className="profileNameBlock">
            <div className="profilePlayerName">{progress.playerName}</div>
            <div className="profileRank">{progress.rankTitle}</div>
          </div>
          <div className="streakBadge">
            <Flame size={16} />
            {progress.streakDays} Day
          </div>
        </div>

        <div className="statsSummaryRow">
          <div className="statBox">
            <div className="statVal">{progress.totalXp}</div>
            <div className="statLabel">Total XP</div>
          </div>
          <div className="statBox">
            <div className="statVal">{progress.completedNodeIds.length}</div>
            <div className="statLabel">Solved</div>
          </div>
          <div className="statBox">
            <div className="statVal">{progress.inventory.length}</div>
            <div className="statLabel">Relics</div>
          </div>
        </div>
      </div>

      {/* Badges cabinet */}
      <h2 className="sectionTitle">Badges &amp; Achievements</h2>
      <div className="badgesGrid">
        {progress.badges.map((badge) => (
          <div
            key={badge.id}
            className={`card badgeCard${badge.isUnlocked ? ' badgeCardUnlocked' : ''}`}
          >
            <div
              className={`badgeIconBubble ${
                badge.isUnlocked ? 'badgeIconUnlocked' : 'badgeIconLocked'
              }`}
            >
              {badge.isUnlocked ? (
                <Award size={22} color="#fbbf24" />
              ) : (
                <Lock size={20} color="#64748b" />
              )}
            </div>
            <div className="badgeTitle">{badge.title}</div>
            <div className="badgeDesc">{badge.description}</div>
            {badge.isUnlocked && (
              <span className="unlockedTag">
                <CheckCircle2 size={11} />
                Unlocked
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Leaderboard */}
      <h2 className="sectionTitle">
        <Users size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
        Field Standings
      </h2>
      <div className="card leaderboardCard">
        {LEADERBOARD_DATA.map((row) => (
          <div
            key={row.rank}
            className={`leaderboardRow${row.isCurrent ? ' leaderboardRowCurrent' : ''}`}
          >
            <span className="leaderboardMedal" aria-hidden="true">
              {row.badge}
            </span>
            <div>
              <div className="teamName">{row.team}</div>
              <div className="teamRank">Rank #{row.rank}</div>
            </div>
            <div className="teamXp" style={{ marginLeft: 'auto' }}>
              {row.isCurrent ? `${progress.totalXp} XP` : `${row.xp} XP`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}