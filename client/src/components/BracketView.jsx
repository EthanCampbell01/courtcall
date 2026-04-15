import PropTypes from 'prop-types';

/**
 * Visual bracket/draw view for a tournament event.
 * Renders a classic elimination bracket with connecting lines.
 */
export default function BracketView({ rounds, predictions, onSelectMatch }) {
  if (!rounds || rounds.length === 0) return null;

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 16 }}>
      <div style={{ display: 'flex', gap: 0, minWidth: rounds.length * 200 }}>
        {rounds.map((round, ri) => {
          const matchHeight = 70;
          const gap = Math.pow(2, ri) * matchHeight;
          const topOffset = (gap - matchHeight) / 2;

          return (
            <div key={round.id} style={{ minWidth: 190, flexShrink: 0 }}>
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase',
                letterSpacing: '0.5px', padding: '0 8px 8px', textAlign: 'center',
              }}>
                {round.name}
              </div>
              <div style={{ position: 'relative' }}>
                {round.matches.map((match, mi) => {
                  const pred = predictions?.[match.id];
                  const isCompleted = match.status === 'completed';
                  const isTBD = match.player1_name === 'TBD' || match.player2_name === 'TBD';
                  const isPlayable = match.status === 'upcoming' && !isTBD;

                  return (
                    <div
                      key={match.id}
                      onClick={() => isPlayable && onSelectMatch?.(match)}
                      style={{
                        marginTop: mi === 0 ? topOffset : gap - matchHeight,
                        height: matchHeight,
                        padding: '0 8px',
                        cursor: isPlayable ? 'pointer' : 'default',
                      }}
                    >
                      <div style={{
                        background: 'var(--card)',
                        border: `1px solid ${pred ? 'rgba(0,232,123,0.25)' : isCompleted ? 'var(--blue-glow)' : 'var(--border)'}`,
                        borderRadius: 8, overflow: 'hidden',
                        opacity: isTBD ? 0.4 : 1,
                        height: matchHeight - 8,
                        display: 'flex', flexDirection: 'column', justifyContent: 'center',
                        transition: 'border-color 0.2s',
                      }}>
                        <PlayerRow
                          name={match.player1_name}
                          seed={match.player1_seed}
                          isWinner={match.winner_name === match.player1_name}
                          isPicked={pred?.predicted_winner === match.player1_name}
                          score={isCompleted ? getPlayerSetScore(match.score, 0) : null}
                        />
                        <div style={{ height: 1, background: 'var(--border)' }} />
                        <PlayerRow
                          name={match.player2_name}
                          seed={match.player2_seed}
                          isWinner={match.winner_name === match.player2_name}
                          isPicked={pred?.predicted_winner === match.player2_name}
                          score={isCompleted ? getPlayerSetScore(match.score, 1) : null}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const matchShape = PropTypes.shape({
  id: PropTypes.string.isRequired,
  player1_name: PropTypes.string.isRequired,
  player2_name: PropTypes.string.isRequired,
  player1_seed: PropTypes.number,
  player2_seed: PropTypes.number,
  winner_name: PropTypes.string,
  status: PropTypes.string,
  score: PropTypes.string,
});

const roundShape = PropTypes.shape({
  id: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  matches: PropTypes.arrayOf(matchShape).isRequired,
});

BracketView.propTypes = {
  rounds: PropTypes.arrayOf(roundShape).isRequired,
  /** Map of match.id → prediction object (at minimum { predicted_winner: string }) */
  predictions: PropTypes.objectOf(
    PropTypes.shape({
      predicted_winner: PropTypes.string,
    })
  ),
  onSelectMatch: PropTypes.func,
};

function PlayerRow({ name, seed, isWinner, isPicked, score }) {
  const displayName = name === 'TBD' ? 'TBD' : name.length > 16 ? name.split(' ').pop() : name;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '4px 8px', height: '50%',
      background: isWinner ? 'var(--blue-glow)' : 'transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', flex: 1 }}>
        {isPicked && <span style={{ fontSize: 8, color: 'var(--accent)' }}>⭐</span>}
        <span style={{
          fontSize: 11, fontWeight: isWinner ? 700 : 400,
          color: isWinner ? 'var(--blue)' : isPicked ? 'var(--accent)' : name === 'TBD' ? 'var(--text-dim)' : 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {displayName}
        </span>
        {seed && <span style={{ fontSize: 9, color: 'var(--orange)', fontFamily: 'var(--mono)' }}>{seed}</span>}
      </div>
      {score && (
        <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-dim)', marginLeft: 4 }}>
          {score}
        </span>
      )}
    </div>
  );
}

PlayerRow.propTypes = {
  name: PropTypes.string.isRequired,
  seed: PropTypes.number,
  isWinner: PropTypes.bool,
  isPicked: PropTypes.bool,
  score: PropTypes.string,
};

/**
 * Extract individual player scores from a match score string.
 * e.g. "6-3 6-4" → player 0 gets "6 6", player 1 gets "3 4"
 */
function getPlayerSetScore(scoreStr, playerIndex) {
  if (!scoreStr) return null;
  // Handle special results
  if (/w\/o|bye|ret\./i.test(scoreStr)) return playerIndex === 0 ? scoreStr : '';
  const sets = scoreStr.trim().split(/\s+/);
  return sets.map(s => {
    const parts = s.replace(/\(\d+\)/g, '').split('-');
    return parts[playerIndex] || '?';
  }).join(' ');
}
