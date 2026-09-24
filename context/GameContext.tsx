import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { ChurchNode } from '../types/node';
import { PlayerProgress, LocationCoordinates, ProximityState } from '../types/game';
import { InventoryItem } from '../types/inventory';
import churchNodesData from '../data/church_nodes.json';
import { evaluateProximity } from '../utils/geo';
import { loadPlayerProgress, savePlayerProgress, clearPlayerProgress, INITIAL_PLAYER_PROGRESS } from '../utils/storage';
import { playSoundEffect, triggerHaptic } from '../utils/sound';

interface SolveResult {
  xpGained: number;
  leveledUp: boolean;
  newBadge?: string;
  newItem?: string;
}

interface GameContextType {
  nodes: ChurchNode[];
  progress: PlayerProgress;
  userLocation: LocationCoordinates | null;
  isLocating: boolean;
  locationError: string | null;
  mockMode: boolean;
  activeTargetNode: ChurchNode | null;
  proximity: ProximityState | null;
  setMockMode: (enabled: boolean) => void;
  setUserLocation: (coords: LocationCoordinates) => void;
  setActiveTargetNode: (node: ChurchNode | null) => void;
  teleportToNode: (node: ChurchNode, insideRadius?: boolean) => void;
  solveNode: (nodeId: string) => Promise<SolveResult>;
  resetProgress: () => Promise<void>;
  updateLocationFromGPS: (coords: LocationCoordinates) => void;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

const RANKS = [
  { level: 1, title: 'Novice Seeker', maxXP: 300 },
  { level: 2, title: 'Faith Pilgrim', maxXP: 450 },
  { level: 3, title: 'Sacred Acolyte', maxXP: 600 },
  { level: 4, title: 'Temple Guardian', maxXP: 800 },
  { level: 5, title: 'Champion of Truth', maxXP: 1000 },
];

export const GameProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [nodes] = useState<ChurchNode[]>(churchNodesData as ChurchNode[]);
  const [progress, setProgress] = useState<PlayerProgress>(INITIAL_PLAYER_PROGRESS);
  const [userLocation, setUserLocationState] = useState<LocationCoordinates | null>({
    latitude: 37.774929,
    longitude: -122.419416,
    accuracy: 5,
    heading: 0,
  });
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [mockMode, setMockMode] = useState<boolean>(true); // default true for seamless local testing
  const [activeTargetNode, setActiveTargetNode] = useState<ChurchNode | null>(null);

  // Load saved progress on boot
  useEffect(() => {
    (async () => {
      const saved = await loadPlayerProgress();
      setProgress(saved);
    })();
  }, []);

  // Default active target to the first incomplete node
  useEffect(() => {
    if (!activeTargetNode && nodes.length > 0) {
      const firstIncomplete = nodes.find(n => !progress.completedNodeIds.includes(n.id));
      setActiveTargetNode(firstIncomplete || nodes[0]);
    }
  }, [nodes, progress.completedNodeIds, activeTargetNode]);

  // Compute live proximity to the active target
  const proximity = useMemo<ProximityState | null>(() => {
    if (!userLocation || !activeTargetNode) return null;
    return evaluateProximity(userLocation, activeTargetNode);
  }, [userLocation, activeTargetNode]);

  // Trigger haptic and sound when transitioning into range
  useEffect(() => {
    if (proximity?.isWithinRadius) {
      triggerHaptic('success');
      playSoundEffect('in_range');
    }
  }, [proximity?.isWithinRadius]);

  const updateLocationFromGPS = useCallback((coords: LocationCoordinates) => {
    if (!mockMode) {
      setUserLocationState(coords);
    }
  }, [mockMode]);

  const setUserLocation = useCallback((coords: LocationCoordinates) => {
    setUserLocationState(coords);
  }, []);

  const teleportToNode = useCallback((node: ChurchNode, insideRadius: boolean = true) => {
    // If insideRadius is true, teleport directly on target.
    // If false, place player ~35 meters away so they can test approaching it!
    const offset = insideRadius ? 0 : 0.00032; // ~35 meters offset
    const coords: LocationCoordinates = {
      latitude: node.latitude + offset,
      longitude: node.longitude + offset,
      accuracy: 4,
      heading: 45,
    };
    setUserLocationState(coords);
    setActiveTargetNode(node);
    triggerHaptic('light');
  }, []);

  const solveNode = useCallback(
    async (nodeId: string): Promise<SolveResult> => {
      const target = nodes.find(n => n.id === nodeId);
      if (!target) {
        throw new Error('Node not found');
      }

      const reward = target.reward;
      const xpGained = reward.xp;
      let newTotalXp = progress.totalXp + xpGained;
      let newCurrentXp = progress.currentXp + xpGained;
      let currentLevel = progress.level;
      let xpForNext = progress.xpForNextLevel;
      let rankTitle = progress.rankTitle;
      let leveledUp = false;

      // Handle Level Up
      if (newCurrentXp >= xpForNext) {
        leveledUp = true;
        newCurrentXp -= xpForNext;
        currentLevel += 1;
        const currentRankConfig = RANKS.find(r => r.level === currentLevel) || {
          title: `Archon Level ${currentLevel}`,
          maxXP: Math.round(xpForNext * 1.3),
        };
        xpForNext = currentRankConfig.maxXP;
        rankTitle = currentRankConfig.title;
      }

      // Check Badges
      let newBadge: string | undefined;
      const updatedBadges = progress.badges.map(b => {
        if (b.id === reward.badgeId && !b.isUnlocked) {
          newBadge = b.title;
          return {
            ...b,
            isUnlocked: true,
            unlockedAt: new Date().toISOString(),
          };
        }
        return b;
      });

      // Check Inventory Items
      let newItem: string | undefined;
      const updatedInventory = [...progress.inventory];
      if (reward.itemId && !updatedInventory.some(i => i.id === reward.itemId)) {
        newItem = reward.itemTitle;
        const item: InventoryItem = {
          id: reward.itemId,
          name: reward.itemTitle || 'Holy Relic',
          description: reward.itemDescription || 'A sacred artifact discovered on church grounds.',
          icon: 'sparkles',
          rarity: reward.itemRarity || 'rare',
          obtainedAt: new Date().toISOString(),
          nodeId: target.id,
        };
        updatedInventory.push(item);
      }

      const updatedCompletedNodeIds = Array.from(
        new Set([...progress.completedNodeIds, nodeId])
      );

      const updatedProgress: PlayerProgress = {
        ...progress,
        level: currentLevel,
        currentXp: newCurrentXp,
        xpForNextLevel: xpForNext,
        totalXp: newTotalXp,
        rankTitle,
        completedNodeIds: updatedCompletedNodeIds,
        badges: updatedBadges,
        inventory: updatedInventory,
        lastActiveDate: new Date().toISOString(),
      };

      setProgress(updatedProgress);
      await savePlayerProgress(updatedProgress);

      if (leveledUp) {
        triggerHaptic('heavy');
        playSoundEffect('level_up');
      } else {
        triggerHaptic('success');
        playSoundEffect('correct');
      }

      return {
        xpGained,
        leveledUp,
        newBadge,
        newItem,
      };
    },
    [nodes, progress]
  );

  const resetProgress = useCallback(async () => {
    await clearPlayerProgress();
    setProgress(INITIAL_PLAYER_PROGRESS);
    if (nodes.length > 0) {
      setActiveTargetNode(nodes[0]);
    }
  }, [nodes]);

  return (
    <GameContext.Provider
      value={{
        nodes,
        progress,
        userLocation,
        isLocating,
        locationError,
        mockMode,
        activeTargetNode,
        proximity,
        setMockMode,
        setUserLocation,
        setActiveTargetNode,
        teleportToNode,
        solveNode,
        resetProgress,
        updateLocationFromGPS,
      }}
    >
      {children}
    </GameContext.Provider>
  );
};

export const useGame = (): GameContextType => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
};
