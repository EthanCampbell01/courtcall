import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import BackButton from '../components/BackButton';

export default function AdminPanel({ showToast }) {
  const [tab, setTab] = useState('matches');
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [tournamentDetail, setTournamentDetail] = useState(null);
  const [isAdmin, setIsAdmin] = useState(null); // null = checking, true/false = known
  const [adminCheckError, setAdminCheckError] = useState(false);

  const checkAdmin = () => {
    const user = (() => { try { return JSON.parse(window.localStorage.getItem('courtcall_user')); } catch { return null; } })();
    if (!user) { setIsAdmin(false); return; }
    setIsAdmin(null);
    setAdminCheckError(false);
    fetch(`/api/auth/is-admin?user_id=${user.id}`)
      .then(r => r.json())
      .then(d => setIsAdmin(d.isAdmin === true))
      .catch(() => setAdminCheckError(true));
  };

  // Check admin access on mount
  useEffect(() => {
    api.getTournaments().then(setTournaments).catch(console.error);
    checkAdmin();
  }, []);

  useEffect(() => {
    if (!selectedTournament) return;
    let cancelled = false;
    api.getTournament(selectedTournament)
      .then(d => { if (!cancelled) setTournamentDetail(d); })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [selectedTournament]);

  const tabStyle = (active) => ({
    padding: '8px 16px', borderRadius: 10, border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent-glow)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-muted)',
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
  });

  return (
    <div>
      <BackButton to="/" label="Back" />
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>⚙️ Admin Panel</h2>

      {isAdmin === false && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Admin access required</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Only the first registered account has admin access. Ask your circuit admin to manage tournaments.
          </div>
        </div>
      )}

      {isAdmin === null && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          {adminCheckError ? (
            <>
              <div style={{ marginBottom: 12 }}>Failed to check admin access — network error</div>
              <button onClick={checkAdmin} style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}>
                Retry
              </button>
            </>
          ) : 'Checking access...'}</div>
      )}

      {isAdmin && (
      <>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>Add tournaments, input draws, enter results</p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20, overflowX: 'auto' }}>
        {['scraper', 'matches', 'tournament', 'results', 'users'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={tabStyle(tab === t)}>
            {t === 'scraper' ? '🔗 TI Scraper' : t === 'matches' ? 'Add Matches' : t === 'tournament' ? 'Add Tournament' : t === 'results' ? 'Enter Results' : '👥 Users'}
          </button>
        ))}
      </div>

      {tab === 'scraper' && <ScraperPanel tournaments={tournaments} showToast={showToast} />}
      {tab === 'tournament' && <AddTournament showToast={showToast} onAdded={() => api.getTournaments().then(setTournaments).catch(console.error)} />}
      {tab === 'matches' && <AddMatches tournaments={tournaments} showToast={showToast} selectedTournament={selectedTournament} setSelectedTournament={setSelectedTournament} tournamentDetail={tournamentDetail} onAdded={() => selectedTournament && api.getTournament(selectedTournament).then(setTournamentDetail).catch(console.error)} />}
      {tab === 'results' && <EnterResults tournaments={tournaments} showToast={showToast} selectedTournament={selectedTournament} setSelectedTournament={setSelectedTournament} tournamentDetail={tournamentDetail} onResultSaved={() => selectedTournament && api.getTournament(selectedTournament).then(setTournamentDetail).catch(console.error)} />}
      {tab === 'users' && <UsersPanel showToast={showToast} />}
      </>
      )}
    </div>
  );
}

function AddTournament({ showToast, onAdded }) {
  const [name, setName] = useState('');
  const [club, setClub] = useState('');
  const [dates, setDates] = useState('');
  const [surface, setSurface] = useState('Hard');
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!name || !club || !dates) return;
    setSaving(true);
    try {
      await api.addTournament({ name, club, dates, surface, province: 'Ulster' });
      showToast('Tournament added!');
      setName(''); setClub(''); setDates('');
      onAdded();
    } catch (err) { showToast('Error: ' + err.message); }
    setSaving(false);
  };

  const inputStyle = { width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14, outline: 'none', marginTop: 6 };

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Add Tournament</h3>
      {[
        { label: 'Name', value: name, set: setName, placeholder: 'Ballycastle Open 2026' },
        { label: 'Club', value: club, set: setClub, placeholder: 'Ballycastle Tennis Club' },
        { label: 'Dates', value: dates, set: setDates, placeholder: '14–20 Jul 2026' },
      ].map(f => (
        <div key={f.label} style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{f.label}</label>
          <input value={f.value} onChange={e => f.set(e.target.value)} placeholder={f.placeholder} style={inputStyle} />
        </div>
      ))}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Surface</label>
        <select value={surface} onChange={e => setSurface(e.target.value)} style={{ ...inputStyle, appearance: 'auto' }}>
          {['Hard', 'Grass', 'Artificial Grass', 'Clay'].map(s => <option key={s}>{s}</option>)}
        </select>
      </div>
      <button onClick={handleAdd} disabled={!name || !club || !dates || saving} style={{
        width: '100%', padding: 14, borderRadius: 12, border: 'none', cursor: 'pointer',
        background: 'var(--accent)', color: 'var(--bg)', fontWeight: 700, fontSize: 14, opacity: saving ? 0.6 : 1,
      }}>
        Add Tournament
      </button>
    </div>
  );
}

function AddMatches({ tournaments, showToast, selectedTournament, setSelectedTournament, tournamentDetail, onAdded }) {
  const [matchText, setMatchText] = useState('');
  const [selectedRound, setSelectedRound] = useState('');
  const [saving, setSaving] = useState(false);
  const [showAddRound, setShowAddRound] = useState(false);
  const [newRoundName, setNewRoundName] = useState('');

  // Gather all rounds from all events
  const allRounds = [];
  if (tournamentDetail?.events) {
    for (const ev of tournamentDetail.events) {
      for (const rd of ev.rounds) {
        allRounds.push({ ...rd, eventCode: ev.code });
      }
    }
  }

  const handleAdd = async () => {
    if (!selectedRound || !matchText.trim()) return;
    setSaving(true);
    try {
      // Parse text: each line is "Player1 Name [seed] vs Player2 Name [seed]"
      const lines = matchText.trim().split('\n').filter(l => l.trim());
      const matches = lines.map(line => {
        const parts = line.split(/\s+vs\s+/i);
        if (parts.length !== 2) throw new Error(`Invalid format: "${line}". Use "Player1 vs Player2"`);

        const parsePlayer = (str) => {
          const seedMatch = str.match(/\[(\d+)\]\s*$/);
          const seed = seedMatch ? parseInt(seedMatch[1]) : null;
          const name = str.replace(/\[\d+\]\s*$/, '').trim();
          return { name, seed };
        };

        const p1 = parsePlayer(parts[0].trim());
        const p2 = parsePlayer(parts[1].trim());
        return { player1_name: p1.name, player1_seed: p1.seed, player2_name: p2.name, player2_seed: p2.seed };
      });

      await api.addMatches(selectedRound, matches);
      showToast(`${matches.length} matches added!`);
      setMatchText('');
      onAdded();
    } catch (err) { showToast('Error: ' + err.message); }
    setSaving(false);
  };

  const selectStyle = { width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14, outline: 'none', marginTop: 6, appearance: 'auto' };

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Add Matches to Draw</h3>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Tournament</label>
        <select value={selectedTournament || ''} onChange={e => { setSelectedTournament(e.target.value); setSelectedRound(''); }} style={selectStyle}>
          <option value="">Select tournament...</option>
          {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {allRounds.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Round</label>
          <select value={selectedRound} onChange={e => setSelectedRound(e.target.value)} style={selectStyle}>
            <option value="">Select round...</option>
            {allRounds.map(r => <option key={r.id} value={r.id}>{r.eventCode} — {r.name}</option>)}
          </select>
          {!showAddRound ? (
            <button onClick={() => setShowAddRound(true)} style={{
              marginTop: 6, padding: '6px 10px', borderRadius: 8, border: '1px dashed var(--border)',
              background: 'transparent', color: 'var(--text-dim)', fontSize: 11, cursor: 'pointer',
            }}>
              + Add another round
            </button>
          ) : (
            <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
              <input value={newRoundName} onChange={e => setNewRoundName(e.target.value)} placeholder="e.g. Quarter-Finals" style={{ ...selectStyle, flex: 1 }} />
              <button onClick={async () => {
                if (!newRoundName.trim() || !tournamentDetail?.events?.[0]) return;
                try {
                  const eventId = tournamentDetail.events[0].id;
                  const deadline = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
                  await api.addRound({ event_id: eventId, name: newRoundName.trim(), round_order: allRounds.length + 1, prediction_deadline: deadline });
                  showToast('Round added!');
                  setNewRoundName(''); setShowAddRound(false); onAdded();
                } catch (err) { showToast('Error: ' + err.message); }
              }} style={{
                padding: '10px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: 'var(--accent)', color: 'var(--bg)', fontSize: 12, fontWeight: 600,
              }}>Add</button>
            </div>
          )}
        </div>
      )}

      {selectedRound && (
        <>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Matches (one per line)</label>
            <textarea
              value={matchText} onChange={e => setMatchText(e.target.value)}
              placeholder={"C. McAllister [1] vs D. O'Brien\nR. Stewart vs F. Gallagher [4]\nP. Murray [3] vs J. Quinn"}
              rows={6}
              style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--mono)', outline: 'none', marginTop: 6, resize: 'vertical' }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
              Format: Player Name [seed] vs Player Name [seed] — seeds are optional
            </div>
          </div>

          <button onClick={handleAdd} disabled={!matchText.trim() || saving} style={{
            width: '100%', padding: 14, borderRadius: 12, border: 'none', cursor: 'pointer',
            background: 'var(--accent)', color: 'var(--bg)', fontWeight: 700, fontSize: 14, opacity: saving ? 0.6 : 1,
          }}>
            Add Matches
          </button>
        </>
      )}

      {selectedTournament && allRounds.length === 0 && (
        <QuickSetup tournamentId={selectedTournament} showToast={showToast} onCreated={onAdded} />
      )}
    </div>
  );
}

/**
 * QuickSetup — creates event + round when admin selects a tournament with no draw.
 * Handles the most common case: single-event tournament (e.g. Men's Singles).
 */
function QuickSetup({ tournamentId, showToast, onCreated }) {
  const [eventCode, setEventCode] = useState('MS');
  const [eventName, setEventName] = useState("Men's Singles");
  const [roundName, setRoundName] = useState('Round 1');
  const [deadlineDays, setDeadlineDays] = useState('3');
  const [saving, setSaving] = useState(false);

  const presets = [
    { code: 'MS', name: "Men's Singles" },
    { code: 'WS', name: "Women's Singles" },
    { code: 'MD', name: "Men's Doubles" },
    { code: 'WD', name: "Women's Doubles" },
    { code: 'XD', name: "Mixed Doubles" },
    { code: 'TEAM', name: "Team Match" },
  ];

  const handleCreate = async () => {
    setSaving(true);
    try {
      const ev = await api.addEvent({ tournament_id: tournamentId, code: eventCode, name: eventName, draw_size: 8 });
      const deadline = new Date(Date.now() + parseInt(deadlineDays) * 24 * 60 * 60 * 1000).toISOString();
      await api.addRound({ event_id: ev.id, name: roundName, round_order: 1, prediction_deadline: deadline });
      showToast('Event and round created! Now add matches.');
      onCreated?.();
    } catch (err) { showToast('Error: ' + err.message); }
    setSaving(false);
  };

  const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, outline: 'none', marginTop: 4 };

  return (
    <div style={{ background: 'var(--bg)', borderRadius: 12, padding: 16, marginTop: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>📋 Quick Setup — Create Event & Round</div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {presets.map(p => (
          <button key={p.code} onClick={() => { setEventCode(p.code); setEventName(p.name); }} style={{
            padding: '6px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: eventCode === p.code ? 'var(--accent-glow)' : 'var(--card)',
            color: eventCode === p.code ? 'var(--accent)' : 'var(--text-dim)',
            fontSize: 11, fontWeight: 600,
          }}>
            {p.code}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Event Code</label>
          <input value={eventCode} onChange={e => setEventCode(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Event Name</label>
          <input value={eventName} onChange={e => setEventName(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase' }}>First Round Name</label>
          <input value={roundName} onChange={e => setRoundName(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Deadline (days from now)</label>
          <input type="number" value={deadlineDays} onChange={e => setDeadlineDays(e.target.value)} min="1" max="30" style={inputStyle} />
        </div>
      </div>

      <button onClick={handleCreate} disabled={!eventCode || !roundName || saving} style={{
        width: '100%', padding: 12, borderRadius: 10, border: 'none', cursor: 'pointer',
        background: 'var(--accent)', color: 'var(--bg)', fontWeight: 700, fontSize: 13, opacity: saving ? 0.6 : 1,
      }}>
        Create Event & Round
      </button>
    </div>
  );
}

function EnterResults({ tournaments, showToast, selectedTournament, setSelectedTournament, tournamentDetail, onResultSaved }) {
  const [selectedMatch, setSelectedMatch] = useState('');
  const [winnerName, setWinnerName] = useState('');
  const [score, setScore] = useState('');
  const [setsPlayed, setSetsPlayed] = useState('2');
  const [resultType, setResultType] = useState('normal');
  const [saving, setSaving] = useState(false);

  // Gather all upcoming/in-progress matches
  const allMatches = [];
  if (tournamentDetail?.events) {
    for (const ev of tournamentDetail.events) {
      for (const rd of ev.rounds) {
        for (const m of rd.matches) {
          if (m.status !== 'completed') {
            allMatches.push({ ...m, roundName: rd.name, eventCode: ev.code });
          }
        }
      }
    }
  }

  const currentMatch = allMatches.find(m => m.id === selectedMatch);

  const handleSubmit = async () => {
    if (!selectedMatch || !winnerName) return;
    setSaving(true);
    try {
      const result = await api.submitResult({
        match_id: selectedMatch,
        winner_name: winnerName,
        score: resultType === 'normal' ? (score || null) : (score || null),
        sets_played: resultType === 'normal' ? (parseInt(setsPlayed) || null) : null,
        result_type: resultType,
      });
      showToast(`Result saved! ${result.scored} predictions scored`);
      setSelectedMatch(''); setWinnerName(''); setScore(''); setResultType('normal');
      onResultSaved?.();
    } catch (err) { showToast('Error: ' + err.message); }
    setSaving(false);
  };

  const selectStyle = { width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14, outline: 'none', marginTop: 6, appearance: 'auto' };
  const inputStyle = { width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14, outline: 'none', marginTop: 6 };

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Enter Match Result</h3>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Tournament</label>
        <select value={selectedTournament || ''} onChange={e => { setSelectedTournament(e.target.value); setSelectedMatch(''); }} style={selectStyle}>
          <option value="">Select tournament...</option>
          {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {allMatches.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Match</label>
          <select value={selectedMatch} onChange={e => { setSelectedMatch(e.target.value); setWinnerName(''); }} style={selectStyle}>
            <option value="">Select match...</option>
            {allMatches.map(m => (
              <option key={m.id} value={m.id}>{m.eventCode} {m.roundName}: {m.player1_name} vs {m.player2_name}</option>
            ))}
          </select>
        </div>
      )}

      {currentMatch && (
        <>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Winner</label>
            <select value={winnerName} onChange={e => setWinnerName(e.target.value)} style={selectStyle}>
              <option value="">Select winner...</option>
              <option value={currentMatch.player1_name}>{currentMatch.player1_name}</option>
              <option value={currentMatch.player2_name}>{currentMatch.player2_name}</option>
            </select>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Result Type</label>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              {[
                { id: 'normal', label: '🎾 Normal' },
                { id: 'walkover', label: '🚫 W/O' },
                { id: 'retirement', label: '🏥 Ret.' },
                { id: 'bye', label: '⏭️ Bye' },
              ].map(rt => (
                <button key={rt.id} onClick={() => setResultType(rt.id)} style={{
                  flex: 1, padding: '8px 4px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: resultType === rt.id ? 'var(--accent-glow)' : 'var(--bg)',
                  color: resultType === rt.id ? 'var(--accent)' : 'var(--text-dim)',
                  fontSize: 11, fontWeight: 600,
                }}>
                  {rt.label}
                </button>
              ))}
            </div>
          </div>

          {resultType === 'normal' && (
            <>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Score</label>
                <input value={score} onChange={e => setScore(e.target.value)} placeholder="6-3 6-4" style={inputStyle} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Sets Played</label>
                <select value={setsPlayed} onChange={e => setSetsPlayed(e.target.value)} style={selectStyle}>
                  <option value="2">2 (straight sets)</option>
                  <option value="3">3</option>
                </select>
              </div>
            </>
          )}

          {resultType === 'retirement' && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Score at retirement (optional)</label>
              <input value={score} onChange={e => setScore(e.target.value)} placeholder="e.g. 4-2" style={inputStyle} />
            </div>
          )}

          {(resultType === 'walkover' || resultType === 'bye') && (
            <div style={{ padding: 12, background: 'var(--bg)', borderRadius: 10, marginBottom: 14, fontSize: 12, color: 'var(--text-muted)' }}>
              {resultType === 'walkover' ? '🚫 Walkover — opponent withdrew before match started. Only winner points awarded.' : '⏭️ Bye — player advances automatically. Only winner points awarded.'}
            </div>
          )}

          <button onClick={handleSubmit} disabled={!winnerName || saving} style={{
            width: '100%', padding: 14, borderRadius: 12, border: 'none', cursor: 'pointer',
            background: 'var(--accent)', color: 'var(--bg)', fontWeight: 700, fontSize: 14, opacity: saving ? 0.6 : 1,
          }}>
            Save Result & Score Predictions
          </button>
        </>
      )}
    </div>
  );
}

function ScraperPanel({ tournaments, showToast }) {
  const [selectedTournament, setSelectedTournament] = useState('');
  const [tiUrl, setTiUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [linking, setLinking] = useState(false);
  const [status, setStatus] = useState(null);
  const [discovered, setDiscovered] = useState([]);
  const [discovering, setDiscovering] = useState(false);
  const [circuits, setCircuits] = useState([]);

  // Get user_id for auth
  const getUserId = () => {
    try { return JSON.parse(window.localStorage.getItem('courtcall_user'))?.id; }
    catch { return null; }
  };

  const loadDiscovered = () =>
    fetch(`/api/admin/discovered?user_id=${getUserId() || ''}`)
      .then(r => r.json()).then(d => setDiscovered(Array.isArray(d) ? d : [])).catch(() => {});

  useEffect(() => {
    fetch(`/api/admin/scraper-status?user_id=${getUserId() || ''}`).then(r => r.json()).then(setStatus).catch(console.error);
    loadDiscovered();
    fetch('/api/circuits').then(r => r.json()).then(d => setCircuits(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const handleLink = async () => {
    if (!selectedTournament || !tiUrl.trim()) return;
    setLinking(true);
    try {
      await fetch('/api/admin/link-ti', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournament_id: selectedTournament, ti_url: tiUrl.trim(), user_id: getUserId() }),
      }).then(r => r.json());
      showToast('Tournament linked to TI! 🔗');
      setTiUrl('');
      fetch(`/api/admin/scraper-status?user_id=${getUserId() || ''}`).then(r => r.json()).then(setStatus).catch(() => {});
    } catch (err) { alert(err.message); }
    finally { setLinking(false); }
  };

  const handleScrape = async () => {
    if (!selectedTournament) return;
    const t = tournaments.find(t => t.id === selectedTournament);
    const guidMatch = (t?.ti_url || tiUrl).match(/([A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12})/i);
    if (!guidMatch) { alert('No valid TI GUID found. Link the tournament first.'); return; }

    setScraping(true);
    try {
      const result = await fetch('/api/admin/scrape', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournament_id: selectedTournament, ti_guid: guidMatch[1], user_id: getUserId() }),
      }).then(r => r.json());

      if (result.success) {
        showToast(`Scraped! ${result.matches} matches imported 🎾`);
      } else {
        alert(result.error || 'Scrape failed');
      }
      fetch(`/api/admin/scraper-status?user_id=${getUserId() || ''}`).then(r => r.json()).then(setStatus).catch(() => {});
    } catch (err) { alert(err.message); }
    finally { setScraping(false); }
  };

  const handleDiscover = async () => {
    setDiscovering(true);
    try {
      const result = await fetch('/api/admin/discover', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: getUserId() }),
      }).then(r => r.json());
      if (result.success) {
        showToast(result.newCount > 0 ? `Found ${result.newCount} new tournament(s)! 🔍` : 'No new tournaments found');
        loadDiscovered();
      } else {
        showToast('Discovery failed: ' + (result.error || 'Unknown error'));
      }
    } catch (err) { showToast('Discovery failed: ' + err.message); }
    finally { setDiscovering(false); }
  };

  const handleApprove = async (disc, circuit_id, surface, province) => {
    const result = await fetch(`/api/admin/discovered/${disc.id}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: getUserId(), circuit_id, surface, province }),
    }).then(r => r.json());
    if (result.success) {
      showToast('Tournament added! Scrape will run automatically 🎾');
      setDiscovered(prev => prev.filter(d => d.id !== disc.id));
    } else {
      showToast('Failed: ' + (result.error || 'Unknown error'));
    }
  };

  const handleDismiss = async (disc) => {
    await fetch(`/api/admin/discovered/${disc.id}/dismiss`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: getUserId() }),
    });
    setDiscovered(prev => prev.filter(d => d.id !== disc.id));
  };

  return (
    <div>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>🔗 How it works</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          1. Find the tournament on ti.tournamentsoftware.com<br />
          2. Copy the URL (contains the tournament GUID)<br />
          3. Select the tournament below and paste the URL<br />
          4. Hit "Scrape Now" to pull the draw automatically<br />
          5. The scraper also runs every 4 hours for linked tournaments
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Tournament</label>
        <select value={selectedTournament} onChange={(e) => setSelectedTournament(e.target.value)} style={selectStyle}>
          <option value="">Select tournament...</option>
          {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>TournamentSoftware URL</label>
        <input
          value={tiUrl} onChange={(e) => setTiUrl(e.target.value)}
          placeholder="https://ti.tournamentsoftware.com/tournament/GUID..."
          style={inputStyle2}
        />
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
          Paste the full URL from ti.tournamentsoftware.com
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <button onClick={handleLink} disabled={!selectedTournament || !tiUrl.trim() || linking} style={{
          flex: 1, padding: 12, borderRadius: 12, border: 'none', cursor: 'pointer',
          background: 'var(--blue-glow)', color: 'var(--blue)', fontSize: 13, fontWeight: 600,
          opacity: linking ? 0.7 : 1,
        }}>
          {linking ? 'Linking...' : '🔗 Link'}
        </button>
        <button onClick={handleScrape} disabled={!selectedTournament || scraping} style={{
          flex: 2, padding: 12, borderRadius: 12, border: 'none', cursor: 'pointer',
          background: scraping ? 'var(--border)' : 'linear-gradient(135deg, var(--accent), var(--accent-dim))',
          color: scraping ? 'var(--text-dim)' : 'var(--bg)', fontSize: 13, fontWeight: 700,
        }}>
          {scraping ? '⏳ Scraping...' : '🎾 Scrape Now'}
        </button>
      </div>

      {/* Linked Tournaments */}
      {status?.linked_tournaments?.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Linked Tournaments</h3>
          {status.linked_tournaments.map(t => (
            <div key={t.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, marginBottom: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all', marginBottom: 6 }}>{t.ti_url}</div>
              <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                <span style={{ color: 'var(--accent)', fontFamily: 'var(--mono)' }}>{t.match_count} matches</span>
                <span style={{ color: 'var(--blue)', fontFamily: 'var(--mono)' }}>{t.completed_count} completed</span>
              </div>
            </div>
          ))}
        </>
      )}

      {/* Tournament Discovery */}
      <div style={{ marginTop: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 }}>
            Auto-Discovery {discovered.length > 0 && <span style={{ background: 'var(--orange)', color: '#000', borderRadius: 8, padding: '1px 6px', fontSize: 10, marginLeft: 6 }}>{discovered.length}</span>}
          </h3>
          <button onClick={handleDiscover} disabled={discovering} style={{
            padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--card)', color: discovering ? 'var(--text-dim)' : 'var(--text)',
            fontSize: 12, fontWeight: 600, cursor: discovering ? 'default' : 'pointer',
          }}>
            {discovering ? '⏳ Searching...' : '🔍 Run Discovery'}
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.5 }}>
          Searches TI for tournaments not yet in CourtCall. Runs automatically every 24 hours.
        </div>

        {discovered.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '12px 0' }}>No pending discoveries</div>
        ) : (
          discovered.map(disc => <DiscoveryItem key={disc.id} disc={disc} circuits={circuits} onApprove={handleApprove} onDismiss={handleDismiss} />)
        )}
      </div>
    </div>
  );
}

function DiscoveryItem({ disc, circuits, onApprove, onDismiss }) {
  const [expanded, setExpanded] = useState(false);
  const [circuit_id, setCircuitId] = useState('');
  const [surface, setSurface] = useState('Hard');
  const [province, setProvince] = useState('Ulster');
  const [saving, setSaving] = useState(false);

  const doApprove = async () => {
    setSaving(true);
    await onApprove(disc, circuit_id || null, surface, province);
    setSaving(false);
  };

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{disc.name}</div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', wordBreak: 'break-all' }}>{disc.ti_url}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={() => setExpanded(e => !e)} style={{
            padding: '5px 10px', borderRadius: 8, border: '1px solid var(--accent)',
            background: 'var(--accent-glow)', color: 'var(--accent)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}>
            {expanded ? 'Cancel' : '✓ Approve'}
          </button>
          <button onClick={() => onDismiss(disc)} style={{
            padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--text-dim)', fontSize: 11, cursor: 'pointer',
          }}>
            ✕
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Circuit</label>
            <select value={circuit_id} onChange={e => setCircuitId(e.target.value)} style={{ ...selectStyle, marginTop: 4, fontSize: 12 }}>
              <option value="">None / assign later</option>
              {circuits.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Surface</label>
              <select value={surface} onChange={e => setSurface(e.target.value)} style={{ ...selectStyle, marginTop: 4, fontSize: 12 }}>
                {['Hard', 'Grass', 'Artificial Grass', 'Clay'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Province</label>
              <select value={province} onChange={e => setProvince(e.target.value)} style={{ ...selectStyle, marginTop: 4, fontSize: 12 }}>
                {['Ulster', 'Leinster', 'Munster', 'Connacht'].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <button onClick={doApprove} disabled={saving} style={{
            width: '100%', padding: '10px', borderRadius: 10, border: 'none', cursor: saving ? 'default' : 'pointer',
            background: 'linear-gradient(135deg, var(--accent), var(--accent-dim))',
            color: 'var(--bg)', fontWeight: 700, fontSize: 13, opacity: saving ? 0.6 : 1,
          }}>
            {saving ? 'Adding...' : 'Add to CourtCall'}
          </button>
        </div>
      )}
    </div>
  );
}

function UsersPanel({ showToast }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const getUserId = () => { try { return JSON.parse(window.localStorage.getItem('courtcall_user'))?.id; } catch { return null; } };

  useEffect(() => {
    fetch(`/api/admin/users?user_id=${getUserId()}`)
      .then(r => r.json())
      .then(d => { setUsers(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const toggleAdmin = (user) => {
    const newVal = !user.is_admin;
    fetch(`/api/admin/users/${user.id}/set-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: getUserId(), admin: newVal }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setUsers(prev => prev.map(u => u.id === user.id ? { ...u, is_admin: newVal } : u));
          showToast(`${user.username} is ${newVal ? 'now an admin' : 'no longer an admin'}`);
        }
      })
      .catch(() => showToast('Failed to update admin status'));
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading users...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{users.length} registered users</p>
      {users.map(user => (
        <div key={user.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>{user.avatar}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{user.display_name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>@{user.username}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {user.is_admin && <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, background: 'var(--accent-glow)', padding: '2px 8px', borderRadius: 6 }}>Admin</span>}
            <button
              onClick={() => toggleAdmin(user)}
              disabled={user.is_env_admin}
              title={user.is_env_admin ? 'Set via environment variable' : ''}
              style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: user.is_env_admin ? 'not-allowed' : 'pointer',
                border: `1px solid ${user.is_admin ? 'var(--red)' : 'var(--accent)'}`,
                background: user.is_admin ? 'var(--red-glow)' : 'var(--accent-glow)',
                color: user.is_admin ? 'var(--red)' : 'var(--accent)',
                opacity: user.is_env_admin ? 0.5 : 1,
              }}
            >
              {user.is_admin ? 'Revoke Admin' : 'Make Admin'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const labelStyle = { fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' };
const inputStyle2 = { width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, outline: 'none', marginTop: 8 };
const selectStyle = { width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14, outline: 'none', marginTop: 8, appearance: 'auto' };
