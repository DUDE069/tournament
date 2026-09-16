// ==========================================
// PUSH NOTIFICATION SOFT PROMPT & NATIVE BRIDGE
// ==========================================

(function () {
  const PROMPT_DISMISS_HOURS = 24; // Show again after 24 hours if 'Later' is clicked
  const LOCAL_STORAGE_KEY = 'push_prompt_dismissed_until';

  document.addEventListener('DOMContentLoaded', () => {
    initSoftPrompt();
  });

  function initSoftPrompt() {
    const promptElement = document.getElementById('push-soft-prompt');
    const enableBtn = document.getElementById('soft-prompt-enable-btn');
    const laterBtn = document.getElementById('soft-prompt-later-btn');
    const closeBtn = document.getElementById('soft-prompt-close-btn');

    // 1. Only show banner if inside Native Android WebView
    if (!window.AndroidBridge) {
      console.log('Not running inside Native Android App. Skipping soft prompt.');
      return;
    }

    // 2. Check soft prompt advertisement loop delay timer
    if (shouldShowPrompt()) {
      showPromptBanner();
    }

    // 3. Handle 'Enable' button
    if (enableBtn) {
      enableBtn.addEventListener('click', () => {
        hidePromptBanner();
        // Trigger native permission request bridge
        window.AndroidBridge.requestNativePushPermission();
      });
    }

    // 4. Handle 'Later' button & Close button
    if (laterBtn) {
      laterBtn.addEventListener('click', () => dismissPromptForLater());
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', () => dismissPromptForLater());
    }
  }

  function shouldShowPrompt() {
    const dismissedUntil = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!dismissedUntil) return true;
    return Date.now() > parseInt(dismissedUntil, 10);
  }

  function showPromptBanner() {
    const promptElement = document.getElementById('push-soft-prompt');
    if (promptElement) {
      promptElement.classList.remove('hidden');
    }
  }

  function hidePromptBanner() {
    const promptElement = document.getElementById('push-soft-prompt');
    if (promptElement) {
      promptElement.classList.add('hidden');
    }
  }

  function dismissPromptForLater() {
    hidePromptBanner();
    // Set 24-hour cool down in localStorage before showing banner again
    const nextShowTime = Date.now() + PROMPT_DISMISS_HOURS * 60 * 60 * 1000;
    localStorage.setItem(LOCAL_STORAGE_KEY, nextShowTime.toString());
  }
})();

// ==========================================
// TOKEN SYNC TO FIREBASE
// ==========================================

// Global Callback Invoked by Native Android Bridge
window.onFcmTokenReceived = function (fcmToken) {
  console.log('[NativeBridge] Received FCM Registration Token:', fcmToken);
  saveTokenToFirestore(fcmToken);
};

// Global Callback Invoked for Permission Results
window.onNativePermissionResult = function (granted, reason) {
  console.log('[NativeBridge] Notification Permission Status:', granted, reason);
};

async function saveTokenToFirestore(fcmToken) {
  if (!fcmToken) return;

  // Check if user is authenticated
  const user = firebase.auth().currentUser;

  if (user) {
    const userId = user.uid;
    try {
      await firebase.firestore().collection('users').doc(userId).set(
        {
          fcmToken: fcmToken,
          fcmTokenUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          devicePlatform: 'Android'
        },
        { merge: true }
      );
      console.log('✅ FCM Token successfully stored in Firestore for user:', userId);
    } catch (error) {
      console.error('❌ Error saving FCM Token to Firestore:', error);
    }
  } else {
    // If user is not signed in yet, cache token to sync after login
    localStorage.setItem('cached_fcm_token', fcmToken);
    console.log('Cached FCM Token in localStorage (User not signed in yet).');
  }
}

// Auto-sync cached token when Firebase Auth state changes (after user logs in)
firebase.auth().onAuthStateChanged((user) => {
  if (user) {
    const cachedToken = localStorage.getItem('cached_fcm_token');
    if (cachedToken) {
      saveTokenToFirestore(cachedToken);
      localStorage.removeItem('cached_fcm_token');
    }
  }
});
