import { db } from './firebase.js';
import { doc, collection, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

export async function processTournamentPayment(uid, tournamentId, entryFee) {
    const walletRef = doc(db, "users", uid, "wallet", "main");
    const txRef = doc(collection(db, "users", uid, "transactions")); 
    
    try {
        await runTransaction(db, async (transaction) => {
            const walletDoc = await transaction.get(walletRef);
            
            if (!walletDoc.exists()) {
                throw new Error("Wallet not found. Please contact support.");
            }

            const currentBalance = walletDoc.data().balance || 0;

            if (currentBalance < entryFee) {
                throw new Error(`Insufficient funds. You have ₹${currentBalance}, but ₹${entryFee} is required.`);
            }

            const newBalance = currentBalance - entryFee;

            transaction.update(walletRef, { 
                balance: newBalance,
                updatedAt: serverTimestamp() 
            });

            transaction.set(txRef, {
                type: 'debit',
                amount: entryFee,
                description: `Entry fee for tournament: ${tournamentId}`,
                tournamentId: tournamentId,
                status: 'completed',
                createdAt: serverTimestamp()
            });
        });

        return { success: true };
    } catch (error) {
        console.error("[Wallet] Payment failed:", error);
        return { success: false, error: error.message };
    }
}
