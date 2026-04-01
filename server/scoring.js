// ─── Scoring Configuration ────────────────────────────────────────────
const SCORING = {
  correctWinner: 10,
  correctSets: 5,
  correctScore: 15,
  upsetBonus: 8,
  perfectMatch: 10,
};

/**
 * Calculate points for a single prediction against an actual result.
 *
 * @param {Object} prediction - { predicted_winner, predicted_sets, predicted_score }
 * @param {Object} result - { winner_name, sets_played, score, player1_seed, player2_seed, player1_name, player2_name }
 * @returns {Object} { total, breakdown }
 */
function scorePrediction(prediction, result) {
  const breakdown = {
    winner: 0,
    sets: 0,
    score: 0,
    upset: 0,
    perfect: 0,
  };

  if (!result.winner_name) return { total: 0, breakdown };

  // Check if this is a walkover/bye/retirement — only award winner points
  const isSpecialResult = result.score && /w\/o|bye|ret\./i.test(result.score);

  // 1. Correct winner
  const winnerCorrect = prediction.predicted_winner === result.winner_name;
  if (winnerCorrect) {
    breakdown.winner = SCORING.correctWinner;
  }

  // For walkovers/byes/retirements: only winner points apply (you can't predict a walkover score)
  if (isSpecialResult) {
    // Still award upset bonus if applicable
    if (winnerCorrect && isUpset(result)) {
      breakdown.upset = SCORING.upsetBonus;
    }
    const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
    return { total, breakdown };
  }

  // 2. Correct number of sets — coerce both to number since DB may return integer but prediction may be string
  const setsCorrect = prediction.predicted_sets != null && Number(prediction.predicted_sets) === Number(result.sets_played);
  if (setsCorrect) {
    breakdown.sets = SCORING.correctSets;
  }

  // 3. Correct exact score (only if winner is also correct — you shouldn't get
  //    score points for predicting the right scoreline with the wrong winner)
  const scoreCorrect = winnerCorrect && prediction.predicted_score &&
    normalizeScore(prediction.predicted_score) === normalizeScore(result.score);
  if (scoreCorrect) {
    breakdown.score = SCORING.correctScore;
  }

  // 4. Upset bonus — winner was the lower seed (or unseeded beating a seed)
  if (winnerCorrect && isUpset(result)) {
    breakdown.upset = SCORING.upsetBonus;
  }

  // 5. Perfect match bonus
  if (winnerCorrect && setsCorrect && scoreCorrect) {
    breakdown.perfect = SCORING.perfectMatch;
  }

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { total, breakdown };
}

/**
 * Determine if a match result was an upset.
 * An upset occurs when:
 * - The winner had a higher seed number than the loser (e.g. [4] beats [1])
 * - The winner was unseeded and the loser was seeded
 */
function isUpset(result) {
  const winnerSeed = result.winner_name === result.player1_name
    ? result.player1_seed : result.player2_seed;
  const loserSeed = result.winner_name === result.player1_name
    ? result.player2_seed : result.player1_seed;

  if (!loserSeed) return false; // Loser wasn't seeded, not an upset
  if (!winnerSeed) return true; // Unseeded beat a seed
  return winnerSeed > loserSeed; // Higher seed number = lower ranked
}

/**
 * Normalize score string for comparison.
 * "6-3 6-4" and "6-3, 6-4" and "6-3 6-4 " should all match.
 */
function normalizeScore(score) {
  if (!score) return '';
  // Normalise each set: sort games so "4-6" and "6-4" are distinct (winner first),
  // but keep tiebreak markers so 6-7(5) != 6-7(8) — different tiebreaks aren't equal.
  return score
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Score all predictions for a completed match.
 * Returns array of { predictionId, userId, points, breakdown }
 */
function scoreMatchPredictions(predictions, matchResult) {
  return predictions.map(pred => {
    const { total, breakdown } = scorePrediction(pred, matchResult);
    return {
      predictionId: pred.id,
      userId: pred.user_id,
      points: total,
      breakdown,
    };
  });
}

module.exports = {
  SCORING,
  scorePrediction,
  scoreMatchPredictions,
  isUpset,
  normalizeScore,
};
