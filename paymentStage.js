// =====================================================
// paymentStage.js (v4 - Fixed for NPC Esports)
// =====================================================

import { db, auth } from './firebase.js';
import {
  doc, onSnapshot, updateDoc, serverTimestamp, getDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Variables
let unsubPayment = null;
let _currentTournamentId = null;
let _currentUserId = null;

// ⚠️ YOUR RAZORPAY KEY ID
const RAZORPAY_KEY_ID = "rzp_test_SjOd3aCMehTIGa"; // Make sure this is correct!

// ============================================
// MAIN ENTRY POINT - Called from main.js
// ============================================
export function enterPaymentStage(userId, tournamentId, tournamentName) {
  console.log("[PAYMENT] Entering payment stage for:", tournamentId);
  
  _currentUserId = userId;
  _currentTournamentId = tournamentId;

  if (unsubPayment) unsubPayment();

  // Listen for real-time payment status
  const participantRef = doc(db, 'tournaments', tournamentId, 'participants', userId);
  
  unsubPayment = onSnapshot(participantRef, (snap) => {
    const data = snap.data();
    console.log("[PAYMENT] Status update:", data?.paymentStatus);
    if (!data) return;
    renderPaymentUI(data, tournamentName, tournamentId);
  });

  // Initial render
  renderPaymentUI({ paymentStatus: 'pending' }, tournamentName, tournamentId);
}

// ============================================
// PAY BUTTON CLICKED
// ============================================
async function startRazorpayPayment(tournamentId) {
  console.log("[PAYMENT] Pay button clicked for:", tournamentId);
  
  const btn = document.getElementById('payBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Please wait...";
  }

  try {
    // Get tournament entry fee
    const tSnap = await getDoc(doc(db, 'tournaments', tournamentId));
    if (!tSnap.exists()) {
      alert("Tournament not found!");
      return;
    }

    const tournament = tSnap.data();
    const entryFee = tournament.entryFee || 0;

    console.log("[PAYMENT] Entry fee:", entryFee);

    if (entryFee <= 0) {
      alert("Invalid entry fee!");
      return;
    }

    // Open Razorpay
    openRazorpayCheckout(tournamentId, entryFee, tournament.title);

  } catch (error) {
    console.error("[PAYMENT] Error:", error);
    alert("Error preparing payment: " + error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Pay Securely with Razorpay";
    }
  }
}

// ============================================
// OPEN RAZORPAY POPUP
// ============================================
function openRazorpayCheckout(tournamentId, amount, tournamentName) {
  console.log("[PAYMENT] Opening Razorpay checkout:", amount);

  // Create unique order ID
  const orderId = "order_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);

  const options = {
    key: RAZORPAY_KEY_ID,
    amount: amount * 100, // Razorpay works in PAISE (100 = ₹1)
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
      confirmClose: true,
      ondismiss: function() {
        console.log("[PAYMENT] Payment popup closed");
        showToast("Payment cancelled", "warning");
      }
    },
    handler: async function(response) {
      console.log("[PAYMENT] Payment success:", response);
      await handlePaymentSuccess(tournamentId, response);
    }
  };

  try {
    console.log("[PAYMENT] Creating Razorpay instance...");
    const rzp = new Razorpay(options);
    
    rzp.on("payment.failed", function(response) {
      console.error("[PAYMENT] Payment failed:", response.error);
      showToast(`Payment failed: ${response.error.description}`, "error");
    });

    console.log("[PAYMENT] Opening popup...");
    rzp.open();
    
  } catch (error) {
    console.error("[PAYMENT] Razorpay error:", error);
    showToast("Error opening payment: " + error.message, "error");
  }
}

// ============================================
// HANDLE PAYMENT SUCCESS
// ============================================
async function handlePaymentSuccess(tournamentId, response) {
  console.log("[PAYMENT] Handling success:", response);

  const btn = document.getElementById('payBtn');
  if (btn) {
    btn.textContent = "Verifying...";
    btn.disabled = true;
  }

  try {
    const { razorpay_payment_id, razorpay_order_id } = response;

    // Update Firestore
    await updateDoc(
      doc(db, 'tournaments', tournamentId, 'participants', _currentUserId),
      {
        paymentStatus: 'verified',
        razorpayPaymentId: razorpay_payment_id,
        razorpayOrderId: razorpay_order_id,
        paidAt: serverTimestamp()
      }
    );

    showToast("✅ Payment Verified!", "success");

    // Let the listener update the UI
    setTimeout(() => {
      closePaymentOverlay();
    }, 2000);

  } catch (error) {
    console.error("[PAYMENT] Verification error:", error);
    showToast("Payment recorded but verification pending", "warning");
  }
}

// ============================================
// RENDER PAYMENT UI
// ============================================
function renderPaymentUI(data, tournamentName, tournamentId) {
  // Remove existing overlay
  document.getElementById('paymentOverlay')?.remove();

  const { paymentStatus, roomId, roomPassword, razorpayPaymentId } = data;

  // If verified, show success screen
  if (paymentStatus === 'verified') {
    renderSuccessScreen(tournamentName, roomId, roomPassword, razorpayPaymentId);
    return;
  }

  // Create overlay
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
        <span id="paymentAmount" style="color: #00ff88; font-size: 22px; font-weight: 900;">Loading...</span>
      </div>

      <button id="payBtn" onclick="startRazorpayPayment('${tournamentId}')" style="
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
        Pay Securely with Razorpay
      </button>
      
      <p style="color: #555; font-size: 12px; margin-top: 14px;">
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
    console.error("[PAYMENT] Error loading details:", error);
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
      ">✅ Confirm & Continue</button>
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
    console.warn('[PAYMENT] Confirmation error:', error);
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

// ============================================
// MAKE startRazorpayPayment GLOBAL
// ============================================
// Attach to window so HTML onclick can find it
window.startRazorpayPayment = startRazorpayPayment;

console.log("[PAYMENT] paymentStage.js loaded!");
