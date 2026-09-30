import type { HuntQuestion, HuntQuestionOption } from '../types/hunt';

/**
 * Pure helpers for the reveal-question gate: id/editor constructors for the
 * character editor, plus the answer-matching rule (exact for MCQ, fuzzy ≥80%
 * for short answer) the AR camera applies before a character's clue/video
 * unlocks. No React, no I/O — kept here so the creator side and the player
 * side can never drift apart on what "correct" means.
 */

let nextQuestionSeq = 0;

/** Stable locally-unique id for a question or option authored in the editor. */
export function createQuestionId(): string {
  nextQuestionSeq += 1;
  return `q_${Date.now().toString(36)}_${nextQuestionSeq}`;
}

/** Fresh blank short-answer question for the editor's "Add question". */
export function newTextQuestion(): HuntQuestion {
  return { id: createQuestionId(), type: 'text', prompt: '', answers: [] };
}

/** Fresh blank multiple-choice question: two options, the first marked correct. */
export function newMcqQuestion(): HuntQuestion {
  return {
    id: createQuestionId(),
    type: 'mcq',
    prompt: '',
    options: [
      { id: createQuestionId(), text: '', isCorrect: true },
      { id: createQuestionId(), text: '', isCorrect: false },
    ],
  };
}

/**
 * Normalises a typed or accepted answer before comparison: trimmed, inner
 * whitespace collapsed, lowercased — so "  Noah'S   ARK " and "noah's ark"
 * reduce to the same form. Both sides of the fuzzy match below run through
 * this first, which is where case-insensitivity comes from.
 */
export function normaliseAnswer(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Classic Levenshtein edit distance (insertions + deletions + substitutions). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  // Two rolling rows: O(m·n) time, O(n) space. Answers are short, so this is
  // negligible next to the haptics it gates.
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr: number[] = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Similarity (0..1) of two strings: 1 − distance / longer length. Identical
 * strings score 1; a single-character typo in a five-letter answer scores 0.8.
 */
function similarity(a: string, b: string): number {
  if (!a.length || !b.length) return a === b ? 1 : 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/**
 * A typed short answer passes when it reaches this similarity against any one
 * accepted answer — the "match percentage" a creator sees described in the
 * editor. At 0.8: "mozes" vs "moses" passes (0.8), "jerusalim" vs
 * "jerusalem" passes (~0.89), but "mos" vs "moses" fails (0.6).
 */
const SHORT_ANSWER_MIN_SIMILARITY = 0.8;

/**
 * True when the player's submission satisfies the question: an `mcq` whose
 * selected option is marked correct, or a `text` answer scoring at least
 * `SHORT_ANSWER_MIN_SIMILARITY` (80%) against any accepted answer, compared
 * after `normaliseAnswer` so letter case and extra spacing never count.
 * Everything else simply fails — the caller keeps the player on the same
 * question until it passes.
 */
export function isQuestionCorrect(
  question: HuntQuestion,
  selectedOptionId: string | null,
  typedText: string
): boolean {
  if (question.type === 'mcq') {
    const selected = (question.options ?? []).find(option => option.id === selectedOptionId);
    return selected?.isCorrect === true;
  }
  const typed = normaliseAnswer(typedText);
  if (!typed) return false;
  return (question.answers ?? []).some(
    answer => similarity(typed, normaliseAnswer(answer)) >= SHORT_ANSWER_MIN_SIMILARITY
  );
}

/**
 * Editor-side validation for one question: a creator-readable problem, or null
 * when the question is complete. Run before publishing so a half-filled
 * question can never ship as an impossible (unanswerable) gate.
 */
export function questionValidationError(question: HuntQuestion): string | null {
  if (!question.prompt.trim()) return 'Every question needs its text.';
  if (question.type === 'text') {
    if ((question.answers ?? []).filter(answer => answer.trim()).length === 0) {
      return 'A short-answer question needs at least one accepted answer.';
    }
    return null;
  }
  const options = question.options ?? [];
  if (options.length < 2) return 'A multiple-choice question needs at least two options.';
  if (options.some(option => !option.text.trim())) {
    return 'Fill in every option, or remove the empty ones.';
  }
  if (options.filter(option => option.isCorrect).length !== 1) {
    return 'Mark exactly one option as the correct answer.';
  }
  return null;
}

/**
 * True for a question the creator hasn't typed anything into yet (an unused
 * "Add question"). These are dropped on save instead of erroring, so adding
 * one and changing your mind is frictionless.
 */
export function isEmptyQuestion(question: HuntQuestion): boolean {
  if (question.prompt.trim()) return false;
  if (question.type === 'text') {
    return (question.answers ?? []).every(answer => !answer.trim());
  }
  return (question.options ?? []).every(option => !option.text.trim());
}
