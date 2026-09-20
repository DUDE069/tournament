> C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:264:window.filterTransactions = function() {
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
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:296:    html += `<h3 style="color: var(--blue); margin-top: 0; margin-bottom: 12px; font-size: 16px; border-bottom: 1px solid #333; padding-bottom: 8px;">?? Tournament: ${tId}</h3>`;
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:297:    
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:298:    html += txs.map(t => {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:299:      // Extra info from the new backend merge
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:300:      const leaderName = t.teamName ? `${t.teamName} (Leader: ${t.nickPlayer1 || 'Unknown'})` : 'Unknown';
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:301:      const phone = t.phone ? `Phone: ${t.phone}` : '';
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:302:      const backupEmail = t.backupEmail ? `Backup Email: ${t.backupEmail}` : '';
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:303:      
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:304:      return `
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:305:        <div style="background:#1a1a1a; padding:15px; border-radius:8px; border:1px solid #444; margin-bottom:10px;">
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:306:          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap: wrap; gap: 10px;">
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:307:            <div style="flex: 1; min-width: 250px;">
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:308:              <p style="margin:0 0 5px; color:#fff;"><strong>Team ID:</strong> ${t.teamId}</p>
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:309:              <p style="margin:0 0 5px; color:#ccc;"><strong>Team Info:</strong> ${leaderName}</p>
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:310:              ${phone ? `<p style="margin:0 0 5px; color:#ccc;"><strong>${phone}</strong></p>` : ''}
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:311:              ${backupEmail ? `<p style="margin:0 0 5px; color:#ccc;"><strong>${backupEmail}</strong></p>` : ''}
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:312:              <p style="margin:10px 0 5px; color:#00ff88; font-size:18px;"><strong>UTR:</strong> <span style="letter-spacing:1px;">${t.utr}</span></p>
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:313:              <p style="margin:0 0 5px; color:#ffd700;"><strong>Amount:</strong> ?${t.expectedAmount || 0}</p>
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:314:              ${t.screenshotUrl ? `<a href="${t.screenshotUrl}" target="_blank" style="color:#3b82f6; display:inline-block; margin-top:5px;">View Screenshot</a>` : ''}
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:315:            </div>
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:316:            <div style="display: flex; flex-direction: column; gap: 8px; min-width: 200px;">
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:317:              <button onclick="approveTransaction('${t.tournamentId}', '${t.id}', '${t.teamId}', '${t.userId}', '${t.utr}', ${t.expectedAmount || 0})" style="background:#00ff88; color:#000; padding:10px 15px; border:none; border-radius:4px; cursor:pointer; font-weight:bold; width:100%;">? Approve Payment</button>
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:318:              <button onclick="rejectPaymentTransaction('${t.tournamentId}', '${t.id}', '${t.teamId}', '${t.userId}')" style="background:#ff4444; color:#fff; padding:10px 15px; border:none; border-radius:4px; cursor:pointer; font-weight:bold; width:100%;">? Reject (Invalid UTR)</button>
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:319:              <button onclick="walletRefundTransaction('${t.tournamentId}', '${t.id}', '${t.teamId}', '${t.userId}', ${t.expectedAmount || 0})" style="background:transparent; color:#888; border:1px solid #444; padding:8px 15px; border-radius:4px; cursor:pointer; font-size: 12px; width:100%;">Refund to Wallet (Waitlist)</button>
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:320:            </div>
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:321:          </div>
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:322:        </div>
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:323:      `;
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:324:    }).join("");
