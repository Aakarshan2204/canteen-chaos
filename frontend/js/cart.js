/* cart.js - the cart panel: lines, undo, coupon box, and the running
   bill. The numbers on screen always come from the server quote; this
   file never adds up money itself. */

const cartPanel = $('#cartPanel');
const cartOverlay = $('#cartOverlay');
const cartItemsBox = $('#cartItems');
const cartError = $('#cartError');
const couponInput = $('#couponInput');
const couponMsg = $('#couponMsg');
const couponHints = $('#couponHints');

let quoteRequestId = 0;

/* -------------------------------------------------------- rendering */

function renderCartLines() {
  const items = cartItems();
  setText('#cartCount', cartCount());

  if (items.length === 0) {
    render(cartItemsBox, '<p class="cart-empty">Your cart is empty.<br><small>Add something from the menu.</small></p>');
    return;
  }

  render(
    cartItemsBox,
    items
      .map(({ dishId, qty }) => {
        const dish = state.dishes.find((d) => d.id === dishId) || (state.dishCache && state.dishCache[dishId]);
        const line = state.quote && state.quote.lines && state.quote.lines.find((l) => l.dishId === dishId);
        const name = (dish && dish.name) || (line && line.name) || `Dish #${dishId}`;
        const price = line ? rupees(line.lineTotal) : (dish ? rupees(dish.price * qty) : '...');
        const stockNote = dish && dish.stock !== undefined
          ? html`<small class="muted">In stock: ${dish.stock}${qty > dish.stock ? ' · cart quantity exceeds stock' : ''}</small>`
          : '';

        return html`<div class="cart-line" data-id="${dishId}">
          <div class="cart-line-main">
            <span class="cart-line-name">${name}</span>
            ${raw(stockNote)}
            <span class="cart-line-price">${price}</span>
          </div>
          <div class="cart-line-actions">
            <button class="qty-btn small" data-cart="dec" aria-label="One less ${name}">&minus;</button>
            <span class="qty-value">${qty}</span>
            <button class="qty-btn small" data-cart="inc" aria-label="One more ${name}">+</button>
            <button class="link-btn" data-cart="remove">Remove</button>
          </div>
        </div>`;
      })
      .join('')
  );
}

function renderBill(quote) {
  const rows = {
    subtotal: quote ? quote.subtotal : 0,
    packing: quote ? quote.packing : 0,
    gst: quote ? quote.gst : 0,
    total: quote ? quote.total : 0,
  };

  Object.entries(rows).forEach(([id, value]) => setText(`#${id}`, rupees(value)));

  toggleRow('#comboRow', '#comboValue', quote && quote.comboDiscount);
  toggleRow('#couponRow', '#couponValue', quote && quote.couponDiscount);
  toggleRow('#pointsRow', '#pointsValue', quote && quote.pointsValue);
  toggleRow('#rushRow', '#rushValue', quote && quote.rushSurcharge, false);
  toggleRow('#tipRow', '#tipValue', quote && quote.tip, false);

  if (quote && quote.couponCode) setText('#couponLabel', `Coupon ${quote.couponCode}`);
  setText('#earnNote', quote ? `You will earn ${quote.pointsEarned} points` : '');

  if (!quote) return (couponMsg.hidden = true);

  if (quote.couponError && state.checkout.couponCode) {
    couponMsg.textContent = quote.couponError;
    couponMsg.className = 'coupon-msg bad';
    couponMsg.hidden = false;
  } else if (quote.couponCode) {
    couponMsg.textContent = `${quote.couponCode} applied`;
    couponMsg.className = 'coupon-msg good';
    couponMsg.hidden = false;
  } else {
    couponMsg.hidden = true;
  }
}

/** Discount rows are hidden at zero; charges show a plus, discounts a minus. */
function toggleRow(rowSelector, valueSelector, amount, isDiscount = true) {
  const row = $(rowSelector);
  if (!row) return;

  const value = Number(amount) || 0;
  row.hidden = value <= 0;
  setText(valueSelector, (isDiscount ? '- ' : '+ ') + rupees(value));
}

/** Ask the server what this cart costs, with everything applied. */
async function refreshQuote() {
  const myRequest = ++quoteRequestId;
  const items = cartItems();

  renderCartLines();
  cartError.hidden = true;

  if (items.length === 0) {
    state.quote = null;
    renderBill(null);
    setCheckoutEnabled(false);
    return;
  }

  try {
    const quote = await api.quote(orderPayload());
    if (myRequest !== quoteRequestId) return;

    state.quote = quote;
    state.rushHour = quote.rushHour;
    state.dishCache = state.dishCache || {};
    (quote.lines || []).forEach((l) => {
      state.dishCache[l.dishId] = { id: l.dishId, name: l.name, price: l.price, category: l.category };
    });
    renderCartLines();
    renderBill(quote);
    setCheckoutEnabled(true);

    if (quote.pointsError) toast(quote.pointsError, 'warn');
  } catch (err) {
    if (err.cancelled || myRequest !== quoteRequestId) return;

    cartError.textContent = err.message;
    cartError.hidden = false;
    setCheckoutEnabled(false);
  }
}

function setCheckoutEnabled(enabled) {
  const button = $('#goCheckoutBtn');
  if (button) button.disabled = !enabled;
}

async function loadCouponHints() {
  try {
    const { coupons } = await api.getCoupons();
    render(
      couponHints,
      coupons
        .map((c) => html`<button class="coupon-chip" data-code="${c.code}" title="${c.description}">${c.code} · ${c.usesLeft} left</button>`)
        .join('')
    );
  } catch (e) {
    couponHints.innerHTML = '';
  }
}

/* ---------------------------------------------------------- opening */

function openCart() {
  cartPanel.hidden = false;
  cartOverlay.hidden = false;
  document.body.classList.add('no-scroll');
  refreshQuote();
}

function closeCart() {
  cartPanel.hidden = true;
  cartOverlay.hidden = true;
  if (!topModal()) document.body.classList.remove('no-scroll');
}

$('#cartBtn').addEventListener('click', openCart);
$('#cartClose').addEventListener('click', closeCart);
cartOverlay.addEventListener('click', closeCart);

/* ----------------------------------------------------- interactions */

delegate(cartItemsBox, '[data-cart]', 'click', (e, node) => {
  const line = node.closest('.cart-line');
  const dishId = Number(line.dataset.id);
  const dish = state.dishes.find((d) => d.id === dishId) || (state.dishCache && state.dishCache[dishId]) || { id: dishId, stock: 99 };
  const action = node.dataset.cart;

  if (action === 'remove') {
    const name = $('.cart-line-name', line).textContent;
    removeFromCart(dishId);
    toast(`${name} removed`, 'info', {
      action: { label: 'Undo', onClick: () => { undoRemove(); refreshQuote(); } },
    });
  } else {
    const result = addToCart(dish, action === 'inc' ? 1 : -1);
    if (!result.ok) toast(result.reason, 'warn');
  }

  refreshQuote();
});

delegate(couponHints, '.coupon-chip', 'click', (e, node) => {
  couponInput.value = node.dataset.code;
  applyCoupon();
});

$('#couponBtn').addEventListener('click', applyCoupon);
couponInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyCoupon();
});

function applyCoupon() {
  const result = checkField('coupon', couponInput.value);

  if (!result.ok) {
    couponMsg.textContent = result.message;
    couponMsg.className = 'coupon-msg bad';
    couponMsg.hidden = false;
    return;
  }

  setCheckout({ couponCode: result.value || null });
  refreshQuote();
}

$('#goCheckoutBtn').addEventListener('click', () => {
  closeCart();
  openCheckout();
});

$('#clearCartBtn').addEventListener('click', () => {
  if (cartCount() === 0) return;
  clearCart();
  couponInput.value = '';
  refreshQuote();
  toast('Cart cleared', 'info');
});

/* the cart can change from anywhere, so keep the badge and bill in step */
on('cart', () => {
  setText('#cartCount', cartCount());
  if (!cartPanel.hidden) refreshQuote();
});
