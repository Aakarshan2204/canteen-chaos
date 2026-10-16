// routes/staff.routes.js
// The counter side: stock, taking a dish off the menu, and the numbers
// on the dashboard.

const express = require('express');

const store = require('../store');
const pricing = require('../logic/pricing');
const statusLogic = require('../logic/status');
const recommend = require('../logic/recommend');
const scheduling = require('../logic/scheduling');
const availability = require('../logic/availability');

const { asyncHandler, badRequest, notFound } = require('../middleware/errors');

const router = express.Router();

// PATCH /api/menu/:id/stock   { stock }
router.patch(
  '/menu/:id/stock',
  asyncHandler((req, res) => {
    const { stock } = req.body || {};
    if (!Number.isInteger(stock) || stock < 0 || stock > 99) {
      throw badRequest('stock must be a whole number between 0 and 99');
    }

    const dish = pricing.findDish(req.params.id, store.readMenu());
    if (!dish) throw notFound('Dish not found');

    const next = store.readMenu().map((d) => (d.id === dish.id ? { ...d, stock } : d));
    store.writeMenu(next);

    res.json({ ...dish, stock, orderable: availability.isOrderable({ ...dish, stock }, new Date()) });
  })
);

// PATCH /api/menu/:id/availability   { disabled }
router.patch(
  '/menu/:id/availability',
  asyncHandler((req, res) => {
    const { disabled } = req.body || {};
    if (typeof disabled !== 'boolean') throw badRequest('disabled must be true or false');

    const dish = pricing.findDish(req.params.id, store.readMenu());
    if (!dish) throw notFound('Dish not found');

    const next = store.readMenu().map((d) => (d.id === dish.id ? { ...d, disabled } : d));
    store.writeMenu(next);

    res.json({ ...dish, disabled });
  })
);

// GET /api/stats
router.get(
  '/stats',
  asyncHandler((req, res) => {
    const now = new Date();
    const orders = store.read('orders');
    const menu = store.readMenu();
    const live = orders.filter((o) => o.status !== 'cancelled' && o.status !== 'refunded');

    const revenue = live.reduce((sum, o) => sum + o.total, 0);
    const tips = live.reduce((sum, o) => sum + (o.tip || 0), 0);
    const discounts = live.reduce(
      (sum, o) => sum + o.comboDiscount + o.couponDiscount + (o.pointsValue || 0),
      0
    );

    // orders per hour, for the little bar strip
    const byHour = {};
    live.forEach((o) => {
      const hour = new Date(o.placedAt).getHours();
      byHour[hour] = (byHour[hour] || 0) + 1;
    });

    res.json({
      orders: orders.length,
      queue: statusLogic.queueLength(orders),
      stalled: statusLogic.stalledOrders(orders, now).length,
      revenue: pricing.round2(revenue),
      tips: pricing.round2(tips),
      discounts: pricing.round2(discounts),
      averageOrder: live.length ? pricing.round2(revenue / live.length) : 0,
      soldOut: menu.filter((d) => d.stock === 0).length,
      disabled: menu.filter((d) => d.disabled).length,
      rushHour: scheduling.isRushHour(now),
      slot: availability.currentSlot(now),
      topDishes: recommend.topDishes(orders, 5),
      byHour,
      slotLoad: scheduling.bookingCounts(orders),
    });
  })
);

module.exports = { router };
