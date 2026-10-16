// logic/status.js
// The life of an order: what it may become next, how long it should take,
// and the little kitchen simulation that moves orders along on its own.

const FLOW = ['placed', 'accepted', 'preparing', 'ready', 'picked'];
const TERMINAL = ['picked', 'cancelled', 'refunded'];

// how long each stage should take before the kitchen moves it on (seconds)
const AUTO_AFTER = { placed: 20, accepted: 25, preparing: 60 };

function allowedNext(status) {
  if (TERMINAL.includes(status) && status !== 'picked') return [];

  const i = FLOW.indexOf(status);
  if (i === -1) return [];

  const next = [];
  if (FLOW[i + 1]) next.push(FLOW[i + 1]);

  // a student may cancel until the kitchen actually starts cooking
  if (status === 'placed' || status === 'accepted') next.push('cancelled');
  // staff can refund something already handed over
  if (status === 'picked') next.push('refunded');

  return next;
}

function canTransition(from, to) {
  if (from === to) return { ok: false, reason: `Order is already ${to}` };
  if (!FLOW.includes(to) && !['cancelled', 'refunded'].includes(to)) {
    return { ok: false, reason: `Unknown status "${to}"` };
  }
  if (TERMINAL.includes(from) && from !== 'picked') {
    return { ok: false, reason: `A ${from} order cannot change` };
  }
  if (!allowedNext(from).includes(to)) {
    return { ok: false, reason: `Cannot go from ${from} to ${to}` };
  }
  return { ok: true, reason: null };
}

/** Add a status to an order and stamp the time. Returns a new order. */
function advance(order, to, at = new Date()) {
  return {
    ...order,
    status: to,
    history: order.history.concat({ status: to, at: at.toISOString() }),
    updatedAt: at.toISOString(),
  };
}

/** Seconds since this order last changed. */
function ageSeconds(order, now = new Date()) {
  const last = order.history[order.history.length - 1];
  return (now - new Date(last.at)) / 1000;
}

/**
 * Minutes until the food is ready.
 * The slowest dish sets the floor, a big order adds to it, the queue ahead
 * adds more, and the lunch crush stretches everything.
 */
function estimateMinutes(lines, menu, { queueAhead = 0, rush = false } = {}) {
  if (lines.length === 0) return 0;

  const prepTimes = lines.map((l) => {
    const dish = menu.find((d) => d.id === Number(l.dishId));
    return dish ? dish.prepMinutes : 8;
  });

  const slowest = Math.max(...prepTimes);
  const units = lines.reduce((sum, l) => sum + l.qty, 0);
  const bulk = Math.floor(units / 4) * 2;
  const queue = Math.ceil(queueAhead / 2) * 3;
  const raw = (slowest + bulk + queue) * (rush ? 1.3 : 1);

  return Math.min(Math.round(raw), 45);
}

function queueLength(orders) {
  return orders.filter((o) => ['placed', 'accepted', 'preparing'].includes(o.status)).length;
}

/** Orders sitting in one stage far too long, for the staff view. */
function stalledOrders(orders, now = new Date(), thresholdSeconds = 300) {
  return orders.filter(
    (o) => !TERMINAL.includes(o.status) && ageSeconds(o, now) > thresholdSeconds
  );
}

/**
 * The kitchen tick. Moves orders that have waited long enough,
 * unless staff have pinned them (o.manual === true).
 * Returns { orders, moved }.
 */
function autoAdvance(orders, now = new Date()) {
  let moved = 0;

  const next = orders.map((order) => {
    if (order.manual) return order;

    const wait = AUTO_AFTER[order.status];
    if (wait === undefined) return order;
    if (ageSeconds(order, now) < wait) return order;

    const to = allowedNext(order.status)[0];
    if (!to) return order;

    moved += 1;
    return advance(order, to, now);
  });

  return { orders: next, moved };
}

module.exports = {
  FLOW,
  TERMINAL,
  AUTO_AFTER,
  allowedNext,
  canTransition,
  advance,
  ageSeconds,
  estimateMinutes,
  queueLength,
  stalledOrders,
  autoAdvance,
};
