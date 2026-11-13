/**
 * Ledger math.
 *
 * A result counts only when `net` is a finite number.
 * 0 is a recorded break-even and stays on the board.
 * null, or a missing net, is unrecorded and is never coerced to 0.
 *
 * Total earnings for a session is the sum of its positive recorded nets,
 * the amount that changed hands. The all-sessions figure adds those up.
 * Break-even and unrecorded results add nothing.
 */

export function isRecordedNet(net) {
  return typeof net === "number" && Number.isFinite(net);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function totalEarnings(rows) {
  return rows.reduce((sum, row) => (
    row.recorded && row.net > 0 ? sum + row.net : sum
  ), 0);
}

export function buildModel(players, sessions) {
  const warnings = [];
  const copies = players.map((player) => ({ ...player, history: [] }));
  const byId = new Map();

  for (const player of copies) {
    if (byId.has(player.id)) warnings.push(`Duplicate player id ${player.id}.`);
    else byId.set(player.id, player);
  }

  const sessionViews = [];

  for (const session of sessions) {
    const seen = new Set();
    let buyIn = 0;
    let net = 0;
    const rows = [];

    for (const entry of session.entries || []) {
      if (seen.has(entry.playerId)) {
        warnings.push(`Duplicate entry for ${entry.playerId} in ${session.label}.`);
        continue;
      }
      seen.add(entry.playerId);

      const recorded = isRecordedNet(entry.net);
      const buyKnown = isFiniteNumber(entry.buyIn);
      if (recorded) {
        net += entry.net;
        if (buyKnown) buyIn += entry.buyIn;
        else warnings.push(`Recorded result for ${entry.playerId} in ${session.label} has no buy-in.`);
      }

      const row = {
        playerId: entry.playerId,
        buyIn: buyKnown ? entry.buyIn : null,
        net: recorded ? entry.net : null,
        recorded,
      };
      rows.push(row);

      const player = byId.get(entry.playerId);
      if (!player) warnings.push(`Unknown player id ${entry.playerId} in ${session.label}.`);
      else {
        player.history.push({
          sessionId: session.id,
          label: session.label,
          date: typeof session.date === "string" ? session.date : "",
          buyIn: row.buyIn,
          net: row.net,
          recorded,
        });
      }
    }

    const view = {
      id: session.id,
      label: session.label,
      date: typeof session.date === "string" ? session.date : "",
      buyIn,
      net,
      totalEarnings: totalEarnings(rows),
      rows,
    };
    if (Number.isSafeInteger(session.number) && session.number > 0) view.number = session.number;
    sessionViews.push(view);
  }

  const standings = [];
  const unrecorded = [];

  for (const player of copies) {
    const recordedHist = player.history.filter((item) => item.recorded);
    if (recordedHist.length === 0) {
      unrecorded.push({
        ...player,
        recorded: false,
        sessionsPlayed: 0,
        buyIn: null,
        net: null,
        best: null,
        worst: null,
        points: null,
      });
      continue;
    }

    const nets = recordedHist.map((item) => item.net);
    const net = nets.reduce((sum, value) => sum + value, 0);
    const buyIn = recordedHist.reduce(
      (sum, item) => sum + (typeof item.buyIn === "number" ? item.buyIn : 0),
      0,
    );
    const histBySession = new Map(player.history.map((item) => [item.sessionId, item]));
    let cum = 0;
    const points = [{ label: "Start", value: 0, kind: "baseline", delta: null }];

    for (const session of sessionViews) {
      const item = histBySession.get(session.id);
      if (item && item.recorded) {
        cum += item.net;
        points.push({ label: session.label, value: cum, kind: "played", delta: item.net });
      } else {
        points.push({ label: session.label, value: cum, kind: "carried", delta: null });
      }
    }

    standings.push({
      ...player,
      recorded: true,
      sessionsPlayed: recordedHist.length,
      buyIn,
      net,
      best: Math.max(...nets),
      worst: Math.min(...nets),
      points,
    });
  }

  const totals = {
    sessions: sessionViews.length,
    players: copies.length,
    recordedPlayers: standings.length,
    buyIn: sessionViews.reduce((sum, session) => sum + session.buyIn, 0),
    net: sessionViews.reduce((sum, session) => sum + session.net, 0),
    totalEarnings: sessionViews.reduce((sum, session) => sum + session.totalEarnings, 0),
  };

  return { standings, unrecorded, sessions: sessionViews, totals, warnings, byId };
}

export function sortStandings(rows, key, dir) {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (a[key] !== b[key]) return (a[key] - b[key]) * sign;
    if (a.net !== b.net) return b.net - a.net;
    return a.name.localeCompare(b.name);
  });
}

/** Shown in the rank column for a player with no recorded result. */
export const UNRANKED_MARK = "–";

/** Shown in place of total earnings for a player with no recorded result. */
export const BLANK_EARNINGS = "—";

/**
 * Ranked players in the requested order, then players with no recorded
 * result in roster order. The second group stays last for every sort,
 * including sessions low to high, where a session count of 0 would
 * otherwise come first.
 */
export function leaderboardOrder(standings, unrecorded, key, dir) {
  return [
    ...sortStandings(standings, key, dir),
    ...(Array.isArray(unrecorded) ? unrecorded : []),
  ];
}

/** Text for one leaderboard row. Unranked rows have no sparkline. */
export function boardRowText(player) {
  if (!player || player.recorded !== true) {
    return {
      ranked: false,
      rank: UNRANKED_MARK,
      sessions: "0",
      earnings: BLANK_EARNINGS,
      sparkline: false,
    };
  }
  return {
    ranked: true,
    sessions: String(player.sessionsPlayed),
    sparkline: true,
  };
}

export function findPlayer(model, id) {
  return (
    model.standings.find((player) => player.id === id) ||
    model.unrecorded.find((player) => player.id === id) ||
    null
  );
}

/**
 * Rank movement, streaks, and badges for the leaderboard.
 *
 * Movement compares each player's place after the latest session with
 * their place after the previous one. Both rankings use cumulative
 * recorded net, highest first, with the same name tie-break as the board.
 * A player whose first recorded result is in the latest session is new.
 * One session has no previous ranking, so every recorded player is new.
 */

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function recordedEntries(player) {
  const history = Array.isArray(player?.history) ? player.history : [];
  return history.filter((item) => item && item.recorded && isRecordedNet(item.net));
}

function playerNets(player) {
  if (Array.isArray(player?.nets)) return player.nets.filter(isRecordedNet);
  return recordedEntries(player).map((item) => item.net);
}

function ranksByEarnings(rows) {
  const ranks = new Map();
  sortStandings(rows, "net", "desc").forEach((row, index) => {
    ranks.set(row.id, index + 1);
  });
  return ranks;
}

export function rankMoves(players, sessions) {
  const moves = new Map();
  const list = Array.isArray(sessions) ? sessions : [];
  const roster = Array.isArray(players) ? players : [];
  if (!list.length) return moves;

  const latestId = list[list.length - 1]?.id;
  const current = [];
  const previous = [];

  for (const player of roster) {
    const entries = recordedEntries(player);
    if (!entries.length) continue;
    const prior = entries.filter((item) => item.sessionId !== latestId);
    current.push({
      id: player.id,
      name: player.name || "",
      net: sum(entries.map((item) => item.net)),
    });
    if (!prior.length) moves.set(player.id, { change: "new", places: 0 });
    else {
      previous.push({
        id: player.id,
        name: player.name || "",
        net: sum(prior.map((item) => item.net)),
      });
    }
  }

  const currentRank = ranksByEarnings(current);
  const previousRank = ranksByEarnings(previous);
  for (const row of previous) {
    const delta = previousRank.get(row.id) - currentRank.get(row.id);
    if (delta > 0) moves.set(row.id, { change: "up", places: delta });
    else if (delta < 0) moves.set(row.id, { change: "down", places: -delta });
    else moves.set(row.id, { change: "flat", places: 0 });
  }
  return moves;
}

/** Cumulative recorded net after each session the player has a result in. */
export function cumulativeNets(player) {
  let total = 0;
  const points = [];
  for (const item of recordedEntries(player)) {
    total += item.net;
    points.push(total);
  }
  return points;
}

/**
 * Sign of the most recent recorded nets.
 * Positive is a hot streak, negative is a cold streak.
 * A break-even (0) ends the run. Fewer than 2 sessions is no streak.
 */
export function streak(nets) {
  const values = (Array.isArray(nets) ? nets : []).filter(isRecordedNet);
  let type = null;
  let length = 0;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value === 0) break;
    const sign = value > 0 ? "hot" : "cold";
    if (type == null) type = sign;
    if (sign !== type) break;
    length += 1;
  }
  if (type == null || length < 2) return { type: null, length: 0 };
  return { type, length };
}

/** Population standard deviation. Describes the recorded nets themselves. */
export function standardDeviation(values) {
  const nums = (Array.isArray(values) ? values : []).filter(isRecordedNet);
  if (!nums.length) return 0;
  const mean = sum(nums) / nums.length;
  const variance = sum(nums.map((value) => (value - mean) ** 2)) / nums.length;
  return Math.sqrt(variance);
}

function sameSpread(left, right) {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= scale * 1e-9;
}

/** Ids with the lowest std dev among players who have `minimum` recorded nets. */
export function mostConsistent(players, minimum = 3) {
  const eligible = [];
  for (const player of players || []) {
    const nets = playerNets(player);
    if (nets.length < minimum) continue;
    eligible.push({ id: player.id, spread: standardDeviation(nets) });
  }
  if (!eligible.length) return [];
  const best = Math.min(...eligible.map((item) => item.spread));
  return eligible.filter((item) => sameSpread(item.spread, best)).map((item) => item.id);
}

const BADGE_LIMIT = 2;

const BADGES = {
  chip: {
    id: "chip",
    mark: "👑",
    label: "Chip leader",
    title: "Highest total earnings.",
  },
  consistent: {
    id: "consistent",
    mark: "🎯",
    label: "Most consistent",
    title: "Lowest standard deviation of session net among players with 3 or more recorded sessions.",
  },
  win: {
    id: "win",
    mark: "📈",
    label: "Biggest win",
    title: "Highest single session net.",
  },
  fish: {
    id: "fish",
    mark: "🐟",
    label: "Fish",
    title: "Lowest total earnings.",
  },
};

function streakBadge(type, length) {
  const word = type === "hot" ? "Positive" : "Negative";
  return {
    id: type,
    mark: type === "hot" ? "🔥" : "🧊",
    label: type === "hot" ? "Hot streak" : "Cold streak",
    title: `${word} net in ${length} consecutive most-recent recorded sessions.`,
  };
}

/**
 * Up to two badges per player, in this order:
 * chip leader, fish, hot streak, cold streak, most consistent, biggest win.
 * Ties go to every player who shares the mark. Fish is the lowest total
 * earnings among players with a recorded result. Consistency is omitted
 * when nobody has 3 recorded sessions.
 */
export function awardBadges(players) {
  const rows = [];
  for (const player of players || []) {
    const nets = playerNets(player);
    const net = isRecordedNet(player?.net) ? player.net : (nets.length ? sum(nets) : null);
    if (net == null) continue;
    rows.push({ id: player.id, net, nets });
  }

  const bestTotal = rows.length ? Math.max(...rows.map((row) => row.net)) : null;
  const worstTotal = rows.length ? Math.min(...rows.map((row) => row.net)) : null;
  const leaders = new Set(
    bestTotal == null ? [] : rows.filter((row) => row.net === bestTotal).map((row) => row.id),
  );
  const fish = new Set(
    worstTotal == null ? [] : rows.filter((row) => row.net === worstTotal).map((row) => row.id),
  );
  const consistent = new Set(mostConsistent(rows));
  let bestSession = null;
  for (const row of rows) {
    for (const net of row.nets) {
      if (bestSession == null || net > bestSession) bestSession = net;
    }
  }
  const winners = new Set(
    bestSession == null
      ? []
      : rows.filter((row) => row.nets.some((net) => net === bestSession)).map((row) => row.id),
  );

  const awarded = new Map();
  for (const row of rows) {
    const run = streak(row.nets);
    const picked = [];
    if (leaders.has(row.id)) picked.push({ ...BADGES.chip });
    if (fish.has(row.id)) picked.push({ ...BADGES.fish });
    if (run.type === "hot" || run.type === "cold") picked.push(streakBadge(run.type, run.length));
    if (consistent.has(row.id)) picked.push({ ...BADGES.consistent });
    if (winners.has(row.id)) picked.push({ ...BADGES.win });
    awarded.set(row.id, picked.slice(0, BADGE_LIMIT));
  }
  return awarded;
}
