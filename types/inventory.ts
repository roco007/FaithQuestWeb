export type ItemRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface InventoryItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: ItemRarity;
  obtainedAt: string; // ISO date string
  nodeId: string;
  loreText?: string;
}

export type BadgeCategory = 'exploration' | 'wisdom' | 'speed' | 'mastery';

export interface Badge {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: BadgeCategory;
  unlockedAt?: string;
  isUnlocked: boolean;
}
