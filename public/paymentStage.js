// =====================================================
// paymentStage.js (v4.2 - Security Hardened)
// =====================================================

import { db, auth } from './js/firebase.js';
import {
  doc, onSnapshot, updateDoc, setDoc, serverTimestamp, getDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// 🔒 SECURITY FIX (Issue 6): Suppress sensitive payment logs in production.
// Payment IDs, Order IDs, and Signatures must never appear in browser console
// on a live site. Set to true ONLY during local development/debugging.
const PAYMENT_DEBUG_MODE = false;
if (!PAYMENT_DEBUG_MODE) {
  // Redirect payment-specific logs to a no-op to protect sensitive data.
  // This does NOT affect main.js logs (they have their own DEBUG_MODE guard).
  const _noop = () => {};
  // Override is scoped to this module only via the closure pattern in main.js.
  // We use a local wrapper below instead of overriding global console.
}

// Safe payment logger — use this instead of console.log in this file
function payLog(...args) { if (PAYMENT_DEBUG_MODE) console.log(...args); }
function payError(...args) { if (PAYMENT_DEBUG_MODE) console.error(...args); }
function payWarn(...args) { if (PAYMENT_DEBUG_MODE) console.warn(...args); }

// Variables
let unsubPayment = null;
let _currentTournamentId = null;
let _currentUserId = null;
let _isUpcomingTournament = false;
let _successScreenShowing = false; // ✅ FIX: guard against re-render loop

// ⚠️ YOUR RAZORPAY KEY ID (Frontend uses public Key ID)
const RAZORPAY_KEY_ID = "rzp_test_SygE6AqBXyl5LI"; 

// ============================================
// MAIN ENTRY POINT - Called from main.js
// ============================================
export function enterPaymentStage(userId, tournamentId, tournamentName, entryFee, isUpcoming = false) {
  _currentUserId = userId;
  _currentTournamentId = tournamentId;
  _successScreenShowing = false; // ✅ FIX: reset guard on each new entry

  if (unsubPayment) unsubPayment();

  const participantRef = doc(db, 'tournaments', tournamentId, 'participants', userId);
  
  unsubPayment = onSnapshot(participantRef, (snap) => {
    const data = snap.data();
    _isUpcomingTournament = isUpcoming; // Assign the passed flag
    if (!data) return;
    // ✅ FIX: Don't re-render if success screen is already showing — prevents scroll re-lock
    if (_successScreenShowing) return;
    renderPaymentUI(data, tournamentName, tournamentId, entryFee); 
  });

  renderPaymentUI({ paymentStatus: 'pending' }, tournamentName, tournamentId, entryFee); 
}

// ============================================
// UTR SUBMISSION & VERIFICATION (Replaces Razorpay)
// ============================================
async function submitUtrVerification(tournamentId, entryFee) {
  payLog("[PAYMENT] Submit UTR clicked for:", tournamentId);
  
  const utrInput = document.getElementById('utrInput').value.trim();
  const UTR_REGEX = /^[0-9]{12}$/;

  if (!UTR_REGEX.test(utrInput)) {
    showToast("Invalid UTR! Must be exactly 12 numbers.", "error");
    return;
  }

  const btn = document.getElementById('payBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Verifying...";
  }

  try {
    // We need the teamId. Let's try fetching it from participants or user profile.
    let teamId = null;
    let tSnap = await getDoc(doc(db, 'tournaments', tournamentId, 'participants', _currentUserId));
    if (tSnap.exists() && tSnap.data().teamId) {
      teamId = tSnap.data().teamId;
    } else {
      const uSnap = await getDoc(doc(db, 'users', _currentUserId));
      if (uSnap.exists() && uSnap.data().teamId) {
        teamId = uSnap.data().teamId;
      }
    }
    
    if (!teamId) {
       // Fallback to userId if no teamId found
       teamId = _currentUserId;
    }

    payLog("[PAYMENT] Sending UTR verification request to backend...");
    // Hit the new Node.js express backend (Replace URL with deployed Render URL)
    const verificationResponse = await fetch('https://npc-secure-backend.onrender.com/verify-utr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        utr: utrInput,
        userId: _currentUserId,
        tournamentId: tournamentId,
        teamId: teamId,
        expectedAmount: entryFee
      })
    });

    const verificationResult = await verificationResponse.json();
    
    if (!verificationResponse.ok || !verificationResult.success) {
      payError("[PAYMENT] Backend verification failed:", verificationResult.message);
      showToast(verificationResult.message || "Invalid or Duplicate UTR.", "error");
      if (btn) { btn.disabled = false; btn.textContent = "Submit UTR"; }
      return;
    }

    showToast("✅ UTR Submitted! Pending Admin Approval.", "success");

    // 🔒 IMMEDIATELY lock the UI state via localStorage so re-renders show "Verification Pending"
    try {
      const pending = JSON.parse(localStorage.getItem('npc_pending_payments') || '{}');
      pending[tournamentId] = { utr: utrInput, submittedAt: Date.now(), status: 'pending_verification' };
      localStorage.setItem('npc_pending_payments', JSON.stringify(pending));
    } catch (e) {}

    // Close the overlay as it's now pending admin approval
    closePaymentOverlay();

  } catch (error) {
    payError("[PAYMENT] Verification error:", error);
    showToast("Error submitting UTR. Contact support.", "error");
    if (btn) { btn.disabled = false; btn.textContent = "Submit UTR"; }
  }
}


// ============================================
// RENDER PAYMENT UI
// ============================================
function renderPaymentUI(data, tournamentName, tournamentId, entryFee) {
  // ✅ FIX: Don't re-render if success screen is already showing
  if (_successScreenShowing) return;
  document.getElementById('paymentOverlay')?.remove();

  const { paymentStatus, roomId, roomPassword, razorpayPaymentId } = data;

  if (paymentStatus === 'verified') {
    renderSuccessScreen(tournamentName, roomId, roomPassword, razorpayPaymentId);
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'paymentOverlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.97);
    z-index: 9000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  `;
  
  // upiUri and QR are now generated SERVER-SIDE in renderPaymentUI (after overlay appended)
  const upiUri = ''; // Placeholder — real URI injected after server response

  overlay.innerHTML = `
    <div style="
      background: #111;
      border: 2px solid #00ff88;
      border-radius: 16px;
      padding: 32px;
      max-width: 420px;
      width: 100%;
      text-align: center;
      font-family: 'Rajdhani', sans-serif;
      position: relative;
    ">
      <button onclick="closePaymentOverlay()" style="position:absolute;top:10px;right:16px;background:transparent;border:none;color:#888;font-size:24px;cursor:pointer;">&times;</button>
      
      <div style="
        display: inline-block;
        padding: 6px 18px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 700;
        background: rgba(59,130,246,.15);
        color: #3b82f6;
        border: 1px solid #3b82f6;
        margin-bottom: 16px;
      ">🔒 Payment Required</div>
      
      <h2 style="color: #fff; margin: 0 0 8px; font-size: 24px;">Complete Registration</h2>
      <p style="color: #888; margin-bottom: 24px;">${escapeHtml(tournamentName)}</p>

      <div style="
        background: #0f0f0f;
        border: 1px solid #2a2a2a;
        border-radius: 10px;
        padding: 14px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 18px;
      ">
        <span style="color: #888; font-size: 13px;">Entry Fee</span>
        <span id="paymentAmount" style="color: #00ff88; font-size: 22px; font-weight: 900;">
          ${entryFee ? `₹ ${entryFee}` : 'Loading...'}
        </span>
      </div>
      
      <p style="color:#aaa;font-size:14px;margin-bottom:8px;">Scan to Pay</p>
      <div id="qrcodeContainer" style="background:#fff;padding:12px;border-radius:10px;display:inline-block;margin-bottom:16px;"></div>

      <a id="openUpiLink" href="#" style="display:block;background:#3b82f6;color:#fff;padding:12px;border-radius:8px;text-decoration:none;font-weight:bold;margin-bottom:20px;">
        Open UPI App (Mobile)
      </a>
      
      <div style="text-align:left;margin-bottom:16px;">
        <label style="color:#fff;font-size:14px;margin-bottom:6px;display:block;font-weight:bold;">📋 Enter UTR / Transaction Reference Number</label>
        <p style="color:#888;font-size:12px;margin-bottom:8px;line-height:1.5;">
          After completing your UPI payment, enter the 12-digit UTR number below to verify your payment. 
          <strong style="color:#fbbf24;">This must be completed within the time limit shown below.</strong>
        </p>
        <input type="text" id="utrInput" placeholder="e.g. 312345678901" maxlength="12" style="width:100%;padding:12px;border-radius:8px;border:1px solid #333;background:#0f0f0f;color:#fff;font-family:monospace;font-size:16px;box-sizing:border-box;">
      </div>

      <button id="payBtn" onclick="submitUtrVerification('${tournamentId}', ${entryFee || 0})" style="
        width: 100%;
        padding: 16px;
        background: linear-gradient(135deg, #00ff88, #00cc6a);
        color: #000;
        border: none;
        border-radius: 10px;
        font-size: 16px;
        font-weight: 700;
        cursor: pointer;
        font-family: 'Rajdhani', sans-serif;
        transition: transform 0.1s, box-shadow 0.2s;
      " onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
        ✅ Submit UTR & Verify Payment
      </button>
      
      <p style="color: #555; font-size: 12px; margin-top: 14px;">
        Submit your UTR within <span id="countdownTimer" style="color:#ff4444; font-weight:bold;">15:00</span> minutes to secure your slot.
      </p>
    </div>
  `;

  document.body.appendChild(overlay);

  // Start 15-minute countdown
  let timeLeft = 15 * 60;
  const timerEl = document.getElementById('countdownTimer');
  const timerInterval = setInterval(() => {
    if (!document.getElementById('paymentOverlay')) {
      clearInterval(timerInterval);
      return;
    }
    timeLeft--;
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      timerEl.textContent = "00:00";
      showToast("Time expired! Your slot may be revoked.", "error");
    } else {
      const m = Math.floor(timeLeft / 60).toString().padStart(2, '0');
      const s = (timeLeft % 60).toString().padStart(2, '0');
      timerEl.textContent = `${m}:${s}`;
    }
  }, 1000);

  // ── GENERATE SECURE QR CLIENT-SIDE (INSTANT) ──────────────────────────
  (async () => {
    try {
      const upiId = "riaz-1@ptyes"; // NPC Admin UPI
      const payeeName = "NPC Esports";
      const amount = entryFeeFallback || 0;
      
      const upiUri = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(payeeName)}&am=${amount}&cu=INR`;
      
      const amountEl = document.getElementById('paymentAmount');
      if (amountEl) amountEl.textContent = `₹ ${amount}`;
      
      const upiLink = document.getElementById('openUpiLink');
      if (upiLink) upiLink.href = upiUri;
      
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiUri)}`;
      const qrContainer = document.getElementById('qrcodeContainer');
      if (qrContainer) {
        qrContainer.innerHTML = `<img src="${qrUrl}" width="200" height="200" alt="UPI QR Code" style="display:block;border-radius:8px;background:#fff;padding:5px;">`;
      }
    } catch (err) {
      payError('[QR] Failed to generate QR:', err);
      const qrContainer = document.getElementById('qrcodeContainer');
      if (qrContainer) qrContainer.innerHTML = '<p style="color:#ff4444;font-size:12px;">QR unavailable. Use UPI ID: riaz-1@ptyes</p>';
    }
  })();
}

// ============================================
// LOAD ENTRY FEE
// ============================================
async function loadPaymentDetails(tournamentId) {
  try {
    const tSnap = await getDoc(doc(db, 'tournaments', tournamentId));
    const amountEl = document.getElementById('paymentAmount');
    
    if (tSnap.exists()) {
      const t = tSnap.data();
      if (amountEl) amountEl.textContent = `₹ ${t.entryFee || '—'}`;
    }
  } catch (error) {
    payError("[PAYMENT] Error loading details:", error);
  }
}

// ============================================
// SUCCESS SCREEN
// ============================================
function renderSuccessScreen(tournamentName, roomId, roomPassword, paymentId) {
  // ✅ FIX: Set guard flag so snapshot can't re-render on top of this screen
  _successScreenShowing = true;

  if (unsubPayment) {
    unsubPayment();
    unsubPayment = null;
  }

  const overlay = document.createElement('div');
  overlay.id = 'paymentOverlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.97);
    z-index: 9000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  `;

  const roomSection = (roomId && roomPassword) ? `
    <div style="
      background: rgba(0, 255, 136, 0.1);
      border: 2px solid #00ff88;
      border-radius: 12px;
      padding: 20px;
      margin: 20px 0;
      text-align: center;
    ">
      <p style="color: #00ff88; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px;">🔑 Room Details</p>
      <div style="display: flex; justify-content: center; gap: 30px; flex-wrap: wrap;">
        <div>
          <p style="color: #888; font-size: 11px; text-transform: uppercase; margin-bottom: 6px;">ROOM ID</p>
          <p style="color: #fff; font-size: 24px; font-weight: 900; letter-spacing: 2px; font-family: monospace;">${escapeHtml(roomId)}</p>
        </div>
        <div>
          <p style="color: #888; font-size: 11px; text-transform: uppercase; margin-bottom: 6px;">PASSWORD</p>
          <p style="color: #fff; font-size: 24px; font-weight: 900; letter-spacing: 2px; font-family: monospace;">${escapeHtml(roomPassword)}</p>
        </div>
      </div>
      <p style="color: #ff4444; font-size: 11px; margin-top: 16px;">Screenshot these details!</p>
    </div>
  ` : `
    <div style="background: #0f0f0f; border-radius: 10px; padding: 16px; margin: 20px 0; color: #888;">
      ⏳ Room details will be shared by admin before match
    </div>
  `;

  overlay.innerHTML = `
    <div style="
      background: #111;
      border: 2px solid #00ff88;
      border-radius: 16px;
      padding: 32px;
      max-width: 420px;
      width: 100%;
      text-align: center;
      font-family: 'Rajdhani', sans-serif;
    ">
      <div style="
        width: 64px;
        height: 64px;
        background: #00ff88;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 32px;
        color: #000;
        margin: 0 auto 16px;
      ">✓</div>
      
      <h2 style="color: #00ff88; margin: 0 0 8px; font-size: 24px;">Payment Verified!</h2>
      <p style="color: #fff; margin-bottom: 10px;">Your spot in <strong>${escapeHtml(tournamentName)}</strong> is confirmed.</p>
      
      ${paymentId ? `
      <div style="background: #0f0f0f; padding: 10px; border-radius: 8px; margin: 10px 0;">
        <span style="color: #888; font-size: 11px;">Transaction ID:</span>
        <span style="color: #ffd700; font-family: monospace; font-size: 12px; margin-left: 8px;">${escapeHtml(paymentId)}</span>
      </div>
      ` : ''}

      ${roomSection}

      <button onclick="handleUserConfirmation()" style="
        width: 100%;
        padding: 16px;
        background: #00ff88;
        color: #000;
        border: none;
        border-radius: 10px;
        font-size: 16px;
        font-weight: 700;
        cursor: pointer;
        font-family: 'Rajdhani', sans-serif;
        margin-top: 10px;
      ">✅ Confirm &amp; Continue</button>
      <button onclick="handleDismissWithoutConfirm()" style="
        width: 100%;
        padding: 10px;
        background: transparent;
        color: #666;
        border: 1px solid #333;
        border-radius: 10px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        font-family: 'Rajdhani', sans-serif;
        margin-top: 8px;
      ">⏰ Remind Me Later (Save to Notifications)</button>
    </div>
  `;

  document.body.appendChild(overlay);
  // ✅ FIX: Lock body scroll while overlay is visible (matches closePaymentOverlay unlock)
  document.body.style.overflow = 'hidden';
}

// ============================================
// DISMISS WITHOUT CONFIRMING — Sends fallback notification
// ============================================
window.handleDismissWithoutConfirm = async function() {
  closePaymentOverlay();

  // Write a reminder notification to the user's inbox so they can come back
  try {
    if (_currentUserId && _currentTournamentId) {
      const { doc: firestoreDoc, addDoc: firestoreAddDoc, collection, serverTimestamp: sTs } =
        await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
      const { db: firestoreDb } = await import('./js/firebase.js');
      await firestoreAddDoc(collection(firestoreDb, 'users', _currentUserId, 'notifications'), {
        type: 'confirm_and_continue',
        title: '✅ Payment Verified — Confirm Your Slot!',
        message: 'Your payment was verified! Tap here to confirm your participation and complete registration.',
        tournamentId: _currentTournamentId,
        read: false,
        popupShown: false,
        createdAt: sTs()
      });
    }
  } catch (e) {
    console.warn('[PAYMENT] Could not save reminder notification:', e);
  }
};

// ============================================
// USER CONFIRMATION
// ============================================
window.handleUserConfirmation = async function() {
  try {
    if (_currentUserId && _currentTournamentId) {
      await updateDoc(
        doc(db, 'tournaments', _currentTournamentId, 'participants', _currentUserId),
        {
          confirmationReceived: true,
          confirmedAt: serverTimestamp()
        }
      );
    }
  } catch (error) {
    console.warn('[PAYMENT] Confirmation error:', error);
  }
  closePaymentOverlay();
};

// ============================================
// CLOSE OVERLAY
// ============================================
window.closePaymentOverlay = function() {
  _successScreenShowing = false; // ✅ FIX: Reset guard so next payment works normally
  document.getElementById('paymentOverlay')?.remove();
  // ✅ FIX: Restore scroll after payment overlay is closed
  document.body.style.overflow = '';
  if (unsubPayment) {
    unsubPayment();
    unsubPayment = null;
  }
};

// ============================================
// UTILITIES
// ============================================
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function showToast(message, type = "success") {
  const colors = { success: "#00ff88", error: "#ff4444", warning: "#ffd700" };
  const color = colors[type] || colors.success;
  
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #1a1a1a;
    border: 1px solid ${color};
    color: ${color};
    padding: 14px 20px;
    border-radius: 10px;
    font-size: 14px;
    z-index: 99999;
    max-width: 340px;
    animation: fadeInUp 0.3s ease;
    font-weight: 600;
    font-family: 'Rajdhani', sans-serif;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// Attach to window so HTML onclick can find it
window.submitUtrVerification = submitUtrVerification;

payLog("[PAYMENT] Secured paymentStage.js v4.2 initialized.");