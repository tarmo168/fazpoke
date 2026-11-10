import { el } from "./dom.js";
import {
  formatInviteText,
  isInviteDateAllowed,
  lineTextShareUrl,
  nextUpcomingDate,
} from "./share.js";

let dialog = null;
let opener = null;

function field(name) {
  return dialog?.querySelector(`[name="${name}"]`) || null;
}

function inviteFields() {
  return {
    isoDate: field("date")?.value || "",
    time: field("time")?.value || "",
    location: field("location")?.value || "",
  };
}

function inviteMessage() {
  const fields = inviteFields();
  if (!isInviteDateAllowed(fields.isoDate)) return "";
  return formatInviteText(fields);
}

function setNote(kind, text) {
  const node = dialog?.querySelector(kind === "error" ? ".invite-error" : ".invite-status");
  if (node) node.textContent = text;
  const other = dialog?.querySelector(kind === "error" ? ".invite-status" : ".invite-error");
  if (other) other.textContent = "";
}

function syncPreview() {
  if (!dialog) return;
  const text = inviteMessage();
  const preview = dialog.querySelector(".invite-preview");
  const send = dialog.querySelector("[data-invite-send]");
  if (preview) preview.textContent = text;
  if (send) {
    if (text) send.href = lineTextShareUrl(text);
    else send.removeAttribute("href");
  }
  const error = dialog.querySelector(".invite-error");
  if (error?.textContent && text) error.textContent = "";
  const status = dialog.querySelector(".invite-status");
  if (status) status.textContent = "";
  const fallback = dialog.querySelector(".invite-fallback");
  if (fallback && document.activeElement !== fallback) fallback.hidden = true;
}

function showFallback(text) {
  const box = dialog?.querySelector(".invite-fallback");
  if (!box) return;
  box.hidden = false;
  box.value = text;
  box.focus();
  box.select();
}

async function copyInvite() {
  const text = inviteMessage();
  if (!text) {
    setNote("error", "Pick today or a later date.");
    field("date")?.focus();
    return;
  }
  try {
    if (!navigator.clipboard?.writeText) throw new Error("unavailable");
    await navigator.clipboard.writeText(text);
    const box = dialog.querySelector(".invite-fallback");
    if (box) box.hidden = true;
    setNote("status", "Copied.");
  } catch {
    setNote("status", "Copy the message below.");
    showFallback(text);
  }
}

function onSendClick(event) {
  const text = inviteMessage();
  if (!text) {
    event.preventDefault();
    setNote("error", "Pick today or a later date.");
    field("date")?.focus();
    return;
  }
  event.currentTarget.href = lineTextShareUrl(text);
}

function ensureDialog() {
  if (dialog) return dialog;
  const today = nextUpcomingDate();
  dialog = el("dialog", {
    class: "invite-dialog",
    "aria-labelledby": "invite-title",
  }, [
    el("div", { class: "invite-card" }, [
      el("div", { class: "invite-head" }, [
        el("div", {}, [
          el("p", { class: "section-kicker", text: "Game night" }),
          el("h2", { id: "invite-title", text: "Who's in?" }),
        ]),
        el("button", {
          type: "button",
          class: "invite-close",
          "aria-label": "Close",
          onclick: () => closeInvite(),
        }, "Close"),
      ]),
      el("p", {
        class: "note",
        text: "Pick a date. Time and location are optional. Send the note to LINE, or copy it.",
      }),
      el("div", { class: "invite-fields" }, [
        el("label", {}, [
          el("span", { text: "Date" }),
          el("input", {
            type: "date",
            name: "date",
            required: true,
            min: today,
            value: today,
            oninput: syncPreview,
            onchange: syncPreview,
          }),
        ]),
        el("label", {}, [
          el("span", { text: "Time" }),
          el("input", {
            type: "text",
            name: "time",
            maxlength: "40",
            placeholder: "8:30 pm",
            autocomplete: "off",
            spellcheck: "false",
            oninput: syncPreview,
          }),
        ]),
        el("label", {}, [
          el("span", { text: "Location" }),
          el("input", {
            type: "text",
            name: "location",
            maxlength: "80",
            placeholder: "Where",
            autocomplete: "off",
            oninput: syncPreview,
          }),
        ]),
      ]),
      el("p", { class: "invite-preview" }),
      el("p", { class: "invite-error", role: "alert" }),
      el("p", { class: "invite-status", role: "status" }),
      el("textarea", {
        class: "invite-fallback",
        hidden: true,
        readonly: true,
        rows: "6",
        "aria-label": "Invite to copy",
        spellcheck: "false",
      }),
      el("div", { class: "invite-actions" }, [
        el("a", {
          class: "line-share",
          target: "_blank",
          rel: "noopener noreferrer",
          dataset: { inviteSend: "true" },
          onclick: onSendClick,
        }, "Send to LINE"),
        el("button", {
          type: "button",
          class: "bar-btn",
          onclick: () => { void copyInvite(); },
        }, "Copy"),
      ]),
    ]),
  ]);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeInvite();
  });
  dialog.addEventListener("close", () => {
    delete document.body.dataset.inviteOpen;
    const back = opener;
    opener = null;
    if (back?.isConnected) back.focus();
  });
  document.body.append(dialog);
  syncPreview();
  return dialog;
}

export function closeInvite() {
  if (!dialog?.open) return;
  dialog.close();
}

export function openInvite(trigger) {
  const node = ensureDialog();
  opener = trigger instanceof Element ? trigger : null;
  const date = field("date");
  const today = nextUpcomingDate();
  if (date) {
    date.min = today;
    if (!isInviteDateAllowed(date.value)) date.value = today;
  }
  syncPreview();
  document.body.dataset.inviteOpen = "true";
  if (!node.open) node.showModal();
  date?.focus();
}
