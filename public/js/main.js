// ===============================
// NPC ESPORTS MAIN SYSTEM (FIREBASE AUTH + TEAM SYSTEM + CALENDAR)
// ===============================

// FIREBASE IMPORTS (SINGLE BLOCK - NO DUPLICATES)
import { db, auth } from "./firebase.js";

import {
  collection, onSnapshot, doc, setDoc, getDoc, serverTimestamp,
  addDoc, updateDoc, query, where, getDocs, arrayUnion, orderBy, increment,
  runTransaction, writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword, 
    onAuthStateChanged,
    signOut,
    updatePassword,
    sendEmailVerification,
    sendPasswordResetEmail,
    reauthenticateWithCredential,
    EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";


const tournamentsRef = collection(db, "tournaments");
const calendarRef    = collection(db, "calendarEvents");


const DEBUG = true;
function log(...msg)   { if (DEBUG) console.log("[NPC DEBUG]", ...msg); }
function warn(...msg)  { console.warn("[NPC WARN]", ...msg); }
function error(...msg) { console.error("[NPC ERROR]", ...msg); }

// ===============================
// GLOBAL STATE
// ===============================
let editingId           = null;
let isLoggedIn          = false;
let selectedRole        = "";
let tournaments         = [];
let currentUser         = null;
let userProfile         = null;
let profileLoadPromise  = null; // NEW: Track profile loading
let calendarEvents      = [];
let currentCalendarDate = new Date();
let unsubNotifications  = null;
const activeTimers = new Map();


let userWallet = { balance: 0, transactions: [], pending: 0 };
let audioContext = null; // Don't initialize it immediately
let currentStream = null;

// ===============================
// PROFILE CLICK HANDLER
// ===============================
function handleProfileClick() {
    if (currentUser) {
        openPersonalProfile(); // ✅ FIXED: Now opens the personal summary first
    } else {
        openLogin();
    }
}

// ===============================
// PREVENT AUTO-SCROLL ON PAGE LOAD
// ===============================
if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
}
// Force the page to start at the absolute top
window.scrollTo(0, 0);

// Remove any lingering #hash from the URL that might force a scroll
if (window.location.hash) {
    window.history.replaceState(null, null, window.location.pathname);
}



// ===============================
// UPCOMING TOURNAMENT REGISTRATION (Phase 1)
// ===============================
window.handleUpcomingRegister = async function(tournamentId) {
    if (!currentUser) { openLogin(); return; }

    const tournament = tournaments.find(t => t.id === tournamentId);
    if (!tournament) { showMessage("Tournament not found"); return; }

    // Check if user has team (required)
    if (!userProfile?.teamId) {
        showMessage("Please create or join a team first!");
        document.getElementById("viewerBlocker").style.display = "block";
        document.getElementById("registrationContainer").style.display = "none";
        document.getElementById("joinTournamentModal").style.display = "block";
        document.body.style.overflow = "hidden";
        return;
    }

    window.currentJoiningTournament = tournamentId;
    window.currentTournamentType = 'upcoming'; // Flag for upcoming

    // Setup modal for upcoming (no payment fields)
    document.getElementById("viewerBlocker").style.display = "none";
    document.getElementById("registrationContainer").style.display = "block";
    document.getElementById("joinTournamentModal").style.display = "block";
    document.body.style.overflow = "hidden";

    // Fill header info
    document.getElementById("joinTournamentTitle").textContent  = tournament.title;
    document.getElementById("joinPrizeFirst").textContent       = tournament.prize?.first || 0;
    document.getElementById("prizeFirst").textContent           = tournament.prize?.first || 0;
    document.getElementById("prizeSecond").textContent          = tournament.prize?.second || 0;
    document.getElementById("prizeThird").textContent           = tournament.prize?.third || 0;
    
    // HIDE Payment elements for upcoming
    document.getElementById("walletBalance").parentElement.style.display = "none"; // Hide wallet
    document.getElementById("joinEntryFeeDisplay").parentElement.style.display = "none"; // Hide entry fee display
    
    // SHOW Date prominently for upcoming
    const eventDate = tournament.eventDate ? new Date(tournament.eventDate).toLocaleDateString('en-IN', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }) : 'TBA';
    
    // Add date banner if not exists
    let dateBanner = document.getElementById("upcomingDateBanner");
    if (!dateBanner) {
        const form = document.getElementById("tournamentJoinForm");
        dateBanner = document.createElement("div");
        dateBanner.id = "upcomingDateBanner";
        dateBanner.style.cssText = `
            background: rgba(59, 130, 246, 0.1); 
            border: 1px solid #3b82f6; 
            border-radius: 8px; 
            padding: 15px; 
            margin-bottom: 20px;
            text-align: center;
        `;
        form.insertBefore(dateBanner, form.firstChild);
    }
    
    dateBanner.innerHTML = `
        <div style="color: #3b82f6; font-size: 14px; margin-bottom: 5px;">Tournament Schedule</div>
        <div style="color: #fff; font-size: 20px; font-weight: bold;">${eventDate}</div>
        ${tournament.eventTime ? `<div style="color:#3b82f6;font-size:16px;font-weight:600;margin-top:4px;">⏰ ${tournament.eventTime}</div>` : ''}
        <div style="color: #888; font-size: 12px; margin-top: 5px;">
            Free registration now • Payment required 1 day before match
        </div>
    `;

    // Update timer to show days until event
    const timerEl = document.getElementById("headerTimer");
    if (timerEl && tournament.eventDate) {
        const updateCountdown = () => {
            const now = new Date();
            const event = new Date(tournament.eventDate);
            const diff = event - now;
            
            if (diff > 0) {
                const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                timerEl.textContent = `${days} days until match`;
                timerEl.style.color = "#3b82f6";
            }
        };
        updateCountdown();
        if (window.headerTimerInterval) clearInterval(window.headerTimerInterval);
        window.headerTimerInterval = setInterval(updateCountdown, 60000);
    }

    // Fill user data (same as ongoing)
    document.getElementById("joinDisplayEmail").textContent = userProfile.email;
    document.getElementById("joinDisplayAge").textContent   = userProfile.age + " years";
    document.getElementById("joinDisplayTeam").textContent  = userProfile.teamName;
    document.getElementById("joinDisplayCode").textContent  = "Code: " + (userProfile.teamCode || "N/A");

    // Clear previous values
    document.getElementById("uidPlayer1").value     = userProfile.freeFireUid || "";
    document.getElementById("joinBackupEmail").value = "";
    document.getElementById("uidPlayer2").value     = "";
    document.getElementById("uidPlayer3").value     = "";
    document.getElementById("uidPlayer4").value     = "";
    document.getElementById("uidPlayer5").value     = "";
    document.getElementById("joinPhone").value       = "";

    // Change submit button text
    const submitBtn = document.getElementById("joinSubmitBtn");
    if (submitBtn) {
        submitBtn.textContent = "Submit for Verification →";
        submitBtn.style.background = "#3b82f6"; // Blue for upcoming
    }
    
    // Store tournament type for form handler
    window.currentTournamentCategory = 'upcoming';
};



// ===============================
// TOURNAMENT RENDER SYSTEM
// ===============================
function renderTournaments() {
    console.log("[DEBUG] Rendering tournaments:", tournaments.length);

    const ongoing  = document.getElementById("ongoingContainer");
    const upcoming = document.getElementById("upcomingContainer");
    const limited  = document.getElementById("limitedContainer");

    if (!ongoing || !upcoming || !limited) return;

    const sections = { ongoing: '', upcoming: '', limited: '' };
    const now = Date.now();

    tournaments.forEach((t) => {
        if (!t.title) return;

        const isAdminUser = userProfile?.isAdmin === true;
        
        // Determine card content based on category
        let buttonHTML = '';
        let timerHTML = '';
        let cardStyle = '';

        if (t.category === "ongoing") {
            // ONGOING LOGIC
            const hasStarted = t.endTime && now > t.endTime;
            const joinDisabled = hasStarted ? 'disabled' : '';
            const joinStyle = hasStarted ? 'opacity:0.6;cursor:not-allowed;' : '';
            
            if (!hasStarted && t.endTime) {
                timerHTML = `
                    <div class="timer-box">
                        <p class="section-title">⏳ Registration Ends In</p>
                        <div class="timer" data-end="${t.endTime}" data-id="${t.id}"></div>
                    </div>`;
            } else if (hasStarted) {
                timerHTML = `
                    <div class="timer-box">
                        <p class="section-title" style="color:#ff4444;">⏱ Match Started</p>
                    </div>`;
                cardStyle = 'border:2px solid #ff4444;';
            }

            buttonHTML = `
                <button class="join-btn" onclick="handleJoin('${t.id}')" ${joinDisabled} style="${joinStyle}">
                    ${hasStarted ? "Closed" : "Join Now"}
                </button>`;
                // ✅ ADD THE NEW CODE RIGHT HERE, before the closing } of the ongoing block
    if (t.status === 'completed') {
        buttonHTML = `
            <button class="join-btn" onclick="showTournamentResults('${t.id}')"
                style="background: #ffd700; border-color: #ffd700; color: #000;">
                🏆 See Results
            </button>`;}

        } else if (t.category === "upcoming") {
            // UPCOMING LOGIC (NEW)
            const eventDateStr = t.eventDate ? new Date(t.eventDate).toLocaleDateString('en-IN', {
                day: 'numeric', month: 'short', year: 'numeric'
            }) : 'Date TBA';
            
            timerHTML = `
                <div class="timer-box" style="background: rgba(59, 130, 246, 0.1); border: 1px solid #3b82f6;">
                    <p style="color: #3b82f6; font-size: 12px; margin: 0 0 5px;">📅 Tournament Date</p>
                    <div style="color: #fff; font-size: 16px; font-weight: bold;">${eventDateStr}</div>
                    ${t.eventTime ? `<div style="color:#3b82f6;font-size:14px;font-weight:600;margin-top:3px;">⏰ ${t.eventTime}</div>` : ''}
                </div>`;
            
            buttonHTML = `
                <button class="join-btn" onclick="handleUpcomingRegister('${t.id}')"
                    style="background: #3b82f6; border-color: #3b82f6;">
                    Register Team
                </button>`;
                
                
            cardStyle = 'border-left: 4px solid #3b82f6;';

        } else if (t.category === "limited") {
            // LIMITED LOGIC — no entry fee shown, "Notify Me" button
            const startLabel = t.endTime
                ? new Date(t.endTime).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                : 'TBA';

            timerHTML = `
                <div class="timer-box" style="background:rgba(255,215,0,0.1);border:1px solid #ffd700;">
                    <p style="color:#ffd700;font-size:12px;margin:0 0 4px;">⚡ Limited Tournament</p>
                    <div style="color:#fff;font-size:13px;">Ends: ${startLabel}</div>
                </div>`;

            buttonHTML = `
                <button class="join-btn" onclick="handleNotifyMe('${t.id}','${(t.title || '').replace(/'/g, "\\'")}')"
                    style="background:#ffd700;color:#000;border-color:#ffd700;">
                    🔔 Notify Me
                </button>`;

            cardStyle = 'border-left: 4px solid #ffd700;';
        }

        const card = `
            <div class="card" style="position:relative; ${cardStyle}">
                <div>
                    <h3>${t.title}</h3>
                    ${t.category !== 'limited' ? `<p class="entry"><b>Entry Fee:</b> ₹${t.entryFee || 0}</p>` : ''}
                    <p class="mode"><b>Mode:</b> ${t.mode || "N/A"}</p>

                    ${t.category === 'upcoming' && t.eventTime
                        ? `<p style="color:#3b82f6;font-size:13px;margin:4px 0;"><b>⏰ Time:</b> ${t.eventTime}</p>`
                        : ''
                    }

                    ${t.category === 'limited'
                        ? `<div class="prize-box">
                             <p class="section-title">🏆 Prize Pool</p>
                             <div class="prize-list">
                               <span>1st: ₹${t.prize?.first || 0}</span>
                               <span>2nd: ₹${t.prize?.second || 0}</span>
                               <span>3rd: ₹${t.prize?.third || 0}</span>
                             </div>
                           </div>`
                        : t.title?.toLowerCase().includes("flash")
                            ? `<p class="winner-prize"><b>Winner Prize:</b> ₹${t.prize?.first || 0}</p>`
                            : `<div class="prize-box">
                                 <p class="section-title">🏆 Prize Pool</p>
                                 <div class="prize-list">
                                   <span>1st: ₹${t.prize?.first || 0}</span>
                                   <span>2nd: ₹${t.prize?.second || 0}</span>
                                   <span>3rd: ₹${t.prize?.third || 0}</span>
                                 </div>
                               </div>`
                    }

                    ${timerHTML}
                    ${buttonHTML}

                    ${isAdminUser ? `<button onclick="editTournament('${t.id}')" style="margin-top:10px;background:#ff6b35;">Edit</button>` : ""}
                </div>
            </div>`;

        if (t.category === "ongoing") sections.ongoing += card;
        else if (t.category === "upcoming") sections.upcoming += card;
        else if (t.category === "limited") sections.limited += card;
    });

    ongoing.innerHTML  = sections.ongoing  || `<p class="empty-msg">No active tournaments</p>`;
    upcoming.innerHTML = sections.upcoming || `<p class="empty-msg">No upcoming tournaments</p>`;
    limited.innerHTML  = sections.limited  || `<p class="empty-msg">No limited tournaments</p>`;

    handleScrollVisibility();
    startTimers();
}


// ===============================
// JOIN SYSTEM
// ===============================
// ============================================================
// PATCH FOR main.js — replace window.handleJoin entirely
// This adds an already-submitted check at the top so when a
// user clicks a tournament they already applied for, they see
// their submitted details in a read-only "status" view instead
// of empty verified fields.
// ============================================================

window.handleJoin = async function(tournamentId) {
    if (!currentUser) { openLogin(); return; }

    const tournament = tournaments.find(t => t.id === tournamentId);
    if (!tournament) { showMessage("Tournament not found"); return; }

    if (tournament.category !== "ongoing") {
        showMessage("Registration closed for this tournament");
        return;
    }

    const now = Date.now();
    if (tournament.endTime && now > tournament.endTime) {
        showMessage("Match has already started");
        return;
    }

    // ── NEW: Check if user already submitted ──────────────────
    try {
        const existingSnap = await getDoc(
            doc(db, "tournaments", tournamentId, "verifications", currentUser.uid)
        );

        if (existingSnap.exists()) {
            const existing = existingSnap.data();
            const statusColor = existing.status === "approved"
                ? "#00ff88"
                : existing.status === "rejected"
                    ? "#ff4444"
                    : "#ffd700";
            const statusLabel = existing.status === "approved"
                ? "✅ Approved — Proceed to payment"
                : existing.status === "rejected"
                    ? `❌ Rejected — Reason: ${existing.rejectionNote || "Contact admin"}`
                    : "⏳ Under Review — Admin will notify you";

            const uids = Array.isArray(existing.uids)
                ? existing.uids.join(", ")
                : (existing.uids ?? "—");

            // Remove any existing already-applied modal
            document.getElementById("alreadyAppliedModal")?.remove();

            document.body.insertAdjacentHTML("beforeend", `
                <div id="alreadyAppliedModal"
                    style="position:fixed;inset:0;background:rgba(0,0,0,0.92);
                           display:flex;align-items:center;justify-content:center;
                           z-index:9999;padding:20px;">
                    <div style="background:#1a1a1a;width:100%;max-width:480px;padding:28px;
                                border-radius:14px;border:1px solid #333;">

                        <h2 style="color:#00ff88;margin-bottom:6px;">Application Status</h2>
                        <p style="color:#888;font-size:13px;margin-bottom:20px;">
                            You have already applied for <b style="color:#fff;">${tournament.title}</b>
                        </p>

                        <div style="background:rgba(${existing.status === "approved" ? "0,255,136" : existing.status === "rejected" ? "255,68,68" : "255,215,0"},.1);
                                    border:1px solid ${statusColor};border-radius:10px;
                                    padding:14px 16px;margin-bottom:20px;
                                    color:${statusColor};font-size:14px;font-weight:600;">
                            ${statusLabel}
                        </div>

                        <div style="display:grid;gap:8px;margin-bottom:20px;">
                            ${infoRowUser("Team Name",    existing.teamName   ?? "—")}
                            ${infoRowUser("Leader Email", existing.leaderEmail ?? "—")}
                            ${infoRowUser("Phone",        existing.phone       ?? "—")}
                            ${infoRowUser("Player UIDs",  uids)}
                            ${infoRowUser("Submitted",    existing.submittedAt?.toDate?.()?.toLocaleString("en-IN") ?? "—")}
                        </div>

                        ${existing.status === "approved" ? `
                        <button onclick="document.getElementById('alreadyAppliedModal').remove(); showPaymentInterface('${tournamentId}');"
                            style="width:100%;padding:12px;background:#00ff88;color:#000;border:none;
                                   border-radius:8px;font-weight:700;cursor:pointer;font-size:15px;
                                   margin-bottom:10px;">
                            💳 Proceed to Payment →
                        </button>` : ""}

                        <button onclick="document.getElementById('alreadyAppliedModal').remove()"
                            style="width:100%;padding:10px;background:transparent;color:#666;
                                   border:1px solid #333;border-radius:8px;cursor:pointer;">
                            Close
                        </button>
                    </div>
                </div>`);
            return; // ← stop here, don't open the regular form
        }
    } catch (checkErr) {
        console.warn("Could not check existing application:", checkErr.message);
        // If check fails, fall through to normal flow
    }
    // ── END already-submitted check ───────────────────────────

    window.currentJoiningTournament = tournamentId;

    if (!userProfile?.teamId) {
        document.getElementById("viewerBlocker").style.display        = "block";
        document.getElementById("registrationContainer").style.display = "none";
        document.getElementById("joinTournamentModal").style.display   = "block";
        document.body.style.overflow = "hidden";
        return;
    }

    document.getElementById("viewerBlocker").style.display        = "none";
    document.getElementById("registrationContainer").style.display = "block";
    document.getElementById("joinTournamentModal").style.display   = "block";
    document.body.style.overflow = "hidden";

    document.getElementById("joinTournamentTitle").textContent  = tournament.title;
    document.getElementById("joinPrizeFirst").textContent       = tournament.prize?.first || 0;
    document.getElementById("prizeFirst").textContent           = tournament.prize?.first || 0;
    document.getElementById("prizeSecond").textContent          = tournament.prize?.second || 0;
    document.getElementById("prizeThird").textContent           = tournament.prize?.third || 0;
    document.getElementById("joinEntryFeeDisplay").textContent  = tournament.entryFee;
    document.getElementById("paymentAmount").textContent        = tournament.entryFee;
    document.getElementById("walletBalance").textContent        = "0";

    function updateHeaderTimer() {
        const distance = tournament.endTime - Date.now();
        const timerEl  = document.getElementById("headerTimer");
        if (!timerEl) return;
        if (distance > 0) {
            const hours   = Math.floor(distance / 3600000);
            const minutes = Math.floor((distance % 3600000) / 60000);
            timerEl.textContent = `${hours}h ${minutes}m left`;
        } else {
            timerEl.textContent = "Starting soon";
        }
    }
    updateHeaderTimer();
    window.headerTimerInterval = setInterval(updateHeaderTimer, 60000);

    const matchDate = new Date(tournament.endTime);
    document.getElementById("joinStartTime").textContent = matchDate.toLocaleString('en-IN', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });

    document.getElementById("joinDisplayEmail").textContent = userProfile.email;
    document.getElementById("joinDisplayAge").textContent   = userProfile.age + " years";
    document.getElementById("joinDisplayTeam").textContent  = userProfile.teamName;
    document.getElementById("joinDisplayCode").textContent  = "Code: " + (userProfile.teamCode || "N/A");

    document.getElementById("uidPlayer1").value      = userProfile.freeFireUid || "";
    document.getElementById("joinBackupEmail").value = "";
    document.getElementById("uidPlayer2").value      = "";
    document.getElementById("uidPlayer3").value      = "";
    document.getElementById("uidPlayer4").value      = "";
    document.getElementById("uidPlayer5").value      = "";
    document.getElementById("joinPhone").value        = "";

    if (userProfile.isLeader) {
        document.getElementById("joinDisplayLeader").textContent = "👑 You are the Team Leader";
    } else {
        try {
            const teamDoc    = await getDoc(doc(db, "teams", userProfile.teamId));
            const leaderName = teamDoc.exists() ? teamDoc.data().leaderName : "Unknown";
            document.getElementById("joinDisplayLeader").textContent = `👤 Leader: ${leaderName}`;
        } catch (e) {
            document.getElementById("joinDisplayLeader").textContent = "👤 Team Member";
        }
    }
};

// Helper for already-applied modal rows
function infoRowUser(label, value) {
    return `
        <div style="display:flex;justify-content:space-between;align-items:center;
                    background:#0f0f0f;padding:10px 14px;border-radius:8px;">
            <span style="color:#666;font-size:13px;">${label}</span>
            <span style="color:#fff;font-size:13px;font-weight:600;
                         max-width:60%;text-align:right;word-break:break-all;">${value}</span>
        </div>`;
}

window.closeJoinModal = function() {
    document.getElementById('joinTournamentModal').style.display  = 'none';
    document.getElementById('uidCheckingOverlay').style.display   = 'none';
    document.getElementById('processingOverlay').style.display    = 'none';
    document.getElementById('viewerBlocker').style.display        = 'none';
    document.body.style.overflow = 'auto';

    const submitBtn = document.getElementById('joinSubmitBtn');
    if (submitBtn) {
        submitBtn.disabled    = false;
        submitBtn.textContent = 'Submit for Verification →';
    }

    document.getElementById('registrationContainer').style.display = 'none';
    window.currentJoiningTournament = null;

    if (window.headerTimerInterval) {
        clearInterval(window.headerTimerInterval);
        window.headerTimerInterval = null;
    }

    console.log('✅ Modal fully reset');
};

window.showGuidelines = function() {
    const modal = document.getElementById("guidelinesModal");
    if (modal) modal.style.display = "block";
};

window.closeGuidelines = function() {
    const modal = document.getElementById("guidelinesModal");
    if (modal) modal.style.display = "none";
};

// ===============================
// FORM SUBMISSION (Handles BOTH Ongoing & Upcoming)
// ===============================
document.addEventListener("DOMContentLoaded", function() {
    const form = document.getElementById("tournamentJoinForm");
    if (!form) return;

    form.addEventListener("submit", async function(e) {
        e.preventDefault();

        const submitBtn  = document.getElementById("joinSubmitBtn");
        const processing = document.getElementById("processingOverlay");

        // Get tournament type
        const tournamentId = window.currentJoiningTournament;
        const isUpcoming = window.currentTournamentCategory === 'upcoming';
        const tournament = tournaments.find(t => t.id === tournamentId);
        
        if (!tournament) {
            showMessage("Tournament data not found");
            return;
        }

        // Collect UIDs
        const uids = [
            document.getElementById("uidPlayer1").value.trim(),
            document.getElementById("uidPlayer2").value.trim(),
            document.getElementById("uidPlayer3").value.trim(),
            document.getElementById("uidPlayer4").value.trim(),
            document.getElementById("uidPlayer5").value.trim()
        ].filter(uid => uid !== "");

        if (uids.length < 4) {
            showMessage("Please enter at least 4 player UIDs");
            return;
        }

        // Validate phone
        const phoneRaw = document.getElementById("joinPhone").value.trim();
        if (!phoneRaw || !/^\d{10}$/.test(phoneRaw)) {
            showMessage("Please enter valid 10-digit phone number");
            return;
        }
        const formattedPhone = "+91" + phoneRaw;

        // Validate email
        const backupEmail = document.getElementById("joinBackupEmail").value.trim();
        if (!backupEmail || !backupEmail.includes('@')) {
            showMessage("Please enter valid backup email");
            return;
        }

        // Show loading
        submitBtn.disabled = true;
        submitBtn.textContent = isUpcoming ? "Registering..." : "Sending...";
        if (processing) processing.style.display = "flex";

        try {
            const userId = currentUser.uid;

            if (isUpcoming) {
                // ========================================
                // UPCOMING TOURNAMENT (No Payment Required Now)
                // ========================================
                
                // 1. Save to upcomingRegistrations (separate collection)
                await setDoc(doc(db, "tournaments", tournamentId, "upcomingRegistrations", userId), {
                    userId:       userId,
                    teamId:       userProfile.teamId,
                    teamName:     userProfile.teamName,
                    teamCode:     userProfile.teamCode,
                    leaderEmail:  userProfile.email,
                    leaderUid:    uids[0],
                    uids:         uids,
                    phone:        formattedPhone,
                    backupEmail:  backupEmail,
                    status:       "pending", // Admin needs to approve
                    registeredAt: serverTimestamp(),
                    eventDate:    tournament.eventDate,
                    category:     "upcoming"
                });

                // 2. Track in user's profile (optional, for "My Registrations")
                await setDoc(doc(db, "users", userId, "upcomingRegistrations", tournamentId), {
                    tournamentId: tournamentId,
                    title:          tournament.title,
                    eventDate:      tournament.eventDate,
                    teamName:       userProfile.teamName,
                    status:         "pending_verification",
                    registeredAt:   serverTimestamp()
                });

                // 3. Start listener for admin approval (separate listener for upcoming)
                listenToUpcomingApproval(tournamentId, userId);

                // 4. Show success
                if (processing) processing.style.display = "none";
                closeJoinModal();
                
                showPopup(
                    "success",
                    `Successfully registered for "${tournament.title}"!\n\n📅 Date: ${new Date(tournament.eventDate).toLocaleDateString('en-IN')}\n\nYour application is under review. You will be notified once approved.`, 
                    "Got it",
                    () => document.getElementById('customPopup')?.remove()
                );

            } else {
                // ========================================
                // ONGOING TOURNAMENT (Existing Logic - Keep As Is)
                // ========================================
                
                // 1. Save verification record for admin
                await setDoc(doc(db, "tournaments", tournamentId, "verifications", userId), {
                    userId:      userId,
                    teamId:      userProfile.teamId,
                    teamName:    userProfile.teamName,
                    teamCode:    userProfile.teamCode,
                    leaderEmail: userProfile.email,
                    leaderUid:   uids[0],
                    uids:        uids,
                    phone:       formattedPhone,
                    backupEmail: backupEmail,
                    status:      "pending",
                    submittedAt: serverTimestamp()
                });

                // 2. Save pending payment data
                await setDoc(doc(db, "users", userId, "pendingPayment", tournamentId), {
                    tournamentId: tournamentId,
                    teamName:     userProfile.teamName,
                    uids:         uids,
                    phone:        formattedPhone,
                    backupEmail:  backupEmail,
                    entryFee:     tournament?.entryFee || 0,
                    submittedAt:  serverTimestamp()
                });

                // 3. Lock registration
                await setDoc(
                    doc(db, "tournaments", tournamentId, "lockedRegistrations", userId),
                    { lockedAt: serverTimestamp(), editable: false },
                    { merge: true }
                );

                // 4. Start listening for admin decision
                listenToVerification(tournamentId, userId);

                // 5. Show success
                if (processing) processing.style.display = "none";
                closeJoinModal();
                
                showPopup(
                    "success", 
                    `Application Submitted! Your team "${userProfile.teamName}" is now under review. Check your notifications (🔔) for updates.`, 
                    "Got it", 
                    () => document.getElementById('customPopup')?.remove()
                );
            }

            // Reset button
            submitBtn.disabled = false;
            submitBtn.textContent = isUpcoming ? "Register Team →" : "Submit for Verification →";

        } catch (err) {
            console.error("Submit error:", err);
            if (processing) processing.style.display = "none";
            showMessage("Error submitting: " + err.message);
            submitBtn.disabled = false;
            submitBtn.textContent = isUpcoming ? "Register Team →" : "Submit for Verification →";
        }
    });
});

// ===============================
// PAYMENT INTERFACE
// ===============================
window.showPaymentInterface = async function(tournamentId) {
    if (!tournamentId) { showMessage("Tournament ID missing"); return; }
    await openPaymentInterface(tournamentId);
};

window.openPaymentInterface = async function(tournamentId) {
    const pendingRef  = doc(db, "users", currentUser.uid, "pendingPayment", tournamentId);
    const pendingSnap = await getDoc(pendingRef);

    if (!pendingSnap.exists()) {
        showMessage("Registration data not found. Please register again.");
        return;
    }

    const regData    = pendingSnap.data();
    const tourneyRef  = doc(db, "tournaments", tournamentId);
    const tourneySnap = await getDoc(tourneyRef);
    const tournament  = tourneySnap.exists() ? tourneySnap.data() : {};

    const existing = document.getElementById("paymentInterface");
    if (existing) existing.remove();

    // Added a smooth fade-in animation to the modal
    document.body.insertAdjacentHTML('beforeend', `
        <style>
            @keyframes modalFadeIn {
                from { opacity: 0; transform: translateY(-10px); }
                to { opacity: 1; transform: translateY(0); }
            }
        </style>
        <div id="paymentInterface" style="position:fixed;top:0;left:0;width:100%;height:100%;
            background:rgba(0,0,0,0.98);z-index:5000;overflow-y:auto; animation: modalFadeIn 0.3s ease-out;">

            <nav style="position:sticky;top:0;background:#0a0a0a;padding:15px 30px;
                border-bottom:1px solid #333;display:flex;align-items:center;
                justify-content:space-between; box-shadow: 0 4px 15px rgba(0,0,0,0.5);">
                <div style="display:flex;align-items:center;gap:15px;">
                    <button onclick="closePaymentInterface()"
                        style="background:#222;color:#fff;border:1px solid #444;padding:8px 16px;
                               border-radius:6px;cursor:pointer; transition: background 0.2s;"
                        onmouseover="this.style.background='#333'" onmouseout="this.style.background='#222'">← Back</button>
                    <span style="color:#00ff88;font-weight:bold; letter-spacing: 0.5px;">Complete Payment</span>
                </div>
                <div style="color:#ff4444;font-size:14px;animation:pulse 2s infinite; font-weight: 600;">
                    ⏱ Complete within 10 minutes
                </div>
            </nav>

            <div style="max-width:1200px;margin:30px auto;padding:20px;">
                <div style="display:grid;grid-template-columns:60% 40%;gap:25px;">

                    <div style="display:flex;flex-direction:column;gap:20px;">

                        <div style="background:#1a2a1a;padding:20px;border-radius:10px;
                            border:2px solid #00ff88;text-align:center; box-shadow: 0 0 20px rgba(0,255,136,0.1);">
                            <div style="font-size:40px;margin-bottom:10px;">✅</div>
                            <h3 style="color:#00ff88;margin:0; letter-spacing: 1px;">Team Verified!</h3>
                            <p style="color:#aaa;margin:10px 0 0 0;">
                                Your UIDs have been verified by admin.
                            </p>
                        </div>

                        <div style="background:#1a1a1a;padding:20px;border-radius:10px;border:1px solid #333; box-shadow: 0 4px 15px rgba(0,0,0,0.3);">
                            <h3 style="color:#fff;margin:0 0 15px 0;">Team Details (Locked)</h3>
                            <div style="display:grid;gap:10px;">
                                <div style="background:#0f0f0f;padding:12px;border-radius:6px; border-left: 3px solid #444;">
                                    <label style="color:#666;font-size:11px; text-transform: uppercase;">Team Name</label>
                                    <p style="color:#fff;margin:5px 0 0;font-size:16px;font-weight:bold;">
                                        ${regData.teamName || 'N/A'}
                                    </p>
                                </div>
                                <div style="background:#0f0f0f;padding:12px;border-radius:6px; border-left: 3px solid #ffd700;">
                                    <label style="color:#666;font-size:11px; text-transform: uppercase;">Entry Fee</label>
                                    <p style="color:#ffd700;margin:5px 0 0;font-size:24px;font-weight:bold;">
                                        ₹${regData.entryFee || 0}
                                    </p>
                                </div>
                                <div style="background:#0f0f0f;padding:12px;border-radius:6px; border-left: 3px solid #444;">
                                    <label style="color:#666;font-size:11px; text-transform: uppercase;">Phone</label>
                                    <p style="color:#fff;margin:5px 0 0;">
                                        ${regData.phone || 'N/A'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div style="background:#1a2a1a;padding:20px;border-radius:10px;border:1px solid #00ff88; box-shadow: 0 4px 15px rgba(0,255,136,0.05);">
                            <h3 style="color:#00ff88;margin:0 0 15px 0;">🏆 Prize Pool</h3>
                            <div style="display:flex;justify-content:space-around;text-align:center;">
                                <div>
                                    <div style="font-size:24px;color:#ffd700; text-shadow: 0 0 10px rgba(255,215,0,0.5);">🥇</div>
                                    <div style="color:#fff;font-size:18px; font-weight:bold;">₹${tournament.prize?.first || 0}</div>
                                    <div style="color:#888;font-size:12px; text-transform:uppercase;">1st</div>
                                </div>
                                <div>
                                    <div style="font-size:20px;color:#c0c0c0; text-shadow: 0 0 10px rgba(192,192,192,0.5);">🥈</div>
                                    <div style="color:#fff;font-size:16px; font-weight:bold;">₹${tournament.prize?.second || 0}</div>
                                    <div style="color:#888;font-size:12px; text-transform:uppercase;">2nd</div>
                                </div>
                                <div>
                                    <div style="font-size:18px;color:#cd7f32; text-shadow: 0 0 10px rgba(205,127,50,0.5);">🥉</div>
                                    <div style="color:#fff;font-size:14px; font-weight:bold;">₹${tournament.prize?.third || 0}</div>
                                    <div style="color:#888;font-size:12px; text-transform:uppercase;">3rd</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style="background:#1a1a1a;padding:25px;border-radius:10px;border:1px solid #333;
                        height:fit-content;position:sticky;top:80px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                        <h3 style="color:#fff;margin:0 0 20px;text-align:center;">Scan to Pay</h3>

                        <div style="background:#fff;padding:20px;border-radius:12px;text-align:center;margin-bottom:20px; box-shadow: inset 0 0 10px rgba(0,0,0,0.1);">
                            <div style="background:#f0f0f0;padding:20px;border-radius:8px;">
                                <div style="width:200px;height:200px;margin:0 auto;background:#fff;
                                    display:flex;align-items:center;justify-content:center;
                                    border:2px dashed #ccc; border-radius: 8px;">
                                    <div style="text-align:center;">
                                        <div style="font-size:60px;margin-bottom:10px;">📱</div>
                                        <div style="font-size:14px;color:#333;font-weight:bold;">
                                            Scan QR Code
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <p style="color:#333;margin:15px 0 5px;font-weight:900;font-size:24px;">
                                ₹${regData.entryFee || 0}
                            </p>
                            <p style="color:#666;margin:0;font-size:13px; text-transform: uppercase; font-weight:bold;">NPC Esports</p>
                            <p style="color:#333;margin:5px 0 0;font-family:monospace;font-size:14px; background:#f5f5f5; padding:5px; border-radius:4px; display:inline-block;">
                                npc-esports@upi
                            </p>
                        </div>

                        <div style="background:#0f0f0f;padding:20px;border-radius:8px;border:1px solid #ffd700; position: relative;">
                            <label style="color:#ffd700;font-size:14px;display:block;
                                margin-bottom:10px;font-weight:bold;">
                                Enter UTR/Transaction ID *
                            </label>
                            <input type="text" id="paymentUtr" placeholder="e.g., 123456789012"
                                style="width:100%;padding:12px;background:#1a1a1a;border:1px solid #444;
                                       color:#fff;border-radius:6px;font-size:14px;
                                       font-family:monospace;margin-bottom:10px;box-sizing:border-box;
                                       transition: border-color 0.2s;"
                                onfocus="this.style.borderColor='#ffd700'" onblur="this.style.borderColor='#444'">
                            <small style="color:#888;font-size:11px;">
                                Find in PhonePe / GPay / Paytm transaction history
                            </small>
                        </div>

                        <button onclick="confirmPayment('${tournamentId}')"
                            style="width:100%;padding:16px;background:linear-gradient(90deg, #00ff88, #00cc6a);color:#000;border:none;
                                   border-radius:8px;font-size:18px;font-weight:bold;cursor:pointer;
                                   margin-top:20px; box-shadow: 0 4px 15px rgba(0,255,136,0.3); transition: transform 0.1s, box-shadow 0.1s;"
                            onmousedown="this.style.transform='scale(0.98)'" onmouseup="this.style.transform='scale(1)'"
                            onmouseover="this.style.boxShadow='0 6px 20px rgba(0,255,136,0.5)'" onmouseout="this.style.boxShadow='0 4px 15px rgba(0,255,136,0.3)'">
                            I have paid → Confirm
                        </button>

                        <p style="color:#666;font-size:12px;text-align:center;margin-top:15px;">
                            <span style="display:inline-block; margin-right:5px;">🛡️</span> Payment will be verified within 5 minutes
                        </p>
                    </div>
                </div>
            </div>
        </div>`);

    document.body.style.overflow = "hidden";
    startPaymentTimer();

    // ==========================================
    // --- PROPERLY NESTED: LIVE UI TEAMMATE SYNCING ---
    // ==========================================
    
    // Clear any old listener just in case
    if (window.paymentSessionListener) {
        window.paymentSessionListener();
    }
    
    // Start listening to this team's payment session in real-time
    window.paymentSessionListener = onSnapshot(
        doc(db, "tournaments", tournamentId, "teamSessions", userProfile.teamId),
        (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                
                // If a teammate submits the payment while this screen is open
                if ((data.paymentStatus === "submitted" || data.paymentStatus === "paid" || data.paymentStatus === "verified") 
                    && data.paymentSubmittedBy !== currentUser.uid) {
                    
                    // 1. Close the payment interface
                    closePaymentInterface();
                    
                    // 2. Show a success popup letting them know their teammate handled it
                    showPopup(
                        "success", 
                        `${data.paymentSubmittedByName || 'Your teammate'} just completed the payment for this tournament!`, 
                        "Got it", 
                        () => document.getElementById('customPopup')?.remove()
                    );
                }
            }
        }
    );
}; // <--- THIS BRACKET CLOSES openPaymentInterface CORRECTLY NOW

window.closePaymentInterface = function() {
    const modal = document.getElementById("paymentInterface");
    if (modal) {
        modal.remove();
        document.body.style.overflow = "auto";
    }
    clearInterval(paymentTimerInterval);
    
    // Clean up the listener when the modal is closed
    if (window.paymentSessionListener) {
        window.paymentSessionListener(); // Stops the Firestore listener
        window.paymentSessionListener = null;
    }
};

let paymentTimerInterval;
function startPaymentTimer() {
    clearInterval(paymentTimerInterval);
    let minutes = 10, seconds = 0;

    paymentTimerInterval = setInterval(() => {
        if (seconds === 0) {
            if (minutes === 0) {
                clearInterval(paymentTimerInterval);
                showMessage("Payment time expired! Please contact admin.");
                closePaymentInterface();
                return;
            }
            minutes--;
            seconds = 59;
        } else {
            seconds--;
        }
    }, 1000);
}

window.confirmPayment = async function(tournamentId) {
    const utr = document.getElementById("paymentUtr")?.value.trim();

    if (!utr || utr.length < 6) {
        showMessage("Please enter valid UTR number.");
        return;
    }

    const session = await getMyTeamSession(tournamentId);
    if (!session) {
        showMessage("Payment session not found.");
        return;
    }

    if (session.paymentOwnerId !== currentUser.uid) {
        showMessage(`${session.paymentOwnerName || "Your teammate"} is already handling this payment.`);
        return;
    }

    try {
        await updateDoc(
            doc(db, "tournaments", tournamentId, "teamSessions", userProfile.teamId),
            {
                paymentStatus:           "submitted",
                paymentUtr:              utr,
                paymentSubmittedBy:      currentUser.uid,
                paymentSubmittedByName:  getUserDisplayName(),
                paymentSubmittedAt:      serverTimestamp(),
                currentStage:            "payment_submitted",
                updatedAt:               serverTimestamp()
            }
        );

        const memberIds = await getTeamMemberIds(userProfile.teamId);
        await Promise.all(
            memberIds.map(uid =>
                addDoc(collection(db, "users", uid, "notifications"), {
                    title:        "Payment submitted",
                    message:      `${getUserDisplayName()} submitted the payment for team ${userProfile.teamName}.`,
                    type:         "payment",
                    read:         false,
                    createdAt:    serverTimestamp(),
                    tournamentId: tournamentId,
                    actionLink:   `team-payment-status?tournament=${tournamentId}`
                })
            )
        );

        // Notify admin
        await addDoc(collection(db, "adminNotifications"), {
            title:        "🔔 New Payment Received - Verification Required",
            message:      `Team: ${userProfile.teamName} | UTR: ${utr}`,
            tournamentId: tournamentId,
            teamId:       userProfile.teamId,
            teamName:     userProfile.teamName,
            submittedBy:  currentUser.uid,
            submittedByName: getUserDisplayName(),
            utr:          utr,
            status:       "pending_verification",
            createdAt:    serverTimestamp(),
            priority:     "high"
        });

        showMessage("Payment submitted! Admin will verify shortly.");
        closePaymentInterface();

    } catch (err) {
        console.error(err);
        showMessage("Error submitting payment. Please try again.");
    }
};

// ===============================
// INIT / STARTUP SEQUENCE
// ===============================
const activeListeners = { tournaments: null, calendar: null };

function cleanupListeners() {
    if (unsubNotifications) { unsubNotifications(); unsubNotifications = null; }
    if (activeListeners.tournaments) { activeListeners.tournaments(); activeListeners.tournaments = null; }
    if (activeListeners.calendar)    { activeListeners.calendar();    activeListeners.calendar    = null; }
    if (unsubNotifications)          { unsubNotifications();          unsubNotifications = null; }
}

function setupUI() {
    const firstRole = document.querySelector(".role-card");
    if (firstRole) {
        firstRole.classList.add("active");
        selectedRole = "viewer";
    }

    const popup = document.getElementById("dashboardPopup");
    if (popup) {
        popup.addEventListener("click", function(e) {
            if (e.target === this) closeDashboard();
        });
    }
}

function startFirebaseListeners() {
    if (activeListeners.tournaments) return;

    const q = query(tournamentsRef, orderBy("createdAt", "desc"));
    activeListeners.tournaments = onSnapshot(q, (snapshot) => {
        tournaments = snapshot.docs.map(d => ({
            id: d.id,
            ...d.data(),
            endTime: d.data().endTime ||
                (d.data().createdAt?.toMillis?.() + (d.data().duration || 60) * 60000)
        }));
        renderTournaments();
        startTimers();
    }, (err) => {
        if (err.code !== 'permission-denied') console.error("Tournament listener error:", err);
    });

   if (!activeListeners.calendar) {
    const calendarQuery = query(calendarRef, orderBy("date"));
    activeListeners.calendar = onSnapshot(calendarQuery, (snapshot) => {
        calendarEvents = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderCalendar();
    }, (err) => {  // ← ADD THIS ERROR HANDLER
        if (err.code !== 'permission-denied') {
            console.error("Calendar listener error:", err);
        }
    });
}

}

// Startup
setupUI();

startFirebaseListeners();

// 2. Modify the auth state to only handle private data (notifications)
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        isLoggedIn  = true;

        // Create loading promise with retry logic for race conditions
               // Create loading promise with retry logic for race conditions
        profileLoadPromise = (async () => {
            let attempts = 0;
            const maxAttempts = 3;
            
            while (attempts < maxAttempts) {
                try {
                    console.log(`[AUTH] Attempt ${attempts + 1}: Reading /users/${user.uid}`);
                    const userDoc = await getDoc(doc(db, "users", user.uid));
                    
                    if (userDoc.exists()) {
                        userProfile = userDoc.data();
                        await loadUserWallet();
                        console.log("[AUTH] ✓ Profile loaded:", userProfile.email);
                        return; // Success - exit function
                    } else {
                        // Document doesn't exist yet - wait and retry
                        console.warn(`[AUTH] User doc not found (attempt ${attempts + 1}/${maxAttempts})`);
                        attempts++;
                        
                        if (attempts < maxAttempts) {
                            console.log(`[AUTH] Waiting 500ms before retry...`);
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
                    }
                } catch (e) {
                    console.warn(`[AUTH] Attempt ${attempts + 1} failed: ${e.code || e.message}`);
                    attempts++;
                    
                    if (attempts < maxAttempts) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                }
            }
            
            // All attempts failed
            console.error("[AUTH] ✗ Failed to load profile after all retries");
            userProfile = null;
        })();

        // Wait for profile to load before proceeding
        try {
            await profileLoadPromise;
        } catch (e) {
            console.error("[AUTH] Profile load failed:", e);
            userProfile = null;
        }

        // Only start PRIVATE listeners here
        initNotifications();

    } else {

        // Cleanup
        if (unsubNotifications) { 
            unsubNotifications(); 
            unsubNotifications = null; 
        }
        if (profileLoadPromise) profileLoadPromise = null;
        
        currentUser = null;
        userProfile = null;
        isLoggedIn  = false;
    }

    const loginBtn = document.getElementById("loginBtn");
    if (loginBtn) loginBtn.innerText = user ? "Profile" : "Login";
});



// ===============================
// PHASE 2: AUTO-PROMOTION & PAYMENT REMINDER SYSTEM
// ===============================

// Check every 5 minutes for tournaments that need to be promoted
setInterval(checkTournamentPromotions, 300000); // 5 minutes
checkTournamentPromotions(); // Run immediately on load

// ===============================
// LIMITED TOURNAMENT: NOTIFY ME
// ===============================
window.handleNotifyMe = async function(tournamentId, tournamentName) {
    if (!currentUser) { openLogin(); return; }

    try {
        // Save user's intent to be notified
        const ref = doc(db, "tournaments", tournamentId, "limitedNotifyList", currentUser.uid);
        const existing = await getDoc(ref);

        if (existing.exists()) {
            showPopup("success", `You're already on the notification list for "${tournamentName}"!\n\nWe'll let you know when it starts.`, "Got it", () => {
                document.getElementById('customPopup')?.remove();
            });
            return;
        }

        await setDoc(ref, {
            userId: currentUser.uid,
            email: userProfile?.email || "",
            teamId: userProfile?.teamId || null,
            teamName: userProfile?.teamName || null,
            savedAt: serverTimestamp(),
            notified: false
        });

        showPopup("success", `🔔 Done! You'll be notified when "${tournamentName}" starts.`, "Got it", () => {
            document.getElementById('customPopup')?.remove();
        });
    } catch (err) {
        console.error("Notify Me error:", err);
        showMessage("Error saving notification preference. Try again.");
    }
};

// Check if any limited tournament has started and notify subscribed users
async function checkLimitedTournamentNotifications() {
    if (!currentUser) return;
    const now = Date.now();

    tournaments.forEach(async (t) => {
        if (t.category !== 'limited' || !t.endTime) return;

        // If tournament's endTime (which is its start in the limited flow) has been reached
        const startTime = t.endTime; // for limited, endTime marks when the event goes live
        if (now < startTime) return;

        // Check if user subscribed and hasn't been notified
        try {
            const notifyRef = doc(db, "tournaments", t.id, "limitedNotifyList", currentUser.uid);
            const notifySnap = await getDoc(notifyRef);

            if (notifySnap.exists() && !notifySnap.data().notified) {
                const timeStr = new Date(startTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                // Send in-app notification
                await addDoc(collection(db, "users", currentUser.uid, "notifications"), {
                    type: "limited_start",
                    title: `🚨 Tournament Starting Now!`,
                    message: `Tournament "${t.title}" is starting now at ${timeStr}!`,
                    tournamentId: t.id,
                    read: false,
                    createdAt: serverTimestamp()
                });
                // Mark as notified
                await updateDoc(notifyRef, { notified: true, notifiedAt: serverTimestamp() });
            }
        } catch (e) {
            console.warn("[Limited Notify] error:", e);
        }
    });
}

// Run limited-tournament notification check every minute
setInterval(checkLimitedTournamentNotifications, 60000);

async function checkTournamentPromotions() {
    const now = new Date();
    
    tournaments.forEach(async (t) => {
        if (!t.eventDate) return;
        
        // 1. COMBINE DATE AND TIME
        // If the admin set a time (e.g., "14:00"), combine it with the date (e.g., "2024-04-27")
        // If no time is set, fallback to just the date.
        let eventDateTime;
        if (t.eventTime) {
            eventDateTime = new Date(`${t.eventDate}T${t.eventTime}:00`);
        } else {
            eventDateTime = new Date(t.eventDate); 
        }
        
        // Calculate the difference in milliseconds
        const timeDiff = eventDateTime - now;
        const diffHours = timeDiff / (1000 * 60 * 60);
        
        // 2. PROMOTION LOGIC: If 'upcoming' and the exact Date + Time has passed
        if (t.category === 'upcoming' && timeDiff <= 0) {
            console.log(`[AUTO] Promoting tournament ${t.id} to ongoing at ${t.eventTime}`);
            
            // Update local UI state
            t.category = 'ongoing';
            t.status = 'live';
            t.endTime = eventDateTime.getTime() + (2 * 60 * 60 * 1000); // Sets 2-hour duration
            
            // Update the Database so it stays permanent!
            try {
                await updateDoc(doc(db, "tournaments", t.id), {
                    category: 'ongoing',
                    status: 'live',
                    endTime: t.endTime
                });
            } catch (err) {
                console.warn("Could not promote in DB:", err);
            }
            
            // Notify registered teams that tournament is starting NOW
            if (typeof notifyRegisteredTeams === 'function') {
                notifyRegisteredTeams(t.id, 'tournament_starting');
            }
            
            renderTournaments();
        }
        
        // 3. PAYMENT REMINDER: If 24-48 hours before tournament and not paid
        if (t.category === 'upcoming' && diffHours <= 48 && diffHours > 0) {
            remindPendingPayments(t.id, t.eventDate);
        }
    });

}

// Check user's upcoming registrations for payment reminders
async function remindPendingPayments(tournamentId, eventDate) {
    if (!currentUser) return;
    
    const userRegRef = doc(db, "users", currentUser.uid, "upcomingRegistrations", tournamentId);
    const regSnap = await getDoc(userRegRef);
    
    if (regSnap.exists()) {
        const data = regSnap.data();
        if (data.status === 'approved' && !data.paymentReminderSent) {
            // Show payment reminder popup
            showPopup(
                "warning",
                `⏰ Payment Reminder!\n\nTournament: ${data.title}\nDate: ${new Date(eventDate).toLocaleDateString()}\n\nYou need to pay the entry fee within 24 hours to confirm your spot.`, 
                "Pay Now →",
                async () => {
                    document.getElementById('customPopup')?.remove();
                    // Open payment interface for upcoming
                    openUpcomingPaymentInterface(tournamentId);
                }
            );
            
            // Mark as reminded
            await updateDoc(userRegRef, { paymentReminderSent: true });
            
            // Add notification
            await addDoc(collection(db, "users", currentUser.uid, "notifications"), {
                type: "payment_reminder",
                title: "Payment Required - Tournament Tomorrow",
                message: `Pay entry fee now for "${data.title}" to confirm your participation.`,
                tournamentId: tournamentId,
                read: false,
                createdAt: serverTimestamp()
            });
        }
    }
}

// Special payment interface for upcoming tournaments (before match day)
window.openUpcomingPaymentInterface = async function(tournamentId) {
    const tournament = tournaments.find(t => t.id === tournamentId);
    if (!tournament) return;
    
    // Create a simpler payment modal for upcoming (pre-payment)
    document.body.insertAdjacentHTML('beforeend', `
        <div id="upcomingPaymentModal" style="position:fixed;top:0;left:0;width:100%;height:100%;
            background:rgba(0,0,0,0.95);z-index:6000;display:flex;align-items:center;justify-content:center;">
            <div style="background:#1a1a1a;padding:30px;border-radius:12px;max-width:400px;width:90%;border:2px solid #ffd700;">
                <h2 style="color:#ffd700;margin-bottom:20px;">Confirm Tournament Entry</h2>
                <p style="color:#fff;margin-bottom:10px;">Tournament: <strong>${tournament.title}</strong></p>
                <p style="color:#888;margin-bottom:20px;">Date: ${new Date(tournament.eventDate).toLocaleDateString()}</p>
                
                <div style="background:#0f0f0f;padding:15px;border-radius:8px;margin-bottom:20px;">
                    <p style="color:#666;margin:0;">Entry Fee</p>
                    <p style="color:#ffd700;font-size:28px;font-weight:bold;margin:5px 0;">₹${tournament.entryFee}</p>
                    <p style="color:#ff4444;font-size:12px;">⚠️ Non-refundable after payment</p>
                </div>
                
                <div style="display:flex;gap:10px;">
                    <button onclick="processUpcomingPayment('${tournamentId}')" 
                        style="flex:1;padding:12px;background:#00ff88;color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:bold;">
                        Pay & Confirm
                    </button>
                    <button onclick="document.getElementById('upcomingPaymentModal').remove()" 
                        style="flex:1;padding:12px;background:#333;color:#fff;border:none;border-radius:6px;cursor:pointer;">
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    `);
};

window.processUpcomingPayment = async function(tournamentId) {
    // Simulate payment processing
    const btn = document.querySelector('#upcomingPaymentModal button');
    btn.textContent = "Processing...";
    btn.disabled = true;
    
    try {
        // Update user's registration status
        await updateDoc(doc(db, "users", currentUser.uid, "upcomingRegistrations", tournamentId), {
            paymentStatus: "paid",
            paidAt: serverTimestamp()
        });
        
        document.getElementById('upcomingPaymentModal').remove();
        showPopup("success", "Payment successful! Your spot is confirmed.", "Great!", () => {
            document.getElementById('customPopup')?.remove();
        });
        
    } catch (e) {
        showMessage("Payment failed. Please try again.");
    }
};


// ===============================
// PHASE 2: RESULTS & ARCHIVE SYSTEM
// ===============================

// Check for completed tournaments (2 hours after end time)
setInterval(checkCompletedTournaments, 600000); // Every 10 minutes

async function checkCompletedTournaments() {
    const now = Date.now();
    
    tournaments.forEach(async (t) => {
        if (t.category === 'ongoing' && t.endTime) {
            const hoursSinceEnd = (now - t.endTime) / (1000 * 60 * 60);
            
            // If 2 hours passed, mark as completed and show results
            if (hoursSinceEnd >= 2 && !t.resultsShown) {
                t.status = 'completed';
                t.resultsShown = true;
                
                // Notify admin to enter results if not already done
                if (userProfile?.isAdmin && !t.resultsEntered) {
                    showAdminResultsPrompt(t.id);
                }
            }
        }
    });
}



window.showTournamentResults = async function(tournamentId) {
    const tournament = tournaments.find(t => t.id === tournamentId);
    if (!tournament?.winners) {
        showMessage("Results not available yet. Check back soon!");
        return;
    }
    
    const w = tournament.winners;
    
    document.body.insertAdjacentHTML('beforeend', `
        <div id="resultsModal" style="position:fixed;top:0;left:0;width:100%;height:100%;
            background:rgba(0,0,0,0.95);z-index:7000;overflow-y:auto;">
            <div style="max-width:800px;margin:50px auto;padding:30px;">
                <div style="background:linear-gradient(135deg,#1a1a2a 0%,#0f0f1f 100%);border-radius:16px;padding:40px;border:2px solid #ffd700;text-align:center;">
                    <h1 style="color:#ffd700;font-size:48px;margin-bottom:30px;">🏆 Tournament Results</h1>
                    
                    <h2 style="color:#fff;margin-bottom:40px;">${tournament.title}</h2>
                    
                    <div style="display:grid;gap:20px;margin-bottom:40px;">
                        <div style="background:rgba(255,215,0,0.1);border:2px solid #ffd700;padding:20px;border-radius:12px;">
                            <div style="font-size:64px;margin-bottom:10px;">🥇</div>
                            <h3 style="color:#ffd700;margin:0;">Winner</h3>
                            <p style="color:#fff;font-size:24px;font-weight:bold;">${w.firstPlace?.teamName || 'TBA'}</p>
                            <p style="color:#00ff88;font-size:20px;">₹${tournament.prize?.first || 0}</p>
                        </div>
                        
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
                            <div style="background:rgba(192,192,192,0.1);border:2px solid #c0c0c0;padding:20px;border-radius:12px;">
                                <div style="font-size:48px;">🥈</div>
                                <h4 style="color:#c0c0c0;margin:10px 0;">2nd Place</h4>
                                <p style="color:#fff;font-weight:bold;">${w.secondPlace?.teamName || 'TBA'}</p>
                                <p style="color:#aaa;">₹${tournament.prize?.second || 0}</p>
                            </div>
                            <div style="background:rgba(205,127,50,0.1);border:2px solid #cd7f32;padding:20px;border-radius:12px;">
                                <div style="font-size:48px;">🥉</div>
                                <h4 style="color:#cd7f32;margin:10px 0;">3rd Place</h4>
                                <p style="color:#fff;font-weight:bold;">${w.thirdPlace?.teamName || 'TBA'}</p>
                                <p style="color:#aaa;">₹${tournament.prize?.third || 0}</p>
                            </div>
                        </div>
                    </div>
                    
                    <div style="background:#1a1a1a;padding:20px;border-radius:8px;text-align:left;margin-bottom:30px;">
                        <h4 style="color:#888;margin-bottom:15px;">Match Statistics</h4>
                        <p style="color:#aaa;">Total Teams Participated: ${w.totalTeams || 'N/A'}</p>
                        <p style="color:#aaa;">Date: ${new Date(tournament.eventDate || tournament.endTime).toLocaleDateString()}</p>
                    </div>
                    
                    <button onclick="document.getElementById('resultsModal').remove()" 
                        style="padding:12px 40px;background:#333;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:16px;">
                        Close
                    </button>
                </div>
            </div>
        </div>
    `);
};

// Admin function to enter results (add to admin.js too)
window.showAdminResultsPrompt = function(tournamentId) {
    showPopup(
        "success",
        "Tournament completed! Please enter the results and winners.", 
        "Enter Results →",
        () => {
            document.getElementById('customPopup')?.remove();
            openResultsEditor(tournamentId);
        }
    );
};

window.openResultsEditor = function(tournamentId) {
    // Simple prompt-based for now, can be made into a modal
    const first = prompt("Enter 1st Place Team Name:");
    if (!first) return;
    
    const second = prompt("Enter 2nd Place Team Name:");
    const third = prompt("Enter 3rd Place Team Name:");
    
    // Save to tournament
    updateDoc(doc(db, "tournaments", tournamentId), {
        'winners.firstPlace': { teamName: first },
        'winners.secondPlace': { teamName: second || 'N/A' },
        'winners.thirdPlace': { teamName: third || 'N/A' },
        'winners.totalTeams': 12, // You'd calculate this from registrations
        resultsEntered: true,
        status: 'completed'
    }).then(() => {
        showToast("Results saved successfully!", "success");
    });
};

// ===============================
// PHASE 3: WALLET SYSTEM
// ===============================
async function loadUserWallet() {
    if (!currentUser) return;
    const walletRef = doc(db, "users", currentUser.uid, "wallet", "main");
    const walletSnap = await getDoc(walletRef);
    
    if (walletSnap.exists()) {
        userWallet = walletSnap.data();
    } else {
        await setDoc(walletRef, {
            balance: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        userWallet = { balance: 0 };
    }
    updateWalletUI();
}

function updateWalletUI() {
    const el = document.getElementById("walletBalance");
    if (el) el.textContent = userWallet.balance || 0;
}

async function deductFunds(amount, description = 'Tournament entry') {
    if (!currentUser) return false;
    if ((userWallet.balance || 0) < amount) {
        showMessage("Insufficient balance. Please add funds.");
        return false;
    }
    
    const walletRef = doc(db, "users", currentUser.uid, "wallet", "main");
    await updateDoc(walletRef, {
        balance: increment(-amount),
        updatedAt: serverTimestamp()
    });
    
    await addDoc(collection(db, "users", currentUser.uid, "transactions"), {
        type: 'debit',
        amount: amount,
        description: description,
        status: 'completed',
        createdAt: serverTimestamp()
    });
    
    userWallet.balance = (userWallet.balance || 0) - amount;
    updateWalletUI();
    return true;
}

window.addFunds = async function(amount) {
    if (!currentUser || amount <= 0) return;
    
    await addDoc(collection(db, "users", currentUser.uid, "transactions"), {
        type: 'credit',
        amount: amount,
        method: 'upi',
        status: 'pending',
        createdAt: serverTimestamp(),
        description: 'Wallet recharge'
    });
    
    showPopup("success", `₹${amount} added (pending verification)`, "OK", () => {
        document.getElementById('customPopup')?.remove();
    });
};

window.openWalletModal = function() {
    const amount = prompt("Enter amount to add (₹):");
    if (amount && !isNaN(amount) && amount > 0) {
        addFunds(Number(amount));
    }
};

window.viewTransactionHistory = async function() {
    if (!currentUser) return;
    const transactions = await getDocs(
        query(collection(db, "users", currentUser.uid, "transactions"), 
        orderBy("createdAt", "desc"), 
        limit(20))
    );
    
    let html = '<div style="max-height:400px;overflow-y:auto;">';
    transactions.forEach(doc => {
        const t = doc.data();
        const color = t.type === 'credit' ? '#00ff88' : '#ff4444';
        const sign = t.type === 'credit' ? '+' : '-';
        html += `
            <div style="padding:12px;border-bottom:1px solid #333;display:flex;justify-content:space-between;">
                <div>
                    <div style="color:${color};font-weight:bold;">${sign}₹${t.amount}</div>
                    <div style="color:#888;font-size:12px;">${t.description}</div>
                </div>
                <div style="color:#666;font-size:11px;">${t.createdAt?.toDate ? new Date(t.createdAt.toDate()).toLocaleDateString() : 'Pending'}</div>
            </div>
        `;
    });
    html += '</div>';
    
    document.body.insertAdjacentHTML('beforeend', `
        <div id="walletHistoryModal" style="position:fixed;top:0;left:0;width:100%;height:100%;
            background:rgba(0,0,0,0.9);z-index:9000;display:flex;align-items:center;justify-content:center;">
            <div style="background:#1a1a1a;padding:30px;border-radius:12px;width:90%;max-width:500px;border:1px solid #ffd700;">
                <h2 style="color:#ffd700;margin-bottom:20px;">Transaction History</h2>
                ${html}
                <button onclick="document.getElementById('walletHistoryModal').remove()" 
                    style="margin-top:20px;padding:10px 20px;background:#333;color:#fff;border:none;border-radius:6px;cursor:pointer;width:100%;">
                    Close
                </button>
            </div>
        </div>
    `);
};


// ===============================
// PHASE 3: LIVE MATCH SYSTEM
// ===============================
window.startTournamentMatches = async function(tournamentId) {
    if (!userProfile?.isAdmin) return;
    
    const roomCode = 'NPC' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const password = Math.floor(1000 + Math.random() * 9000);
    
    await updateDoc(doc(db, "tournaments", tournamentId), {
        'matchDetails.roomCode': roomCode,
        'matchDetails.password': password,
        'matchDetails.status': 'live',
        'matchDetails.startedAt': serverTimestamp()
    });
    
    const participants = await getDocs(collection(db, "tournaments", tournamentId, "participants"));
    participants.forEach(async (p) => {
        if (p.data().paymentStatus === 'verified') {
            await addDoc(collection(db, "users", p.id, "notifications"), {
                type: "match_started",
                title: "🎮 Match Started!",
                message: `Room: ${roomCode} | Pass: ${password}`,
                tournamentId: tournamentId,
                read: false,
                createdAt: serverTimestamp()
            });
        }
    });
    
    showMessage("Match started! Codes sent.");
};

window.showMatchRoom = async function(tournamentId) {
    const tourneySnap = await getDoc(doc(db, "tournaments", tournamentId));
    if (!tourneySnap.exists()) return;
    const data = tourneySnap.data();
    
    if (data.matchDetails?.status !== 'live') {
        showMessage("Match hasn't started yet.");
        return;
    }
    
    document.body.insertAdjacentHTML('beforeend', `
        <div id="matchRoomModal" style="position:fixed;top:0;left:0;width:100%;height:100%;
            background:rgba(0,0,0,0.95);z-index:8000;display:flex;align-items:center;justify-content:center;">
            <div style="background:#1a1a1a;padding:40px;border-radius:16px;border:3px solid #00ff88;text-align:center;max-width:500px;">
                <h2 style="color:#00ff88;margin-bottom:20px;">🏆 Tournament Live</h2>
                <div style="background:#0f0f0f;padding:30px;border-radius:12px;margin:20px 0;">
                    <p style="color:#888;margin-bottom:10px;">Free Fire Room Code</p>
                    <div style="font-size:48px;color:#fff;font-weight:bold;letter-spacing:4px;font-family:monospace;">
                        ${data.matchDetails.roomCode}
                    </div>
                    <p style="color:#888;margin-top:20px;margin-bottom:10px;">Password</p>
                    <div style="font-size:36px;color:#ffd700;font-weight:bold;">
                        ${data.matchDetails.password}
                    </div>
                </div>
                <p style="color:#ff4444;font-size:14px;margin-bottom:20px;">⚠️ Join within 10 minutes</p>
                <button onclick="document.getElementById('matchRoomModal').remove()" 
                    style="padding:12px 40px;background:#333;color:#fff;border:none;border-radius:8px;cursor:pointer;">
                    Close
                </button>
            </div>
        </div>
    `);
};



// ===============================
// PHASE 4: REFERRAL SYSTEM
// ===============================
window.generateReferralCode = function() {
    if (!currentUser) return '';
    return currentUser.uid.substring(0, 8).toUpperCase();
};

window.showReferralModal = async function() {
    if (!currentUser) return;
    const code = generateReferralCode();
    
    document.body.insertAdjacentHTML('beforeend', `
        <div id="referralModal" style="position:fixed;top:0;left:0;width:100%;height:100%;
            background:rgba(0,0,0,0.9);z-index:8000;display:flex;align-items:center;justify-content:center;">
            <div style="background:#1a1a1a;padding:30px;border-radius:12px;max-width:400px;width:90%;border:1px solid #00ff88;">
                <h2 style="color:#00ff88;margin-bottom:20px;">Refer & Earn</h2>
                <p style="color:#888;margin-bottom:20px;">Share your code with friends. Both get ₹50 bonus!</p>
                <div style="background:#0f0f0f;padding:15px;border-radius:8px;margin-bottom:20px;text-align:center;">
                    <div style="color:#666;font-size:12px;margin-bottom:5px;">Your Referral Code</div>
                    <div style="color:#00ff88;font-size:24px;font-weight:bold;letter-spacing:2px;font-family:monospace;">${code}</div>
                </div>
                <button onclick="navigator.clipboard.writeText('${code}');showMessage('Code copied!')" 
                    style="width:100%;padding:12px;background:#00ff88;color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:bold;margin-bottom:10px;">
                    Copy Code
                </button>
                <button onclick="document.getElementById('referralModal').remove()" 
                    style="width:100%;padding:12px;background:#333;color:#fff;border:none;border-radius:6px;cursor:pointer;">
                    Close
                </button>
            </div>
        </div>
    `);
};

window.applyReferral = async function(code) {
    if (!currentUser) return;
    const referrerQuery = query(collection(db, "users"), where("referralCode", "==", code.toUpperCase()));
    const referrerSnap = await getDocs(referrerQuery);
    
    if (!referrerSnap.empty && referrerSnap.docs[0].id !== currentUser.uid) {
        await updateDoc(doc(db, "users", currentUser.uid), {
            referredBy: referrerSnap.docs[0].id,
            bonusCredits: increment(50),
            'wallet.balance': increment(50)
        });
        await updateDoc(doc(db, "users", referrerSnap.docs[0].id), {
            referralCount: increment(1),
            bonusCredits: increment(50),
            'wallet.balance': increment(50)
        });
        showMessage("Referral applied! ₹50 added to wallet.");
    } else {
        showMessage("Invalid referral code.");
    }
};


// ===============================
// PHASE 5: ANTI-CHEAT & REPORTING
// ===============================
window.reportCheater = async function(tournamentId, teamId, reason) {
    if (!currentUser) return;
    
    await addDoc(collection(db, "reports"), {
        type: 'cheating',
        tournamentId: tournamentId,
        reportedTeam: teamId,
        reason: reason,
        reportedBy: currentUser.uid,
        reporterName: userProfile.email || 'Anonymous',
        createdAt: serverTimestamp(),
        status: 'pending'
    });
    
    showMessage("Report submitted. Admin will review.");
    
    await addDoc(collection(db, "adminNotifications"), {
        title: "🚨 Cheating Report",
        message: `New report for tournament ${tournamentId}`,
        type: 'report',
        read: false,
        createdAt: serverTimestamp()
    });
};





// ===============================
// TIMER SYSTEM
// ===============================


function startTimers() {
    activeTimers.forEach((id) => clearInterval(id));
    activeTimers.clear();

    document.querySelectorAll(".timer").forEach(timer => {
        const endTime = parseInt(timer.dataset.end);
        if (!endTime) return;

        const updateTimer = () => {
            const distance = endTime - Date.now();
            if (distance <= 0) {
                timer.innerText = "Match Started";
                clearInterval(activeTimers.get(timer));
                activeTimers.delete(timer);
                setTimeout(renderTournaments, 1000);
                return;
            }
            const h = Math.floor(distance / 3600000);
            const m = Math.floor((distance % 3600000) / 60000);
            const s = Math.floor((distance % 60000) / 1000);
            timer.innerText = `${h}h ${m}m ${s}s`;
        };

        updateTimer();
        activeTimers.set(timer, setInterval(updateTimer, 1000));
    });
}

// ===============================
// LOGIN MODAL
// ===============================
function openLogin() {
    document.getElementById("loginModal")?.classList.add("active");
}

function closeModal() {
    document.getElementById("loginModal")?.classList.remove("active");
}

function showCreate() {
    document.getElementById("loginView").style.display  = "none";
    document.getElementById("createView").style.display = "block";
    document.querySelector(".back-btn").style.display   = "block";
}

function backToLogin() {
    document.getElementById("createView").style.display = "none";
    document.getElementById("loginView").style.display  = "block";
    document.querySelector(".back-btn").style.display   = "none";
}


async function login() {
    const email = document.getElementById("loginEmail")?.value;
    const pass  = document.getElementById("loginPassword")?.value;

    if (!email || !pass) { showMessage("Enter email and password"); return; }

    try {
        await signInWithEmailAndPassword(auth, email, pass);
        closeModal();
        showMessage("Login successful");

        const welcomeTeam = localStorage.getItem("welcomeTeam");
        if (welcomeTeam) {
            setTimeout(() => {
                showMessage(`Welcome to team "${welcomeTeam}"!`);
                localStorage.removeItem("welcomeTeam");
            }, 1000);
        }
    } catch (err) {
        error("Login error:", err);
        showMessage("Invalid credentials: " + err.message);
    }
}

async function logout() {
    try {
        await signOut(auth);
        location.reload();
    } catch (e) {
        console.error("Logout error:", e);
    }
}

function selectRole(role, el) {
    selectedRole = role;
    document.querySelectorAll(".role-card").forEach(card => card.classList.remove("active"));
    el.classList.add("active");

    document.getElementById("teamNameBox").style.display = "none";
    document.getElementById("joinBox").style.display     = "none";
    document.getElementById("generatedCode").textContent = "";

    if (role === "leader")      document.getElementById("teamNameBox").style.display = "block";
    else if (role === "join")   document.getElementById("joinBox").style.display     = "block";
}

function generateTeamCode() {
    const teamName = document.getElementById("teamNameInput")?.value.trim();
    if (!teamName) { showMessage("Enter team name first"); return; }

    const code    = "NPC" + Math.floor(100000 + Math.random() * 900000);
    const display = document.getElementById("generatedCode");
    if (display) display.textContent = "Code: " + code;
    showMessage("Team code generated!");
}

// ===============================
// DASHBOARD SYSTEM (MOBILE FIXED)
// ===============================
async function openDashboard(type) {
    if (!currentUser) { openLogin(); return; }

    const popup   = document.getElementById("dashboardPopup");
    const content = document.getElementById("dashboardContent");
    if (!popup || !content) { console.error("Dashboard elements not found"); return; }

    popup.classList.add("active");

    // MOBILE FIX: Wait for profile with timeout to prevent infinite loading
    if (!userProfile && profileLoadPromise) {
        content.innerHTML = `
            <div style="text-align:center;padding:40px;">
                <div style="width:40px;height:40px;border:4px solid #333;border-top:4px solid #00ff88;
                    border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 20px;"></div>
                <p>Loading profile...</p>
            </div>`;
        try {
            await Promise.race([
                profileLoadPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000))
            ]);
        } catch (e) {
            console.error("Profile load timeout:", e);
        }
    }

    // If still no profile, show error with retry
    if (!userProfile) {
        content.innerHTML = `
            <div style="text-align:center;padding:40px;">
                <div style="font-size:48px;margin-bottom:15px;">⚠️</div>
                <h3 style="color:#ff4444;margin-bottom:10px;">Failed to Load Profile</h3>
                <p style="color:#888;margin-bottom:20px;">Network error or session expired.</p>
                <button onclick="location.reload()" 
                    style="padding:12px 24px;background:#00ff88;color:#000;border:none;border-radius:6px;cursor:pointer;margin-right:10px;">
                    Refresh Page
                </button>
                <button onclick="logout()" 
                    style="padding:12px 24px;background:#ff4444;color:#fff;border:none;border-radius:6px;cursor:pointer;">
                    Logout
                </button>
            </div>`;
        return;
    }

    // Profile loaded — route to correct tab
    if (type === "profile") {
        renderProfileTab(content);
    } else if (type === "tournaments") {
        await renderTournamentHistoryTab(content);
    } else if (type === "performance") {
        await renderPerformanceTab(content);
    } else if (type === "matches") {
        await renderUpcomingMatchesTab(content);
    } else if (type === "account") {
        await renderMyAccountTab(content);
    }
}

// ─────────────────────────────────────
// TAB: TOURNAMENT HISTORY
// ─────────────────────────────────────
async function renderTournamentHistoryTab(content) {
    content.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
            <h2 style="color:#00ff88;margin:0;">📋 Tournament History</h2>
            <span style="color:#666;font-size:13px;">Only confirmed (paid) registrations</span>
        </div>
        <div id="thLoadingMsg" style="text-align:center;padding:30px;color:#888;">
            <div style="width:32px;height:32px;border:3px solid #333;border-top:3px solid #00ff88;
                border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 12px;"></div>
            Loading...
        </div>
        <div id="thTableWrap" style="display:none;overflow-x:auto;"></div>`;

    try {
        // Fetch paid/confirmed registrations from user's sub-collection
        const paidSnap = await getDocs(
            collection(db, "users", currentUser.uid, "confirmedRegistrations")
        );
        const rows = paidSnap.docs.map(d => d.data());

        document.getElementById("thLoadingMsg").style.display = "none";
        const wrap = document.getElementById("thTableWrap");
        wrap.style.display = "block";

        const tableRows = rows.length === 0
            ? `<tr>
                <td colspan="5" style="text-align:center;color:#444;padding:24px;font-style:italic;">
                    No tournament history yet. Join and complete payment to appear here.
                </td>
               </tr>`
            : rows.map(r => `
                <tr>
                    <td>${r.tournamentName || '—'}</td>
                    <td>₹${r.entryFee || 0}</td>
                    <td>${r.mode || '—'}</td>
                    <td>${r.date ? new Date(r.date).toLocaleDateString('en-IN') : '—'}</td>
                    <td>${r.time || '—'}</td>
                </tr>`).join('');

        wrap.innerHTML = `
            <table class="dash-table">
                <thead>
                    <tr>
                        <th>Tournament</th>
                        <th>Entry Fee</th>
                        <th>Mode</th>
                        <th>Date</th>
                        <th>Time</th>
                    </tr>
                </thead>
                <tbody>${tableRows}</tbody>
            </table>
            <p style="color:#555;font-size:12px;margin-top:14px;text-align:right;">
                Future columns: Result · Status · Match ID
            </p>`;
    } catch (err) {
        console.error("Tournament history error:", err);
        document.getElementById("thLoadingMsg").innerHTML = `<p style="color:#ff4444;">Failed to load. Try again.</p>`;
    }
}

// ─────────────────────────────────────
// TAB: UPCOMING MATCHES
// ─────────────────────────────────────
async function renderUpcomingMatchesTab(content) {
    content.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
            <h2 style="color:#00ff88;margin:0;">📅 Upcoming Matches</h2>
            <span style="color:#666;font-size:13px;">Your registered tournaments</span>
        </div>
        <div id="umLoading" style="text-align:center;padding:30px;color:#888;">
            <div style="width:32px;height:32px;border:3px solid #333;border-top:3px solid #3b82f6;
                border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 12px;"></div>
            Loading matches...
        </div>
        <div id="umList"></div>`;

    try {
        const upSnap = await getDocs(
            collection(db, "users", currentUser.uid, "upcomingRegistrations")
        );
        const matches = upSnap.docs.map(d => d.data());
        matches.sort((a, b) => {
            const da = a.eventDate ? new Date(a.eventDate) : new Date(9999, 0);
            const db_ = b.eventDate ? new Date(b.eventDate) : new Date(9999, 0);
            return da - db_;
        });

        document.getElementById("umLoading").style.display = "none";
        const list = document.getElementById("umList");

        if (matches.length === 0) {
            list.innerHTML = `
                <div style="text-align:center;padding:40px;background:#1a1a1a;border-radius:12px;border:1px solid #2a2a2a;">
                    <div style="font-size:48px;margin-bottom:12px;">🎮</div>
                    <p style="color:#888;">No upcoming matches yet.</p>
                    <p style="color:#555;font-size:13px;margin-top:8px;">Register for a tournament to see it here.</p>
                </div>`;
            return;
        }

        list.innerHTML = matches.map(m => {
            const eventDate = m.eventDate
                ? new Date(m.eventDate).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
                : 'TBA';
            const statusColor = m.status === 'approved' ? '#00ff88'
                : m.status === 'rejected' ? '#ff4444' : '#ffd700';
            const statusLabel = m.status === 'approved' ? '✅ Approved'
                : m.status === 'rejected' ? '❌ Rejected' : '⏳ Pending Review';
            return `
                <div style="background:#1a1a1a;border-radius:10px;padding:18px 20px;margin-bottom:12px;
                    border:1px solid #2a2a2a;border-left:4px solid #3b82f6;display:flex;
                    justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
                    <div>
                        <div style="color:#fff;font-weight:700;font-size:16px;margin-bottom:6px;">
                            ${m.title || '—'}
                        </div>
                        <div style="color:#888;font-size:13px;">📅 ${eventDate}</div>
                        ${m.eventTime ? `<div style="color:#3b82f6;font-size:13px;margin-top:3px;">⏰ ${m.eventTime}</div>` : ''}
                    </div>
                    <span style="background:${statusColor}22;color:${statusColor};
                        padding:5px 12px;border-radius:20px;font-size:12px;font-weight:700;
                        border:1px solid ${statusColor}44;white-space:nowrap;">
                        ${statusLabel}
                    </span>
                </div>`;
        }).join('');
    } catch (err) {
        console.error("Upcoming matches error:", err);
        document.getElementById("umLoading").innerHTML = `<p style="color:#ff4444;">Failed to load. Try again.</p>`;
    }
}

// ─────────────────────────────────────
// TAB: PERFORMANCE
// ─────────────────────────────────────
async function renderPerformanceTab(content) {
    content.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
            <h2 style="color:#00ff88;margin:0;">🏆 Performance</h2>
            <span style="color:#666;font-size:13px;">Earnings only (no losses shown)</span>
        </div>
        <div id="perfLoading" style="text-align:center;padding:30px;color:#888;">
            <div style="width:32px;height:32px;border:3px solid #333;border-top:3px solid #ffd700;
                border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 12px;"></div>
            Loading performance...
        </div>
        <div id="perfContent" style="display:none;"></div>`;

    try {
        const perfSnap = await getDocs(
            collection(db, "users", currentUser.uid, "performanceHistory")
        );
        const records = perfSnap.docs.map(d => d.data())
            .filter(r => r.earnings && r.earnings > 0); // Only earnings, no losses

        const totalEarnings = records.reduce((sum, r) => sum + (r.earnings || 0), 0);

        document.getElementById("perfLoading").style.display = "none";
        const perfDiv = document.getElementById("perfContent");
        perfDiv.style.display = "block";

        const tableRows = records.length === 0
            ? `<tr>
                <td colspan="3" style="text-align:center;color:#444;padding:24px;font-style:italic;">
                    No earnings recorded yet. Win a tournament to see your stats here!
                </td>
               </tr>`
            : records.map(r => `
                <tr>
                    <td>${r.tournamentName || '—'}</td>
                    <td style="text-align:center;">
                        ${r.position === 1 ? '🥇 1st' : r.position === 2 ? '🥈 2nd' : r.position === 3 ? '🥉 3rd' : `#${r.position || '—'}`}
                    </td>
                    <td style="color:#00ff88;font-weight:700;text-align:right;">₹${r.earnings}</td>
                </tr>`).join('');

        perfDiv.innerHTML = `
            <!-- Total Earnings Summary -->
            <div style="background:linear-gradient(135deg,#1a2a1a,#2a3a1a);border:2px solid #ffd700;
                border-radius:12px;padding:24px;margin-bottom:24px;display:flex;
                justify-content:space-between;align-items:center;flex-wrap:wrap;gap:15px;">
                <div>
                    <div style="color:#888;font-size:13px;margin-bottom:6px;">💰 Total Earnings</div>
                    <div style="color:#ffd700;font-size:36px;font-weight:900;">₹${totalEarnings}</div>
                </div>
                <div style="text-align:right;">
                    <div style="color:#888;font-size:13px;">Tournaments Won</div>
                    <div style="color:#00ff88;font-size:28px;font-weight:700;">${records.length}</div>
                </div>
            </div>

            <!-- Performance Table -->
            <div style="overflow-x:auto;">
                <table class="dash-table">
                    <thead>
                        <tr>
                            <th>Tournament</th>
                            <th style="text-align:center;">Position</th>
                            <th style="text-align:right;">Earnings (₹)</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
            <p style="color:#555;font-size:12px;margin-top:14px;text-align:right;">
                Future: Kill stats · Match stats · Ranking history
            </p>`;
    } catch (err) {
        console.error("Performance error:", err);
        document.getElementById("perfLoading").innerHTML = `<p style="color:#ff4444;">Failed to load. Try again.</p>`;
    }
}

// ─────────────────────────────────────
// TAB: MY ACCOUNT (WALLET)
// ─────────────────────────────────────
async function renderMyAccountTab(content) {
    content.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
            <h2 style="color:#00ff88;margin:0;">💼 My Account</h2>
            <span style="color:#666;font-size:13px;">Wallet & Transactions</span>
        </div>
        <div id="accLoading" style="text-align:center;padding:30px;color:#888;">
            <div style="width:32px;height:32px;border:3px solid #333;border-top:3px solid #ffd700;
                border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 12px;"></div>
            Loading wallet...
        </div>
        <div id="accContent" style="display:none;"></div>`;

    try {
        const txSnap = await getDocs(
            query(
                collection(db, "users", currentUser.uid, "transactions"),
                orderBy("createdAt", "desc")
            )
        );
        const txs = txSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const balance = userWallet?.balance || 0;

        document.getElementById("accLoading").style.display = "none";
        const accDiv = document.getElementById("accContent");
        accDiv.style.display = "block";

        const txRows = txs.length === 0
            ? `<tr>
                <td colspan="3" style="text-align:center;color:#444;padding:24px;font-style:italic;">
                    No transactions yet.
                </td>
               </tr>`
            : txs.map(t => {
                const isCredit = t.type === 'credit';
                const sign = isCredit ? '+' : '-';
                const color = isCredit ? '#00ff88' : '#ff4444';
                const badge = isCredit
                    ? '<span style="background:#00ff8822;color:#00ff88;padding:2px 8px;border-radius:10px;font-size:11px;border:1px solid #00ff8844;">Credit</span>'
                    : '<span style="background:#ff444422;color:#ff4444;padding:2px 8px;border-radius:10px;font-size:11px;border:1px solid #ff444444;">Debit</span>';
                const dateStr = t.createdAt?.toDate
                    ? new Date(t.createdAt.toDate()).toLocaleDateString('en-IN')
                    : 'Pending';
                return `
                    <tr>
                        <td>${badge}</td>
                        <td style="color:${color};font-weight:700;">${sign}₹${t.amount || 0}</td>
                        <td style="color:#888;font-size:13px;">${t.description || '—'}</td>
                        <td style="color:#555;font-size:12px;">${dateStr}</td>
                    </tr>`;
            }).join('');

        accDiv.innerHTML = `
            <!-- Wallet Balance Card -->
            <div style="background:linear-gradient(135deg,#1a1a2a,#2a1a3a);border:2px solid #ffd700;
                border-radius:12px;padding:24px;margin-bottom:24px;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:15px;">
                    <div>
                        <div style="color:#888;font-size:13px;margin-bottom:6px;">💰 Wallet Balance</div>
                        <div style="color:#ffd700;font-size:40px;font-weight:900;">₹${balance}</div>
                        <div style="color:#555;font-size:12px;margin-top:4px;">Available for tournaments</div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:10px;">
                        <button onclick="openWalletModal()"
                            style="padding:10px 20px;background:#ffd700;color:#000;border:none;
                                border-radius:8px;cursor:pointer;font-weight:700;font-size:14px;">
                            + Add Funds
                        </button>
                        <button onclick="showWithdrawUI()"
                            style="padding:10px 20px;background:transparent;color:#ffd700;
                                border:1px solid #ffd700;border-radius:8px;cursor:pointer;
                                font-size:14px;font-weight:600;">
                            ↑ Withdraw
                        </button>
                    </div>
                </div>
            </div>

            <!-- Transaction History Table -->
            <h3 style="color:#fff;margin-bottom:14px;font-size:15px;letter-spacing:1px;">
                📊 Transaction Ledger
            </h3>
            <div style="overflow-x:auto;">
                <table class="dash-table">
                    <thead>
                        <tr>
                            <th>Type</th>
                            <th>Amount</th>
                            <th>Reason</th>
                            <th>Date</th>
                        </tr>
                    </thead>
                    <tbody>${txRows}</tbody>
                </table>
            </div>
            <p style="color:#555;font-size:12px;margin-top:14px;text-align:right;">
                Future: Razorpay/Cashfree integration · Filters
            </p>`;
    } catch (err) {
        console.error("Account tab error:", err);
        document.getElementById("accLoading").innerHTML = `<p style="color:#ff4444;">Failed to load wallet. Try again.</p>`;
    }
}

// Withdraw UI (UI only — backend-ready stub)
window.showWithdrawUI = function() {
    document.getElementById("withdrawModal")?.remove();
    document.body.insertAdjacentHTML("beforeend", `
        <div id="withdrawModal" style="position:fixed;inset:0;background:rgba(0,0,0,0.85);
            display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;">
            <div style="background:#1a1a1a;padding:28px;border-radius:14px;width:100%;max-width:400px;
                border:1px solid #ffd700;">
                <h3 style="color:#ffd700;margin-bottom:6px;">Withdraw Funds</h3>
                <p style="color:#888;font-size:13px;margin-bottom:20px;">
                    Withdrawals are processed within 24–48 hours.
                </p>
                <label style="color:#888;font-size:12px;display:block;margin-bottom:6px;">Amount (₹)</label>
                <input id="withdrawAmt" type="number" placeholder="Enter amount"
                    style="width:100%;padding:10px 14px;background:#0f0f0f;border:1px solid #444;
                        color:#fff;border-radius:8px;font-size:14px;margin-bottom:14px;">
                <label style="color:#888;font-size:12px;display:block;margin-bottom:6px;">UPI ID</label>
                <input id="withdrawUpi" type="text" placeholder="yourname@upi"
                    style="width:100%;padding:10px 14px;background:#0f0f0f;border:1px solid #444;
                        color:#fff;border-radius:8px;font-size:14px;margin-bottom:20px;">
                <button onclick="submitWithdrawRequest()"
                    style="width:100%;padding:12px;background:#ffd700;color:#000;border:none;
                        border-radius:8px;cursor:pointer;font-weight:700;font-size:15px;margin-bottom:10px;">
                    Submit Request
                </button>
                <button onclick="document.getElementById('withdrawModal').remove()"
                    style="width:100%;padding:10px;background:transparent;color:#666;
                        border:1px solid #333;border-radius:8px;cursor:pointer;">
                    Cancel
                </button>
            </div>
        </div>`);
};

window.submitWithdrawRequest = async function() {
    const amt = parseFloat(document.getElementById("withdrawAmt")?.value);
    const upi = document.getElementById("withdrawUpi")?.value?.trim();
    if (!amt || amt <= 0) { showMessage("Enter a valid amount"); return; }
    if (!upi) { showMessage("Enter your UPI ID"); return; }
    if (amt > (userWallet?.balance || 0)) { showMessage("Insufficient balance"); return; }

    try {
        await addDoc(collection(db, "users", currentUser.uid, "transactions"), {
            type: "debit",
            amount: amt,
            description: `Withdrawal to ${upi}`,
            status: "pending",
            upiId: upi,
            createdAt: serverTimestamp()
        });
        // Flag for admin
        await addDoc(collection(db, "adminNotifications"), {
            title: "💸 Withdrawal Request",
            message: `User ${userProfile?.email} requested ₹${amt} to ${upi}`,
            type: "withdrawal",
            userId: currentUser.uid,
            amount: amt,
            upiId: upi,
            read: false,
            createdAt: serverTimestamp()
        });
        document.getElementById("withdrawModal").remove();
        showMessage("Withdrawal request submitted! Processing in 24–48h.");
    } catch (err) {
        showMessage("Error submitting withdrawal. Please try again.");
    }
};

// Helper: Render Profile (extracted for clarity)
function renderProfileTab(content) {
    const isAdmin    = userProfile?.isAdmin === true;
    const roleBadge  = userProfile?.isLeader ? "👑 Team Leader"
                     : userProfile?.role === 'member' ? "👥 Team Member" : "👤 Viewer";

    // 1. Team Section Logic
    let teamSection = '';
    if (userProfile?.teamId) {
        teamSection = userProfile?.isLeader ? `
            <div style="margin:15px 0;padding:15px;background:#1a2a1a;border-radius:8px;border:1px solid #00ff88;">
                <h4 style="color:#00ff88;margin:0 0 10px;">Your Team (Leader)</h4>
                <p style="margin:5px 0;font-size:18px;color:#fff;"><strong>${userProfile.teamName || 'N/A'}</strong></p>
                <p style="margin:5px 0;color:#888;font-size:13px;">
                    Team Code: <span style="color:#ffd700;font-family:monospace;">${userProfile.teamCode || 'N/A'}</span>
                </p>
                <button onclick="navigator.clipboard.writeText('${userProfile.teamCode}');showMessage('Code copied!')" 
                    style="margin-top:10px;padding:6px 12px;background:#333;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;">
                    Copy Code
                </button>
            </div>` : `
            <div style="margin:15px 0;padding:15px;background:#1a1a2a;border-radius:8px;">
                <h4 style="color:#4a90e2;margin:0 0 10px;">Team Membership</h4>
                <p style="margin:5px 0;font-size:16px;color:#fff;"><strong>${userProfile.teamName || 'N/A'}</strong></p>
                <p style="margin:5px 0;color:#888;font-size:13px;">Role: Squad Member</p>
                <p style="margin:5px 0;color:#666;font-size:12px;">Code: ${userProfile.teamCode || 'N/A'}</p>
            </div>`;
    } else {
        teamSection = `
            <div style="margin:15px 0;padding:15px;background:#2a1a1a;border-radius:8px;border:1px solid #ff4444;">
                <h4 style="color:#ff4444;margin:0 0 10px;">No Team</h4>
                <p style="color:#888;font-size:13px;">Join a team to participate in tournaments</p>
                <button onclick="closeDashboard();openLogin();showCreate();selectRole('leader', document.querySelector('.role-card:nth-child(2)'));"
                    style="background:#ff4444;color:#fff;border:none;padding:8px 16px;border-radius:4px;margin-top:10px;cursor:pointer;">Create Team</button>
            </div>`;
    }

    // 2. Wallet Section Logic
    const walletSection = `
        <div style="padding:15px;background:#1a2a1a;border-radius:8px;border:1px solid #ffd700;margin-bottom:15px;">
            <h4 style="color:#ffd700;margin:0 0 15px;font-size:14px;">💰 Wallet Balance</h4>
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <div style="font-size:32px;color:#ffd700;font-weight:bold;">₹${userWallet.balance || 0}</div>
                    <div style="color:#888;font-size:12px;">Available for tournaments</div>
                </div>
                <button onclick="openWalletModal()" style="background:#ffd700;color:#000;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-weight:bold;">
                    Add Funds
                </button>
            </div>
            <button onclick="viewTransactionHistory()" style="background:transparent;color:#888;border:1px solid #444;padding:8px 16px;border-radius:4px;cursor:pointer;margin-top:10px;width:100%;">
                View History
            </button>
        </div>
    `;

    // 3. Render Main Content
    content.innerHTML = `
        <h2 style="color:#00ff88;margin-bottom:20px;">My Profile</h2>

        <div style="display:flex;align-items:center;gap:15px;margin-bottom:25px;padding:20px;
            background:linear-gradient(135deg,#1a1a1a 0%,#2a2a2a 100%);border-radius:12px;border:1px solid #333;">
            <div style="width:60px;height:60px;background:#00ff88;border-radius:50%;display:flex;align-items:center;justify-content:center;
                font-size:24px;color:#000;font-weight:bold;">
                ${(userProfile.email || 'U').charAt(0).toUpperCase()}
            </div>
            <div style="flex:1;min-width:0;">
                <h3 style="margin:0;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${userProfile.email?.split('@')[0] || 'User'}</h3>
                <span style="display:inline-block;background:${userProfile.isLeader ? '#ffd700' : userProfile.role === 'member' ? '#4a90e2' : '#666'};
                    color:#000;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:bold;margin-top:5px;">
                    ${roleBadge}
                </span>
                ${isAdmin ? '<span style="background:#ff4444;color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;margin-left:5px;">ADMIN</span>' : ''}
            </div>
        </div>

        <div style="display:grid;gap:15px;">
            ${walletSection}

            <div style="padding:15px;background:#1a1a1a;border-radius:8px;border:1px solid #333;">
                <h4 style="color:#888;margin:0 0 15px;font-size:14px;text-transform:uppercase;">Account Details</h4>
                <div style="display:grid;gap:10px;color:#ccc;">
                    <p style="margin:0;font-size:14px;word-break:break-all;"><strong style="color:#fff;">Email:</strong> ${userProfile.email || 'N/A'}</p>
                    <p style="margin:0;"><strong style="color:#fff;">Age:</strong> ${userProfile.age || 'N/A'} years</p>
                    <p style="margin:0;"><strong style="color:#fff;">Account Type:</strong> ${userProfile.role || 'Viewer'}</p>
                    <p style="margin:0;"><strong style="color:#fff;">Joined:</strong>
                        ${userProfile.createdAt ? new Date(userProfile.createdAt.toDate?.() || userProfile.createdAt).toLocaleDateString() : 'N/A'}
                    </p>
                </div>
            </div>

            ${teamSection}

            <div style="padding:15px;background:#1a1a1a;border-radius:8px;border:1px solid #333;">
                <h4 style="color:#888;margin:0 0 15px;font-size:14px;text-transform:uppercase;">Statistics</h4>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;">
                    <div style="text-align:center;padding:15px;background:#0f0f0f;border-radius:6px;">
                        <div style="font-size:24px;color:#00ff88;font-weight:bold;">${userProfile.stats?.tournamentsWon || 0}</div>
                        <div style="font-size:12px;color:#666;margin-top:5px;">Tournaments Won</div>
                    </div>
                    <div style="text-align:center;padding:15px;background:#0f0f0f;border-radius:6px;">
                        <div style="font-size:24px;color:#4a90e2;font-weight:bold;">${userProfile.stats?.tournamentsJoined || 0}</div>
                        <div style="font-size:12px;color:#666;margin-top:5px;">Matches Played</div>
                    </div>
                </div>
            </div>

            ${isAdmin ? `
            <div style="padding:15px;background:#2a1a1a;border-radius:8px;border:1px solid #ff6b35;">
                <h4 style="color:#ff6b35;margin:0 0 10px;">Admin Controls</h4>
                <button onclick="openAddTournamentForm()"
                    style="background:#ff6b35;color:#000;border:none;padding:10px;width:100%;border-radius:6px;cursor:pointer;font-weight:bold;">
                    + Add New Tournament
                </button>
            </div>` : ''}

            <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;">
                <button onclick="openEditProfile()"
                    style="background:#00ff88;color:#000;border:none;padding:12px;flex:1;border-radius:6px;cursor:pointer;min-width:120px;font-weight:bold;">Edit Profile</button>
                <button onclick="openChangePassword()"
                    style="background:#4a90e2;color:#fff;border:none;padding:12px;flex:1;border-radius:6px;cursor:pointer;min-width:120px;">Change Password</button>
                <button onclick="logout()"
                    style="background:#ff4444;color:#fff;border:none;padding:12px;flex:1;border-radius:6px;cursor:pointer;min-width:120px;">Logout</button>
            </div>
        </div>`;
}
// renderPerformanceTab is now async and defined above in the dashboard section


function closeDashboard() {
    document.getElementById("dashboardPopup")?.classList.remove("active");
}

// ===============================
// SCROLL SYSTEM
// ===============================
function scrollToSection(id, el) {
    const section = document.getElementById(id);
    if (!section) return;

    const y = section.getBoundingClientRect().top + window.pageYOffset - 120;
    window.scrollTo({ top: y, behavior: "smooth" });

    document.querySelectorAll(".navbar nav a").forEach(link => link.classList.remove("active"));
    if (el) el.classList.add("active");
}

function joinDiscord() {
    window.open("https://discord.gg/y9bTnNVh3S", "_blank");
}

// ===============================
// TOAST MESSAGE
// ===============================
function showMessage(msg) {
    const toast = document.getElementById("toast");
    if (toast) {
        toast.innerText = msg;
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 3000);
    }
}

// ===============================
// TOURNAMENT MANAGEMENT (ADMIN)
// ===============================
async function openAddTournamentForm() {
    if (!userProfile?.isAdmin) { showMessage("Not allowed"); return; }

    const name     = prompt("Tournament Title");
    if (!name) return;

    const fee      = prompt("Entry Fee");
    const mode     = prompt("Mode (duo/squad)");
    const category = prompt("Category (ongoing/upcoming/limited)");
    const first    = prompt("1st Prize");
    const second   = prompt("2nd Prize");
    const third    = prompt("3rd Prize");

    try {
        await addDoc(tournamentsRef, {
            title:     name,
            entryFee:  Number(fee) || 0,
            mode:      mode || "Solo",
            category:  category || "upcoming",
            prize:     { first: Number(first), second: Number(second), third: Number(third) },
            duration:  60,
            createdAt: serverTimestamp()
        });
        showMessage("Tournament added!");
    } catch (err) {
        showMessage("Error adding tournament");
    }
}

async function editTournament(id) {
    if (!userProfile?.isAdmin) { showMessage("Not allowed"); return; }
    // Edit logic here
}

// ===============================
// SCROLL VISIBILITY
// ===============================
function handleScrollVisibility() {
    ["ongoingContainer", "upcomingContainer", "limitedContainer"].forEach(id => {
        const container = document.getElementById(id);
        if (!container) return;
        container.style.display = "flex";
        container.style.gap     = "20px";

        if (container.scrollWidth > container.clientWidth) {
            container.style.overflowX  = "auto";
            container.style.justifyContent = "flex-start";
        } else {
            container.style.overflowX  = "hidden";
            container.style.justifyContent = "center";
        }
    });
}

// ===============================
// CALENDAR
// ===============================
function renderCalendar() {
    const year  = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();

    const monthNames = ["January","February","March","April","May","June",
                        "July","August","September","October","November","December"];

    const titleEl = document.getElementById("currentMonthYear");
    if (titleEl) titleEl.textContent = `${monthNames[month]} ${year}`;

    const gridEl = document.getElementById("calendarGrid");
    if (!gridEl) return;

    const firstDay    = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today       = new Date();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
    const todayDate   = today.getDate();

    let html = '';
    for (let i = 0; i < firstDay; i++) html += '<div class="empty"></div>';

    for (let day = 1; day <= daysInMonth; day++) {
        const dateString = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const event = calendarEvents.find(e => e.date === dateString);

        let classes  = 'day';
        let dataInfo = '';

        if (isCurrentMonth && day === todayDate) classes += ' today';
        if (event) {
            classes  += ` ${event.type}`;
            dataInfo  = event.description || event.title;
            if (event.prize) dataInfo += ` ₹${event.prize}`;
        }

        html += `<div class="${classes}" data-info="${dataInfo}">${day}</div>`;
    }

    gridEl.innerHTML = html;
}

function changeMonth(delta) {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + delta);
    renderCalendar();
}

// ===============================
// NOTIFICATION SYSTEM (UNIFIED)
// ===============================
function initNotifications() {
    if (!currentUser) return;
    if (unsubNotifications) { unsubNotifications(); unsubNotifications = null; }

    console.log("🔔 Starting Notification Listener for user:", currentUser.uid);

    const bellBtn    = document.getElementById('notifBellBtn');
    const panel      = document.getElementById('notifPanel');
    const markAllBtn = document.getElementById('notifMarkAll');

    if (bellBtn) {
        bellBtn.onclick = (e) => {
            e.stopPropagation();
            if (panel) panel.classList.toggle('hidden');
        };
    }
    
    document.onclick = (e) => {
        const wrapper = document.getElementById('notifBellWrapper');
        if (wrapper && !wrapper.contains(e.target) && panel) {
            panel.classList.add('hidden');
        }
    };

    if (markAllBtn) {
        markAllBtn.onclick = () => window.markAllRead();
    }

    const notifRef = collection(db, "users", currentUser.uid, "notifications");
    const q        = query(notifRef, orderBy("createdAt", "desc"));

    unsubNotifications = onSnapshot(q, (snapshot) => {
        console.log(`🔔 Received Notification Snapshot: ${snapshot.docs.length} docs`);

        // 1. FIRE THE POPUP FIRST (So nothing else can block it)
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === "added") {
                const notif = change.doc.data();
                const notifId = change.doc.id;
                console.log("📥 New Notification Data:", notif);

                // --- NEW: SOUND TRIGGER ---
                if (notif.type === "approval" || notif.type === "upcoming_approved") {
                    playNotificationSound('success');
                } else if (notif.type === "payment_reminder") {
                    playNotificationSound('reminder');
                } else {
                    playNotificationSound('default');
                }
                // --------------------------

                // Check if it's an approval/rejection and hasn't been shown yet
                if ((notif.type === "approval" || notif.type === "approved" || notif.type === "rejected") && !notif.popupShown) {
                    console.log("🚀 Firing Popup for:", notif.type);
                    
                    if (notif.type === "approval" || notif.type === "approved") {
                        showPopup("success", notif.message || "Your team has been approved!", "Continue →", () => {
                            document.getElementById('customPopup')?.remove();
                            showApprovedReviewInterface(notif.tournamentId, currentUser.uid);
                        });
                    } else if (notif.type === "rejected") {
                        showPopup("error", notif.message || "Your application was rejected.", "Close", () => {
                            document.getElementById('customPopup')?.remove();
                        });
                    }

                    // Mark the popup as shown in the database
                    try {
                        await updateDoc(doc(db, "users", currentUser.uid, "notifications", notifId), { popupShown: true });
                    } catch (e) { 
                        console.error("❌ Error updating popup flag:", e); 
                    }
                }
            }
        });

        // 2. UPDATE THE UI (Wrapped safely so it can't crash the popup)
        try {
            const docs = snapshot.docs;
            const unreadCount = docs.filter(d => !d.data().read).length;

            // Update badge numbers
            ["notifBadge", "notificationCount"].forEach(badgeId => {
                const badge = document.getElementById(badgeId);
                if (badge) {
                    badge.textContent  = unreadCount > 99 ? '99+' : unreadCount;
                    badge.style.display = unreadCount > 0 ? 'flex' : 'none';
                    if (badge.classList) {
                        unreadCount > 0 ? badge.classList.remove('hidden') : badge.classList.add('hidden');
                    }
                }
            });

            // Render list
            const listEl = document.getElementById('notifList') || document.getElementById('notificationList');
            if (listEl) renderNotificationList(docs, listEl);

        } catch (err) {
            console.error("❌ Error updating Notification UI:", err);
        }

    }, (err) => {
        if (err.code !== 'permission-denied') console.error("❌ Notification listener error:", err);
    });
}
function renderNotificationList(docs, listEl) {
    if (!listEl) return;

    if (docs.length === 0) {
        listEl.innerHTML = `
            <p style="color:#666;text-align:center;padding:20px;font-size:13px;">
                No notifications yet.
            </p>`;
        return;
    }

    // FIXED: Changed 'approved' to 'approval' to match the Admin panel
    const iconMap = {
        approval:          '✓', 
        rejected:          '✕',
        payment_pending:   '₹',
        payment_confirmed: '✓',
        verification:      '🔍',
        payment:           '💳',
        team_stage_locked: '🔒',
        limited_start:     '⚡',
        upcoming_approved: '✓'
    };

    const colorMap = {
        approval:          '#00ff88', 
        rejected:          '#ff4444',
        payment_pending:   '#ffd700',
        payment_confirmed: '#00ff88',
        verification:      '#00ff88',
        payment:           '#ffd700',
        team_stage_locked: '#4a90e2',
        limited_start:     '#ffd700',
        upcoming_approved: '#00ff88'
    };

    listEl.innerHTML = docs.map(d => {
        const n     = d.data();
        const color = colorMap[n.type] || '#4a90e2';
        const icon  = iconMap[n.type]  || '!';
        const time  = n.createdAt?.toDate ? timeAgo(n.createdAt.toDate()) : '';
        const bg    = n.read ? '#1a1a1a' : '#2a2a2a';

        return `
            <div style="background:${bg};padding:14px 16px;margin-bottom:8px;border-radius:8px;
                border-left:3px solid ${color};cursor:pointer;display:flex;gap:12px;align-items:flex-start;"
                onclick="handleNotificationClick('${d.id}','${n.actionLink || ''}','${n.type || ''}')">
                <div style="width:28px;height:28px;border-radius:50%;background:${color}22;color:${color};
                    display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;">
                    ${icon}
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                        <strong style="color:#fff;font-size:13px;">${n.title || ''}</strong>
                        ${!n.read
                            ? '<span style="width:7px;height:7px;background:#ff4444;border-radius:50%;flex-shrink:0;margin-top:4px;"></span>'
                            : ''}
                    </div>
                    <p style="color:#aaa;font-size:12px;margin:0;line-height:1.4;">${n.message || ''}</p>
                    <p style="color:#666;font-size:11px;margin:6px 0 0;">${time}</p>
                </div>
            </div>`;
    }).join('');
}

// FIXED: Removed the old dropdown logic since we deleted it from HTML
window.toggleNotifications = function() {
    const panel = document.getElementById("notifPanel");
    if (panel) panel.classList.toggle("hidden");
};

window.markAllRead = async function() {
    if (!currentUser) return;
    const notifRef = collection(db, "users", currentUser.uid, "notifications");
    const snapshot = await getDocs(query(notifRef, where("read", "==", false)));

    const batch = writeBatch(db);
    snapshot.docs.forEach(d => batch.update(d.ref, { read: true }));
    await batch.commit();
};

window.handleNotificationClick = async function(notifId, actionLink, type) {
    // 1. Mark the notification as read in Firestore
    try {
        await updateDoc(doc(db, "users", currentUser.uid, "notifications", notifId), { read: true });
    } catch (err) {
        console.error("Notification read update failed:", err);
    }

    // Close the notification menu
    if (window.toggleNotifications) window.toggleNotifications();

    // 2. Handle Approval Route
    if (type === "verification" || type === "approval") {
        let tournamentId = null;

        // Extract tournamentId from the link (e.g., "tournament=XYZ123")
        if (typeof actionLink === "string" && actionLink.includes("tournament=")) {
            tournamentId = actionLink.split("tournament=")[1]?.trim() || null;
        }

        if (!tournamentId) {
            showMessage("Tournament information is missing.");
            return;
        }

        closeJoinModal(); // Close any open registration forms

        showPopup(
            "success", 
            "Your application for this tournament has been approved! Press continue to proceed to the next stage.", 
            "Continue →", 
            () => {
                document.getElementById('customPopup')?.remove();
                // Now load the actual payment/review interface
                showApprovedReviewInterface(tournamentId, currentUser.uid);
            }
        );
        return;
    }

    // 3. Handle Rejection Route (NEW FIX)
    if (type === "rejected") {
        try {
            // Fetch the notification document to get the exact message/reason
            const snap = await getDoc(doc(db, "users", currentUser.uid, "notifications", notifId));
            if (snap.exists()) {
                showPopup("error", snap.data().message, "Close", () => {
                    document.getElementById('customPopup')?.remove();
                });
            }
        } catch (err) {
            console.error("Error fetching rejection reason:", err);
        }
        return;
    }

    // Handle other notification types
    if (type === "team_stage_locked") {
        showMessage("Your teammate is already handling this payment stage.");
    }
};
// ===============================
// HELPER FUNCTIONS
// ===============================
function timeAgo(date) {
    const diff = Math.floor((Date.now() - date) / 1000);
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function getUserDisplayName() {
    if (userProfile?.displayName?.trim()) return userProfile.displayName.trim();
    if (userProfile?.name?.trim())        return userProfile.name.trim();
    if (userProfile?.email)               return userProfile.email.split("@")[0];
    return "Teammate";
}

async function getTeamMemberIds(teamId) {
    if (!teamId) return [];
    try {
        const teamDoc = await getDoc(doc(db, "teams", teamId));
        if (!teamDoc.exists()) return [];
        const teamData = teamDoc.data();
        return Array.isArray(teamData.members) ? teamData.members : [];
    } catch (err) {
        console.error("Error fetching team members:", err);
        return [];
    }
}

// ===============================
// TEAM SESSION / PAYMENT CLAIM FLOW
// ===============================
async function createApprovedTeamSession(tournamentId, verificationData) {
    const sessionRef = doc(db, "tournaments", tournamentId, "teamSessions", verificationData.teamId);
    await setDoc(sessionRef, {
        tournamentId,
        teamId:             verificationData.teamId,
        teamName:           verificationData.teamName || "",
        teamCode:           verificationData.teamCode || "",
        verificationStatus: "approved",
        currentStage:       "awaiting_claim",
        stageOwnerId:       null,
        stageOwnerName:     null,
        paymentOwnerId:     null,
        paymentOwnerName:   null,
        paymentStatus:      "not_started",
        approvedAt:         serverTimestamp(),
        updatedAt:          serverTimestamp()
    }, { merge: true });
}

async function claimApprovedStage(tournamentId) {
    if (!currentUser || !userProfile?.teamId) {
        showMessage("Please login with a team account.");
        return { ok: false };
    }

    const sessionRef = doc(db, "tournaments", tournamentId, "teamSessions", userProfile.teamId);
    const myName     = getUserDisplayName();

    try {
        const result = await runTransaction(db, async (transaction) => {
            const sessionSnap = await transaction.get(sessionRef);
            if (!sessionSnap.exists()) throw new Error("SESSION_NOT_FOUND");

            const sessionData = sessionSnap.data();

            if (sessionData.currentStage === "awaiting_claim" && !sessionData.stageOwnerId) {
                transaction.update(sessionRef, {
                    currentStage:    "payment_pending",
                    stageOwnerId:    currentUser.uid,
                    stageOwnerName:  myName,
                    paymentOwnerId:  currentUser.uid,
                    paymentOwnerName: myName,
                    paymentStatus:   "awaiting_payment",
                    claimedAt:       serverTimestamp(),
                    updatedAt:       serverTimestamp()
                });
                return { ok: true, owner: true, ownerName: myName };
            }

            if (sessionData.stageOwnerId === currentUser.uid) {
                return { ok: true, owner: true, ownerName: sessionData.stageOwnerName || myName };
            }

            return { ok: true, owner: false, ownerName: sessionData.stageOwnerName || "Another teammate" };
        });

        return result;

    } catch (err) {
        console.error("Claim stage error:", err);
        if (err.message === "SESSION_NOT_FOUND") {
            showMessage("Approved team session not found.");
        } else {
            showMessage("Could not continue. Please try again.");
        }
        return { ok: false };
    }
}

async function notifyTeamClaimedPayment(tournamentId, ownerName) {
    const memberIds = await getTeamMemberIds(userProfile?.teamId);
    await Promise.all(
        memberIds
            .filter(uid => uid !== currentUser.uid)
            .map(uid =>
                addDoc(collection(db, "users", uid, "notifications"), {
                    title:        "Payment stage already claimed",
                    message:      `${ownerName} is handling the payment stage for your team.`,
                    type:         "team_stage_locked",
                    read:         false,
                    createdAt:    serverTimestamp(),
                    tournamentId: tournamentId,
                    actionLink:   `team-payment-status?tournament=${tournamentId}`
                })
            )
    );
}

async function getMyTeamSession(tournamentId) {
    if (!userProfile?.teamId) return null;
    try {
        const sessionRef  = doc(db, "tournaments", tournamentId, "teamSessions", userProfile.teamId);
        const sessionSnap = await getDoc(sessionRef);
        return sessionSnap.exists() ? sessionSnap.data() : null;
    } catch (err) {
        console.error("Error fetching team session:", err);
        return null;
    }
}

// ===============================
// VERIFICATION LISTENER
// ===============================
function listenToVerification(tournamentId, userId) {
    const ref = doc(db, "tournaments", tournamentId, "verifications", userId);

    onSnapshot(ref, 
        (snap) => {
            if (!snap.exists()) return;
            const data = snap.data();
            console.log("Verification status changed:", data.status);

            // Our Notification system (initNotifications) handles the popups now!
            // All this function needs to do is close the pending modal in the background.
            if (data.status === "rejected" || data.status === "approved") {
                closeJoinModal();
            }
        },
        (err) => {
            if (err.code !== 'permission-denied') {
                console.error("Verification listener error:", err);
            }
        }
    );
}


// ===============================
// LISTENER FOR UPCOMING TOURNAMENT APPROVAL
// ===============================
function listenToUpcomingApproval(tournamentId, userId) {
    const ref = doc(db, "tournaments", tournamentId, "upcomingRegistrations", userId);

    const unsub = onSnapshot(ref, async (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        
        if (data.status === "approved" && !data.notified) {
            // Mark as notified so we don't show popup twice
            await updateDoc(ref, { notified: true });
            
            // Show approval popup with Date reminder
            const eventDate = data.eventDate ? new Date(data.eventDate).toLocaleDateString('en-IN', {
                weekday: 'long', day: 'numeric', month: 'long'
            }) : 'TBA';
            
            showPopup(
                "success",
                `✅ Registration Approved!\n\nTournament: ${data.teamName}\n📅 Date: ${eventDate}\n\nBe ready! Payment will be required 1 day before the match. Check "View Details" for rules.`, 
                "View Details →",
                () => {
                    document.getElementById('customPopup')?.remove();
                    // Could open a details modal here (Phase 2)
                }
            );
            
            // Also add to notification inbox
            await addDoc(collection(db, "users", userId, "notifications"), {
                type: "upcoming_approved",
                title: "Tournament Registration Approved",
                message: `Your registration for ${data.eventDate ? 'tournament on ' + new Date(data.eventDate).toLocaleDateString() : 'upcoming tournament'} is approved. Be ready!`,
                tournamentId: tournamentId,
                read: false,
                createdAt: serverTimestamp()
            });
            
        } else if (data.status === "rejected" && !data.notified) {
            await updateDoc(ref, { notified: true });
            
            showPopup(
                "error",
                `Registration Rejected\n\nReason: ${data.rejectionReason || "Not specified"}\n\nContact admin for more information.`, 
                "Close",
                () => document.getElementById('customPopup')?.remove()
            );
        }
    });
    
    // Store unsubscribe if needed
    window._upcomingListeners = window._upcomingListeners || {};
    window._upcomingListeners[tournamentId] = unsub;
}





// ===============================
// APPROVED REVIEW INTERFACE (NEW)
// Shows locked/submitted data before payment
// ===============================
async function showApprovedReviewInterface(tournamentId, userId) {
    // Close any existing modals
    closeJoinModal();
    
    // Fetch the submitted data from pendingPayment
    try {
        const pendingRef = doc(db, "users", userId, "pendingPayment", tournamentId);
        const pendingSnap = await getDoc(pendingRef);
        const tournament = tournaments.find(t => t.id === tournamentId);
        
        if (!pendingSnap.exists() || !tournament) {
            showMessage("Registration data not found");
            return;
        }
        
        const regData = pendingSnap.data();
        
        // Open the join modal but show review state
        document.getElementById("joinTournamentModal").style.display = "block";
        document.getElementById("viewerBlocker").style.display = "none";
        document.getElementById("registrationContainer").style.display = "block";
        document.body.style.overflow = "hidden";
        
        // Fill tournament header info
        document.getElementById("joinTournamentTitle").textContent = tournament.title;
        document.getElementById("joinPrizeFirst").textContent = tournament.prize?.first || 0;
        document.getElementById("prizeFirst").textContent = tournament.prize?.first || 0;
        document.getElementById("prizeSecond").textContent = tournament.prize?.second || 0;
        document.getElementById("prizeThird").textContent = tournament.prize?.third || 0;
        document.getElementById("joinEntryFeeDisplay").textContent = tournament.entryFee;
        document.getElementById("paymentAmount").textContent = tournament.entryFee;
        
        // Fill locked user data (NON-EDITABLE)
        document.getElementById("joinDisplayEmail").textContent = userProfile.email;
        document.getElementById("joinDisplayAge").textContent = userProfile.age + " years";
        document.getElementById("joinDisplayTeam").textContent = regData.teamName || userProfile.teamName;
        document.getElementById("joinDisplayCode").textContent = "Code: " + (userProfile.teamCode || "N/A");
        
        // Fill locked UID fields (read-only style)
        const uidFields = [
            { id: "uidPlayer1", val: regData.uids?.[0] || "", label: "Player 1 (Leader)" },
            { id: "uidPlayer2", val: regData.uids?.[1] || "", label: "Player 2" },
            { id: "uidPlayer3", val: regData.uids?.[2] || "", label: "Player 3" },
            { id: "uidPlayer4", val: regData.uids?.[3] || "", label: "Player 4" },
            { id: "uidPlayer5", val: regData.uids?.[4] || "", label: "Player 5 (Sub)" }
        ];
        
        uidFields.forEach((field, index) => {
            const input = document.getElementById(field.id);
            if (input) {
                input.value = field.val;
                input.readOnly = true;
                input.style.background = "#2a2a2a";
                input.style.color = "#888";
                input.style.borderColor = "#444";
                // Add label showing it's locked
                const label = input.previousElementSibling;
                if (label && field.val) {
                    label.innerHTML = `${field.label} <span style="color:#00ff88;font-size:11px;">✓ Verified</span>`;
                }
            }
        });
        
        // Fill locked contact details
        const phoneInput = document.getElementById("joinPhone");
        if (phoneInput) {
            phoneInput.value = regData.phone?.replace("+91", "") || "";
            phoneInput.readOnly = true;
            phoneInput.style.background = "#2a2a2a";
            phoneInput.style.color = "#888";
        }
        
        const emailInput = document.getElementById("joinBackupEmail");
        if (emailInput) {
            emailInput.value = regData.backupEmail || "";
            emailInput.readOnly = true;
            emailInput.style.background = "#2a2a2a";
            emailInput.style.color = "#888";
        }
        
        // Replace form submit button with "Continue to Payment"
        const submitBtn = document.getElementById("joinSubmitBtn");
        if (submitBtn) {
            submitBtn.textContent = "Continue to Payment →";
            submitBtn.style.background = "#ffd700"; // Gold color for payment step
            submitBtn.onclick = function(e) {
                e.preventDefault();
                // Now go to payment interface
                openPaymentInterface(tournamentId);
            };
        }
        
        // Add notice banner
        const form = document.getElementById("tournamentJoinForm");
        if (form) {
            const notice = document.createElement("div");
            notice.id = "reviewNotice";
            notice.innerHTML = `
                <div style="background:#1a2a1a; border:1px solid #00ff88; border-radius:8px; padding:15px; margin-bottom:20px;">
                    <h4 style="color:#00ff88; margin:0 0 8px 0;">✅ Team Verified</h4>
                    <p style="color:#aaa; margin:0; font-size:13px; line-height:1.5;">
                        Your team details have been verified by admin. Please review your information below. 
                        Once you proceed to payment, these details cannot be changed.
                    </p>
                </div>
            `;
            form.insertBefore(notice, form.firstChild);
        }
        
    } catch (err) {
        console.error("Error showing review interface:", err);
        showMessage("Error loading details. Please try again.");
    }
}

// Modify closeJoinModal to clean up the review notice if present
window.closeJoinModal = function() {
    const modal = document.getElementById('joinTournamentModal');
    if (modal) modal.style.display = 'none';
    
    const uidOverlay = document.getElementById('uidCheckingOverlay');
    if (uidOverlay) uidOverlay.style.display = 'none';
    
    const procOverlay = document.getElementById('processingOverlay');
    if (procOverlay) procOverlay.style.display = 'none';
    
    const blocker = document.getElementById('viewerBlocker');
    if (blocker) blocker.style.display = 'none';
    
    document.body.style.overflow = 'auto';
    
    // Remove review notice if exists
    const reviewNotice = document.getElementById("reviewNotice");
    if (reviewNotice) reviewNotice.remove();
    
    // Reset button
    const submitBtn = document.getElementById('joinSubmitBtn');
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit for Verification →';
        submitBtn.style.background = '#00ff88';
        submitBtn.onclick = null;
    }
    
    // Reset fields to editable
    ["uidPlayer1", "uidPlayer2", "uidPlayer3", "uidPlayer4", "uidPlayer5", "joinPhone", "joinBackupEmail"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.readOnly = false;
            el.style.background = '';
            el.style.color = '';
            el.style.borderColor = '';
        }
    });
    
    const regContainer = document.getElementById('registrationContainer');
    if (regContainer) regContainer.style.display = 'none';
    
    window.currentJoiningTournament = null;
    if (window.headerTimerInterval) {
        clearInterval(window.headerTimerInterval);
        window.headerTimerInterval = null;
    }
};


// ===============================
// CUSTOM POPUP
// ===============================
function showPopup(type, message, buttonText = null, action = null) {
    document.getElementById("customPopup")?.remove();

    document.body.insertAdjacentHTML("beforeend", `
        <div id="customPopup" style="position:fixed;top:0;left:0;width:100%;height:100%;
            background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;">
            <div style="background:#1a1a1a;padding:30px;border-radius:12px;text-align:center;
                max-width:340px;width:90%;position:relative;border:1px solid ${type === 'success' ? '#00ff88' : '#ff4444'};">

                <span id="popupClose" style="position:absolute;top:12px;right:16px;cursor:pointer;
                    color:#aaa;font-size:18px;">✖</span>

                <div style="font-size:48px;margin-bottom:12px;">
                    ${type === 'success' ? '✅' : '❌'}
                </div>

                <h2 style="color:${type === 'success' ? '#00ff88' : '#ff4444'};margin:0 0 12px;">
                    ${type === 'success' ? 'submitted!' : 'Error'}
                </h2>

                <p style="color:#aaa;line-height:1.5;margin:0 0 ${buttonText ? '20px' : '0'};">
                    ${message}
                </p>

                ${buttonText
                    ? `<button id="popupBtn" style="padding:12px 24px;background:#00ff88;color:#000;
                            border:none;border-radius:8px;cursor:pointer;font-weight:bold;font-size:15px;">
                           ${buttonText}
                       </button>`
                    : ''}
            </div>
        </div>`);

    document.getElementById("popupClose").onclick = () =>
        document.getElementById("customPopup")?.remove();

    if (buttonText && action) {
        document.getElementById("popupBtn").onclick = action;
    }

    // Auto-close rejections after 5 seconds
    if (type === "error") {
        setTimeout(() => document.getElementById("customPopup")?.remove(), 5000);
    }

    // Close on backdrop click
    document.getElementById("customPopup").addEventListener('click', (e) => {
        if (e.target.id === "customPopup") e.currentTarget.remove();
    });
}

// Mobile menu toggle
window.toggleMobileMenu = function() {
  const nav = document.querySelector('.navbar nav');
  const currentDisplay = window.getComputedStyle(nav).display;
  
  if (currentDisplay === 'none' || nav.style.display === 'none') {
    nav.style.display = 'flex';
  } else {
    nav.style.display = 'none';
  }
};

// Simple beep sound using Web Audio API
function playNotificationSound(type = 'default') {
    // 1. Lazy initialize the audio context ONLY when needed
    if (!audioContext) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return; // Browser doesn't support Web Audio
        audioContext = new AudioContext();
    }

    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    if (type === 'success') {
        oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime); 
        oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.1); 
        oscillator.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.2); 
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
    } else if (type === 'reminder') {
        oscillator.frequency.setValueAtTime(880, audioContext.currentTime); 
        oscillator.type = 'square';
        gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.2, audioContext.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0, audioContext.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.2, audioContext.currentTime + 0.2);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.4);
    } else {
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
    }
}

document.getElementById("loginBtn")?.addEventListener("click", handleProfileClick);



// ========================================
// PROFESSIONAL TUTORIAL SYSTEM
// ========================================
const TUTORIAL_KEY = "npc_tutorial_done";

window.handleJoinNowTutorial = function() {
    const done = localStorage.getItem(TUTORIAL_KEY);
    if (done) {
        // Returning user - skip to community
        scrollToSection("community");
        return;
    }
    startTutorial();
};

// ========================================
// PROFESSIONAL TUTORIAL SYSTEM
// ========================================
function startTutorial() {
    // Remove existing
    document.getElementById("tutorialOverlay")?.remove();
    document.querySelector(".tutorial-spotlight")?.remove();

    // 🌟 ADD YOUR IMAGES HERE: Replace the "https://placehold.co/..." links with your actual image URLs or paths (e.g., "images/menu-tutorial.jpg")
    const tutorialSteps = [
        {
            id: "menu",
            icon: "🎮",
            title: "Welcome to NPC Esports!",
            content: `Maps easily using our <span class="highlight-text">Menu</span> at the top.<br><br>
                      Access <strong>Tournaments</strong>, <strong>Leaderboard</strong>, <strong>Profile</strong>, and <strong>Dashboard</strong> from anywhere.`,
            image: "https://placehold.co/600x400/1a1a2e/22c55e?text=Menu+Preview+Image",
            highlight: ".navbar"
        },
        {
            id: "tournaments",
            icon: "🏆",
            title: "Find Your Tournament",
            content: `Browse <span class="highlight-text">Ongoing</span>, <span class="highlight-text">Upcoming</span>, and <span class="highlight-text">Limited</span> tournaments.<br><br>
                      Register your team, get verified, then pay the entry fee.`,
            image: "https://placehold.co/600x400/1a1a2e/22c55e?text=Tournament+Preview+Image",
            highlight: "#tournaments"
        },
        {
            id: "dashboard",
            icon: "📊",
            title: "Your Dashboard",
            content: `Track your <span class="highlight-text">Profile</span>, <span class="highlight-text">Tournament History</span>, <span class="highlight-text">Performance</span>, and <span class="highlight-text">Wallet</span> all in one place.`,
            image: "https://placehold.co/600x400/1a1a2e/22c55e?text=Dashboard+Preview+Image",
            highlight: ".dashboard"
        },
        {
            id: "complete",
            icon: "🎉",
            title: "You're All Set!",
            content: `Try a <span class="highlight-text">free tournament</span> to get started.<br><br>
                      Your journey to becoming a champion starts here. Good luck! 💪`,
            image: null, // Set to null if you don't want an image for a specific step
            highlight: null
        }
    ];

    let currentStep = 0;
    let overlay = null;
    let spotlight = null;

    // Define functions globally
    window.completeTutorial = function() {
        localStorage.setItem(TUTORIAL_KEY, "1");
        overlay?.remove();
        spotlight?.remove();
        scrollToSection("community");
        showMessage("Tutorial complete! Welcome aboard!");
    };

    window.skipTutorial = window.completeTutorial;

    window.tutorialNext = function() {
        if (currentStep < tutorialSteps.length - 1) {
            currentStep++;
            updateStep(currentStep);
        }
    };

    window.tutorialPrev = function() {
        if (currentStep > 0) {
            currentStep--;
            updateStep(currentStep);
        }
    };

    // Build the Card HTML
    function createCard(step) {
        const s = tutorialSteps[step];
        const isLast = step === tutorialSteps.length - 1;
        
        return `
            <div class="tutorial-card">
                <button class="tutorial-skip" onclick="completeTutorial()">Skip</button>
                
                <div class="tutorial-card-layout">
                    ${s.image ? `
                    <div class="tutorial-media">
                        <img src="${s.image}" alt="Tutorial Image" class="tutorial-img">
                    </div>
                    ` : ''}

                    <div class="tutorial-info ${!s.image ? 'no-image' : ''}">
                        <div class="tutorial-progress">
                            ${tutorialSteps.map((_, i) => `
                                <div class="tutorial-dot ${i === step ? 'active' : ''} ${i < step ? 'completed' : ''}"></div>
                            `).join('')}
                        </div>
                        
                        <span class="tutorial-icon">${s.icon}</span>
                        <h2 class="tutorial-title">${s.title}</h2>
                        <p class="tutorial-content">${s.content}</p>
                        <p class="tutorial-subtext">Step ${step + 1} of ${tutorialSteps.length}</p>
                        
                        <div class="tutorial-controls">
                            ${step > 0 ? `<button class="tutorial-btn tutorial-btn-secondary" onclick="tutorialPrev()">← Previous</button>` : ''}
                            <button class="tutorial-btn tutorial-btn-primary" onclick="${isLast ? 'completeTutorial()' : 'tutorialNext()'}">
                                ${isLast ? "Let's Go! 🚀" : "Next →"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ✅ FIXED: No more double Skip buttons
    function updateStep(step) {
        const s = tutorialSteps[step];
        
        const cardContainer = overlay?.querySelector(".tutorial-card");
        if (cardContainer) {
            // Completely replace the inner HTML (Fixes the duplicate skip button bug)
            cardContainer.outerHTML = createCard(step);
        }

        // Spotlight Logic (Only runs on Desktop, CSS hides it on mobile)
        if (s.highlight) {
            const el = document.querySelector(s.highlight);
            if (el) {
                spotlight.style.display = "block";
                const rect = el.getBoundingClientRect();
                const padding = 12;
                spotlight.style.top = `${rect.top - padding}px`;
                spotlight.style.left = `${rect.left - padding}px`;
                spotlight.style.width = `${rect.width + padding * 2}px`;
                spotlight.style.height = `${rect.height + padding * 2}px`;
                
                setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
            }
        } else {
            spotlight.style.display = "none";
        }
    }

    // Create overlay
    overlay = document.createElement("div");
    overlay.id = "tutorialOverlay";
    overlay.className = "tutorial-overlay";
    overlay.innerHTML = createCard(0);
    document.body.appendChild(overlay);

    // Create spotlight
    spotlight = document.createElement("div");
    spotlight.className = "tutorial-spotlight";
    document.body.appendChild(spotlight);

    updateStep(0);

    // Spotlight resize handler
    window.addEventListener("resize", () => {
        if (spotlight && spotlight.style.display !== "none") {
            const s = tutorialSteps[currentStep];
            if (s?.highlight) {
                const el = document.querySelector(s.highlight);
                if (el) {
                    const rect = el.getBoundingClientRect();
                    const padding = 12;
                    spotlight.style.top = `${rect.top - padding}px`;
                    spotlight.style.left = `${rect.left - padding}px`;
                    spotlight.style.width = `${rect.width + padding * 2}px`;
                    spotlight.style.height = `${rect.height + padding * 2}px`;
                }
            }
        }
    });
}
// ========================================
// FIXED DASHBOARD SYSTEM
// ========================================
const popupTitles = {
    profile: "🛡️ Team Roster", // ✅ Changed from "My Profile"
    tournaments: "📋 Tournament History",
    matches: "📅 Upcoming Matches",
    performance: "🏆 Performance",
    account: "💼 My Account"
};

// Dashboard content templates
const dashboardTemplates = {
    profile: `
        <div class="popup-section active">
            <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px; padding: 20px; background: rgba(0,255,136,0.05); border-radius: 12px;">
                <div style="width: 56px; height: 56px; background: var(--npc-glow); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; color: #000; font-weight: bold;" id="dp-initials">U</div>
                <div>
                    <div style="color: #fff; font-weight: 600;" id="dp-name">Loading...</div>
                    <div style="color: #888; font-size: 13px;" id="dp-role">Loading...</div>
                </div>
            </div>
            
            <div style="display: grid; gap: 12px;">
                <div style="padding: 14px; background: #1a1a1a; border-radius: 8px; display: flex; justify-content: space-between;">
                    <span style="color: #666;">Email</span>
                    <span style="color: #fff;" id="dp-email">—</span>
                </div>
                <div style="padding: 14px; background: #1a1a1a; border-radius: 8px; display: flex; justify-content: space-between;">
                    <span style="color: #666;">Age</span>
                    <span style="color: #fff;" id="dp-age">—</span>
                </div>
                <div style="padding: 14px; background: #1a1a1a; border-radius: 8px; display: flex; justify-content: space-between;">
                    <span style="color: #666;">Team</span>
                    <span style="color: var(--npc-glow);" id="dp-team">No Team</span>
                </div>
            </div>
            
            <div style="display: flex; gap: 10px; margin-top: 24px;">
                <button onclick="logout()" style="flex: 1; padding: 12px; background: rgba(255,68,68,0.2); color: #ff4444; border: 1px solid #ff4444; border-radius: 8px; cursor: pointer;">Logout</button>
            </div>
        </div>
    `,
    
    tournaments: `
        <div class="popup-section active" id="dp-tournaments">
            <div style="text-align: center; padding: 40px;">
                <div class="loading-spinner"></div>
                <p style="color: #888; margin-top: 15px;">Loading history...</p>
            </div>
        </div>
    `,
    
    matches: `
        <div class="popup-section active" id="dp-matches">
            <div style="text-align: center; padding: 40px;">
                <div class="loading-spinner"></div>
                <p style="color: #888; margin-top: 15px;">Loading matches...</p>
            </div>
        </div>
    `,
    
    performance: `
        <div class="popup-section active" id="dp-performance">
            <div style="text-align: center; padding: 40px;">
                <div class="loading-spinner"></div>
                <p style="color: #888; margin-top: 15px;">Loading stats...</p>
            </div>
        </div>
    `,
    
    account: `
        <div class="popup-section active" id="dp-account">
            <div style="text-align: center; padding: 40px;">
                <div class="loading-spinner"></div>
                <p style="color: #888; margin-top: 15px;">Loading wallet...</p>
            </div>
        </div>
    `
};

// Main dashboard function - UNIFIED
window.openDashboard = async function(type) {
    if (!currentUser) {
        openLogin();
        return;
    }

    const popup = document.getElementById("dashboardPopup");
    const content = document.getElementById("dashboardContent");
    const title = document.getElementById("popupTitle");
    
    if (!popup || !content) {
        console.error("Dashboard elements not found");
        return;
    }

    // Show popup
    popup.classList.add("active");
    document.body.style.overflow = "hidden";
    
    // Set title
    title.innerHTML = popupTitles[type] || "Dashboard";

    // Show loading first
    content.innerHTML = `
        <div style="text-align: center; padding: 40px;">
            <div class="loading-spinner"></div>
            <p style="color: #888; margin-top: 15px;">Loading...</p>
        </div>
    `;

    // Wait for profile if needed
    if (!userProfile && profileLoadPromise) {
        try {
            await Promise.race([
                profileLoadPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000))
            ]);
        } catch (e) {
            console.error("Profile load timeout:", e);
        }
    }

    // Load content based on type
    switch (type) {
        case "profile":
            await renderProfileContent(content); // <-- ADD await HERE
            break;
        case "tournaments":
            await renderTournamentHistoryContent(content);
            break;
        case "matches":
            await renderUpcomingMatchesContent(content);
            break;
        case "performance":
            await renderPerformanceContent(content);
            break;
        case "account":
            await renderAccountContent(content);
            break;
        default:
            content.innerHTML = `<p style="color: #888;">Content not found</p>`;
    }
};

window.renderProfileContent = async function(content) {
    if (!userProfile) return;

    let html = `<div class="popup-section active">`;

    if (userProfile.teamId) {
        html += `
            <div style="margin-bottom: 20px; background: rgba(0,255,136,0.05); padding: 15px; border-radius: 10px; border: 1px solid #00ff88;">
                <h3 style="color:#00ff88; margin: 0 0 5px 0;">Team: ${userProfile.teamName}</h3>
                <p style="color:#888; font-size:13px; margin:0;">Team Code: <span style="color:#fff; font-family:monospace; background:#222; padding:3px 6px; border-radius:4px;">${userProfile.teamCode}</span></p>
            </div>
            
            <h4 style="color:#888; margin-bottom: 12px; font-size: 13px; text-transform: uppercase;">Team Members</h4>
            <div id="dashboardRoster" style="display:grid; gap:12px; margin-bottom:20px;">
                <div style="text-align:center; padding:20px;"><div class="loading-spinner" style="margin:0 auto;"></div></div>
            </div>
        `;
    } else {
         html += `
            <div style="text-align:center; padding:30px; background:#1a1a1a; border-radius:10px; border:1px solid #333;">
                <div style="font-size:40px; margin-bottom:15px;">👤</div>
                <p style="color:#888; margin-bottom:15px;">You are not currently in a team.</p>
                <button onclick="closeDashboard(); openLogin(); showCreate(); selectRole('leader', document.querySelector('.role-card:nth-child(2)'));"
                    style="background:#00ff88; color:#000; border:none; padding:10px 20px; border-radius:6px; font-weight:bold; cursor:pointer;">
                    Create Team
                </button>
            </div>
         `;
    }

    html += `</div>`;
    content.innerHTML = html;

    // Fetch and display full team roster
    if (userProfile.teamId) {
        try {
            const teamDoc = await getDoc(doc(db, "teams", userProfile.teamId));
            if (teamDoc.exists()) {
                const members = teamDoc.data().members || [];
                let rosterHtml = "";
                
                // Track member numbering for UI
                let memberCount = 1;

                for (let i = 0; i < members.length; i++) {
                    const uid = members[i];
                    const mDoc = await getDoc(doc(db, "users", uid));
                    
                    if (mDoc.exists()) {
                        const mData = mDoc.data();
                        const isLeader = (uid === teamDoc.data().leaderId);
                        const roleLabel = isLeader ? "👑 Team Leader" : `👥 Team Member ${memberCount}`;
                        
                        if (!isLeader) memberCount++; // Increment count only for members

                        rosterHtml += `
                            <div style="background:#111; padding:16px; border-radius:10px; border:1px solid ${isLeader ? '#ffd700' : '#2a2a2a'}; display:flex; flex-wrap:wrap; gap:15px; justify-content:space-between; align-items:center;">
                                <div>
                                    <div style="color:${isLeader ? '#ffd700' : '#00ff88'}; font-size:12px; font-weight:bold; margin-bottom:6px; text-transform:uppercase;">${roleLabel}</div>
                                    <div style="color:#fff; font-size:16px; font-weight:600; margin-bottom:4px;">${mData.nickname || 'No Nickname'}</div>
                                    <div style="color:#888; font-size:13px; margin-bottom:2px;">✉️ ${mData.email}</div>
                                </div>
                                <div style="text-align:right;">
                                    <div style="color:#aaa; font-size:13px; background:#1a1a1a; padding:6px 12px; border-radius:6px; border:1px solid #333;">Age: ${mData.age || 'N/A'}</div>
                                </div>
                            </div>
                        `;
                    }
                }
                document.getElementById("dashboardRoster").innerHTML = rosterHtml;
            }
        } catch (e) {
            document.getElementById("dashboardRoster").innerHTML = `<p style="color:#ff4444; font-size:13px;">Failed to load team data.</p>`;
        }
    }
};

async function renderTournamentHistoryContent(content) {
    content.innerHTML = dashboardTemplates.tournaments;
    
    try {
        const paidSnap = await getDocs(
            collection(db, "users", currentUser.uid, "confirmedRegistrations")
        );
        const rows = paidSnap.docs.map(d => d.data());

        const tableRows = rows.length === 0
            ? `<tr><td colspan="4" style="text-align: center; color: #555; padding: 30px;">No tournament history yet</td></tr>`
            : rows.map(r => `
                <tr>
                    <td>${r.tournamentName || '—'}</td>
                    <td>₹${r.entryFee || 0}</td>
                    <td>${r.mode || '—'}</td>
                    <td>${r.date ? new Date(r.date).toLocaleDateString('en-IN') : '—'}</td>
                </tr>`).join('');

        document.getElementById("dp-tournaments").innerHTML = `
            <div style="overflow-x: auto;">
                <table class="dash-table">
                    <thead>
                        <tr>
                            <th>Tournament</th>
                            <th>Fee</th>
                            <th>Mode</th>
                            <th>Date</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
        `;
    } catch (err) {
        document.getElementById("dp-tournaments").innerHTML = `<p style="color: #ff4444; text-align: center;">Failed to load</p>`;
    }
}

async function renderUpcomingMatchesContent(content) {
    content.innerHTML = dashboardTemplates.matches;
    
    try {
        const upSnap = await getDocs(
            collection(db, "users", currentUser.uid, "upcomingRegistrations")
        );
        const matches = upSnap.docs.map(d => d.data());

        if (matches.length === 0) {
            document.getElementById("dp-matches").innerHTML = `
                <div style="text-align: center; padding: 40px; background: #1a1a1a; border-radius: 12px;">
                    <div style="font-size: 40px; margin-bottom: 12px;">🎮</div>
                    <p style="color: #888;">No upcoming matches</p>
                </div>
            `;
            return;
        }

        document.getElementById("dp-matches").innerHTML = matches.map(m => {
            const eventDate = m.eventDate ? new Date(m.eventDate).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : 'TBA';
            const statusColor = m.status === 'approved' ? '#00ff88' : m.status === 'rejected' ? '#ff4444' : '#ffd700';
            
            return `
                <div style="background: #1a1a1a; border-radius: 10px; padding: 16px; margin-bottom: 12px; border-left: 3px solid ${statusColor};">
                    <div style="color: #fff; font-weight: 600; margin-bottom: 6px;">${m.title || '—'}</div>
                    <div style="color: #888; font-size: 13px;">📅 ${eventDate}</div>
                    <div style="color: ${statusColor}; font-size: 12px; margin-top: 6px; font-weight: 600;">
                        ${m.status === 'approved' ? '✅ Approved' : m.status === 'rejected' ? '❌ Rejected' : '⏳ Pending'}
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        document.getElementById("dp-matches").innerHTML = `<p style="color: #ff4444; text-align: center;">Failed to load</p>`;
    }
}

async function renderPerformanceContent(content) {
    content.innerHTML = dashboardTemplates.performance;
    
    try {
        const perfSnap = await getDocs(
            collection(db, "users", currentUser.uid, "performanceHistory")
        );
        const records = perfSnap.docs.map(d => d.data()).filter(r => r.earnings && r.earnings > 0);
        
        const totalEarnings = records.reduce((sum, r) => sum + (r.earnings || 0), 0);

        document.getElementById("dp-performance").innerHTML = `
            <div style="background: linear-gradient(135deg, #1a2a1a, #2a3a1a); border: 2px solid #ffd700; border-radius: 12px; padding: 20px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="color: #888; font-size: 12px;">Total Earnings</div>
                    <div style="color: #ffd700; font-size: 32px; font-weight: 900;">₹${totalEarnings}</div>
                </div>
                <div style="text-align: right;">
                    <div style="color: #888; font-size: 12px;">Tournaments Won</div>
                    <div style="color: #00ff88; font-size: 24px; font-weight: 700;">${records.length}</div>
                </div>
            </div>
            
            ${records.length === 0 ? `
                <p style="color: #555; text-align: center; padding: 20px;">No earnings recorded yet</p>
            ` : `
                <table class="dash-table">
                    <thead>
                        <tr>
                            <th>Tournament</th>
                            <th>Position</th>
                            <th>Earnings</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${records.map(r => `
                            <tr>
                                <td>${r.tournamentName || '—'}</td>
                                <td>${r.position === 1 ? '🥇 1st' : r.position === 2 ? '🥈 2nd' : r.position === 3 ? '🥉 3rd' : `#${r.position || '—'}`}</td>
                                <td style="color: #00ff88;">₹${r.earnings}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `}
        `;
    } catch (err) {
        document.getElementById("dp-performance").innerHTML = `<p style="color: #ff4444; text-align: center;">Failed to load</p>`;
    }
}

async function renderAccountContent(content) {
    content.innerHTML = dashboardTemplates.account;
    
    try {
        const txSnap = await getDocs(
            query(
                collection(db, "users", currentUser.uid, "transactions"),
                orderBy("createdAt", "desc")
            )
        );
        const txs = txSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const balance = userWallet?.balance || 0;

        document.getElementById("dp-account").innerHTML = `
            <div style="background: linear-gradient(135deg, #1a1a2a, #2a1a3a); border: 2px solid #ffd700; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="color: #888; font-size: 12px;">Wallet Balance</div>
                        <div style="color: #ffd700; font-size: 32px; font-weight: 900;">₹${balance}</div>
                    </div>
                    <button onclick="openWalletModal()" style="padding: 10px 20px; background: #ffd700; color: #000; border: none; border-radius: 8px; cursor: pointer; font-weight: 700;">+ Add Funds</button>
                </div>
            </div>
            
            <h4 style="color: #888; margin-bottom: 12px; font-size: 13px;">TRANSACTION HISTORY</h4>
            <div style="max-height: 200px; overflow-y: auto;">
                ${txs.length === 0 ? `<p style="color: #555; text-align: center; padding: 20px;">No transactions yet</p>` : txs.map(t => {
                    const isCredit = t.type === 'credit';
                    return `
                        <div style="padding: 12px; border-bottom: 1px solid #2a2a2a; display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="color: ${isCredit ? '#00ff88' : '#ff4444'}; font-weight: 600;">${isCredit ? '+' : '-'}₹${t.amount}</div>
                                <div style="color: #666; font-size: 12px;">${t.description || '—'}</div>
                            </div>
                            <div style="color: #555; font-size: 11px;">${t.createdAt?.toDate ? new Date(t.createdAt.toDate()).toLocaleDateString() : 'Pending'}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    } catch (err) {
        document.getElementById("dp-account").innerHTML = `<p style="color: #ff4444; text-align: center;">Failed to load</p>`;
    }
}

// Close dashboard
window.closeDashboard = function() {
    const popup = document.getElementById("dashboardPopup");
    if (popup) {
        popup.classList.remove("active");
        document.body.style.overflow = "auto";
    }
};

// Scroll to dashboard from navbar
window.scrollToDashboard = function(e) {
    e.preventDefault();
    const section = document.getElementById("dashboard");
    if (section) {
        const y = section.getBoundingClientRect().top + window.pageYOffset - 120;
        window.scrollTo({ top: y, behavior: "smooth" });
    }
};

// Attach click handlers to dashboard cards
document.addEventListener("DOMContentLoaded", function() {
    document.querySelectorAll(".dash-card[data-popup]").forEach(card => {
        card.addEventListener("click", function() {
            const type = this.getAttribute("data-popup");
            window.openDashboard(type); // ✅ FIXED: Forces the NEW synced dashboard!
        });
    });
    
    // Close popup on backdrop click
    const popup = document.getElementById("dashboardPopup");
    if (popup) {
        popup.addEventListener("click", function(e) {
            if (e.target === this) window.closeDashboard();
        });
    }
});

// --- OTP System Variables ---
let signupOTP = null;
let otpExpiry = null;
let resendCooldown = 0;

// ==========================================
// 1. SEND SIGNUP OTP (Creates Auth User & Sends Email)
// ==========================================
window.sendSignupOTP = async function() {
    const email = document.getElementById("regEmail").value.trim();
    const pass = document.getElementById("regPass").value;
    const age = parseInt(document.getElementById("regAge").value);
    
    // Feature Addition: Nickname
    const nickname = document.getElementById("regNickname") ? document.getElementById("regNickname").value.trim() : "";

    // Validations
    if (!email.includes("@gmail.com")) { showMessage("Please use a valid Gmail ID"); return; }
    if (pass.length < 6) { showMessage("Password too short (min 6 characters)"); return; }
    if (isNaN(age) || age < 12 || age > 60) { showMessage("Age must be between 12 and 60"); return; }
    if (pass !== document.getElementById("regConfirm")?.value) { showMessage("Passwords do not match"); return; }

    const btn = document.getElementById("btnSendOTP");
    const originalText = btn.textContent;
    
    // UI Feedback: Disable button to prevent double-clicks
    btn.disabled = true;
    btn.textContent = "Sending Verification...";
    btn.style.opacity = "0.7";
    btn.style.cursor = "not-allowed";

    try {
        console.log("[SIGNUP] Creating auth account for:", email);
        
        // Step 1: Create Auth user
        const userCred = await createUserWithEmailAndPassword(auth, email, pass);
        
        // Step 2: Send the verification link
        await sendEmailVerification(userCred.user);
        
        // Step 3: Setup UI for Email Verification phase
        document.getElementById("signupStep1").style.display = "none";
        document.getElementById("signupStep2").style.display = "block";
        document.getElementById("roleSelectionArea").style.display = "none"; 
        
        const finalBtn = document.querySelector('#createView button[onclick="createAccount()"]');
        if (finalBtn) finalBtn.style.display = "none";
        
        showMessage("📧 Check your Gmail! Click the verification link.");
        startResendTimer();
        
    } catch (err) {
        console.error("[SIGNUP] Error:", err.code || err.message);
        
        // Ghost Account Recovery Flow
        if (err.code === 'auth/email-already-in-use') {
            try {
                const userCred = await signInWithEmailAndPassword(auth, email, pass);
                const user = userCred.user;
                
                if (!user.emailVerified) {
                    await sendEmailVerification(user);
                    
                    document.getElementById("signupStep1").style.display = "none";
                    document.getElementById("signupStep2").style.display = "block";
                    document.getElementById("roleSelectionArea").style.display = "none";
                    const finalBtn = document.querySelector('#createView button[onclick="createAccount()"]');
                    if (finalBtn) finalBtn.style.display = "none";
                    
                    showMessage("⚠️ Unverified account found. New link sent to Gmail!");
                    startResendTimer();
                } else {
                    // Account already verified! Skip to role selection
                    document.getElementById("signupStep1").style.display = "none";
                    document.getElementById("signupStep2").style.display = "none";
                    document.getElementById("roleSelectionArea").style.display = "block";
                    const finalBtn = document.querySelector('#createView button[onclick="createAccount()"]');
                    if (finalBtn) finalBtn.style.display = "block";
                    
                    showMessage("Account already verified! Please finalize your profile below.");
                }
            } catch (loginErr) {
                showMessage("⚠️ Email already registered. Please login instead.");
                setTimeout(() => { 
                    backToLogin(); 
                    document.getElementById("loginEmail").value = email; 
                }, 1500);
            }
        } else {
            // General Error Handling
            showMessage("Error: " + (err.message.replace("Firebase: ", "") || "Unknown error"));
        }
    } finally {
        // ALWAYS restore the button state if they are still on step 1
        if (document.getElementById("signupStep1").style.display !== "none") {
            btn.disabled = false; 
            btn.textContent = originalText;
            btn.style.opacity = "1";
            btn.style.cursor = "pointer";
        }
    }
};

// Start Resend Timer
window.startResendTimer = function() {
    let resendCooldown = 60;
    const timerEl = document.getElementById("resendTimer");
    if (!timerEl) return;
    
    const interval = setInterval(() => {
        resendCooldown--;
        if (resendCooldown <= 0) {
            clearInterval(interval);
            timerEl.innerText = "Resend Email";
            timerEl.style.pointerEvents = "auto";
            timerEl.style.color = "#3b82f6";
            timerEl.style.cursor = "pointer";
        } else {
            timerEl.innerText = `Resend in ${resendCooldown}s`;
            timerEl.style.pointerEvents = "none";
            timerEl.style.color = "#888";
            timerEl.style.cursor = "not-allowed";
        }
    }, 1000);
};
// ==========================================
// 2. VERIFY AND PROCEED (Checks Email Status)
// ==========================================
window.verifyAndCreate = async function() {
    const btn = document.querySelector('#signupStep2 button');
    if (!btn) return;
    
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Verifying...";

    try {
        const user = auth.currentUser;
        if (!user) {
            showMessage("❌ Session expired. Please sign up again.");
            btn.disabled = false;
            btn.textContent = originalText;
            return;
        }

        // Fetch fresh verification status
        await user.reload();
        
        if (!user.emailVerified) {
            showMessage("⚠️ Please click the link in your Gmail FIRST!");
            btn.disabled = false;
            btn.textContent = "✅ I've Verified My Email";
            return;
        }

        // Email is verified! Unlock the final step (Roles/Teams)
        document.getElementById("signupStep2").style.display = "none";
        document.getElementById("roleSelectionArea").style.display = "block";
        
        const finalCreateBtn = document.querySelector('#createView button[onclick="createAccount()"]');
        if (finalCreateBtn) finalCreateBtn.style.display = "block";
        
        showMessage("✅ Verified! Choose your role below.");

    } catch (err) {
        showMessage("Error: " + err.message);
        btn.disabled = false;
        btn.textContent = originalText;
    }
};




// ==========================================
// VIEW PERSONAL PROFILE (READ-ONLY OVERVIEW)
// ==========================================
window.openPersonalProfile = function() {
    if (!userProfile) return;
    
    const content = document.getElementById("customActionContent");
    document.getElementById("customActionModal").classList.add("active");
    
    // Safely format data
    const roleText = userProfile.isLeader ? "Team Leader" : (userProfile.role === "member" ? "Team Member" : "Viewer");
    const joinDate = userProfile.createdAt ? new Date(userProfile.createdAt.toDate?.() || userProfile.createdAt).toLocaleDateString() : 'Unknown';
    const teamName = userProfile.teamName ? `Member of "${userProfile.teamName}"` : 'Not in a team';

    content.innerHTML = `
        <div class="modal-header">
            <h2>Personal Settings</h2>
            <button class="close-modal" onclick="closeCustomModal()">×</button>
        </div>
        
        <div style="background:#1a1a1a; padding:20px; border-radius:10px; border:1px solid #333; margin-bottom:20px;">
            <div style="display:flex; align-items:center; gap:15px; margin-bottom:20px;">
                <div style="width:56px; height:56px; background:var(--npc-glow); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:24px; color:#000; font-weight:bold;">
                    ${(userProfile.nickname || userProfile.email || 'U').charAt(0).toUpperCase()}
                </div>
                <div>
                    <div style="color:#fff; font-size:18px; font-weight:bold;">${userProfile.nickname || 'No Nickname'}</div>
                    <div style="color:var(--npc-glow); font-size:12px;">👑 ${roleText}</div>
                </div>
            </div>
            
            <div style="display:grid; gap:10px; color:#ccc; font-size:13px;">
                <div style="display:flex; justify-content:space-between; background:#0f0f0f; padding:12px; border-radius:6px; border-left: 2px solid #333;">
                    <span style="color:#888;">Email</span> <span style="color:#fff; font-weight:500;">${userProfile.email || 'N/A'}</span>
                </div>
                <div style="display:flex; justify-content:space-between; background:#0f0f0f; padding:12px; border-radius:6px; border-left: 2px solid #333;">
                    <span style="color:#888;">Age</span> <span style="color:#fff; font-weight:500;">${userProfile.age || 'N/A'} years</span>
                </div>
                <div style="display:flex; justify-content:space-between; background:#0f0f0f; padding:12px; border-radius:6px; border-left: 2px solid #333;">
                    <span style="color:#888;">Joined Date</span> <span style="color:#fff; font-weight:500;">${joinDate}</span>
                </div>
                <div style="display:flex; justify-content:space-between; background:#0f0f0f; padding:12px; border-radius:6px; border-left: 2px solid #333;">
                    <span style="color:#888;">Account Type</span> <span style="color:#fff; font-weight:500;">${roleText}</span>
                </div>
                <div style="display:flex; justify-content:space-between; background:#0f0f0f; padding:12px; border-radius:6px; border-left: 2px solid #00ff88;">
                    <span style="color:#888;">Team</span> <span style="color:#00ff88; font-weight:500;">${teamName}</span>
                </div>
            </div>
        </div>

        <div style="display:flex; flex-direction:column; gap:10px;">
            <button onclick="openEditProfile()" 
                style="background:#00ff88; color:#000; padding:14px; border:none; border-radius:8px; font-weight:bold; cursor:pointer; font-size:14px; transition:0.2s;"
                onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
                ✏️ Edit Profile
            </button>
            <button onclick="openChangePassword()" 
                style="background:transparent; color:#fff; border:1px solid #333; padding:14px; border-radius:8px; cursor:pointer; font-size:14px; transition:0.2s;"
                onmouseover="this.style.borderColor='#888'" onmouseout="this.style.borderColor='#333'">
                🔐 Change Password
            </button>
            <button onclick="logout()" 
                style="background:rgba(255,68,68,0.1); color:#ff4444; border:1px solid #ff4444; padding:14px; border-radius:8px; cursor:pointer; font-size:14px; transition:0.2s;"
                onmouseover="this.style.background='#ff4444'; this.style.color='#fff'" onmouseout="this.style.background='rgba(255,68,68,0.1)'; this.style.color='#ff4444'">
                🚪 Logout
            </button>
        </div>
    `;
};





window.openEditProfile = function() {
    const content = document.getElementById("customActionContent");
    document.getElementById("customActionModal").classList.add("active");
    
    content.innerHTML = `
        <div class="modal-header">
            <h2>Edit Personal Profile</h2>
            <button class="close-modal" onclick="closeCustomModal()">×</button>
        </div>
        <label style="color:#888; font-size:12px;">In-Game Nickname</label>
        <input id="editNickname" value="${userProfile.nickname || ''}" type="text" placeholder="Nickname">
        <label style="color:#888; font-size:12px;">Gmail ID</label>
        <input id="editEmail" value="${userProfile.email}" type="email">
        <label style="color:#888; font-size:12px;">Age</label>
        <input id="editAge" value="${userProfile.age}" type="number">
        <button onclick="saveProfileUpdate()" style="background:#00ff88; color:#000;">Save Changes</button>
    `;
};
// ==========================================
// SAVE PROFILE UPDATE (Missing Function)
// ==========================================
window.saveProfileUpdate = async function() {
    const newNickname = document.getElementById("editNickname")?.value?.trim();
    const newEmail = document.getElementById("editEmail")?.value?.trim();
    const newAge = parseInt(document.getElementById("editAge")?.value);

    if (!newEmail || !newEmail.includes('@')) { showMessage("Please enter a valid email"); return; }
    if (isNaN(newAge) || newAge < 12 || newAge > 60) { showMessage("Age must be between 12 and 60"); return; }

    const btn = event.target;
    const originalText = btn.textContent;
    btn.disabled = true; btn.textContent = "Saving...";

    try {
        const userRef = doc(db, "users", currentUser.uid);
        await updateDoc(userRef, {
            nickname: newNickname,
            email: newEmail,
            age: newAge
        });

        if (userProfile) {
            userProfile.nickname = newNickname;
            userProfile.email = newEmail;
            userProfile.age = newAge;
        }

        closeCustomModal();
        showMessage("Profile updated successfully!");
        setTimeout(() => location.reload(), 1000);
    } catch (err) {
        showMessage("Error updating profile: " + err.message);
    } finally {
        btn.disabled = false; btn.textContent = originalText;
    }
};





window.openChangePassword = function() {
    const content = document.getElementById("customActionContent");
    document.getElementById("customActionModal").classList.add("active");
    
    content.innerHTML = `
        <div class="modal-header">
            <h2>Security</h2>
            <button class="close-modal" onclick="closeCustomModal()">×</button>
        </div>
        <div id="passFlowContent">
            <input id="currPass" type="password" placeholder="Current Password">
            <input id="newPass" type="password" placeholder="New Password">
            <button onclick="requestPasswordOTP()" style="background:#00ff88; color:#000;">Update Password</button>
            <p class="switch-text" onclick="forgotPasswordFlow()">Forgot Password?</p>
        </div>
    `;
};

// ==========================================
// FORGOT PASSWORD FLOW (REAL FIREBASE LINK)
// ==========================================
window.forgotPasswordFlow = async function() {
    // Try to grab the email from the main login screen
    const emailInput = document.getElementById("loginEmail")?.value.trim();
    
    if (!emailInput) {
        showMessage("⚠️ Please enter your email in the Login box first.");
        closeCustomModal(); // Close modal so they can type the email
        return;
    }

    try {
        await sendPasswordResetEmail(auth, emailInput);
        showMessage("✅ Password reset link sent! Check your Gmail (and Spam folder).");
        closeCustomModal();
    } catch (err) {
        console.error(err);
        showMessage("Error: " + err.message.replace("Firebase: ", ""));
    }
};

// You can safely delete window.verifyRecoveryOTP as we no longer need the fake 6-digit OTP
window.closeCustomModal = () => document.getElementById("customActionModal").classList.remove("active");



window.updateUserPassword = async function(isForgotFlow = false) {
    const newPass = document.getElementById("finalNewPass")?.value;
    const confirmPass = document.getElementById("confirmNewPass")?.value;

    if (newPass !== confirmPass) {
        showMessage("Passwords do not match");
        return;
    }

    if (newPass.length < 6) {
        showMessage("Password must be at least 6 characters");
        return;
    }

    try {
        await updatePassword(currentUser, newPass);
        closeCustomModal();
        showMessage("Password updated successfully!");
    } catch (err) {
        showMessage("Error: " + err.message);
    }
};




window.resendSignupOTP = async function() {
    const user = auth.currentUser;
    
    if (!user) {
        showMessage("❌ Session expired. Please sign up again.");
        return;
    }

    const timerEl = document.getElementById("resendTimer");
    if (timerEl && timerEl.style.pointerEvents === "none") {
        showMessage("Please wait before resending.");
        return;
    }

    try {
        console.log("[RESEND] Sending verification email...");
        
        // THE FIX: Use Firebase v10 syntax
        await sendEmailVerification(user);
        
        console.log("✅ Verification email resent!");
        showMessage("📧 New verification email sent!");
        startResendTimer();
    } catch (err) {
        console.error("[RESEND] Error:", err.code, err.message);
        if (err.code === 'auth/too-many-requests') {
            showMessage("Too many requests. Try again later.");
        } else {
            showMessage("Failed to resend. Try again.");
        }
    }
};
// ==========================================
// 3. FINAL CREATE ACCOUNT (Writes to Firestore)
// ==========================================
window.createAccount = async function() {
    const user = auth.currentUser;
    if (!user || !user.emailVerified) {
        showMessage("Please verify your email first.");
        return;
    }

    const email = user.email;
    const uid = user.uid;
    const age = parseInt(document.getElementById("regAge").value) || 18;

    const createBtn = document.querySelector('#createView button[onclick="createAccount()"]');
    const originalText = createBtn?.textContent;
    
    if (createBtn) {
        createBtn.disabled = true;
        createBtn.textContent = "Finalizing Account...";
    }

    try {
        // Prevent double-writing existing profiles
        const existingDoc = await getDoc(doc(db, "users", uid));
        if (existingDoc.exists()) {
            showMessage("🎉 Account is already fully set up!");
            setTimeout(() => location.reload(), 1500);
            return;
        }

       let userData = {
            uid, email, age,
            nickname: document.getElementById("regNickname")?.value.trim() || "", // <-- ADD THIS
            role: selectedRole || "viewer",
            isAdmin: false,
            isLeader: false,
            teamId: null,
            teamName: null,
            teamCode: null,
            emailVerified: true,
            createdAt: serverTimestamp(),
            stats: { tournamentsJoined: 0, tournamentsWon: 0, matchesPlayed: 0 }
        };

        // Team Leader Logic
        if (selectedRole === "leader") {
            const teamName = document.getElementById("teamNameInput")?.value.trim();
            const teamCode = document.getElementById("generatedCode")?.textContent?.replace("Code: ", "").trim();

            if (!teamName || !teamCode) {
                showMessage("Enter team name and generate code");
                if (createBtn) { createBtn.disabled = false; createBtn.textContent = originalText; }
                return;
            }

            const teamId = "team_" + Math.random().toString(36).substr(2, 9);
            await setDoc(doc(db, "teams", teamId), {
                teamId, teamName,
                leaderId: uid,
                leaderName: email.split('@')[0],
                code: teamCode,
                members: [uid],
                maxMembers: 5,
                createdAt: serverTimestamp()
            });

            userData.isLeader = true;
            userData.teamId = teamId;
            userData.teamName = teamName;
            userData.teamCode = teamCode;
            userData.role = "leader";

        // Join Team Logic
        } else if (selectedRole === "join") {
            const enteredCode = document.getElementById("joinCode")?.value.trim().toUpperCase();
            if (!enteredCode) {
                showMessage("Enter team code");
                if (createBtn) { createBtn.disabled = false; createBtn.textContent = originalText; }
                return;
            }

            const teamsQuery = query(collection(db, "teams"), where("code", "==", enteredCode));
            const teamSnap = await getDocs(teamsQuery);

            if (teamSnap.empty) {
                showMessage("Invalid team code. Please check with your team leader.");
                if (createBtn) { createBtn.disabled = false; createBtn.textContent = originalText; }
                return;
            }

            const teamData = teamSnap.docs[0].data();
            if ((teamData.members || []).length >= (teamData.maxMembers || 5)) {
                showMessage("Team is full.");
                if (createBtn) { createBtn.disabled = false; createBtn.textContent = originalText; }
                return;
            }

            await updateDoc(doc(db, "teams", teamData.teamId), { members: arrayUnion(uid) });
            userData.teamId = teamData.teamId;
            userData.teamName = teamData.teamName;
            userData.teamCode = enteredCode;
            userData.role = "member";
            localStorage.setItem("welcomeTeam", teamData.teamName);
        }

        // Write Final User Data to Firestore
        await setDoc(doc(db, "users", uid), userData);
        
        showMessage("Account created successfully!");
        closeModal();
        
        if (selectedRole === "leader") {
            setTimeout(() => showMessage(`Team "${userData.teamName}" created! Share code: ${userData.teamCode}`), 1000);
        } else if (selectedRole === "join") {
            const welcomeTeam = localStorage.getItem("welcomeTeam");
            setTimeout(() => { showMessage(`Welcome to team "${welcomeTeam}"!`); localStorage.removeItem("welcomeTeam"); }, 1000);
        }

        // THE FIX: Force a page reload so the local memory grabs the newly created profile!
        setTimeout(() => {
            location.reload();
        }, 2000);
        
    } catch (err) {
        console.error("Account Finalization Error:", err);
        showMessage("Error: " + err.message);
    } finally {
        if (createBtn) { createBtn.disabled = false; createBtn.textContent = originalText || "Create Account"; }
    }
};

// ==========================================
// CHANGE PASSWORD FUNCTION (Missing)
// ==========================================
window.requestPasswordOTP = async function() {
    const currentPass = document.getElementById("currPass")?.value;
    const newPass = document.getElementById("newPass")?.value;

    if (!currentPass || currentPass.length < 6) {
        showMessage("Please enter your current password");
        return;
    }

    if (!newPass || newPass.length < 6) {
        showMessage("New password must be at least 6 characters");
        return;
    }

    const btn = event.target;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Updating...";

    try {
      // Re-authenticate user first using Firebase v10 Modular syntax
        const credential = EmailAuthProvider.credential(
            currentUser.email,
            currentPass
        );
        
        await reauthenticateWithCredential(currentUser, credential);
        
        // Now update password
        await updatePassword(currentUser, newPass);

        closeCustomModal();
        showMessage("Password updated successfully!");

    } catch (err) {
        console.error("Password update error:", err);
        
        if (err.code === 'auth/wrong-password') {
            showMessage("Current password is incorrect");
        } else if (err.code === 'auth/weak-password') {
            showMessage("New password is too weak");
        } else {
            showMessage("Error: " + err.message);
        }
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
};






// ===============================
// GLOBAL EXPORTS
// ===============================
window.handleProfileClick      = handleProfileClick;
window.scrollToSection         = scrollToSection;
window.openLogin               = openLogin;
window.closeModal              = closeModal;
window.showCreate              = showCreate;
window.backToLogin             = backToLogin;
window.login                   = login;
window.logout                  = logout;
window.createAccount           = createAccount;
window.selectRole              = selectRole;
window.generateTeamCode        = generateTeamCode;
window.handleJoin              = handleJoin;
window.openDashboard           = openDashboard;
window.closeDashboard          = closeDashboard;
window.joinDiscord             = joinDiscord;
window.openAddTournamentForm   = openAddTournamentForm;
window.editTournament          = editTournament;
window.renderCalendar          = renderCalendar;
window.changeMonth             = changeMonth;
window.closeJoinModal          = closeJoinModal;
window.showGuidelines          = showGuidelines;
window.closeGuidelines         = closeGuidelines;
window.showPaymentInterface    = showPaymentInterface;
window.openPaymentInterface    = openPaymentInterface;
window.closePaymentInterface   = closePaymentInterface;
window.confirmPayment          = confirmPayment;
window.toggleNotifications     = window.toggleNotifications;
window.markAllRead             = window.markAllRead;
window.handleNotificationClick = window.handleNotificationClick;
window.showMatchRoom           = showMatchRoom;
window.startTournamentMatches  = startTournamentMatches;
window.addFunds                = addFunds;
window.openWalletModal         = openWalletModal;
window.viewTransactionHistory  = viewTransactionHistory;
window.reportCheater           = reportCheater;
window.showReferralModal       = showReferralModal;
window.handleNotifyMe          = window.handleNotifyMe;

// New exports
window.handleJoinNowTutorial   = handleJoinNowTutorial;
window.showWithdrawUI          = window.showWithdrawUI;
window.submitWithdrawRequest   = window.submitWithdrawRequest;
window.saveProfileUpdate       = saveProfileUpdate;
window.requestPasswordOTP      = requestPasswordOTP;
window.forgotPasswordFlow      = forgotPasswordFlow;
window.updateUserPassword      = updateUserPassword;
window.openPersonalProfile     = openPersonalProfile;