/**
 * Bound to the Fazwazpoker Google Sheet.
 *
 * doPost accepts JSON { pin, key, base, session }.
 * session uses the ledger shape: id, number, date, and entries
 * (or results) of { playerId, buyIn, net }. net is null when unrecorded.
 * The PIN is the Script Property HOST_PIN.
 * Recorded nets must sum to 0. The same key is saved once.
 * The next session number is max(sheet, client base, proposed number - 1) + 1.
 *
 * doGet returns those sessions as JSON. ?callback=name wraps them for JSONP.
 * POST with Content-Type text/plain so the browser skips the CORS preflight.
 */

var HEADERS = ["sessionNumber", "sessionId", "date", "playerId", "buyIn", "net", "key"];

function doGet(e) {
  var body;
  try {
    body = JSON.stringify(readSessions_());
  } catch (err) {
    body = JSON.stringify({ ok: false, error: "The sheet could not be read." });
  }
  var callback = e && e.parameter ? String(e.parameter.callback || "") : "";
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + "(" + body + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(body)
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var body = parseBody_(e);
    checkPin_(body.pin);
    var session = body.session || {};
    var entries = cleanEntries_(session);
    var date = cleanDate_(session);
    var key = cleanKey_(body.key || body.idempotencyKey);
    var base = clientBase_(body.base, session.number);
    var number = writeSession_(entries, date, key, base);
    return json_({ ok: true, sessionNumber: number });
  } catch (err) {
    return json_({ ok: false, error: messageOf_(err) });
  }
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function messageOf_(err) {
  var message = err && err.message ? String(err.message) : "";
  if (!message || message === "Error") return "The session was not saved.";
  return message;
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) throw new Error("Missing session.");
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    throw new Error("The session could not be read.");
  }
  if (!data || typeof data !== "object") throw new Error("Missing session.");
  return data;
}

function checkPin_(pin) {
  var expected = PropertiesService.getScriptProperties().getProperty("HOST_PIN");
  if (!expected) throw new Error("HOST_PIN is not set.");
  if (String(pin == null ? "" : pin).trim() !== String(expected).trim()) {
    throw new Error("Wrong PIN.");
  }
}

function cleanKey_(key) {
  var text = String(key == null ? "" : key);
  if (!/^[A-Za-z0-9-]{8,80}$/.test(text)) throw new Error("Missing save key.");
  return text;
}

function clientBase_(base, proposed) {
  var known = finiteInt_(base);
  var fromProposed = finiteInt_(proposed);
  if (fromProposed > 0) fromProposed -= 1;
  return Math.max(known, fromProposed);
}

function finiteInt_(value) {
  var number = Number(value);
  if (!isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

function cleanDate_(session) {
  if (!session || session.date == null || session.date === "") return "";
  var text = String(session.date);
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error("The date is not valid.");
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    throw new Error("The date is not valid.");
  }
  return text;
}

function cleanEntries_(session) {
  if (!session || typeof session !== "object") throw new Error("Missing session.");
  var list = Array.isArray(session.entries) ? session.entries : session.results;
  if (!Array.isArray(list) || list.length === 0) throw new Error("Missing session.");
  var seen = {};
  var clean = [];
  var sum = 0;
  var any = false;
  for (var i = 0; i < list.length; i++) {
    var entry = list[i];
    if (!entry || typeof entry.playerId !== "string" || !entry.playerId.trim()) {
      throw new Error("Each player needs a buy-in and a net.");
    }
    var playerId = entry.playerId.trim();
    if (seen[playerId]) throw new Error("A player is listed twice.");
    seen[playerId] = true;
    if (typeof entry.buyIn !== "number" || !isFinite(entry.buyIn) || entry.buyIn < 0) {
      throw new Error("Each player needs a buy-in and a net.");
    }
    if (entry.net === null) {
      clean.push({ playerId: playerId, buyIn: entry.buyIn, net: null });
      continue;
    }
    if (typeof entry.net !== "number" || !isFinite(entry.net)) {
      throw new Error("Each player needs a buy-in and a net.");
    }
    sum += entry.net;
    any = true;
    clean.push({ playerId: playerId, buyIn: entry.buyIn, net: entry.net });
  }
  if (!any || Math.abs(sum) > 0.000001) throw new Error("Nets must sum to 0.");
  return clean;
}

function writeSession_(entries, date, key, base) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error("The sheet is busy. Try again.");
  try {
    var sheet = ensureSheet_();
    var existing = findSessionNumber_(sheet, key);
    if (existing) return existing;
    var number = Math.max(maxOnSheet_(sheet), base) + 1;
    appendSession_(sheet, number, date, entries, key);
    SpreadsheetApp.flush();
    return number;
  } finally {
    lock.releaseLock();
  }
}

function ensureSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Sessions");
  if (!sheet) sheet = ss.insertSheet("Sessions");
  var first = String(sheet.getRange(1, 1).getValue() || "");
  if (first !== HEADERS[0]) {
    if (sheet.getLastRow() > 0) sheet.insertRowBefore(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
  var rows = Math.max(sheet.getMaxRows(), 1);
  sheet.getRange(1, 2, rows, 1).setNumberFormat("@");
  sheet.getRange(1, 3, rows, 1).setNumberFormat("@");
  sheet.getRange(1, 4, rows, 1).setNumberFormat("@");
  sheet.getRange(1, 7, rows, 1).setNumberFormat("@");
  return sheet;
}

function columnMap_(sheet) {
  var header = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  var map = {};
  for (var i = 0; i < header.length; i++) map[String(header[i])] = i;
  return map;
}

function findSessionNumber_(sheet, key) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var map = columnMap_(sheet);
  var values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][map.key]) === key) return Number(values[i][map.sessionNumber]) || 0;
  }
  return 0;
}

function maxOnSheet_(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var map = columnMap_(sheet);
  var values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var max = 0;
  for (var i = 0; i < values.length; i++) {
    var number = Number(values[i][map.sessionNumber]);
    if (number > max) max = number;
  }
  return max;
}

function appendSession_(sheet, number, date, entries, key) {
  var rows = [];
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    rows.push([
      number,
      "session-" + number,
      date,
      entry.playerId,
      entry.buyIn,
      entry.net === null ? "" : entry.net,
      key,
    ]);
  }
  var start = sheet.getLastRow() + 1;
  sheet.getRange(start, 1, rows.length, HEADERS.length).setValues(rows);
}

function readSessions_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Sessions");
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var header = values[0];
  var map = {};
  for (var c = 0; c < header.length; c++) map[String(header[c])] = c;
  if (map.sessionNumber == null || map.playerId == null) return [];
  var groups = [];
  var index = {};
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var number = Number(row[map.sessionNumber]);
    if (!number) continue;
    var playerId = String(row[map.playerId] || "").trim();
    if (!playerId) continue;
    var id = "session-" + number;
    if (!Object.prototype.hasOwnProperty.call(index, id)) {
      var session = {
        id: id,
        number: number,
        label: "Session " + number,
        entries: [],
      };
      var date = dateText_(row[map.date]);
      if (date) session.date = date;
      index[id] = groups.length;
      groups.push(session);
    }
    var netCell = row[map.net];
    var net = netCell === "" || netCell == null ? null : Number(netCell);
    if (net != null && !isFinite(net)) net = null;
    var buyCell = row[map.buyIn];
    var buyIn = buyCell === "" || buyCell == null ? null : Number(buyCell);
    if (buyIn != null && !isFinite(buyIn)) buyIn = null;
    groups[index[id]].entries.push({ playerId: playerId, buyIn: buyIn, net: net });
  }
  groups.sort(function (a, b) { return a.number - b.number; });
  return groups;
}

function dateText_(value) {
  if (value == null || value === "") return "";
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  var text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
}
