// extra-tests.js - verify fixes for additional bugs found beyond CC-01 through CC-10.
// Server must be running on :3000.

const BASE = process.env.BASE || 'http://localhost:3000';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, extra = '') {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL ${name} ${extra}`);
  }
}

async function call(path, options = {}) {
  const res = await fetch(BASE + path, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      'X-Member-Id': options.member || 'test-member-99',
      ...(options.idem ? { 'Idempotency-Key': options.idem } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let json = null;
  try {
    json = await res.json();
  } catch (e) {}

  return { status: res.status, json, headers: res.headers };
}

(async () => {
  console.log('--- Extra Bugs Verification Tests ---\n');

  // Test 1: Order memberId filter on GET /api/orders
  console.log('[Test 1] GET /api/orders?memberId=...');
  const memberId = 'member-filter-test-' + Date.now();
  const placedRes = await call('/api/orders', {
    method: 'POST',
    member: memberId,
    body: { items: [{ dishId: 2, qty: 1 }], pickupSlot: null },
  });
  
  if (placedRes.status === 201) {
    const listRes = await call('/api/orders?memberId=' + memberId);
    check('memberId filter returns user orders', listRes.status === 200 && listRes.json.orders.length > 0 && listRes.json.orders[0].memberId === memberId, `Got count: ${listRes.json && listRes.json.orders ? listRes.json.orders.length : 0}`);
  } else {
    // If canteen is closed right now, check with existing orders in store
    const allOrders = await call('/api/orders?limit=10');
    const firstWithMember = (allOrders.json.orders || []).find(o => o.memberId);
    if (firstWithMember) {
      const listRes = await call('/api/orders?memberId=' + firstWithMember.memberId);
      check('memberId filter returns user orders', listRes.status === 200 && listRes.json.orders.length > 0 && listRes.json.orders.some(o => o.memberId === firstWithMember.memberId), `Got count: ${listRes.json && listRes.json.orders ? listRes.json.orders.length : 0}`);
    } else {
      check('memberId filter returns user orders', false, 'no existing orders with memberId');
    }
  }

  // Test 2: Flat tip validation with tipPercent: 0
  console.log('\n[Test 2] Order placement with flat tip and tipPercent=0');
  const { validateOrder } = require('./logic/validation');
  const store = require('./store');
  const menu = store.readMenu();
  const fakeNow = new Date('2026-10-12T10:00:00Z'); // during breakfast
  const tipValidation = validateOrder({
    items: [{ dishId: 2, qty: 1 }],
    tipPercent: 0,
    tipFlat: 15,
  }, menu, { now: fakeNow });
  check('tipPercent: 0 with tipFlat does not error', !tipValidation.errors.includes('Send either a tip percentage or a flat tip, not both'), tipValidation.errors.join(', '));

  // Test 3: Combo discount on single beverage (Masala Chai)
  console.log('\n[Test 3] Combo discount on single beverage');
  const { calculateBill } = require('./logic/pricing');
  const chai = menu.find(d => d.name === 'Masala Chai');
  const singleChaiBill = calculateBill([{ dishId: chai.id, qty: 1 }], menu, { now: fakeNow });
  check('single Masala Chai gets NO combo discount', singleChaiBill.comboDiscount === 0, `got discount: ${singleChaiBill.comboDiscount}`);

  // Test combo discount when buying Chai + Samosa (valid combo)
  const samosa = menu.find(d => d.name === 'Samosa');
  const comboBill = calculateBill([{ dishId: chai.id, qty: 1 }, { dishId: samosa.id, qty: 1 }], menu, { now: fakeNow });
  check('Chai + Samosa gets combo discount of Rs. 15', comboBill.comboDiscount === 15, `got discount: ${comboBill.comboDiscount}`);

  // Test 4: State machine picked -> refunded transition
  console.log('\n[Test 4] State machine picked -> refunded transition');
  const statusLogic = require('./logic/status');
  const nextOfPicked = statusLogic.allowedNext('picked');
  check("allowedNext('picked') includes 'refunded'", nextOfPicked.includes('refunded'), `got: [${nextOfPicked.join(', ')}]`);
  const transition = statusLogic.canTransition('picked', 'refunded');
  check("canTransition('picked', 'refunded') succeeds", transition.ok === true, transition.reason);

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
