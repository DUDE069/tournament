// =============================================================================
//  NPC Esports — admin.js  (Refactored)
//  Firebase v10 · Modular SDK
//
//  Architecture:
//  ┌─ Auth Guard          onAuthStateChanged → checks users/{uid}.isAdmin
//  ├─ Badge Listener      collectionGroup("verifications") onSnapshot (pending)
//  ├─ Verification List   collectionGroup onSnapshot → renders pending cards
//  ├─ Approval Flow       updateDoc → writes notification to users/{uid}/notifications
//  └─ User-side trigger   main.js listens to that notification doc (see bottom)
// =============================================================================

import { db, auth } from '../public/js/firebase.js';
import {
  collection,
  collectionGroup,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  where,
  getDocs,
  updateDoc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ---------------------------------------------------------------------------
//  Module-level unsubscribe handles — lets us cleanly tear down listeners
//  on logout so we never leave orphaned Firestore connections open.
// ---------------------------------------------------------------------------
const _listeners = {
  badge:         null,   // collectionGroup badge counter
  verifications: null,   // verification list panel
  tournaments:   null,   // tournament list
  calendar:      null,   // calendar events list
};

/** Cancel every active listener and reset the map. */
function teardownAllListeners() {
  Object.keys(_listeners).forEach((key) => {
    if (_listeners[key]) {
      _listeners[key]();       // call the unsubscribe function returned by onSnapshot
      _listeners[key] = null;
    }
  });
}

// ---------------------------------------------------------------------------
//  Shared Firestore collection refs
// ---------------------------------------------------------------------------
const tournamentsRef = collection(db, "tournaments");
const calendarRef    = collection(db, "calendarEvents");

// ============================================================================
//  1. AUTH GUARD
//     • onAuthStateChanged is the single entry-point for the whole app.
//     • We read users/{uid}.isAdmin server-side on every page load —
//       a client-side flag stored in localStorage is NOT enough because
//       a user could simply edit it. We always go back to Firestore.
// ============================================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showLoginUI();
    return;
  }

  // Fetch the admin flag from the trusted server copy.
  const userSnap = await getDoc(doc(db, "users", user.uid));

  if (!userSnap.exists() || userSnap.data().isAdmin !== true) {
    // Not an admin — sign them out immediately and show an error.
    showToast("Access denied: not an admin account.", "error");
    await signOut(auth);
    showLoginUI();
    return;
  }

  // ✅ Confirmed admin — boot the panel.
  showAdminUI();
  initAdminListeners();
});

function showLoginUI() {
  teardownAllListeners();
  document.getElementById("loginSection").style.display = "block";
  document.getElementById("adminPanel").style.display  = "none";
}

function showAdminUI() {
  document.getElementById("loginSection").style.display = "none";
  document.getElementById("adminPanel").style.display  = "block";
}

/** Start all persistent real-time listeners after successful admin login. */
function initAdminListeners() {
  startBadgeListener();
  loadTournaments();
  loadCalendarEvents();
  // Verification list is lazy — started only when that tab is opened.
}

// ============================================================================
//  2. REAL-TIME BADGE — collectionGroup
//
//  WHY collectionGroup?
//  Using collectionGroup("verifications") with a where("status","==","pending")
//  filter lets Firestore watch ALL subcollections named "verifications" across
//  every tournament document in a single listener. This replaces the old
//  setInterval that:
//    (a) looped every tournament
//    (b) issued a separate getDocs per tournament
//    (c) ran unconditionally every 5 seconds regardless of changes
//
//  The new approach:
//    • Zero reads when nothing changes.
//    • One snapshot delivery per write event.
//    • Badge count is always perfectly in sync.
//
//  ⚠️  Firestore REQUIRES a composite index for collectionGroup queries
//  that combine a field filter with an orderBy.  For this simple
//  where("status","==","pending") with no orderBy, a single-field exemption
//  usually applies — but create the index in the Firebase Console if you
//  see an "index required" error in the JS console.
// ============================================================================
function startBadgeListener() {
  // Guard: don't stack duplicate listeners.
  if (_listeners.badge) return;

  const pendingQuery = query(
    collectionGroup(db, "verifications"),
    where("status", "==", "pending")
  );

  _listeners.badge = onSnapshot(
    pendingQuery,
    (snapshot) => {
      const count = snapshot.size;
      updateBadge(count);
    },
    (err) => {
      console.error("Badge listener error:", err.message);
      // If permissions fail (non-admin somehow got here) sign out.
      if (err.code === "permission-denied") signOut(auth);
    }
  );
}

/** Renders (or hides) the red notification badge on the Verifications tab. */
function updateBadge(count) {
  let badge = document.getElementById("verificationBadge");

  // Create the badge element if it doesn't exist yet in the DOM.
  if (!badge) {
    const tabBtn = document.querySelector('[onclick="showTab(\'verifications\')"]');
    if (!tabBtn) return;
    badge = document.createElement("span");
    badge.id = "verificationBadge";
    badge.style.cssText = `
      display: inline-block;
      background: #ff4444;
      color: #fff;
      border-radius: 10px;
      font-size: 11px;
      font-weight: bold;
      padding: 1px 6px;
      margin-left: 6px;
      vertical-align: middle;
    `;
    tabBtn.appendChild(badge);
  }

  if (count > 0) {
    badge.textContent = count;
    badge.style.display = "inline-block";
  } else {
    badge.style.display = "none";
  }
}

// ============================================================================
//  3. VERIFICATION LIST  (real-time, tab-scoped)
//
//  We use the same collectionGroup pending query here, but render the full
//  cards.  The listener is started lazily (only when the tab is opened) and
//  torn down when leaving the tab, so we aren't burning reads while the admin
//  is on the Tournaments tab.
//
//  Separation of concerns:
//    startBadgeListener  → always-on, count only, collectionGroup
//    loadVerifications   → tab-scoped, full render, collectionGroup
// ============================================================================
function loadVerifications() {
  // Cancel any stale listener before creating a new one.
  if (_listeners.verifications) {
    _listeners.verifications();
    _listeners.verifications = null;
  }

  const container = document.getElementById("verificationList");
  if (!container) return;
  container.innerHTML = '<p style="color:#888;">Loading…</p>';

  const pendingQuery = query(
    collectionGroup(db, "verifications"),
    where("status", "==", "pending"),
    orderBy("submittedAt", "desc")   // newest first — ensure index exists
  );

  _listeners.verifications = onSnapshot(
    pendingQuery,
    (snapshot) => renderVerificationList(snapshot),
    (err) => {
      console.error("Verification list error:", err.message);
      container.innerHTML = `<p style="color:#ff4444;">Error loading verifications: ${err.message}</p>`;
    }
  );
}



// ============================================================================
//  UPCOMING REGISTRATIONS (Phase 1)
// ============================================================================
function loadUpcomingRegistrations() {
  if (_listeners.upcoming) {
    _listeners.upcoming();
    _listeners.upcoming = null;
  }

  const container = document.getElementById("upcomingRegistrationsList");
  if (!container) return;
  
  container.innerHTML = '<p style="color:#888;">Loading upcoming registrations…</p>';

  // Query all upcomingRegistrations subcollections
  const upcomingQuery = query(
    collectionGroup(db, "upcomingRegistrations"),
    where("status", "==", "pending")
  );

  _listeners.upcoming = onSnapshot(upcomingQuery, (snapshot) => {
    if (snapshot.empty) {
      container.innerHTML = '<p style="color:#666;">No pending upcoming registrations.</p>';
      return;
    }

    let html = `<h3 style="color:#3b82f6; margin-bottom:16px;">Upcoming Tournament Registrations (${snapshot.size})</h3>`;
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      const tournamentId = doc.ref.parent.parent.id;
      
      html += `
        <div style="background:#1a1a2a; padding:15px; margin:10px 0; border-radius:8px; border-left:4px solid #3b82f6;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong style="color:#fff;">${escHtml(data.teamName)}</strong><br>
              <small style="color:#888;">Event: ${escHtml(data.eventDate || 'TBA')}</small><br>
              <small style="color:#888;">Leader: ${escHtml(data.leaderEmail)}</small>
            </div>
            <div style="display:flex; gap:8px;">
              <button onclick="approveUpcoming('${tournamentId}', '${doc.id}')"
                style="background:#00ff88; color:#000; border:none; padding:8px 16px; border-radius:4px; cursor:pointer;">
                Approve
              </button>
              <button onclick="rejectUpcoming('${tournamentId}', '${doc.id}')"
                style="background:#ff4444; color:#fff; border:none; padding:8px 16px; border-radius:4px; cursor:pointer;">
                Reject
              </button>
            </div>
          </div>
        </div>`;
    });
    
    container.innerHTML = html;
  });
}

window.approveUpcoming = async function(tournamentId, userId) {
  try {
    await updateDoc(doc(db, "tournaments", tournamentId, "upcomingRegistrations", userId), {
      status: "approved",
      processedAt: serverTimestamp()
    });
    
    // Notification is handled by the listener in main.js
    showToast("Upcoming registration approved!", "success");
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};

window.rejectUpcoming = async function(tournamentId, userId) {
  const reason = prompt("Enter rejection reason:");
  if (!reason) return;
  
  try {
    await updateDoc(doc(db, "tournaments", tournamentId, "upcomingRegistrations", userId), {
      status: "rejected",
      rejectionReason: reason,
      processedAt: serverTimestamp()
    });
    showToast("Registration rejected.", "success");
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};




/**
 * Renders the full pending verification cards from a snapshot.
 * Each card gets "View & Decide" which opens the detail modal.
 */
function renderVerificationList(snapshot) {
  const container = document.getElementById("verificationList");
  if (!container) return;

  if (snapshot.empty) {
    container.innerHTML = '<p style="color:#666; margin-top:20px;">✅ No pending verifications.</p>';
    return;
  }

  let html = `<h3 style="color:#ffd700; margin-bottom:16px;">Pending Applications (${snapshot.size})</h3>`;

  snapshot.forEach((vDoc) => {
    // collectionGroup docs have a path like tournaments/{tId}/verifications/{uId}
    // We can extract the tournament ID from the ref.parent.parent.
    const tournamentId = vDoc.ref.parent.parent.id;
    const v = vDoc.data();

    html += `
      <div style="
        background: #1a1a1a;
        padding: 15px;
        margin: 10px 0;
        border-radius: 8px;
        border-left: 4px solid #ffd700;
        display: flex;
        justify-content: space-between;
        align-items: center;
      ">
        <div>
          <strong style="color:#fff;">${escHtml(v.teamName ?? "—")}</strong><br>
          <small style="color:#888;">Tournament ID: ${escHtml(tournamentId)}</small><br>
          <small style="color:#888;">Leader: ${escHtml(v.leaderEmail ?? "—")}</small>
        </div>
        <button
          onclick="viewApplicationDetails('${tournamentId}', '${vDoc.id}')"
          style="background:#4a90e2; border:none; color:#fff; padding:8px 16px; border-radius:4px; cursor:pointer; font-weight:600;">
          View & Decide
        </button>
      </div>`;
  });

  container.innerHTML = html;
}

// ============================================================================
//  4. APPROVAL / REJECTION MODAL + DECISION FLOW
//
//  Flow:
//    Admin clicks "View & Decide"
//    → viewApplicationDetails() loads the doc and shows a modal
//    → Admin clicks Approve or Reject
//    → processDecision() does two atomic(ish) writes:
//        (a) updates tournaments/{tId}/verifications/{uId}.status
//        (b) adds a notification doc to users/{uId}/notifications
//    → main.js (user-side) has an onSnapshot on that notifications collection
//        and immediately reacts to the new doc — no page refresh needed.
// ============================================================================
window.viewApplicationDetails = async function (tournamentId, userId) {
  try {
    const docSnap = await getDoc(
      doc(db, "tournaments", tournamentId, "verifications", userId)
    );
    if (!docSnap.exists()) {
      showToast("Verification record not found.", "error");
      return;
    }
    const v = docSnap.data();

    // Remove any existing modal first.
    document.getElementById("verifModal")?.remove();

    const uids = Array.isArray(v.uids) ? v.uids.join(", ") : (v.uids ?? "—");

    const modal = document.createElement("div");
    modal.id = "verifModal";
    modal.style.cssText = `
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.92);
      display: flex; align-items: center; justify-content: center;
      z-index: 9999; padding: 20px;
    `;
    modal.innerHTML = `
      <div style="
        background: #1a1a1a; width: 100%; max-width: 520px;
        padding: 28px; border-radius: 12px; border: 1px solid #333;
      ">
        <h2 style="color:#00ff88; margin-bottom:20px;">
          Review: ${escHtml(v.teamName ?? "—")}
        </h2>

        <div style="display:grid; gap:12px; color:#ccc;">
          ${infoRow("Leader Email", v.leaderEmail ?? "—")}
          ${infoRow("Phone", v.phone ?? "—")}
          ${infoRow("Player UIDs", `<span style="font-family:monospace;color:#ffd700;">${escHtml(uids)}</span>`)}
          ${infoRow("Team Code", v.teamCode ?? "—")}
        </div>

        <textarea
          id="adminNote"
          placeholder="Rejection reason (required for rejections)…"
          style="
            width: 100%; height: 80px; margin-top: 18px;
            background: #000; color: #fff; border: 1px solid #444;
            padding: 10px; border-radius: 6px; resize: vertical;
            font-family: inherit;
          "
        ></textarea>

        <div style="margin-top: 18px; display:flex; gap:10px;">
          <button
            id="approveBtn"
            style="flex:1; background:#00ff88; color:#000; border:none; padding:12px; font-weight:bold; border-radius:6px; cursor:pointer;">
            ✅ Approve
          </button>
          <button
            id="rejectBtn"
            style="flex:1; background:#ff4444; color:#fff; border:none; padding:12px; font-weight:bold; border-radius:6px; cursor:pointer;">
            ❌ Reject
          </button>
        </div>
        <button
          onclick="document.getElementById('verifModal').remove()"
          style="width:100%; margin-top:10px; background:transparent; color:#666; border:none; cursor:pointer;">
          Cancel
        </button>
      </div>`;

    document.body.appendChild(modal);

    // Attach listeners after the modal is in the DOM.
    modal.querySelector("#approveBtn").addEventListener("click", () =>
      processDecision(tournamentId, userId, "approved")
    );
    modal.querySelector("#rejectBtn").addEventListener("click", () =>
      processDecision(tournamentId, userId, "rejected")
    );
  } catch (e) {
    showToast("Failed to load application: " + e.message, "error");
  }
};

/**
 * Writes the admin decision to Firestore.
 *
 * Two writes happen:
 *   1.  tournaments/{tId}/verifications/{uId}
 *         status        → "approved" | "rejected"
 *         rejectionNote → string (only for rejections)
 *         processedAt   → server timestamp
 *         processedBy   → admin UID
 *
 *   2.  users/{uId}/notifications  (new doc)
 *         type          → "verification_result"
 *         status        → "approved" | "rejected"
 *         tournamentId  → tId  (so main.js can route the user directly)
 *         message       → human-readable string
 *         read          → false
 *         createdAt     → server timestamp
 *
 *  On the USER side (main.js), an onSnapshot on
 *  users/{uid}/notifications (where read == false) picks up the new doc
 *  and immediately transitions the UI to the Payment Stage — no polling,
 *  no page refresh. See the companion snippet at the bottom of this file.
 */
async function processDecision(tournamentId, userId, status) {
  const note = document.getElementById("adminNote")?.value?.trim() ?? "";

  if (status === "rejected" && !note) {
    showToast("Please enter a rejection reason.", "warning");
    return;
  }

  const approveBtn = document.getElementById("approveBtn");
  const rejectBtn = document.getElementById("rejectBtn");

  if (approveBtn.disabled || rejectBtn.disabled) return;
  approveBtn.disabled = true;
  rejectBtn.disabled = true;
  approveBtn.textContent = "Processing...";

  try {
    // 1. Update the tournament verification document
    await updateDoc(
      doc(db, "tournaments", tournamentId, "verifications", userId),
      {
        status,
        rejectionNote: status === "rejected" ? note : "",
        processedAt: serverTimestamp(),
        processedBy: auth.currentUser?.uid ?? "unknown",
      }
    );

    // 2. SEND THE NOTIFICATION TO THE USER (This is what was missing/failing!)
    await addDoc(collection(db, "users", userId, "notifications"), {
      type: status === "approved" ? "approval" : "rejected", 
      title: status === "approved" ? "Application Approved!" : "Application Rejected",
      message: status === "approved"
        ? "Your team has been verified! Proceed to the payment stage."
        : `Your application was rejected: ${note}`,
      tournamentId: tournamentId,
      actionLink: `tournament=${tournamentId}`,
      read: false,
      popupShown: false, 
      createdAt: serverTimestamp(),
    });

    // 3. UI Cleanup
    document.getElementById("verifModal")?.remove();
    showToast(
      status === "approved" ? "✅ Team approved!" : "❌ Application rejected.",
      status === "approved" ? "success" : "error"
    );
  } catch (e) {
    console.error("Admin processing error:", e);
    showToast("Error processing decision: " + e.message, "error");
    approveBtn.disabled = false;
    rejectBtn.disabled = false;
    approveBtn.textContent = "✅ Approve";
  }
}
// ============================================================================
//  5. TAB NAVIGATION
//     Starts/stops the verification listener based on active tab to keep
//     Firestore read costs minimal.
// ============================================================================
window.currentTab = "tournaments";

window.showTab = function (tabName) {
  window.currentTab = tabName;

  // Highlight the correct tab button.
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  const activeBtn = document.querySelector(`[onclick="showTab('${tabName}')"]`);
  if (activeBtn) activeBtn.classList.add("active");

  // Show the correct section panel.
  document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));

  const sectionMap = {
    tournaments:   "tournamentsSection",
    calendar:      "calendarSection",
    verifications: "verificationsSection",
    upcoming:      "upcomingSection"
  };
  const sectionId = sectionMap[tabName];
  if (sectionId) document.getElementById(sectionId)?.classList.add("active");

  // Start the verification list listener only when on that tab.
  if (tabName === "verifications") {
    loadVerifications();
  } else {
    // Tear down the list listener (badge listener stays active).
    if (_listeners.verifications) {
      _listeners.verifications();
      _listeners.verifications = null;
    }
  }
};

// ===============================
// ADMIN SOUND ALERTS
// ===============================

const adminAudio = new (window.AudioContext || window.webkitAudioContext)();

function playAdminAlert() {
    if (adminAudio.state === 'suspended') adminAudio.resume();
    
    // Admin "ding" - distinct from user sound
    const osc = adminAudio.createOscillator();
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

// Play sound when new verification arrives (add to loadVerifications)
// Inside the onSnapshot callback, when snapshot.docChanges() has 'added':
if (change.type === "added" && change.doc.data().status === "pending") {
    playAdminAlert();
}



// ============================================================================
//  6. AUTH ACTIONS
// ============================================================================
window.adminLogin = async function () {
  const email = document.getElementById("adminEmail").value.trim();
  const pass  = document.getElementById("adminPass").value;
  if (!email || !pass) {
    showToast("Enter email and password.", "warning");
    return;
  }
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    // onAuthStateChanged will handle the rest.
  } catch (e) {
    showToast("Login failed: " + e.message, "error");
  }
};

window.logout = async function () {
  teardownAllListeners();
  await signOut(auth);
};

let currentTournamentCategory = 'ongoing';

// ============================================================================
//  7. TOURNAMENTS  (unchanged logic, just cleaned up)
// ============================================================================
// ============================================================================
//  CATEGORY HANDLING - Show/Hide fields based on selection
// ============================================================================
window.handleCategoryChange = function(select) {
    const category = select.value;
    currentTournamentCategory = category;
    
    const dateGroup = document.getElementById('eventDateGroup');
    const durationGroup = document.getElementById('tournamentDuration')?.parentElement;
    
    if (category === 'upcoming') {
        // Show date picker for upcoming
        if (dateGroup) dateGroup.style.display = 'block';
        // Hide duration for upcoming (no registration timer needed)
        if (durationGroup) durationGroup.style.display = 'none';
    } else {
        // Hide date for ongoing/limited (use createdAt + duration)
        if (dateGroup) dateGroup.style.display = 'none';
        // Show duration for ongoing/limited
        if (durationGroup) durationGroup.style.display = 'block';
    }
};

// ============================================================================
//  MODIFIED: Add Tournament with Auto-Calendar Sync
// ============================================================================
window.addTournament = async function () {
    const title    = document.getElementById("tournamentTitle").value.trim();
    const fee      = Number(document.getElementById("tournamentFee").value);
    const mode     = document.getElementById("tournamentMode").value;
    const category = document.getElementById("tournamentCategory").value;
    const duration = Number(document.getElementById("tournamentDuration")?.value) || 60;
    const first    = Number(document.getElementById("prizeFirst").value)  || 0;
    const second   = Number(document.getElementById("prizeSecond").value) || 0;
    const third    = Number(document.getElementById("prizeThird").value)  || 0;
    
    // NEW: Get event date for upcoming tournaments
    const eventDateInput = document.getElementById("tournamentEventDate")?.value;
    let eventDate = null;
    let endTime = null;

    if (!title || !fee) {
        showToast("Title and entry fee are required.", "warning");
        return;
    }

    // Validation for upcoming tournaments
    if (category === 'upcoming') {
        if (!eventDateInput) {
            showToast("Please select tournament date for upcoming events.", "warning");
            return;
        }
        eventDate = eventDateInput; // YYYY-MM-DD format
        
        // For upcoming, set endTime far in future (no registration limit)
        // Will be updated when promoted to ongoing
        endTime = new Date(eventDateInput).getTime() + (24 * 60 * 60 * 1000); // 1 day after event date
    } else {
        // For ongoing/limited, calculate from now + duration
        endTime = Date.now() + (duration * 60000);
    }

    try {
        // 1. Create Tournament
        const tournamentData = {
            title, 
            entryFee: fee, 
            mode, 
            category, 
            duration: category === 'upcoming' ? null : duration,
            eventDate: eventDate, // Only for upcoming
            prize: { first, second, third },
            createdAt: serverTimestamp(),
            endTime: endTime,
            status: category === "ongoing" ? "live" : "upcoming",
            isPaymentDeferred: category === 'upcoming' // true for upcoming
        };
        
        const tourneyRef = await addDoc(tournamentsRef, tournamentData);
        
        // 2. AUTO-CREATE CALENDAR EVENT (if upcoming)
        if (category === 'upcoming' && eventDate) {
            await addDoc(calendarRef, {
                date: eventDate,
                title: title,
                type: 'special', // Highlight as tournament day
                prize: first,
                description: `${mode} Tournament - Entry Fee: ₹${fee}`,
                tournamentId: tourneyRef.id,
                createdAt: serverTimestamp(),
                source: 'auto' // Mark as auto-created from tournament
            });
            showToast("Tournament added and calendar marked!", "success");
        } else {
            showToast("Tournament added!", "success");
        }
        
        // Clear form
        ["tournamentTitle","tournamentFee","prizeFirst","prizeSecond","prizeThird","tournamentEventDate"]
            .forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.value = "";
            });
            
    } catch (e) {
        showToast("Error: " + e.message, "error");
    }
};

window.deleteTournament = async function (id) {
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
    box.innerHTML = "";
    snapshot.forEach((d) => {
      const t = d.data();
      const div = document.createElement("div");
      div.className = "item-card";
      div.innerHTML = `
        <div>
          <strong style="color:#00ff88;">${escHtml(t.title)}</strong><br>
          <small>₹${t.entryFee} | ${t.mode} | ${t.category}</small>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn-delete" onclick="deleteTournament('${d.id}')">Delete</button>
        </div>`;
      box.appendChild(div);
    });
  });
}

// ============================================================================
//  8. CALENDAR  (unchanged logic, cleaned up)
// ============================================================================
window.selectColor = function (type, element) {
  document.querySelectorAll(".color-option").forEach((el) => el.classList.remove("selected"));
  element.classList.add("selected");
  document.getElementById("eventType").value = type;
};

window.addCalendarEvent = async function () {
  const date  = document.getElementById("eventDate").value;
  const title = document.getElementById("eventTitle").value.trim();
  const type  = document.getElementById("eventType").value;
  const prize = Number(document.getElementById("eventPrize").value) || 0;
  const desc  = document.getElementById("eventDesc").value.trim() || title;

  if (!date || !title) {
    showToast("Date and title are required.", "warning");
    return;
  }

  try {
    const existing = await getDocs(query(calendarRef, where("date", "==", date)));
    if (!existing.empty) {
      await updateDoc(doc(db, "calendarEvents", existing.docs[0].id), {
        title, type, prize, description: desc, updatedAt: serverTimestamp(),
      });
    } else {
      await addDoc(calendarRef, {
        date, title, type, prize, description: desc, createdAt: serverTimestamp(),
      });
    }
    ["eventDate","eventTitle","eventPrize","eventDesc"].forEach(
      (id) => (document.getElementById(id).value = "")
    );
    showToast("Calendar event saved!", "success");
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};

window.deleteCalendarEvent = async function (id) {
  if (!confirm("Delete this calendar event?")) return;
  try {
    await deleteDoc(doc(db, "calendarEvents", id));
    showToast("Event deleted.", "success");
  } catch (e) {
    showToast("Error: " + e.message, "error");
  }
};

window.editCalendarEvent = async function (id) {
  const snap = await getDoc(doc(db, "calendarEvents", id));
  if (!snap.exists()) { showToast("Event not found.", "error"); return; }
  const e = snap.data();

  document.getElementById("eventDate").value  = e.date  ?? "";
  document.getElementById("eventTitle").value = e.title ?? "";
  document.getElementById("eventPrize").value = e.prize ?? "";
  document.getElementById("eventDesc").value  = e.description ?? "";

  const colorEl = document.querySelector(`[onclick="selectColor('${e.type ?? "upcoming"}', this)"]`);
  if (colorEl) window.selectColor(e.type ?? "upcoming", colorEl);

  const btn = document.querySelector(".calendar-form .btn-submit");
  btn.textContent = "✓ Update Event";
  btn.onclick = () => window.updateCalendarEvent(id);
  document.querySelector(".calendar-form").scrollIntoView({ behavior: "smooth" });
};

window.updateCalendarEvent = async function (id) {
  const date  = document.getElementById("eventDate").value;
  const title = document.getElementById("eventTitle").value.trim();
  const type  = document.getElementById("eventType").value;
  const prize = Number(document.getElementById("eventPrize").value) || 0;
  const desc  = document.getElementById("eventDesc").value.trim() || title;

  if (!date || !title) { showToast("Date and title are required.", "warning"); return; }

  try {
    await updateDoc(doc(db, "calendarEvents", id), {
      date, title, type, prize, description: desc, updatedAt: serverTimestamp(),
    });
    ["eventDate","eventTitle","eventPrize","eventDesc"].forEach(
      (id) => (document.getElementById(id).value = "")
    );
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
    box.innerHTML = "";
    snapshot.forEach((d) => {
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
            <small style="color:#888;">${escHtml(e.description ?? "")}</small><br>
            ${e.prize ? `<small style="color:#00ff88;">Prize: ₹${e.prize}</small>` : ""}
          </div>
          <div style="display:flex;gap:5px;">
            <button onclick="editCalendarEvent('${d.id}')"   style="background:#4a90e2;color:#fff;border:none;padding:5px 10px;cursor:pointer;border-radius:4px;">Edit</button>
            <button onclick="deleteCalendarEvent('${d.id}')" style="background:#ff4444;color:#fff;border:none;padding:5px 10px;cursor:pointer;border-radius:4px;">×</button>
          </div>
        </div>`;
      box.appendChild(div);
    });
  });
}

// ============================================================================
//  9. PAYMENT VERIFICATION  (unchanged logic, cleaned up)
// ============================================================================
window.viewRegistrations = async function (tournamentId) {
  const participantsRef = collection(db, "tournaments", tournamentId, "participants");
  const snapshot = await getDocs(
    query(participantsRef, orderBy("timestamps.registeredAt", "desc"))
  );

  let html = `
    <h3>Registrations & Payment Verification</h3>
    <div style="margin-bottom:20px;">
      <input type="text" id="searchTransaction" placeholder="Search Transaction ID…"
        style="padding:10px;width:300px;background:#1a1a1a;border:1px solid #444;color:#fff;border-radius:4px;">
      <button onclick="searchTransaction('${tournamentId}')"
        style="padding:10px 20px;background:#4a90e2;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-left:10px;">
        Search
      </button>
    </div>
    <div style="display:grid;gap:10px;">`;

  snapshot.forEach((d) => {
    const p = d.data();
    const statusColor =
      p.paymentStatus === "verified" ? "#00ff88" :
      p.paymentStatus === "rejected" ? "#ff4444" : "#ffd700";
    html += `
      <div style="background:#1a1a1a;padding:15px;border-radius:8px;border-left:3px solid ${statusColor};display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="color:#fff;font-weight:bold;">${escHtml(p.teamName ?? "—")}</div>
          <div style="color:#888;font-size:12px;margin-top:5px;">UID: ${escHtml(p.freeFireUid ?? "—")} | Phone: ${escHtml(p.phoneNumber ?? "—")}</div>
          <div style="color:#666;font-size:11px;margin-top:3px;">Txn: <span style="font-family:monospace;color:#ffd700;">${escHtml(p.transactionCode ?? "—")}</span></div>
          <div style="margin-top:5px;">
            <span style="background:${statusColor};color:#000;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:bold;">${p.paymentStatus ?? "pending"}</span>
          </div>
        </div>
        <div style="display:flex;gap:5px;">
          <button onclick="verifyPayment('${tournamentId}','${d.id}',true)"
            style="background:#00ff88;color:#000;border:none;padding:5px 15px;border-radius:4px;cursor:pointer;font-size:12px;">✓ Verify</button>
          <button onclick="verifyPayment('${tournamentId}','${d.id}',false)"
            style="background:#ff4444;color:#fff;border:none;padding:5px 15px;border-radius:4px;cursor:pointer;font-size:12px;">✗ Reject</button>
        </div>
      </div>`;
  });

  html += "</div>";
  document.getElementById("adminList").innerHTML = html;
};

window.searchTransaction = async function (tournamentId) {
  const code = document.getElementById("searchTransaction").value.trim().toUpperCase();
  if (!code) return;
  const snap = await getDocs(
    query(
      collection(db, "tournaments", tournamentId, "participants"),
      where("transactionCode", "==", code)
    )
  );
  if (snap.empty) {
    showToast("Transaction ID not found.", "error");
  } else {
    const p = snap.docs[0].data();
    showToast(`Found — Team: ${p.teamName} | Status: ${p.paymentStatus}`, "success");
  }
};

window.verifyPayment = async function (tournamentId, participantId, isVerified) {
  const status = isVerified ? "verified" : "rejected";
  try {
    await updateDoc(doc(db, "tournaments", tournamentId, "participants", participantId), {
      paymentStatus:     status,
      paymentVerifiedBy: auth.currentUser?.email ?? "unknown",
      paymentVerifiedAt: serverTimestamp(),
    });
    showToast(`Payment ${status}.`, isVerified ? "success" : "error");
    window.viewRegistrations(tournamentId);
  } catch (e) {
    showToast("Error verifying payment: " + e.message, "error");
  }
};

// ============================================================================
//  UTILITY HELPERS
// ============================================================================

/** Escape HTML to prevent XSS in admin-rendered strings from Firestore. */
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Small label → value row for the detail modal. */
function infoRow(label, value) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;background:#222;padding:10px;border-radius:6px;">
      <span style="color:#888;font-size:13px;">${label}</span>
      <span>${value}</span>
    </div>`;
}

/** Non-blocking toast notification (replaces alert()). */
function showToast(message, type = "success") {
  const toast = document.createElement("div");
  const bg = { success: "#2e7d32", error: "#c62828", warning: "#f57f17" }[type] ?? "#333";
  const color = type === "warning" ? "#333" : "#fff";
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px;
    background: ${bg}; color: ${color};
    padding: 12px 20px; border-radius: 10px;
    font-size: 14px; z-index: 9999; max-width: 320px;
    animation: fadeInUp 0.2s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}


// ============================================================================
//  COMPANION SNIPPET — paste into main.js (user-side)
//
//  This is what makes the user's UI transition to the Payment Stage
//  immediately when the admin clicks Approve — zero polling, zero refresh.
//
//  Place this inside your onAuthStateChanged callback in main.js,
//  after confirming the user is logged in.
// ============================================================================
/*
import { collection, query, where, onSnapshot, updateDoc, doc } from "firebase/firestore";

function startNotificationListener(userId) {
  const notifQuery = query(
    collection(db, "users", userId, "notifications"),
    where("read", "==", false)
  );

  onSnapshot(notifQuery, (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type !== "added") return;

      const notif   = change.doc.data();
      const notifId = change.doc.id;

      if (notif.type === "verification_result") {
        if (notif.status === "approved") {
          // ✅ Transition UI to Payment Stage immediately.
          showPaymentStage(notif.tournamentId);
        } else if (notif.status === "rejected") {
          // ❌ Show rejection message.
          showRejectionMessage(notif.message);
        }

        // Mark the notification as read so we don't re-process it on reload.
        await updateDoc(
          doc(db, "users", userId, "notifications", notifId),
          { read: true }
        );
      }
    });
  });
}
*/