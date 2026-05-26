import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, onSnapshot, collection,
  addDoc, query, orderBy, serverTimestamp
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
  renderShare(data);
  subscribeCheckins(code);
  wireCheckinForm(code, data);
}

function renderShare(data) {
  $("pet-card").classList.remove("hidden");
  $("pet-emoji").textContent = data.petEmoji || "🐾";
  $("pet-name").textContent = data.petName || "Pet";
  const subParts = [data.petSpecies, data.petBreed, data.petAge].filter(Boolean);
  $("pet-sub").textContent = subParts.join(" · ");

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

  // Meds
  const meds = data.medications || [];
  if (meds.length > 0) {
    $("meds").classList.remove("hidden");
    const list = $("meds-list");
    list.innerHTML = "";
    meds.forEach((m) => {
      const row = document.createElement("div");
      row.className = "med-row";
      row.innerHTML = `
        <div class="med-title">${escapeHtml(m.title || "")}</div>
        <div class="med-sub">${escapeHtml([m.notes, m.nextDue ? "next due " + m.nextDue : null].filter(Boolean).join(" · "))}</div>
      `;
      list.appendChild(row);
    });
  }

  // Contacts
  const contacts = [
    ["Vet", data.vetContact],
    ["Emergency", data.emergencyContact]
  ].filter((p) => p[1]);
  if (contacts.length > 0) {
    $("contacts").classList.remove("hidden");
    const list = $("contacts-list");
    list.innerHTML = "";
    contacts.forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "contact-row";
      row.innerHTML = `
        <div class="contact-label">${label}</div>
        <div class="contact-value">${linkify(escapeHtml(value))}</div>
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
      await postCheckin(code, `Fed ${f.portion} (${f.time})`, "feeding");
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

async function postCheckin(code, text, kind) {
  try {
    await addDoc(collection(db, "shares", code, "checkins"), {
      text,
      kind,
      at: serverTimestamp()
    });
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
      row.innerHTML = `${escapeHtml(v.text || "")} <span class="checkin-time">${when}</span>`;
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

function linkify(s) {
  // Make phone numbers tap-to-call. Naive: matches +country and 7+ digit sequences.
  return s.replace(/(\+?\d[\d\s\-]{6,}\d)/g, (m) => `<a href="tel:${m.replace(/\s/g, "")}">${m}</a>`);
}
