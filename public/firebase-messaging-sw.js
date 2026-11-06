// 1. Use importScripts for Service Workers (Safe across all browsers)
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// 2. Initialize the Firebase app
firebase.initializeApp({
    apiKey: "AIzaSyAVmkZLnhoxR15k3OxK5ApcxzKz5zFm2SI",
    authDomain: "npc-esports-c3adb.firebaseapp.com",
    projectId: "npc-esports-c3adb",
    storageBucket: "npc-esports-c3adb.firebasestorage.app",
    messagingSenderId: "404452164488",
    appId: "1:404452164488:web:03179cbf527d28a3b6303d"
});

// 3. Get instances
const messaging = firebase.messaging();
const db = firebase.firestore();

let lastShownBroadcastId = null;

// Helper to check for recent broadcast notifications even if browser tab is closed
async function checkRecentBroadcasts() {
    try {
        const snap = await db.collection('broadcastNotifications')
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();

        if (!snap.empty) {
            const doc = snap.docs[0];
            const data = doc.data();
            const id = doc.id;

            if (lastShownBroadcastId === id) return;

            // Check if created in the last 60 minutes
            if (data.createdAt && data.createdAt.toDate) {
                const ageMs = Date.now() - data.createdAt.toDate().getTime();
                if (ageMs > 60 * 60 * 1000) return;
            }

            lastShownBroadcastId = id;

            if (self.registration) {
                self.registration.showNotification(data.title || "NPC Esports Announcement", {
                    body: data.message || "New tournament update available!",
                    icon: "/logo.png",
                    badge: "/logo.png",
                    requireInteraction: true,
                    tag: "npc-blast-" + id,
                    data: { url: "/" }
                });
            }
        }
    } catch (e) {
        console.warn('[SW Background Check]', e);
    }
}

// 4. Handle background push notifications from FCM
messaging.onBackgroundMessage((payload) => {
    console.log('[FCM SW] Background message received:', payload);

    const { title, body, icon } = payload.notification || payload.data || {};

    const notificationOptions = {
        body: body || "You have a new notification!",
        icon: icon || "/logo.png",
        badge: "/logo.png",
        requireInteraction: true,
        tag: "npc-push-" + Date.now(),
        data: payload.data
    };

    if (self.registration) {
        self.registration.showNotification(title || "NPC Esports", notificationOptions);
    }
});

// 5. Catch standard Web Push events
self.addEventListener('push', (event) => {
    if (event.data) {
        try {
            const payload = event.data.json();
            const { title, body, icon } = payload.notification || payload.data || {};
            const opt = {
                body: body || payload.message || "New announcement!",
                icon: icon || "/logo.png",
                badge: "/logo.png",
                requireInteraction: true,
                tag: "npc-webpush-" + Date.now()
            };
            event.waitUntil(self.registration.showNotification(title || "NPC Esports", opt));
            return;
        } catch (e) {}
    }
    event.waitUntil(checkRecentBroadcasts());
});

// 6. Handle periodic background sync (runs in background when tabs are closed)
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'check-broadcasts') {
        event.waitUntil(checkRecentBroadcasts());
    }
});

self.addEventListener('sync', (event) => {
    if (event.tag === 'check-broadcasts') {
        event.waitUntil(checkRecentBroadcasts());
    }
});

// 7. Handle messages from client tabs
self.addEventListener('message', (event) => {
    if (event.data === 'check-broadcasts') {
        checkRecentBroadcasts();
    }
});

// 8. Handle notification click
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes('index.html') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});