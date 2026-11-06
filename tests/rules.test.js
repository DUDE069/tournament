const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { readFileSync } = require('fs');

let testEnv;

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FIRESTORE_EMULATOR_HOST is not set. Aborting tests.");
  process.exit(1);
}

const PROJECT_ID = 'demo-esports-test-' + Date.now();

if (!PROJECT_ID.startsWith('demo-')) {
  console.error("Project ID must start with 'demo-'. Aborting tests.");
  process.exit(1);
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  
  // Set up mock tournament
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await adminDb.collection('tournaments').doc('t1').set({
      status: 'open',
      deadline: new Date(Date.now() + 3600000) // 1 hour in the future
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Firestore Rules', () => {
  
  const getAuthedDB = (auth) => {
    const { uid, ...claims } = auth;
    return testEnv.authenticatedContext(uid, claims).firestore();
  };
  const getUnauthedDB = () => testEnv.unauthenticatedContext().firestore();

  describe('1. Admin and Role Protection', () => {
    it('user cannot set isAdmin on their own user document creation', async () => {
      const db = getAuthedDB({ uid: 'alice' });
      const userRef = db.collection('users').doc('alice');
      await assertFails(userRef.set({ isAdmin: true, name: 'Alice' }));
    });

    it('user cannot change isAdmin on their own user document update', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await db.collection('users').doc('alice').set({ isAdmin: false, name: 'Alice' });
      });

      const db = getAuthedDB({ uid: 'alice' });
      const userRef = db.collection('users').doc('alice');
      await assertFails(userRef.update({ isAdmin: true }));
    });

    it('user can set isLeader on their own user document creation', async () => {
      const db = getAuthedDB({ uid: 'alice' });
      const userRef = db.collection('users').doc('alice');
      await assertSucceeds(userRef.set({ isLeader: true, name: 'Alice' }));
    });
  });

  describe('2. Wallet Protection', () => {
    it('user cannot write non-zero balance to their wallet', async () => {
      const db = getAuthedDB({ uid: 'alice' });
      const walletRef = db.collection('users').doc('alice').collection('wallet').doc('main');
      await assertFails(walletRef.set({ balance: 1000 }));
    });

    it('user can initialize their wallet with zero balance', async () => {
      const db = getAuthedDB({ uid: 'alice' });
      const walletRef = db.collection('users').doc('alice').collection('wallet').doc('main');
      await assertSucceeds(walletRef.set({ balance: 0 }));
    });

    it('user cannot read another users wallet', async () => {
      const db = getAuthedDB({ uid: 'bob' });
      const walletRef = db.collection('users').doc('alice').collection('wallet').doc('main');
      await assertFails(walletRef.get());
    });
  });

  describe('3. Cross-User Data Protection', () => {
    it('user cannot read another users notifications', async () => {
      const db = getAuthedDB({ uid: 'bob' });
      const notifRef = db.collection('users').doc('alice').collection('notifications').doc('notif1');
      await assertFails(notifRef.get());
    });

    it('user cannot edit another users documents', async () => {
      const db = getAuthedDB({ uid: 'bob' });
      const userRef = db.collection('users').doc('alice');
      await assertFails(userRef.update({ name: 'Hacked by Bob' }));
    });

    it('user cannot read another users withdrawal_requests', async () => {
      const db = getAuthedDB({ uid: 'bob' });
      const reqRef = db.collection('withdrawal_requests').doc('req1'); // Assuming req1 belongs to Alice
      await assertFails(reqRef.get());
    });
  });

  describe('4. Payment and 6 Documents Protection', () => {
    const checkPaymentDoc = async (pathBuilder) => {
      const db = getAuthedDB({ uid: 'alice' });
      
      // Should fail to create with verified
      await assertFails(pathBuilder(db).set({ paymentStatus: 'verified', userId: 'alice' }));
      
      // Should succeed to create with pending
      await assertSucceeds(pathBuilder(db).set({ paymentStatus: 'pending', userId: 'alice' }));

      // Should fail to update to verified
      await assertFails(pathBuilder(db).update({ paymentStatus: 'verified' }));
    };

    it('protects users/{uid}/pendingPayment/{docId}', async () => {
      await checkPaymentDoc(db => db.collection('users').doc('alice').collection('pendingPayment').doc('t1'));
    });
    
    it('protects tournaments/{t}/upcomingRegistrations/{docId}', async () => {
      await checkPaymentDoc(db => db.collection('tournaments').doc('t1').collection('upcomingRegistrations').doc('reg1'));
    });
    
    it('protects users/{uid}/upcomingRegistrations/{docId}', async () => {
      await checkPaymentDoc(db => db.collection('users').doc('alice').collection('upcomingRegistrations').doc('reg1'));
    });
    
    it('protects tournaments/{t}/slots/{docId}', async () => {
      // Actually slots might be admin-only write, let's see. The requirement says:
      // "Users may create the 6 payment-related documents only with paymentStatus pending"
      await checkPaymentDoc(db => db.collection('tournaments').doc('t1').collection('slots').doc('slot1'));
    });

    it('protects tournaments/{t}/verifications/{docId}', async () => {
      await checkPaymentDoc(db => db.collection('tournaments').doc('t1').collection('verifications').doc('verif1'));
    });

    it('protects tournaments/{t}/participants/{docId}', async () => {
      await checkPaymentDoc(db => db.collection('tournaments').doc('t1').collection('participants').doc('part1'));
    });

    it('blocks joins to a closed tournament or one past its deadline', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();
        await adminDb.collection('tournaments').doc('closed_t').set({
          status: 'closed',
          deadline: new Date(Date.now() + 3600000)
        });
        await adminDb.collection('tournaments').doc('past_t').set({
          status: 'open',
          deadline: new Date(Date.now() - 3600000) // past
        });
      });

      const db = getAuthedDB({ uid: 'alice' });
      await assertFails(db.collection('tournaments').doc('closed_t').collection('participants').doc('part1').set({ paymentStatus: 'pending', userId: 'alice' }));
      await assertFails(db.collection('tournaments').doc('past_t').collection('participants').doc('part1').set({ paymentStatus: 'pending', userId: 'alice' }));
    });
  });

  describe('5. Withdrawal Requests', () => {
    it('user can create only for themselves, status pending, amount > 0', async () => {
      const db = getAuthedDB({ uid: 'alice' });
      const reqRef = db.collection('withdrawal_requests').doc('req1');
      
      // Missing or wrong userId
      await assertFails(reqRef.set({ userId: 'bob', status: 'pending', amount: 50 }));
      
      // Wrong status
      await assertFails(reqRef.set({ userId: 'alice', status: 'approved', amount: 50 }));
      
      // Negative amount
      await assertFails(reqRef.set({ userId: 'alice', status: 'pending', amount: -50 }));
      
      // Valid
      await assertSucceeds(reqRef.set({ userId: 'alice', status: 'pending', amount: 50 }));
      
      // User cannot update or delete
      await assertFails(reqRef.update({ status: 'approved' }));
      await assertFails(reqRef.delete());
    });
  });

  describe('6. Teams Validation and Restrictions', () => {
    it('validates maxMembers and types', async () => {
      const db = getAuthedDB({ uid: 'alice' });
      const teamRef = db.collection('teams').doc('team1');
      
      // Should fail if maxMembers is missing or wrong type or too high
      await assertFails(teamRef.set({ leaderId: 'alice', members: ['alice'], maxMembers: 'five' })); // string instead of number
    });

    it('blocks leader from deleting team if it has active registration', async () => {
      // Implementation depends on how "pending or verified registration" is checked.
      // Easiest is checking a field on the team, or checking tournament history.
      const db = getAuthedDB({ uid: 'alice' });
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();
        await adminDb.collection('teams').doc('team1').set({ leaderId: 'alice', members: ['alice'], hasActiveRegistration: true });
      });
      const teamRef = db.collection('teams').doc('team1');
      await assertFails(teamRef.delete());
    });
  });

  describe('7. Basic Type and Length Validation', () => {
    it('validates nickname, phone, UTR length and types', async () => {
      const db = getAuthedDB({ uid: 'alice' });
      
      // User document validation
      const userRef = db.collection('users').doc('alice');
      // Should fail: phone not a string or too long/short
      await assertFails(userRef.set({ phone: 1234567890 }));
      await assertFails(userRef.set({ phone: '123' })); // Too short
      
      // UTR validation in pendingPayment
      const paymentRef = db.collection('users').doc('alice').collection('pendingPayment').doc('t1');
      await assertFails(paymentRef.set({ userId: 'alice', paymentStatus: 'pending', utr: 'short' }));
      await assertSucceeds(paymentRef.set({ userId: 'alice', paymentStatus: 'pending', utr: '123456789012' })); // exactly 12 chars
    });
  });

  describe('8. Full Account Setup Batch Flow', () => {
    it('Viewer signup: commits user doc, private doc, and zero wallet atomically', async () => {
      const db = getAuthedDB({ uid: 'viewer1' });
      const batch = db.batch();
      
      batch.set(db.collection('users').doc('viewer1'), {
        uid: 'viewer1',
        nickname: 'ViewerOne',
        freeFireUid: '12345678',
        role: 'viewer',
        isAdmin: false,
        isLeader: false,
        teamId: null,
        teamName: null,
        teamCode: null
      });
      batch.set(db.collection('users').doc('viewer1').collection('private').doc('data'), {
        email: 'viewer1@example.com',
        age: 20
      });
      batch.set(db.collection('users').doc('viewer1').collection('wallet').doc('main'), {
        balance: 0
      });

      await assertSucceeds(batch.commit());
    });

    it('Leader signup: creates team doc, user doc with leader role, private doc, and zero wallet', async () => {
      const db = getAuthedDB({ uid: 'leader1' });
      
      // 1. Team creation
      await assertSucceeds(db.collection('teams').doc('team_alpha').set({
        teamId: 'team_alpha',
        teamName: 'Alpha Squad',
        code: 'NPC123456',
        leaderId: 'leader1',
        members: ['leader1'],
        maxMembers: 5
      }));

      // 2. User profile + wallet batch
      const batch = db.batch();
      batch.set(db.collection('users').doc('leader1'), {
        uid: 'leader1',
        nickname: 'AlphaLeader',
        freeFireUid: '87654321',
        role: 'leader',
        isAdmin: false,
        isLeader: true,
        teamId: 'team_alpha',
        teamName: 'Alpha Squad',
        teamCode: 'NPC123456'
      });
      batch.set(db.collection('users').doc('leader1').collection('private').doc('data'), {
        email: 'leader1@example.com',
        age: 22
      });
      batch.set(db.collection('users').doc('leader1').collection('wallet').doc('main'), {
        balance: 0
      });

      await assertSucceeds(batch.commit());
    });

    it('Join Member signup: adds member to existing team and commits user profile', async () => {
      // Seed existing team
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const adminDb = context.firestore();
        await adminDb.collection('teams').doc('team_alpha').set({
          teamId: 'team_alpha',
          teamName: 'Alpha Squad',
          code: 'NPC123456',
          leaderId: 'leader1',
          members: ['leader1'],
          maxMembers: 5
        });
      });

      const db = getAuthedDB({ uid: 'member1' });
      
      // 1. Join team
      await assertSucceeds(db.collection('teams').doc('team_alpha').update({
        members: ['leader1', 'member1']
      }));

      // 2. Member profile + wallet batch
      const batch = db.batch();
      batch.set(db.collection('users').doc('member1'), {
        uid: 'member1',
        nickname: 'AlphaMember',
        freeFireUid: '99887766',
        role: 'member',
        isAdmin: false,
        isLeader: false,
        teamId: 'team_alpha',
        teamName: 'Alpha Squad',
        teamCode: 'NPC123456'
      });
      batch.set(db.collection('users').doc('member1').collection('private').doc('data'), {
        email: 'member1@example.com',
        age: 19
      });
      batch.set(db.collection('users').doc('member1').collection('wallet').doc('main'), {
        balance: 0
      });

      await assertSucceeds(batch.commit());
    });
  });

  describe('9. In-App and Push Notification Flow', () => {
    it('Teammate or Admin can send notification to user, user can mark read and delete', async () => {
      // Alice sends notification to Bob
      const aliceDb = getAuthedDB({ uid: 'alice' });
      const notifRef = aliceDb.collection('users').doc('bob').collection('notifications').doc('match_alert');
      await assertSucceeds(notifRef.set({
        type: 'room_details',
        title: 'Room Details',
        message: 'Room 123 Pass 456',
        read: false
      }));

      // Bob reads his notification
      const bobDb = getAuthedDB({ uid: 'bob' });
      const bobNotif = bobDb.collection('users').doc('bob').collection('notifications').doc('match_alert');
      await assertSucceeds(bobNotif.get());

      // Bob marks as read
      await assertSucceeds(bobNotif.update({ read: true }));

      // Bob deletes notification
      await assertSucceeds(bobNotif.delete());
    });
  });

  describe('10. Anti-Duplicate UTR Submission Flow', () => {
    it('prevents submitting the same 12-digit UTR more than once', async () => {
      const db = getAuthedDB({ uid: 'alice' });
      const utrRef = db.collection('submitted_utrs').doc('123456789012');

      // First submission succeeds
      await assertSucceeds(utrRef.set({
        userId: 'alice',
        submittedAt: new Date()
      }));

      // Second submission with identical UTR fails (already exists)
      const bobDb = getAuthedDB({ uid: 'bob' });
      const duplicateRef = bobDb.collection('submitted_utrs').doc('123456789012');
      await assertFails(duplicateRef.set({
        userId: 'bob',
        submittedAt: new Date()
      }));
    });
  });

  describe('11. Admin Panel Operations and Collection Group Listeners', () => {
    it('admin with verified admin email can read collectionGroup queries and manage data', async () => {
      const adminDb = getAuthedDB({ uid: 'admin_user', email: 'ariyanabedin69@gmail.com' });

      // Admin collection group read
      await assertSucceeds(adminDb.collectionGroup('verifications').get());
      await assertSucceeds(adminDb.collectionGroup('upcomingRegistrations').get());

      // Admin approves verification
      const verifRef = adminDb.collection('tournaments').doc('t1').collection('verifications').doc('team1');
      await assertSucceeds(verifRef.set({
        status: 'approved',
        paymentStatus: 'verified',
        teamName: 'Alpha'
      }));

      // Admin credits user wallet
      const walletRef = adminDb.collection('users').doc('alice').collection('wallet').doc('main');
      await assertSucceeds(walletRef.set({ balance: 500 }));

      // Admin approves withdrawal request
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection('withdrawal_requests').doc('req1').set({
          userId: 'alice',
          amount: 200,
          status: 'pending'
        });
      });
      const reqRef = adminDb.collection('withdrawal_requests').doc('req1');
      await assertSucceeds(reqRef.update({ status: 'completed' }));
    });

    it('manages broadcastNotifications: public read, admin write only', async () => {
      const adminDb = getAuthedDB({ uid: 'admin_user', email: 'ariyanabedin69@gmail.com' });
      const userDb = getAuthedDB({ uid: 'regular_user' });
      const unauthDb = getUnauthedDB();

      // Non-admin write fails
      await assertFails(userDb.collection('broadcastNotifications').doc('b1').set({
        title: 'Hacked',
        message: 'Spam'
      }));

      // Admin write succeeds
      await assertSucceeds(adminDb.collection('broadcastNotifications').doc('b1').set({
        title: 'Tournament Alert',
        message: 'Room details in 10 mins'
      }));

      // Public and authenticated read succeeds
      await assertSucceeds(userDb.collection('broadcastNotifications').doc('b1').get());
      await assertSucceeds(unauthDb.collection('broadcastNotifications').doc('b1').get());
    });
  });
});
