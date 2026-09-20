> C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:245:function loadTransactions() {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:246:  if (_listeners.transactions) { _listeners.transactions(); _listeners.transactions = null; }
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:247:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:248:  const container = document.getElementById("transactionList");
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:249:  if (!container) return;
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:250:  container.innerHTML = '<p class="loading-text">Loading transactions...</p>';
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:251:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:252:  const q = query(collectionGroup(db, "verifications"), orderBy("submittedAt", "desc"));
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:253:  _listeners.transactions = onSnapshot(q, (snap) => {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:254:    _allTransactions = snap.docs
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:255:        .map(doc => ({ id: doc.id, ...doc.data(), tournamentId: doc.ref.parent.parent.id }))
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:256:        .filter(t => t.utr && (t.paymentStatus === "submitted" || t.status === "pending"));
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:257:    filterTransactions();
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:258:  }, (err) => {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:259:    console.error("Transactions load error:", err);
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:260:    container.innerHTML = '<p style="color:red;">Error loading transactions. Make sure index exists.</p>';
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:261:  });
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:262:}
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:263:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:264:window.filterTransactions = function() {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:265:  const container = document.getElementById("transactionList");
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:266:  const searchVal = (document.getElementById("transactionSearch")?.value || "").toLowerCase();
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:267:  
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:268:  const filtered = _allTransactions.filter(t => {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:269:    // Only show ones with UTR
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:270:    if (!t.utr) return false;
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:271:    
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:272:    if (!searchVal) return true;
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:273:    return (t.teamId && t.teamId.toLowerCase().includes(searchVal)) || 
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:274:           (t.utr && t.utr.toLowerCase().includes(searchVal));
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:275:  });
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:276:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:277:  if (filtered.length === 0) {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:278:    container.innerHTML = '<p style="color:#888;">No pending transactions found.</p>';
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:279:    document.getElementById("transactionBadge").style.display = "none";
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:280:    return;
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:281:  }
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:282:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:283:  document.getElementById("transactionBadge").textContent = filtered.length;
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:284:  document.getElementById("transactionBadge").style.display = "inline-block";
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:285:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:286:  // Group by tournamentId
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:287:  const grouped = {};
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:288:  filtered.forEach(t => {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:289:    if (!grouped[t.tournamentId]) grouped[t.tournamentId] = [];
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:290:    grouped[t.tournamentId].push(t);
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:291:  });
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:292:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:293:  let html = '';
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:294:  for (const [tId, txs] of Object.entries(grouped)) {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:295:    html += `<div style="margin-bottom: 24px; padding: 16px; background: var(--bg2); border: 1px solid #333; border-radius: 8px;">`;
