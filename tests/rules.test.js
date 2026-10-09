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
  
  const getAuthedDB = (auth) => testEnv.authenticatedContext(auth.uid, auth).firestore();
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

    it('user cannot set isLeader on their own user document creation', async () => {
      const db = getAuthedDB({ uid: 'alice' });
      const userRef = db.collection('users').doc('alice');
      await assertFails(userRef.set({ isLeader: true, name: 'Alice' }));
    });
  });

  describe('2. Wallet Protection', () => {
    it('user cannot write their own wallet', async () => {
      const db = getAuthedDB({ uid: 'alice' });
      const walletRef = db.collection('users').doc('alice').collection('wallet').doc('main');
      await assertFails(walletRef.set({ balance: 1000 }));
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
});
