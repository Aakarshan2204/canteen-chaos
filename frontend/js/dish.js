/* dish.js - the dish detail modal: rating breakdown, what people buy
   with it, and its own add-to-cart. */

const dishModal = $('#dishModal');
const dishBody = $('#dishModalBody');

let openDishId = null;

async function openDishModal(dishId) {
  openDishId = Number(dishId);
  rememberViewed(openDishId);

  render(dishBody, `<div class="dish-detail-loading">${skeletonRows(3)}</div>`);
  openModal('dishModal', { onClose: () => { openDishId = null; } });

  try {
    const dish = await api.getDish(dishId);
    if (openDishId !== Number(dishId)) return; // they opened another one already
    renderDishDetail(dish);
  } catch (err) {
    if (err.cancelled) return;
    render(dishBody, errorBlock(err, 'dishRetry'));
    const retry = $('#dishRetry');
    if (retry) retry.addEventListener('click', () => openDishModal(dishId));
  }
}

function renderDishDetail(dish) {
  const fav = isFavourite(dish.id);
  const bars = [5, 4, 3, 2, 1]
    .map(
      (stars) => html`<div class="bar-row">
        <span class="bar-label">${stars}&#9733;</span>
        <span class="bar"><span class="bar-fill" style="width:${dish.ratingBreakdown[stars] || 0}%"></span></span>
        <span class="bar-pct">${dish.ratingBreakdown[stars] || 0}%</span>
      </div>`
    )
    .join('');

  const alsoBought = dish.alsoBought.length
    ? dish.alsoBought
        .map(
          (d) => html`<button class="also-card" data-open="${d.id}">
            <img src="${d.image}" alt="" />
            <span class="also-name">${d.name}</span>
            <span class="also-price">${rupees(d.price)}</span>
          </button>`
        )
        .join('')
    : '<p class="status-sub">Nothing yet — be the first.</p>';

  const waitTime =
    dish.minutesUntilSlot < 60
      ? `${dish.minutesUntilSlot} min`
      : `about ${Math.round(dish.minutesUntilSlot / 60)} hr`;
  const waitNote =
    dish.servedNow || dish.minutesUntilSlot === null
      ? ''
      : html`<p class="dish-wait">Served again in ${waitTime}</p>`;

  render(
    dishBody,
    html`<div class="dish-detail">
      <img class="detail-img" src="${dish.image}" alt="${dish.name}" />

      <div class="detail-head">
        <h2 id="dishModalTitle">${dish.name}</h2>
        <button class="fav-btn inline ${fav ? 'on' : ''}" data-fav="${dish.id}"
                aria-pressed="${fav}" aria-label="Save ${dish.name}">&#9733;</button>
      </div>

      <div class="dish-meta">
        <span class="veg-dot ${dish.veg ? '' : 'nonveg'}"></span>
        <span>${dish.category}</span>
        <span>~${dish.prepMinutes} min</span>
        ${raw(dish.spicy ? '<span class="spicy">&#127798;</span>' : '')}
        ${raw((dish.tags || []).map((t) => html`<span class="tag">${t}</span>`).join(''))}
      </div>

      <div class="detail-price-row">
        <span class="dish-price big">${rupees(dish.price)}</span>
        <span class="stock-note ${dish.stock <= 3 ? 'low' : ''}">
          ${dish.stock > 0 ? `${dish.stock} left today` : 'Sold out'}
        </span>
      </div>

      ${raw(waitNote)}

      <div class="rating-block">
        <div class="rating-score">
          <span class="score">${dish.rating}</span>
          <span class="stars">${raw(starRow(dish.rating))}</span>
          <span class="rating-count">${dish.ratingCount} ratings</span>
        </div>
        <div class="rating-bars">${raw(bars)}</div>
      </div>

      <div class="detail-actions">
        ${raw(detailQtyControl(dish))}
      </div>

      <h3 class="also-title">Often bought with</h3>
      <div class="also-row">${raw(alsoBought)}</div>
    </div>`
  );
}

function detailQtyControl(dish) {
  const qty = cartQty(dish.id);

  if (!dish.orderable) {
    return html`<button class="primary-btn" disabled>${dish.blockedReason || 'Not available'}</button>`;
  }

  if (qty > 0) {
    return html`<div class="qty-row big">
      <button class="qty-btn" data-detail="dec" aria-label="One less">&minus;</button>
      <span class="qty-value">${qty}</span>
      <button class="qty-btn" data-detail="inc" aria-label="One more">+</button>
      <button class="ghost-btn" data-detail="view">View cart</button>
    </div>`;
  }

  return '<button class="primary-btn" data-detail="add">Add to Cart</button>';
}

/* ----------------------------------------------------- interactions */

delegate(dishBody, '[data-detail]', 'click', async (e, node) => {
  const dish = state.dishes.find((d) => d.id === openDishId) || { id: openDishId, stock: 99 };
  const action = node.dataset.detail;

  if (action === 'view') {
    closeModal('dishModal');
    openCart();
    return;
  }

  const result = addToCart(dish, action === 'dec' ? -1 : 1);
  if (!result.ok) return toast(result.reason, 'warn');

  const fresh = await api.getDish(openDishId).catch(() => null);
  if (fresh) render($('.detail-actions', dishBody), detailQtyControl(fresh));
});

delegate(dishBody, '[data-fav]', 'click', (e, node) => {
  const on = toggleFavourite(node.dataset.fav);
  node.classList.toggle('on', on);
  node.setAttribute('aria-pressed', String(on));
});

delegate(dishBody, '[data-open]', 'click', (e, node) => {
  closeModal('dishModal');
  openDishModal(Number(node.dataset.open));
});
