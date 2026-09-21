# AI Handover Document: NPC Esports Web Platform

This document serves as a comprehensive technical handoff for the next AI agent or developer continuing work on the NPC Esports Web Platform. It details the current state of the application, recent architectural fixes, core logic, and fragile dependencies that must be preserved.

## 1. Summary of Work & Recent Fixes
The following critical infrastructure features and bug fixes have been successfully implemented:

### A. Authentication & Account Creation
* **Fixed Account Creation Crash:** New accounts were failing to register due to a missing Firestore rule for the `/users/{userId}/private` subcollection. The rule has been added, and the batch writes now successfully execute.
* **Ghost Member Purge:** Joining a team proactively purges ghost accounts (deleted accounts still in the array). Wrapped this in a `try/catch` block because joining users do not have permissions to write to the team array until after they join.

### B. DPDP Act Compliance & Data Privacy
* **Strict Frontend Consent Blocking:** Implemented strict checkbox validation directly inside `login()`, `googleSignIn()`, and `sendSignupOTP()` to prevent any new authentication without explicit DPDP Act consent.
* **Legacy User Enforcement:** Added an interception hook inside `onAuthStateChanged` in `main.js`. If an existing user profile lacks the `dpdpConsented` flag, the system forcefully mounts a centralized, blocking DPDP Modal that locks out UI interaction until accepted.
* **Immutable Backend Logging:** Built `POST /api/consent/record` on the Express backend. It utilizes a Firestore Transaction to permanently lock in the `userId`, `ip_address`, `user_agent`, `policy_version`, and a tamper-proof server-side timestamp into a new `consent_logs` collection.

### C. Backend Infrastructure & Performance
* **Render "Keep-Alive" Daemon:** Fixed severe 50-second UI freezes caused by Render.com's 15-minute "Cold Start" sleep cycle. Implemented a native Node.js self-pinging background interval in `server.js` that hits the server's own URL every 14 minutes, keeping it awake 24/7.
* **Strict Transaction Ordering:** Fixed a persistent HTTP 500 error. Firestore requires all reads (`.get()`) to execute strictly before any writes (`.set()`, `.update()`, `.delete()`) in a transaction block. Refactored `server.js` to adhere to this pattern.
* **Undefined Payload Sanitization:** Fixed Firestore SDK crashes caused by passing `undefined` fields (like `leaderEmail`). Added sanitization logic to fallback to empty strings (`""`) before pushing payloads.

### D. Registration, Payment & Team Data Flow
* **Dynamic Scannable UPI QR Codes (NEW):** Replaced static visual placeholders in `main.js` with a live `api.qrserver.com` endpoint that dynamically generates a scannable UPI QR code containing the exact `entryFee` and `riaz-1@ptyes` payee ID.
* **Real-time Payment Status Tracking (NEW):** Bound tracking logic to the Payment Modal. When a user opens it, the DB silently updates to `processing payment`. If they cancel/close the modal without paying, it degrades to `needs to pay`. Admin Panel's Status Modal tracks this behavior live.
* **Payout / Refund System Dropdown (NEW):** Re-wrote the Admin Payout Modal logic. Previously, all payouts fired a hardcoded "Refund" notification. Built a dropdown to allow admins to seamlessly toggle between "Prize Winnings" (Congratulations) and "Entry Fee Refund" (Apology) notifications.
* **Synced Legacy UPI IDs (NEW):** Discovered a legacy payment UI in `main.js` hardcoded to a dummy `npc-esports@upi` address, which conflicted with the actual `riaz-1@ptyes` account in `paymentStage.js`. Synced both files to guarantee 100% of funds route to `riaz-1@ptyes`.
* **Team-Member Registration Visibility:** Modified the query in `showApprovedReviewInterface` to use `query(collection(...), where("uids", "array-contains", userId))` since registration documents are keyed under the Leader's UID.
* **Team Disbanding Permissions:** Updated `firestore.rules` to grant Team Leaders explicit permission to delete their team document without triggering an Insufficient Permissions error.

### E. Admin Dashboard Logic
* **Live Payment Status UI (NEW):** Upgraded the `viewStatusModal` to display a color-coded Live Payment Status row (Green = Paid, Orange = Processing, Red = Needs to Pay) independent of the core application checklist.
* **Unified Transactions Tab:** Merged `utr` and `paymentUtr` into a computed `transactionUtr` variable so both Ongoing and Upcoming payments render correctly.
* **Leaderboard Editor Modal:** Fixed a null reference error by dynamically building and mounting a full-screen Modal Overlay for the editor.
* **Save Rankings Crash:** Correctly extracted and cached the `tournamentName` before initiating the Firebase batch write.
* **System Events Sync:** Added `systemEvents` to `firestore.rules` so the Admin Panel can dispatch silent realtime updates to clients without permissions errors.
* **Specific Team Notification UID Routing:** Fixed a bug where UI passed In-Game UIDs instead of Firebase Auth UIDs. Modified dispatchers to dynamically fetch the official `teams/{teamId}` document to correctly deliver notifications.

### F. Public Homepage UI
* **Live Leaderboard Auto-Render:** Connected the homepage Leaderboard to the live database, fetching the most recently completed tournament and populating the Top 15 rows.
* **Razorpay Deprecation:** Fully removed legacy Razorpay references, adopting the "NPC Admin Account" verbiage for fee collection.


## 2. Actual Structure & Architecture
The project is split into a Serverless Frontend (Firebase Hosting/Vercel) and a Secure Node.js Backend (Render).

**Frontend (Client: `esports-tournament`)**
```text
esports-tournament/
├── public/
│   ├── index.html        # Main public-facing SPA (Home, Tournaments, DPDP Modals, Auth)
│   ├── about.html        # About Us (Admin Account verbiage)
│   ├── paymentStage.js   # Secure, modern payment routing logic (Uses riaz-1@ptyes)
│   ├── js/
│   │   ├── main.js       # Core logic, legacy payment UI, QR generation, auth & UI listeners
│   │   └── wallet.js     # User wallet logic
│   └── css/              # Stylesheets
├── admin/
│   ├── index.html        # Secure Admin Dashboard Layout
│   └── admin.js          # Admin tools (Approvals, Leaderboard, Payout Modals, Audio alerts)
└── firestore.rules       # CRITICAL: Security rules defining the access matrix
```

**Backend (Server: `npc-secure-backend`)**
```text
npc-secure-backend/
├── server.js             # Express API (Admin SDK tx ordering, DPDP logging, Keep-Alive Daemon)
├── package.json          # Dependencies (firebase-admin, express, cors)
└── .env                  # Service Account Credentials (DO NOT EXPOSE)
```

**Database Schema (Firestore)**
* `/users/{userId}`: Profiles, wallet data, transaction history, `dpdpConsented` flag.
* `/teams/{teamId}`: Team rosters (true Auth UIDs), UPI details, match history.
* `/consent_logs/{userId}`: Immutable legal logs containing IP, User Agent, and timestamp of DPDP consent.
* `/tournaments/{tournamentId}`: Tournament metadata and nested subcollections:
    * `/upcomingRegistrations`: Pre-match entries.
    * `/verifications`: Post-match payout verifications.
    * `/participants`: Active real-time participants.
    * `/leaderboard`: Team rankings and kills.


## 3. Rationale (The Basis)
* **Why split Behavioral Tracking from the 5-Step Checklist? (NEW):** We created a separate "Live Payment Status" line (Tracking `processing payment` and `needs to pay`) independent of the 5-step Application Progress checklist. This allows admins to monitor user drop-off behavior without altering or breaking the strictly guarded "Approved -> Paid -> Verified" state logic required by the backend.
* **Why `api.qrserver.com` instead of a client-side JS library? (NEW):** Using an image-based REST API allows us to instantly mount dynamic QR codes natively in `insertAdjacentHTML` template strings without bloating the client-side bundle with heavy QR generating libraries, ensuring maximum performance.
* **Why sync `npc-esports@upi` to `riaz-1@ptyes`? (NEW):** There were two separate payment flows dynamically loaded. If a user was routed to the legacy payment screen in `main.js`, they would have transferred money to a dead/dummy account. Total sync guarantees 100% of revenue routes to the actual Admin account.
* **Why a Backend Daemon for Keep-Alive?** We could have put a `setInterval` ping loop on the Frontend. But if 1,000 users leave the website open, it would DDoS the backend. By running it natively in Node.js, only one ping happens globally every 14 minutes.
* **Why Immutable DPDP Consent Logs?** To legally protect the platform, consent logs must be tamper-proof and include system metadata (IP Address and Server Timestamp) that cannot be safely generated or trusted if captured purely on the client side.
* **Why are Registrations Keyed to Leader UID?** Only Team Leaders are authorized to initiate payments. The actual registration belongs to the Leader. Teammates read this document using `array-contains` queries.


## 4. 🛑 'Do Not Touch' Zones
The following logic blocks and configurations are highly fragile. Modifying them without extreme care will cause critical systemic failures.

**Security, Secrets & Finances (NEW/CRITICAL):**
* **Admin UPI ID Routing:** NEVER alter the `riaz-1@ptyes` URI strings hardcoded inside the `main.js` QR generator or `paymentStage.js`. Changing this will route live funds to incorrect bank accounts.
* **Payment Approval Locks:** DO NOT bypass the Registration Approval Lock in `main.js`. Even if a user selects "Pay Now" during registration, `openPaymentInterface` must **never** be triggered immediately. It is strictly secured to only open *after* an admin has approved the registration and dispatched an inbox notification.
* **Firebase Admin SDK Keys:** NEVER commit `serviceAccountKey.json` or `.env` to Git. The backend repo is private, but exposing the God-Mode Admin key bypasses all `firestore.rules`.
* **firestore.rules Access Matrix:** DO NOT alter the `allow update:` conditions for `/teams/{teamId}`. DO NOT remove `/systemEvents/{eventId}` or `/users/{userId}/private/{docId}` rules.

**Backend Execution (`server.js`):**
* **Keep-Alive Loop:** DO NOT remove or alter the `keepAliveTimer.unref()` interval at the bottom of `server.js`. Removing this will cause the server to fall asleep after 15 minutes, creating 50-second UI freezes for the next user.
* **Backend Transaction Ordering:** NEVER place a `.set()`, `.update()`, or `.delete()` command before a `.get()` command inside a Firebase Transaction block. All reads must occur sequentially first, or it throws a 500 error.
* **Undefined Data Protection:** Firestore SDK completely rejects objects containing `undefined`. Ensure all payloads use `|| ""` or `|| null` fallbacks.

**Frontend Execution (`main.js` & `admin.js`):**
* **Payment Status Degrading (NEW):** DO NOT remove the `updateDoc` DB writes inside `closePaymentInterface()` in `main.js`. If removed, users who cancel payments will be permanently stuck in "Processing Payment" in the Admin Panel.
* **DPDP Modal Blocking Logic:** DO NOT bypass or remove the `!userProfile.dpdpConsented` check inside `onAuthStateChanged`. Do not remove the explicit checkbox validations injected into `login()`, `googleSignIn()`, and `sendSignupOTP()`.
* **Tournament Status Lifecycle Logic:** `startFirebaseListeners()` dynamically modifies local status (upcoming to ongoing). Do not alter this JS date calculation.
* **Shared Listeners:** Ensure `window.roomWatchers` and `window.userParticipantDocs` remain uncoupled.
* **Audio Context:** DO NOT remove `_unlockAdminAudio()` in `admin.js`. Browsers strictly suspend AudioContext until a user gesture occurs. This ensures background admin alerts aren't blocked.
* **Admin Routing:** DO NOT pass `pData.uids` (game IDs) to `sendDualNotification` in the admin panel. Always resolve routing arrays via `teamData.members`.
