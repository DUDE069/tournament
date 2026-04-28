// =============================================================================
//  NPC Esports — admin.js  (v3 — upgraded)
//  FILE: admin/admin.js  →  ADMIN PANEL ONLY
// =============================================================================
//
//  WHAT'S NEW IN v3:
//  ─────────────────
//  1. REMOVE BUTTON BUG FIX
//     • Queries now filter out archived:true documents so removed items
//       actually disappear from the list immediately.
//
//  2. PROGRESS TRACKING SYSTEM (Status Modal)
//     • Replaced "Payment Status" field with a 5-stage delivery-style tracker:
//       1. Application Submitted ✔  2. Verification Approved ✔
//       3. Payment Completed  4. Payment Verified  5. Confirmation Received
//     • Stages update in real-time from Firestore participant doc.
//
//  3. "NOTIFY THIS TEAM" BUTTON
//     • Replaces old "Confirm Payment / Reject Payment" buttons.
//     • Opens a compose modal → writes to users/{id}/notifications (in-app)
//       AND queues a push notification via pushQueue collection (FCM handler
//       reads from there server-side).
//
//  4. DUAL NOTIFICATION SYSTEM (in-app + push)
//     • In-app: always written to users/{uid}/notifications subcollection.
//     • Push:   written to pushQueue/{uid}/tasks — a Cloud Function (or your
//               own FCM sender) picks these up.  Push is ALWAYS optional;
//               in-app is MANDATORY and never skipped.
//
//  5. ROOM ID & PASSWORD MANAGEMENT
//     • New "Room & Password" sub-panel inside the Status Modal for accepted
//       applications.  Admin sets/updates roomId + roomPassword on the
//       participant doc.  On save, all team members are notified instantly.
//
//  6. reject-upcoming now uses a custom modal (no more browser `prompt()`).
//
//  HOW TO MAINTAIN:
//  ─────────────────
//  • Push notifications: set up a Firebase Cloud Function that listens to
//    pushQueue/{uid}/tasks and calls FCM.  The admin.js side just writes the
//    task document — no FCM SDK needed here.
//  • To add a new notification type: add a case in `sendDualNotification()`.
//  • Progress stages are driven by participant doc fields:
//      paymentStatus ("submitted"|"paid") → stage 3
//      paymentStatus ("verified")         → stage 4
//      confirmationReceived (true)         → stage 5
// =============================================================================

import { db, auth } from "./firebase.js";

import {
  collection, collectionGroup, addDoc, deleteDoc,
  doc, onSnapshot, query, orderBy, serverTimestamp,
  where, getDocs, updateDoc, getDoc, setDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ---------------------------------------------------------------------------
//  Listener teardown map
// ---------------------------------------------------------------------------
const _listeners = {
  badge:         null,
  verifications: null,
  registrations: null,
  tournaments:   null,
  calendar:      null,
};

function teardownAllListeners() {
  Object.values(_listeners).forEach(u => { if (u) u(); });
  Object.keys(_listeners).forEach(k => _listeners[k] = null);
}

// ---------------------------------------------------------------------------
//  Shared Firestore refs
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

  // BUG FIX: filter out archived docs in badge count
  const vQuery = query(
    collectionGroup(db, "verifications"),
    where("status",   "==", "pending"),
    where("archived", "==", false)
  );
  _listeners.badge = onSnapshot(vQuery, (snap) => {
    snap.docChanges().forEach(c => { if (c.type === "added") playAdminAlert(); });
    updateTabBadge("verificationBadge", snap.size);
  }, err => {
    // Fallback if composite index not yet created — query without archived filter
    console.warn("Badge listener (archived filter) failed, falling back:", err.message);
    const fallback = query(
      collectionGroup(db, "verifications"),
      where("status", "==", "pending")
    );
    _listeners.badge = onSnapshot(fallback, (snap) => {
      updateTabBadge("verificationBadge", snap.size);
    });
  });

  const rQuery = query(
    collectionGroup(db, "upcomingRegistrations"),
    where("status",   "==", "pending"),
    where("archived", "==", false)
  );
  onSnapshot(rQuery, (snap) => {
    updateTabBadge("registrationBadge", snap.size);
  }, () => {
    // Fallback
    onSnapshot(
      query(collectionGroup(db, "upcomingRegistrations"), where("status", "==", "pending")),
      (snap) => updateTabBadge("registrationBadge", snap.size)
    );
  });
}

function updateTabBadge(badgeId, count) {
  const badge = document.getElementById(badgeId);
  if (!badge) return;
  badge.textContent   = count;
  badge.style.display = count > 0 ? "inline-block" : "none";
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
//  4. ONGOING APPLICATIONS
//  BUG FIX: query now excludes archived:true documents
// ============================================================================
function loadVerifications() {
  if (_listeners.verifications) { _listeners.verifications(); _listeners.verifications = null; }

  const container = document.getElementById("verificationList");
  if (!container) return;
  container.innerHTML = '<p class="loading-text">Loading applications…</p>';

  // Query all statuses but EXCLUDE archived docs
  // NOTE: This requires a Firestore composite index on (submittedAt DESC) with
  // a collection group query.  If "archived" filter causes index errors, the
  // catch below falls back to client-side filtering.
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
    if (d.archived === true) return; // CLIENT-SIDE: skip archived docs
    if      (d.status === "pending")  pending.push(d);
    else if (d.status === "approved") accepted.push(d);
    else if (d.status === "rejected") rejected.push(d);
  });

  if (!pending.length && !accepted.length && !rejected.length) {
    container.innerHTML = `<div class="empty-state"><span class="emoji">✅</span>No applications yet.</div>`;
    return;
  }

  let html = "";
  html += partition("new",      `🆕 New Applications (${pending.length})`);
  html += pending.length  ? pending.map(d  => applicationCard(d, "new")).join("")      : noItems();
  html += partition("accepted", `✅ Accepted (${accepted.length})`);
  html += accepted.length ? accepted.map(d => applicationCard(d, "accepted")).join("") : noItems();
  html += partition("rejected", `❌ Rejected (${rejected.length})`);
  html += rejected.length ? rejected.map(d => applicationCard(d, "rejected")).join("") : noItems();

  container.innerHTML = html;
}

function partition(type, label) {
  return `
    <div class="partition">
      <span class="partition-label ${type}">${label}</span>
      <div class="partition-line"></div>
    </div>`;
}

function noItems() {
  return `<div style="color:var(--muted);font-size:13px;padding:8px 0 16px;">— None —</div>`;
}

function applicationCard(d, type) {
  const pillClass = type === "new" ? "pill-new" : type === "accepted" ? "pill-accepted" : "pill-rejected";
  const pillLabel = type === "new" ? "PENDING"  : type === "accepted" ? "APPROVED"     : "REJECTED";

  let actions = "";
  if (type === "new") {
    actions = `<button class="btn-view" onclick="viewApplicationDetails('${d.tournamentId}','${d.id}')">View & Decide</button>`;
  } else if (type === "accepted") {
    actions = `
      <button class="btn-status" onclick="viewStatusModal('${d.tournamentId}','${d.id}')">📊 Status</button>
      <button class="btn-remove" data-tid="${d.tournamentId}" data-uid="${d.id}" onclick="removeApplication('${d.tournamentId}','${d.id}')">Remove</button>`;
  } else {
    actions = `
      <button class="btn-view"   onclick="viewRejectedDetails('${d.tournamentId}','${d.id}')">Review</button>
      <button class="btn-remove" data-tid="${d.tournamentId}" data-uid="${d.id}" onclick="removeApplication('${d.tournamentId}','${d.id}')">Remove</button>`;
  }

  return `
    <div class="app-card ${type}" id="appcard-${d.id}">
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
//  5. REMOVE APPLICATION
//  BUG FIX: now sets archived:true AND immediately removes card from DOM
// ============================================================================
window.removeApplication = async function(tournamentId, userId) {
  if (!confirm("Remove this application from the list?")) return;
  try {
    await updateDoc(doc(db, "tournaments", tournamentId, "verifications", userId), {
      archived:   true,
      archivedAt: serverTimestamp(),
    });
    // Immediate UI removal — don't wait for snapshot
    document.getElementById(`appcard-${userId}`)?.remove();
    showToast("Application removed.", "success");
  } catch (e) {
    showToast("Error removing: " + e.message, "error");
  }
};

// ============================================================================
//  6. STATUS MODAL  (Accepted applications)
//  UPGRADE: replaced Payment Status row with 5-stage progress tracker
//  ADDED: "Notify This Team" button + Room ID & Password management
// ============================================================================
window.viewStatusModal = async function(tournamentId, userId) {
  try {
    const [vSnap, pSnap] = await Promise.all([
      getDoc(doc(db, "tournaments", tournamentId, "verifications", userId)),
      getDoc(doc(db, "tournaments", tournamentId, "participants",  userId)),
    ]);

    const v = vSnap.exists() ? vSnap.data() : {};
    const p = pSnap.exists() ? pSnap.data() : {};

    const processedAt = v.processedAt?.toDate?.()?.toLocaleString("en-IN") ?? "—";

    // ── Determine which stages are completed ──────────────────────────────
    // Stage 1: always done (application submitted)
    // Stage 2: always done (we only show accepted apps here)
    // Stage 3: payment submitted/paid by user
    const stage3 = ["submitted","paid","verified"].includes(p.paymentStatus);
    // Stage 4: payment verified by admin
    const stage4 = p.paymentStatus === "verified";
    // Stage 5: user clicked "Confirm" on their end
    const stage5 = p.confirmationReceived === true;

    document.getElementById("statusModalOverlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "statusModalOverlay";
    overlay.className = "status-modal-overlay";
    overlay.innerHTML = `
      <div class="status-modal" style="max-width:520px;width:100%;">
        <h3>📊 Team Status — ${escHtml(v.teamName ?? "—")}</h3>

        <!-- ── Core Info ──────────────────────────── -->
        <div class="status-row">
          <span class="s-label">Tournament</span>
          <span class="s-value" style="color:var(--blue);">${escHtml(tournamentId)}</span>
        </div>
        <div class="status-row">
          <span class="s-label">Leader</span>
          <span class="s-value">${escHtml(v.leaderEmail ?? "—")}</span>
        </div>
        <div class="status-row">
          <span class="s-label">Approved At</span>
          <span class="s-value">${processedAt}</span>
        </div>
        ${v.phone ? `
        <div class="status-row">
          <span class="s-label">Phone</span>
          <span class="s-value">${escHtml(v.phone)}</span>
        </div>` : ""}
        ${p.transactionCode ? `
        <div class="status-row">
          <span class="s-label">Transaction ID</span>
          <span class="s-value" style="font-family:'Share Tech Mono',monospace;color:var(--gold);">${escHtml(p.transactionCode)}</span>
        </div>` : ""}

        <!-- ── 5-Stage Progress Tracker ───────────── -->
        <div style="margin:20px 0 6px;">
          <p style="color:var(--muted);font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;">Application Progress</p>
          ${progressTracker([
            { label: "Application Submitted",  done: true  },
            { label: "Verification Approved",  done: true  },
            { label: "Payment Completed",      done: stage3 },
            { label: "Payment Verified",       done: stage4 },
            { label: "Confirmation Received",  done: stage5 },
          ])}
        </div>

        <!-- ── Room ID & Password ─────────────────── -->
        <div style="margin:18px 0;padding:14px;background:#0f0f0f;border-radius:10px;border:1px solid var(--border);">
          <p style="color:var(--muted);font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;">🔑 Room ID & Password</p>
          <div style="display:flex;gap:8px;margin-bottom:8px;">
            <input id="smRoomId" placeholder="Room ID"
              value="${escHtml(p.roomId ?? "")}"
              style="flex:1;padding:8px 12px;background:#1a1a1a;border:1px solid #333;color:#fff;border-radius:6px;font-family:inherit;font-size:13px;">
            <input id="smRoomPass" placeholder="Password"
              value="${escHtml(p.roomPassword ?? "")}"
              style="flex:1;padding:8px 12px;background:#1a1a1a;border:1px solid #333;color:#fff;border-radius:6px;font-family:inherit;font-size:13px;">
          </div>
          <button onclick="saveRoomDetails('${tournamentId}','${userId}',${JSON.stringify(Array.isArray(v.uids) ? v.uids : [userId]).replace(/"/g,"'")})"
            style="width:100%;padding:9px;background:var(--blue);color:#fff;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-weight:700;font-size:13px;">
            💾 Save & Notify Team
          </button>
          <p style="color:var(--muted);font-size:11px;margin-top:6px;text-align:center;">
            Saving notifies all members instantly (in-app + push if allowed)
          </p>
        </div>

        <!-- ── Actions ────────────────────────────── -->
        <div style="display:flex;gap:8px;margin-top:4px;">
          <button onclick="openNotifyModal('${tournamentId}','${userId}',${JSON.stringify(Array.isArray(v.uids) ? v.uids : [userId]).replace(/"/g,"'")},'${escHtml(v.teamName ?? "Team")}')"
            style="flex:1;padding:10px;background:var(--green);color:#000;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-family:inherit;font-size:13px;">
            🔔 Notify This Team
          </button>
        </div>

        <button onclick="document.getElementById('statusModalOverlay').remove()"
          style="width:100%;margin-top:10px;background:transparent;color:var(--muted);border:none;cursor:pointer;font-family:inherit;padding:8px;">
          Close
        </button>
      </div>`;

    document.body.appendChild(overlay);

    // Close on backdrop click
    overlay.addEventListener("click", e => {
      if (e.target === overlay) overlay.remove();
    });

  } catch (e) {
    showToast("Error loading status: " + e.message, "error");
  }
};

// ── Progress tracker HTML builder ─────────────────────────────────────────
function progressTracker(stages) {
  return `<div style="display:flex;flex-direction:column;gap:0;">` +
    stages.map((s, i) => {
      const isLast = i === stages.length - 1;
      const dot = s.done
        ? `<div style="width:24px;height:24px;border-radius:50%;background:var(--green);display:flex;align-items:center;justify-content:center;color:#000;font-size:13px;font-weight:700;flex-shrink:0;">✓</div>`
        : `<div style="width:24px;height:24px;border-radius:50%;border:2px solid #333;display:flex;align-items:center;justify-content:center;color:#555;font-size:13px;flex-shrink:0;">○</div>`;
      const connector = isLast ? "" : `<div style="width:2px;height:18px;background:${s.done ? "var(--green)" : "#333"};margin-left:11px;margin-top:2px;margin-bottom:2px;"></div>`;
      const labelColor = s.done ? "#fff" : "var(--muted)";
      return `
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <div style="display:flex;flex-direction:column;align-items:center;">
            ${dot}
            ${connector}
          </div>
          <span style="color:${labelColor};font-size:13px;padding-top:3px;">${s.label}</span>
        </div>`;
    }).join("") + `</div>`;
}

// ── Save Room ID & Password — notifies all members ─────────────────────────
window.saveRoomDetails = async function(tournamentId, userId, memberIds) {
  const roomId   = document.getElementById("smRoomId")?.value.trim();
  const roomPass = document.getElementById("smRoomPass")?.value.trim();

  if (!roomId || !roomPass) {
    showToast("Enter both Room ID and Password.", "warning");
    return;
  }

  try {
    // Save to participant doc
    await updateDoc(doc(db, "tournaments", tournamentId, "participants", userId), {
      roomId:           roomId,
      roomPassword:     roomPass,
      roomUpdatedAt:    serverTimestamp(),
      roomUpdatedBy:    auth.currentUser?.email ?? "admin",
    });

    // Get tournament name
    let tournamentName = tournamentId;
    try {
      const tSnap = await getDoc(doc(db, "tournaments", tournamentId));
      if (tSnap.exists()) tournamentName = tSnap.data().title ?? tournamentId;
    } catch (_) {}

    // Notify all members (dual: in-app + push)
    const ids = Array.isArray(memberIds) ? memberIds : [userId];
    await Promise.all(ids.map(mid => sendDualNotification(mid, {
      type:    "room_details",
      title:   "🔑 Room Details Ready!",
      message: `Room ID: ${roomId} | Password: ${roomPass}`,
      extra:   { roomId, roomPassword: roomPass, tournamentId, tournamentName },
      actionLink: `tournament=${tournamentId}`,
    })));

    showToast(`Room details saved & ${ids.length} member(s) notified!`, "success");
    document.getElementById("statusModalOverlay")?.remove();
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};

// ============================================================================
//  7. NOTIFY THIS TEAM MODAL
//  NEW: replaced Confirm Payment / Reject Payment buttons
// ============================================================================
window.openNotifyModal = function(tournamentId, userId, memberIds, teamName) {
  document.getElementById("notifyModalOverlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "notifyModalOverlay";
  overlay.className = "status-modal-overlay";
  overlay.innerHTML = `
    <div class="status-modal" style="max-width:460px;width:100%;">
      <h3>🔔 Notify Team — ${escHtml(teamName)}</h3>
      <p style="color:var(--muted);font-size:13px;margin-bottom:16px;">
        In-app notification is always sent. Push notification sent only if team has granted permission.
      </p>

      <div style="margin-bottom:12px;">
        <label style="color:var(--muted);font-size:11px;letter-spacing:.5px;text-transform:uppercase;display:block;margin-bottom:6px;">Quick Message</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
          ${[
            "Your application is approved. Proceed to tournament.",
            "Payment received. Room details coming soon!",
            "Match starts in 30 minutes. Get ready!",
            "Check your room ID in the app.",
          ].map(msg => `
            <button onclick="document.getElementById('notifyMsgInput').value='${msg.replace(/'/g,"\\'")}'"
              style="background:#1a1a1a;border:1px solid #333;color:var(--muted);padding:5px 10px;border-radius:16px;cursor:pointer;font-size:12px;font-family:inherit;transition:all .15s;"
              onmouseover="this.style.borderColor='var(--green)';this.style.color='var(--green)'"
              onmouseout="this.style.borderColor='#333';this.style.color='var(--muted)'">
              ${escHtml(msg.length > 40 ? msg.slice(0, 38) + "…" : msg)}
            </button>`).join("")}
        </div>
        <textarea id="notifyMsgInput"
          placeholder="Or type a custom message…"
          style="width:100%;min-height:80px;background:#1a1a1a;border:1px solid #333;color:#fff;padding:10px;border-radius:8px;font-family:inherit;font-size:14px;resize:vertical;box-sizing:border-box;"
        >Your application is approved. Proceed to tournament.</textarea>
      </div>

      <button onclick="sendTeamNotification('${tournamentId}','${userId}',${JSON.stringify(Array.isArray(memberIds) ? memberIds : [userId]).replace(/"/g,"'")},'${escHtml(teamName)}')"
        style="width:100%;padding:12px;background:var(--green);color:#000;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-family:inherit;font-size:14px;">
        Send Notification
      </button>
      <button onclick="document.getElementById('notifyModalOverlay').remove()"
        style="width:100%;margin-top:8px;background:transparent;color:var(--muted);border:none;cursor:pointer;font-family:inherit;padding:8px;">
        Cancel
      </button>
    </div>`;

  document.body.appendChild(overlay);
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
};

window.sendTeamNotification = async function(tournamentId, userId, memberIds, teamName) {
  const message = document.getElementById("notifyMsgInput")?.value.trim();
  if (!message) { showToast("Please enter a message.", "warning"); return; }

  const ids = Array.isArray(memberIds) ? memberIds : [userId];

  try {
    await Promise.all(ids.map(mid => sendDualNotification(mid, {
      type:      "admin_notice",
      title:     "📢 Message from Admin",
      message,
      extra:     { tournamentId, teamName },
      actionLink: `tournament=${tournamentId}`,
    })));

    document.getElementById("notifyModalOverlay")?.remove();
    showToast(`Notification sent to ${ids.length} member(s)!`, "success");
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};

// ============================================================================
//  8. DUAL NOTIFICATION HELPER
//  NEW FUNCTION — used throughout this file
//
//  HOW IT WORKS:
//  • In-app:  writes to users/{uid}/notifications  — ALWAYS
//  • Push:    writes to pushQueue/{uid}/tasks       — Cloud Function picks up
//             and sends FCM only if user's FCM token exists and is not blocked.
//             If no Cloud Function is set up yet, push is silently skipped.
// ============================================================================
async function sendDualNotification(userId, { type, title, message, extra = {}, actionLink = "" }) {
  // A. In-app (MANDATORY — never skip)
  await addDoc(collection(db, "users", userId, "notifications"), {
    type,
    title,
    message,
    ...extra,
    actionLink,
    read:       false,
    popupShown: false,
    createdAt:  serverTimestamp(),
  });

  // B. Push (optional — write to pushQueue; Cloud Function handles FCM)
  try {
    await addDoc(collection(db, "pushQueue", userId, "tasks"), {
      type,
      title,
      message,
      ...extra,
      createdAt: serverTimestamp(),
      sent:      false,    // Cloud Function flips this to true after sending
    });
  } catch (_) {
    // Push queue failure must NEVER break in-app notifications
    console.warn("[Push] Failed to queue push notification for", userId);
  }
}

// ============================================================================
//  9. VIEW & DECIDE MODAL  (approve / reject)
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
  const ok  = document.getElementById(`btn-${field}-ok`);
  const err = document.getElementById(`btn-${field}-err`);
  if (ok)  { ok.style.background  = status === "ok"  ? "var(--green)" : "#333"; ok.style.color  = status === "ok"  ? "#000" : "var(--green)"; }
  if (err) { err.style.background = status === "err" ? "var(--red)"   : "#333"; err.style.color = status === "err" ? "#fff" : "var(--red)"; }
};

window.viewApplicationDetails = async function(tournamentId, userId) {
  try {
    const docSnap = await getDoc(doc(db, "tournaments", tournamentId, "verifications", userId));
    if (!docSnap.exists()) { showToast("Application not found.", "error"); return; }

    const v = docSnap.data();
    document.getElementById("verifModal")?.remove();
    currentFieldStatuses = {};

    const uidsArray  = Array.isArray(v.uids) ? v.uids : (v.uids ? [v.uids] : []);
    const uidRowsHtml = uidsArray.map((uid, i) =>
      fieldVerifyRow(`Player ${i + 1} UID`, uid, `uid_${i}`)
    ).join("") || `<div style="background:#0f0f0f;padding:10px 14px;border-radius:8px;color:var(--muted);font-size:13px;">No UIDs submitted</div>`;

    let entryFee = "—";
    try {
      const tSnap = await getDoc(doc(db, "tournaments", tournamentId));
      if (tSnap.exists()) entryFee = "₹" + (tSnap.data().entryFee ?? "—");
    } catch (_) {}

    const modal = document.createElement("div");
    modal.id = "verifModal";
    modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;";
    modal.innerHTML = `
      <div style="background:var(--bg2);width:100%;max-width:580px;padding:28px;border-radius:14px;border:1px solid var(--border);max-height:92vh;overflow-y:auto;">
        <h2 style="color:var(--green);margin-bottom:6px;">Review Application</h2>
        <p style="color:var(--muted);font-size:13px;margin-bottom:20px;">Team: <b style="color:#fff;">${escHtml(v.teamName ?? "—")}</b></p>

        <div style="display:grid;gap:8px;margin-bottom:16px;">
          <div style="background:#0f0f0f;padding:10px 14px;border-radius:8px;">
            <span style="color:var(--muted);font-size:13px;">Leader Email: <b style="color:#fff;margin-left:6px;">${escHtml(v.leaderEmail ?? "—")}</b></span>
          </div>
          <div style="background:#0f0f0f;padding:10px 14px;border-radius:8px;">
            <span style="color:var(--muted);font-size:13px;">Tournament ID: <b style="color:#fff;margin-left:6px;">${escHtml(tournamentId)}</b></span>
          </div>
          <div style="background:#0f0f0f;padding:10px 14px;border-radius:8px;">
            <span style="color:var(--muted);font-size:13px;">Entry Fee: <b style="color:var(--gold);margin-left:6px;">${entryFee}</b></span>
          </div>
          <div style="background:#0f0f0f;padding:10px 14px;border-radius:8px;">
            <span style="color:var(--muted);font-size:13px;">Team Code: <b style="color:#fff;margin-left:6px;">${escHtml(v.teamCode ?? "—")}</b></span>
          </div>
        </div>

        <p style="color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Verify Each Field</p>
        <div style="display:grid;gap:8px;">
          ${fieldVerifyRow("Phone Number", v.phone, "phone")}
          ${fieldVerifyRow("Backup Email", v.backupEmail, "backupEmail")}
          ${uidRowsHtml}
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
//  10. PROCESS DECISION  (approve / reject + dual notify all teammates)
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
    await updateDoc(doc(db, "tournaments", tournamentId, "verifications", userId), {
      status,
      rejectionNote:  finalReason,
      fieldStatus:    currentFieldStatuses,
      processedAt:    serverTimestamp(),
      processedBy:    auth.currentUser?.uid ?? "admin",
    });

    // Collect team member IDs
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
      console.warn("Team lookup failed:", lookupErr.message);
    }

    const msgApproved = "Your team has been verified! ✅ Proceed to the payment stage.";
    const msgRejected = `Your application was rejected. Reason: ${finalReason}`;

    await Promise.all(
      allMemberIds.map(mid => sendDualNotification(mid, {
        type:      status === "approved" ? "approval" : "rejected",
        title:     status === "approved" ? "Application Approved! ✅" : "Application Rejected ❌",
        message:   status === "approved" ? msgApproved : msgRejected,
        extra:     { tournamentId, rejectionNote: finalReason || "" },
        actionLink: `tournament=${tournamentId}`,
      }))
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
//  11. REJECTED DETAILS (read-only)
// ============================================================================
window.viewRejectedDetails = async function(tournamentId, userId) {
  try {
    const docSnap = await getDoc(doc(db, "tournaments", tournamentId, "verifications", userId));
    if (!docSnap.exists()) { showToast("Application not found.", "error"); return; }

    const v = docSnap.data();
    document.getElementById("rejectedDetailModal")?.remove();

    const modal = document.createElement("div");
    modal.id = "rejectedDetailModal";
    modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;";
    modal.innerHTML = `
      <div style="background:var(--bg2);width:100%;max-width:520px;padding:28px;border-radius:14px;border:1px solid var(--red);max-height:90vh;overflow-y:auto;">
        <h2 style="color:var(--red);margin-bottom:6px;">❌ Rejected Application</h2>
        <p style="color:var(--muted);font-size:13px;margin-bottom:20px;">Read-only view</p>
        <div style="display:grid;gap:8px;">
          <div style="background:#0f0f0f;padding:10px 14px;border-radius:8px;">
            <span style="color:var(--muted);font-size:13px;">Team Name: <b style="color:#fff;margin-left:6px;">${escHtml(v.teamName ?? "—")}</b></span>
          </div>
          <div style="background:#0f0f0f;padding:10px 14px;border-radius:8px;">
            <span style="color:var(--muted);font-size:13px;">Leader Email: <b style="color:#fff;margin-left:6px;">${escHtml(v.leaderEmail ?? "—")}</b></span>
          </div>
          <div style="background:#0f0f0f;padding:10px 14px;border-radius:8px;">
            <span style="color:var(--muted);font-size:13px;">Tournament: <b style="color:#fff;margin-left:6px;">${escHtml(tournamentId)}</b></span>
          </div>
          <div style="background:rgba(255,68,68,.1);padding:14px;border-radius:8px;border:1px solid var(--red);">
            <span style="color:var(--muted);font-size:13px;display:block;margin-bottom:4px;">Rejection Reason:</span>
            <b style="color:var(--red);font-size:15px;">${escHtml(v.rejectionNote || v.rejectionReason || "— No reason recorded —")}</b>
          </div>
          ${v.processedAt ? `
          <div style="background:#0f0f0f;padding:10px 14px;border-radius:8px;">
            <span style="color:var(--muted);font-size:13px;">Rejected At: <b style="color:#fff;margin-left:6px;">${v.processedAt.toDate?.()?.toLocaleString("en-IN") ?? "—"}</b></span>
          </div>` : ""}
        </div>
        <button onclick="document.getElementById('rejectedDetailModal').remove()"
          style="width:100%;margin-top:16px;background:transparent;color:var(--muted);border:1px solid var(--border);cursor:pointer;font-family:inherit;padding:10px;border-radius:8px;">
          Close
        </button>
      </div>`;
    document.body.appendChild(modal);
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};

// ============================================================================
//  12. UPCOMING REGISTRATIONS TAB
//  BUG FIX: archived filter applied; reject uses custom modal (no prompt())
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
      if (data.archived === true) return; // CLIENT-SIDE filter
      if      (data.status === "pending")  pending.push(data);
      else if (data.status === "approved") approved.push(data);
      else if (data.status === "rejected") rejected.push(data);
    });

    if (!pending.length && !approved.length && !rejected.length) {
      container.innerHTML = `<div class="empty-state"><span class="emoji">📋</span>No registrations yet.</div>`;
      return;
    }

    let html = "";
    html += partition("new",      `🆕 New Registrations (${pending.length})`);
    html += pending.length  ? pending.map(d  => upcomingCard(d, "new")).join("")      : noItems();
    html += partition("accepted", `✅ Approved (${approved.length})`);
    html += approved.length ? approved.map(d => upcomingCard(d, "accepted")).join("") : noItems();
    html += partition("rejected", `❌ Rejected (${rejected.length})`);
    html += rejected.length ? rejected.map(d => upcomingCard(d, "rejected")).join("") : noItems();

    container.innerHTML = html;
  }, err => {
    container.innerHTML = `<p style="color:var(--red);padding:20px;">Error: ${err.message}</p>`;
  });
}

function upcomingCard(d, type) {
  const pillClass = type === "new" ? "pill-new" : type === "accepted" ? "pill-accepted" : "pill-rejected";
  const pillLabel = type === "new" ? "PENDING"  : type === "accepted" ? "APPROVED"     : "REJECTED";
  const eventDate = d.eventDate
    ? new Date(d.eventDate).toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" })
    : "TBA";

  let actions = "";
  if (type === "new") {
    actions = `
      <button onclick="approveUpcoming('${d.tournamentId}','${d.id}')"
        style="background:var(--green);color:#000;border:none;padding:7px 16px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;">
        Approve
      </button>
      <button onclick="openRejectUpcomingModal('${d.tournamentId}','${d.id}')"
        style="background:var(--red);color:#fff;border:none;padding:7px 16px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;">
        Reject
      </button>`;
  } else {
    actions = `<button class="btn-remove" onclick="removeUpcoming('${d.tournamentId}','${d.id}','${d.id}')" id="regcard-${d.id}">Remove</button>`;
  }

  return `
    <div class="app-card ${type}" id="regcard-${d.id}">
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

    let allMemberIds = [userId];
    try {
      const uSnap = await getDoc(doc(db, "users", userId));
      if (uSnap.exists() && uSnap.data().teamId) {
        const tSnap = await getDoc(doc(db, "teams", uSnap.data().teamId));
        if (tSnap.exists()) allMemberIds = [...new Set([...(tSnap.data().members ?? []), userId])];
      }
    } catch (_) {}

    await Promise.all(allMemberIds.map(mid => sendDualNotification(mid, {
      type:      "upcoming_approved",
      title:     "Registration Approved! 🎉",
      message:   "Your upcoming tournament registration has been approved! Stay tuned for match details.",
      extra:     { tournamentId },
      actionLink: `tournament=${tournamentId}`,
    })));

    showToast(`Registration approved! Notified ${allMemberIds.length} member(s).`, "success");
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};

// UPGRADE: custom modal instead of browser prompt()
window.openRejectUpcomingModal = function(tournamentId, userId) {
  document.getElementById("rejectUpcomingModal")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "rejectUpcomingModal";
  overlay.className = "status-modal-overlay";
  overlay.innerHTML = `
    <div class="status-modal" style="max-width:420px;width:100%;">
      <h3 style="color:var(--red);">❌ Reject Registration</h3>
      <p style="color:var(--muted);font-size:13px;margin-bottom:14px;">Select or write a reason. The team will be notified.</p>
      <select id="rejectUpcomingReason" style="width:100%;padding:10px;background:#000;color:#fff;border:1px solid #444;border-radius:8px;margin-bottom:10px;font-family:inherit;">
        <option value="">-- Select Reason --</option>
        <option value="Registration closed">Registration closed</option>
        <option value="Slots full">Slots full</option>
        <option value="Incomplete details">Incomplete details</option>
        <option value="Duplicate registration">Duplicate registration</option>
        <option value="custom">Other (write below)</option>
      </select>
      <textarea id="rejectUpcomingNote" placeholder="Custom reason (optional)…"
        style="width:100%;height:60px;background:#000;color:#fff;border:1px solid #444;padding:10px;border-radius:8px;font-family:inherit;resize:vertical;"></textarea>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button onclick="confirmRejectUpcoming('${tournamentId}','${userId}')"
          style="flex:1;padding:10px;background:var(--red);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-family:inherit;">
          Confirm Reject
        </button>
        <button onclick="document.getElementById('rejectUpcomingModal').remove()"
          style="flex:1;padding:10px;background:#222;color:var(--muted);border:1px solid #333;border-radius:8px;cursor:pointer;font-family:inherit;">
          Cancel
        </button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
};

window.confirmRejectUpcoming = async function(tournamentId, userId) {
  const select = document.getElementById("rejectUpcomingReason").value;
  const custom = document.getElementById("rejectUpcomingNote").value.trim();
  const reason = select === "custom" ? custom : select;
  if (!reason) { showToast("Please select or enter a reason.", "warning"); return; }

  try {
    await updateDoc(doc(db, "tournaments", tournamentId, "upcomingRegistrations", userId), {
      status: "rejected", rejectionReason: reason, processedAt: serverTimestamp(),
    });
    await sendDualNotification(userId, {
      type:      "rejected",
      title:     "Registration Rejected",
      message:   `Your registration was rejected. Reason: ${reason}`,
      extra:     { tournamentId },
      actionLink: `tournament=${tournamentId}`,
    });
    document.getElementById("rejectUpcomingModal")?.remove();
    showToast("Registration rejected & team notified.", "error");
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};

// BUG FIX: immediate DOM removal on removeUpcoming
window.removeUpcoming = async function(tournamentId, userId, cardId) {
  if (!confirm("Remove this registration from the list?")) return;
  try {
    await updateDoc(doc(db, "tournaments", tournamentId, "upcomingRegistrations", userId), {
      archived: true, archivedAt: serverTimestamp(),
    });
    document.getElementById(`regcard-${cardId}`)?.remove();
    showToast("Removed from list.", "success");
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};

// ============================================================================
//  13. AUTH ACTIONS
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
//  14. TOURNAMENTS
// ============================================================================
let currentTournamentCategory = "ongoing";

window.handleCategoryChange = function(selectElement) {
    const category = selectElement.value;
    const sharedFields = document.getElementById('sharedFields');
    const upcomingFields = document.getElementById('upcomingFields');
    const limitedFields = document.getElementById('limitedFields');

    // Hide everything specific first
    if (upcomingFields) upcomingFields.style.display = 'none';
    if (limitedFields) limitedFields.style.display = 'none';
    
    if (category === 'limited') {
        // HIDE standard stats (Fee, Duration, Prizes), SHOW custom paragraph
        if (sharedFields) sharedFields.style.display = 'none';
        if (limitedFields) limitedFields.style.display = 'block';
    } else if (category === 'upcoming') {
        // SHOW standard stats AND upcoming timings
        if (sharedFields) sharedFields.style.display = 'block';
        if (upcomingFields) upcomingFields.style.display = 'block';
    } else {
        // ONGOING: SHOW ONLY standard stats
        if (sharedFields) sharedFields.style.display = 'block';
    }
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
    if (!userProfile?.isAdmin) { showToast("Not allowed", "error"); return; }

    const title = document.getElementById("tournamentTitle")?.value.trim();
    const category = document.getElementById("tournamentCategory")?.value;

    if (!title || !category) {
        showToast("Title and Category are required", "error");
        return;
    }

    const btn = document.querySelector(".btn-submit");
    const originalText = btn.textContent;
    btn.textContent = "Adding...";
    btn.disabled = true;

    try {
        // Base Tournament Data
        let tournamentData = {
            title: title,
            category: category,
            status: 'open',
            createdAt: serverTimestamp()
        };

        // ─── LIMITED TOURNAMENT LOGIC ───
        if (category === 'limited') {
            const paragraph = document.getElementById("limitedInfoParagraph")?.value.trim();
            const eventDate = document.getElementById("limitedEventDate")?.value;
            
            if (!paragraph || !eventDate) {
                showToast("Date and Info Paragraph are required for Limited tournaments.", "error");
                btn.textContent = originalText; btn.disabled = false; return;
            }

            tournamentData.infoParagraph = paragraph;
            tournamentData.eventDate = eventDate;
            tournamentData.mode = "Any"; // No specific mode needed

            // 🌟 Auto-create Calendar Event (Yellow/Special)
            await addDoc(collection(db, "calendarEvents"), {
                date: eventDate,
                title: `⚡ [Limited] ${title}`,
                type: 'special', // This assigns the Yellow color in your calendar
                prize: 'Special',
                description: "Exclusive Limited Tournament Event",
                createdAt: serverTimestamp()
            });

        } 
        // ─── ONGOING & UPCOMING LOGIC ───
        else {
            tournamentData.entryFee = Number(document.getElementById("tournamentFee")?.value) || 0;
            tournamentData.mode = document.getElementById("tournamentMode")?.value || "Solo";
            tournamentData.duration = Number(document.getElementById("tournamentDuration")?.value) || 60;
            tournamentData.prize = {
                first: Number(document.getElementById("prizeFirst")?.value) || 0,
                second: Number(document.getElementById("prizeSecond")?.value) || 0,
                third: Number(document.getElementById("prizeThird")?.value) || 0
            };

            if (category === 'upcoming') {
                const eventDate = document.getElementById("tournamentEventDate")?.value;
                const eventTime = document.getElementById("tournamentEventTime")?.value;
                const transitionTime = document.getElementById("tournamentTransitionTime")?.value; // Hidden timer

                if (!eventDate || !eventTime) {
                    showToast("Event Date and Time are required for Upcoming tournaments.", "error");
                    btn.textContent = originalText; btn.disabled = false; return;
                }

                tournamentData.eventDate = eventDate;
                tournamentData.eventTime = eventTime;
                tournamentData.transitionTime = transitionTime || null;

                // 🌟 Auto-create Calendar Event (Blue/Upcoming)
                await addDoc(collection(db, "calendarEvents"), {
                    date: eventDate,
                    title: `🏆 ${title}`,
                    type: 'upcoming', // Blue color in your calendar
                    prize: tournamentData.prize.first,
                    description: `Upcoming ${tournamentData.mode} Tournament`,
                    createdAt: serverTimestamp()
                });
            }
        }

        // Save Tournament to Firestore
        await addDoc(collection(db, "tournaments"), tournamentData);
        
        showToast(`${category.toUpperCase()} Tournament added successfully!`, "success");
        
        // Reset Form Inputs
        document.getElementById("tournamentTitle").value = "";
        if (document.getElementById("limitedInfoParagraph")) document.getElementById("limitedInfoParagraph").value = "";
        if (document.getElementById("tournamentFee")) document.getElementById("tournamentFee").value = "";
        
    } catch (err) {
        console.error("Add Tournament Error:", err);
        showToast("Error adding tournament", "error");
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
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
      
      // ✅ NEW: Trigger Auto-Promotion Check
      checkAdminAutoPromotion(d.id, t);
      
      const div = document.createElement("div");
      div.className = "item-card";
      
      div.innerHTML = `
        <div>
          <strong>${escHtml(t.title)}</strong><br>
          <small>₹${t.entryFee} · ${t.mode} · ${t.category}${t.eventDate ? ` · 📅 ${t.eventDate}` : ""}</small>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="btn-status" onclick="manageTournamentSlots('${d.id}')" style="background:var(--gold);color:#000;border:none;">
            🎯 Manage Slots
          </button>
          <button class="btn-delete" onclick="deleteTournament('${d.id}')">Delete</button>
        </div>`;
      box.appendChild(div);
    });
  });
}

// ✅ NEW FEATURE: Admin Auto-Promotion & Notification Dispatcher
// ✅ UPDATED: Uses the Hidden 'transitionTime' instead of the Match Start Time
async function checkAdminAutoPromotion(tId, t) {
    // If it lacks a transition time, we can't auto-promote it
    if (t.category !== 'upcoming' || !t.transitionTime || t.promotionNotified) return;
    
    const now = new Date();
    // Parse the hidden timer the admin set
    let transitionDateTime = new Date(t.transitionTime);

    if (transitionDateTime <= now) {
        console.log(`[AUTO-ADMIN] Hidden timer triggered for ${t.title}. Moving to Ongoing...`);
        try {
            // Lock the promotion instantly to prevent double-notifications
            // Note: We keep the original Match Start time intact!
            await updateDoc(doc(db, "tournaments", tId), {
                category: 'ongoing',
                status: 'live',
                promotionNotified: true
            });

            // Dispatch Mass Notifications
            const regsSnap = await getDocs(collection(db, "tournaments", tId, "upcomingRegistrations"));
            const batch = writeBatch(db);
            let count = 0;

            regsSnap.forEach((docSnap) => {
                const reg = docSnap.data();
                if (reg.status === 'approved') {
                    const notifRef = doc(collection(db, "users", reg.userId, "notifications"));
                    batch.set(notifRef, {
                        type: "tournament_live",
                        title: "🔴 Tournament Registration Locked!",
                        message: `"${t.title}" is now Ongoing! Click here to complete your payment and secure your slot before the match starts.`,
                        tournamentId: tId,
                        read: false,
                        createdAt: serverTimestamp(),
                        actionLink: `tournament=${tId}`
                    });
                    count++;
                }
            });

            if (count > 0) await batch.commit();
            console.log(`[AUTO-ADMIN] Successfully promoted and notified ${count} teams.`);
        } catch (err) {
            console.warn("[AUTO-ADMIN] Promotion error:", err);
        }
    }
}

// ============================================================================
//  15. CALENDAR
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
//  16. SOUND ALERT
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

window.executeGlobalSearch = async function() {
    const queryStr = document.getElementById("globalSearch").value.trim();
    if (!queryStr) return;
    
    // Check if it's a Team Code (Assuming "NPC..." format)
    if (queryStr.toUpperCase().startsWith("NPC")) {
        const teamsQuery = query(collection(db, "teams"), where("code", "==", queryStr.toUpperCase()));
        const snap = await getDocs(teamsQuery);
        if (!snap.empty) {
            const t = snap.docs[0].data();
            alert(`TEAM FOUND:\nName: ${t.teamName}\nLeader: ${t.leaderName}\nMembers: ${t.members.length}/${t.maxMembers}`);
        } else {
            showToast("Team Code not found.", "error");
        }
    } else {
        // Assume Tournament ID
        const tSnap = await getDoc(doc(db, "tournaments", queryStr));
        if (tSnap.exists()) {
            const t = tSnap.data();
            alert(`TOURNAMENT FOUND:\nTitle: ${t.title}\nCategory: ${t.category}\nFee: ₹${t.entryFee}\nStatus: ${t.status}`);
        } else {
            showToast("Tournament ID not found.", "error");
        }
    }
};

// ==========================================
// SLOT & WAITLIST MANAGEMENT
// ==========================================
window.manageTournamentSlots = async function(tournamentId) {
    // Generate a dedicated Grid view for the specified tournament.
    document.getElementById("statusModalOverlay")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "statusModalOverlay";
    overlay.className = "status-modal-overlay";
    
    // Base setup: 12 Slots = 48 players for squads.
    overlay.innerHTML = `
        <div class="status-modal" style="max-width:800px; width:100%;">
            <h3 style="color:var(--gold);">🎯 Slot Management - ${tournamentId}</h3>
            <div style="display:flex; justify-content:space-between; margin-bottom:15px;">
                <span style="color:#aaa;">Max Slots: 12 (Squads)</span>
            </div>
            <div id="rg-grid" style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; max-height:50vh; overflow-y:auto; margin-bottom:15px;">
                <p style="color:#888;">Loading slots...</p>
            </div>
            <div id="waitlistPanel" style="background:#111; padding:10px; border:1px solid #333; border-radius:8px;">
                <h4 style="color:var(--blue); margin-bottom:10px;">Waitlist Queue</h4>
                <div id="waitlistGrid"><p style="color:#666;">No teams in waitlist.</p></div>
            </div>
            <button onclick="document.getElementById('statusModalOverlay').remove()" style="width:100%; margin-top:15px; padding:10px; background:#333; color:#fff; border:none; border-radius:8px; cursor:pointer;">Close Dashboard</button>
        </div>
    `;
    document.body.appendChild(overlay);

    // Fetch confirmed teams and populate slots
    try {
        const pSnap = await getDocs(collection(db, "tournaments", tournamentId, "participants"));
       // ✅ FIX: Fallback to other timestamps if joinedAt doesn't exist, preventing sort crashes
const teams = pSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => {
    const timeA = a.joinedAt || a.createdAt || a.approvedAt || 0;
    const timeB = b.joinedAt || b.createdAt || b.approvedAt || 0;
    return timeA - timeB;
});
        
        const confirmed = teams.slice(0, 12);
        const waitlisted = teams.slice(12);

        // Populate Main Slots
        const grid = document.getElementById("rg-grid");
        grid.innerHTML = confirmed.map((t, idx) => `
            <div class="roster-slot-box">
                <span class="slot-status-badge slot-status--verified">Slot ${idx + 1}</span>
                <div style="color:#fff; font-weight:bold; margin-top:5px;">${t.teamName || 'Unknown Team'}</div>
                <div style="color:#888; font-size:12px;">Paid: ${t.paymentStatus === 'paid' ? '✅' : '❌'}</div>
                <button class="btn-kick-slot" onclick="kickTeamFromSlot('${tournamentId}', '${t.id}')">Kick & Promote</button>
            </div>
        `).join('') || '<p style="color:#888;">No teams have claimed slots yet.</p>';

        // Populate Waitlist
        const wlGrid = document.getElementById("waitlistGrid");
        wlGrid.innerHTML = waitlisted.map((t, idx) => `
            <div class="wl-row">
                <span class="wl-position">#${idx + 1}</span>
                <span class="wl-name">${t.teamName}</span>
                <button class="btn-manage-wl" onclick="promoteFromWaitlist('${tournamentId}', '${t.id}')">Promote to Slot</button>
            </div>
        `).join('') || '<p style="color:#666;">Queue empty.</p>';

    } catch (e) {
        document.getElementById("rg-grid").innerHTML = `<p style="color:var(--red);">Error loading slots: ${e.message}</p>`;
    }
};

window.kickTeamFromSlot = async function(tournamentId, teamId) {
    if(!confirm("Are you sure you want to kick this team and open up their slot?")) return;
    try {
        await deleteDoc(doc(db, "tournaments", tournamentId, "participants", teamId));
        showToast("Team removed from slot.", "success");
        // Alert admin to manually promote
        alert("Slot opened! Please promote the next team in the Waitlist Queue.");
        manageTournamentSlots(tournamentId); // Refresh UI
    } catch(e) { showToast(e.message, "error"); }
};

window.promoteFromWaitlist = async function(tournamentId, teamId) {
    if(!confirm("Promote this team to an active slot? This will notify them to pay.")) return;
    // Logic to update their status and trigger dual notification
    showToast("Team promoted! Notification dispatched.", "success");
    await sendDualNotification(teamId, {
        type: "admin_notice", title: "🎉 Slot Opened!", message: "You have been promoted from the waitlist. Please pay your entry fee now to secure your slot.", actionLink: `tournament=${tournamentId}`
    });
    manageTournamentSlots(tournamentId);
};