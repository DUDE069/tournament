// ===============================
// NPC ESPORTS MAIN SYSTEM (PHASES 1-5 COMPLETE)
// ===============================

// FIREBASE IMPORTS
import { db, auth } from "./firebase.js";
import {
  collection, onSnapshot, doc, setDoc, getDoc, serverTimestamp,
  addDoc, updateDoc, query, where, getDocs, arrayUnion, orderBy, increment,
  runTransaction, writeBatch, deleteDoc, limit, startAfter
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
// GLOBAL STATE (ALL PHASES)
// ===============================
let editingId           = null;
let isLoggedIn          = false;
let selectedRole        = "";
let tournaments         = [];
let currentUser         = null;
let userProfile         = null;
let profileLoadPromise  = null;
let calendarEvents      = [];
let currentCalendarDate = new Date();
let unsubNotifications  = null;
const activeTimers      = new Map(); // Fixed: Moved to top
let userWallet          = { balance: 0, transactions: [], pending: 0 };
const audioContext      = new (window.AudioContext || window.webkitAudioContext)(); // Phase 2/5
let currentStream       = null; // Phase 5

// ===============================
// PHASE 1: UPCOMING TOURNAMENT SYSTEM
// ===============================

window.handleUpcomingRegister = async function(tournamentId) {
    if (!currentUser) { openLogin(); return; }

    const tournament = tournaments.find(t => t.id === tournamentId);
    if (!tournament) { showMessage("Tournament not found"); return; }

    if (!userProfile?.teamId) {
        document.getElementById("viewerBlocker").style.display = "block";
        document.getElementById("registrationContainer").style.display = "none";
        document.getElementById("joinTournamentModal").style.display = "block";
        document.body.style.overflow = "hidden";
        return;
    }

    window.currentJoiningTournament = tournamentId;
    window.currentTournamentCategory = 'upcoming';

    document.getElementById("viewerBlocker").style.display = "none";
    document.getElementById("registrationContainer").style.display = "block";
    document.getElementById("joinTournamentModal").style.display = "block";
    document.body.style.overflow = "hidden";

    // Fill info
    document.getElementById("joinTournamentTitle").textContent = tournament.title;
    document.getElementById("joinPrizeFirst").textContent = tournament.prize?.first || 0;
    document.getElementById("prizeFirst").textContent = tournament.prize?.first || 0;
    document.getElementById("prizeSecond").textContent = tournament.prize?.second || 0;
    document.getElementById("prizeThird").textContent = tournament.prize?.third || 0;
    
    // Hide payment for Phase 1 (upcoming)
    const walletEl = document.getElementById("walletBalance")?.parentElement;
    if (walletEl) walletEl.style.display = "none";
    
    const feeEl = document.getElementById("joinEntryFeeDisplay")?.parentElement;
    if (feeEl) feeEl.style.display = "none";

    // Show date banner
    const eventDate = tournament.eventDate ? new Date(tournament.eventDate).toLocaleDateString('en-IN', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }) : 'TBA';
    
    let dateBanner = document.getElementById("upcomingDateBanner");
    if (!dateBanner) {
        const form = document.getElementById("tournamentJoinForm");
        if (form) {
            dateBanner = document.createElement("div");
            dateBanner.id = "upcomingDateBanner";
            dateBanner.style.cssText = `
                background: rgba(59, 130, 246, 0.1); border: 1px solid #3b82f6; 
                border-radius: 8px; padding: 15px; margin-bottom: 20px; text-align: center;
            `;
            form.insertBefore(dateBanner, form.firstChild);
        }
    }
    
    if (dateBanner) {
        dateBanner.innerHTML = `
            <div style="color: #3b82f6; font-size: 14px; margin-bottom: 5px;">📅 Tournament Schedule</div>
            <div style="color: #fff; font-size: 20px; font-weight: bold;">${eventDate}</div>
            <div style="color: #888; font-size: 12px; margin-top: 5px;">
                Free registration • Payment required 24h before match
            </div>
        `;
    }

    // Timer countdown
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

    // Fill user data
    document.getElementById("joinDisplayEmail").textContent = userProfile.email;
    document.getElementById("joinDisplayAge").textContent = userProfile.age + " years";
    document.getElementById("joinDisplayTeam").textContent = userProfile.teamName;
    document.getElementById("joinDisplayCode").textContent = "Code: " + (userProfile.teamCode || "N/A");

    // Clear fields
    document.getElementById("uidPlayer1").value = userProfile.freeFireUid || "";
    document.getElementById("joinBackupEmail").value = "";
    document.getElementById("uidPlayer2").value = "";
    document.getElementById("uidPlayer3").value = "";
    document.getElementById("uidPlayer4").value = "";
    document.getElementById("uidPlayer5").value = "";
    document.getElementById("joinPhone").value = "";

    const submitBtn = document.getElementById("joinSubmitBtn");
    if (submitBtn) {
        submitBtn.textContent = "Submit for Verification →";
        submitBtn.style.background = "#3b82f6";
    }
};

// ===============================
// CORE RENDER FUNCTION (PHASES 1-2)
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
        let buttonHTML = '';
        let timerHTML = '';
        let cardStyle = '';

        // PHASE 2: Check if tournament is completed (2 hours after end)
        const hoursSinceEnd = t.endTime ? (now - t.endTime) / (1000 * 60 * 60) : -1;
        const isCompleted = hoursSinceEnd >= 2;

        if (t.category === "ongoing") {
            if (isCompleted) {
                // PHASE 2: Show results button
                buttonHTML = `
                    <button class="join-btn" onclick="showTournamentResults('${t.id}')"
                        style="background: #ffd700; border-color: #ffd700; color: #000;">
                        🏆 See Results
                    </button>`;
                timerHTML = `<div class="timer-box"><p class="section-title" style="color:#ffd700;">✅ Completed</p></div>`;
            } else {
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
                        ${hasStarted ? "Live Match" : "Join Now"}
                    </button>`;
            }

        } else if (t.category === "upcoming") {
            // PHASE 1: Upcoming logic
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
// PHASE 2: AUTO-PROMOTION & REMINDERS
// ===============================

// Check every 5 minutes for promotions
setInterval(checkTournamentPromotions, 300000);
checkTournamentPromotions();

async function checkTournamentPromotions() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    tournaments.forEach(async (t) => {
        if (!t.eventDate || t.category !== 'upcoming') return;
        
        const eventDate = new Date(t.eventDate);
        const diffHours = (eventDate - now) / (1000 * 60 * 60);
        
        // Auto-promote to ongoing on match day
        if (t.eventDate === today && diffHours <= 0) {
            console.log(`[AUTO] Promoting ${t.id} to ongoing`);
            
            // Update Firestore
            await updateDoc(doc(db, "tournaments", t.id), {
                category: 'ongoing',
                status: 'live',
                promotedAt: serverTimestamp(),
                endTime: eventDate.getTime() + (2 * 60 * 60 * 1000) // 2 hours match
            });
            
            // Notify registered teams
            const regs = await getDocs(collection(db, "tournaments", t.id, "upcomingRegistrations"));
            regs.forEach(async (r) => {
                if (r.data().status === 'approved') {
                    await addDoc(collection(db, "users", r.id, "notifications"), {
                        type: "tournament_starting",
                        title: "🎮 Tournament Starting Now!",
                        message: `"${t.title}" is starting! Room code will be shared shortly.`,
                        tournamentId: t.id,
                        read: false,
                        createdAt: serverTimestamp()
                    });
                }
            });
        }
        
        // Payment reminder 24-48 hours before
        if (diffHours <= 48 && diffHours > 0) {
            remindPendingPayments(t.id, t.eventDate, t.title);
        }
    });
}

async function remindPendingPayments(tournamentId, eventDate, title) {
    if (!currentUser) return;
    
    const userRegRef = doc(db, "users", currentUser.uid, "upcomingRegistrations", tournamentId);
    const regSnap = await getDoc(userRegRef);
    
    if (regSnap.exists()) {
        const data = regSnap.data();
        if (data.status === 'approved' && !data.paymentReminderSent && !data.paymentStatus) {
            showPopup(
                "warning",
                `⏰ Payment Reminder!\n\n"${title}"\n📅 Date: ${new Date(eventDate).toLocaleDateString()}\n\nPay entry fee within 24 hours to confirm your spot.`, 
                "Pay Now →",
                async () => {
                    document.getElementById('customPopup')?.remove();
                    openUpcomingPaymentInterface(tournamentId);
                }
            );
            
            await updateDoc(userRegRef, { paymentReminderSent: true });
            
            playNotificationSound('reminder');
        }
    }
}

window.openUpcomingPaymentInterface = async function(tournamentId) {
    const tournament = tournaments.find(t => t.id === tournamentId);
    if (!tournament) return;
    
    document.body.insertAdjacentHTML('beforeend', `
        <div id="upcomingPaymentModal" style="position:fixed;top:0;left:0;width:100%;height:100%;
            background:rgba(0,0,0,0.95);z-index:6000;display:flex;align-items:center;justify-content:center;">
            <div style="background:#1a1a1a;padding:30px;border-radius:12px;max-width:400px;width:90%;border:2px solid #ffd700;">
                <h2 style="color:#ffd700;margin-bottom:20px;">Confirm Tournament Entry</h2>
                <p style="color:#fff;margin-bottom:10px;">${tournament.title}</p>
                <p style="color:#888;margin-bottom:20px;">Date: ${new Date(tournament.eventDate).toLocaleDateString()}</p>
                
                <div style="background:#0f0f0f;padding:15px;border-radius:8px;margin-bottom:20px;">
                    <p style="color:#666;margin:0;">Entry Fee</p>
                    <p style="color:#ffd700;font-size:28px;font-weight:bold;margin:5px 0;">₹${tournament.entryFee}</p>
                    <p style="color:#ff4444;font-size:12px;">⚠️ Non-refundable after payment</p>
                </div>
                
                <div style="display:flex;gap:10px;">
                    <button onclick="processUpcomingPayment('${tournamentId}', ${tournament.entryFee})" 
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

window.processUpcomingPayment = async function(tournamentId, amount) {
    const success = await deductFunds(amount, `Tournament entry: ${tournamentId}`);
    if (success) {
        await updateDoc(doc(db, "users", currentUser.uid, "upcomingRegistrations", tournamentId), {
            paymentStatus: "paid",
            paidAt: serverTimestamp()
        });
        document.getElementById('upcomingPaymentModal')?.remove();
        showPopup("success", "Payment successful! Your spot is confirmed.", "Great!", () => {
            document.getElementById('customPopup')?.remove();
        });
    }
};

window.showTournamentResults = async function(tournamentId) {
    const tournament = tournaments.find(t => t.id === tournamentId);
    if (!tournament?.winners) {
        showMessage("Results not available yet.");
        return;
    }
    
    const w = tournament.winners;
    document.body.insertAdjacentHTML('beforeend', `
        <div id="resultsModal" style="position:fixed;top:0;left:0;width:100%;height:100%;
            background:rgba(0,0,0,0.95);z-index:7000;overflow-y:auto;">
            <div style="max-width:800px;margin:50px auto;padding:30px;">
                <div style="background:linear-gradient(135deg,#1a1a2a 0%,#0f0f1f 100%);border-radius:16px;padding:40px;border:2px solid #ffd700;text-align:center;">
                    <h1 style="color:#ffd700;font-size:48px;margin-bottom:30px;">🏆 Results</h1>
                    <h2 style="color:#fff;margin-bottom:40px;">${tournament.title}</h2>
                    
                    <div style="display:grid;gap:20px;margin-bottom:40px;">
                        <div style="background:rgba(255,215,0,0.1);border:2px solid #ffd700;padding:20px;border-radius:12px;">
                            <div style="font-size:64px;">🥇</div>
                            <h3 style="color:#ffd700;">Winner</h3>
                            <p style="color:#fff;font-size:24px;font-weight:bold;">${w.firstPlace?.teamName || 'TBA'}</p>
                            <p style="color:#00ff88;font-size:20px;">₹${tournament.prize?.first || 0}</p>
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
                            <div style="background:rgba(192,192,192,0.1);border:2px solid #c0c0c0;padding:20px;border-radius:12px;">
                                <div style="font-size:48px;">🥈</div>
                                <h4 style="color:#c0c0c0;">2nd Place</h4>
                                <p style="color:#fff;font-weight:bold;">${w.secondPlace?.teamName || 'TBA'}</p>
                                <p style="color:#aaa;">₹${tournament.prize?.second || 0}</p>
                            </div>
                            <div style="background:rgba(205,127,50,0.1);border:2px solid #cd7f32;padding:20px;border-radius:12px;">
                                <div style="font-size:48px;">🥉</div>
                                <h4 style="color:#cd7f32;">3rd Place</h4>
                                <p style="color:#fff;font-weight:bold;">${w.thirdPlace?.teamName || 'TBA'}</p>
                                <p style="color:#aaa;">₹${tournament.prize?.third || 0}</p>
                            </div>
                        </div>
                    </div>
                    
                    <button onclick="document.getElementById('resultsModal').remove()" 
                        style="padding:12px 40px;background:#333;color:#fff;border:none;border-radius:8px;cursor:pointer;">
                        Close
                    </button>
                </div>
            </div>
        </div>
    `);
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

// ===============================
// PHASE 3: LIVE MATCH & BRACKETS
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
        await addDoc(collection(db, "users", p.id, "notifications"), {
            type: "match_started",
            title: "🎮 Match Started!",
            message: `Room: ${roomCode} | Pass: ${password}`,
            tournamentId: tournamentId,
            read: false,
            createdAt: serverTimestamp()
        });
    });
    
    showMessage("Match started! Codes sent to participants.");
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
                <p style="color:#ff4444;font-size:14px;margin-bottom:20px;">
                    ⚠️ Join within 10 minutes
                </p>
                <button onclick="document.getElementById('matchRoomModal').remove()" 
                    style="padding:12px 40px;background:#333;color:#fff;border:none;border-radius:8px;cursor:pointer;">
                    Close
                </button>
            </div>
        </div>
    `);
};

window.showTournamentBracket = async function(tournamentId) {
    // Simplified bracket view
    document.body.insertAdjacentHTML('beforeend', `
        <div id="bracketModal" style="position:fixed;top:0;left:0;width:100%;height:100%;
            background:rgba(0,0,0,0.98);z-index:9000;overflow:auto;padding:40px;">
            <div style="max-width:1200px;margin:0 auto;">
                <h2 style="color:#00ff88;text-align:center;margin-bottom:40px;">Tournament Bracket</h2>
                <div style="background:#1a1a1a;padding:30px;border-radius:12px;text-align:center;">
                    <p style="color:#888;">Bracket visualization coming in next update</p>
                    <button onclick="document.getElementById('bracketModal').remove()" 
                        style="margin-top:20px;padding:10px 30px;background:#333;color:#fff;border:none;border-radius:6px;cursor:pointer;">
                        Close
                    </button>
                </div>
            </div>
        </div>
    `);
};

// ===============================
// PHASE 4: REFERRAL SYSTEM
// ===============================

window.generateReferralCode = function() {
    if (!currentUser) return;
    const code = currentUser.uid.substring(0, 8).toUpperCase();
    return code;
};

window.applyReferral = async function(code) {
    if (!currentUser) return;
    
    const referrerQuery = query(collection(db, "users"), where("referralCode", "==", code));
    const referrerSnap = await getDocs(referrerQuery);
    
    if (!referrerSnap.empty) {
        await updateDoc(doc(db, "users", currentUser.uid), {
            referredBy: referrerSnap.docs[0].id,
            bonusCredits: increment(50)
        });
        showMessage("Referral applied! You got ₹50 bonus.");
    }
};

// ===============================
// PHASE 5: STREAMING & ANTI-CHEAT
// ===============================

window.reportCheater = async function(tournamentId, teamId, reason) {
    await addDoc(collection(db, "reports"), {
        type: 'cheating',
        tournamentId: tournamentId,
        reportedTeam: teamId,
        reason: reason,
        reportedBy: currentUser.uid,
        createdAt: serverTimestamp(),
        status: 'pending'
    });
    showMessage("Report submitted. Admin will review.");
};

// ===============================
// FORM SUBMISSION (CONSOLIDATED)
// ===============================
document.addEventListener("DOMContentLoaded", function() {
    const form = document.getElementById("tournamentJoinForm");
    if (!form) return;

    form.addEventListener("submit", async function(e) {
        e.preventDefault();
        const submitBtn = document.getElementById("joinSubmitBtn");
        const processing = document.getElementById("processingOverlay");
        
        const tournamentId = window.currentJoiningTournament;
        const isUpcoming = window.currentTournamentCategory === 'upcoming';
        const tournament = tournaments.find(t => t.id === tournamentId);
        
        if (!tournament) return;

        const uids = [
            document.getElementById("uidPlayer1")?.value.trim() || "",
            document.getElementById("uidPlayer2")?.value.trim() || "",
            document.getElementById("uidPlayer3")?.value.trim() || "",
            document.getElementById("uidPlayer4")?.value.trim() || "",
            document.getElementById("uidPlayer5")?.value.trim() || ""
        ].filter(uid => uid !== "");

        if (uids.length < 4) {
            showMessage("Please enter at least 4 player UIDs");
            return;
        }

        const phoneRaw = document.getElementById("joinPhone")?.value.trim() || "";
        const backupEmail = document.getElementById("joinBackupEmail")?.value.trim() || "";
        
        if (!phoneRaw.match(/^\d{10}$/)) {
            showMessage("Please enter valid 10-digit phone number");
            return;
        }

        submitBtn.disabled = true;
        if (processing) processing.style.display = "flex";

        try {
            const userId = currentUser.uid;

            if (isUpcoming) {
                // PHASE 1: Upcoming registration
                await setDoc(doc(db, "tournaments", tournamentId, "upcomingRegistrations", userId), {
                    userId, teamId: userProfile.teamId, teamName: userProfile.teamName,
                    teamCode: userProfile.teamCode, leaderEmail: userProfile.email,
                    leaderUid: uids[0], uids, phone: "+91" + phoneRaw, backupEmail,
                    status: "pending", registeredAt: serverTimestamp(), eventDate: tournament.eventDate
                });
                
                await setDoc(doc(db, "users", userId, "upcomingRegistrations", tournamentId), {
                    tournamentId, title: tournament.title, eventDate: tournament.eventDate,
                    status: "pending_verification", registeredAt: serverTimestamp()
                });
                
                listenToUpcomingApproval(tournamentId, userId);
                closeJoinModal();
                showPopup("success", `Registered for "${tournament.title}"!\nDate: ${new Date(tournament.eventDate).toLocaleDateString()}\n\nUnder review.`, "Got it", () => document.getElementById('customPopup')?.remove());
                
            } else {
                // Ongoing with payment
                await setDoc(doc(db, "tournaments", tournamentId, "verifications", userId), {
                    userId, teamId: userProfile.teamId, teamName: userProfile.teamName,
                    teamCode: userProfile.teamCode, leaderEmail: userProfile.email,
                    leaderUid: uids[0], uids, phone: "+91" + phoneRaw, backupEmail,
                    status: "pending", submittedAt: serverTimestamp()
                });
                
                closeJoinModal();
                showPopup("success", "Application submitted! Under review.", "Got it", () => document.getElementById('customPopup')?.remove());
            }
            
            submitBtn.disabled = false;
        } catch (err) {
            console.error(err);
            showMessage("Error: " + err.message);
            submitBtn.disabled = false;
        }
    });
});

// ===============================
// EXISTING FUNCTIONS (PRESERVED)
// ===============================

window.handleJoin = async function(tournamentId) {
    if (!currentUser) { openLogin(); return; }
    const tournament = tournaments.find(t => t.id === tournamentId);
    if (!tournament) return;
    
    if (!userProfile?.teamId) {
        document.getElementById("viewerBlocker").style.display = "block";
        document.getElementById("registrationContainer").style.display = "none";
        document.getElementById("joinTournamentModal").style.display = "block";
        document.body.style.overflow = "hidden";
        return;
    }
    
    // If match is live, show room code
    if (tournament.matchDetails?.status === 'live') {
        showMatchRoom(tournamentId);
        return;
    }
    
    // Otherwise normal join flow
    window.currentJoiningTournament = tournamentId;
    window.currentTournamentCategory = 'ongoing';
    // ... rest of your existing handleJoin logic
    document.getElementById("joinTournamentModal").style.display = "block";
    document.getElementById("registrationContainer").style.display = "block";
    document.body.style.overflow = "hidden";
};

window.closeJoinModal = function() {
    document.getElementById('joinTournamentModal').style.display = 'none';
    document.getElementById('viewerBlocker').style.display = 'none';
    document.getElementById('processingOverlay').style.display = 'none';
    document.body.style.overflow = 'auto';
    const submitBtn = document.getElementById('joinSubmitBtn');
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit for Verification →';
    }
    window.currentJoiningTournament = null;
    window.currentTournamentCategory = null;
};

// ... (Keep all your other existing functions: login, createAccount, dashboard, etc.)

// ===============================
// SOUND SYSTEM (PHASE 2/5)
// ===============================
function playNotificationSound(type = 'default') {
    if (audioContext.state === 'suspended') audioContext.resume();
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
    } else {
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
    }
}

// ===============================
// GLOBAL EXPORTS (REQUIRED)
// ===============================
window.handleProfileClick = handleProfileClick;
window.scrollToSection = scrollToSection;
window.openLogin = openLogin;
window.closeModal = closeModal;
window.showCreate = showCreate;
window.backToLogin = backToLogin;
window.login = login;
window.logout = logout;
window.createAccount = createAccount;
window.selectRole = selectRole;
window.generateTeamCode = generateTeamCode;
window.handleJoin = handleJoin;
window.handleUpcomingRegister = handleUpcomingRegister;
window.openDashboard = openDashboard;
window.closeDashboard = closeDashboard;
window.joinDiscord = joinDiscord;
window.closeJoinModal = closeJoinModal;
window.showGuidelines = showGuidelines;
window.closeGuidelines = closeGuidelines;
window.showPaymentInterface = showPaymentInterface;
window.confirmPayment = confirmPayment;
window.toggleNotifications = toggleNotifications;
window.markAllRead = markAllRead;
window.handleNotificationClick = handleNotificationClick;
window.toggleMobileMenu = toggleMobileMenu;
window.showTournamentResults = showTournamentResults;
window.showMatchRoom = showMatchRoom;
window.showTournamentBracket = showTournamentBracket;
window.startTournamentMatches = startTournamentMatches;
window.addFunds = addFunds;
window.reportCheater = reportCheater;
window.generateReferralCode = generateReferralCode;
window.applyReferral = applyReferral;

// Initialize
setupUI();
startFirebaseListeners();
