import { useMemo, useEffect, useRef } from 'react';
import { useGame } from '../context/GameContext';
import { calculateHaversineDistance, evaluateProximity } from '../utils/geo';
import { ChurchNode } from '../types/node';
import { ProximityState } from '../types/game';
import { playSoundEffect } from '../utils/sound';

export interface NodeProximityInfo {
  node: ChurchNode;
  distanceMeters: number;
  proximity: ProximityState;
  isCompleted: boolean;
}

export function useProximityRadar() {
  const { userLocation, nodes, activeTargetNode, setActiveTargetNode, progress } = useGame();
  const lastLevelRef = useRef<string>('');

  const nodeDistances = useMemo<NodeProximityInfo[]>(() => {
    if (!userLocation) return [];

    return nodes.map((node) => {
      const distance = calculateHaversineDistance(userLocation, node);
      const proximity = evaluateProximity(userLocation, node);
      const isCompleted = progress.completedNodeIds.includes(node.id);

      return {
        node,
        distanceMeters: distance,
        proximity,
        isCompleted,
      };
    }).sort((a, b) => a.distanceMeters - b.distanceMeters);
  }, [userLocation, nodes, progress.completedNodeIds]);

  const nearestIncomplete = useMemo(() => {
    return nodeDistances.find((item) => !item.isCompleted) || nodeDistances[0] || null;
  }, [nodeDistances]);

  // Current active target proximity
  const activeProximity = useMemo<ProximityState | null>(() => {
    if (!userLocation || !activeTargetNode) return null;
    return evaluateProximity(userLocation, activeTargetNode);
  }, [userLocation, activeTargetNode]);

  // Play sonar ping when proximity level warms up
  useEffect(() => {
    if (activeProximity && activeProximity.level !== lastLevelRef.current) {
      lastLevelRef.current = activeProximity.level;
      if (activeProximity.level === 'HOT' || activeProximity.level === 'WARM') {
        playSoundEffect('radar_ping');
      }
    }
  }, [activeProximity]);

  return {
    nodeDistances,
    nearestIncomplete,
    activeProximity,
    activeTargetNode,
    setActiveTargetNode,
  };
}
