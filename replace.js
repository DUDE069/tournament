const fs = require('fs');
const content = fs.readFileSync('admin/admin.js', 'utf8');

const oldFunc =   _listeners.registrations = onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach(c => {
      const grandparentColId = c.doc.ref.parent.parent?.parent?.id;
      if (c.type === "added" && c.doc.data().status === "pending" && grandparentColId === "tournaments") {
        playAdminAlert(c.doc.id);
      }
    });

    const pending  = [];
    const approved = [];
    const rejected = [];
    const tourneyIds = new Set();

    snapshot.forEach(d => {
      const grandparentColId = d.ref.parent.parent?.parent?.id;
      if (grandparentColId !== "tournaments") return;

      const data = { id: d.id, tournamentId: d.ref.parent.parent.id, ...d.data() };
      if (data.archived === true) return; 
      
      tourneyIds.add(data.tournamentId);

      if (window._currentUpcomingFilter !== 'all' && data.tournamentId !== window._currentUpcomingFilter) return;

      if      (data.status === "pending")  pending.push(data);
      else if (data.status === "approved") approved.push(data);
      else if (data.status === "rejected") rejected.push(data);
    });

    const tabsContainer = document.getElementById("upcomingTourneyTabs");
    if (tabsContainer) {
      let tabsHtml = \<button onclick="window._currentUpcomingFilter='all'; loadUpcomingRegistrations()" style="padding:6px 12px; background:\; color:\; border:none; border-radius:4px; cursor:pointer; white-space:nowrap; font-weight:bold;">All</button>\;
      
      tourneyIds.forEach(tId => {
        let tName = tId;
        if (window._adminActiveTournaments) {
            const tDoc = window._adminActiveTournaments.find(doc => doc.id === tId);
            if (tDoc) tName = tDoc.data().title || tId;
        }
        tabsHtml += \<button onclick="window._currentUpcomingFilter='\'; loadUpcomingRegistrations()" style="padding:6px 12px; background:\; color:\; border:none; border-radius:4px; cursor:pointer; white-space:nowrap; font-weight:bold;">\</button>\;
      });
      tabsContainer.innerHTML = tabsHtml;
    }

    if (!pending.length && !approved.length && !rejected.length) {
      container.innerHTML = \<div class="empty-state"><span class="emoji">📝</span>No registrations found for this filter.</div>\;
      return;
    }

    let html = "";
    html += partition("new",      \🔥  New Registrations (\)\);
    html += pending.length  ? pending.map(d  => upcomingCard(d, "new")).join("")      : noItems();
    html += partition("accepted", \✅ Approved (\)\);
    html += approved.length ? approved.map(d => upcomingCard(d, "accepted")).join("") : noItems();
    html += partition("rejected", \🚫 Rejected (\)\);
    html += rejected.length ? rejected.map(d => upcomingCard(d, "rejected")).join("") : noItems();

    container.innerHTML = html;
  }, err => {
    container.innerHTML = \<p style="color:var(--red);padding:20px;">Error: Permission Denied or Invalid Data</p>\;
  });
};

const newFunc =   _listeners.registrations = onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach(c => {
      const grandparentColId = c.doc.ref.parent.parent?.parent?.id;
      if (c.type === "added" && c.doc.data().status === "pending" && grandparentColId === "tournaments") {
        playAdminAlert(c.doc.id);
      }
    });
    window._lastUpcomingSnapshot = snapshot;
    window.renderUpcomingList(snapshot);
  }, err => {
    container.innerHTML = \<p style="color:var(--red);padding:20px;">Error: Permission Denied or Invalid Data</p>\;
  });
}

window.renderUpcomingList = function(snapshot) {
  const container = document.getElementById("upcomingRegistrationsList");
  if (!container) return;

  const pending  = [];
  const approved = [];
  const rejected = [];
  const tourneyIds = new Set();

  snapshot.forEach(d => {
    const grandparentColId = d.ref.parent.parent?.parent?.id;
    if (grandparentColId !== "tournaments") return;

    const data = { id: d.id, tournamentId: d.ref.parent.parent.id, ...d.data() };
    if (data.archived === true) return; 
    
    tourneyIds.add(data.tournamentId);

    if (window._currentUpcomingFilter !== 'all' && data.tournamentId !== window._currentUpcomingFilter) return;

    if      (data.status === "pending")  pending.push(data);
    else if (data.status === "approved") approved.push(data);
    else if (data.status === "rejected") rejected.push(data);
  });

  const tabsContainer = document.getElementById("upcomingTourneyTabs");
  if (tabsContainer) {
    let tabsHtml = \<button onclick="window._currentUpcomingFilter='all'; window.renderUpcomingList(window._lastUpcomingSnapshot)" style="padding:6px 12px; background:\; color:\; border:none; border-radius:4px; cursor:pointer; white-space:nowrap; font-weight:bold;">All</button>\;
    
    tourneyIds.forEach(tId => {
      let tName = tId;
      if (window._adminActiveTournaments) {
          const tDoc = window._adminActiveTournaments.find(doc => doc.id === tId);
          if (tDoc) tName = tDoc.data().title || tId;
      }
      tabsHtml += \<button onclick="window._currentUpcomingFilter='\'; window.renderUpcomingList(window._lastUpcomingSnapshot)" style="padding:6px 12px; background:\; color:\; border:none; border-radius:4px; cursor:pointer; white-space:nowrap; font-weight:bold;">\</button>\;
    });
    tabsContainer.innerHTML = tabsHtml;
  }

  if (!pending.length && !approved.length && !rejected.length) {
    container.innerHTML = \<div class="empty-state"><span class="emoji">📝</span>No registrations found for this filter.</div>\;
    return;
  }

  let html = "";
  html += partition("new",      \🔥  New Registrations (\)\);
  html += pending.length  ? pending.map(d  => upcomingCard(d, "new")).join("")      : noItems();
  html += partition("accepted", \✅ Approved (\)\);
  html += approved.length ? approved.map(d => upcomingCard(d, "accepted")).join("") : noItems();
  html += partition("rejected", \🚫 Rejected (\)\);
  html += rejected.length ? rejected.map(d => upcomingCard(d, "rejected")).join("") : noItems();

  container.innerHTML = html;
};

if (content.includes(oldFunc)) {
  fs.writeFileSync('admin/admin.js', content.replace(oldFunc, newFunc));
  console.log("Replaced successfully!");
} else {
  console.log("Could not find oldFunc. Outputting oldFunc length and first 50 chars:");
  console.log(oldFunc.length, oldFunc.substring(0, 50));
}
