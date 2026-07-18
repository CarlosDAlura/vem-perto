(() => {
  const api = window.VemPertoSupabase;
  const qs = selector => document.querySelector(selector);
  const qsa = selector => [...document.querySelectorAll(selector)];
  const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const statusName = value => ({
    awaiting_store_confirmation: 'Aguardando confirmação da loja', accepted_by_store: 'Aceito pela loja',
    rejected_by_store: 'Recusado pela loja', preparing: 'Em preparação', ready_for_pickup: 'Pronto para retirada',
    awaiting_courier: 'Aguardando motoboy', courier_assigned: 'Motoboy atribuído', courier_to_store: 'Motoboy a caminho da loja',
    picked_up: 'Pedido retirado', on_the_way: 'A caminho do cliente', delivered: 'Entregue', cancelled: 'Cancelado'
  })[value] || value;
  const state = { user: null, catalog: { stores: [], categories: [] }, addresses: [], address: null, favorites: [], coupons: [], loyalty: { points_balance: 0 }, orders: [], notifications: [], cart: [], coupon: null, category: 'Todos', favoritesOnly: false, chatOrderId: null, reviewOrderId: null, unlisten: null };

  const toast = text => { const el = qs('#toast'); el.textContent = text; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3100); };
  const modal = selector => qsa('.modal').forEach(item => item.classList.toggle('show', item.matches(selector)));
  const closeModals = () => qsa('.modal').forEach(item => item.classList.remove('show'));
  const validEmail = email => /^\S+@\S+\.\S+$/.test(email);
  const activeStatus = store => {
    if (!store.is_accepting_orders) return { key: 'closed', label: 'Fechado' };
    if (!store.open_time || !store.close_time) return { key: 'open', label: 'Aberto agora' };
    const now = new Date(); const current = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const isOpen = store.open_time <= store.close_time ? current >= store.open_time && current < store.close_time : current >= store.open_time || current < store.close_time;
    if (!isOpen) return { key: 'closed', label: 'Fechado' };
    const minutesToClose = (Number(store.close_time.slice(0, 2)) * 60 + Number(store.close_time.slice(3, 5))) - (now.getHours() * 60 + now.getMinutes());
    return minutesToClose > 0 && minutesToClose <= 45 ? { key: 'closing', label: 'Fecha em breve' } : { key: 'open', label: 'Aberto agora' };
  };
  const deliveryZone = store => {
    if (!state.address) return null;
    const neighborhood = String(state.address.neighborhood || '').trim().toLowerCase();
    return store.zones.find(zone => {
      const name = zone.name.toLowerCase();
      return name === neighborhood || name.startsWith(`${neighborhood} -`) || neighborhood.startsWith(`${name} -`);
    });
  };
  const cartStore = () => state.cart[0]?.store || null;
  const cartTotals = () => {
    const subtotal = state.cart.reduce((total, item) => total + Number(item.product.price) * item.quantity, 0);
    const zone = cartStore() && deliveryZone(cartStore());
    let fee = zone ? Number(zone.base_delivery_fee) : 0;
    let discount = 0;
    if (state.coupon) {
      if (state.coupon.discount_type === 'percent') discount = subtotal * Number(state.coupon.amount) / 100;
      if (state.coupon.discount_type === 'fixed') discount = Number(state.coupon.amount);
      if (state.coupon.discount_type === 'free_delivery') fee = 0;
    }
    return { subtotal, fee, discount: Math.min(discount, subtotal), total: Math.max(0, subtotal + fee - Math.min(discount, subtotal)) };
  };
  function setUser(user) {
    state.user = user;
    qs('#guestActions').hidden = !!user;
    qs('#userActions').hidden = !user;
    if (user) {
      const name = user.profile?.full_name || user.user?.email || 'Você';
      const firstName = name.split(' ')[0];
      qs('#userName').textContent = firstName;
      qs('#userInitial').textContent = firstName.slice(0, 1).toUpperCase();
      qs('#welcomeTitle').textContent = `Olá, ${firstName}`;
      qs('#welcomeSubtitle').textContent = 'O que você quer pedir hoje?';
    } else {
      qs('#userInitial').textContent = 'VP';
      qs('#welcomeTitle').textContent = 'Seu momento, do seu jeito';
      qs('#welcomeSubtitle').textContent = 'Descubra sabores perto de você.';
    }
  }
  function renderAddress() {
    const address = state.address;
    if (!address) {
      qs('#addressHeader').textContent = 'Escolha seu endereço'; qs('#addressTitle').textContent = 'Onde vamos entregar?'; qs('#addressText').textContent = 'Entre e informe seu bairro para ver quem entrega até você.'; return;
    }
    qs('#addressHeader').textContent = address.neighborhood || 'seu endereço';
    qs('#addressTitle').textContent = `Entrega em ${address.street}, ${address.number}`;
    qs('#addressText').textContent = `${address.neighborhood || ''}, ${address.city}. Mostramos somente quem atende esta região.`;
  }
  function renderChips() {
    const icons = { Todos: '✦', Hamburguer: '🍔', Hambúrguer: '🍔', Pizza: '🍕', Saladas: '🥗', Mercado: '🛒', Doces: '🍰', Bebidas: '🥤', Japonês: '🍣', Lanches: '🥪' };
    qs('#chips').innerHTML = ['Todos', ...state.catalog.categories.map(category => category.name)].map(name => `<button class="chip ${state.category === name ? 'on' : ''}" data-cat="${escape(name)}"><span class="chip-icon">${icons[name] || '🍽️'}</span>${escape(name)}</button>`).join('');
  }
  function card(store) {
    const product = store.products[0]; if (!product) return '';
    const status = activeStatus(store); const zone = deliveryZone(store); const favorite = state.favorites.includes(store.id);
    return `<article class="card shop-card ${status.key === 'closed' ? 'closed' : ''}" data-store="${store.id}" tabindex="0" aria-label="Abrir ${escape(store.name)}"><div class="photo-wrap"><img class="photo" src="${escape(product.image_path || 'default-store.svg')}" alt="${escape(product.name)} — ${escape(store.name)}" onerror="this.onerror=null;this.src='default-store.svg'"><span class="shop-status status-${status.key}"><i class="status-dot"></i>${status.label}</span></div><button class="fav ${favorite ? 'on' : ''}" data-favorite="${store.id}" aria-label="Favoritar ${escape(store.name)}">${favorite ? '♥' : '♡'}</button><div class="in"><div class="store-heading"><h3>${escape(store.name)}</h3><span class="rating">★ ${(store.rating || 0).toFixed(1)}</span></div><div class="meta"><span>${escape(store.category_label || product.name)}</span><span>·</span><span>${store.reviewCount} avaliações</span></div><div class="mini-info"><span>🕒 ${product.prep_minutes}–${product.prep_minutes + 10} min</span><span>🛵 ${zone ? money(zone.base_delivery_fee) : 'Ver taxa'}</span></div><p class="featured-product">${escape(product.name)}</p></div><button class="add" data-add="${store.id}" data-product="${product.id}" ${status.key === 'closed' || (state.address && !zone) ? 'disabled' : ''} aria-label="Adicionar ${escape(product.name)}">+</button></article>`;
  }
  function storeById(id) { return state.catalog.stores.find(store => store.id === id); }
  function openStore(id) {
    const store = storeById(id); if (!store) return;
    const status = activeStatus(store); const zone = deliveryZone(store); const favorite = state.favorites.includes(store.id);
    const products = store.products.map(product => `<article class="store-product" data-product-detail="${product.id}" data-store-id="${store.id}"><img src="${escape(product.image_path || 'default-store.svg')}" alt="${escape(product.name)}" onerror="this.onerror=null;this.src='default-store.svg'"><div><h4>${escape(product.name)}</h4><p>${escape(product.description || 'Preparado especialmente para você.')}</p><b>${money(product.price)}</b></div><button class="add" data-add="${store.id}" data-product="${product.id}" ${status.key === 'closed' || (state.address && !zone) ? 'disabled' : ''} aria-label="Adicionar ${escape(product.name)}">+</button></article>`).join('') || '<p class="empty">Este cardápio ainda não tem produtos disponíveis.</p>';
    qs('#storeView').innerHTML = `<div class="store-hero"><img src="${escape(store.products[0]?.image_path || 'default-store.svg')}" alt="${escape(store.name)}" onerror="this.onerror=null;this.src='default-store.svg'"><div class="store-hero-content"><span class="shop-status status-${status.key}"><i class="status-dot"></i>${status.label}</span><h2>${escape(store.name)}</h2><p>★ ${(store.rating || 0).toFixed(1)} · ${store.reviewCount} avaliações · ${escape(store.category_label || 'Delivery')}</p></div><button class="fav ${favorite ? 'on' : ''}" data-favorite="${store.id}" aria-label="Favoritar ${escape(store.name)}">${favorite ? '♥' : '♡'}</button></div><div class="store-summary"><span>🕒 Preparo ${store.products[0]?.prep_minutes || 20} min</span><span>🛵 Entrega ${zone ? money(zone.base_delivery_fee) : 'consulte sua região'}</span><span>Pedido mínimo ${money(store.min_order_amount)}</span></div><section class="store-menu"><div class="section-label"><h3>Cardápio</h3><span>${status.key === 'closed' ? 'Loja fechada' : 'Escolha seus itens'}</span></div>${products}</section>`;
    modal('#storeModal');
  }
  function openProduct(storeId, productId) {
    const store = storeById(storeId); const product = store?.products.find(item => item.id === productId); if (!store || !product) return;
    const status = activeStatus(store);
    qs('#productView').innerHTML = `<img class="product-hero" src="${escape(product.image_path || 'default-store.svg')}" alt="${escape(product.name)}" onerror="this.onerror=null;this.src='default-store.svg'"><section class="product-details"><p class="eyebrow">${escape(store.name)}</p><h2>${escape(product.name)}</h2><p>${escape(product.description || 'Uma escolha preparada com ingredientes selecionados.')}</p><div class="product-meta"><span>🕒 ${product.prep_minutes} min</span><span>★ ${(store.rating || 0).toFixed(1)}</span></div><div class="product-buy"><strong>${money(product.price)}</strong><button class="btn red" data-add="${store.id}" data-product="${product.id}" ${status.key === 'closed' ? 'disabled' : ''}>Adicionar à sacola</button></div></section>`;
    modal('#productModal');
  }
  function renderProfile() {
    const name = state.user?.profile?.full_name || state.user?.user?.email || 'Visitante';
    const email = state.user?.user?.email || 'Entre para acessar sua conta';
    qs('#profileContent').innerHTML = `<section class="profile-summary"><span class="profile-large-avatar">${escape(name.slice(0, 1).toUpperCase())}</span><div><h2>${escape(name)}</h2><p>${escape(email)}</p><span class="profile-points">✦ ${state.loyalty.points_balance || 0} pontos Vem Perto</span></div></section><section class="profile-links"><button data-profile-action="orders"><span>📦</span> Meus pedidos <b>›</b></button><button data-profile-action="favorites"><span>♡</span> Favoritos <b>›</b></button><button data-profile-action="coupons"><span>🏷️</span> Cupons e fidelidade <b>›</b></button><button data-profile-action="address"><span>⌖</span> Endereços <b>›</b></button><button data-profile-action="logout" class="profile-logout"><span>↗</span> Sair da conta <b>›</b></button></section>`;
  }
  function renderCatalog() {
    const term = qs('#search').value.trim().toLowerCase();
    let stores = state.catalog.stores.filter(store => {
      const productText = store.products.map(product => `${product.name} ${product.description || ''}`).join(' ').toLowerCase();
      const categoryMatch = state.category === 'Todos' || store.category_label === state.category || store.products.some(product => state.catalog.categories.find(category => category.id === product.category_id)?.name === state.category);
      return categoryMatch && (`${store.name} ${store.category_label || ''} ${productText}`).toLowerCase().includes(term);
    });
    if (state.address) stores = stores.filter(store => deliveryZone(store));
    if (state.favoritesOnly) stores = stores.filter(store => state.favorites.includes(store.id));
    qs('#listingTitle').textContent = state.favoritesOnly ? 'Seus favoritos' : 'Para pedir agora';
    qs('#result').textContent = `${stores.length} ${stores.length === 1 ? 'opção' : 'opções'}${state.address ? ' que entregam no seu endereço' : ''}`;
    qs('#grid').innerHTML = stores.length ? stores.map(card).join('') : `<div class="empty" style="grid-column:1/-1"><b>${state.favoritesOnly ? 'Você ainda não salvou favoritos.' : 'Ainda não encontramos entregas nesta região.'}</b><br><small>${state.address ? 'Tente outro endereço ou aguarde novos estabelecimentos.' : 'Informe seu endereço para ver a área de entrega.'}</small></div>`;
  }
  function renderCart() {
    const totals = cartTotals();
    const quantity = state.cart.reduce((total, item) => total + item.quantity, 0);
    qs('#n').textContent = quantity;
    qs('#navCount').textContent = quantity;
    qs('#bagTotal').textContent = money(totals.total);
    qs('#cartStoreName').textContent = cartStore() ? `${cartStore().name} · ${quantity} ${quantity === 1 ? 'item' : 'itens'}` : 'Adicione itens para começar';
    qs('#items').innerHTML = state.cart.length ? state.cart.map((item, index) => `<div class="row cart-item"><span><b>${escape(item.product.name)}</b><br><small>${escape(item.store.name)}</small><span class="qty-stepper"><button data-decrease="${index}" aria-label="Diminuir quantidade">−</button><b>${item.quantity}</b><button data-increase="${index}" aria-label="Aumentar quantidade">+</button></span></span><span class="right"><b>${money(item.product.price * item.quantity)}</b><button class="link" data-remove="${index}">Remover</button></span></div>`).join('') : '<p class="notice emptycart">Sua sacola está vazia.</p>';
    qs('#total').textContent = money(totals.total);
    qs('#couponFeedback').textContent = state.coupon ? `Cupom ${state.coupon.code} aplicado. O valor final será recalculado pelo servidor.` : '';
    return totals;
  }
  async function renderOrders() {
    const orders = state.orders;
    qs('#ordersList').innerHTML = orders.length ? orders.map(order => `<article class="order-card"><div class="row" style="padding:0"><span><b>${escape(order.store?.name || 'Loja')}</b><br><small>${escape(order.public_code)} · ${new Date(order.created_at).toLocaleString('pt-BR')}</small></span><span class="tag right">${statusName(order.status)}</span></div><div class="meta">${order.items.map(item => `${item.quantity}× ${escape(item.product_name_snapshot)}`).join(', ')} · ${money(order.total_amount)}</div><div class="order-actions"><button class="btn" data-track="${order.id}">Acompanhar</button><button class="btn" data-chat-order="${order.id}">Chat</button>${order.status === 'delivered' ? `<button class="btn red" data-review="${order.id}">Avaliar</button>` : ''}</div></article>`).join('') : '<div class="empty">Você ainda não possui pedidos.</div>';
  }
  function trackOrder(id) {
    const order = state.orders.find(item => item.id === id); if (!order) return;
    const timeline = ['awaiting_store_confirmation', 'accepted_by_store', 'preparing', 'ready_for_pickup', 'awaiting_courier', 'courier_assigned', 'courier_to_store', 'picked_up', 'on_the_way', 'delivered'];
    const index = Math.max(0, timeline.indexOf(order.status));
    qs('#trackingOrderText').textContent = `${order.store?.name || 'Loja'} · ${order.public_code}`; qs('#trackingStatus').textContent = statusName(order.status);
    qs('#remainingTime').textContent = order.status === 'delivered' ? '0 min' : `${Math.max(0, Number(order.prep_minutes || 25) + 25 - index * 6)} min`;
    qs('#remainingDistance').textContent = order.status === 'delivered' ? '0 km' : 'Atualização em tempo real';
    qs('#trackingProgress').style.width = `${order.status === 'delivered' ? 100 : Math.max(12, 10 + index * 10)}%`;
    qs('#timeline').innerHTML = timeline.map((step, position) => `<div class="${position < index ? 'done' : position === index ? 'now' : ''}"><span>${position < index ? '✓' : position + 1}</span>${statusName(step)}</div>`).join('');
    modal('#trackingModal');
  }
  function renderCoupons() {
    qs('#loyaltyPoints').textContent = state.loyalty.points_balance || 0; qs('#loyaltyProgress').style.width = `${Math.min(100, state.loyalty.points_balance || 0)}%`;
    qs('#couponList').innerHTML = state.coupons.map(coupon => `<article class="coupon"><span class="pill">${coupon.discount_type === 'free_delivery' ? 'FRETE' : 'CUPOM'}</span><b>${escape(coupon.code)}</b><small>${coupon.discount_type === 'percent' ? `${coupon.amount}% de desconto` : coupon.discount_type === 'fixed' ? `${money(coupon.amount)} de desconto` : 'Frete grátis'}<br>Em pedidos acima de ${money(coupon.min_order_amount)}</small><button class="btn" data-use-coupon="${escape(coupon.code)}">Usar na sacola</button></article>`).join('') || '<p class="empty">Nenhum cupom disponível no momento.</p>';
  }
  function renderNotifications() {
    qs('#notificationCount').textContent = state.notifications.filter(note => !note.read_at).length;
    qs('#notificationsList').innerHTML = state.notifications.length ? state.notifications.map(note => `<article class="notification"><i>🔔</i><div><b>${escape(note.title)}</b><small>${escape(note.body)} · ${new Date(note.created_at).toLocaleString('pt-BR')}</small></div></article>`).join('') : '<p class="empty">Você não possui notificações.</p>';
  }
  async function renderMessages() {
    const order = state.orders.find(item => item.id === state.chatOrderId) || state.orders.find(item => !['delivered', 'cancelled', 'rejected_by_store'].includes(item.status));
    if (!order) { qs('#messages').innerHTML = '<p class="muted">Abra um pedido para conversar com a loja ou motoboy.</p>'; return; }
    state.chatOrderId = order.id;
    const rows = await api.messages(order.id);
    qs('#chatTitle').textContent = `Pedido ${order.public_code} · ${order.store?.name || 'Loja'}`;
    qs('#messages').innerHTML = rows.map(message => `<div class="message ${message.sender_id === state.user?.profile.id ? 'mine' : ''}">${escape(message.body || (message.message_type === 'location' ? '📍 Localização compartilhada' : '📷 Anexo enviado'))}<small>${escape(message.profiles?.full_name || 'Usuário')} · ${new Date(message.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small></div>`).join('') || '<p class="muted">Envie a primeira mensagem sobre este pedido.</p>';
    qs('#messages').scrollTop = qs('#messages').scrollHeight;
  }
  async function refreshPrivate() {
    setUser(await api.identity());
    if (!state.user) { state.addresses = []; state.address = null; state.favorites = []; state.orders = []; state.notifications = []; state.loyalty = { points_balance: 0 }; renderAddress(); renderCatalog(); renderCart(); renderNotifications(); return; }
    const [addresses, favorites, orders, notices, loyalty] = await Promise.all([api.listAddresses(), api.getFavoriteIds(), api.customerOrders(), api.getNotifications(), api.loyalty()]);
    state.addresses = addresses; state.address = addresses[0] || null; state.favorites = favorites; state.orders = orders; state.notifications = notices; state.loyalty = loyalty; renderAddress(); renderCatalog(); renderCart(); renderNotifications();
  }
  function renderSkeleton() {
    qs('#grid').innerHTML = Array.from({ length: 3 }, () => '<article class="card shop-card skeleton-card"><div class="photo skeleton"></div><div class="in"><span class="skeleton line wide"></span><span class="skeleton line"></span><span class="skeleton line short"></span></div></article>').join('');
  }
  async function refreshAll(showLoading = false) {
    if (showLoading) renderSkeleton();
    state.catalog = await api.catalog(); state.coupons = await api.getCoupons(); renderChips(); renderCatalog(); renderCoupons(); await refreshPrivate();
  }
  async function applyCoupon(code) {
    const coupon = state.coupons.find(item => item.code === String(code).trim().toUpperCase());
    if (!coupon) return toast('Cupom inválido.');
    if (cartTotals().subtotal < Number(coupon.min_order_amount)) return toast(`Esse cupom exige pedido mínimo de ${money(coupon.min_order_amount)}.`);
    state.coupon = coupon; renderCart(); toast('Cupom aplicado.');
  }
  async function addStoreProduct(storeId, productId = null) {
    const store = state.catalog.stores.find(item => item.id === storeId); const product = productId ? store?.products.find(item => item.id === productId) : store?.products[0]; if (!store || !product) return;
    if (!state.address || !deliveryZone(store)) return toast('Defina um endereço atendido pela loja.');
    if (cartStore() && cartStore().id !== store.id) return toast('Finalize ou limpe a sacola antes de pedir de outra loja.');
    const existing = state.cart.find(item => item.product.id === product.id);
    if (existing) existing.quantity += 1; else state.cart.push({ store, product, quantity: 1 });
    renderCart(); qs('#cart').classList.add('show');
  }
  async function saveAddressFromForm() {
    if (!state.user) { closeModals(); modal('#loginModal'); return toast('Entre para salvar seu endereço.'); }
    const address = await api.saveAddress({ street: qs('#street').value.trim(), neighborhood: qs('#neighborhood').value, city: qs('#city').value.trim(), complement: qs('#complement').value.trim(), state: 'BR' }, state.address?.id || null);
    state.address = address; state.addresses = [address, ...state.addresses.filter(item => item.id !== address.id)]; renderAddress(); renderCatalog(); renderCart(); closeModals(); toast('Endereço atualizado.');
  }
  async function placeOrder() {
    if (!state.user) { qs('#cart').classList.remove('show'); modal('#loginModal'); return; }
    if (!state.address) { qs('#cart').classList.remove('show'); modal('#addressModal'); return toast('Informe o endereço para concluir.'); }
    if (!state.cart.length) return toast('Adicione itens à sacola.');
    const store = cartStore(); const zone = deliveryZone(store); if (!zone) return toast('A loja não entrega neste endereço.');
    const orderId = await api.createOrder({ storeId: store.id, zoneId: zone.id, addressId: state.address.id, items: state.cart.map(item => ({ productId: item.product.id, quantity: item.quantity })), couponCode: state.coupon?.code });
    state.cart = []; state.coupon = null; renderCart(); qs('#cart').classList.remove('show'); await refreshPrivate(); await renderOrders(); toast(`Pedido criado com sucesso (${orderId.slice(0, 8)}).`); trackOrder(orderId);
  }
  function showError(selector, message) { const el = qs(selector); el.textContent = message; el.style.display = 'block'; }

  qsa('.modal').forEach(item => item.addEventListener('click', event => { if (event.target === item) closeModals(); }));
  qs('#addressBtn').onclick = () => { if (state.address) { qs('#street').value = `${state.address.street}, ${state.address.number}`; qs('#neighborhood').value = state.address.neighborhood || 'Centro'; qs('#city').value = state.address.city; qs('#complement').value = state.address.complement || ''; } modal('#addressModal'); };
  qs('#headerAddressBtn').onclick = qs('#addressBtn').onclick;
  qs('#addressForm').onsubmit = event => { event.preventDefault(); saveAddressFromForm().catch(error => toast(error.message)); };
  qs('#geolocationBtn').onclick = () => { if (!navigator.geolocation) return toast('Geolocalização indisponível neste navegador.'); navigator.geolocation.getCurrentPosition(() => { qs('#street').value = 'Localização atual'; toast('Localização obtida. Confirme seu bairro.'); }, () => toast('Não foi possível obter sua localização.')); };
  qs('#search').oninput = renderCatalog; qs('#chips').onclick = event => { const button = event.target.closest('[data-cat]'); if (!button) return; state.category = button.dataset.cat; state.favoritesOnly = false; renderChips(); renderCatalog(); };
  qs('#allStoresBtn').onclick = () => { state.favoritesOnly = false; renderCatalog(); }; qs('#favoritesFilterBtn').onclick = () => { if (!state.user) return modal('#loginModal'); state.favoritesOnly = true; renderCatalog(); };
  const handleFavorite = favorite => api.toggleFavorite(favorite.dataset.favorite).then(on => { state.favorites = on ? [...state.favorites, favorite.dataset.favorite] : state.favorites.filter(id => id !== favorite.dataset.favorite); renderCatalog(); }).catch(error => { toast(error.message); modal('#loginModal'); });
  qs('#grid').onclick = event => { const favorite = event.target.closest('[data-favorite]'); const add = event.target.closest('[data-add]'); const store = event.target.closest('[data-store]'); if (favorite) return handleFavorite(favorite); if (add) return addStoreProduct(add.dataset.add, add.dataset.product).catch(error => toast(error.message)); if (store) openStore(store.dataset.store); };
  qs('#grid').onkeydown = event => { if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-store]')) { event.preventDefault(); openStore(event.target.dataset.store); } };
  qs('#storeView').onclick = event => { const favorite = event.target.closest('[data-favorite]'); const add = event.target.closest('[data-add]'); const product = event.target.closest('[data-product-detail]'); if (favorite) return handleFavorite(favorite); if (add) return addStoreProduct(add.dataset.add, add.dataset.product).catch(error => toast(error.message)); if (product) openProduct(product.dataset.storeId, product.dataset.productDetail); };
  qs('#productView').onclick = event => { const add = event.target.closest('[data-add]'); if (add) addStoreProduct(add.dataset.add, add.dataset.product).catch(error => toast(error.message)); };
  qs('#closeStore').onclick = closeModals; qs('#closeProduct').onclick = closeModals;
  qs('#bag').onclick = () => qs('#cart').classList.add('show'); qs('#close').onclick = () => qs('#cart').classList.remove('show'); qs('#items').onclick = event => { const remove = event.target.closest('[data-remove]'); const increase = event.target.closest('[data-increase]'); const decrease = event.target.closest('[data-decrease]'); if (remove) state.cart.splice(Number(remove.dataset.remove), 1); if (increase) state.cart[Number(increase.dataset.increase)].quantity += 1; if (decrease) { const index = Number(decrease.dataset.decrease); if (state.cart[index].quantity === 1) state.cart.splice(index, 1); else state.cart[index].quantity -= 1; } renderCart(); };
  qs('#applyCoupon').onclick = () => applyCoupon(qs('#couponInput').value).catch(error => toast(error.message));
  qs('#loginBtn').onclick = () => modal('#loginModal'); qs('#signupBtn').onclick = () => modal('#signupModal'); qs('#goSignup').onclick = () => modal('#signupModal'); qs('#goLogin').onclick = () => modal('#loginModal');
  qs('#loginForm').onsubmit = async event => { event.preventDefault(); const email = qs('#loginEmail').value.trim(); if (!validEmail(email)) return showError('#loginError', 'E-mail inválido'); try { await api.signIn(email, qs('#loginPassword').value); await refreshPrivate(); qs('#loginSuccess').textContent = 'Login realizado com sucesso'; qs('#loginSuccess').style.display = 'block'; setTimeout(closeModals, 400); event.target.reset(); } catch (error) { showError('#loginError', error.message); } };
  qs('#signupForm').onsubmit = async event => { event.preventDefault(); const name = qs('#signupName').value.trim(), email = qs('#signupEmail').value.trim(), phone = qs('#signupPhone').value.trim(), password = qs('#signupPassword').value, confirm = qs('#signupConfirm').value; if (!validEmail(email)) return showError('#signupError', 'E-mail inválido'); if (password !== confirm) return showError('#signupError', 'As senhas não são iguais'); try { const result = await api.signUpCustomer({ name, email, phone, password }); event.target.reset(); if (result.confirmationRequired) { showError('#signupError', 'Confira seu e-mail para confirmar a conta e depois entre.'); return; } await refreshPrivate(); closeModals(); toast('Conta criada com sucesso. Você já está conectado.'); } catch (error) { showError('#signupError', error.message); } };
  qs('#logoutBtn').onclick = () => api.signOut().then(async () => { await refreshPrivate(); toast('Você saiu da sua conta.'); }).catch(error => toast(error.message));
  qs('#profileBtn').onclick = () => { if (!state.user) return modal('#loginModal'); renderProfile(); modal('#profileModal'); };
  qs('#closeProfile').onclick = closeModals;
  qs('#profileContent').onclick = event => { const action = event.target.closest('[data-profile-action]')?.dataset.profileAction; if (!action) return; if (action === 'orders') { closeModals(); renderOrders().then(() => modal('#ordersModal')); } if (action === 'favorites') { closeModals(); state.favoritesOnly = true; renderCatalog(); } if (action === 'coupons') { closeModals(); renderCoupons(); modal('#couponsModal'); } if (action === 'address') { closeModals(); qs('#addressBtn').click(); } if (action === 'logout') qs('#logoutBtn').click(); };
  const storedTheme = (() => { try { return localStorage.getItem('vp-theme'); } catch { return null; } })();
  const setTheme = theme => { document.documentElement.dataset.theme = theme; qs('#themeBtn').textContent = theme === 'dark' ? '☀' : '☾'; qs('#themeBtn').setAttribute('aria-label', theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'); try { localStorage.setItem('vp-theme', theme); } catch {} };
  setTheme(storedTheme || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  qs('#themeBtn').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  qsa('.bottom-nav button').forEach(button => button.onclick = () => { qsa('.bottom-nav button').forEach(item => item.classList.toggle('active', item === button)); const target = button.dataset.nav; if (target === 'home') return window.scrollTo({ top: 0, behavior: 'smooth' }); if (target === 'search') { qs('#searchSection').scrollIntoView({ behavior: 'smooth', block: 'center' }); return setTimeout(() => qs('#search').focus(), 300); } if (target === 'bag') return qs('#bag').click(); if (target === 'orders') { if (!state.user) return modal('#loginModal'); return qs('#ordersBtn').click(); } if (target === 'profile') qs('#profileBtn').click(); });
  qs('#order').onclick = () => placeOrder().catch(error => toast(error.message)); qs('#ordersBtn').onclick = () => renderOrders().then(() => modal('#ordersModal')); qs('#closeOrders').onclick = closeModals; qs('#ordersList').onclick = event => { const track = event.target.closest('[data-track]'); const chat = event.target.closest('[data-chat-order]'); const review = event.target.closest('[data-review]'); if (track) trackOrder(track.dataset.track); if (chat) { state.chatOrderId = chat.dataset.chatOrder; renderMessages().then(() => modal('#chatModal')); } if (review) { state.reviewOrderId = review.dataset.review; qs('#reviewOrderText').textContent = 'Conte como foi sua experiência neste pedido.'; modal('#reviewModal'); } };
  qs('#closeTracking').onclick = closeModals;
  const ratings = { food: 0, delivery: 0, service: 0 }; qsa('.review-stars').forEach(group => group.onclick = event => { const button = event.target.closest('button'); if (!button) return; const value = [...group.children].indexOf(button) + 1; ratings[group.dataset.rating] = value; [...group.children].forEach((star, index) => star.classList.toggle('on', index < value)); });
  qs('#reviewForm').onsubmit = event => { event.preventDefault(); if (Object.values(ratings).some(value => !value)) return toast('Escolha uma nota para cada item.'); api.reviewOrder(state.reviewOrderId, ratings, qs('#reviewComment').value.trim()).then(async () => { closeModals(); await refreshAll(); toast('Obrigado pela sua avaliação!'); }).catch(error => toast(error.message)); };
  qs('#couponsBtn').onclick = () => { renderCoupons(); modal('#couponsModal'); }; qs('#closeCoupons').onclick = closeModals; qs('#couponList').onclick = event => { const button = event.target.closest('[data-use-coupon]'); if (!button) return; qs('#couponInput').value = button.dataset.useCoupon; applyCoupon(button.dataset.useCoupon); closeModals(); qs('#cart').classList.add('show'); };
  qs('#favoritesBtn').onclick = () => { state.favoritesOnly = true; renderCatalog(); modal('#favoritesModal'); qs('#favoritesGrid').innerHTML = qs('#grid').innerHTML; }; qs('#closeFavorites').onclick = closeModals; qs('#favoritesGrid').onclick = qs('#grid').onclick;
  qs('#chatBtn').onclick = () => renderMessages().then(() => modal('#chatModal')).catch(error => toast(error.message)); qs('#closeChat').onclick = closeModals; qs('.chat-contacts').onclick = () => {};
  const sendChat = (type = 'text', body = qs('#messageInput').value) => { if (!state.chatOrderId && !state.orders.length) return toast('Abra um pedido para iniciar o chat.'); const orderId = state.chatOrderId || state.orders[0].id; api.sendMessage(orderId, body, type).then(() => { qs('#messageInput').value = ''; qs('#typing').textContent = ''; renderMessages(); }).catch(error => toast(error.message)); };
  qs('#sendMessage').onclick = () => sendChat(); qs('#messageInput').oninput = () => qs('#typing').textContent = qs('#messageInput').value ? 'digitando...' : ''; qs('#messageInput').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); sendChat(); } }; qs('#sendPhoto').onclick = () => sendChat('image', '📷 Foto enviada'); qs('#sendLocation').onclick = () => sendChat('location', '📍 Localização compartilhada');
  qs('#notificationsBtn').onclick = () => { renderNotifications(); modal('#notificationsModal'); }; qs('#closeNotifications').onclick = closeModals; qs('#enablePush').onclick = async () => { if (!('Notification' in window)) return toast('Este navegador não oferece notificações push.'); const permission = await Notification.requestPermission(); toast(permission === 'granted' ? 'Notificações do navegador ativadas.' : 'Permissão não concedida.'); };

  (async () => {
    if (!api) return toast('Não foi possível iniciar a conexão segura.');
    await refreshAll(true);
    state.unlisten = await api.subscribe(() => refreshAll().catch(error => console.warn(error)));
    api.db.auth.onAuthStateChange(() => setTimeout(() => refreshPrivate().catch(error => console.warn(error)), 0));
  })().catch(error => toast(error.message));
})();
