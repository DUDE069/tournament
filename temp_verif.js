> C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:606:function loadVerifications() {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:607:  if (_listeners.verifications) { _listeners.verifications(); _listeners.verifications = null; }
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:608:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:609:  const container = document.getElementById("verificationList");
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:610:  if (!container) return;
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:611:  container.innerHTML = '<p class="loading-text">Loading applications…</p>';
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:612:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:613:  // Query all statuses but EXCLUDE archived docs
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:614:  // NOTE: This requires a Firestore composite index on (submittedAt DESC) with
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:615:  // a collection group query.  If "archived" filter causes index errors, the
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:616:  // catch below falls back to client-side filtering.
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:617:  const q = query(
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:618:    collectionGroup(db, "verifications"),
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:619:    orderBy("submittedAt", "desc")
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:620:  );
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:621:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:622:  _listeners.verifications = onSnapshot(q, (snapshot) => {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:623:    snapshot.docChanges().forEach(c => {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:624:      if (c.type === "added" && c.doc.data().status === "pending") playAdminAlert(c.doc.id);
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:625:    });
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:626:    renderVerificationList(snapshot);
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:627:  }, err => {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:628:    container.innerHTML = `<p style="color:var(--red);padding:20px;">Error: Permission Denied or Invalid Data</p>`;
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:629:  });
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:630:}
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:631:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:632:function renderVerificationList(snapshot) {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:633:  const container = document.getElementById("verificationList");
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:634:  if (!container) return;
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:635:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:636:  const pending  = [];
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:637:  const accepted = [];
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:638:  const rejected = [];
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:639:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:640:  snapshot.forEach(vDoc => {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:641:    const d = { id: vDoc.id, tournamentId: vDoc.ref.parent.parent.id, ...vDoc.data() };
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:642:    if (d.archived === true) return; // CLIENT-SIDE: skip archived docs
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:643:    
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:644:    const isPaymentSubmitted = (d.paymentStatus === "submitted" && !!d.utr);
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:645:    
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:646:    if (d.status === "rejected") {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:647:      rejected.push(d);
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:648:    } else if (d.status === "approved" || isPaymentSubmitted) {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:649:      // If payment is submitted, it means the application phase was already approved
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:650:      accepted.push(d);
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:651:    } else if (d.status === "pending") {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:652:      pending.push(d);
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:653:    }
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:654:  });
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:655:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:656:  if (!pending.length && !accepted.length && !rejected.length) {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:657:    container.innerHTML = `<div class="empty-state"><span class="emoji">?</span>No applications yet.</div>`;
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:658:    return;
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:659:  }
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:660:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:661:  let html = "";
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:662:  html += partition("new",      `?? New Applications (${pending.length})`);
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:663:  html += pending.length  ? pending.map(d  => applicationCard(d, "new")).join("")      : noItems();
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:664:  html += partition("accepted", `? Accepted (${accepted.length})`);
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:665:  html += accepted.length ? accepted.map(d => applicationCard(d, "accepted")).join("") : noItems();
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:666:  html += partition("rejected", `? Rejected (${rejected.length})`);
