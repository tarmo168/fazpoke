/**
 * Ledger math.
 *
 * A result counts only when `net` is a finite number.
 * 0 is a recorded break-even and stays on the board.
 * null, or a missing net, is unrecorded and is never coerced to 0.
 */

export function isRecordedNet(net) {
  return typeof net === "number" && Number.isFinite(net);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
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
          buyIn: row.buyIn,
          net: row.net,
          recorded,
        });
      }
    }

    sessionViews.push({
      id: session.id,
      label: session.label,
      buyIn,
      net,
      rows,
    });
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

export function findPlayer(model, id) {
  return (
    model.standings.find((player) => player.id === id) ||
    model.unrecorded.find((player) => player.id === id) ||
    null
  );
}
