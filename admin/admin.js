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
    getFirestore, collection, doc, getDocs, getDoc, updateDoc, setDoc, deleteDoc,
    query, where, orderBy, onSnapshot, writeBatch, serverTimestamp, addDoc, limit, collectionGroup, increment
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
    // Pass docId to debounce — same new verification doc won't double-beep
    snap.docChanges().forEach(c => { if (c.type === "added") playAdminAlert(c.doc.id); });
    updateTabBadge("verificationBadge", snap.size);
  }, err => {
    // Fallback if composite index not yet created — query without archived filter
    console.warn("Badge listener (archived filter) failed, falling back:", "Permission Denied or Invalid Data");
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
    // ✅ FIX: Sound alert for new upcoming registrations (badge listener)
    // Pass docId to debounce — prevents double-beep if registrations tab is also open
    snap.docChanges().forEach(c => {
      const grandparentColId = c.doc.ref.parent.parent?.parent?.id;
      if (c.type === "added" && grandparentColId === "tournaments") playAdminAlert(c.doc.id);
    });
    // ✅ FIX: Only count tournament-side docs (not user mirror docs)
    const tournamentSideCount = snap.docs.filter(d => d.ref.parent.parent?.parent?.id === "tournaments").length;
    updateTabBadge("registrationBadge", tournamentSideCount);
  }, () => {
    // Fallback
    onSnapshot(
      query(collectionGroup(db, "upcomingRegistrations"), where("status", "==", "pending")),
      (snap) => {
        const tournamentSideCount = snap.docs.filter(d => d.ref.parent.parent?.parent?.id === "tournaments").length;
        updateTabBadge("registrationBadge", tournamentSideCount);
      }
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
      if (c.type === "added" && c.doc.data().status === "pending") playAdminAlert(c.doc.id);
    });
    renderVerificationList(snapshot);
  }, err => {
    container.innerHTML = `<p style="color:var(--red);padding:20px;">Error: Permission Denied or Invalid Data</p>`;
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

  // ✅ FIX: Detect if it is a resubmission by checking for leftover rejection notes
  const isResubmitted = type === "new" && (d.rejectionNote || d.rejectionReason);
  
  const badgeHtml = isResubmitted
    ? `<span style="background:var(--orange, #ff9800); color:#000; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:bold; margin-left:8px;">⚠️ Resubmitted</span>`
    : (type === "new" ? `<span style="background:var(--blue, #4a90e2); color:#fff; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:bold; margin-left:8px;">🆕 New</span>` : "");

  let actions = "";
  if (type === "new") {
    const appData = {
      teamName: d.teamName || "—",
      leaderEmail: d.leaderEmail || "—",
      phone: d.phone || "—",
      backupEmail: d.backupEmail || "—",   // ✅ FIX: Include backup Gmail
      uids: d.uids || [],
      playersData: d.playersData || d.uids?.map((uid, i) => ({
        uid: uid,
        type: d[`typePlayer${i+1}`] || "friend", // Captures NPC User status
        nickname: d[`nickPlayer${i+1}`] || d[`player${i+1}Nickname`] || ""
      })) || []
    };
    
    actions = `
      <div style="display:flex; flex-direction:column; gap:8px; width:100%; margin-top:10px;">
        <button class="btn-view" style="width:100%; padding:10px; font-size:14px; box-sizing:border-box;" 
          onclick="openAdminReviewModal('${d.tournamentId}', '${d.id}', '${encodeURIComponent(JSON.stringify(appData))}', 'ongoing')">
          🔍 Review Application
        </button>
      </div>
    `;
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
    <div class="app-card ${type}" id="appcard-${d.id}" style="${isResubmitted ? 'border-left: 4px solid #ff9800;' : ''}">
      <div class="app-card-info">
        <div style="font-size:11px; color:var(--muted); margin-bottom:4px; font-family:monospace; text-transform:uppercase; letter-spacing:1px;">
            🏆 TOURN ID: <span style="color:var(--blue); font-weight:bold;">${d.tournamentId}</span>
        </div>
        <strong style="display:flex; align-items:center; flex-wrap:wrap; gap:4px;">${escHtml(d.teamName ?? "—")} ${badgeHtml}</strong>
        <small>Leader: ${escHtml(d.leaderEmail ?? "—")}</small>
        ${d.rejectionNote ? `<small style="color:var(--red);">Reason: ${escHtml(d.rejectionNote)}</small>` : ""}
      </div>
      <div class="app-card-actions">
        <span class="status-pill ${pillClass}">${pillLabel}</span>
        ${actions}
      </div>
    </div>`;
}

// ============================================================================
//  5. REMOVE APPLICATION (Ongoing tab)
//  Notifies team BEFORE archiving so they know what happened
// ============================================================================
window.removeApplication = async function(tournamentId, userId) {
  if (!confirm("Remove this application from the list? The team will be notified.")) return;
  try {
    // Fetch team name and tournament name before archiving so we can notify properly
    let teamName = "Your team";
    let tournamentName = tournamentId;
    let memberIds = [userId];
    try {
      const vSnap = await getDoc(doc(db, "tournaments", tournamentId, "verifications", userId));
      if (vSnap.exists()) teamName = vSnap.data().teamName || teamName;
      const tSnap = await getDoc(doc(db, "tournaments", tournamentId));
      if (tSnap.exists()) tournamentName = tSnap.data().title || tournamentName;
      const uSnap = await getDoc(doc(db, "users", userId));
      if (uSnap.exists() && uSnap.data().teamId) {
        const tmSnap = await getDoc(doc(db, "teams", uSnap.data().teamId));
        if (tmSnap.exists()) memberIds = [...new Set([...(tmSnap.data().members || []), userId])];
      }
    } catch (_) {}

    await updateDoc(doc(db, "tournaments", tournamentId, "verifications", userId), {
      archived:   true,
      archivedAt: serverTimestamp(),
    });

    // Notify every team member
    await Promise.all(memberIds.map(mid => sendDualNotification(mid, {
      type:       "application_removed",
      title:      "⚠️ Application Removed",
      message:    `Your application for "${tournamentName}" was removed from the Verification stage. If this was a mistake, tap to re-submit.`,
      extra:      { tournamentId, tournamentName, stage: "ongoing", teamName },
      actionLink: `resubmit=ongoing&tournament=${tournamentId}`,
      silent:     true
    })));

    // Immediate UI removal — don’t wait for snapshot
    document.getElementById(`appcard-${userId}`)?.remove();
    showToast("Application removed & team notified.", "success");
  } catch (e) {
    showToast("Error removing: Permission Denied.", "error");
  }
};


// ============================================================================
//  6. STATUS MODAL  (Accepted applications)
//  UPGRADE: replaced Payment Status row with 5-stage progress tracker
//  ADDED: "Notify This Team" button + Room ID & Password management
// ============================================================================
window.viewStatusModal = async function(tournamentId, userId) {
  // Store the listener so we can stop it when modal closes
  if (window._statusModalListener) {
    window._statusModalListener(); // Cleanup any existing listener
  }

  try {
    const [vSnap, pSnap] = await Promise.all([
      getDoc(doc(db, "tournaments", tournamentId, "verifications", userId)),
      getDoc(doc(db, "tournaments", tournamentId, "participants", userId)),
    ]);

    const v = vSnap.exists() ? vSnap.data() : {};
    const p = pSnap.exists() ? pSnap.data() : {};
    const processedAt = v.processedAt?.toDate?.()?.toLocaleString("en-IN") ?? "—";

    // Remove any existing modal
    document.getElementById("statusModalOverlay")?.remove();

    // Create modal (without innerHTML update function yet)
    const overlay = document.createElement("div");
    overlay.id = "statusModalOverlay";
    overlay.className = "status-modal-overlay";

    // Create content container that we'll update
    const contentDiv = document.createElement("div");
    contentDiv.className = "status-modal";
    contentDiv.style.cssText = "max-width:520px;width:100%;";

    overlay.appendChild(contentDiv);
    document.body.appendChild(overlay);

    // Close on backdrop click
    overlay.addEventListener("click", e => {
      if (e.target === overlay) {
        if (window._statusModalListener) {
          window._statusModalListener();
          window._statusModalListener = null;
        }
        overlay.remove();
      }
    });

    // Function to render/update the modal content
    function renderStatusContent(pData) {
      const processedAt = v.processedAt?.toDate?.()?.toLocaleString("en-IN") ?? "—";
      
      // Stage calculations from live data
      const stage3 = ["submitted","paid","verified"].includes(pData.paymentStatus);
      const stage4 = pData.paymentStatus === "verified";
      const stage5 = pData.confirmationReceived === true;

      contentDiv.innerHTML = `
        <h3>📊 Team Status — ${escHtml(v.teamName ?? "—")}</h3>

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
        ${v.phone ? `<div class="status-row"><span class="s-label">Phone</span><span class="s-value">${escHtml(v.phone)}</span></div>` : ""}
        ${pData.transactionCode ? `<div class="status-row"><span class="s-label">Transaction ID</span><span class="s-value" style="font-family:monospace;color:var(--gold);">${escHtml(pData.transactionCode)}</span></div>` : ""}

        <div style="margin:20px 0 6px;">
          <p style="color:var(--muted);font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;">Application Progress</p>
          ${progressTracker([
            { label: "Application Submitted",  done: true  },
            { label: "Verification Approved",  done: true  },
            { label: "Payment Completed",       done: stage3 },
            { label: "Payment Verified",        done: stage4 },
            { label: "Confirmation Received",  done: stage5 },
          ])}
        </div>

        <!-- Live indicator -->
        <div id="confirmationLiveIndicator" style="text-align:center;margin:10px 0;">
          ${stage5 
            ? `<span style="background:var(--green);color:#000;padding:8px 16px;border-radius:20px;font-weight:bold;font-size:13px;">✅ Confirmation Received!</span>`
            : `<span style="background:#333;color:#888;padding:8px 16px;border-radius:20px;font-size:13px;">⏳ Waiting for user confirmation...</span>`
          }
        </div>

        <!-- Room ID & Password -->
        <div style="margin:18px 0;padding:14px;background:#0f0f0f;border-radius:10px;border:1px solid var(--border);">
          <p style="color:var(--muted);font-size:11px;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;">🔑 Room ID & Password</p>
          <div style="display:flex;gap:8px;margin-bottom:8px;">
            <input id="smRoomId" placeholder="Room ID" value="${escHtml(pData.roomId ?? "")}" style="flex:1;padding:8px 12px;background:#1a1a1a;border:1px solid #333;color:#fff;border-radius:6px;font-family:inherit;font-size:13px;">
            <input id="smRoomPass" placeholder="Password" value="${escHtml(pData.roomPassword ?? "")}" style="flex:1;padding:8px 12px;background:#1a1a1a;border:1px solid #333;color:#fff;border-radius:6px;font-family:inherit;font-size:13px;">
          </div>
          <button onclick="saveRoomDetails('${tournamentId}','${userId}',${JSON.stringify(Array.isArray(v.uids) ? v.uids : [userId]).replace(/"/g,"'")})" style="width:100%;padding:9px;background:var(--blue);color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:13px;">💾 Save & Notify Team</button>
        </div>

        <div style="display:flex;gap:8px;margin-top:4px;">
          <button onclick="openNotifyModal('${tournamentId}','${userId}',${JSON.stringify(Array.isArray(v.uids) ? v.uids : [userId]).replace(/"/g,"'")},'${escHtml(v.teamName ?? "Team")}')" style="flex:1;padding:10px;background:var(--green);color:#000;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:13px;">🔔 Notify This Team</button>
        </div>

        <button onclick="document.getElementById('statusModalOverlay').remove(); if(window._statusModalListener){window._statusModalListener();window._statusModalListener=null;}" style="width:100%;margin-top:10px;background:transparent;color:var(--muted);border:none;cursor:pointer;font-family:inherit;padding:8px;">Close</button>
      `;
    }

    // Initial render
    renderStatusContent(p);

    // ✅ THE KEY FIX: Real-time listener for live updates
    const participantRef = doc(db, "tournaments", tournamentId, "participants", userId);
    window._statusModalListener = onSnapshot(participantRef, (snap) => {
      if (!snap.exists()) return;
      const updatedData = snap.data();
      console.log("[STATUS] Live update received:", updatedData);
      // Re-render with updated data
      renderStatusContent(updatedData);
    }, (err) => {
      console.error("[STATUS] Listener error:", err);
    });

  } catch (e) {
    showToast("Error loading status: Permission Denied.", "error");
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
    showToast("Action failed: Permission Denied.", "error");
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

// WITH THIS
window.sendTeamNotification = async function(tournamentId, userId, memberIds, teamName) {
  const message = document.getElementById("notifyMsgInput")?.value.trim();
  if (!message) { showToast("Please enter a message.", "warning"); return; }

  const ids = Array.isArray(memberIds) ? memberIds : [userId];

  try {
    // 1. Write directly to the live Participant doc so the frontend pops up immediately
    try {
        await updateDoc(doc(db, "tournaments", tournamentId, "participants", userId), {
            statusMessage: message,
            statusMessageShown: false,
            statusMessageUpdatedAt: serverTimestamp()
        });
    } catch (ignore) { /* Document might not exist yet, this is fine */ }

    // 2. Send dual notification so it lands perfectly in the Inbox!
    await Promise.all(ids.map(mid => sendDualNotification(mid, {
      type:      "status_message", // FIXED: Matches frontend inbox icons/clicks
      title:     "💬 Message from Admin",
      message,
      extra:     { tournamentId, teamName },
      actionLink: `tournament=${tournamentId}`,
    })));

    document.getElementById("notifyModalOverlay")?.remove();
    showToast(`Notification sent to ${ids.length} member(s)!`, "success");
  } catch (e) {
    showToast("Action failed: Permission Denied.", "error");
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
async function sendDualNotification(userId, { type, title, message, extra = {}, actionLink = "", silent = false }) {
  // A. In-app (MANDATORY — never skip)
  try {
      await addDoc(collection(db, "users", userId, "notifications"), {
        type,
        title,
        message,
        ...extra,
        actionLink,
        read:       false,
        // If silent is true, we pretend the popup was already shown so the client UI skips the popup bubble,
        // but since read is false, it still shows up in the notification inbox.
        popupShown: silent ? true : false,
        createdAt:  serverTimestamp(),
      });
  } catch (err) {
      console.error("Failed to send in-app notification:", err);
  }

  // B. Push (optional — write to pushQueue; Cloud Function handles FCM)
  // FIX: Skip push queue for obvious test accounts like "1111" to prevent database errors
  if (!userId || userId.length < 10) {
      return; 
  }

  // If the notification is explicitly marked silent, don't trigger a push notification either.
  if (silent) {
      return;
  }

  try {
    await addDoc(collection(db, "pushQueue", userId, "tasks"), {
      type,
      title,
      message,
      ...extra,
      createdAt: serverTimestamp(),
      sent:      false,    // Cloud Function flips this to true after sending
    });
  } catch (err) {
    // Push queue failure must NEVER break in-app notifications
    // FIX: Changed from console.warn to console.debug so it doesn't clutter your console with yellow errors
    console.debug(`[Push] Skipped queue for ${userId}. (Usually means test account or offline)`);
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
    showToast("Action failed: Permission Denied.", "error");
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
      console.warn("Team lookup failed:", "Permission Denied or Invalid Data");
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
    showToast("Action failed: Permission Denied.", "error");
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
    showToast("Action failed: Permission Denied.", "error");
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
    // ✅ FIX: Trigger sound alert for new pending registrations
    // Pass docId to debounce — badge listener may have already played for this doc
    snapshot.docChanges().forEach(c => {
      // Only fire alert for documents in tournaments/.../upcomingRegistrations (not users/...)
      // The parent of the subcollection is the tournament doc; its collection is "tournaments"
      const grandparentColId = c.doc.ref.parent.parent?.parent?.id;
      if (c.type === "added" && c.doc.data().status === "pending" && grandparentColId === "tournaments") {
        playAdminAlert(c.doc.id);
      }
    });

    const pending  = [];
    const approved = [];
    const rejected = [];

    snapshot.forEach(d => {
      // ✅ FIX: Only process documents from tournaments/.../upcomingRegistrations (not users/...)
      // d.ref.parent.parent is the tournament doc; d.ref.parent.parent.parent is "tournaments" collection
      const grandparentColId = d.ref.parent.parent?.parent?.id;
      if (grandparentColId !== "tournaments") return; // SKIP user-side mirror documents

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
    container.innerHTML = `<p style="color:var(--red);padding:20px;">Error: Permission Denied or Invalid Data</p>`;
  });
}

function upcomingCard(d, type) {
  const pillClass = type === "new" ? "pill-new" : type === "accepted" ? "pill-accepted" : "pill-rejected";
  const pillLabel = type === "new" ? "PENDING"  : type === "accepted" ? "APPROVED"     : "REJECTED";
  const eventDate = d.eventDate
    ? new Date(d.eventDate).toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" })
    : "TBA";

  // ✅ FIX: Detect if it is a resubmission
  const isResubmitted = type === "new" && (d.rejectionNote || d.rejectionReason);
  
  const badgeHtml = isResubmitted
    ? `<span style="background:var(--orange, #ff9800); color:#000; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:bold; margin-left:8px;">⚠️ Resubmitted</span>`
    : (type === "new" ? `<span style="background:var(--blue, #4a90e2); color:#fff; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:bold; margin-left:8px;">🆕 New</span>` : "");


  let actions = "";
  if (type === "new") {
    const appData = {
      teamName: d.teamName || "—",
      leaderEmail: d.leaderEmail || "—",
      phone: d.phone || "—",
      backupEmail: d.backupEmail || "—",   // ✅ FIX: Include backup Gmail
      uids: d.uids || [],
      playersData: d.playersData || d.uids?.map((uid, i) => ({
        uid: uid,
        type: d[`typePlayer${i+1}`] || "friend", // Captures NPC User status
        nickname: d[`nickPlayer${i+1}`] || d[`player${i+1}Nickname`] || ""
      })) || []
    };

    actions = `
      <div style="display:flex; flex-direction:column; gap:8px; width:100%; margin-top:10px;">
        <button class="btn-view" style="width:100%; padding:10px; font-size:14px; box-sizing:border-box;" 
          onclick="openAdminReviewModal('${d.tournamentId}', '${d.id}', '${encodeURIComponent(JSON.stringify(appData))}', 'upcoming')">
          🔍 Review Registration
        </button>
      </div>
    `;
  } else if (type === "accepted") {
    // ✅ FIX 1: Added the Status button so you can track pre-payments!
    actions = `
      <button class="btn-status" onclick="viewStatusModal('${d.tournamentId}','${d.id}')">📊 Status</button>
      <button class="btn-remove" onclick="removeUpcoming('${d.tournamentId}','${d.id}','${d.id}')" id="regcard-${d.id}">Remove</button>
    `;
  } else {
    actions = `<button class="btn-remove" onclick="removeUpcoming('${d.tournamentId}','${d.id}','${d.id}')" id="regcard-${d.id}">Remove</button>`;
  }

  return `
    <div class="app-card ${type}" id="regcard-${d.id}" style="${isResubmitted ? 'border-left: 4px solid #ff9800;' : ''}">
      <div class="app-card-info">
        <div style="font-size:11px; color:var(--muted); margin-bottom:4px; font-family:monospace; text-transform:uppercase; letter-spacing:1px;">
            📅 TOURN ID: <span style="color:var(--green); font-weight:bold;">${d.tournamentId}</span>
        </div>
        <strong style="display:flex; align-items:center; flex-wrap:wrap; gap:4px;">${escHtml(d.teamName ?? "—")} ${badgeHtml}</strong>
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
// WITH THIS
window.approveUpcoming = async function(tournamentId, userId) {
    try {
        // ✅ FIX: Fetch the actual registration document so we can copy the Player UIDs and Nicknames into the Slot
        const regRef = doc(db, "tournaments", tournamentId, "upcomingRegistrations", userId);
        const regSnap = await getDoc(regRef);
        const regData = regSnap.exists() ? regSnap.data() : {};

        // ✅ FIX: Use writeBatch to update BOTH the tournament doc AND the user's personal log
        // This ensures the user's dashboard card changes from "pending" to "accepted" immediately.
        const batch = writeBatch(db);
        
        // 1. Update the tournament's upcomingRegistrations sub-collection (admin view)
        batch.update(regRef, {
            status:      "approved",
            processedAt: serverTimestamp()
        });
        
        // 2. ✅ FIX: Update the USER'S personal registration log (user view)
        //    This is the document their dashboard reads. Without this, user stays on "pending".
        const userRegRef = doc(db, "users", userId, "upcomingRegistrations", tournamentId);
        batch.set(userRegRef, {
            status:        "accepted",
            paymentStatus: "pending",
            processedAt:   serverTimestamp(),
            tournamentId:  tournamentId
        }, { merge: true }); // merge:true is safe — won't erase existing fields
        
        await batch.commit();

        // 3. Resolve all team members to notify (fetch team members)
        let allMemberIds = [userId];
        try {
            const uSnap = await getDoc(doc(db, "users", userId));
            if (uSnap.exists() && uSnap.data().teamId) {
                const tSnap = await getDoc(doc(db, "teams", uSnap.data().teamId));
                if (tSnap.exists()) {
                    // ✅ FIX: Use Set to deduplicate — prevents double-notification
                    allMemberIds = [...new Set([...(tSnap.data().members ?? []), userId])];
                }
            }
        } catch (_) {}
        
        // 4. ✅ FIX: Also auto-create the slot entry so Slot Management table is never "undefined"
        try {
            const uSnap = await getDoc(doc(db, "users", userId));
            if (uSnap.exists()) {
                const uData = uSnap.data();
                if (uData.teamId) {
                    const tSnap = await getDoc(doc(db, "teams", uData.teamId));
                    if (tSnap.exists()) {
                        const tData = tSnap.data();
                       // WITH THIS
                        // ✅ FIX: Deduplicate members before writing slot
                        const deduped = [...new Set([...(tData.members || []), userId])];
                        
                        await setDoc(doc(db, "tournaments", tournamentId, "slots", uData.teamId), {
                            teamId:        uData.teamId,
                            teamName:      regData.teamName || uData.teamName  || tData.teamName  || "Unknown Team",
                            teamCode:      regData.teamCode || uData.teamCode  || tData.code      || "N/A",
                            members:       deduped,
                            memberCount:   deduped.length,
                            leaderId:      tData.leaderId  || userId,
                            leaderEmail:   uData.email     || "",
                            paymentStatus: "Pending Payment", // ✅ Explicit string — never "undefined"
                            playersData:   regData.playersData || null, // Copies actual In-game UIDs/Nicknames
                            uids:          regData.uids || null,
                            nickPlayer1:   regData.nickPlayer1 || regData.player1Nickname || null,
                            nickPlayer2:   regData.nickPlayer2 || regData.player2Nickname || null,
                            nickPlayer3:   regData.nickPlayer3 || regData.player3Nickname || null,
                            nickPlayer4:   regData.nickPlayer4 || regData.player4Nickname || null,
                            assignedAt:    serverTimestamp()
                        }, { merge: true });
                    }
                }
            }
        } catch (slotErr) {
            // Slot write failure must not block the approval
            console.warn("[SLOT AUTO-FILL] Failed:", "Permission Denied or Invalid Data");
        }

        // 5. Send dual notifications to all members
        await Promise.all(allMemberIds.map(mid => sendDualNotification(mid, {
            type:       "upcoming_approved",
            title:      "Registration Approved! 🎉",
            message:    "Your upcoming tournament registration has been approved! Stay tuned for match details.",
            extra:      { tournamentId },
            actionLink: `tournament=${tournamentId}`,
        })));

        showToast(`Registration approved! Notified ${allMemberIds.length} member(s).`, "success");
        
    } catch (e) {
        showToast("Error approving: Permission Denied.", "error");
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
    showToast("Action failed: Permission Denied.", "error");
  }
};

// BUG FIX: immediate DOM removal on removeUpcoming + team notification
window.removeUpcoming = async function(tournamentId, userId, cardId) {
  if (!confirm("Remove this registration? The team will be notified.")) return;
  try {
    // Gather info before archiving
    let tournamentName = tournamentId;
    let memberIds = [userId];
    try {
      const tSnap = await getDoc(doc(db, "tournaments", tournamentId));
      if (tSnap.exists()) tournamentName = tSnap.data().title || tournamentName;
      const uSnap = await getDoc(doc(db, "users", userId));
      if (uSnap.exists() && uSnap.data().teamId) {
        const tmSnap = await getDoc(doc(db, "teams", uSnap.data().teamId));
        if (tmSnap.exists()) memberIds = [...new Set([...(tmSnap.data().members || []), userId])];
      }
    } catch (_) {}

    await updateDoc(doc(db, "tournaments", tournamentId, "upcomingRegistrations", userId), {
      archived: true, archivedAt: serverTimestamp(),
    });

    // Notify every team member
    await Promise.all(memberIds.map(mid => sendDualNotification(mid, {
      type:       "application_removed",
      title:      "⚠️ Registration Removed",
      message:    `Your registration for "${tournamentName}" was removed from the Registration stage. If this was a mistake, tap to re-submit.`,
      extra:      { tournamentId, tournamentName, stage: "upcoming" },
      actionLink: `resubmit=upcoming&tournament=${tournamentId}`,
      silent:     true
    })));

    document.getElementById(`regcard-${cardId}`)?.remove();
    showToast("Removed & team notified.", "success");
  } catch (e) {
    showToast("Action failed: Permission Denied.", "error");
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
    showToast("Login failed: Invalid credentials or Permission Denied.", "error");
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

// ✅ Fix - use auth.currentUser instead, since the auth guard already verified admin
window.addTournament = async function() {
    if (!auth.currentUser) { showToast("Not allowed", "error"); return; }

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
  // ✅ FIX: Protect deletion — check for any pending/approved registrations first
  try {
    const tSnap = await getDoc(doc(db, "tournaments", id));
    const tData = tSnap.exists() ? tSnap.data() : {};

    // Block if tournament is in registration or ongoing stage with active participants
    if (tData.category === "ongoing" || tData.status === "live") {
      showToast("❌ Cannot delete: This tournament is live/ongoing. Participants have registered and may have paid.", "error");
      return;
    }

    // Also check for any pending or approved upcoming registrations
    const regsSnap = await getDocs(collection(db, "tournaments", id, "upcomingRegistrations"));
    const activeRegs = regsSnap.docs.filter(d => d.data().status === "pending" || d.data().status === "approved");
    if (activeRegs.length > 0) {
      showToast(`❌ Cannot delete: ${activeRegs.length} team(s) have registered. Reject all registrations first before deleting.`, "error");
      return;
    }

    // Also check participant docs (paid users)
    const partSnap = await getDocs(collection(db, "tournaments", id, "participants"));
    if (!partSnap.empty) {
      showToast(`❌ Cannot delete: ${partSnap.size} team(s) have paid and are confirmed. This data cannot be lost.`, "error");
      return;
    }
  } catch (checkErr) {
    // If we can't check, still ask for confirmation to be safe
    console.warn("[DELETE CHECK]", checkErr);
  }

  if (!confirm("Delete this tournament? This cannot be undone.")) return;
  try {
    await deleteDoc(doc(db, "tournaments", id));
    showToast("Tournament deleted.", "success");
  } catch (e) {
    showToast("Error deleting: Permission Denied.", "error");
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

      // ✅ FIX: Visually disable Delete button for active/ongoing tournaments
      const isActive = (t.category === "ongoing" || t.status === "live");
      const deleteBtn = isActive
        ? `<button class="btn-delete" disabled title="Cannot delete: tournament is active or ongoing" style="opacity:0.35;cursor:not-allowed;" onclick="event.preventDefault();">🔒 Delete</button>`
        : `<button class="btn-delete" onclick="deleteTournament('${d.id}')">Delete</button>`;
      
      div.innerHTML = `
        <div>
          <strong>${escHtml(t.title)}</strong><br>
          <small>₹${t.entryFee} · ${t.mode} · ${t.category}${t.eventDate ? ` · 📅 ${t.eventDate}` : ""}</small>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="btn-status" onclick="manageTournamentSlots('${d.id}')" style="background:var(--gold);color:#000;border:none;">
            🎯 Manage Slots
          </button>
          ${deleteBtn}
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
    showToast("Action failed: Permission Denied.", "error");
  }
};

window.deleteCalendarEvent = async function(id) {
  if (!confirm("Delete this calendar event?")) return;
  try {
    await deleteDoc(doc(db, "calendarEvents", id));
    showToast("Event deleted.", "success");
  } catch (e) {
    showToast("Action failed: Permission Denied.", "error");
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
    showToast("Action failed: Permission Denied.", "error");
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
//  FIX: Use .mp3 file instead of AudioContext oscillator.
//  AudioContext gets suspended in background tabs by browsers and never
//  resumes reliably. new Audio() with a real file works even when the tab
//  is in the background.
//  FIX: Debounce — prevent dual listeners (badge + registrations tab) from
//  firing the same sound twice for the exact same new document.
// ============================================================================
const _alertedDocIds = new Set(); // tracks doc IDs already alerted this session

function playAdminAlert(docId) {
  // If a docId is given, only play once per unique doc per session
  if (docId) {
    if (_alertedDocIds.has(docId)) return;
    _alertedDocIds.add(docId);
  }
  try {
    const audio = new Audio('/alert.mp3');
    audio.volume = 0.8;
    audio.play().catch(() => {
      // Fallback to AudioContext beep if .mp3 is blocked
      try {
        const ctx  = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(1200, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.5, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.5);
      } catch (_) {}
    });
  } catch (_) {}
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
// =============================================================================
// UPGRADED GLOBAL SEARCH FUNCTION (Finds Team Codes, Tournaments, UIDs, & Nicknames)
// =============================================================================
window.executeGlobalSearch = async function() {
    const queryStr = document.getElementById("globalSearch").value.trim();
    if (!queryStr) return;
    
    try {
        // 1. Try to search by Team Code (Checks global teams collection)
        const teamsQuery = query(collection(db, "teams"), where("code", "==", queryStr.toUpperCase()));
        const teamSnap = await getDocs(teamsQuery);
        if (!teamSnap.empty) {
            const teamDoc = teamSnap.docs[0];
            const t = teamDoc.data();
            alert(`👥 TEAM FOUND!\n\n` +
                  `• Team Name: ${t.teamName || "—"}\n` +
                  `• Team Code: ${t.code || "—"}\n` +
                  `• Team ID: ${teamDoc.id}\n` +
                  `• Leader Name: ${t.leaderName || "—"}\n` +
                  `• Leader ID: ${t.leaderId || "—"}\n` +
                  `• Roster Size: ${t.members?.length || 0} / ${t.maxMembers || 5}\n` +
                  `• Member UIDs: ${t.members ? t.members.join(", ") : "None"}`);
            return;
        }

        // 2. Try to search by Tournament Document ID
        const tSnap = await getDoc(doc(db, "tournaments", queryStr));
        if (tSnap.exists()) {
            const t = tSnap.data();
            alert(`🏆 TOURNAMENT FOUND!\n\n` +
                  `• Tournament ID: ${tSnap.id}\n` +
                  `• Title: ${t.title || "—"}\n` +
                  `• Category: ${t.category || "—"}\n` +
                  `• Mode: ${t.mode || "Solo"}\n` +
                  `• Entry Fee: ₹${t.entryFee !== undefined ? t.entryFee : 0}\n` +
                  `• Status: ${t.status || "open"}\n` +
                  `• Event Details: ${t.eventDate || "No Date"} @ ${t.eventTime || "No Time"}`);
            return;
        }

        // 3. Try to search by exact Player Unique ID (UID)
        const uSnap = await getDoc(doc(db, "users", queryStr));
        if (uSnap.exists()) {
            const u = uSnap.data();
            alert(`👤 PLAYER FOUND BY UID!\n\n` +
                  `• User UID: ${uSnap.id}\n` +
                  `• In-Game Nickname: ${u.nickname || "Unnamed User"}\n` +
                  `• Registered Email: ${u.email || "—"}\n` +
                  `• System Role: ${u.role || "viewer"}\n` +
                  `• Is Admin Account: ${u.isAdmin === true ? "YES 🛡️" : "No"}\n` +
                  `• Assigned Team: ${u.teamName || "No Assigned Team (Solo)"}\n` +
                  `• Assigned Team Code: ${u.teamCode || "N/A"}\n` +
                  `• Assigned Team ID: ${u.teamId || "N/A"}\n` +
                  `• Player Age: ${u.age || "—"}`);
            return;
        }

        // 4. Try to search by Player Nickname (Fallback case)
        const nicknameQuery = query(collection(db, "users"), where("nickname", "==", queryStr));
        const nickSnap = await getDocs(nicknameQuery);
        if (!nickSnap.empty) {
            const userDoc = nickSnap.docs[0];
            const u = userDoc.data();
            alert(`👤 PLAYER FOUND BY NICKNAME!\n\n` +
                  `• User UID: ${userDoc.id}\n` +
                  `• In-Game Nickname: ${u.nickname || "—"}\n` +
                  `• Registered Email: ${u.email || "—"}\n` +
                  `• System Role: ${u.role || "viewer"}\n` +
                  `• Assigned Team: ${u.teamName || "No Assigned Team (Solo)"}\n` +
                  `• Assigned Team Code: ${u.teamCode || "N/A"}\n` +
                  `• Player Age: ${u.age || "—"}`);
            return;
        }

        // If the query completes execution through all loops without finding matching records
        showToast("🔍 No matching Team Code, Tournament ID, or Player UID found.", "error");

    } catch (err) {
        console.error("Global search execution error:", err);
        showToast("⚠️ Search failed: Permission Denied.", "error");
    }
};

// NEW FEATURE: Global Team Code Search
window.searchTeamByCode = async function() {
    const teamCodeInput = document.getElementById("globalTeamCodeSearchInput");
    const teamCode = teamCodeInput?.value.trim().toUpperCase();

    if (!teamCode) {
        showToast("Please enter a team code.", "warning");
        return;
    }

    try {
        const teamsQuery = query(collection(db, "teams"), where("code", "==", teamCode));
        const teamSnap = await getDocs(teamsQuery);

        if (teamSnap.empty) {
            showToast(`Team with code "${teamCode}" not found.`, "error");
            return;
        }

        const teamData = teamSnap.docs[0].data();
        openTeamDetailsModal(teamData.teamId);

    } catch (e) {
        console.error("Error searching team by code:", e);
        showToast("Error searching team: Permission Denied.", "error");
    }
};

// NEW FUNCTION: openTeamDetailsModal - Displays comprehensive team details
window.openTeamDetailsModal = async function(teamId) {
    document.getElementById("teamDetailsModalOverlay")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "teamDetailsModalOverlay";
    overlay.className = "status-modal-overlay"; // Reuse existing modal overlay styles

    overlay.innerHTML = `
        <div class="status-modal" style="max-width:600px;width:100%;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px;">
                <h3 style="color:var(--blue); margin:0;">👥 Team Details</h3>
                <button onclick="document.getElementById('teamDetailsModalOverlay').remove()" style="background:transparent;border:none;color:#888;font-size:20px;cursor:pointer;">✖</button>
            </div>
            <div id="teamDetailsContent" style="max-height:70vh; overflow-y:auto; padding-right:10px;">
                <p style="color:#888; text-align:center; padding:20px;">Loading team data…</p>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    try {
        const teamDoc = await getDoc(doc(db, "teams", teamId));
        if (!teamDoc.exists()) {
            document.getElementById("teamDetailsContent").innerHTML = `<p style="color:var(--red); text-align:center;">Team data not found.</p>`;
            return;
        }
        const teamData = teamDoc.data();

        let membersHtml = `<p style="color:#888;">No members found.</p>`;
        if (Array.isArray(teamData.members) && teamData.members.length > 0) {
            const memberPromises = teamData.members.map(uid => getDoc(doc(db, "users", uid)));
            const memberSnaps = await Promise.all(memberPromises);
            membersHtml = memberSnaps.map(snap => {
                if (!snap.exists()) return `<div style="color:#888;">Unknown User (UID: ${snap.id})</div>`;
                const u = snap.data();
                const isLeader = u.uid === teamData.leaderId;
                return `
                    <div style="background:#0f0f0f;padding:10px 14px;border-radius:8px;margin-bottom:5px;border-left:3px solid ${isLeader ? 'var(--gold)' : '#333'};">
                        <span style="color:#fff;font-weight:bold;">${escHtml(u.nickname || u.email?.split('@')[0] || 'N/A')}</span>
                        ${isLeader ? '<span style="color:var(--gold);font-size:11px;margin-left:8px;">👑 Leader</span>' : ''}
                        <br><small style="color:#888;">Email: ${escHtml(u.email || 'N/A')}</small>
                        <br><small style="color:#888;">UID: ${escHtml(u.uid || 'N/A')}</small>
                    </div>
                `;
            }).join('');
        }

        document.getElementById("teamDetailsContent").innerHTML = `
            <div style="display:grid;gap:10px;margin-bottom:20px;">
                <div class="status-row"><span class="s-label">Team Name</span><span class="s-value">${escHtml(teamData.teamName || 'N/A')}</span></div>
                <div class="status-row"><span class="s-label">Team Code</span><span class="s-value" style="color:var(--gold);font-weight:bold;">${escHtml(teamData.code || 'N/A')}</span></div>
                <div class="status-row"><span class="s-label">Leader ID</span><span class="s-value">${escHtml(teamData.leaderId || 'N/A')}</span></div>
                <div class="status-row"><span class="s-label">Members</span><span class="s-value">${teamData.members?.length || 0}/${teamData.maxMembers || 0}</span></div>
                <div class="status-row"><span class="s-label">Created At</span><span class="s-value">${teamData.createdAt?.toDate?.()?.toLocaleString("en-IN") || 'N/A'}</span></div>
            </div>
            <h4 style="color:#fff;margin-top:20px;margin-bottom:10px;border-bottom:1px solid #222;padding-bottom:5px;">Team Roster</h4>
            ${membersHtml}
        `;

    } catch (e) {
        console.error("Error loading team details:", e);
        document.getElementById("teamDetailsContent").innerHTML = `<p style="color:var(--red); text-align:center;">Error loading team details: Permission Denied or Invalid Data</p>`;
    }
};

// Add this to your existing admin.js file, perhaps near other global search functions
// or at the end of the file.
// You'll also need to add an input field and button to your admin/index.html
// For example:
// <input type="text" id="globalTeamCodeSearchInput" placeholder="Search Team Code">
// <button onclick="searchTeamByCode()">Search Team</button>

// ==========================================
// SLOT & WAITLIST MANAGEMENT
// ==========================================
window.manageTournamentSlots = async function(tournamentId) {
    document.getElementById("statusModalOverlay")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "statusModalOverlay";
    overlay.className = "status-modal-overlay";
    
    overlay.innerHTML = `
        <div class="status-modal" style="max-width:900px; width:100%;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
                <h3 style="color:var(--gold); margin:0;">🎯 Ranking Teams</h3>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                    <input type="text" id="slotSearch" placeholder="🔍 Search team or code…"
                           style="padding:8px 12px; border-radius:6px; border:1px solid #444; background:#1a1a1a; color:#fff; width:180px;"
                           onkeyup="filterSlots()">
                    <button onclick="openGlobalMessageModal('${tournamentId}')"
                        style="padding:8px 14px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:13px;font-family:inherit;">
                        📢 Global Message
                    </button>
                    <button onclick="openGlobalRoomBlast('${tournamentId}')"
                        style="padding:8px 14px;background:var(--green);color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:13px;font-family:inherit;">
                        🔑 Send Room ID
                    </button>
                </div>
            </div>
            
            <div style="display:flex; gap:10px; margin-bottom:15px; border-bottom:1px solid #333; padding-bottom:10px;">
                <button onclick="document.getElementById('tab-slots').style.display='block'; document.getElementById('tab-ranks').style.display='none'; this.style.color='var(--gold)'; this.nextElementSibling.style.color='#888';" style="background:none; border:none; color:var(--gold); font-size:15px; font-weight:bold; cursor:pointer;">1. Slots & Waitlist</button>
                <button onclick="document.getElementById('tab-slots').style.display='none'; document.getElementById('tab-ranks').style.display='block'; this.style.color='var(--gold)'; this.previousElementSibling.style.color='#888';" style="background:none; border:none; color:#888; font-size:15px; font-weight:bold; cursor:pointer;">2. Rank the Teams</button>
            </div>
            
            <div id="tab-slots">
                <div id="rg-tiebreaker-area"></div>
                <div id="rg-waitlist-bar-area"></div>
                
                <div id="table-container" style="overflow-x:auto; overflow-y:auto; max-height:75vh; margin-bottom:15px; border-radius:8px; border:1px solid #333;">
                    <p style="color:#888; padding:15px; text-align:center;">Loading slots…</p>
                </div>

                <div id="waitlistPanel" style="background:#111; padding:12px; border:1px solid #333; border-radius:8px;">
                    <h4 style="color:var(--blue); margin-bottom:10px;">📋 Waitlist Queue</h4>
                    <div id="waitlistGrid"><p style="color:#666; font-size:13px;">No teams in waitlist.</p></div>
                </div>
            </div>
            
            <div id="tab-ranks" style="display:none;">
                <div id="ranks-container" style="overflow-x:auto; overflow-y:auto; max-height:75vh; margin-bottom:15px; border-radius:8px; border:1px solid #333;">
                    <p style="color:#888; padding:15px; text-align:center;">Loading teams for ranking...</p>
                </div>
                <button onclick="saveAllTeamRankings('${tournamentId}')" style="width:100%; padding:12px; background:var(--gold); color:#000; border:none; border-radius:8px; font-weight:bold; cursor:pointer; margin-bottom:10px;">
                    💾 Save Rankings & Kills
                </button>
            </div>
            
            <button onclick="document.getElementById('statusModalOverlay').remove()"
                    style="width:100%; margin-top:14px; padding:10px; background:#333; color:#fff; border:none; border-radius:8px; cursor:pointer; font-family:inherit;">
                Close
            </button>
        </div>
    `;

    document.body.appendChild(overlay);

    try {
        // Fetch all contextual tournament sub-collections simultaneously to capture exact user form input states
        const [tSnap, slotsSnap, participantsSnap, verificationsSnap, upcomingSnap] = await Promise.all([
            getDoc(doc(db, "tournaments", tournamentId)),
            getDocs(collection(db, "tournaments", tournamentId, "slots")),
            getDocs(collection(db, "tournaments", tournamentId, "participants")),
            getDocs(collection(db, "tournaments", tournamentId, "verifications")),
            getDocs(collection(db, "tournaments", tournamentId, "upcomingRegistrations"))
        ]);

        const tournament = tSnap.exists() ? tSnap.data() : {};
        
        // Merge participants and slots securely
        const teamMap = new Map();
        participantsSnap.forEach(d => teamMap.set(d.id, { id: d.id, _source: "participants", ...d.data() }));
        slotsSnap.forEach(d => teamMap.set(d.id, { ...teamMap.get(d.id), id: d.id, _source: "slots", ...d.data() }));
        let allTeams = Array.from(teamMap.values());

        // Map manual inputs submitted via the joining / registration interface
        const registrationDataMap = new Map();
        verificationsSnap.forEach(d => {
            const data = d.data();
            if (data.teamId) registrationDataMap.set(data.teamId, data);
            registrationDataMap.set(d.id, data);
        });
        upcomingSnap.forEach(d => {
            const data = d.data();
            if (data.teamId) registrationDataMap.set(data.teamId, data);
            registrationDataMap.set(d.id, data);
        });

        const mode = tournament.mode?.toLowerCase() || "squad";
        const rowsPerTeam = mode === "squad" ? 4 : mode === "duo" ? 2 : 1;

        // Process teams and inject exact user manual registration details over global profiles
        for (let i = 0; i < allTeams.length; i++) {
            let t = allTeams[i];
            const regData = registrationDataMap.get(t.teamId) || registrationDataMap.get(t.id);
            
            if (regData) {
                t.teamName = regData.teamName || t.teamName;
                t.teamCode = regData.teamCode || t.teamCode;
                
                // Prioritize the manual array data if available from the form submission
                if (regData.playersData && regData.playersData.length > 0) {
                    t.playersData = regData.playersData;
                } else if (regData.uids && regData.uids.length > 0) {
                    t.uids = regData.uids;
                    for (let pi = 1; pi <= 4; pi++) {
                        t[`nickPlayer${pi}`] = regData[`nickPlayer${pi}`] || regData[`player${pi}Nickname`] || t[`nickPlayer${pi}`];
                    }
                }
            }

            // Normalization: Reconstruct playersData array from direct manual registration fields if it doesn't exist
            if (!t.playersData || t.playersData.length === 0) {
                t.playersData = [];
                const sourceUids = t.uids || [];
                for (let pi = 0; pi < rowsPerTeam; pi++) {
                    if (sourceUids[pi]) {
                        const nick = t[`nickPlayer${pi+1}`] || t[`player${pi+1}Nickname`] || "—";
                        t.playersData.push({ uid: sourceUids[pi], nickname: nick });
                    }
                }
            }

            // Tertiary Fallback: Look up global team profile ONLY if no registration form data could be traced
            if (t.playersData.length === 0 && (!t.teamName || t.teamName === "Unnamed Team" || t.teamName === "Unknown Team")) {
                try {
                    let teamIdToFetch = t.teamId;
                    if (!teamIdToFetch) {
                        const userSnap = await getDoc(doc(db, "users", t.id)); 
                        if (userSnap.exists()) teamIdToFetch = userSnap.data().teamId;
                    }
                    if (teamIdToFetch) {
                        const teamSnap = await getDoc(doc(db, "teams", teamIdToFetch));
                        if (teamSnap.exists()) {
                            const teamData = teamSnap.data();
                            t.teamName = (t.teamName && t.teamName !== "Unnamed Team" && t.teamName !== "Unknown Team") ? t.teamName : teamData.teamName;
                            t.teamCode = t.teamCode || teamData.code;
                            
                            for (let memberUid of (teamData.members || [])) {
                                const mSnap = await getDoc(doc(db, "users", memberUid));
                                if (mSnap.exists()) {
                                    t.playersData.push({
                                        uid: mSnap.data().uid || mSnap.data().inGameUid || memberUid,
                                        nickname: mSnap.data().nickname || mSnap.data().inGameName || mSnap.data().email?.split('@')[0] || "Unknown"
                                    });
                                } else {
                                    t.playersData.push({ uid: memberUid, nickname: "Unknown" });
                                }
                            }
                        }
                    }
                } catch(e) { console.warn("Tertiary backup sync failed for team:", t.id, e); }
            }
        }
        
        allTeams.sort((a, b) => {
            const tA = a.assignedAt || a.joinedAt || a.createdAt || 0;
            const tB = b.assignedAt || b.joinedAt || b.createdAt || 0;
            return tA - tB;
        });

        const confirmed  = allTeams.filter(t => t.paymentStatus !== "Waitlist").slice(0, 12);
        const waitlisted = allTeams.filter(t => t.paymentStatus === "Waitlist" || allTeams.indexOf(t) >= 12);
        
        // ✅ X-AXIS SCROLL FIX: min-width 1200px to stop columns from crushing together
        let html = `
            <table class="admin-table" style="width:100%; min-width: 1200px; border-collapse:collapse; text-align:left; font-size:13px;">
                <thead style="background:#1a1a1a; position:sticky; top:0; z-index:1;">
                    <tr>
                        <th style="padding:10px; border-bottom:2px solid #333; white-space:nowrap;">Slot</th>
                        <th style="padding:10px; border-bottom:2px solid #333;">Team</th>
                        <th style="padding:10px; border-bottom:2px solid #333;">Player UID</th>
                        <th style="padding:10px; border-bottom:2px solid #333;">Nickname</th>
                        <th style="padding:10px; border-bottom:2px solid #333; text-align:center;">Payment</th>
                        <th style="padding:10px; border-bottom:2px solid #333; text-align:center;">Actions</th>
                    </tr>
                </thead>
                <tbody id="slotTableBody">`;

        for (let slot = 1; slot <= 12; slot++) {
            const team = confirmed[slot - 1] || null;

            for (let pi = 0; pi < rowsPerTeam; pi++) {
                const isFirst = pi === 0;
                const isLast  = pi === rowsPerTeam - 1;
                
                let uidStr  = "—";
                let nickStr = "—";
                
                if (team) {
                    if (Array.isArray(team.playersData) && team.playersData[pi]) {
                        uidStr  = team.playersData[pi].uid      || "—";
                        nickStr = team.playersData[pi].nickname || "—";
                    } else if (Array.isArray(team.uids) && team.uids[pi]) {
                        uidStr  = team.uids[pi];
                        nickStr = team[`nickPlayer${pi+1}`] || team[`player${pi+1}Nickname`] || "—";
                    } else if (Array.isArray(team.members) && team.members[pi]) {
                        uidStr = team.members[pi];
                    }
                }
                
                const rowBorder = isLast ? "border-bottom:2px solid #3b82f6;" : "border-bottom:1px solid #222;";
                html += `<tr class="slot-row" style="${rowBorder}">`;
                
                if (isFirst) {
                    const teamDisplay = team
                        ? escHtml(team.teamName || team.name || "Unnamed Team")
                        : '<i>Empty Slot</i>';
                    const codeDisplay = team && team.teamCode && team.teamCode !== "N/A"
                        ? `<span style="color:#555; font-size:10px;">(${escHtml(team.teamCode)})</span>`
                        : "";
                    
                    const pStatus = team?.paymentStatus || "Empty";
                    const pColor  = pStatus === "Paid" || pStatus === "verified" ? "#22c55e" : pStatus === "Pending Payment" ? "#fbbf24" : "#555";
                    const pBg = pStatus === "Paid" || pStatus === "verified" ? "rgba(34,197,94,0.15)" : pStatus === "Pending Payment" ? "rgba(251,191,36,0.15)" : "transparent";
                    
                    const isPaid = (team?.paymentStatus === 'Payment Verified' || team?.paymentStatus === 'verified' || team?.paymentStatus === 'Paid');
                    const actionBtns = team ? `
                        <div style="display:flex; gap:4px; flex-wrap:wrap; justify-content:center;">
                            <button onclick="moveToWaitlist('${tournamentId}','${team.id}')"
                                style="background:#f59e0b;color:#000;border:none;padding:4px 7px;border-radius:4px;cursor:pointer;font-size:10px;white-space:nowrap;">
                                ⏳ Waitlist
                            </button>
                            <button onclick="kickTeamFromSlot('${tournamentId}','${team.id}')"
                                style="background:#ef4444;color:#fff;border:none;padding:4px 7px;border-radius:4px;cursor:pointer;font-size:10px;white-space:nowrap;">
                                🚫 Kick
                            </button>
                            ${isPaid
                              ? `<span title="Payment verified — cannot delete" style="background:transparent;color:#555;border:1px solid #333;padding:4px 7px;border-radius:4px;font-size:10px;white-space:nowrap;cursor:not-allowed;opacity:0.5;">🔒 Delete</span>`
                              : `<button onclick="deleteSlot('${tournamentId}','${team.id}')"
                                style="background:transparent;color:#ef4444;border:1px solid #ef4444;padding:4px 7px;border-radius:4px;cursor:pointer;font-size:10px;white-space:nowrap;">
                                🗑 Delete
                              </button>`
                            }
                        </div>
                    ` : `<span style="color:#444; font-size:11px;">—</span>`;

                    
                    html += `
                        <td rowspan="${rowsPerTeam}" style="border-right:1px solid #222; text-align:center; padding:8px; font-weight:bold; color:${team ? "#aaa" : "#333"};">#${slot}</td>
                        <td rowspan="${rowsPerTeam}" style="border-right:1px solid #222; padding:8px; font-weight:bold; color:${team ? "#fff" : "#333"};">
                            ${teamDisplay} ${codeDisplay}
                        </td>`;
                    
                    html += `<td style="padding:8px; color:${team ? "#9ca3af" : "#444"};">${escHtml(uidStr)}</td>`;
                    html += `<td style="padding:8px; color:${team ? "#fff" : "#444"};">${escHtml(nickStr)}</td>`;
                    
                    html += `
                        <td rowspan="${rowsPerTeam}" style="border-left:1px solid #222; text-align:center; padding:8px;">
                            <span style="background:${pBg}; color:${pColor}; padding:3px 8px; border-radius:12px; font-size:10px; font-weight:bold; display:inline-block;">
                                ${escHtml(pStatus)}
                            </span>
                        </td>
                        <td rowspan="${rowsPerTeam}" style="border-left:1px solid #222; text-align:center; padding:8px;">
                            ${actionBtns}
                        </td>`;
                } else {
                    html += `<td style="padding:8px; color:#9ca3af;">${escHtml(uidStr)}</td>`;
                    html += `<td style="padding:8px; color:#fff;">${escHtml(nickStr)}</td>`;
                }
                
                html += `</tr>`;
            }
        }

        html += `</tbody></table>`;
        document.getElementById("table-container").innerHTML = html;

        // --- POPULATE RANKS TAB ---
        let ranksHtml = `
            <table class="slot-table" style="width:100%; border-collapse:collapse; background:#111; font-size:13px;">
                <thead style="background:#222; text-align:left;">
                    <tr>
                        <th style="padding:10px; color:#aaa; width:50px;">Slot</th>
                        <th style="padding:10px; color:#aaa;">Team Name</th>
                        <th style="padding:10px; color:#aaa; width:80px;">Rank</th>
                        <th style="padding:10px; color:#aaa; width:80px;">Total Kills</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        let hasTeamsToRank = false;
        for (let slot = 1; slot <= 12; slot++) {
            const team = confirmed[slot - 1] || null;
            if (team) {
                hasTeamsToRank = true;
                // Pre-fill existing data if it exists in the leaderboard or history (would need to fetch it ideally, but keeping it empty initially is fine, or reading from existing leaderboard)
                ranksHtml += `
                    <tr style="border-bottom:1px solid #222;" data-team-id="${team.id}" class="rank-row">
                        <td style="padding:10px; color:#888;">#${slot}</td>
                        <td style="padding:10px; color:#fff; font-weight:bold;">${escHtml(team.teamName || team.name || "Unnamed Team")}</td>
                        <td style="padding:10px;">
                            <input type="number" class="rank-input" min="1" placeholder="e.g. 1" data-team-id="${team.id}" style="width:100%; padding:6px; background:#1a1a1a; border:1px solid #333; color:#fff; border-radius:4px;">
                        </td>
                        <td style="padding:10px;">
                            <input type="number" class="kills-input" min="0" placeholder="e.g. 15" data-team-id="${team.id}" style="width:100%; padding:6px; background:#1a1a1a; border:1px solid #333; color:#fff; border-radius:4px;">
                        </td>
                    </tr>
                `;
            }
        }
        
        if (!hasTeamsToRank) {
            ranksHtml += `<tr><td colspan="4" style="text-align:center; padding:20px; color:#888;">No teams have confirmed slots yet.</td></tr>`;
        }
        
        ranksHtml += `</tbody></table>`;
        document.getElementById("ranks-container").innerHTML = ranksHtml;


        const wlGrid = document.getElementById("waitlistGrid");
        if (waitlisted.length === 0) {
            wlGrid.innerHTML = `<p style="color:#666; font-size:13px;">Queue is empty.</p>`;
        } else {
            wlGrid.innerHTML = waitlisted.map((t, idx) => `
                <div class="wl-row" style="display:flex; justify-content:space-between; align-items:center; background:#1a1a1a; padding:10px 14px; border-radius:6px; margin-bottom:5px; flex-wrap:wrap; gap:8px;">
                    <div>
                        <span style="color:#555; margin-right:8px; font-size:11px;">#${idx + 1}</span>
                        <span style="color:#fff; font-weight:bold;">${escHtml(t.teamName || "Unnamed Team")}</span>
                        <span style="color:#555; font-size:11px; margin-left:6px;">${escHtml(t.teamCode || "")}</span>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button onclick="promoteFromWaitlist('${tournamentId}','${t.id}')"
                            style="background:var(--blue);color:#fff;border:none;padding:5px 10px;border-radius:4px;cursor:pointer;font-size:11px;">
                            ⬆ Promote
                        </button>
                        <button onclick="deleteSlot('${tournamentId}','${t.id}')"
                            style="background:transparent;color:var(--red);border:1px solid var(--red);padding:5px 10px;border-radius:4px;cursor:pointer;font-size:11px;">
                            Remove
                        </button>
                    </div>
                </div>
            `).join("");
        }

    } catch (e) {
        console.error("[SLOTS]", e);
        document.getElementById("table-container").innerHTML = `
            <p style="color:var(--red); padding:15px; text-align:center;">Error loading slots: Permission Denied or Invalid Data</p>
        `;
    }
};

// ============================================================================
//  GLOBAL MESSAGE BLAST — sends announcement to all confirmed + waitlist members
// ============================================================================
window.openGlobalMessageModal = async function(tournamentId) {
    document.getElementById("globalMsgModal")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "globalMsgModal";
    overlay.className = "status-modal-overlay";
    overlay.innerHTML = `
        <div class="status-modal" style="max-width:480px;width:100%;">
            <h3>📢 Global Message — All Tournament Members</h3>
            <p style="color:var(--muted);font-size:13px;margin-bottom:16px;">This message will be sent to all confirmed AND waitlist teams in this tournament.</p>
            <textarea id="globalMsgText" placeholder="Type your announcement here…"
                style="width:100%;min-height:100px;background:#1a1a1a;border:1px solid #333;color:#fff;padding:10px;border-radius:8px;font-family:inherit;font-size:14px;resize:vertical;box-sizing:border-box;"></textarea>
            <button onclick="sendGlobalTournamentMessage('${tournamentId}')"
                style="width:100%;margin-top:12px;padding:12px;background:#3b82f6;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-family:inherit;font-size:14px;">
                📤 Send to All Members
            </button>
            <button onclick="document.getElementById('globalMsgModal').remove()"
                style="width:100%;margin-top:8px;background:transparent;color:var(--muted);border:none;cursor:pointer;font-family:inherit;padding:8px;">Cancel</button>
        </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
};

window.sendGlobalTournamentMessage = async function(tournamentId) {
    const msg = document.getElementById("globalMsgText")?.value.trim();
    if (!msg) { showToast("Please type a message.", "warning"); return; }
    try {
        const [slotsSnap] = await Promise.all([
            getDocs(collection(db, "tournaments", tournamentId, "slots")),
        ]);
        const allIds = new Set();
        slotsSnap.forEach(d => {
            (d.data().members || [d.id]).forEach(uid => allIds.add(uid));
        });
        if (allIds.size === 0) { showToast("No members found in this tournament.", "warning"); return; }
        await Promise.all([...allIds].map(uid => sendDualNotification(uid, {
            type:       "tournament_announcement",
            title:      "📢 Tournament Announcement",
            message:    msg,
            extra:      { tournamentId },
            actionLink: `tournament=${tournamentId}`,
        })));
        document.getElementById("globalMsgModal")?.remove();
        showToast(`✅ Announcement sent to ${allIds.size} member(s)!`, "success");
    } catch (e) {
        showToast("Failed: Permission Denied.", "error");
    }
};

// ============================================================================
//  GLOBAL ROOM ID & PASSWORD BLAST
//  Sends to ALL members. Unpaid users see a blurred/locked version on their end.
// ============================================================================
window.openGlobalRoomBlast = async function(tournamentId) {
    document.getElementById("globalRoomModal")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "globalRoomModal";
    overlay.className = "status-modal-overlay";
    overlay.innerHTML = `
        <div class="status-modal" style="max-width:480px;width:100%;">
            <h3>🔑 Send Room ID & Password — All Members</h3>
            <p style="color:var(--muted);font-size:13px;margin-bottom:16px;">
                Paid members will see the room details clearly.
                Unpaid/waitlist members will see a locked screen with a Pay Now button.
            </p>
            <div style="display:flex;gap:10px;margin-bottom:12px;">
                <div style="flex:1;">
                    <label style="color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:6px;">Room ID</label>
                    <input id="blastRoomId" placeholder="e.g. 1234567" style="width:100%;padding:10px;background:#1a1a1a;border:1px solid #333;color:#fff;border-radius:6px;font-family:inherit;box-sizing:border-box;">
                </div>
                <div style="flex:1;">
                    <label style="color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:6px;">Password</label>
                    <input id="blastRoomPass" placeholder="e.g. abc123" style="width:100%;padding:10px;background:#1a1a1a;border:1px solid #333;color:#fff;border-radius:6px;font-family:inherit;box-sizing:border-box;">
                </div>
            </div>
            <button onclick="sendGlobalRoomBlast('${tournamentId}')"
                style="width:100%;padding:12px;background:var(--green);color:#000;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-family:inherit;font-size:14px;">
                📤 Send to All Members
            </button>
            <button onclick="document.getElementById('globalRoomModal').remove()"
                style="width:100%;margin-top:8px;background:transparent;color:var(--muted);border:none;cursor:pointer;font-family:inherit;padding:8px;">Cancel</button>
        </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
};

window.sendGlobalRoomBlast = async function(tournamentId) {
    const roomId   = document.getElementById("blastRoomId")?.value.trim();
    const roomPass = document.getElementById("blastRoomPass")?.value.trim();
    if (!roomId || !roomPass) { showToast("Enter both Room ID and Password.", "warning"); return; }
    try {
        const slotsSnap = await getDocs(collection(db, "tournaments", tournamentId, "slots"));
        const allIds = new Set();
        slotsSnap.forEach(d => {
            (d.data().members || [d.id]).forEach(uid => allIds.add(uid));
        });
        if (allIds.size === 0) { showToast("No members found.", "warning"); return; }
        await Promise.all([...allIds].map(uid => sendDualNotification(uid, {
            type:       "room_blast",
            title:      "🔑 Room Details Available!",
            message:    "The Room ID and Password for your tournament have been shared. Tap to view.",
            extra:      { roomId, roomPassword: roomPass, tournamentId },
            actionLink: `tournament=${tournamentId}`,
        })));
        document.getElementById("globalRoomModal")?.remove();
        showToast(`✅ Room details sent to ${allIds.size} member(s)!`, "success");
    } catch (e) {
        showToast("Failed: Permission Denied.", "error");
    }
};

// ============================================================================
//  CHANGE REQUEST REVIEW (Admin sees user’s requested edits)
// ============================================================================
window.openChangeRequestReview = async function(tournamentId, userId, stage) {
    document.getElementById("changeReqModal")?.remove();
    try {
        const crSnap = await getDoc(doc(db, "tournaments", tournamentId, "changeRequests", userId));
        if (!crSnap.exists()) { showToast("No change request found.", "warning"); return; }
        const cr = crSnap.data();
        const changesHtml = Object.entries(cr.requestedChanges || {}).map(([field, change]) => `
            <div style="background:#0f0f0f;padding:10px 14px;border-radius:8px;">
                <div style="color:var(--muted);font-size:11px;text-transform:uppercase;margin-bottom:4px;">${escHtml(field)}</div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <span style="color:#ef4444;text-decoration:line-through;font-size:13px;">${escHtml(String(change.from || '—'))}</span>
                    <span style="color:#888;">→</span>
                    <span style="color:#22c55e;font-weight:bold;font-size:13px;">${escHtml(String(change.to || ''))}</span>
                </div>
            </div>`).join("");
        const overlay = document.createElement("div");
        overlay.id = "changeReqModal";
        overlay.className = "status-modal-overlay";
        overlay.innerHTML = `
            <div class="status-modal" style="max-width:500px;width:100%;">
                <h3 style="color:#ffd700;">✏️ Change Request — ${escHtml(cr.teamName || userId)}</h3>
                <p style="color:var(--muted);font-size:13px;margin-bottom:12px;">User wants to change the following details:</p>
                <div style="display:grid;gap:8px;margin-bottom:16px;">${changesHtml}</div>
                ${cr.reason ? `<div style="background:#1a1a1a;padding:10px;border-radius:8px;margin-bottom:16px;"><span style="color:var(--muted);font-size:12px;">Reason:</span><p style="color:#fff;margin:4px 0 0;font-size:13px;">${escHtml(cr.reason)}</p></div>` : ''}
                <div style="display:flex;gap:10px;">
                    <button onclick="allowChangeRequest('${tournamentId}','${userId}','${stage}')"
                        style="flex:1;padding:12px;background:var(--green);color:#000;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-family:inherit;">
                        ✅ Allow Changes
                    </button>
                    <button onclick="rejectChangeRequest('${tournamentId}','${userId}')"
                        style="flex:1;padding:12px;background:#111;color:var(--red);border:1px solid var(--red);border-radius:8px;cursor:pointer;font-weight:700;font-family:inherit;">
                        ❌ Reject Request
                    </button>
                </div>
                <button onclick="document.getElementById('changeReqModal').remove()"
                    style="width:100%;margin-top:8px;background:transparent;color:var(--muted);border:none;cursor:pointer;font-family:inherit;padding:8px;">Cancel</button>
            </div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
    } catch (e) {
        showToast("Failed to load change request.", "error");
    }
};

window.allowChangeRequest = async function(tournamentId, userId, stage) {
    try {
        const crRef  = doc(db, "tournaments", tournamentId, "changeRequests", userId);
        const crSnap = await getDoc(crRef);
        if (!crSnap.exists()) { showToast("Change request not found.", "error"); return; }
        const cr = crSnap.data();

        // Build the field updates from requestedChanges
        const updates = {};
        Object.entries(cr.requestedChanges || {}).forEach(([field, change]) => {
            updates[field] = change.to;
        });

        // Apply to the correct Firestore document
        const regCollectionName = stage === "upcoming" ? "upcomingRegistrations" : "verifications";
        await updateDoc(doc(db, "tournaments", tournamentId, regCollectionName, userId), updates);

        // Mark change request as approved
        await updateDoc(crRef, { status: "approved", processedAt: serverTimestamp() });

        // Notify the user
        await sendDualNotification(userId, {
            type:       "change_request_approved",
            title:      "✅ Change Request Approved!",
            message:    "Your requested changes have been applied. Please review your updated details and confirm they are correct.",
            extra:      { tournamentId },
            actionLink: `tournament=${tournamentId}`,
        });

        document.getElementById("changeReqModal")?.remove();
        showToast("✅ Changes applied & user notified.", "success");
    } catch (e) {
        showToast("Failed: Permission Denied.", "error");
    }
};

window.rejectChangeRequest = async function(tournamentId, userId) {
    const reason = prompt("Optional: Enter a reason for rejecting the change request:") || "";
    try {
        await updateDoc(doc(db, "tournaments", tournamentId, "changeRequests", userId), {
            status:           "rejected",
            rejectionReason:  reason,
            processedAt:      serverTimestamp()
        });
        await sendDualNotification(userId, {
            type:       "change_request_rejected",
            title:      "❌ Change Request Rejected",
            message:    reason
                ? `Your change request was rejected. Reason: ${reason}. If you need to correct your details, you may re-register.`
                : "Your change request was rejected by the admin. If you need to correct your details, you may re-register for this tournament.",
            extra:      { tournamentId },
            actionLink: `resubmit&tournament=${tournamentId}`,
        });
        document.getElementById("changeReqModal")?.remove();
        showToast("❌ Request rejected & user notified.", "error");
    } catch (e) {
        showToast("Failed: Permission Denied.", "error");
    }
};


window.kickTeamFromSlot = async function(tournamentId, teamId) {
    if (!confirm("Kick this team? This will delete their slot and notify them.")) return;
    try {
        await deleteDoc(doc(db, "tournaments", tournamentId, "slots", teamId)).catch(() => {});
        await deleteDoc(doc(db, "tournaments", tournamentId, "participants", teamId)).catch(() => {});
        
        await sendDualNotification(teamId, {
            type:       "admin_notice",
            title:      "❌ Removed from Tournament",
            message:    "Your team has been removed from the tournament slot. Please contact admin for details.",
            actionLink: `tournament=${tournamentId}`
        });
        
        showToast("Team kicked & notified.", "success");
        manageTournamentSlots(tournamentId);
    } catch (e) {
        showToast("Error kicking team.", "error");
    }
};


window.promoteFromWaitlist = async function(tournamentId, teamId) {
    const slotNumberStr = prompt("Enter the slot number (1-12) to assign this team:");
    if (!slotNumberStr) return;

    const slotNumber = parseInt(slotNumberStr);
    if (isNaN(slotNumber) || slotNumber < 1 || slotNumber > 12) {
        showToast("Invalid slot number. Please enter a number between 1 and 12.", "warning");
        return;
    }

    if (!confirm(`Promote this team to Slot #${slotNumber}? This will notify them to pay.`)) return;

    try {
        const slotRef = doc(db, "tournaments", tournamentId, "slots", teamId);
        
        await updateDoc(slotRef, {
            paymentStatus: "Pending Payment",
            assignedSlot: slotNumber,
            promotedAt: serverTimestamp()
        });

        await sendDualNotification(teamId, {
            type: "admin_notice", 
            title: `🎉 Slot #${slotNumber} Opened!`, 
            message: `Your team has been promoted from the waitlist to Slot #${slotNumber}. Please pay your entry fee now to secure your spot.,`, 
            actionLink: `tournament=${tournamentId}`
        });

        showToast(`Team promoted to Slot #${slotNumber} & notified!`, "success");
        manageTournamentSlots(tournamentId);
    } catch (e) {
        showToast("Error promoting team: Permission Denied.", "error");
    }
};

window.filterSlots = function() {
    const input = document.getElementById('slotSearch').value.toLowerCase();
    const rows = document.querySelectorAll('.slot-row');
    
    let currentBlockMatches = false;
    let blockRows = [];
    
    rows.forEach(row => {
        if (row.querySelector('td[rowspan]')) {
            if (blockRows.length > 0) {
                blockRows.forEach(r => r.style.display = currentBlockMatches ? '' : 'none');
            }
            blockRows = [row];
            currentBlockMatches = row.innerText.toLowerCase().includes(input);
        } else {
            blockRows.push(row);
            if (row.innerText.toLowerCase().includes(input)) currentBlockMatches = true;
        }
    });
    if (blockRows.length > 0) {
        blockRows.forEach(r => r.style.display = currentBlockMatches ? '' : 'none');
    }
};
// ============================================================================
// ULTIMATE REVIEW MODAL (Handles both Ongoing and Upcoming safely)
// ============================================================================

// ============================================================================
// ULTIMATE REVIEW MODAL (Handles both Ongoing and Upcoming safely)
// ============================================================================

window.openAdminReviewModal = async function(tournamentId, userId, dataString, stage = 'ongoing') {
    const app = JSON.parse(decodeURIComponent(dataString));
    document.getElementById("reviewAppModal")?.remove();

    // ✅ FIX: Fetch the actual Tournament Title
    let tournamentTitle = tournamentId;
    try {
        const tSnap = await getDoc(doc(db, "tournaments", tournamentId));
        if (tSnap.exists()) {
            tournamentTitle = tSnap.data().title || tournamentId;
        }
    } catch(e) { console.warn("Could not fetch tournament title"); }

    // ✅ FIX: Generate Player UIDs with NPC Verified Badges (Player 1 shows Leader + NPC/Friend)
    const playersHtml = app.playersData && app.playersData.length > 0 ? app.playersData.map((p, i) => {
        // ✅ FIX: Player 1 always shows "Team Leader" label, plus their NPC/Friend badge
        const isLeader = i === 0;
        const leaderBadge = isLeader
            ? `<span style="background:#ffd700;color:#000;padding:2px 6px;border-radius:4px;font-size:10px;margin-left:6px;font-weight:bold;">👑 Leader</span>`
            : '';
        // ✅ FIX: Show NPC User or Friend badge for ALL players including Player 1
        let typeBadge = (p.type === 'npc_verified' || p.type === 'NPC User' || p.type === 'npc')
            ? `<span style="background:var(--green);color:#000;padding:2px 6px;border-radius:4px;font-size:10px;margin-left:6px;font-weight:bold;">NPC User</span>`
            : (p.type === 'leader' ? '' : `<span style="background:#444;color:#aaa;padding:2px 6px;border-radius:4px;font-size:10px;margin-left:6px;">Friend</span>`);
            
        return `
            <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #222;padding-bottom:8px;">
                <span style="color:#888;">Player ${i+1} ${leaderBadge}${typeBadge}</span>
                <span style="color:#fff;font-weight:bold;">${p.uid} <span style="color:var(--blue);font-weight:normal;font-size:12px;margin-left:6px;">${p.nickname}</span></span>
            </div>
        `;
    }).join('') : `<div style="color:#fff;">${app.uids?.join(', ')}</div>`;

    document.body.insertAdjacentHTML("beforeend", `
        <div id="reviewAppModal" style="position:fixed;inset:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:9999;padding:15px;">
            <div style="background:#111;width:100%;max-width:520px;border-radius:12px;border:1px solid #333;display:flex;flex-direction:column;max-height:90vh;">
                
                <div style="padding:20px;border-bottom:1px solid #222;display:flex;justify-content:space-between;align-items:center;">
                    <h3 style="color:var(--green);margin:0;">🔍 Review Team: ${app.teamName}</h3>
                    <button onclick="document.getElementById('reviewAppModal').remove()" style="background:transparent;border:none;color:#888;font-size:20px;cursor:pointer;">✖</button>
                </div>

                <div style="padding:20px;overflow-y:auto;flex:1;">
                    
                    <div style="margin-bottom:20px; background:rgba(59,130,246,0.1); border:1px solid #3b82f6; padding:12px; border-radius:8px;">
                        <label style="color:#3b82f6;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Tournament Details</label>
                        <div style="color:#fff;font-size:16px;font-weight:bold;margin-top:4px;">${tournamentTitle}</div>
                        <div style="color:#888;font-size:12px;margin-top:2px;font-family:monospace;">ID: ${tournamentId}</div>
                    </div>

                    <div style="margin-bottom:20px;">
                        <label style="color:#666;font-size:12px;">Leader Email</label>
                        <div style="color:#fff;background:#1a1a1a;padding:10px;border-radius:6px;">${app.leaderEmail}</div>
                    </div>
                    <div style="margin-bottom:20px;">
                        <label style="color:#666;font-size:12px;">Phone Number</label>
                        <div style="color:#fff;background:#1a1a1a;padding:10px;border-radius:6px;">${app.phone}</div>
                    </div>
                    <div style="margin-bottom:20px;">
                        <label style="color:#666;font-size:12px;">Backup Gmail ✉️</label>
                        <div style="color:#fff;background:#1a1a1a;padding:10px;border-radius:6px;">${app.backupEmail || '—'}</div>
                    </div>
                    <div style="margin-bottom:10px;">
                        <label style="color:#666;font-size:12px;">Squad Members</label>
                        <div style="background:#1a1a1a;padding:15px 10px 5px 10px;border-radius:6px;display:grid;gap:12px;">
                            ${playersHtml}
                        </div>
                    </div>

                    <div style="margin-top:30px; padding-top:20px; border-top:1px dashed #444;">
                        <label style="color:var(--red);font-size:12px;letter-spacing:.5px;text-transform:uppercase;display:block;margin-bottom:8px;">
                            Rejection Reason (Required if Rejecting)
                        </label>
                        <select id="reasonSelect" style="width:100%;padding:12px;background:#000;color:#fff;border:1px solid #444;border-radius:8px;margin-bottom:10px;font-family:inherit;font-size:14px;">
                            <option value="">-- Select Reason --</option>
                            <option value="Member 1 Information Wrong">❌ Member 1 Information Wrong</option>
                            <option value="Member 2 Information Wrong">❌ Member 2 Information Wrong</option>
                            <option value="Member 3 Information Wrong">❌ Member 3 Information Wrong</option>
                            <option value="Member 4 Information Wrong">❌ Member 4 Information Wrong</option>
                            <option value="Invalid Player UID / Not Verified">❌ Invalid Player UID / Not Verified</option>
                            <option value="Incorrect Phone">❌ Phone Number Wrong</option>
                            <option value="Blacklisted Team">🚫 Team is Blacklisted</option>
                            <option value="custom">✍️ Other (write below)</option>
                        </select>
                        <textarea id="adminNote" placeholder="Optional notes for the team..."
                            style="width:100%;height:60px;background:#000;color:#fff;border:1px solid #444;padding:10px;border-radius:8px;font-family:inherit;resize:vertical;"></textarea>
                    </div>
                </div>

                <div style="padding:20px;border-top:1px solid #222;background:#0a0a0a;border-radius:0 0 12px 12px;">
                    <div style="display:flex;gap:15px;flex-direction:row;">
                        <button onclick="handleReviewDecision('${tournamentId}', '${userId}', 'approved', '${stage}')" 
                            style="flex:1;padding:14px;background:var(--green);color:#000;border:none;border-radius:8px;font-weight:bold;cursor:pointer;font-size:15px;">
                            ✅ Approve
                        </button>
                        <button onclick="handleReviewDecision('${tournamentId}', '${userId}', 'rejected', '${stage}')" 
                            style="flex:1;padding:14px;background:#111;color:var(--red);border:1px solid var(--red);border-radius:8px;font-weight:bold;cursor:pointer;font-size:15px;">
                            ❌ Reject
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `);
};

// ============================================================================
// THE DECISION HANDLER (Fixes the "Not Defined" errors & verifies reasons)
// ============================================================================
window.handleReviewDecision = async function(tournamentId, userId, status, stage) {
    // 1. Force the admin to select a reason if rejecting
    if (status === 'rejected') {
        const reason = document.getElementById("reasonSelect")?.value;
        if (!reason) {
            showToast("⚠️ Please select a Rejection Reason first.", "warning");
            return;
        }
    }

    try {
        if (stage === 'upcoming') {
            // Handle Upcoming Approvals/Rejections
            if (status === 'approved') {
                await approveUpcoming(tournamentId, userId);
            } else {
                const select = document.getElementById("reasonSelect").value;
                const custom = document.getElementById("adminNote")?.value.trim() ?? "";
                const finalReason = select === "custom" ? custom : select;
                
                // Use imported updateDoc to mark rejected in Firestore
                await updateDoc(doc(db, "tournaments", tournamentId, "upcomingRegistrations", userId), {
                    status: "rejected", 
                    rejectionReason: finalReason, 
                    processedAt: serverTimestamp(),
                });
                
                // Send notification
                await sendDualNotification(userId, {
                    type: "rejected",
                    title: "Registration Rejected",
                    message: `Your registration was rejected. Reason: ${finalReason}`,
                    extra: { tournamentId },
                    actionLink: `tournament=${tournamentId}`,
                });
                showToast("❌ Upcoming registration rejected.", "error");
            }
        } else {
            // Handle Ongoing Approvals/Rejections using your existing processDecision function
            await processDecision(tournamentId, userId, status);
        }
        
        // Remove the modal upon success
        document.getElementById('reviewAppModal')?.remove();

    } catch (e) {
        showToast("Error processing decision: Permission Denied.", "error");
    }
};

window.sendGlobalNotification = async function() {
    const title = document.getElementById("globalNotifTitle").value.trim();
    const msg = document.getElementById("globalNotifMsg").value.trim();
    
    if (!title || !msg) { alert("Please enter a title and message."); return; }
    if (!confirm("Are you sure? This will send to EVERY registered user.")) return;

    try {
        const usersSnap = await getDocs(collection(db, "users"));
        const batch = writeBatch(db);
        let count = 0;

        usersSnap.forEach(userDoc => {
            const notifRef = doc(collection(db, "users", userDoc.id, "notifications"));
            batch.set(notifRef, {
                type: "global_alert",
                title: title,
                message: msg,
                read: false,
                createdAt: serverTimestamp()
            });
            count++;
        });

        await batch.commit();
        alert(`✅ Global notification sent successfully to ${count} users!`);
        document.getElementById("globalNotifTitle").value = "";
        document.getElementById("globalNotifMsg").value = "";
    } catch (err) {
        console.error("Global notif error:", err);
        alert("Failed to send global notification.");
    }
};

// =============================================================================
// PART 3.3b — NEW SLOT ACTION FUNCTIONS (Kick, Waitlist, Delete)
// APPEND TO BOTTOM of admin.js
// =============================================================================

window.moveToWaitlist = async function(tournamentId, teamId) {
    if (!confirm("Move this team to the Waitlist? They will be notified.")) return;
    try {
        const slotRef = doc(db, "tournaments", tournamentId, "slots", teamId);
        await updateDoc(slotRef, { paymentStatus: "Waitlist", waitlistedAt: serverTimestamp() });
        
        // Notify the team
        await sendDualNotification(teamId, {
            type:       "admin_notice",
            title:      "⏳ Moved to Waitlist",
            message:    "Your slot has been moved to the waitlist. You will be notified if a slot opens up.",
            actionLink: `tournament=${tournamentId}`
        });
        
        showToast("Team moved to waitlist & notified.", "success");
        manageTournamentSlots(tournamentId); // Refresh
        
    } catch (e) {
        showToast("Action failed: Permission Denied.", "error");
    }
};

window.deleteSlot = async function(tournamentId, teamId) {
    if (!confirm("Permanently delete this slot entry? This cannot be undone.")) return;
    try {
        // Try deleting from both /slots and /participants for backward compat
        const promises = [
            deleteDoc(doc(db, "tournaments", tournamentId, "slots", teamId)).catch(() => {}),
            deleteDoc(doc(db, "tournaments", tournamentId, "participants", teamId)).catch(() => {})
        ];
        await Promise.all(promises);
        
        showToast("Slot deleted.", "success");
        manageTournamentSlots(tournamentId); // Refresh
        
    } catch (e) {
        showToast("Error deleting: Permission Denied.", "error");
    }
};

// =============================================================================
// PART 3.4 — 12-SLOT MANUAL LEADERBOARD GRID (Admin Side)
// APPEND TO BOTTOM of admin.js
// Call: window.renderAdminLeaderboardGrid(tournamentId)
// =============================================================================

window.renderAdminLeaderboardGrid = async function(tournamentId) {
    const container = document.getElementById("adminLeaderboardGrid");
    if (!container) {
        console.warn("[LEADERBOARD] No #adminLeaderboardGrid element found in HTML");
        return;
    }

    container.innerHTML = `
        <div style="text-align:center; padding:20px; color:var(--green);">
            ⏳ Loading leaderboard slots…
        </div>
    `;

    try {
        const lbRef  = collection(db, "tournaments", tournamentId, "leaderboard");
        const snap   = await getDocs(query(lbRef, orderBy("rank", "asc")));
        
        const existing = {};
        snap.forEach(d => { existing[d.data().rank] = d.data(); });

        const rankStyles = {
            1: { color: "gold",    bg: "rgba(255,215,0,0.08)",   border: "gold" },
            2: { color: "silver",  bg: "rgba(192,192,192,0.06)", border: "silver" },
            3: { color: "#cd7f32", bg: "rgba(205,127,50,0.06)",  border: "#cd7f32" },
        };

        let gridHtml = `
            <div style="display:grid; grid-template-columns:1fr; gap:10px; max-width:780px; margin:0 auto;">
                <div style="display:grid; grid-template-columns:50px 1fr 120px 120px 80px; gap:8px; padding:0 12px; margin-bottom:2px;">
                    <span style="color:#444; font-size:11px; text-transform:uppercase;">Rank</span>
                    <span style="color:#444; font-size:11px; text-transform:uppercase;">Team Name</span>
                    <span style="color:#444; font-size:11px; text-transform:uppercase;">Score</span>
                    <span style="color:#444; font-size:11px; text-transform:uppercase;">Kills</span>
                    <span style="color:#444; font-size:11px; text-transform:uppercase;"></span>
                </div>
        `;

        // ✅ FIX: Force exactly 12 rows — even if database has 0 entries
        for (let rank = 1; rank <= 12; rank++) {
            const data  = existing[rank] || {};
            const style = rankStyles[rank] || { color: "#aaa", bg: "rgba(255,255,255,0.02)", border: "#2a2a2a" };

            gridHtml += `
                <div style="
                    display:grid;
                    grid-template-columns:50px 1fr 120px 120px 80px;
                    gap:8px;
                    align-items:center;
                    background:${style.bg};
                    border:1px solid ${style.border};
                    border-left:4px solid ${style.color};
                    border-radius:8px;
                    padding:10px 12px;
                ">
                    <div style="font-weight:bold; font-size:17px; color:${style.color}; text-align:center;">#${rank}</div>
                    
                    <input type="text"
                           id="lb_name_${rank}"
                           value="${escHtml(data.teamName || "")}"
                           placeholder="Team Name"
                           style="padding:9px 10px; background:#0f0f0f; border:1px solid #333; color:#fff; border-radius:6px; font-family:inherit; font-size:13px; width:100%; box-sizing:border-box;"
                    >
                    
                    <input type="number"
                           id="lb_score_${rank}"
                           value="${data.score !== undefined ? data.score : ""}"
                           placeholder="Score"
                           style="padding:9px 10px; background:#0f0f0f; border:1px solid #333; color:#fff; border-radius:6px; font-family:inherit; font-size:13px; width:100%; box-sizing:border-box;"
                    >
                    
                    <input type="number"
                           id="lb_kills_${rank}"
                           value="${data.kills !== undefined ? data.kills : ""}"
                           placeholder="Kills"
                           style="padding:9px 10px; background:#0f0f0f; border:1px solid #333; color:#fff; border-radius:6px; font-family:inherit; font-size:13px; width:100%; box-sizing:border-box;"
                    >
                    
                    <button onclick="window.saveLeaderboardRow('${tournamentId}', ${rank})"
                            style="padding:9px 12px; background:var(--blue); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:bold; font-family:inherit; font-size:13px; white-space:nowrap; transition:0.15s;"
                            onmouseover="this.style.background='#60a5fa'"
                            onmouseout="this.style.background='var(--blue)'">
                        Save
                    </button>
                </div>
            `;
        }

        gridHtml += `
            </div>
            <div style="margin-top:16px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
                <button onclick="window.saveAllLeaderboardRows('${tournamentId}')"
                        style="background:var(--green); color:#000; border:none; padding:11px 24px; border-radius:8px; cursor:pointer; font-weight:bold; font-family:inherit; font-size:14px;">
                    💾 Save All Rows
                </button>
                <button onclick="window.clearLeaderboard('${tournamentId}')"
                        style="background:transparent; color:var(--red); border:1px solid var(--red); padding:11px 24px; border-radius:8px; cursor:pointer; font-family:inherit; font-size:14px;">
                    🗑 Clear Leaderboard
                </button>
            </div>
        `;

        container.innerHTML = gridHtml;

    } catch (err) {
        console.error("[LEADERBOARD]", err);
        container.innerHTML = `
            <div style="color:var(--red); text-align:center; padding:20px;">
                ⚠️ Failed to load grid: Permission Denied or Invalid Data
            </div>
        `;
    }
};

window.saveLeaderboardRow = async function(tournamentId, rank) {
    const tName = (document.getElementById(`lb_name_${rank}`)?.value  || "").trim();
    const tScore = parseInt(document.getElementById(`lb_score_${rank}`)?.value) || 0;
    const tKills = parseInt(document.getElementById(`lb_kills_${rank}`)?.value) || 0;

    if (!tName) {
        showToast(`Enter a team name for Rank #${rank}`, "warning");
        return;
    }

    try {
        await setDoc(
            doc(db, "tournaments", tournamentId, "leaderboard", `rank_${rank}`),
            {
                rank:      rank,
                teamName:  tName,
                score:     tScore,
                kills:     tKills,
                updatedAt: serverTimestamp()
            },
            { merge: false }
        );
        showToast(`✅ Rank #${rank} — ${tName} saved!`, "success");
    } catch (err) {
        showToast("Error saving Rank #${rank}: Permission Denied.", "error");
    }
};

window.saveAllLeaderboardRows = async function(tournamentId) {
    const batch = writeBatch(db);
    let count = 0;
    
    for (let rank = 1; rank <= 12; rank++) {
        const tName  = (document.getElementById(`lb_name_${rank}`)?.value || "").trim();
        const tScore = parseInt(document.getElementById(`lb_score_${rank}`)?.value) || 0;
        const tKills = parseInt(document.getElementById(`lb_kills_${rank}`)?.value) || 0;
        
        if (!tName) continue; // Skip empty rows
        
        batch.set(
            doc(db, "tournaments", tournamentId, "leaderboard", `rank_${rank}`),
            { rank, teamName: tName, score: tScore, kills: tKills, updatedAt: serverTimestamp() }
        );
        count++;
    }
    
    if (count === 0) {
        showToast("No rows to save — fill in at least one team name.", "warning");
        return;
    }
    
    try {
        await batch.commit();
        showToast(`✅ ${count} leaderboard rows saved!`, "success");
    } catch (err) {
        showToast("Error saving batch: Permission Denied.", "error");
    }
};

window.clearLeaderboard = async function(tournamentId) {
    if (!confirm("Clear entire leaderboard? This cannot be undone.")) return;
    try {
        const snap = await getDocs(collection(db, "tournaments", tournamentId, "leaderboard"));
        const batch = writeBatch(db);
        snap.forEach(d => batch.delete(d.ref));
        await batch.commit();
        showToast("Leaderboard cleared.", "success");
        // Re-render empty grid
        window.renderAdminLeaderboardGrid(tournamentId);
    } catch (err) {
        showToast("Error clearing: Permission Denied.", "error");
    }
};

// =============================================================================
//  NPC Esports — USER METRICS & ROSTER ANALYTICS DASHBOARD (NEW FEATURE)
// =============================================================================

window.showUserAnalyticsDashboard = async function() {
    // 1. Setup UI Modal Elements
    document.getElementById("analyticsModalOverlay")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "analyticsModalOverlay";
    overlay.className = "status-modal-overlay";
    
    overlay.innerHTML = `
        <div class="status-modal" style="max-width:1000px; width:100%; max-height:90vh; overflow-y:auto; padding:25px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; border-bottom:1px solid #333; padding-bottom:15px; flex-wrap:wrap; gap:10px;">
                <div>
                    <h2 style="color:var(--gold); margin:0; font-size:22px; display:inline-flex; align-items:center; gap:8px;">📊 User Database & Roster Analytics</h2>
                    <p style="color:#888; font-size:12px; margin:4px 0 0 0;">Complete organizational breakdown of registered platform users.</p>
                </div>
                <button onclick="document.getElementById('analyticsModalOverlay').remove()" 
                        style="background:transparent; color:#666; border:none; font-size:24px; cursor:pointer; line-height:1;">&times;</button>
            </div>
            
            <div id="analyticsStatsGrid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:15px; margin-bottom:25px;">
                <div style="background:#111; border:1px solid #222; border-radius:10px; padding:15px; text-align:center;">
                    <p style="color:#888; margin:0; font-size:12px; text-transform:uppercase;">Total Users</p>
                    <h3 id="statTotalUsers" style="color:#fff; font-size:28px; margin:8px 0 0 0;">...</h3>
                </div>
                <div style="background:#111; border:1px solid #222; border-left:4px solid #ffd700; border-radius:10px; padding:15px; text-align:center;">
                    <p style="color:#ffd700; margin:0; font-size:12px; text-transform:uppercase;">Team Leaders 👑</p>
                    <h3 id="statLeaders" style="color:#fff; font-size:28px; margin:8px 0 0 0;">...</h3>
                </div>
                <div style="background:#111; border:1px solid #222; border-left:4px solid #3b82f6; border-radius:10px; padding:15px; text-align:center;">
                    <p style="color:#3b82f6; margin:0; font-size:12px; text-transform:uppercase;">Team Members 🔑</p>
                    <h3 id="statMembers" style="color:#fff; font-size:28px; margin:8px 0 0 0;">...</h3>
                </div>
                <div style="background:#111; border:1px solid #222; border-left:4px solid #888; border-radius:10px; padding:15px; text-align:center;">
                    <p style="color:#aaa; margin:0; font-size:12px; text-transform:uppercase;">Viewers 👁️</p>
                    <h3 id="statViewers" style="color:#fff; font-size:28px; margin:8px 0 0 0;">...</h3>
                </div>
                <div style="background:#111; border:1px solid #222; border-left:4px solid #ff4444; border-radius:10px; padding:15px; text-align:center;">
                    <p style="color:#ff4444; margin:0; font-size:12px; text-transform:uppercase;">Admins 🛡️</p>
                    <h3 id="statAdmins" style="color:#fff; font-size:28px; margin:8px 0 0 0;">...</h3>
                </div>
            </div>

            <div style="display:flex; gap:15px; margin-bottom:25px; background:rgba(255,215,0,0.03); border:1px solid #222; padding:12px 18px; border-radius:8px; flex-wrap:wrap;">
                <span style="color:#888; font-size:13px;">Team Alignment Status:</span>
                <span style="color:#00ff88; font-size:13px; font-weight:bold;">🟢 Organized (In a Team): <span id="statWithTeam">0</span></span>
                <span style="color:#ff9f43; font-size:13px; font-weight:bold;">🟡 Free Agents (No Team): <span id="statNoTeam">0</span></span>
            </div>

            <div style="margin-bottom:15px;">
                <input type="text" id="analyticsUserSearch" placeholder="🔍 Search by Nickname, Email, Role, or Team Name…"
                       style="width:100%; padding:12px; border-radius:8px; border:1px solid #333; background:#161616; color:#fff; font-family:inherit; font-size:14px;"
                       onkeyup="filterAnalyticsUserTable()">
            </div>

            <div style="overflow-x:auto; border:1px solid #222; border-radius:8px; max-height:400px; overflow-y:auto;">
                <table style="width:100%; border-collapse:collapse; text-align:left; font-size:13px;">
                    <thead style="background:#161616; position:sticky; top:0; z-index:2; border-bottom:2px solid #333;">
                        <tr>
                            <th style="padding:12px; color:#888;">Nickname</th>
                            <th style="padding:12px; color:#888;">Email</th>
                            <th style="padding:12px; color:#888;">System Role</th>
                            <th style="padding:12px; color:#888;">Assigned Team</th>
                            <th style="padding:12px; color:#888; text-align:center;">Age</th>
                        </tr>
                    </thead>
                    <tbody id="analyticsUserTableBody">
                        <tr>
                            <td colspan="5" style="text-align:center; padding:30px; color:#666;">Querying Firestore user database…</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <button onclick="document.getElementById('analyticsModalOverlay').remove()"
                    style="width:100%; margin-top:20px; padding:12px; background:#222; color:#fff; border:none; border-radius:8px; cursor:pointer; font-weight:bold; font-family:inherit; transition:background 0.2s;">
                Dismiss Dashboard
            </button>
        </div>
    `;
    document.body.appendChild(overlay);

    try {
        // 2. Fetch all user records from Firestore
        const usersSnap = await getDocs(collection(db, "users"));
        
        let total = 0;
        let leaders = 0;
        let members = 0;
        let viewers = 0;
        let admins = 0;
        let withTeam = 0;
        let noTeam = 0;
        
        let tableRowsHtml = "";

        usersSnap.forEach(docSnap => {
            const u = docSnap.data();
            total++;

            // Extract role properties safely
            const userRole = (u.role || "viewer").toLowerCase();
            const isAdminUser = u.isAdmin === true;
            const hasTeam = !!u.teamId;

            // Increment specific categories
            if (isAdminUser) admins++;
            
            if (userRole === "leader") leaders++;
            else if (userRole === "member" || userRole === "player") members++;
            else if (userRole === "viewer") viewers++;

            if (hasTeam) withTeam++;
            else noTeam++;

            // Handle styling badges
            let roleBadge = `<span style="background:rgba(136,136,136,0.1); color:#aaa; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:bold;">Viewer 👁️</span>`;
            if (isAdminUser) {
                roleBadge = `<span style="background:rgba(239,68,68,0.15); color:#ff4444; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:bold; border:1px solid rgba(239,68,68,0.3);">Admin 🛡️</span>`;
            } else if (userRole === "leader") {
                roleBadge = `<span style="background:rgba(255,215,0,0.15); color:#ffd700; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:bold; border:1px solid rgba(255,215,0,0.3);">Leader 👑</span>`;
            } else if (userRole === "member" || userRole === "player") {
                roleBadge = `<span style="background:rgba(59,130,246,0.15); color:#3b82f6; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:bold;">Member 🔑</span>`;
            }

            const teamDisplay = hasTeam 
                ? `<b style="color:#fff;">${escHtml(u.teamName)}</b> <span style="color:#555; font-size:11px;">(${escHtml(u.teamCode || "")})</span>`
                : `<i style="color:#555;">No Assigned Team (Solo)</i>`;

            tableRowsHtml += `
                <tr class="analytics-user-row" style="border-bottom:1px solid #1f1f1f; background:#0d0d0d;">
                    <td style="padding:12px; font-weight:bold; color:#fff;">${escHtml(u.nickname || "Unnamed User")}</td>
                    <td style="padding:12px; color:#aaa;">${escHtml(u.email || "—")}</td>
                    <td style="padding:12px;">${roleBadge}</td>
                    <td style="padding:12px;">${teamDisplay}</td>
                    <td style="padding:12px; text-align:center; color:#888;">${u.age || "—"}</td>
                </tr>
            `;
        });

        // 3. Inject calculated stats dynamically into counters
        document.getElementById("statTotalUsers").innerText = total;
        document.getElementById("statLeaders").innerText = leaders;
        document.getElementById("statMembers").innerText = members;
        document.getElementById("statViewers").innerText = viewers;
        document.getElementById("statAdmins").innerText = admins;
        document.getElementById("statWithTeam").innerText = withTeam;
        document.getElementById("statNoTeam").innerText = noTeam;

        document.getElementById("analyticsUserTableBody").innerHTML = tableRowsHtml || `<tr><td colspan="5" style="text-align:center; padding:20px; color:#666;">No users found in database.</td></tr>`;

    } catch (err) {
        console.error("[ANALYTICS]", err);
        document.getElementById("analyticsUserTableBody").innerHTML = `
            <tr><td colspan="5" style="text-align:center; padding:20px; color:var(--red);">Error reading users: Permission Denied or Invalid Data</td></tr>
        `;
    }
};

// 🔍 LIVE FILTER LOGIC FUNCTION
window.filterAnalyticsUserTable = function() {
    const q = document.getElementById("analyticsUserSearch").value.toLowerCase().trim();
    const rows = document.querySelectorAll(".analytics-user-row");
    
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        if (text.includes(q)) {
            row.style.display = "";
        } else {
            row.style.display = "none";
        }
    });
};

// ==========================================
// RANKING TEAMS SAVING LOGIC
// ==========================================
window.saveAllTeamRankings = async function(tournamentId) {
    if (!confirm("Save these rankings? This will update the Leaderboard and Team History.")) return;

    try {
        const rows = document.querySelectorAll(".rank-row");
        const batch = writeBatch(db);
        let validUpdates = 0;

        for (let row of rows) {
            const teamId = row.getAttribute("data-team-id");
            const rankInput = row.querySelector(".rank-input").value;
            const killsInput = row.querySelector(".kills-input").value;

            if (rankInput && teamId) {
                const rankNum = parseInt(rankInput) || 0;
                const killsNum = parseInt(killsInput) || 0;
                
                // Fetch team name/details from the row (very basic)
                const teamName = row.children[1].innerText;
                
                // 1. Write to Leaderboard
                const lbRef = doc(db, "tournaments", tournamentId, "leaderboard", teamId);
                batch.set(lbRef, {
                    teamId: teamId,
                    teamName: teamName,
                    rank: rankNum,
                    totalKills: killsNum,
                    updatedAt: serverTimestamp()
                }, { merge: true });

                // 2. Write to Team's Tournament History
                const thRef = doc(db, "teams", teamId, "tournamentHistory", tournamentId);
                batch.set(thRef, {
                    tournamentId: tournamentId,
                    tournamentName: tournamentNameCache || "Tournament", // Or fetch
                    rank: rankNum,
                    totalKills: killsNum,
                    isWin: rankNum === 1,
                    date: serverTimestamp()
                }, { merge: true });
                
                // 3. Update overall team stats
                // Need to do this properly with transactions or increment
                // For safety in batch, we can use increment
                const teamRef = doc(db, "teams", teamId);
                batch.update(teamRef, {
                    totalKills: increment(killsNum),
                    totalEarnings: increment(rankNum === 1 ? 500 : 0), // Simple logic, can be customized based on tournament prize
                    lastUpdateAt: serverTimestamp()
                });

                validUpdates++;
            }
        }

        if (validUpdates > 0) {
            await batch.commit();
            showToast(`✅ Successfully saved rankings for ${validUpdates} team(s)!`, "success");
            // Trigger leaderboard silent update
            await addDoc(collection(db, "systemEvents"), { type: "leaderboard_updated", tournamentId: tournamentId, timestamp: serverTimestamp() });
        } else {
            showToast("No valid ranks entered. Please input ranks for teams.", "warning");
        }
    } catch (e) {
        console.error("Error saving rankings:", e);
        showToast("Error saving rankings: Permission Denied or Invalid Data.", "error");
    }
};