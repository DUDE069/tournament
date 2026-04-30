// notificationService.js

let messaging = null;
let notificationPermissionGranted = false;

// 1. REQUEST BROWSER NOTIFICATION PERMISSION
export async function requestNotificationPermission() {
    if (!("Notification" in window)) {
        console.log("[NOTIF] Browser doesn't support notifications");
        return false;
    }

    if (Notification.permission === "granted") {
        notificationPermissionGranted = true;
        return true;
    }

    try {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
            notificationPermissionGranted = true;
            console.log("[NOTIF] ✅ Permission granted!");
            return true;
        }
        return false;
    } catch (error) {
        console.error("[NOTIF] Error requesting permission:", error);
        return false;
    }
}

// 2. INITIALIZE FCM
export async function initializeFCM(app) {
    if (!notificationPermissionGranted) {
        console.log("[FCM] Skipping - no browser permission");
        return null;
    }

    try {
        // Import messaging functions
        const { getMessaging, getToken, onMessage } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js');
        
        // Pass the app instance to getMessaging
        messaging = getMessaging(app);

        if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
            console.log("[FCM] Service worker registered");
        }

        // ⚠️ REPLACE WITH YOUR ACTUAL VAPID KEY
        const VAPID_KEY = "YOUR_VAPID_KEY_HERE"; 

        const token = await getToken(messaging, { vapidKey: VAPID_KEY });

        if (token) {
            console.log("[FCM] ✅ FCM Token generated");
            
            // Setup Foreground Listener immediately after getting token
            listenForForegroundMessages(messaging, onMessage);
            
            return token;
        }
    } catch (error) {
        console.warn("[FCM] Initialization failed:", error);
    }

    return null;
}

// 3. SAVE FCM TOKEN
async function saveFCMToken(token, db, auth) {
    if (!auth.currentUser) return;

    try {
        const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        await updateDoc(doc(db, "users", auth.currentUser.uid), {
            fcmToken: token,
            fcmTokenUpdated: new Date().toISOString()
        });
        console.log("[FCM] Token saved to user profile");
    } catch (error) {
        console.error("[FCM] Error saving token:", error);
    }
}

// 4. LISTEN FOR FOREGROUND MESSAGES
function listenForForegroundMessages(messaging, onMessage) {
    onMessage(messaging, (payload) => {
        console.log("[FCM] Foreground message received:", payload);

        const { title, body } = payload.notification || payload.data || {};

        if (Notification.permission === "granted") {
            new Notification(title || "NPC Esports", {
                body: body || "New notification",
                icon: "/logo.png"
            });
        }

        // Show your custom in-app popup (assuming showPopup is globally available from main.js)
        if (typeof window.showPopup === 'function' && body) {
            window.showPopup("success", body, "View", () => {
                document.getElementById('customPopup')?.remove();
            });
        }
    });
}

// 5. MAIN SETUP FUNCTION
export async function setupNotifications(app, db, auth) {
    console.log("[NOTIF] Setting up notifications...");

    const granted = await requestNotificationPermission();
    if (!granted) {
        return { enabled: false, reason: "permission_denied" };
    }

    // Pass 'app' down to initialization
    const token = await initializeFCM(app);

    if (token) {
        await saveFCMToken(token, db, auth);
    }

    return { enabled: true, token: token };
}