// notificationService.js
import { db } from './firebase.js';
import {
  collection, addDoc, serverTimestamp,
  query, orderBy, onSnapshot,
  doc, updateDoc, getDocs, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.x.x/firebase-firestore.js';

/**
 * Write a notification to a user's subcollection.
 * Call this from admin.js after approve/reject/payment actions.
 */
export async function sendNotification(userId, { type, message, tournamentId, tournamentName }) {
  const ref = collection(db, 'users', userId, 'notifications');
  await addDoc(ref, {
    type,
    message,
    tournamentId,
    tournamentName,
    read: false,
    timestamp: serverTimestamp()
  });
}

/**
 * Subscribe to a user's notifications in real-time.
 * Returns unsubscribe function.
 * onUpdate(notifications[]) is called on every change.
 */
export function subscribeToNotifications(userId, onUpdate) {
  const q = query(
    collection(db, 'users', userId, 'notifications'),
    orderBy('timestamp', 'desc')
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