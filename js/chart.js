import { avatar, el } from "./dom.js";
import { formatSigned, signedClass } from "./format.js";

const PALETTE = [
  "#e4c27a",
  "#7eb6ff",
  "#f2a3c7",
  "#3ddc97",
  "#ffb15a",
  "#6ee0e0",
  "#c7a0ff",
  "#ff8f6b",
  "#d2e38c",
  "#f0a3a3",
];

export function colorMap(playerOrder, standings) {
  const recorded = new Set(standings.map((player) => player.id));
  const map = new Map();
  let index = 0;
  for (const player of playerOrder) {
    if (!recorded.has(player.id)) continue;
    map.set(player.id, PALETTE[index % PALETTE.length]);
    index += 1;
  }
  return map;
}

function niceStep(span) {
  const rough = span / 4;
  if (!Number.isFinite(rough) || rough <= 1) return 1;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const err = rough / pow;
  const mult = err >= 7.5 ? 10 : err >= 3 ? 5 : err >= 1.5 ? 2 : 1;
  return mult * pow;
}

function axisTicks(min, max) {
  if (max - min < 200) {
    const mid = (min + max) / 2;
    min = mid - 100;
    max = mid + 100;
  }
  const step = niceStep(max - min);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let value = start; value <= end + step * 0.001; value += step) {
    ticks.push(Math.round(value));
  }
  if (ticks.length < 2) return [min, max];
  return ticks;
}

function tipText(series, index) {
  const kind = series.kinds[index];
  const value = series.values[index];
  const label = series.categories[index];
  const lines = [series.name, label, formatSigned(value)];
  if (kind === "baseline") lines.push("Before any session");
  else if (kind === "played") lines.push(`Recorded result ${formatSigned(series.deltas[index])}`);
  else lines.push(`No recorded result this session. Cumulative total stays at ${formatSigned(value)}.`);
  return lines;
}

function draw(host) {
  const spec = host._spec;
  if (!spec || host._drawing) return;
  const width = host.clientWidth || 640;
  const bucket = width < 560 ? "s" : "l";
  if (host.dataset.bucket === bucket && host.querySelector("svg")) return;
  host.dataset.bucket = bucket;
  host._drawing = true;

  try {
  const categories = spec.categories;
  const series = spec.series;
  const compact = bucket === "s";
  const height = compact ? 280 : 320;
  const pad = { l: compact ? 64 : 74, r: 22, t: 22, b: categories.length > 6 ? 68 : 40 };
  const innerW = 720 - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;

  const values = series.flatMap((item) => item.values);
  const dataMin = Math.min(...values, 0);
  const dataMax = Math.max(...values, 0);
  const ticks = axisTicks(dataMin, dataMax);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const xAt = (index) => {
    if (categories.length <= 1) return pad.l + innerW / 2;
    return pad.l + (index / (categories.length - 1)) * innerW;
  };
  const yAt = (value) => {
    if (yMax === yMin) return pad.t + innerH / 2;
    return pad.t + ((yMax - value) / (yMax - yMin)) * innerH;
  };

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 720 ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", spec.label);
  const title = document.createElementNS(svgNS, "title");
  title.textContent = spec.label;
  svg.append(title);

  const grid = document.createElementNS(svgNS, "g");
  for (const tick of ticks) {
    const y = yAt(tick);
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", String(pad.l));
    line.setAttribute("x2", String(720 - pad.r));
    line.setAttribute("y1", y.toFixed(2));
    line.setAttribute("y2", y.toFixed(2));
    line.setAttribute("class", tick === 0 ? "grid-zero" : "grid-line");
    grid.append(line);

    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", String(pad.l - 8));
    label.setAttribute("y", (y + 4).toFixed(2));
    label.setAttribute("text-anchor", "end");
    label.setAttribute("class", "axis-label");
    label.textContent = formatSigned(tick);
    grid.append(label);
  }

  categories.forEach((category, index) => {
    const label = document.createElementNS(svgNS, "text");
    const x = xAt(index);
    const y = height - 12;
    const anchor = categories.length > 6
      ? "end"
      : index === 0
        ? "start"
        : index === categories.length - 1
          ? "end"
          : "middle";
    label.setAttribute("x", x.toFixed(2));
    label.setAttribute("y", String(y));
    label.setAttribute("text-anchor", anchor);
    label.setAttribute("class", "axis-label");
    if (categories.length > 6) {
      label.setAttribute("transform", `rotate(-40 ${x.toFixed(2)} ${y})`);
    }
    label.textContent = category;
    grid.append(label);
  });
  svg.append(grid);

  const active = spec.activeId;
  const ordered = [...series].sort((a, b) => {
    if (a.id === active) return 1;
    if (b.id === active) return -1;
    return 0;
  });

  for (const item of ordered) {
    const dim = active && active !== item.id;
    const path = document.createElementNS(svgNS, "path");
    const d = item.values
      .map((value, index) => `${index === 0 ? "M" : "L"}${xAt(index).toFixed(2)} ${yAt(value).toFixed(2)}`)
      .join(" ");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", item.color);
    path.setAttribute("stroke-width", active === item.id ? "3.2" : "2.4");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("opacity", dim ? "0.16" : "1");
    svg.append(path);
  }

  const tip = el("div", { class: "chart-tip", hidden: true });

  function placeTip(lines, clientX, clientY) {
    const bounds = host.getBoundingClientRect();
    tip.hidden = false;
    tip.replaceChildren(...lines.map((line) => el("div", { text: line })));
    const left = Math.min(Math.max(clientX - bounds.left, 72), bounds.width - 72);
    const top = Math.max(clientY - bounds.top, 28);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  for (const item of series) {
    item.values.forEach((value, index) => {
      const dim = active && active !== item.id;
      const kind = item.kinds[index];
      const dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("cx", xAt(index).toFixed(2));
      dot.setAttribute("cy", yAt(value).toFixed(2));
      dot.setAttribute("r", kind === "baseline" ? "3.2" : "4.4");
      if (kind === "carried") {
        dot.setAttribute("fill", "#121815");
        dot.setAttribute("stroke", item.color);
        dot.setAttribute("stroke-width", "2");
      } else {
        dot.setAttribute("fill", item.color);
      }
      dot.setAttribute("opacity", dim ? "0.16" : "1");
      svg.append(dot);

      const hit = document.createElementNS(svgNS, "circle");
      hit.setAttribute("cx", xAt(index).toFixed(2));
      hit.setAttribute("cy", yAt(value).toFixed(2));
      hit.setAttribute("r", "12");
      hit.setAttribute("fill", "transparent");
      const lines = tipText({ ...item, categories }, index);
      hit.addEventListener("pointerenter", (event) => placeTip(lines, event.clientX, event.clientY));
      hit.addEventListener("pointermove", (event) => placeTip(lines, event.clientX, event.clientY));
      hit.addEventListener("pointerleave", () => {
        tip.hidden = true;
      });
      hit.addEventListener("pointerdown", (event) => {
        placeTip(lines, event.clientX, event.clientY);
        event.preventDefault();
      });
      svg.append(hit);
    });
  }

  const table = el("table", { class: "sr-only" }, [
    el("caption", { text: spec.label }),
    el("thead", {}, [
      el("tr", {}, [
        el("th", { text: "Player" }),
        ...categories.map((category) => el("th", { text: category })),
      ]),
    ]),
    el("tbody", {}, series.map((item) => el("tr", {}, [
      el("th", { scope: "row", text: item.name }),
      ...item.values.map((value, index) => {
        const kind = item.kinds[index];
        const text = kind === "carried"
          ? `${formatSigned(value)} (no recorded result)`
          : formatSigned(value);
        return el("td", { text });
      }),
    ]))),
  ]);

  const legend = el("div", { class: "legend" }, series.map((item) => {
    const latest = item.values[item.values.length - 1];
    const pressed = spec.activeId === item.id;
    return el("button", {
      type: "button",
      class: `legend-item${spec.activeId && !pressed ? " dim" : ""}`,
      "aria-pressed": pressed ? "true" : "false",
      onclick: () => spec.onToggle?.(item.id),
    }, [
      avatar({ name: item.name, photo: item.photo }),
      el("span", { class: "swatch", style: { background: item.color }, "aria-hidden": "true" }),
      el("span", { class: "legend-name", text: item.name }),
      el("span", { class: `num legend-net ${signedClass(latest)}`, text: formatSigned(latest) }),
    ]);
  }));

  host.replaceChildren(svg, tip, legend, table);
  } finally {
    host._drawing = false;
  }
}

export function refreshChart(host) {
  delete host.dataset.bucket;
  draw(host);
}

export function mountChart(host, spec) {
  host._spec = spec;
  delete host.dataset.bucket;
  draw(host);
  if (!host._ro) {
    host._ro = new ResizeObserver(() => draw(host));
    host._ro.observe(host);
  }
}

export function seriesFromPlayer(player, color) {
  return {
    id: player.id,
    name: player.name,
    color,
    photo: player.photo,
    values: player.points.map((point) => point.value),
    kinds: player.points.map((point) => point.kind),
    deltas: player.points.map((point) => point.delta),
  };
}
