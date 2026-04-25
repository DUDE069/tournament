// =============================================================================
//  notificationService.js  (v2)
//  FILE: notificationService.js  →  SHARED (used by both admin and main site)
// =============================================================================
//
//  WHAT'S NEW:
//  • markConfirmationReceived() — called when user clicks "Confirm" button
//    after receiving room details. Sets confirmationReceived:true on the
//    participant doc, which updates Stage 5 in the admin's progress tracker.
//  • All existing functions unchanged.
//
// =============================================================================

import { db } from './firebase.js';
import {
  collection, addDoc, serverTimestamp,
  query, orderBy, onSnapshot,
  doc, updateDoc, getDocs, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

/**
 * Write a notification to a user's subcollection.
 * Called from admin.js after approve/reject/payment/room actions.
 */
export async function sendNotification(userId, { type, title, message, tournamentId, tournamentName, extra = {} }) {
  const ref = collection(db, 'users', userId, 'notifications');
  await addDoc(ref, {
    type,
    title:          title ?? message,
    message,
    tournamentId:   tournamentId ?? null,
    tournamentName: tournamentName ?? null,
    ...extra,
    read:       false,
    popupShown: false,
    timestamp:  serverTimestamp(),
    createdAt:  serverTimestamp(),
  });
}

/**
 * Subscribe to a user's notifications in real-time.
 * Returns unsubscribe function.
 */
export function subscribeToNotifications(userId, onUpdate) {
  const q = query(
    collection(db, 'users', userId, 'notifications'),
    orderBy('createdAt', 'desc')
  );
  return onSnapshot(q, (snap) => {
    const notifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    onUpdate(notifs);
  });
}

/**
 * Mark a single notification as read.
 */
export async function markAsRead(userId, notifId) {
  await updateDoc(doc(db, 'users', userId, 'notifications', notifId), { read: true });
}

/**
 * Mark all notifications as read.
 */
export async function markAllRead(userId) {
  const snap = await getDocs(collection(db, 'users', userId, 'notifications'));
  const batch = writeBatch(db);
  snap.docs.forEach(d => {
    if (!d.data().read) batch.update(d.ref, { read: true });
  });
  await batch.commit();
}

/**
 * USER CONFIRMATION SYSTEM (Stage 5)
 * Called when user clicks "Confirm" after receiving room details.
 * Sets confirmationReceived:true on the participant doc, which
 * updates Stage 5 in the admin's progress tracker in real-time.
 *
 * @param {string} tournamentId
 * @param {string} userId        — the participant/leader user ID
 */
export async function markConfirmationReceived(tournamentId, userId) {
  await updateDoc(
    doc(db, 'tournaments', tournamentId, 'participants', userId),
    {
      confirmationReceived:   true,
      confirmationReceivedAt: serverTimestamp(),
    }
  );
}