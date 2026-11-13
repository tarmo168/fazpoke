import assert from "node:assert/strict";
import test from "node:test";

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.className = "";
    this.textContent = "";
    this.attributes = new Map();
    this.children = [];
    this.style = { setProperty() {} };
    this.dataset = {};
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  addEventListener() {}
}

globalThis.Node = class Node {};
globalThis.document = {
  createElement(tag) {
    return new FakeElement(tag);
  },
  createTextNode(text) {
    const node = new FakeElement("#text");
    node.textContent = String(text);
    return node;
  },
};

const { avatar } = await import("../js/dom.js");

test("a player with no photo gets a circle of their initial", () => {
  for (const person of [
    { id: "tae", name: "Tae" },
    { id: "tae", name: "Tae", photo: null },
    { id: "tae", name: "Tae", photo: "" },
  ]) {
    const node = avatar(person, "lb-photo");
    assert.equal(node.tagName, "SPAN");
    assert.equal(node.className, "avatar lb-photo avatar-fallback");
    assert.equal(node.textContent, "T");
    assert.equal(node.attributes.get("aria-hidden"), "true");
    assert.equal(node.attributes.has("src"), false);
  }
});

test("the same fallback is used on the live roster, pad, and session row", () => {
  const person = { id: "tae", name: "Tae" };
  for (const className of ["lb-photo", "lb-join-photo", "lb-pad-photo", "hero-photo dim", ""]) {
    const node = avatar(person, className);
    assert.equal(node.tagName, "SPAN");
    assert.equal(node.textContent, "T");
    assert.match(node.className, /(^| )avatar-fallback($| )/);
    assert.equal(node.className.includes("avatar"), true);
  }
});

test("a player with a photo still uses an image", () => {
  const node = avatar({ id: "taam", name: "Taam", photo: "assets/players/taam.png" }, "lb-photo");
  assert.equal(node.tagName, "IMG");
  assert.equal(node.className, "avatar lb-photo");
  assert.equal(node.attributes.get("src"), "assets/players/taam.png");
  assert.equal(node.textContent, "");
});

test("a missing name falls back to a question mark", () => {
  const node = avatar({});
  assert.equal(node.tagName, "SPAN");
  assert.equal(node.textContent, "?");
});
