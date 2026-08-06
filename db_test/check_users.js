const { initializeApp } = require("firebase/app");
const { getFirestore, doc, getDoc } = require("firebase/firestore");
const { getAuth, signInWithEmailAndPassword } = require("firebase/auth");

const firebaseConfig = {
  apiKey: "AIzaSyAVmkZLnhoxR15k3OxK5ApcxzKz5zFm2SI",
  authDomain: "npc-esports-c3adb.firebaseapp.com",
  projectId: "npc-esports-c3adb",
  storageBucket: "npc-esports-c3adb.firebasestorage.app",
  messagingSenderId: "404452164488",
  appId: "1:404452164488:web:03179cbf527d28a3b6303d"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

async function checkUsers() {
  try {
    await signInWithEmailAndPassword(auth, "testagent123@test.com", "testagent123");
    
    const uids = [
      'dkZLMuGqSpSBcLwfGFeyMhA9oSj2',
      'uuTS8XYcU0MAzoVaCUMAFeRYROM2',
      '8h8EfVZalOe2rx79l8j64mIPplS2',
      'Kc1g5TP9faM6tLGbVMIfTc1QWd42'
    ];
    
    for (const uid of uids) {
       const userDoc = await getDoc(doc(db, "users", uid));
       if (userDoc.exists()) {
           console.log(`User ${uid} exists:`, userDoc.data().email, userDoc.data().nickname);
       } else {
           console.log(`User ${uid} DOES NOT EXIST in users collection!`);
       }
    }
    
    process.exit(0);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

checkUsers();
