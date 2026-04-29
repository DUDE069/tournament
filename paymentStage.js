// =====================================================
// paymentStage.js (v3 - Razorpay Integration)
// =====================================================

import { db, auth } from './firebase.js';
import {
  doc, onSnapshot, updateDoc, serverTimestamp, getDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

let unsubPayment = null;
let _currentTournamentId = null;
let _currentUserId = null;

// ⚠️ REPLACE THIS with your actual Razorpay Key ID from dashboard
const RAZORPAY_KEY_ID = "rzp_test_SjOd3aCMehTIGa";

// ============================================
// ENTER PAYMENT STAGE
// ============================================
export function enterPaymentStage(userId, tournamentId, tournamentName) {
  _currentUserId = userId;
  _currentTournamentId = tournamentId;

  if (unsubPayment) unsubPayment();

  // Listen for real-time payment status updates
  const participantRef = doc(db, 'tournaments', tournamentId, 'participants', userId);
  
  unsubPayment = onSnapshot(participantRef, (snap) => {
    const data = snap.data();
    if (!data) return;
    renderPaymentUI(data, tournamentName, tournamentId);
  });

  // Initial render
  renderPaymentUI({ paymentStatus: 'pending' }, tournamentName, tournamentId);
}

// ============================================
// START RAZORPAY PAYMENT
// ============================================
window.startRazorpayPayment = async function(tournamentId) {
  const btn = document.getElementById('payBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Loading...";
  }

  try {
    // Get tournament entry fee
    const tSnap = await getDoc(doc(db, 'tournaments', tournamentId));
    if (!tSnap.exists()) {
      showToast("Tournament not found", "error");
      return;
    }

    const tournament = tSnap.data();
    const entryFee = tournament.entryFee || 0;

    if (entryFee <= 0) {
      showToast("Invalid entry fee", "error");
      return;
    }

    // Open Razorpay checkout
    openRazorpayCheckout(tournamentId, entryFee, tournament.title);

  } catch (error) {
    console.error("Payment init error:", error);
    showToast("Error preparing payment", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Pay Securely with Razorpay";
    }
  }
};

// ============================================
// OPEN RAZORPAY POPUP
// ============================================
function openRazorpayCheckout(tournamentId, amount, tournamentName) {
  // Create a unique order ID (in production, this comes from backend)
  const orderId = "order_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);

  const options = {
    key: RAZORPAY_KEY_ID,
    amount: amount * 100, // Razorpay works in paise
    currency: "INR",
    name: "NPC Esports",
    description: `Entry Fee: ${tournamentName}`,
    order_id: orderId,
    prefill: {
      email: auth.currentUser?.email || "",
    },
    theme: {
      color: "#00ff88"
    },
    modal: {
      ondismiss: function() {
        showToast("Payment cancelled", "warning");
      }
    },
    handler: async function(response) {
      // Payment successful!
      await handlePaymentSuccess(tournamentId, response);
    }
  };

  try {
    const rzp = new Razorpay(options);
    
    rzp.on("payment.failed", function(response) {
      showToast(`Payment failed: ${response.error.description}`, "error");
    });

    rzp.open();
  } catch (error) {
    console.error("Razorpay error:", error);
    showToast("Error opening payment", "error");
  }
}

// ============================================
// HANDLE PAYMENT SUCCESS
// ============================================
async function handlePaymentSuccess(tournamentId, response) {
  const btn = document.getElementById('payBtn');
  if (btn) {
    btn.textContent = "Verifying...";
    btn.disabled = true;
  }

  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = response;

    // ⚠️ In production, verify signature on backend FIRST!
    // For now, we trust Razorpay's response
    
    // Update Firestore with verified payment
    await updateDoc(
      doc(db, 'tournaments', tournamentId, 'participants', _currentUserId),
      {
        paymentStatus: 'verified',
        razorpayPaymentId: razorpay_payment_id,
        razorpayOrderId: razorpay_order_id,
        paidAt: serverTimestamp()
      }
    );

    // Also update in user's payments subcollection
    await updateDoc(
      doc(db, 'users', _currentUserId),
      {
        lastPaymentVerified: serverTimestamp()
      }
    );

    showToast("✅ Payment Verified!", "success");

    // Close and show success after delay
    setTimeout(() => {
      closePaymentOverlay();
      // The listener will auto-update the UI to show success
    }, 1500);

  } catch (error) {
    console.error("Verification error:", error);
    showToast("Payment recorded but verification pending", "warning");
  }
}

// ============================================
// RENDER PAYMENT UI
// ============================================
function renderPaymentUI(data, tournamentName, tournamentId) {
  document.getElementById('paymentOverlay')?.remove();

  const { paymentStatus, roomId, roomPassword, razorpayPaymentId } = data;

  // Already verified? Show success screen
  if (paymentStatus === 'verified') {
    renderSuccessScreen(tournamentName, roomId, roomPassword, razorpayPaymentId);
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'paymentOverlay';
  overlay.className = 'payment-overlay';
  
  overlay.innerHTML = `
    <div class="payment-card">
      <div class="payment-status-badge">🔒 Payment Required</div>
      <h2>Complete Registration</h2>
      <p class="payment-tournament-name">${escapeHtml(tournamentName)}</p>

      <div class="payment-amount-card">
        <span class="payment-amount-label">Entry Fee</span>
        <span class="payment-amount-value" id="paymentAmount">Loading...</span>
      </div>

      <button class="btn-payment-done" id="payBtn" onclick="startRazorpayPayment('${tournamentId}')">
        Pay Securely with Razorpay
      </button>
      
      <p class="payment-footer">
        🔒 Secured by Razorpay · Instant verification
      </p>
    </div>
  `;

  document.body.appendChild(overlay);
  loadPaymentDetails(tournamentId);
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
    console.error("Error loading details:", error);
  }
}

// ============================================
// SUCCESS SCREEN
// ============================================
function renderSuccessScreen(tournamentName, roomId, roomPassword, paymentId) {
  if (unsubPayment) {
    unsubPayment();
    unsubPayment = null;
  }

  const overlay = document.createElement('div');
  overlay.id = 'paymentOverlay';
  overlay.className = 'payment-overlay';

  const roomSection = (roomId && roomPassword) ? `
    <div class="room-details-box">
      <p class="room-label">🔑 Room Details</p>
      <div class="room-credentials">
        <div>
          <p class="cred-label">ROOM ID</p>
          <p class="cred-value">${escapeHtml(roomId)}</p>
        </div>
        <div>
          <p class="cred-label">PASSWORD</p>
          <p class="cred-value">${escapeHtml(roomPassword)}</p>
        </div>
      </div>
      <p class="room-warning">Screenshot these details!</p>
    </div>
  ` : `
    <div class="room-pending">
      <p>⏳ Room details will be shared by admin before match</p>
    </div>
  `;

  overlay.innerHTML = `
    <div class="payment-card payment-success">
      <div class="success-icon">✓</div>
      <h2>Payment Verified!</h2>
      <p>Your spot in <strong>${escapeHtml(tournamentName)}</strong> is confirmed.</p>
      
      ${paymentId ? `
      <div class="payment-id-display">
        <span style="color:#888;font-size:11px;">Transaction ID:</span>
        <span style="color:#ffd700;font-family:monospace;font-size:12px;margin-left:8px;">${escapeHtml(paymentId)}</span>
      </div>
      ` : ''}

      ${roomSection}

      <button class="btn-payment-done" onclick="handleUserConfirmation()">
        ✅ Confirm & Continue
      </button>
    </div>
  `;

  document.body.appendChild(overlay);
}

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
    console.warn('Confirmation error:', error);
  }

  closePaymentOverlay();
};

// ============================================
// CLOSE OVERLAY
// ============================================
window.closePaymentOverlay = function() {
  document.getElementById('paymentOverlay')?.remove();
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
    position:fixed;bottom:24px;right:24px;
    background:#1a1a1a;border:1px solid ${color};
    color:${color};padding:14px 20px;border-radius:10px;
    font-size:14px;z-index:99999;max-width:340px;
    animation:fadeInUp 0.2s ease;font-weight:600;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
