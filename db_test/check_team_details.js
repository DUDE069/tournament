const { initializeApp } = require("firebase/app");
const { getFirestore, doc, getDoc, collection, getDocs } = require("firebase/firestore");
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

async function checkTeamDetails() {
  try {
    await signInWithEmailAndPassword(auth, "testagent123@test.com", "testagent123");
    
    const teamDoc = await getDoc(doc(db, "teams", "team_qcl1rztuo"));
    console.log("Team Data:", JSON.stringify(teamDoc.data(), null, 2));
    
    process.exit(0);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

checkTeamDetails();
