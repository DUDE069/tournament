// =============================================================================
//  paymentStage.js  (v2)
//  FILE: paymentStage.js  →  TOURNAMENT WEBSITE (main site only)
// =============================================================================
//
//  WHAT'S NEW in v2:
//  • Room ID & Password shown in bold/highlighted ONLY after paymentStatus
//    is "verified" (admin confirmed payment).
//  • "Confirm" button on success screen writes confirmationReceived:true
//    to the participant doc → updates Stage 5 in the admin progress tracker.
//  • escapeHtml used throughout for safety.
//  • unsubPayment cleaned up properly on overlay close.
//
// =============================================================================

import { db } from './firebase.js';
import { markConfirmationReceived } from './notificationService.js';
import {
  doc, onSnapshot, updateDoc, serverTimestamp, getDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

let unsubPayment = null;
let _currentTournamentId = null;
let _currentUserId       = null;

/**
 * Enter the payment stage for a user.
 * Called from main.js when verification status === 'approved'.
 */
export function enterPaymentStage(userId, tournamentId, tournamentName) {
  _currentUserId       = userId;
  _currentTournamentId = tournamentId;

  if (unsubPayment) unsubPayment();

  const participantRef = doc(db, 'tournaments', tournamentId, 'participants', userId);
  unsubPayment = onSnapshot(participantRef, (snap) => {
    const data = snap.data();
    if (!data) return;
    renderPaymentUI(data, tournamentName, tournamentId);
  });

  renderPaymentUI({ paymentStatus: 'pending' }, tournamentName, tournamentId);
}

// ── Main render ───────────────────────────────────────────────────────────────
function renderPaymentUI(data, tournamentName, tournamentId) {
  document.getElementById('paymentOverlay')?.remove();

  const { paymentStatus, roomId, roomPassword } = data;

  // Stage 4 = payment verified → show room details + confirm button
  if (paymentStatus === 'verified') {
    renderPaymentSuccess(tournamentName, tournamentId, roomId, roomPassword);
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'paymentOverlay';
  overlay.className = 'payment-overlay';
  overlay.innerHTML = `
    <div class="payment-card">
      <div class="payment-status-badge ${paymentStatus === 'failed' ? 'failed' : 'pending'}">
        ${paymentStatus === 'failed' ? '⚠ Payment Failed' : '🔒 Payment Required'}
      </div>

      <h2>Complete Your Registration</h2>
      <p class="payment-tournament-name">${escapeHtml(tournamentName)}</p>

      ${paymentStatus === 'failed' ? `
        <div class="payment-error-box">
          Your previous payment attempt failed. Please try again or contact support.
        </div>` : ''}

      <div class="payment-steps">
        <div class="payment-step done"><span class="step-dot">✓</span><span>Team submitted</span></div>
        <div class="payment-step done"><span class="step-dot">✓</span><span>Verification approved</span></div>
        <div class="payment-step active"><span class="step-dot">3</span><span>Payment</span></div>
        <div class="payment-step"><span class="step-dot">4</span><span>Confirmed</span></div>
      </div>

      <div class="payment-amount-card">
        <span class="payment-amount-label">Entry fee</span>
        <span class="payment-amount-value" id="paymentAmount">Loading…</span>
      </div>

      <div class="payment-instructions">
        <p>Send payment to the following UPI ID or scan the QR code:</p>
        <div class="payment-upi-id" id="paymentUpiId">Loading…</div>
        <p class="payment-note">
          After payment, send your transaction screenshot to our WhatsApp/Discord.
          Admin will confirm within 24 hours.
        </p>
      </div>

      <div class="payment-actions">
        <button class="btn-payment-done" onclick="userConfirmsPaymentSent()">
          I've Sent the Payment
        </button>
      </div>

      <p class="payment-footer">
        Having trouble? <a href="#" onclick="openSupportChat()">Contact support</a>
      </p>
    </div>`;

  document.body.appendChild(overlay);
  loadPaymentDetails(tournamentId);
}

// ── Load entry fee & UPI from Firestore ───────────────────────────────────────
async function loadPaymentDetails(tournamentId) {
  try {
    const tSnap = await getDoc(doc(db, 'tournaments', tournamentId));
    const amountEl = document.getElementById('paymentAmount');
    const upiEl    = document.getElementById('paymentUpiId');
    if (tSnap.exists()) {
      const t = tSnap.data();
      if (amountEl) amountEl.textContent = `₹ ${t.entryFee ?? '—'}`;
      if (upiEl)    upiEl.textContent    = t.paymentUpi ?? 'yourname@upi';
    } else {
      if (amountEl) amountEl.textContent = '₹ —';
      if (upiEl)    upiEl.textContent    = 'yourname@upi';
    }
  } catch (_) {
    const amountEl = document.getElementById('paymentAmount');
    if (amountEl) amountEl.textContent = '₹ —';
  }
}

// ── Success screen — shows Room ID & Password + Confirm button ────────────────
function renderPaymentSuccess(tournamentName, tournamentId, roomId, roomPassword) {
  const overlay = document.createElement('div');
  overlay.id = 'paymentOverlay';
  overlay.className = 'payment-overlay';

  // Room details section — shown in bold/highlighted only when verified
  const roomSection = (roomId && roomPassword) ? `
    <div style="
      background:rgba(0,255,136,.1);
      border:2px solid #00ff88;
      border-radius:12px;
      padding:18px;
      margin:18px 0;
      text-align:center;
    ">
      <p style="color:#00ff88;font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;">🔑 Room Details</p>
      <div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap;">
        <div>
          <p style="color:#888;font-size:11px;margin-bottom:4px;">ROOM ID</p>
          <p style="color:#fff;font-size:22px;font-weight:900;letter-spacing:3px;">${escapeHtml(roomId)}</p>
        </div>
        <div>
          <p style="color:#888;font-size:11px;margin-bottom:4px;">PASSWORD</p>
          <p style="color:#fff;font-size:22px;font-weight:900;letter-spacing:3px;">${escapeHtml(roomPassword)}</p>
        </div>
      </div>
      <p style="color:#888;font-size:11px;margin-top:12px;">Screenshot or note these down. Do NOT share.</p>
    </div>` : `
    <div style="background:#1a1a1a;border-radius:10px;padding:14px;margin:18px 0;text-align:center;">
      <p style="color:#888;font-size:13px;">⏳ Room details will appear here once ready</p>
    </div>`;

  overlay.innerHTML = `
    <div class="payment-card payment-success">
      <div class="success-icon">✓</div>
      <h2>Payment Verified!</h2>
      <p>Your spot in <strong>${escapeHtml(tournamentName)}</strong> is confirmed.</p>

      ${roomSection}

      <button
        class="btn-payment-done"
        id="confirmBtn"
        onclick="handleUserConfirmation('${tournamentId}')"
        style="margin-top:8px;">
        ✅ Confirm & Go to Dashboard
      </button>

      <p class="payment-footer">Check your notifications for match updates.</p>
    </div>`;

  document.body.appendChild(overlay);

  if (unsubPayment) { unsubPayment(); unsubPayment = null; }
}

// ── User confirms receipt of room details (Stage 5) ───────────────────────────
window.handleUserConfirmation = async function(tournamentId) {
  const btn = document.getElementById('confirmBtn');
  if (btn) { btn.textContent = 'Confirming…'; btn.disabled = true; }

  try {
    if (_currentUserId && tournamentId) {
      await markConfirmationReceived(tournamentId, _currentUserId);
    }
  } catch (e) {
    console.warn('Confirmation write failed:', e.message);
  }

  closePaymentOverlay();
};

// ── User claims they sent payment (optimistic UI) ─────────────────────────────
window.userConfirmsPaymentSent = async function() {
  const btn = document.querySelector('.btn-payment-done');
  if (btn) { btn.textContent = 'Waiting for admin confirmation…'; btn.disabled = true; }
  // Optionally write a flag so admin knows user claims they paid
  try {
    if (_currentUserId && _currentTournamentId) {
      await updateDoc(
        doc(db, 'tournaments', _currentTournamentId, 'participants', _currentUserId),
        { userClaimedPayment: true, userClaimedAt: serverTimestamp() }
      );
    }
  } catch (_) {}
};

window.closePaymentOverlay = function() {
  document.getElementById('paymentOverlay')?.remove();
  if (unsubPayment) { unsubPayment(); unsubPayment = null; }
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}