// REPLACE ENTIRE firebase-messaging-sw.js WITH THIS

// 1. Use importScripts for Service Workers (Safe across all browsers)
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
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

// 3. Get the messaging instance
const messaging = firebase.messaging();

// 4. Handle background push notifications
messaging.onBackgroundMessage((payload) => {
    console.log('[FCM SW] Background message received:', payload);

    const { title, body, icon } = payload.notification || payload.data || {};

    const notificationOptions = {
        body: body || "You have a new notification!",
        icon: icon || "/logo.png",
        badge: "/logo.png",
        tag: "npc-notification",
        requireInteraction: true,
        data: payload.data
    };

    if (self.registration) {
        self.registration.showNotification(title || "NPC Esports", notificationOptions);
    }
});

// 5. Handle notification click (Keep your existing click logic!)
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