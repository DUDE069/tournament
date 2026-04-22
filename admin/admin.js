// =============================================================================
//  NPC Esports — admin.js  (v2 — full rewrite)
// =============================================================================

import { db, auth } from './firebase.js';
import {
  collection, collectionGroup, addDoc, deleteDoc,
  doc, onSnapshot, query, orderBy, serverTimestamp,
  where, getDocs, updateDoc, getDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ---------------------------------------------------------------------------
//  Listeners map — clean teardown on logout
// ---------------------------------------------------------------------------
const _listeners = {
  badge:         null,
  verifications: null,
  registrations: null,
  tournaments:   null,
  calendar:      null,
};

function teardownAllListeners() {
  Object.values(_listeners).forEach(unsub => { if (unsub) unsub(); });
  Object.keys(_listeners).forEach(k => _listeners[k] = null);
}

// ---------------------------------------------------------------------------
//  Shared refs
// ---------------------------------------------------------------------------
const tournamentsRef = collection(db, "tournaments");
const calendarRef    = collection(db, "calendarEvents");

let currentFieldStatuses = {};

// ============================================================================
//  1. AUTH GUARD
// ============================================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) { showLoginUI(); return; }

  const userSnap = await getDoc(doc(db, "users", user.uid));
  if (!userSnap.exists() || userSnap.data().isAdmin !== true) {
    showToast("Access denied: not an admin account.", "error");
    await signOut(auth);
    showLoginUI();
    return;
  }

  showAdminUI();
  initAdminListeners();
});

function showLoginUI() {
  teardownAllListeners();
  document.getElementById("loginSection").style.display = "block";
  document.getElementById("adminPanel").style.display   = "none";
}
function showAdminUI() {
  document.getElementById("loginSection").style.display = "none";
  document.getElementById("adminPanel").style.display   = "block";
}

function initAdminListeners() {
  startBadgeListener();
  loadTournaments();
  loadCalendarEvents();
}

// ============================================================================
//  2. BADGE LISTENERS
// ============================================================================
function startBadgeListener() {
  if (_listeners.badge) return;

  // --- Ongoing Applications badge (verifications pending) ---
  const vQuery = query(collectionGroup(db, "verifications"), where("status", "==", "pending"));
  _listeners.badge = onSnapshot(vQuery, (snap) => {
    snap.docChanges().forEach(c => { if (c.type === "added") playAdminAlert(); });
    updateTabBadge("verificationBadge", snap.size);
  }, err => {
    console.error("Badge listener error:", err.message);
    if (err.code === "permission-denied") signOut(auth);
  });

  // --- Registrations badge (upcoming pending) ---
  const rQuery = query(collectionGroup(db, "upcomingRegistrations"), where("status", "==", "pending"));
  onSnapshot(rQuery, (snap) => {
    updateTabBadge("registrationBadge", snap.size);
  });
}

function updateTabBadge(badgeId, count) {
  const badge = document.getElementById(badgeId);
  if (!badge) return;
  badge.textContent    = count;
  badge.style.display  = count > 0 ? "inline-block" : "none";
}

// ============================================================================
//  3. TAB NAVIGATION
// ============================================================================
window.currentTab = "tournaments";

window.showTab = function(tabName) {
  window.currentTab = tabName;

  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelector(`[onclick="showTab('${tabName}')"]`)?.classList.add("active");

  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));

  const sectionMap = {
    tournaments:   "tournamentsSection",
    calendar:      "calendarSection",
    verifications: "verificationsSection",
    registrations: "registrationsSection",
  };
  document.getElementById(sectionMap[tabName])?.classList.add("active");

  if (tabName === "verifications") {
    loadVerifications();
  } else {
    if (_listeners.verifications) { _listeners.verifications(); _listeners.verifications = null; }
  }

  if (tabName === "registrations") {
    loadUpcomingRegistrations();
  } else {
    if (_listeners.registrations) { _listeners.registrations(); _listeners.registrations = null; }
  }
};

// ============================================================================
//  4. ONGOING APPLICATIONS  (was "Verifications")
//     Three partitions: NEW · ACCEPTED · REJECTED
// ============================================================================
function loadVerifications() {
  if (_listeners.verifications) { _listeners.verifications(); _listeners.verifications = null; }

  const container = document.getElementById("verificationList");
  if (!container) return;
  container.innerHTML = '<p class="loading-text">Loading applications…</p>';

  // Listen to ALL statuses so we can show accepted/rejected history too
  const q = query(
    collectionGroup(db, "verifications"),
    orderBy("submittedAt", "desc")
  );

  _listeners.verifications = onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach(c => {
      if (c.type === "added" && c.doc.data().status === "pending") playAdminAlert();
    });
    renderVerificationList(snapshot);
  }, err => {
    container.innerHTML = `<p style="color:var(--red);padding:20px;">Error: ${err.message}</p>`;
  });
}

function renderVerificationList(snapshot) {
  const container = document.getElementById("verificationList");
  if (!container) return;

  const pending  = [];
  const accepted = [];
  const rejected = [];

  snapshot.forEach(vDoc => {
    const d = { id: vDoc.id, tournamentId: vDoc.ref.parent.parent.id, ...vDoc.data() };
    if (d.status === "pending")  pending.push(d);
    else if (d.status === "approved") accepted.push(d);
    else if (d.status === "rejected") rejected.push(d);
  });

  if (pending.length === 0 && accepted.length === 0 && rejected.length === 0) {
    container.innerHTML = `<div class="empty-state"><span class="emoji">✅</span>No applications yet.</div>`;
    return;
  }

  let html = "";

  // ── NEW ──────────────────────────────────────────
  html += partition("new", `🆕 New Applications (${pending.length})`);
  if (pending.length === 0) {
    html += `<div class="empty-state" style="padding:16px 0;"><span style="color:var(--muted);font-size:13px;">No pending applications</span></div>`;
  } else {
    pending.forEach(d => { html += applicationCard(d, "new"); });
  }

  // ── ACCEPTED ─────────────────────────────────────
  html += partition("accepted", `✅ Accepted (${accepted.length})`);
  if (accepted.length === 0) {
    html += `<div class="empty-state" style="padding:16px 0;"><span style="color:var(--muted);font-size:13px;">No accepted applications</span></div>`;
  } else {
    accepted.forEach(d => { html += applicationCard(d, "accepted"); });
  }

  // ── REJECTED ─────────────────────────────────────
  html += partition("rejected", `❌ Rejected (${rejected.length})`);
  if (rejected.length === 0) {
    html += `<div class="empty-state" style="padding:16px 0;"><span style="color:var(--muted);font-size:13px;">No rejected applications</span></div>`;
  } else {
    rejected.forEach(d => { html += applicationCard(d, "rejected"); });
  }

  container.innerHTML = html;
}

function partition(type, label) {
  return `
    <div class="partition">
      <span class="partition-label ${type}">${label}</span>
      <div class="partition-line"></div>
    </div>`;
}

function applicationCard(d, type) {
  const pillClass = type === "new" ? "pill-new" : type === "accepted" ? "pill-accepted" : "pill-rejected";
  const pillLabel = type === "new" ? "PENDING" : type === "accepted" ? "APPROVED" : "REJECTED";

  let actions = "";
  if (type === "new") {
    actions = `<button class="btn-view" onclick="viewApplicationDetails('${d.tournamentId}','${d.id}')">View & Decide</button>`;
  } else if (type === "accepted") {
    actions = `
      <button class="btn-status" onclick="viewStatusModal('${d.tournamentId}','${d.id}')">📊 Status</button>
      <button class="btn-remove" onclick="removeApplication('${d.tournamentId}','${d.id}')">Remove</button>`;
  } else {
    actions = `
      <button class="btn-view"   onclick="viewApplicationDetails('${d.tournamentId}','${d.id}')">Review</button>
      <button class="btn-remove" onclick="removeApplication('${d.tournamentId}','${d.id}')">Remove</button>`;
  }

  return `
    <div class="app-card ${type}">
      <div class="app-card-info">
        <strong>${escHtml(d.teamName ?? "—")}</strong>
        <small>Leader: ${escHtml(d.leaderEmail ?? "—")}</small>
        <small style="color:var(--muted);font-size:11px;">Tournament: ${escHtml(d.tournamentId)}</small>
        ${d.rejectionNote ? `<small style="color:var(--red);">Reason: ${escHtml(d.rejectionNote)}</small>` : ""}
      </div>
      <div class="app-card-actions">
        <span class="status-pill ${pillClass}">${pillLabel}</span>
        ${actions}
      </div>
    </div>`;
}

// ============================================================================
//  5. STATUS MODAL  (for accepted applications)
// ============================================================================
window.viewStatusModal = async function(tournamentId, userId) {
  try {
    const [vSnap, pSnap] = await Promise.all([
      getDoc(doc(db, "tournaments", tournamentId, "verifications", userId)),
      getDoc(doc(db, "tournaments", tournamentId, "participants", userId)),
    ]);

    const v = vSnap.exists() ? vSnap.data() : {};
    const p = pSnap.exists() ? pSnap.data() : {};

    const processedAt = v.processedAt?.toDate?.()?.toLocaleString("en-IN") ?? "—";

    document.getElementById("statusModalOverlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "statusModalOverlay";
    overlay.className = "status-modal-overlay";
    overlay.innerHTML = `
      <div class="status-modal">
        <h3>📊 Team Status: ${escHtml(v.teamName ?? "—")}</h3>

        <div class="status-row">
          <span class="s-label">Verification</span>
          <span class="s-value" style="color:var(--green);">✅ Approved</span>
        </div>
        <div class="status-row">
          <span class="s-label">Approved At</span>
          <span class="s-value">${processedAt}</span>
        </div>
        <div class="status-row">
          <span class="s-label">Approved By</span>
          <span class="s-value">${escHtml(v.processedBy ?? "admin")}</span>
        </div>
        <div class="status-row">
          <span class="s-label">Payment Status</span>
          <span class="s-value" style="color:${p.paymentStatus === 'verified' ? 'var(--green)' : p.paymentStatus === 'rejected' ? 'var(--red)' : 'var(--gold)'};">
            ${p.paymentStatus ? p.paymentStatus.toUpperCase() : 'PENDING'}
          </span>
        </div>
        ${p.transactionCode ? `
        <div class="status-row">
          <span class="s-label">Transaction ID</span>
          <span class="s-value" style="font-family:'Share Tech Mono',monospace;color:var(--gold);">${escHtml(p.transactionCode)}</span>
        </div>` : ""}
        <div class="status-row">
          <span class="s-label">Team Members</span>
          <span class="s-value">${escHtml(Array.isArray(v.uids) ? v.uids.join(", ") : (v.uids ?? "—"))}</span>
        </div>
        <div class="status-row">
          <span class="s-label">Phone</span>
          <span class="s-value">${escHtml(v.phone ?? "—")}</span>
        </div>

        <div style="display:flex;gap:10px;margin-top:20px;">
          ${p.paymentStatus !== 'verified' ? `
          <button onclick="verifyPaymentDirect('${tournamentId}','${userId}',true)"
            style="flex:1;padding:10px;background:var(--green);color:#000;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-family:inherit;">
            ✓ Confirm Payment
          </button>
          <button onclick="verifyPaymentDirect('${tournamentId}','${userId}',false)"
            style="flex:1;padding:10px;background:var(--red);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-family:inherit;">
            ✗ Reject Payment
          </button>` : `<p style="color:var(--green);text-align:center;flex:1;">Payment Confirmed ✅</p>`}
        </div>

        <button onclick="document.getElementById('statusModalOverlay').remove()"
          style="width:100%;margin-top:12px;background:transparent;color:var(--muted);border:none;cursor:pointer;font-family:inherit;padding:8px;">
          Close
        </button>
      </div>`;

    document.body.appendChild(overlay);
  } catch (e) {
    showToast("Error loading status: " + e.message, "error");
  }
};

window.verifyPaymentDirect = async function(tournamentId, participantId, isVerified) {
  const status = isVerified ? "verified" : "rejected";
  try {
    await updateDoc(doc(db, "tournaments", tournamentId, "participants", participantId), {
      paymentStatus:     status,
      paymentVerifiedBy: auth.currentUser?.email ?? "admin",
      paymentVerifiedAt: serverTimestamp(),
    });
    document.getElementById("statusModalOverlay")?.remove();
    showToast(`Payment ${status}.`, isVerified ? "success" : "error");
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};

// Remove accepted/rejected application from the list (just sets status to archived)
window.removeApplication = async function(tournamentId, userId) {
  if (!confirm("Remove this application from the list?")) return;
  try {
    await updateDoc(doc(db, "tournaments", tournamentId, "verifications", userId), {
      archived: true,
      archivedAt: serverTimestamp(),
    });
    showToast("Application removed from list.", "success");
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};

// ============================================================================
//  6. VIEW & DECIDE MODAL  (approve / reject)
// ============================================================================
function fieldVerifyRow(label, value, fieldKey) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;background:#0f0f0f;padding:10px 14px;border-radius:8px;">
      <span style="color:var(--muted);font-size:13px;">${label}:
        <b style="color:#fff;margin-left:6px;">${escHtml(value ?? "—")}</b>
      </span>
      <div style="display:flex;gap:6px;">
        <button onclick="toggleField('${fieldKey}','ok')"  id="btn-${fieldKey}-ok"
          style="background:#333;color:var(--green);border:1px solid var(--green);width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:14px;">✓</button>
        <button onclick="toggleField('${fieldKey}','err')" id="btn-${fieldKey}-err"
          style="background:#333;color:var(--red);border:1px solid var(--red);width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:14px;">✗</button>
      </div>
    </div>`;
}

window.toggleField = function(field, status) {
  currentFieldStatuses[field] = status;
  const okBtn  = document.getElementById(`btn-${field}-ok`);
  const errBtn = document.getElementById(`btn-${field}-err`);
  if (okBtn)  { okBtn.style.background  = status === 'ok'  ? 'var(--green)' : '#333'; okBtn.style.color  = status === 'ok'  ? '#000' : 'var(--green)'; }
  if (errBtn) { errBtn.style.background = status === 'err' ? 'var(--red)'   : '#333'; errBtn.style.color = status === 'err' ? '#fff' : 'var(--red)'; }
};

window.viewApplicationDetails = async function(tournamentId, userId) {
  try {
    const docSnap = await getDoc(doc(db, "tournaments", tournamentId, "verifications", userId));
    if (!docSnap.exists()) { showToast("Application not found.", "error"); return; }

    const v = docSnap.data();
    document.getElementById("verifModal")?.remove();
    currentFieldStatuses = {};

    const uids = Array.isArray(v.uids) ? v.uids.join(", ") : (v.uids ?? "—");

    const modal = document.createElement("div");
    modal.id = "verifModal";
    modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;";
    modal.innerHTML = `
      <div style="background:var(--bg2);width:100%;max-width:560px;padding:28px;border-radius:14px;border:1px solid var(--border);max-height:90vh;overflow-y:auto;">
        <h2 style="color:var(--green);margin-bottom:6px;">Review Application</h2>
        <p style="color:var(--muted);font-size:13px;margin-bottom:20px;">Team: <b style="color:#fff;">${escHtml(v.teamName ?? "—")}</b></p>

        <div style="display:grid;gap:8px;">
          ${fieldVerifyRow("Leader Email", v.leaderEmail, "email")}
          ${fieldVerifyRow("Phone",        v.phone,       "phone")}
          ${fieldVerifyRow("Player UIDs",  uids,          "uids")}
          ${fieldVerifyRow("Team Code",    v.teamCode,    "code")}
        </div>

        <div style="margin-top:20px;">
          <label style="color:var(--muted);font-size:12px;letter-spacing:.5px;text-transform:uppercase;display:block;margin-bottom:8px;">
            Rejection Reason (required if rejecting)
          </label>
          <select id="reasonSelect" style="width:100%;padding:10px;background:#000;color:#fff;border:1px solid #444;border-radius:8px;margin-bottom:10px;font-family:inherit;">
            <option value="">-- Select Reason --</option>
            <option value="Invalid UID">❌ Invalid Player UID</option>
            <option value="Incorrect Phone">❌ Phone Number Wrong</option>
            <option value="Email Mismatch">❌ Email Mismatch</option>
            <option value="Blacklisted Team">🚫 Team is Blacklisted</option>
            <option value="Incomplete Info">⚠️ Insufficient Information</option>
            <option value="custom">✍️ Other (write below)</option>
          </select>
          <textarea id="adminNote" placeholder="Optional notes…"
            style="width:100%;height:60px;background:#000;color:#fff;border:1px solid #444;padding:10px;border-radius:8px;font-family:inherit;resize:vertical;"></textarea>
        </div>

        <div style="display:flex;gap:10px;margin-top:20px;">
          <button id="approveBtn" style="flex:1;background:var(--green);color:#000;border:none;padding:12px;font-weight:700;border-radius:8px;cursor:pointer;font-family:inherit;font-size:14px;">
            ✅ Approve Team
          </button>
          <button id="rejectBtn"  style="flex:1;background:var(--red);color:#fff;border:none;padding:12px;font-weight:700;border-radius:8px;cursor:pointer;font-family:inherit;font-size:14px;">
            ❌ Reject Team
          </button>
        </div>
        <button onclick="document.getElementById('verifModal').remove()"
          style="width:100%;margin-top:10px;background:transparent;color:var(--muted);border:none;cursor:pointer;font-family:inherit;padding:8px;">
          Cancel
        </button>
      </div>`;

    document.body.appendChild(modal);
    modal.querySelector("#approveBtn").addEventListener("click", () => processDecision(tournamentId, userId, "approved"));
    modal.querySelector("#rejectBtn").addEventListener("click",  () => processDecision(tournamentId, userId, "rejected"));
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};

// ============================================================================
//  7. PROCESS DECISION  (approve / reject + notify all teammates)
// ============================================================================
async function processDecision(tournamentId, userId, status) {
  const reasonSelect = document.getElementById("reasonSelect").value;
  const customNote   = document.getElementById("adminNote")?.value?.trim() ?? "";
  const finalReason  = reasonSelect === "custom" ? customNote : reasonSelect;

  if (status === "rejected" && !finalReason) {
    showToast("Please select or write a rejection reason.", "warning");
    return;
  }

  try {
    // 1. Update verification doc
    await updateDoc(doc(db, "tournaments", tournamentId, "verifications", userId), {
      status,
      rejectionNote:  finalReason,
      fieldStatus:    currentFieldStatuses,
      processedAt:    serverTimestamp(),
      processedBy:    auth.currentUser?.uid ?? "admin",
    });

    // 2. Find all teammates
    let allMemberIds = [userId];
    try {
      const applicantSnap = await getDoc(doc(db, "users", userId));
      if (applicantSnap.exists()) {
        const teamId = applicantSnap.data().teamId;
        if (teamId) {
          const teamSnap = await getDoc(doc(db, "teams", teamId));
          if (teamSnap.exists()) {
            const members = teamSnap.data().members ?? [];
            allMemberIds = [...new Set([...members, userId])];
          }
        }
      }
    } catch (lookupErr) {
      console.warn("Team lookup failed, notifying applicant only:", lookupErr.message);
    }

    // 3. Notify every member
    await Promise.all(
      allMemberIds.map(memberId =>
        addDoc(collection(db, "users", memberId, "notifications"), {
          type:        status === "approved" ? "approval" : "rejected",
          title:       status === "approved" ? "Application Approved!" : "Application Rejected",
          message:     memberId === userId
                         ? (status === "approved"
                             ? "Your team has been verified! ✅"
                             : `Your application was rejected. Reason: ${finalReason}`)
                         : (status === "approved"
                             ? "Your team's tournament application has been approved! ✅"
                             : `Your team's application was rejected. Reason: ${finalReason}`),
          tournamentId,
          actionLink:  `tournament=${tournamentId}`,
          read:        false,
          popupShown:  false,
          createdAt:   serverTimestamp(),
        })
      )
    );

    document.getElementById("verifModal")?.remove();
    showToast(
      status === "approved"
        ? `✅ Team approved! Notified ${allMemberIds.length} member(s).`
        : `❌ Team rejected. Notified ${allMemberIds.length} member(s).`,
      status === "approved" ? "success" : "error"
    );
  } catch (e) {
    console.error("Decision Error:", e);
    showToast("Error: " + e.message, "error");
  }
}

// ============================================================================
//  8. UPCOMING REGISTRATIONS TAB
// ============================================================================
function loadUpcomingRegistrations() {
  if (_listeners.registrations) { _listeners.registrations(); _listeners.registrations = null; }

  const container = document.getElementById("upcomingRegistrationsList");
  if (!container) return;
  container.innerHTML = '<p class="loading-text">Loading…</p>';

  const q = query(
    collectionGroup(db, "upcomingRegistrations"),
    orderBy("registeredAt", "desc")
  );

  _listeners.registrations = onSnapshot(q, (snapshot) => {
    const pending  = [];
    const approved = [];
    const rejected = [];

    snapshot.forEach(d => {
      const data = { id: d.id, tournamentId: d.ref.parent.parent.id, ...d.data() };
      if (data.status === "pending")  pending.push(data);
      else if (data.status === "approved") approved.push(data);
      else if (data.status === "rejected") rejected.push(data);
    });

    if (pending.length === 0 && approved.length === 0 && rejected.length === 0) {
      container.innerHTML = `<div class="empty-state"><span class="emoji">📋</span>No registrations yet.</div>`;
      return;
    }

    let html = "";

    html += partition("new", `🆕 New Registrations (${pending.length})`);
    if (pending.length === 0) {
      html += noItems();
    } else {
      pending.forEach(d => { html += upcomingCard(d, "new"); });
    }

    html += partition("accepted", `✅ Approved (${approved.length})`);
    if (approved.length === 0) { html += noItems(); }
    else { approved.forEach(d => { html += upcomingCard(d, "accepted"); }); }

    html += partition("rejected", `❌ Rejected (${rejected.length})`);
    if (rejected.length === 0) { html += noItems(); }
    else { rejected.forEach(d => { html += upcomingCard(d, "rejected"); }); }

    container.innerHTML = html;
  }, err => {
    container.innerHTML = `<p style="color:var(--red);padding:20px;">Error: ${err.message}</p>`;
  });
}

function noItems() {
  return `<div style="color:var(--muted);font-size:13px;padding:8px 0 16px;">— None —</div>`;
}

function upcomingCard(d, type) {
  const pillClass = type === "new" ? "pill-new" : type === "accepted" ? "pill-accepted" : "pill-rejected";
  const pillLabel = type === "new" ? "PENDING" : type === "accepted" ? "APPROVED" : "REJECTED";
  const eventDate = d.eventDate ? new Date(d.eventDate).toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" }) : "TBA";

  let actions = "";
  if (type === "new") {
    actions = `
      <button onclick="approveUpcoming('${d.tournamentId}','${d.id}')"
        style="background:var(--green);color:#000;border:none;padding:7px 16px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;">
        Approve
      </button>
      <button onclick="rejectUpcoming('${d.tournamentId}','${d.id}')"
        style="background:var(--red);color:#fff;border:none;padding:7px 16px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;">
        Reject
      </button>`;
  } else if (type === "accepted") {
    actions = `<button class="btn-remove" onclick="removeUpcoming('${d.tournamentId}','${d.id}')">Remove</button>`;
  } else {
    actions = `<button class="btn-remove" onclick="removeUpcoming('${d.tournamentId}','${d.id}')">Remove</button>`;
  }

  return `
    <div class="app-card ${type}">
      <div class="app-card-info">
        <strong>${escHtml(d.teamName ?? "—")}</strong>
        <small>Leader: ${escHtml(d.leaderEmail ?? "—")}</small>
        <small>📅 Event Date: ${eventDate}</small>
        ${d.rejectionReason ? `<small style="color:var(--red);">Reason: ${escHtml(d.rejectionReason)}</small>` : ""}
      </div>
      <div class="app-card-actions">
        <span class="status-pill ${pillClass}">${pillLabel}</span>
        ${actions}
      </div>
    </div>`;
}

window.approveUpcoming = async function(tournamentId, userId) {
  try {
    await updateDoc(doc(db, "tournaments", tournamentId, "upcomingRegistrations", userId), {
      status: "approved", processedAt: serverTimestamp(),
    });

    // Notify all team members
    let allMemberIds = [userId];
    try {
      const uSnap = await getDoc(doc(db, "users", userId));
      if (uSnap.exists() && uSnap.data().teamId) {
        const tSnap = await getDoc(doc(db, "teams", uSnap.data().teamId));
        if (tSnap.exists()) allMemberIds = [...new Set([...tSnap.data().members ?? [], userId])];
      }
    } catch (_) {}

    await Promise.all(allMemberIds.map(mid =>
      addDoc(collection(db, "users", mid, "notifications"), {
        type: "upcoming_approved",
        title: "Registration Approved!",
        message: "Your upcoming tournament registration has been approved! 🎉",
        tournamentId,
        read: false, popupShown: false, createdAt: serverTimestamp(),
      })
    ));

    showToast(`Registration approved! Notified ${allMemberIds.length} member(s).`, "success");
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};

window.rejectUpcoming = async function(tournamentId, userId) {
  const reason = prompt("Enter rejection reason:");
  if (!reason) return;
  try {
    await updateDoc(doc(db, "tournaments", tournamentId, "upcomingRegistrations", userId), {
      status: "rejected", rejectionReason: reason, processedAt: serverTimestamp(),
    });
    showToast("Registration rejected.", "error");
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};

window.removeUpcoming = async function(tournamentId, userId) {
  if (!confirm("Remove this registration from the list?")) return;
  try {
    await updateDoc(doc(db, "tournaments", tournamentId, "upcomingRegistrations", userId), {
      archived: true, archivedAt: serverTimestamp(),
    });
    showToast("Removed from list.", "success");
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};

// ============================================================================
//  9. AUTH ACTIONS
// ============================================================================
window.adminLogin = async function() {
  const email = document.getElementById("adminEmail").value.trim();
  const pass  = document.getElementById("adminPass").value;
  if (!email || !pass) { showToast("Enter email and password.", "warning"); return; }
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    showToast("Login failed: " + e.message, "error");
  }
};

window.logout = async function() {
  teardownAllListeners();
  await signOut(auth);
};

// ============================================================================
//  10. TOURNAMENTS
// ============================================================================
let currentTournamentCategory = "ongoing";

window.handleCategoryChange = function(select) {
  currentTournamentCategory = select.value;

  const ongoingFields  = document.getElementById("ongoingFields");
  const upcomingFields = document.getElementById("upcomingFields");

  if (select.value === "upcoming") {
    if (ongoingFields)  ongoingFields.style.display  = "none";
    if (upcomingFields) upcomingFields.style.display = "block";
  } else {
    if (ongoingFields)  ongoingFields.style.display  = "block";
    if (upcomingFields) upcomingFields.style.display = "none";
  }

  // Update calendar mark note live
  updateCalendarNote();
};

function updateCalendarNote() {
  const feeInput = document.getElementById("upcomingFee");
  const noteEl   = document.getElementById("calendarMarkNote");
  if (!feeInput || !noteEl) return;
  const fee = Number(feeInput.value);
  noteEl.textContent = fee > 200
    ? "⭐ Entry fee > ₹200 — will be marked as Special event on calendar."
    : "📅 Will be marked as Upcoming event on calendar.";
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("upcomingFee")?.addEventListener("input", updateCalendarNote);
});

window.addTournament = async function() {
  const category = document.getElementById("tournamentCategory").value;

  let title, fee, mode, first, second, third, duration, eventDate, endTime;

  if (category === "upcoming") {
    title     = document.getElementById("tournamentTitle").value.trim();
    fee       = Number(document.getElementById("upcomingFee").value);
    mode      = document.getElementById("upcomingMode").value;
    first     = Number(document.getElementById("upcomingPrizeFirst").value)  || 0;
    second    = Number(document.getElementById("upcomingPrizeSecond").value) || 0;
    third     = Number(document.getElementById("upcomingPrizeThird").value)  || 0;
    eventDate = document.getElementById("tournamentEventDate")?.value;
    duration  = null;

    if (!title || !fee)      { showToast("Title and entry fee are required.", "warning"); return; }
    if (!eventDate)          { showToast("Please select a tournament date.",  "warning"); return; }

    endTime = new Date(eventDate).getTime() + 24 * 60 * 60 * 1000;
  } else {
    title    = document.getElementById("tournamentTitle").value.trim();
    fee      = Number(document.getElementById("tournamentFee").value);
    mode     = document.getElementById("tournamentMode").value;
    first    = Number(document.getElementById("prizeFirst").value)  || 0;
    second   = Number(document.getElementById("prizeSecond").value) || 0;
    third    = Number(document.getElementById("prizeThird").value)  || 0;
    duration = Number(document.getElementById("tournamentDuration").value) || 60;
    endTime  = Date.now() + duration * 60000;
    eventDate = null;

    if (!title || !fee) { showToast("Title and entry fee are required.", "warning"); return; }
  }

  try {
    const tournamentData = {
      title, entryFee: fee, mode, category,
      duration: eventDate ? null : duration,
      eventDate: eventDate ?? null,
      prize: { first, second, third },
      createdAt: serverTimestamp(),
      endTime,
      status: category === "ongoing" ? "live" : "upcoming",
      isPaymentDeferred: category === "upcoming",
    };

    const tourneyRef = await addDoc(tournamentsRef, tournamentData);

    // Auto-create calendar event for upcoming
    if (category === "upcoming" && eventDate) {
      const calType = fee > 200 ? "special" : "upcoming";
      await addDoc(calendarRef, {
        date: eventDate,
        title,
        type: calType,
        prize: first,
        description: `${mode} Tournament — Entry ₹${fee}`,
        tournamentId: tourneyRef.id,
        createdAt: serverTimestamp(),
        source: "auto",
      });
      showToast(`Tournament added! Calendar marked as ${calType === "special" ? "⭐ Special" : "📅 Upcoming"}.`, "success");
    } else {
      showToast("Tournament added!", "success");
    }

    // Clear form
    ["tournamentTitle","tournamentFee","prizeFirst","prizeSecond","prizeThird",
     "upcomingFee","upcomingPrizeFirst","upcomingPrizeSecond","upcomingPrizeThird","tournamentEventDate"]
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });

  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};

window.deleteTournament = async function(id) {
  if (!confirm("Delete this tournament? This cannot be undone.")) return;
  try {
    await deleteDoc(doc(db, "tournaments", id));
    showToast("Tournament deleted.", "success");
  } catch (e) {
    showToast("Error deleting: " + e.message, "error");
  }
};

function loadTournaments() {
  if (_listeners.tournaments) return;
  const q = query(tournamentsRef, orderBy("createdAt", "desc"));
  _listeners.tournaments = onSnapshot(q, (snapshot) => {
    const box = document.getElementById("tournamentList");
    if (!box) return;
    box.innerHTML = "";
    snapshot.forEach(d => {
      const t   = d.data();
      const div = document.createElement("div");
      div.className = "item-card";
      div.innerHTML = `
        <div>
          <strong>${escHtml(t.title)}</strong><br>
          <small>₹${t.entryFee} · ${t.mode} · ${t.category}${t.eventDate ? ` · 📅 ${t.eventDate}` : ""}</small>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn-delete" onclick="deleteTournament('${d.id}')">Delete</button>
        </div>`;
      box.appendChild(div);
    });
  });
}

// ============================================================================
//  11. CALENDAR
// ============================================================================
window.selectColor = function(type, element) {
  document.querySelectorAll(".color-option").forEach(el => el.classList.remove("selected"));
  element.classList.add("selected");
  document.getElementById("eventType").value = type;
};

window.addCalendarEvent = async function() {
  const date  = document.getElementById("eventDate").value;
  const title = document.getElementById("eventTitle").value.trim();
  const type  = document.getElementById("eventType").value;
  const prize = Number(document.getElementById("eventPrize").value) || 0;
  const desc  = document.getElementById("eventDesc").value.trim() || title;

  if (!date || !title) { showToast("Date and title are required.", "warning"); return; }

  try {
    const existing = await getDocs(query(calendarRef, where("date", "==", date)));
    if (!existing.empty) {
      await updateDoc(doc(db, "calendarEvents", existing.docs[0].id), {
        title, type, prize, description: desc, updatedAt: serverTimestamp(),
      });
    } else {
      await addDoc(calendarRef, { date, title, type, prize, description: desc, createdAt: serverTimestamp() });
    }
    ["eventDate","eventTitle","eventPrize","eventDesc"].forEach(id => document.getElementById(id).value = "");
    showToast("Calendar event saved!", "success");
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};

window.deleteCalendarEvent = async function(id) {
  if (!confirm("Delete this calendar event?")) return;
  try {
    await deleteDoc(doc(db, "calendarEvents", id));
    showToast("Event deleted.", "success");
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};

window.editCalendarEvent = async function(id) {
  const snap = await getDoc(doc(db, "calendarEvents", id));
  if (!snap.exists()) { showToast("Event not found.", "error"); return; }
  const e = snap.data();
  document.getElementById("eventDate").value  = e.date  ?? "";
  document.getElementById("eventTitle").value = e.title ?? "";
  document.getElementById("eventPrize").value = e.prize ?? "";
  document.getElementById("eventDesc").value  = e.description ?? "";
  const colorEl = document.querySelector(`[onclick="selectColor('${e.type ?? "upcoming"}',this)"]`);
  if (colorEl) window.selectColor(e.type ?? "upcoming", colorEl);
  const btn = document.querySelector(".calendar-form .btn-submit");
  btn.textContent = "✓ Update Event";
  btn.onclick = () => window.updateCalendarEvent(id);
  document.querySelector(".calendar-form").scrollIntoView({ behavior: "smooth" });
};

window.updateCalendarEvent = async function(id) {
  const date  = document.getElementById("eventDate").value;
  const title = document.getElementById("eventTitle").value.trim();
  const type  = document.getElementById("eventType").value;
  const prize = Number(document.getElementById("eventPrize").value) || 0;
  const desc  = document.getElementById("eventDesc").value.trim() || title;

  if (!date || !title) { showToast("Date and title are required.", "warning"); return; }

  try {
    await updateDoc(doc(db, "calendarEvents", id), { date, title, type, prize, description: desc, updatedAt: serverTimestamp() });
    ["eventDate","eventTitle","eventPrize","eventDesc"].forEach(id => document.getElementById(id).value = "");
    const btn = document.querySelector(".calendar-form .btn-submit");
    btn.textContent = "+ Add Calendar Event";
    btn.onclick = window.addCalendarEvent;
    showToast("Event updated!", "success");
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};

function loadCalendarEvents() {
  if (_listeners.calendar) return;
  const COLORS = { upcoming:"#4a90e2", special:"#ffd700", completed:"#666", today:"#00ff88" };
  const q = query(calendarRef, orderBy("date", "desc"));
  _listeners.calendar = onSnapshot(q, (snapshot) => {
    const box = document.getElementById("calendarEventsList");
    if (!box) return;
    box.innerHTML = "";
    snapshot.forEach(d => {
      const e = d.data();
      const color = COLORS[e.type] ?? "#888";
      const div = document.createElement("div");
      div.className = "event-card";
      div.style.borderLeftColor = color;
      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:start;">
          <div>
            <strong style="color:${color};">${escHtml(e.date)}</strong><br>
            <strong>${escHtml(e.title)}</strong><br>
            <small style="color:var(--muted);">${escHtml(e.description ?? "")}</small><br>
            ${e.prize ? `<small style="color:var(--green);">Prize: ₹${e.prize}</small>` : ""}
            ${e.source === "auto" ? `<small style="color:#555;"> · auto</small>` : ""}
          </div>
          <div style="display:flex;gap:6px;">
            <button onclick="editCalendarEvent('${d.id}')"   style="background:var(--blue);color:#fff;border:none;padding:5px 10px;cursor:pointer;border-radius:6px;font-size:12px;">Edit</button>
            <button onclick="deleteCalendarEvent('${d.id}')" style="background:var(--red);color:#fff;border:none;padding:5px 10px;cursor:pointer;border-radius:6px;font-size:12px;">×</button>
          </div>
        </div>`;
      box.appendChild(div);
    });
  });
}

// ============================================================================
//  12. PAYMENT VERIFICATION (from tournament list view)
// ============================================================================
window.viewRegistrations = async function(tournamentId) {
  const participantsRef = collection(db, "tournaments", tournamentId, "participants");
  const snapshot = await getDocs(query(participantsRef, orderBy("timestamps.registeredAt", "desc")));

  let html = `<h3>Registrations & Payment Verification</h3><div style="display:grid;gap:10px;">`;
  snapshot.forEach(d => {
    const p = d.data();
    const statusColor = p.paymentStatus === "verified" ? "var(--green)" : p.paymentStatus === "rejected" ? "var(--red)" : "var(--gold)";
    html += `
      <div style="background:var(--bg2);padding:15px;border-radius:8px;border-left:3px solid ${statusColor};display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="color:#fff;font-weight:bold;">${escHtml(p.teamName ?? "—")}</div>
          <div style="color:var(--muted);font-size:12px;margin-top:4px;">UID: ${escHtml(p.freeFireUid ?? "—")} | Phone: ${escHtml(p.phoneNumber ?? "—")}</div>
          <div style="color:var(--muted);font-size:11px;margin-top:2px;">Txn: <span style="color:var(--gold);">${escHtml(p.transactionCode ?? "—")}</span></div>
        </div>
        <div style="display:flex;gap:6px;">
          <button onclick="verifyPayment('${tournamentId}','${d.id}',true)"  style="background:var(--green);color:#000;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;">✓ Verify</button>
          <button onclick="verifyPayment('${tournamentId}','${d.id}',false)" style="background:var(--red);color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;">✗ Reject</button>
        </div>
      </div>`;
  });
  html += "</div>";
  document.getElementById("adminList").innerHTML = html;
};

window.verifyPayment = async function(tournamentId, participantId, isVerified) {
  const status = isVerified ? "verified" : "rejected";
  try {
    await updateDoc(doc(db, "tournaments", tournamentId, "participants", participantId), {
      paymentStatus:     status,
      paymentVerifiedBy: auth.currentUser?.email ?? "admin",
      paymentVerifiedAt: serverTimestamp(),
    });
    showToast(`Payment ${status}.`, isVerified ? "success" : "error");
    window.viewRegistrations(tournamentId);
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};

// ============================================================================
//  13. SOUND ALERT
// ============================================================================
const adminAudio = new (window.AudioContext || window.webkitAudioContext)();
function playAdminAlert() {
  if (adminAudio.state === "suspended") adminAudio.resume();
  const osc  = adminAudio.createOscillator();
  const gain = adminAudio.createGain();
  osc.connect(gain);
  gain.connect(adminAudio.destination);
  osc.frequency.setValueAtTime(1200, adminAudio.currentTime);
  osc.frequency.exponentialRampToValueAtTime(600, adminAudio.currentTime + 0.3);
  gain.gain.setValueAtTime(0.5, adminAudio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, adminAudio.currentTime + 0.5);
  osc.start(adminAudio.currentTime);
  osc.stop(adminAudio.currentTime + 0.5);
}

// ============================================================================
//  UTILITIES
// ============================================================================
function escHtml(str) {
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function showToast(message, type = "success") {
  const bg    = { success:"#2e7d32", error:"#c62828", warning:"#f57f17" }[type] ?? "#333";
  const color = type === "warning" ? "#000" : "#fff";
  const toast = document.createElement("div");
  toast.style.cssText = `
    position:fixed;bottom:24px;right:24px;
    background:${bg};color:${color};
    padding:12px 20px;border-radius:10px;
    font-size:14px;z-index:99999;max-width:340px;
    animation:fadeInUp .2s ease;box-shadow:0 4px 12px rgba(0,0,0,.4);
    font-family:'Rajdhani',sans-serif;font-weight:600;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}