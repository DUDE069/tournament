import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAVmkZLnhoxR15k3OxK5ApcxzKz5zFm2SI",
  authDomain: "npc-esports-c3adb.firebaseapp.com",
  projectId: "npc-esports-c3adb",
  storageBucket: "npc-esports-c3adb.firebasestorage.app",
  messagingSenderId: "404452164488",
  appId: "1:404452164488:web:03179cbf527d28a3b6303d"
};

const app = initializeApp(firebaseConfig);

// Enable offline caching using the modern API to fix deprecation warnings
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

export const auth = getAuth(app);
