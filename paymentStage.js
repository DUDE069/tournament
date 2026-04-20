// paymentStage.js — loaded in main.js

import { db } from './firebase.js';
import { sendNotification } from './notificationService.js';
import {
  doc, onSnapshot, updateDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.x.x/firebase-firestore.js';

let unsubPayment = null;

/**
 * Called from your onSnapshot verification listener when status === 'approved'.
 * Replaces the old "show popup" behaviour.
 */
export function enterPaymentStage(userId, tournamentId, tournamentName) {
  // Clean up any existing listener
  if (unsubPayment) unsubPayment();

  // Listen to participant's paymentStatus in real-time
  const participantRef = doc(db, 'tournaments', tournamentId, 'participants', userId);
  unsubPayment = onSnapshot(participantRef, (snap) => {
    const data = snap.data();
    if (!data) return;
    renderPaymentUI(data.paymentStatus, tournamentName);
  });

  // Show the payment overlay immediately
  renderPaymentUI('pending', tournamentName);
}

function renderPaymentUI(paymentStatus, tournamentName) {
  // Remove existing overlay
  document.getElementById('paymentOverlay')?.remove();

  if (paymentStatus === 'paid') {
    renderPaymentSuccess(tournamentName);
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'paymentOverlay';
  overlay.className = 'payment-overlay';
  overlay.innerHTML = `
    <div class="payment-card">
      <div class="payment-status-badge ${paymentStatus}">
        ${paymentStatus === 'failed' ? '⚠ Payment Failed' : '🔒 Payment Required'}
      </div>

      <h2>Complete Your Registration</h2>
      <p class="payment-tournament-name">${escapeHtml(tournamentName)}</p>

      ${paymentStatus === 'failed' ? `
        <div class="payment-error-box">
          Your previous payment attempt failed. Please try again or contact support.
        </div>` : ''}

      <div class="payment-steps">
        <div class="payment-step done">
          <span class="step-dot">✓</span>
          <span>Team submitted</span>
        </div>
        <div class="payment-step done">
          <span class="step-dot">✓</span>
          <span>Verification approved</span>
        </div>
        <div class="payment-step active">
          <span class="step-dot">3</span>
          <span>Payment</span>
        </div>
        <div class="payment-step">
          <span class="step-dot">4</span>
          <span>Confirmed</span>
        </div>
      </div>

      <div class="payment-amount-card">
        <span class="payment-amount-label">Entry fee</span>
        <span class="payment-amount-value" id="paymentAmount">Loading...</span>
      </div>

      <div class="payment-instructions">
        <p>Send payment to the following UPI ID or scan the QR code:</p>
        <div class="payment-upi-id" id="paymentUpiId">Loading...</div>
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
    </div>
  `;
  document.body.appendChild(overlay);

  // Load tournament payment details
  loadPaymentDetails();
}

async function loadPaymentDetails() {
  // Fetch from your tournament doc (add paymentUpi + entryFee fields to tournaments/{id})
  // For now, a sensible fallback:
  const amountEl = document.getElementById('paymentAmount');
  const upiEl = document.getElementById('paymentUpiId');
  if (amountEl) amountEl.textContent = '₹ 100';          // replace with Firestore value
  if (upiEl)    upiEl.textContent = 'yourname@upi';      // replace with Firestore value
}

function renderPaymentSuccess(tournamentName) {
  const overlay = document.createElement('div');
  overlay.id = 'paymentOverlay';
  overlay.className = 'payment-overlay';
  overlay.innerHTML = `
    <div class="payment-card payment-success">
      <div class="success-icon">✓</div>
      <h2>You're In!</h2>
      <p>Your spot in <strong>${escapeHtml(tournamentName)}</strong> is confirmed.</p>
      <p class="payment-footer">Check your notifications for further details.</p>
      <button class="btn-payment-done" onclick="closePaymentOverlay()">Go to Dashboard</button>
    </div>
  `;
  document.body.appendChild(overlay);
  if (unsubPayment) { unsubPayment(); unsubPayment = null; }
}

window.userConfirmsPaymentSent = async function() {
  // Optimistic UI — tell user we've noted it; admin confirms
  const btn = document.querySelector('.btn-payment-done');
  if (btn) {
    btn.textContent = 'Waiting for admin confirmation...';
    btn.disabled = true;
  }
  // You can optionally write a "userClaimedPayment: true" flag to Firestore here
};

window.closePaymentOverlay = function() {
  document.getElementById('paymentOverlay')?.remove();
  if (unsubPayment) { unsubPayment(); unsubPayment = null; }
};

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}