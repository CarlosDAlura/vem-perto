/* Vem Perto Stage 2: browser client using Supabase Auth, Data API and Realtime. */
(() => {
  const config = window.VEM_PERTO_SUPABASE_CONFIG || {
    url: 'https://ulihbqtqltjcyiywdzst.supabase.co',
    publishableKey: 'sb_publishable_tbxxuGv6CzJAHbuXZL87lg_XuDlZtDU'
  };

  if (!window.supabase?.createClient) {
    console.error('Supabase client library was not loaded.');
    return;
  }

  const db = window.supabase.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const ensure = ({ data, error }) => {
    if (error) throw new Error(error.message || 'Não foi possível concluir esta ação.');
    return data;
  };
  const rpc = async (name, params = {}) => ensure(await db.rpc(name, params));
  const one = async query => ensure(await query);
  const uuid = () => crypto.randomUUID();
  const mapAuthError = error => {
    const message = String(error?.message || '');
    if (/email/i.test(message) && /invalid/i.test(message)) return 'E-mail inválido';
    if (/already registered|already been registered|exists/i.test(message)) return 'Já existe uma conta com este e-mail';
    if (/invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos';
    return message || 'Não foi possível autenticar sua conta.';
  };
  const parseAddress = address => {
    const raw = String(address.street || '').trim();
    const match = raw.match(/^(.*?)(?:,\s*([^,]+))?$/);
    return { street: match?.[1]?.trim() || raw, number: match?.[2]?.trim() || 'S/N' };
  };
  const mapOrder = order => ({
    ...order,
    store: order.stores || null,
    items: order.order_items || [],
    financial: order.order_financials || null,
    assignment: Array.isArray(order.delivery_assignments) ? order.delivery_assignments[0] : order.delivery_assignments || null
  });

  async function session() {
    return ensure(await db.auth.getSession()).session;
  }
  async function identity() {
    const current = await session();
    if (!current?.user) return null;
    const [profile, roles] = await Promise.all([
      one(db.from('profiles').select('*').eq('id', current.user.id).single()),
      one(db.from('user_roles').select('role').eq('profile_id', current.user.id))
    ]);
    return { user: current.user, profile, roles: roles.map(item => item.role) };
  }
  async function signIn(email, password) {
    const result = await db.auth.signInWithPassword({ email: String(email || '').trim(), password });
    if (result.error) throw new Error(mapAuthError(result.error));
    return identity();
  }
  async function signUpCustomer({ name, email, phone, password }) {
    const result = await db.auth.signUp({
      email: String(email || '').trim(), password,
      options: { data: { full_name: String(name || '').trim(), phone: String(phone || '').trim() } }
    });
    if (result.error) throw new Error(mapAuthError(result.error));
    if (result.data.user?.identities?.length === 0) throw new Error('Já existe uma conta com este e-mail');
    if (!result.data.session) return { confirmationRequired: true };
    return { confirmationRequired: false, identity: await identity() };
  }
  async function signOut() { ensure(await db.auth.signOut({ scope: 'local' })); }

  async function catalog() {
    const [stores, reviews, categories] = await Promise.all([
      one(db.from('stores').select('id,name,category_label,min_order_amount,is_accepting_orders,open_time,close_time,products(id,name,description,price,is_available,prep_minutes,image_path,category_id),store_delivery_zones(id,name,max_distance_km,base_delivery_fee,fee_per_km,is_active)').eq('status', 'approved').order('name')),
      one(db.from('reviews').select('store_id,food_rating,delivery_rating,service_rating')),
      one(db.from('categories').select('id,name,slug').eq('is_active', true).order('name'))
    ]);
    const ratings = new Map();
    reviews.forEach(review => {
      const entry = ratings.get(review.store_id) || { total: 0, count: 0 };
      entry.total += (Number(review.food_rating) + Number(review.delivery_rating) + Number(review.service_rating)) / 3;
      entry.count += 1;
      ratings.set(review.store_id, entry);
    });
    return {
      categories,
      stores: stores.map(store => {
        const rating = ratings.get(store.id) || { total: 0, count: 0 };
        return { ...store, products: (store.products || []).filter(product => product.is_available), zones: (store.store_delivery_zones || []).filter(zone => zone.is_active), rating: rating.count ? rating.total / rating.count : 0, reviewCount: rating.count };
      })
    };
  }
  async function listAddresses() { return one(db.from('addresses').select('*').order('is_default', { ascending: false }).order('updated_at', { ascending: false })); }
  async function saveAddress(address, existingId = null) {
    const current = await identity();
    if (!current) throw new Error('Entre para salvar o endereço.');
    const parsed = parseAddress(address);
    const payload = {
      profile_id: current.profile.id, label: 'Casa', recipient_name: current.profile.full_name,
      phone: current.profile.phone, street: parsed.street, number: parsed.number,
      complement: address.complement || null, neighborhood: address.neighborhood || null,
      city: address.city, state: address.state || 'BR', is_default: true
    };
    if (existingId) return one(db.from('addresses').update(payload).eq('id', existingId).select().single());
    return one(db.from('addresses').insert(payload).select().single());
  }
  async function getFavoriteIds() {
    const current = await identity();
    if (!current) return [];
    const rows = await one(db.from('store_favorites').select('store_id'));
    return rows.map(row => row.store_id);
  }
  async function toggleFavorite(storeId) {
    const current = await identity();
    if (!current) throw new Error('Entre para salvar favoritos.');
    const currentIds = await getFavoriteIds();
    if (currentIds.includes(storeId)) {
      ensure(await db.from('store_favorites').delete().eq('store_id', storeId));
      return false;
    }
    ensure(await db.from('store_favorites').insert({ profile_id: current.profile.id, store_id: storeId }));
    return true;
  }
  async function getCoupons() { return one(db.from('coupons').select('*').eq('is_active', true).order('created_at', { ascending: false })); }
  async function loyalty() {
    const current = await identity();
    if (!current) return { points_balance: 0 };
    return one(db.from('loyalty_accounts').select('*').single());
  }
  async function getNotifications() {
    const current = await identity();
    if (!current) return [];
    return one(db.from('notifications').select('*').order('created_at', { ascending: false }).limit(30));
  }
  async function customerOrders() {
    const current = await identity();
    if (!current) return [];
    const orders = await one(db.from('orders').select('*,stores(id,name),order_items(*),order_financials(*),delivery_assignments(*,couriers(*))').order('created_at', { ascending: false }));
    return orders.map(mapOrder);
  }
  async function createOrder({ storeId, zoneId, addressId, items, couponCode }) {
    const orderId = await rpc('create_order', {
      p_store_id: storeId, p_address_id: addressId, p_delivery_zone_id: zoneId,
      p_items: items.map(item => ({ product_id: item.productId, quantity: item.quantity || 1, option_item_ids: item.optionItemIds || [] })),
      p_client_request_id: uuid(), p_coupon_code: couponCode || null
    });
    return orderId;
  }
  async function reviewOrder(orderId, ratings, comment) {
    return rpc('review_store_order', {
      p_order_id: orderId, p_food_rating: ratings.food, p_delivery_rating: ratings.delivery,
      p_service_rating: ratings.service, p_comment: comment || null
    });
  }
  async function messages(orderId) { return one(db.from('order_messages').select('*,profiles!order_messages_sender_id_fkey(full_name)').eq('order_id', orderId).order('created_at')); }
  async function sendMessage(orderId, body, type = 'text', attachmentPath = null) {
    return rpc('send_order_message', { p_order_id: orderId, p_body: body || '', p_message_type: type, p_attachment_path: attachmentPath });
  }

  async function submitStoreApplication(form) {
    const current = await identity();
    if (!current) throw new Error('Crie uma conta ou entre antes de cadastrar uma loja.');
    return rpc('submit_store_application', {
      p_name: form.name, p_category_label: form.category, p_phone: form.phone,
      p_open_time: form.open || null, p_close_time: form.close || null,
      p_min_order_amount: Number(form.minOrder || 0), p_zones: form.zones
    });
  }
  async function submitCourierApplication(phone) {
    const current = await identity();
    if (!current) throw new Error('Crie uma conta ou entre antes de se cadastrar como motoboy.');
    return rpc('submit_courier_application', { p_phone: phone });
  }
  async function uploadApplicationDocument(kind, entityId, file) {
    const current = await identity();
    if (!current) throw new Error('Entre antes de enviar documentos.');
    const bucket = kind === 'store' ? 'merchant-documents' : 'courier-documents';
    const path = `${current.profile.id}/${uuid()}/${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    ensure(await db.storage.from(bucket).upload(path, file, { upsert: false }));
    const fn = kind === 'store' ? 'register_store_document' : 'register_courier_document';
    const params = kind === 'store'
      ? { p_store_id: entityId, p_document_type: file.type || 'document', p_storage_path: path }
      : { p_courier_id: entityId, p_document_type: file.type || 'document', p_storage_path: path };
    return rpc(fn, params);
  }

  async function storeDashboard() {
    const current = await identity();
    if (!current) throw new Error('Entre como lojista para acessar este painel.');
    const stores = await one(db.from('stores').select('*').order('created_at', { ascending: false }));
    const owned = stores.filter(store => store.owner_id === current.profile.id);
    if (!owned.length) return { identity: current, stores: [], orders: [], products: [], financials: [] };
    const ids = owned.map(store => store.id);
    const [orders, products, financials] = await Promise.all([
      one(db.from('orders').select('*,order_items(*),stores(id,name)').in('store_id', ids).order('created_at', { ascending: false })),
      one(db.from('products').select('*').in('store_id', ids).order('name')),
      one(db.from('order_financials').select('*,orders!inner(store_id)').in('orders.store_id', ids))
    ]);
    return { identity: current, stores: owned, orders: orders.map(mapOrder), products, financials };
  }
  async function updateOwnedProduct(productId, price, available) { return rpc('update_owned_product', { p_product_id: productId, p_price: Number(price), p_is_available: !!available }); }
  async function setStoreAcceptingOrders(storeId, accepting) { return rpc('update_owned_store_operating_status', { p_store_id: storeId, p_is_accepting_orders: !!accepting }); }
  async function transitionOrder(orderId, nextStatus, details = {}) { return rpc('transition_order', { p_order_id: orderId, p_next_status: nextStatus, p_details: details }); }

  async function courierDashboard() {
    const current = await identity();
    if (!current) throw new Error('Entre como motoboy para acessar este painel.');
    const couriers = await one(db.from('couriers').select('*').eq('profile_id', current.profile.id));
    const courier = couriers[0] || null;
    const [offers, orders] = await Promise.all([
      courier?.status === 'approved' && courier.is_online ? rpc('get_courier_delivery_offers') : Promise.resolve([]),
      one(db.from('orders').select('*,stores(id,name),order_items(*),order_financials(*),delivery_assignments(*,couriers(*))').order('created_at', { ascending: false }))
    ]);
    return { identity: current, courier, offers, orders: orders.map(mapOrder) };
  }
  async function setCourierOnline(online) { return rpc('set_courier_online', { p_online: !!online }); }
  async function assignCourier(orderId) { return rpc('assign_courier', { p_order_id: orderId }); }

  async function adminDashboard() {
    const current = await identity();
    if (!current?.roles.includes('admin')) throw new Error('Acesso de administrador necessário.');
    const [profiles, roles, stores, couriers, orders, financials, coupons, categories, reviews, audit] = await Promise.all([
      one(db.from('profiles').select('*').order('created_at', { ascending: false })),
      one(db.from('user_roles').select('*')),
      one(db.from('stores').select('*').order('created_at', { ascending: false })),
      one(db.from('couriers').select('*,profiles(full_name,phone)').order('created_at', { ascending: false })),
      one(db.from('orders').select('*,stores(id,name),order_items(*)').order('created_at', { ascending: false }).limit(100)),
      one(db.from('order_financials').select('*')),
      one(db.from('coupons').select('*').order('created_at', { ascending: false })),
      one(db.from('categories').select('*').order('name')),
      one(db.from('reviews').select('*')),
      one(db.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(30))
    ]);
    return { identity: current, profiles, roles, stores, couriers, orders: orders.map(mapOrder), financials, coupons, categories, reviews, audit };
  }
  async function approveStore(storeId, approve, reason = null) { return rpc('review_store_application', { p_store_id: storeId, p_approve: !!approve, p_reason: reason }); }
  async function approveCourier(courierId, approve, reason = null) { return rpc('review_courier_application', { p_courier_id: courierId, p_approve: !!approve, p_reason: reason }); }
  async function setProfileStatus(profileId, status) { return rpc('admin_set_profile_status', { p_profile_id: profileId, p_status: status }); }
  async function upsertCoupon(code, type, amount, minOrder) {
    return rpc('admin_upsert_coupon', { p_code: code, p_discount_type: type, p_amount: Number(amount), p_min_order_amount: Number(minOrder) });
  }
  async function replaceCategories(names) { return rpc('admin_replace_categories', { p_names: names }); }
  async function broadcast(title, body, targetRole = null) { return rpc('admin_broadcast_notification', { p_title: title, p_body: body, p_target_role: targetRole }); }

  async function subscribe(onChange) {
    const current = await identity();
    if (!current) return () => {};
    const channel = db.channel(`vem-perto:${current.profile.id}:${uuid()}`);
    ['orders', 'order_status_history', 'delivery_assignments', 'order_messages', 'notifications', 'products', 'stores', 'reviews', 'store_favorites']
      .forEach(table => channel.on('postgres_changes', { event: '*', schema: 'public', table }, payload => onChange({ table, payload })));
    channel.subscribe();
    return () => db.removeChannel(channel);
  }

  window.VemPertoSupabase = {
    db, config, session, identity, signIn, signUpCustomer, signOut, catalog, listAddresses, saveAddress,
    getFavoriteIds, toggleFavorite, getCoupons, loyalty, getNotifications, customerOrders, createOrder,
    reviewOrder, messages, sendMessage, submitStoreApplication, submitCourierApplication, uploadApplicationDocument,
    storeDashboard, updateOwnedProduct, setStoreAcceptingOrders, transitionOrder, courierDashboard,
    setCourierOnline, assignCourier, adminDashboard, approveStore, approveCourier, setProfileStatus,
    upsertCoupon, replaceCategories, broadcast, subscribe
  };
})();
