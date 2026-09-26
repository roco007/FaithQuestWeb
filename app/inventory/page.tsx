'use client';

import { Backpack, Sparkles, Compass } from 'lucide-react';
import { useGame } from '../../context/GameContext';
import type { ItemRarity } from '../../types/inventory';

const RARITY: Record<ItemRarity, { bg: string; border: string; text: string; label: string }> = {
  legendary: {
    bg: 'rgba(245, 158, 11, 0.2)',
    border: '#f59e0b',
    text: '#fbbf24',
    label: 'LEGENDARY RELIC',
  },
  epic: {
    bg: 'rgba(168, 85, 247, 0.2)',
    border: '#a855f7',
    text: '#c084fc',
    label: 'EPIC ARTIFACT',
  },
  rare: {
    bg: 'rgba(56, 189, 248, 0.2)',
    border: '#38bdf8',
    text: '#38bdf8',
    label: 'RARE FIND',
  },
  common: {
    bg: 'rgba(148, 163, 184, 0.15)',
    border: '#64748b',
    text: '#cbd5e1',
    label: 'COMMON ITEM',
  },
};

/** Pilgrim backpack, ported from the native inventory tab. */
export default function InventoryPage() {
  const { progress } = useGame();

  return (
    <div className="page">
      <div className="pageHeader">
        <div className="pageHeaderRow">
          <div className="pageHeaderIcon" style={{ color: 'var(--sky)' }}>
            <Backpack size={26} />
          </div>
          <div>
            <h1 className="pageTitle">Pilgrim Backpack</h1>
            <p className="pageSubtitle">
              {progress.inventory.length} artifact
              {progress.inventory.length === 1 ? '' : 's'} collected
            </p>
          </div>
        </div>
      </div>

      {progress.inventory.length === 0 ? (
        <div className="card emptyState">
          <Compass size={48} color="#475569" style={{ marginBottom: 12 }} />
          <div className="emptyTitle">Your backpack is empty</div>
          <p>
            Explore church landmarks on the map, solve holy puzzles, and collect sacred keys and
            relics.
          </p>
        </div>
      ) : (
        <div className="itemsGrid">
          {progress.inventory.map((item) => {
            const r = RARITY[item.rarity];
            return (
              <div key={item.id} className="card itemCard" style={{ borderColor: r.border }}>
                <div className="itemHeader">
                  <span
                    className="rarityBadge"
                    style={{ backgroundColor: r.bg, borderColor: r.border, color: r.text }}
                  >
                    {r.label}
                  </span>
                  <Sparkles size={14} color={r.text} />
                </div>
                <div className="itemName">{item.name}</div>
                <p className="itemDescription">{item.description}</p>
                <div className="itemFooter">
                  Found {new Date(item.obtainedAt).toLocaleDateString()}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}