const BASE = '/api';

async function request(path, options = {}) {
  const headers = { ...options.headers };
  if (options.method && options.method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(res.ok ? 'Invalid response from server' : `Server error (${res.status})`);
  }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  // Auth
  register: (username, display_name, pin, avatar) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify({ username, display_name, pin, avatar }) }),
  login: (username, pin) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username, pin }) }),

  // Tournaments
  getTournaments: (circuitId) => request(`/tournaments${circuitId ? `?circuit=${circuitId}` : ''}`),
  getTournament: (id) => request(`/tournaments/${id}`),

  // Circuits
  getCircuits: () => request('/circuits'),
  getUserCircuits: (userId) => request(`/circuits/user/${userId}`),
  joinCircuit: (circuit_id, user_id) =>
    request('/circuits/join', { method: 'POST', body: JSON.stringify({ circuit_id, user_id }) }),

  // Predictions
  submitPrediction: (data) =>
    request('/predictions', { method: 'POST', body: JSON.stringify(data) }),
  getUserPredictions: (userId) => request(`/predictions/${userId}`),
  getTournamentPredictions: (userId, tournamentId) =>
    request(`/predictions/${userId}/${tournamentId}`),

  // Leagues
  createLeague: (data) =>
    request('/leagues', { method: 'POST', body: JSON.stringify(data) }),
  joinLeague: (invite_code, user_id) =>
    request('/leagues/join', { method: 'POST', body: JSON.stringify({ invite_code, user_id }) }),
  getUserLeagues: (userId) => request(`/leagues/user/${userId}`),
  getLeague: (id) => request(`/leagues/${id}`),

  // Admin — auto-injects user_id for auth
  addTournament: (data) => {
    const user = getStoredUser();
    return request('/admin/tournaments', { method: 'POST', body: JSON.stringify({ ...data, user_id: user?.id }) });
  },
  addEvent: (data) => {
    const user = getStoredUser();
    return request('/admin/events', { method: 'POST', body: JSON.stringify({ ...data, user_id: user?.id }) });
  },
  addRound: (data) => {
    const user = getStoredUser();
    return request('/admin/rounds', { method: 'POST', body: JSON.stringify({ ...data, user_id: user?.id }) });
  },
  addMatches: (round_id, matches) => {
    const user = getStoredUser();
    return request('/admin/matches', { method: 'POST', body: JSON.stringify({ round_id, matches, user_id: user?.id }) });
  },
  submitResult: (data) => {
    const user = getStoredUser();
    return request('/admin/results', { method: 'POST', body: JSON.stringify({ ...data, user_id: user?.id }) });
  },
};

function getStoredUser() {
  try { return JSON.parse(window.localStorage.getItem('courtcall_user')); }
  catch { return null; }
}
