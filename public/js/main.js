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
    updatePassword
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
        openDashboard("profile");
    } else {
        openLogin();
    }
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
                </div>`;
            
            buttonHTML = `
                <button class="join-btn" onclick="handleUpcomingRegister('${t.id}')"
                    style="background: #3b82f6; border-color: #3b82f6;">
                    Register Team
                </button>`;
                
                
            cardStyle = 'border-left: 4px solid #3b82f6;';

        } else if (t.category === "limited") {
            // LIMITED LOGIC
            buttonHTML = `
                <button class="join-btn" onclick="handleJoin('${t.id}')">
                    Join Limited
                </button>`;
        }

        const card = `
            <div class="card" style="position:relative; ${cardStyle}">
                <div>
                    <h3>${t.title}</h3>
                    <p class="entry"><b>Entry Fee:</b> ₹${t.entryFee || 0}</p>
                    <p class="mode"><b>Mode:</b> ${t.mode || "N/A"}</p>

                    ${t.title?.toLowerCase().includes("flash")
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

    document.getElementById("uidPlayer1").value     = userProfile.freeFireUid || "";
    document.getElementById("joinBackupEmail").value = "";
    document.getElementById("uidPlayer2").value     = "";
    document.getElementById("uidPlayer3").value     = "";
    document.getElementById("uidPlayer4").value     = "";
    document.getElementById("uidPlayer5").value     = "";
    document.getElementById("joinPhone").value       = "";

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

    document.body.insertAdjacentHTML('beforeend', `
        <div id="paymentInterface" style="position:fixed;top:0;left:0;width:100%;height:100%;
            background:rgba(0,0,0,0.98);z-index:5000;overflow-y:auto;">

            <nav style="position:sticky;top:0;background:#0a0a0a;padding:15px 30px;
                border-bottom:1px solid #333;display:flex;align-items:center;
                justify-content:space-between;">
                <div style="display:flex;align-items:center;gap:15px;">
                    <button onclick="closePaymentInterface()"
                        style="background:#222;color:#fff;border:none;padding:8px 16px;
                               border-radius:6px;cursor:pointer;">← Back</button>
                    <span style="color:#00ff88;font-weight:bold;">Complete Payment</span>
                </div>
                <div style="color:#ff4444;font-size:14px;animation:pulse 2s infinite;">
                    ⏱ Complete within 10 minutes
                </div>
            </nav>

            <div style="max-width:1200px;margin:30px auto;padding:20px;">
                <div style="display:grid;grid-template-columns:60% 40%;gap:25px;">

                    <!-- LEFT -->
                    <div style="display:flex;flex-direction:column;gap:20px;">

                        <div style="background:#1a2a1a;padding:20px;border-radius:10px;
                            border:2px solid #00ff88;text-align:center;">
                            <div style="font-size:40px;margin-bottom:10px;">✅</div>
                            <h3 style="color:#00ff88;margin:0;">Team Verified!</h3>
                            <p style="color:#aaa;margin:10px 0 0 0;">
                                Your UIDs have been verified by admin.
                            </p>
                        </div>

                        <div style="background:#1a1a1a;padding:20px;border-radius:10px;border:1px solid #333;">
                            <h3 style="color:#fff;margin:0 0 15px 0;">Team Details (Locked)</h3>
                            <div style="display:grid;gap:10px;">
                                <div style="background:#0f0f0f;padding:12px;border-radius:6px;">
                                    <label style="color:#666;font-size:11px;">Team Name</label>
                                    <p style="color:#fff;margin:5px 0 0;font-size:16px;font-weight:bold;">
                                        ${regData.teamName || 'N/A'}
                                    </p>
                                </div>
                                <div style="background:#0f0f0f;padding:12px;border-radius:6px;">
                                    <label style="color:#666;font-size:11px;">Entry Fee</label>
                                    <p style="color:#ffd700;margin:5px 0 0;font-size:24px;font-weight:bold;">
                                        ₹${regData.entryFee || 0}
                                    </p>
                                </div>
                                <div style="background:#0f0f0f;padding:12px;border-radius:6px;">
                                    <label style="color:#666;font-size:11px;">Phone</label>
                                    <p style="color:#fff;margin:5px 0 0;">
                                        ${regData.phone || 'N/A'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div style="background:#1a2a1a;padding:20px;border-radius:10px;border:1px solid #00ff88;">
                            <h3 style="color:#00ff88;margin:0 0 15px 0;">🏆 Prize Pool</h3>
                            <div style="display:flex;justify-content:space-around;text-align:center;">
                                <div>
                                    <div style="font-size:24px;color:#ffd700;">🥇</div>
                                    <div style="color:#fff;font-size:18px;">₹${tournament.prize?.first || 0}</div>
                                    <div style="color:#888;font-size:12px;">1st</div>
                                </div>
                                <div>
                                    <div style="font-size:20px;color:#c0c0c0;">🥈</div>
                                    <div style="color:#fff;font-size:16px;">₹${tournament.prize?.second || 0}</div>
                                    <div style="color:#888;font-size:12px;">2nd</div>
                                </div>
                                <div>
                                    <div style="font-size:18px;color:#cd7f32;">🥉</div>
                                    <div style="color:#fff;font-size:14px;">₹${tournament.prize?.third || 0}</div>
                                    <div style="color:#888;font-size:12px;">3rd</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- RIGHT -->
                    <div style="background:#1a1a1a;padding:25px;border-radius:10px;border:1px solid #333;
                        height:fit-content;position:sticky;top:80px;">
                        <h3 style="color:#fff;margin:0 0 20px;text-align:center;">Scan to Pay</h3>

                        <div style="background:#fff;padding:20px;border-radius:12px;text-align:center;margin-bottom:20px;">
                            <div style="background:#f0f0f0;padding:20px;border-radius:8px;">
                                <div style="width:200px;height:200px;margin:0 auto;background:#fff;
                                    display:flex;align-items:center;justify-content:center;
                                    border:2px dashed #ccc;">
                                    <div style="text-align:center;">
                                        <div style="font-size:60px;margin-bottom:10px;">📱</div>
                                        <div style="font-size:14px;color:#333;font-weight:bold;">
                                            Scan QR Code
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <p style="color:#333;margin:15px 0 5px;font-weight:bold;font-size:20px;">
                                ₹${regData.entryFee || 0}
                            </p>
                            <p style="color:#666;margin:0;font-size:13px;">NPC Esports</p>
                            <p style="color:#333;margin:5px 0 0;font-family:monospace;font-size:14px;">
                                npc-esports@upi
                            </p>
                        </div>

                        <div style="background:#0f0f0f;padding:20px;border-radius:8px;border:1px solid #ffd700;">
                            <label style="color:#ffd700;font-size:14px;display:block;
                                margin-bottom:10px;font-weight:bold;">
                                Enter UTR/Transaction ID *
                            </label>
                            <input type="text" id="paymentUtr" placeholder="e.g., 123456789012"
                                style="width:100%;padding:12px;background:#1a1a1a;border:1px solid #444;
                                       color:#fff;border-radius:6px;font-size:14px;
                                       font-family:monospace;margin-bottom:10px;box-sizing:border-box;">
                            <small style="color:#888;font-size:11px;">
                                Find in PhonePe / GPay / Paytm transaction history
                            </small>
                        </div>

                        <button onclick="confirmPayment('${tournamentId}')"
                            style="width:100%;padding:16px;background:#00ff88;color:#000;border:none;
                                   border-radius:8px;font-size:18px;font-weight:bold;cursor:pointer;
                                   margin-top:20px;">
                            I have paid → Confirm
                        </button>

                        <p style="color:#666;font-size:12px;text-align:center;margin-top:15px;">
                            Payment will be verified within 5 minutes
                        </p>
                    </div>
                </div>
            </div>
        </div>`);

    document.body.style.overflow = "hidden";
    startPaymentTimer();
};

window.closePaymentInterface = function() {
    const modal = document.getElementById("paymentInterface");
    if (modal) {
        modal.remove();
        document.body.style.overflow = "auto";
    }
    clearInterval(paymentTimerInterval);
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

async function checkTournamentPromotions() {
    const now = new Date();
    const today = now.toISOString().split('T')[0]; // YYYY-MM-DD
    
    tournaments.forEach(async (t) => {
        if (!t.eventDate) return;
        
        const eventDate = new Date(t.eventDate);
        const diffHours = (eventDate - now) / (1000 * 60 * 60);
        
        // PROMOTION: If today is tournament date and status is still 'upcoming'
        if (t.category === 'upcoming' && t.eventDate === today && diffHours <= 0) {
            // Move to ongoing (in reality, you'd update Firestore, here we simulate)
            console.log(`[AUTO] Promoting tournament ${t.id} to ongoing`);
            
            // Update local state
            t.category = 'ongoing';
            t.status = 'live';
            t.endTime = eventDate.getTime() + (2 * 60 * 60 * 1000); // 2 hours duration
            
            // Notify registered teams that tournament is starting NOW
            notifyRegisteredTeams(t.id, 'tournament_starting');
            
            renderTournaments();
        }
        
        // PAYMENT REMINDER: If 24-48 hours before tournament and not paid
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

// ===============================
// AUTHENTICATION
// ===============================
async function createAccount() {
    const email   = document.getElementById("regEmail")?.value.trim();
    const pass    = document.getElementById("regPass")?.value;
    const confirm = document.getElementById("regConfirm")?.value;
    const age     = parseInt(document.getElementById("regAge")?.value);

    if (!email || !pass || !confirm || !age) { showMessage("Fill all fields including age"); return; }
    if (pass !== confirm)  { showMessage("Passwords do not match"); return; }
    if (age < 12 || age > 60) { showMessage("Age must be between 12 and 60"); return; }

    // Show loading state
    const createBtn = document.querySelector('#createView button[onclick="createAccount()"]');
    const originalText = createBtn?.textContent;
    if (createBtn) {
        createBtn.disabled = true;
        createBtn.textContent = "Creating Account...";
    }

    try {
        const userCred = await createUserWithEmailAndPassword(auth, email, pass);
        const user     = userCred.user;
        const uid      = user.uid;

        let userData = {
            uid, email, age,
            role:     selectedRole || "viewer",
            isAdmin:  false,
            isLeader: false,
            teamId:   null,
            teamName: null,
            teamCode: null,
            createdAt: serverTimestamp(),
            stats: { tournamentsJoined: 0, tournamentsWon: 0, matchesPlayed: 0 }
        };

        if (selectedRole === "leader") {
            const teamName = document.getElementById("teamNameInput")?.value.trim();
            const teamCode = document.getElementById("generatedCode")?.textContent?.replace("Code: ", "").trim();

            if (!teamName || !teamCode) {
                showMessage("Enter team name and generate code");
                await user.delete();
                return;
            }

            const teamId = "team_" + Math.random().toString(36).substr(2, 9);
            
            // Create team first
            await setDoc(doc(db, "teams", teamId), {
                teamId, teamName,
                leaderId:   uid,
                leaderName: email.split('@')[0],
                code:       teamCode,
                members:    [uid],
                maxMembers: 5, // Changed to 5 for 4+1 squad
                createdAt:  serverTimestamp()
            });

            userData.isLeader = true;
            userData.teamId   = teamId;
            userData.teamName = teamName;
            userData.teamCode = teamCode;
            userData.role     = "leader";

        } else if (selectedRole === "join") {
            const enteredCode = document.getElementById("joinCode")?.value.trim().toUpperCase(); // Normalize
            
            if (!enteredCode) { 
                showMessage("Enter team code"); 
                await user.delete(); 
                return; 
            }

            // Query for team with matching code
            const teamsQuery = query(collection(db, "teams"), where("code", "==", enteredCode));
            const teamSnap   = await getDocs(teamsQuery);

            if (teamSnap.empty) { 
                showMessage("Invalid team code. Please check with your team leader."); 
                await user.delete(); 
                if (createBtn) {
                    createBtn.disabled = false;
                    createBtn.textContent = originalText;
                }
                return; 
            }

            const teamDoc  = teamSnap.docs[0];
            const teamData = teamDoc.data();

            // Validate team isn't full
            const currentMembers = teamData.members || [];
            if (currentMembers.length >= (teamData.maxMembers || 5)) {
                showMessage("Team is full. Maximum 5 members allowed.");
                await user.delete();
                if (createBtn) {
                    createBtn.disabled = false;
                    createBtn.textContent = originalText;
                }
                return;
            }

            // Add user to team
            await updateDoc(doc(db, "teams", teamData.teamId), { 
                members: arrayUnion(uid) 
            });

            userData.teamId   = teamData.teamId;
            userData.teamName = teamData.teamName;
            userData.teamCode = enteredCode;
            userData.role     = "member";
            
            // Store for welcome message
            localStorage.setItem("welcomeTeam", teamData.teamName);
        }

              // Create user document
        console.log("[CREATE] Writing user document for UID:", uid);
        console.log("[CREATE] User data:", JSON.stringify(userData, null, 2));
        
        try {
            await setDoc(doc(db, "users", uid), userData);
            console.log("[CREATE] User document written successfully");
            
            // Verify the document was created
            const verifyDoc = await getDoc(doc(db, "users", uid));
            if (verifyDoc.exists()) {
                console.log("[CREATE] ✓ Document verified in Firestore");
            } else {
                console.warn("[CREATE] ✗ Document NOT found after write!");
            }
        } catch (writeErr) {
            console.error("[CREATE] Error writing document:", writeErr.message);
            console.error("[CREATE] Error code:", writeErr.code);
            // Still show success to user, but log the error
            showMessage("Account created (note: some features may be limited)");
        }
        
        // Wait for Firestore to propagate
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Success
        showMessage("Account created successfully!");

        closeModal();
        
        // Show team welcome if applicable
        if (selectedRole === "join") {
            const welcomeTeam = localStorage.getItem("welcomeTeam");
            if (welcomeTeam) {
                setTimeout(() => {
                    showMessage(`Welcome to team "${welcomeTeam}"!`);
                    localStorage.removeItem("welcomeTeam");
                }, 500);
            }
        } else if (selectedRole === "leader") {
            setTimeout(() => {
                showMessage(`Team "${userData.teamName}" created! Share code: ${userData.teamCode}`);
            }, 500);
        }

        backToLogin();

    } catch (err) {
        console.error("Registration error:", err);
        showMessage("Error: " + err.message);
    } finally {
        if (createBtn) {
            createBtn.disabled = false;
            createBtn.textContent = originalText || "Create Account";
        }
    }
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
            // Wait max 5 seconds for profile
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

    // Profile loaded successfully - continue with existing logic
    if (type === "profile") {
        renderProfileTab(content);
    } else if (type === "tournaments") {
        content.innerHTML = `
            <h2 style="color:#00ff88;">My Tournaments</h2>
            <p style="color:#666;margin-top:20px;">Feature coming in next update...</p>`;
    } else if (type === "performance") {
        renderPerformanceTab(content);
    } else if (type === "matches") {
        content.innerHTML = `
            <h2 style="color:#00ff88;">Upcoming Matches</h2>
            <div style="margin-top:20px;padding:20px;background:#1a1a1a;border-radius:8px;">
                <p style="color:#888;">No upcoming matches scheduled.</p>
            </div>`;
    }
}

// Helper: Render Profile (extracted for clarity)
function renderProfileTab(content) {
    const isAdmin    = userProfile?.isAdmin === true;
    const roleBadge  = userProfile?.isLeader ? "👑 Team Leader"
                     : userProfile?.role === 'member' ? "👥 Team Member" : "👤 Viewer";

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

// PHASE 3: Wallet Section
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
                <button onclick="changePassword()"
                    style="background:#4a90e2;color:#fff;border:none;padding:12px;flex:1;border-radius:6px;cursor:pointer;min-width:120px;">Change Password</button>
                <button onclick="logout()"
                    style="background:#ff4444;color:#fff;border:none;padding:12px;flex:1;border-radius:6px;cursor:pointer;min-width:120px;">Logout</button>
            </div>
        </div>`;
}

function renderPerformanceTab(content) {
    content.innerHTML = `
        <h2 style="color:#00ff88;">Performance</h2>
        <div style="margin-top:20px;padding:20px;background:#1a1a1a;border-radius:8px;">
            <p style="color:#fff;font-size:18px;">Total Wins: <strong style="color:#00ff88;">${userProfile?.stats?.tournamentsWon || 0}</strong></p>
            <p style="color:#888;margin-top:10px;">Detailed stats coming soon...</p>
        </div>`;
}


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
        team_stage_locked: '🔒'
    };

    const colorMap = {
        approval:          '#00ff88', 
        rejected:          '#ff4444',
        payment_pending:   '#ffd700',
        payment_confirmed: '#00ff88',
        verification:      '#00ff88',
        payment:           '#ffd700',
        team_stage_locked: '#4a90e2'
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
window.showMatchRoom = showMatchRoom;
window.startTournamentMatches = startTournamentMatches;
window.addFunds = addFunds;
window.openWalletModal = openWalletModal;
window.viewTransactionHistory = viewTransactionHistory;
window.reportCheater = reportCheater;
window.showReferralModal = showReferralModal;
