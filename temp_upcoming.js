> C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1387:function loadUpcomingRegistrations() {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1388:  if (_listeners.registrations) { _listeners.registrations(); _listeners.registrations = null; }
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1389:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1390:  const container = document.getElementById("upcomingRegistrationsList");
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1391:  if (!container) return;
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1392:  container.innerHTML = '<p class="loading-text">Loading…</p>';
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1393:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1394:  const q = query(
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1395:    collectionGroup(db, "upcomingRegistrations"),
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1396:    orderBy("registeredAt", "desc")
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1397:  );
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1398:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1399:  _listeners.registrations = onSnapshot(q, (snapshot) => {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1400:    // ? FIX: Trigger sound alert for new pending registrations
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1401:    // Pass docId to debounce — badge listener may have already played for this doc
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1402:    snapshot.docChanges().forEach(c => {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1403:      // Only fire alert for documents in tournaments/.../upcomingRegistrations (not users/...)
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1404:      // The parent of the subcollection is the tournament doc; its collection is "tournaments"
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1405:      const grandparentColId = c.doc.ref.parent.parent?.parent?.id;
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1406:      if (c.type === "added" && c.doc.data().status === "pending" && grandparentColId === "tournaments") {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1407:        playAdminAlert(c.doc.id);
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1408:      }
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1409:    });
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1410:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1411:    const pending  = [];
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1412:    const approved = [];
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1413:    const rejected = [];
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1414:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1415:    snapshot.forEach(d => {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1416:      // ? FIX: Only process documents from tournaments/.../upcomingRegistrations (not users/...)
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1417:      // d.ref.parent.parent is the tournament doc; d.ref.parent.parent.parent is "tournaments" collection
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1418:      const grandparentColId = d.ref.parent.parent?.parent?.id;
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1419:      if (grandparentColId !== "tournaments") return; // SKIP user-side mirror documents
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1420:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1421:      const data = { id: d.id, tournamentId: d.ref.parent.parent.id, ...d.data() };
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1422:      if (data.archived === true) return; // CLIENT-SIDE filter
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1423:      if      (data.status === "pending")  pending.push(data);
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1424:      else if (data.status === "approved") approved.push(data);
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1425:      else if (data.status === "rejected") rejected.push(data);
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1426:    });
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1427:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1428:    if (!pending.length && !approved.length && !rejected.length) {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1429:      container.innerHTML = `<div class="empty-state"><span class="emoji">??</span>No registrations yet.</div>`;
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1430:      return;
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1431:    }
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1432:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1433:    let html = "";
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1434:    html += partition("new",      `?? New Registrations (${pending.length})`);
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1435:    html += pending.length  ? pending.map(d  => upcomingCard(d, "new")).join("")      : noItems();
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1436:    html += partition("accepted", `? Approved (${approved.length})`);
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1437:    html += approved.length ? approved.map(d => upcomingCard(d, "accepted")).join("") : noItems();
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1438:    html += partition("rejected", `? Rejected (${rejected.length})`);
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1439:    html += rejected.length ? rejected.map(d => upcomingCard(d, "rejected")).join("") : noItems();
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1440:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1441:    container.innerHTML = html;
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1442:  }, err => {
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1443:    container.innerHTML = `<p style="color:var(--red);padding:20px;">Error: Permission Denied or Invalid Data</p>`;
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1444:  });
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1445:}
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1446:
  C:\Users\ariya\OneDrive\Desktop\esports-tournament\admin\admin.js:1447:function upcomingCard(d, type) {
