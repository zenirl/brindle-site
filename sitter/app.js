import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, onSnapshot, collection,
  addDoc, updateDoc, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
  projectId: "petlog-zenirl",
  appId: "1:58379539974:web:72c5211f8410da63569587",
  storageBucket: "petlog-zenirl.firebasestorage.app",
  apiKey: "AIzaSyBOWN8e4_01GOvsuXTQX9Pn4EohECl0ncQ",
  authDomain: "petlog-zenirl.firebaseapp.com",
  messagingSenderId: "58379539974"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const setStatus = (msg) => { $("status").textContent = msg; };

const params = new URLSearchParams(location.search);
const code = (params.get("code") || "").trim().toUpperCase();

// Stable per-share key so the same browser/session reuses the sitter's name.
const NAME_KEY = (code) => `brindle.sitterName.${code}`;
const WALK_KEY = (code) => `brindle.walkSession.${code}`;
const MEDS_DONE_KEY = (code) => `brindle.medsDone.${code}`;

function sitterName() {
  return localStorage.getItem(NAME_KEY(code)) || "";
}
function setSitterName(v) {
  if (v) localStorage.setItem(NAME_KEY(code), v);
}

if (!code) {
  showError("No share code", "Open the link from the owner's app — it should end with ?code=XXXXXXXX.");
} else {
  setStatus(`Code · ${code}`);
  signInAnonymously(auth).catch((e) => {
    console.error(e);
    showError("Sign-in failed", e.message || "Try refreshing.");
  });
  onAuthStateChanged(auth, (user) => {
    if (user) loadShare(code);
  });
}

function showError(title, body) {
  $("error-title").textContent = title;
  $("error-body").textContent = body;
  $("error").classList.remove("hidden");
}

async function loadShare(code) {
  const ref = doc(db, "shares", code);
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (e) {
    console.error(e);
    showError("Couldn't reach Brindle", "Check your connection and try again.");
    return;
  }
  if (!snap.exists()) {
    showError("Share not found", "Double-check the code with the owner.");
    return;
  }
  const data = snap.data();
  const now = Date.now();
  const expires = data.expiresAt?.toMillis ? data.expiresAt.toMillis() : null;
  if (expires && now > expires) {
    showError("This share expired", "Ask the owner to send a new link from the app.");
    return;
  }
  // Name is mandatory — gate the rest of the page until the sitter submits
  // one. Without this people scroll past the prompt and post check-ins
  // anonymously, which defeats the whole point of attribution.
  await requireSitterName(data);
  renderShare(data);
  subscribeCheckins(code);
  wireCheckinForm(code, data);
  wireWalkButtons(code, data);
  wireQuickChips(code);
  wirePhotoButton(code);
  subscribeShareLifecycle(code);
  startPresenceHeartbeat(code);
}

/**
 * Presence heartbeat: write shares/{code}.lastSeen = serverTimestamp() once
 * on load and every 60s while the tab is visible. The owner app reads this
 * to show "here now" vs "last seen Xm ago" in the Today banner.
 *
 * Firestore rule (deployed): any signed-in user may update the share doc
 * IF the only field affected is `lastSeen`. So this is safe — sitters can't
 * touch pet data, expiry, ownership, etc.
 */
let heartbeatHandle = null;
function startPresenceHeartbeat(code) {
  const ref = doc(db, "shares", code);
  const ping = () => {
    if (lifecycleStopped) return;
    if (document.hidden) return;
    updateDoc(ref, { lastSeen: serverTimestamp() }).catch((err) => {
      // Silent — a permission error here means the share was revoked
      // while we were sitting on the page; subscribeShareLifecycle will
      // handle the visible side of that.
      console.warn("presence ping failed", err?.code || err);
    });
  };
  ping(); // immediate first ping
  heartbeatHandle = setInterval(ping, 60_000);
  // Stop when the share ends — enterRevokedState() reads this handle.
  // Resume immediate ping when tab regains visibility.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) ping();
  });
}

/**
 * Live-watch the parent share doc. The owner can revoke at any time (deletes
 * the doc) or the share can expire while we're sitting on the page. In both
 * cases we need to clearly tell the sitter that further actions won't be
 * received, and stop them from posting more orphan check-ins.
 */
let lifecycleStopped = false;
function subscribeShareLifecycle(code) {
  const ref = doc(db, "shares", code);
  onSnapshot(ref, (snap) => {
    if (lifecycleStopped) return;
    if (!snap.exists()) {
      enterRevokedState("Owner ended this share", "Thanks for looking after them! You can close this page — anything you logged is already saved.");
      return;
    }
    const data = snap.data();
    const expires = data.expiresAt?.toMillis ? data.expiresAt.toMillis() : null;
    if (expires && Date.now() > expires) {
      enterRevokedState("This share expired", "Ask the owner to send a fresh link if you still need access.");
    }
  }, (err) => {
    // Permission errors after a revoke can land here. Treat as revoked.
    console.warn("share lifecycle error", err);
    enterRevokedState("Owner ended this share", "Thanks for looking after them! You can close this page.");
  });
}

function enterRevokedState(title, body) {
  if (lifecycleStopped) return;
  lifecycleStopped = true;
  if (heartbeatHandle) { clearInterval(heartbeatHandle); heartbeatHandle = null; }
  // Hide all the interactive sections so the sitter can't post any more.
  ["today", "meds", "walk", "check-ins"].forEach((id) => {
    const el = $(id);
    if (el) el.classList.add("hidden");
  });
  // Leave emergency contacts visible — vet info might still be useful if
  // the sitter is physically with the pet.
  setStatus("Share ended");
  const banner = document.createElement("section");
  banner.className = "card revoked-banner";
  banner.innerHTML = `
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(body)}</p>
  `;
  const root = $("root");
  // Insert near the top, right after the header / before pet card.
  root.insertBefore(banner, $("pet-card"));
}

function requireSitterName(data) {
  return new Promise((resolve) => {
    if (sitterName()) {
      renderNameBadge();
      resolve();
      return;
    }
    // Inline blocking prompt. While it's shown, the other sections stay
    // .hidden so the sitter can't interact with anything until they
    // identify themselves.
    const card = document.createElement("section");
    card.className = "card name-prompt";
    card.innerHTML = `
      <h2>Who's sitting?</h2>
      <p class="small muted">${escapeHtml(data.petName || "the pet")}'s owner will see your name on every check-in. Required so they know who did what.</p>
      <form id="name-form" autocomplete="off">
        <input type="text" id="name-input" placeholder="Your first name" maxlength="40" required autofocus />
        <button type="submit">Continue</button>
      </form>
    `;
    $("root").insertBefore(card, $("pet-card"));
    $("name-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = $("name-input").value.trim();
      if (!v) return;
      setSitterName(v);
      card.remove();
      renderNameBadge();
      resolve();
    });
  });
}

function renderNameBadge() {
  const name = sitterName();
  if (!name) return;
  let badge = $("sitter-badge");
  if (!badge) {
    badge = document.createElement("button");
    badge.id = "sitter-badge";
    badge.className = "sitter-badge";
    badge.type = "button";
    badge.title = "Change name";
    $("header").appendChild(badge);
    badge.addEventListener("click", () => {
      const next = prompt("Your name", name);
      if (next && next.trim()) {
        setSitterName(next.trim());
        renderNameBadge();
      }
    });
  }
  badge.textContent = `👤 ${name}`;
}

function renderShare(data) {
  $("pet-card").classList.remove("hidden");
  $("pet-emoji").textContent = data.petEmoji || "🐾";
  $("pet-name").textContent = data.petName || "Pet";
  const subParts = [data.petSpecies, data.petBreed, data.petAge].filter(Boolean);
  $("pet-sub").textContent = subParts.join(" · ");

  // Emergency / vet contacts — render as big tap-to-call buttons up top.
  renderEmergencyButtons(data);

  // Feedings
  const feedingsEl = $("feedings");
  const feedings = data.feedings || [];
  if (feedings.length > 0) {
    $("today").classList.remove("hidden");
    feedingsEl.innerHTML = "";
    feedings.forEach((f, i) => {
      const row = document.createElement("div");
      row.className = "feed-row";
      row.dataset.idx = i;
      row.innerHTML = `
        <div class="feed-time">${escapeHtml(f.time || "")}</div>
        <div class="feed-body">
          <div class="feed-portion">${escapeHtml(f.portion || "")}</div>
          <div class="feed-sub">${escapeHtml([f.foodName, f.days].filter(Boolean).join(" · "))}</div>
        </div>
        <button class="feed-btn" data-feed="${i}">✓ Fed</button>
      `;
      feedingsEl.appendChild(row);
    });
  }

  // Meds — now with check buttons like feedings
  const meds = data.medications || [];
  if (meds.length > 0) {
    $("meds").classList.remove("hidden");
    const list = $("meds-list");
    list.innerHTML = "";
    const done = JSON.parse(localStorage.getItem(MEDS_DONE_KEY(code)) || "{}");
    meds.forEach((m, i) => {
      const key = `${i}-${m.title}`;
      const isDone = !!done[key];
      const row = document.createElement("div");
      row.className = "med-row" + (isDone ? " done" : "");
      row.innerHTML = `
        <div class="med-body">
          <div class="med-title">${escapeHtml(m.title || "")}</div>
          <div class="med-sub">${escapeHtml([m.notes, m.nextDue ? "next due " + m.nextDue : null].filter(Boolean).join(" · "))}</div>
        </div>
        <button class="med-btn" data-med="${i}" data-key="${escapeAttr(key)}" ${isDone ? "disabled" : ""}>
          ${isDone ? "✓ Given" : "Give"}
        </button>
      `;
      list.appendChild(row);
    });
  }

  // Behavior
  if (data.behaviorNotes) {
    $("behavior").classList.remove("hidden");
    $("behavior-text").textContent = data.behaviorNotes;
  }

  // Check-ins section visible once share is loaded
  $("check-ins").classList.remove("hidden");

  // Walk control visible once share is loaded
  $("walk").classList.remove("hidden");
  paintWalkButton();
}

function renderEmergencyButtons(data) {
  const contacts = [
    { label: "Call owner", value: data.ownerPhone, kind: "owner" },
    { label: "Vet", value: data.vetContact, kind: "vet" },
    { label: "Emergency", value: data.emergencyContact, kind: "emergency" }
  ].filter((c) => c.value);
  if (contacts.length === 0) return;

  $("contacts").classList.remove("hidden");
  const list = $("contacts-list");
  list.innerHTML = "";
  contacts.forEach((c) => {
    const phone = extractPhone(c.value);
    const row = document.createElement("a");
    row.className = "call-btn call-" + c.kind;
    if (phone) {
      row.href = `tel:${phone}`;
    } else {
      row.classList.add("call-noop");
    }
    row.innerHTML = `
      <span class="call-label">${escapeHtml(c.label)}</span>
      <span class="call-value">${linkify(escapeHtml(c.value))}</span>
    `;
    list.appendChild(row);
  });
}

function extractPhone(s) {
  const m = String(s).match(/(\+?\d[\d\s\-]{6,}\d)/);
  return m ? m[1].replace(/\s/g, "") : null;
}

function wireCheckinForm(code, data) {
  document.querySelectorAll(".feed-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const i = parseInt(btn.dataset.feed, 10);
      const f = (data.feedings || [])[i];
      if (!f) return;
      btn.disabled = true;
      btn.textContent = "✓ Done";
      btn.closest(".feed-row").classList.add("done");
      await postCheckin(code, `Fed ${f.portion} (${f.time})`, "feeding", {
        feedingId: f.id || null
      });
    });
  });

  document.querySelectorAll(".med-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const i = parseInt(btn.dataset.med, 10);
      const m = (data.medications || [])[i];
      if (!m) return;
      btn.disabled = true;
      btn.textContent = "✓ Given";
      btn.closest(".med-row").classList.add("done");
      const done = JSON.parse(localStorage.getItem(MEDS_DONE_KEY(code)) || "{}");
      done[btn.dataset.key] = Date.now();
      localStorage.setItem(MEDS_DONE_KEY(code), JSON.stringify(done));
      await postCheckin(code, `Gave ${m.title}`, "medication");
    });
  });

  $("custom-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = $("custom-input").value.trim();
    if (!v) return;
    $("custom-input").value = "";
    await postCheckin(code, v, "note");
  });
}

function wireQuickChips(code) {
  document.querySelectorAll(".quick-chip").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = btn.dataset.text;
      const kind = btn.dataset.kind || "note";
      if (!text) return;
      btn.classList.add("flashed");
      setTimeout(() => btn.classList.remove("flashed"), 400);
      await postCheckin(code, text, kind);
    });
  });
}

function activeWalk() {
  try {
    return JSON.parse(localStorage.getItem(WALK_KEY(code)) || "null");
  } catch { return null; }
}
function setActiveWalk(v) {
  if (v) localStorage.setItem(WALK_KEY(code), JSON.stringify(v));
  else localStorage.removeItem(WALK_KEY(code));
}

let walkTimerHandle = null;

function paintWalkButton() {
  const btn = $("walk-btn");
  const status = $("walk-status");
  if (!btn) return;
  const w = activeWalk();
  if (w) {
    btn.textContent = "■ End walk";
    btn.classList.add("walking");
    if (!walkTimerHandle) {
      walkTimerHandle = setInterval(() => {
        const secs = Math.max(0, Math.floor((Date.now() - w.startedAt) / 1000));
        const mm = Math.floor(secs / 60);
        const ss = String(secs % 60).padStart(2, "0");
        status.textContent = `Walking · ${mm}:${ss}`;
      }, 1000);
    }
  } else {
    btn.textContent = "▶ Start walk";
    btn.classList.remove("walking");
    if (walkTimerHandle) { clearInterval(walkTimerHandle); walkTimerHandle = null; }
    status.textContent = "";
  }
}

function wireWalkButtons(code, data) {
  const btn = $("walk-btn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const w = activeWalk();
    if (!w) {
      const id = "w-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
      const startedAt = Date.now();
      setActiveWalk({ id, startedAt });
      paintWalkButton();
      await postCheckin(code, `Started walk`, "walk_start", { walkSessionId: id });
    } else {
      const mins = Math.max(1, Math.round((Date.now() - w.startedAt) / 60000));
      setActiveWalk(null);
      paintWalkButton();
      await postCheckin(code, `Finished walk · ${mins} min`, "walk_end", {
        walkSessionId: w.id,
        walkDurationMin: mins
      });
    }
  });
}

// ── Photo updates ───────────────────────────────────────────────────────────
// Sitters can send a quick photo. We downscale + JPEG-compress it in the
// browser to a small base64 string stored inline on the check-in doc — no
// Firebase Storage, no extra cost, and it stays well under Firestore's ~1 MB
// doc ceiling (the security rule rejects a `photo` field >= 900 000 chars).
const PHOTO_CAP = 880_000;

function setPhotoStatus(msg) {
  const el = $("photo-status");
  if (el) el.textContent = msg;
}

function wirePhotoButton(code) {
  // Two inputs so the sitter gets both options: the camera one carries the
  // `capture` hint (opens the camera), the gallery one omits it (opens the
  // OS photo picker / file chooser). Both feed the same upload handler.
  wireOnePhotoInput(code, "photo-camera-btn", "photo-input-camera");
  wireOnePhotoInput(code, "photo-gallery-btn", "photo-input-gallery");
}

function wireOnePhotoInput(code, btnId, inputId) {
  const btn = $(btnId);
  const input = $(inputId);
  if (!btn || !input) return;
  btn.addEventListener("click", () => { if (!lifecycleStopped) input.click(); });
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    input.value = ""; // let the sitter re-pick the same file later
    if (!file) return;
    btn.disabled = true;
    setPhotoStatus("Preparing photo…");
    try {
      // Try a reasonable size first, then fall back smaller if over the cap.
      let b64 = await downscaleToBase64(file, 1024, 0.7);
      if (b64 && b64.length >= PHOTO_CAP) b64 = await downscaleToBase64(file, 800, 0.55);
      if (b64 && b64.length >= PHOTO_CAP) b64 = await downscaleToBase64(file, 640, 0.5);
      if (!b64) { setPhotoStatus("Couldn't read that image."); return; }
      if (b64.length >= PHOTO_CAP) { setPhotoStatus("Photo too large — try another."); return; }
      await postCheckin(code, "📷 Sent a photo", "photo", { photo: b64 });
      setPhotoStatus("Photo sent ✓");
    } catch (e) {
      console.error(e);
      setPhotoStatus("Couldn't send photo.");
    } finally {
      btn.disabled = false;
    }
  });
}

/** Draw the image to a canvas at <= maxDim on its long edge and return raw
 *  base64 JPEG (no data: prefix — the owner app decodes it directly). */
function downscaleToBase64(file, maxDim, quality) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : null);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

async function postCheckin(code, text, kind, extra = {}) {
  try {
    const name = sitterName();
    const docData = { text, kind, at: serverTimestamp() };
    if (name) docData.sitterName = name;
    Object.entries(extra).forEach(([k, v]) => { if (v != null) docData[k] = v; });
    await addDoc(collection(db, "shares", code, "checkins"), docData);
    setStatus("Saved · " + new Date().toLocaleTimeString());
  } catch (e) {
    console.error(e);
    setStatus("Couldn't save — check connection.");
  }
}

function subscribeCheckins(code) {
  const q = query(collection(db, "shares", code, "checkins"), orderBy("at", "desc"));
  onSnapshot(q, (snap) => {
    const list = $("checkin-list");
    list.innerHTML = "";
    snap.forEach((d) => {
      const v = d.data();
      const row = document.createElement("div");
      row.className = "checkin";
      const when = v.at?.toDate ? v.at.toDate().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
      const who = v.sitterName ? `<span class="checkin-who">${escapeHtml(v.sitterName)}</span> ` : "";
      if (v.kind === "photo" && v.photo) {
        // base64 is [A-Za-z0-9+/=] only, safe to drop into the src attribute.
        row.innerHTML = `${who}<span class="checkin-time">${when}</span>` +
          `<img class="checkin-photo" src="data:image/jpeg;base64,${v.photo}" alt="Photo from sitter" loading="lazy" />`;
      } else {
        row.innerHTML = `${who}${escapeHtml(v.text || "")} <span class="checkin-time">${when}</span>`;
      }
      list.appendChild(row);
    });
    if (snap.empty) {
      list.innerHTML = `<div class="muted small">No check-ins yet. Use ✓ Fed buttons above or type a note.</div>`;
    }
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

function linkify(s) {
  // Make phone numbers tap-to-call. Naive: matches +country and 7+ digit sequences.
  return s.replace(/(\+?\d[\d\s\-]{6,}\d)/g, (m) => `<a href="tel:${m.replace(/\s/g, "")}">${m}</a>`);
}
