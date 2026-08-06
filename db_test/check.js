const { initializeApp } = require("firebase/app");
const { getFirestore, collection, getDocs } = require("firebase/firestore");

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

async function checkTeams() {
  try {
    const querySnapshot = await getDocs(collection(db, "teams"));
    console.log(`Found ${querySnapshot.size} teams.`);
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      console.log(`\nTeam ID: ${doc.id}`);
      console.log(`Team Name: ${data.teamName}`);
      console.log(`Leader ID: ${data.leaderId}`);
      console.log(`Members Array:`, data.members);
    });
    
    process.exit(0);
  } catch (error) {
    console.error("Error fetching teams:", error.message);
    process.exit(1);
  }
}

checkTeams();
