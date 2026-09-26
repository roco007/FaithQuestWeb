'use client';

import { useState, useEffect } from 'react';
import { Sparkles, CheckCircle2, XCircle, Award, BookOpen, Lightbulb, Shield, Key, RotateCcw } from 'lucide-react';
import { Modal } from './Modal';
import { CameraQRPuzzleBody } from './CameraQRPuzzle';
import { useGame } from '../context/GameContext';
import { triggerHaptic, playSoundEffect } from '../utils/sound';
import type { ChurchNode, MCQPuzzle, UnscramblePuzzle, CameraQRPuzzle } from '../types/node';

interface ClueModalProps {
  /** Renamed from the native `visible` to match the shared `Modal` contract. */
  open: boolean;
  node: ChurchNode | null;
  onClose: () => void;
}

interface RewardData {
  xpGained: number;
  leveledUp: boolean;
  newBadge?: string;
  newItem?: string;
}

/**
 * Discovery + puzzle dialog.
 *
 * Preserves the native flow for all three puzzle types: answer, get feedback
 * and a fun fact, then return to the map. The camera-QR variant is delegated to
 * {@link CameraQRPuzzleBody}, which wraps the browser Barcode Detection API.
 */
export function ClueModal({ open, node, onClose }: ClueModalProps) {
  const { solveNode, progress } = useGame();

  // MCQ state
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [isAnswerSubmitted, setIsAnswerSubmitted] = useState(false);
  const [isCorrectAnswer, setIsCorrectAnswer] = useState(false);

  // Unscramble state
  const [placedLetters, setPlacedLetters] = useState<{ id: number; char: string }[]>([]);
  const [availableLetters, setAvailableLetters] = useState<{ id: number; char: string }[]>([]);

  // Victory state
  const [isSolved, setIsSolved] = useState(false);
  const [rewardData, setRewardData] = useState<RewardData | null>(null);

  // Reset puzzle state each time the dialog opens on a node.
  useEffect(() => {
    if (!node) return;

    const alreadyCompleted = progress.completedNodeIds.includes(node.id);
    setIsSolved(alreadyCompleted);
    setIsAnswerSubmitted(alreadyCompleted);
    setIsCorrectAnswer(false);
    setSelectedOptionId(null);
    setRewardData(null);

    if (node.puzzle.type === 'unscramble') {
      const letters = (node.puzzle as UnscramblePuzzle).scrambledLetters.map((char, index) => ({
        id: index,
        char,
      }));
      setAvailableLetters(letters);
      setPlacedLetters([]);
    }
  }, [node, open, progress.completedNodeIds]);

  if (!node) return null;

  const handleSelectMCQ = (optionId: string) => {
    if (isAnswerSubmitted && isCorrectAnswer) return;
    setSelectedOptionId(optionId);
    triggerHaptic('light');
  };

  const handleSubmitMCQ = async () => {
    if (!selectedOptionId) return;
    const mcq = node.puzzle as MCQPuzzle;
    const selected = mcq.options.find((o) => o.id === selectedOptionId);

    if (selected?.isCorrect) {
      setIsCorrectAnswer(true);
      setIsAnswerSubmitted(true);
      playSoundEffect('correct');
      triggerHaptic('success');
      try {
        const result = await solveNode(node.id);
        setRewardData(result);
        setIsSolved(true);
      } catch (e) {
        console.error(e);
      }
    } else {
      setIsCorrectAnswer(false);
      setIsAnswerSubmitted(true);
      triggerHaptic('error');
      playSoundEffect('wrong');
    }
  };

  const handleAddLetter = (item: { id: number; char: string }) => {
    triggerHaptic('light');
    setAvailableLetters((prev) => prev.filter((l) => l.id !== item.id));
    setPlacedLetters((prev) => [...prev, item]);
  };

  const handleRemoveLetter = (item: { id: number; char: string }) => {
    triggerHaptic('light');
    setPlacedLetters((prev) => prev.filter((l) => l.id !== item.id));
    setAvailableLetters((prev) => [...prev, item]);
  };

  const handleClearLetters = () => {
    setPlacedLetters([]);
    setAvailableLetters((node.puzzle as UnscramblePuzzle).scrambledLetters.map((char, index) => ({ id: index, char })));
  };

  const handleSubmitUnscramble = async () => {
    const puzzle = node.puzzle as UnscramblePuzzle;
    const attempt = placedLetters.map((l) => l.char).join('');
    if (attempt.toUpperCase() !== puzzle.solutionWord.toUpperCase()) {
      triggerHaptic('error');
      playSoundEffect('wrong');
      return;
    }

    playSoundEffect('correct');
    triggerHaptic('success');
    setIsAnswerSubmitted(true);
    setIsCorrectAnswer(true);
    try {
      const result = await solveNode(node.id);
      setRewardData(result);
      setIsSolved(true);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSubmitQR = async (value: string) => {
    const puzzle = node.puzzle as CameraQRPuzzle;
    const expected = puzzle.qrExpectedValue;
    // Without a configured value, any non-empty code is accepted.
    const isMatch = !expected || value.trim() === expected;

    if (!isMatch) {
      triggerHaptic('error');
      playSoundEffect('wrong');
      return;
    }

    playSoundEffect('correct');
    triggerHaptic('success');
    setIsAnswerSubmitted(true);
    setIsCorrectAnswer(true);
    try {
      const result = await solveNode(node.id);
      setRewardData(result);
      setIsSolved(true);
    } catch (e) {
      console.error(e);
    }
  };

  const renderPuzzle = () => {
    if (node.puzzle.type === 'mcq') {
      const mcq = node.puzzle as MCQPuzzle;
      return (
        <>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10, lineHeight: 1.45 }}>
            {mcq.question}
          </h3>
          {mcq.scriptureRef && (
            <p className="sectionLabel" style={{ marginBottom: 12 }}>
              {mcq.scriptureRef}
            </p>
          )}

          <div className="puzzleOptions">
            {mcq.options.map((option) => {
              let className = 'puzzleOption';
              if (isAnswerSubmitted && option.isCorrect) className += ' puzzleOptionCorrect';
              else if (isAnswerSubmitted && option.id === selectedOptionId)
                className += ' puzzleOptionWrong';
              else if (option.id === selectedOptionId) className += ' puzzleOptionSelected';

              return (
                <button
                  key={option.id}
                  type="button"
                  className={className}
                  onClick={() => handleSelectMCQ(option.id)}
                  disabled={isAnswerSubmitted && isCorrectAnswer}
                >
                  <span style={{ flex: 1 }}>{option.text}</span>
                  {isAnswerSubmitted && option.isCorrect && (
                    <CheckCircle2 size={18} color="var(--green)" />
                  )}
                  {isAnswerSubmitted && !option.isCorrect && option.id === selectedOptionId && (
                    <XCircle size={18} color="var(--red)" />
                  )}
                </button>
              );
            })}
          </div>

          {isAnswerSubmitted && (
            <div
              className={`puzzleFeedback ${
                isCorrectAnswer ? 'puzzleFeedbackCorrect' : 'puzzleFeedbackWrong'
              }`}
            >
              {isCorrectAnswer ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              {isCorrectAnswer
                ? 'Correct! Well done, disciple.'
                : mcq.options.find((o) => o.id === selectedOptionId)?.feedback ??
                  'Not quite — try another answer.'}
            </div>
          )}

          {!isSolved && (
            <button
              type="button"
              className="btnPrimary"
              style={{ width: '100%' }}
              onClick={handleSubmitMCQ}
              disabled={!selectedOptionId}
            >
              Submit Answer
            </button>
          )}
        </>
      );
    }

    if (node.puzzle.type === 'unscramble') {
      const puzzle = node.puzzle as UnscramblePuzzle;
      return (
        <>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10, lineHeight: 1.45 }}>
            Unscramble the word
          </h3>
          <div className="loreCard" style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 6 }}>Clue</p>
            <p style={{ fontSize: 14, lineHeight: 1.5 }}>{puzzle.hintPhrase}</p>
          </div>

          <div className={`letterSlot${placedLetters.length > 0 ? ' letterSlotFilled' : ''}`}>
            {placedLetters.map((letter) => (
              <button
                key={letter.id}
                type="button"
                className="letterPlaced"
                onClick={() => handleRemoveLetter(letter)}
                disabled={isSolved}
                aria-label={`Remove ${letter.char}`}
              >
                {letter.char}
              </button>
            ))}
          </div>

          <div className="letterBank">
            {availableLetters.map((letter) => (
              <button
                key={letter.id}
                type="button"
                className="letterTile"
                onClick={() => handleAddLetter(letter)}
                disabled={isSolved}
                aria-label={`Add ${letter.char}`}
              >
                {letter.char}
              </button>
            ))}
          </div>

          {isAnswerSubmitted && !isCorrectAnswer && (
            <div className="puzzleFeedback puzzleFeedbackWrong">
              <XCircle size={16} />
              That isn&apos;t the word — rearrange the letters and try again.
            </div>
          )}

          {!isSolved && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btnGhost"
                onClick={handleClearLetters}
                disabled={placedLetters.length === 0}
              >
                <RotateCcw size={15} />
                Clear
              </button>
              <button
                type="button"
                className="btnPrimary"
                style={{ flex: 1 }}
                onClick={handleSubmitUnscramble}
                disabled={placedLetters.length === 0}
              >
                Submit Word
              </button>
            </div>
          )}
        </>
      );
    }

    return (
      <CameraQRPuzzleBody
        puzzle={node.puzzle as CameraQRPuzzle}
        onSolved={handleSubmitQR}
        submitted={isAnswerSubmitted}
      />
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isSolved ? 'Clue Discovered!' : node.title}
      icon={isSolved ? <Award size={18} color="var(--amber)" /> : <Sparkles size={18} color="var(--sky)" />}
      accentColor={isSolved ? 'var(--amber)' : 'var(--sky)'}
    >
      {isSolved ? (
        <div className="victoryCard">
          <div className="victoryHeading">🎉 Well done!</div>
          <p className="victorySubtitle">
            You discovered the clue hidden at {node.title}. Keep exploring to find the rest.
          </p>

          {rewardData && (
            <>
              {rewardData.leveledUp && (
                <div className="levelUpNotice">⭐ LEVEL UP! The journey continues.</div>
              )}

              <div className="rewardChips">
                <span className="rewardChip">
                  <Sparkles size={13} />+{rewardData.xpGained} XP
                </span>
                {rewardData.newBadge && (
                  <span className="rewardChip rewardChipBadge">
                    <Shield size={13} />
                    {rewardData.newBadge}
                  </span>
                )}
                {rewardData.newItem && (
                  <span className="rewardChip rewardChipItem">
                    <Key size={13} />
                    {rewardData.newItem}
                  </span>
                )}
              </div>
            </>
          )}

          <div className="loreCard" style={{ textAlign: 'left', marginBottom: 16 }}>
            <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>
              <BookOpen size={13} color="var(--sky)" />
              Did you know?
            </p>
            <p style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-muted)' }}>
              {node.puzzle.funFact}
            </p>
          </div>

          <button type="button" className="btnGreen" style={{ width: '100%' }} onClick={onClose}>
            Continue Exploring
          </button>
        </div>
      ) : (
        <>
          {node.description && (
            <div className="loreCard" style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 12.5, lineHeight: 1.5 }}>{node.description}</p>
            </div>
          )}

          {renderPuzzle()}

          {isAnswerSubmitted && isCorrectAnswer && node.puzzle.funFact && (
            <div className="loreCard" style={{ marginTop: 16 }}>
              <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>
                <Lightbulb size={13} color="var(--amber)" />
                Did you know?
              </p>
              <p style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-muted)' }}>
                {node.puzzle.funFact}
              </p>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}