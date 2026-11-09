export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset" && typeof value === "object") {
      for (const [name, data] of Object.entries(value)) node.dataset[name] = data;
    } else if (key === "style" && typeof value === "object") {
      Object.assign(node.style, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "text") {
      node.textContent = String(value);
    } else {
      node.setAttribute(key, value === true ? "" : String(value));
    }
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function avatar(person, className = "") {
  const classes = ["avatar", className].filter(Boolean).join(" ");
  if (!person?.photo) {
    const initial = (person?.name || "?").slice(0, 1);
    return el("span", { class: `${classes} avatar-fallback`, "aria-hidden": "true", text: initial });
  }
  return el("img", {
    class: classes,
    src: person.photo,
    alt: "",
    width: "76",
    height: "76",
  });
}
