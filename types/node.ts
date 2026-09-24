export type PuzzleType = 'mcq' | 'unscramble' | 'camera_qr';

export interface MCQOption {
  id: string;
  text: string;
  isCorrect: boolean;
  feedback?: string;
}

export interface MCQPuzzle {
  type: 'mcq';
  question: string;
  options: MCQOption[];
  scriptureRef?: string;
  funFact: string;
}

export interface UnscramblePuzzle {
  type: 'unscramble';
  scrambledLetters: string[];
  solutionWord: string;
  hintPhrase: string;
  funFact: string;
}

export interface CameraQRPuzzle {
  type: 'camera_qr';
  targetLandmarkName: string;
  qrExpectedValue?: string;
  hintPhrase: string;
  funFact: string;
}

export type Puzzle = MCQPuzzle | UnscramblePuzzle | CameraQRPuzzle;

export interface NodeReward {
  xp: number;
  badgeId?: string;
  badgeTitle?: string;
  badgeIcon?: string;
  itemId?: string;
  itemTitle?: string;
  itemDescription?: string;
  itemRarity?: 'common' | 'rare' | 'epic' | 'legendary';
}

export type LandmarkCategory = 'chapel' | 'courtyard' | 'history' | 'scripture' | 'secret';

export interface ChurchNode {
  id: string;
  title: string;
  subtitle: string;
  latitude: number;
  longitude: number;
  radiusMeters: number; // e.g. 8-12 meters
  description: string;
  clueHint: string;
  category: LandmarkCategory;
  iconName: string;
  puzzle: Puzzle;
  reward: NodeReward;
  isUnlockedDefault?: boolean;
}
