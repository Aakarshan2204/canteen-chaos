/* staff.js - the counter dashboard: live queue, status buttons, stats,
   a small hourly bar strip, and stock control. */

const staffRows = $('#staffRows');
const statRow = $('#statRow');
const stockList = $('#stockList');
const liveToggle = $('#liveToggle');
const hourStrip = $('#hourStrip');
const staffFilter = $('#staffFilter');

const REFRESH_EVERY = 5000;
let staffTimer = null;
let staffBusy = false;

/* ------------------------------------------------------------ loop */

function startStaffLoop() {
  stopStaffLoop();
  loadStaff();
  if (liveToggle.checked) staffTimer = setInterval(loadStaff, REFRESH_EVERY);
}

function stopStaffLoop() {
  if (staffTimer) clearInterval(staffTimer);
  staffTimer = null;
}

liveToggle.addEventListener('change', () => (liveToggle.checked ? startStaffLoop() : stopStaffLoop()));

staffFilter.addEventListener('change', () => loadStaff());

async function loadStaff() {
  if (document.hidden || staffBusy) return;
  staffBusy = true;

  try {
    const status = staffFilter.value === 'all' ? '' : staffFilter.value;
    const [{ orders, stalled }, stats] = await Promise.all([
      api.listOrders({ status, limit: 50 }),
      api.stats(),
    ]);

    state.staffOrders = orders;
    state.stats = stats;
    state.rushHour = stats.rushHour;

    renderStats(stats);
    renderHourStrip(stats.byHour);
    renderStaffRows(orders, stalled);
  } catch (err) {
    if (err.cancelled) return;
    toast(err.message, 'bad');
    stopStaffLoop();
    liveToggle.checked = false;
  } finally {
    staffBusy = false;
  }
}

/* -------------------------------------------------------- rendering */

function renderStats(stats) {
  const tiles = [
    { label: 'In queue', value: stats.queue, warn: stats.queue > 6 },
    { label: 'Stalled', value: stats.stalled, warn: stats.stalled > 0 },
    { label: 'Orders', value: stats.orders },
    { label: 'Revenue', value: rupees(stats.revenue) },
    { label: 'Avg order', value: rupees(stats.averageOrder) },
    { label: 'Sold out', value: stats.soldOut, warn: stats.soldOut > 5 },
  ];

  render(
    statRow,
    tiles
      .map(
        (t) => html`<div class="stat-tile ${t.warn ? 'warn' : ''}">
          <span class="stat-value">${t.value}</span>
          <span class="stat-label">${t.label}</span>
        </div>`
      )
      .join('')
  );
}

function renderHourStrip(byHour) {
  const hours = Object.keys(byHour).map(Number).sort((a, b) => a - b);
  if (hours.length === 0) return (hourStrip.innerHTML = '');

  const peak = Math.max(...Object.values(byHour));

  render(
    hourStrip,
    hours
      .map(
        (h) => html`<div class="hour-col" title="${byHour[h]} orders at ${h}:00">
          <span class="hour-bar" style="height:${Math.round((byHour[h] / peak) * 100)}%"></span>
          <span class="hour-label">${h}</span>
        </div>`
      )
      .join('')
  );
}

function renderStaffRows(orders, stalled = []) {
  if (orders.length === 0) {
    return render(staffRows, '<tr><td colspan="8" class="empty-row">Nothing here right now.</td></tr>');
  }

  render(
    staffRows,
    orders
      .map((o) => {
        const next = o.allowedNext.filter((s) => s !== 'cancelled' && s !== 'refunded');
        const isStalled = stalled.includes(o.token);

        return html`<tr data-token="${o.token}" class="row-${o.status} ${isStalled ? 'stalled' : ''}">
          <td class="mono">${o.token}${o.manual ? ' 📌' : ''}</td>
          <td class="items-cell">${raw(o.items.map((l) => html`${l.name} x${l.qty}`).join('<br>'))}</td>
          <td>${o.hostelRoom || '-'}</td>
          <td>${o.pickupSlot ? prettyClock(o.pickupSlot) : '-'}</td>
          <td class="mono">${rupees(o.total)}</td>
          <td>${clockString(o.placedAt)}</td>
          <td><span class="pill pill-${o.status}">${o.status}</span></td>
          <td class="action-cell">
            ${raw(
              next.length
                ? html`<button class="mini-btn" data-next="${next[0]}">Mark ${next[0]}</button>`
                : '<span class="muted">done</span>'
            )}
            ${raw(
              o.allowedNext.includes('cancelled')
                ? '<button class="mini-btn ghost" data-next="cancelled">Cancel</button>'
                : ''
            )}
            ${raw(
              o.allowedNext.includes('refunded')
                ? '<button class="mini-btn ghost" data-next="refunded">Refund</button>'
                : ''
            )}
          </td>
        </tr>`;
      })
      .join('')
  );
}

/* ----------------------------------------------------- interactions */

delegate(staffRows, '[data-next]', 'click', async (e, node) => {
  const token = node.closest('tr').dataset.token;
  const next = node.dataset.next;

  node.disabled = true;
  node.textContent = '...';

  try {
    // a hand-moved order is pinned, so the auto-kitchen leaves it alone
    await api.setStatus(token, next, true);
    if (next === 'cancelled') toast(`${token} cancelled`, 'info');
    if (next === 'refunded') toast(`${token} refunded`, 'info');
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    await loadStaff();
  }
});

/* ------------------------------------------------------------ stock */

async function loadStock() {
  render(stockList, skeletonRows(4));

  try {
    const data = await api.getMenu({ limit: 48, sort: 'name-asc' });

    render(
      stockList,
      data.dishes
        .map(
          (d) => html`<div class="stock-row ${d.stock === 0 ? 'out' : ''} ${d.disabled ? 'off' : ''}" data-id="${d.id}">
            <span class="stock-name">${d.name}</span>
            <span class="stock-slot">${d.category}</span>
            <input type="number" class="stock-input" min="0" max="99" value="${d.stock}"
                   aria-label="Stock for ${d.name}" />
            <button class="mini-btn" data-stock="save">Save</button>
            <button class="mini-btn ghost" data-stock="toggle">${d.disabled ? 'Put back' : 'Take off'}</button>
          </div>`
        )
        .join('')
    );
  } catch (err) {
    render(stockList, errorBlock(err, 'stockRetry'));
    const retry = $('#stockRetry');
    if (retry) retry.addEventListener('click', loadStock);
  }
}

delegate(stockList, '[data-stock]', 'click', async (e, node) => {
  const row = node.closest('.stock-row');
  const id = row.dataset.id;

  node.disabled = true;

  try {
    if (node.dataset.stock === 'save') {
      const result = checkField('stock', $('.stock-input', row).value);
      if (!result.ok) return toast(result.message, 'warn');

      const dish = await api.setStock(id, Number(result.value));
      row.classList.toggle('out', dish.stock === 0);
      toast(`${dish.name}: ${dish.stock} left`, 'ok', { ms: 1600 });
    } else {
      const off = !row.classList.contains('off');
      const dish = await api.setDishAvailability(id, off);
      row.classList.toggle('off', off);
      node.textContent = off ? 'Put back' : 'Take off';
      toast(`${dish.name} ${off ? 'taken off the menu' : 'back on the menu'}`, 'info');
    }

    api.clearCache('/menu');
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    node.disabled = false;
  }
});
