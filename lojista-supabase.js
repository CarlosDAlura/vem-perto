(() => {
  const api = window.VemPertoSupabase;
  const q = selector => document.querySelector(selector);
  const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const orderStatus = value => ({ awaiting_store_confirmation: 'Aguardando confirmação', accepted_by_store: 'Aceito', preparing: 'Em preparação', ready_for_pickup: 'Pronto para retirada', awaiting_courier: 'Aguardando motoboy', courier_assigned: 'Motoboy atribuído', courier_to_store: 'Motoboy a caminho', picked_up: 'Pedido retirado', on_the_way: 'A caminho do cliente', delivered: 'Entregue', rejected_by_store: 'Recusado', cancelled: 'Cancelado' })[value] || value;
  let dashboard = null; let unsubscribe = null;
  const toast = text => { q('#toast').textContent = text; q('#toast').style.display = 'block'; setTimeout(() => q('#toast').style.display = 'none', 2900); };
  const nextAction = order => ({ awaiting_store_confirmation: ['Aceitar pedido', 'accepted_by_store'], accepted_by_store: ['Iniciar preparo', 'preparing'], preparing: ['Marcar como pronto', 'ready_for_pickup'], ready_for_pickup: ['Solicitar motoboy', 'awaiting_courier'] })[order.status];

  function showLogin(message = '') {
    q('#shopBadge').textContent = 'Acesso necessário';
    q('#orders').innerHTML = `<div class="notice"><b>${escape(message || 'Entre com a conta responsável pela loja.')}</b><form id="merchantLogin" class="form" style="margin-top:12px"><label>E-mail<input name="email" type="email" required></label><label>Senha<input name="password" type="password" required></label><button>Entrar</button></form><p class="small">Ainda não tem conta? Crie-a no aplicativo do cliente antes de solicitar o cadastro da loja.</p></div>`;
    q('#metrics').innerHTML = '<div><span>Pedidos</span><b>—</b></div><div><span>Bruto</span><b>—</b></div><div><span>Líquido</span><b>—</b></div>';
    q('#products').innerHTML = '<p class="notice">O cardápio aparecerá depois da aprovação da loja.</p>';
    q('#shopInfo').innerHTML = '<p class="notice">A loja só pode aceitar pedidos após a aprovação administrativa.</p>';
    q('#merchantLogin').onsubmit = async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.target)); try { await api.signIn(data.email, data.password); await load(); toast('Login realizado com sucesso.'); } catch (error) { toast(error.message); } };
  }
  function render() {
    const store = dashboard.stores[0];
    const orders = dashboard.orders.filter(order => order.store_id === store?.id);
    const products = dashboard.products.filter(product => product.store_id === store?.id);
    const financials = dashboard.financials.filter(item => orders.some(order => order.id === item.order_id));
    const gross = financials.reduce((total, item) => total + Number(item.total_paid), 0);
    const net = financials.reduce((total, item) => total + Number(item.shop_net), 0);
    q('#shopBadge').textContent = store ? `${store.name} · ${store.status === 'approved' ? 'Aprovada' : 'Em análise'}` : 'Solicite o cadastro da sua loja';
    q('#metrics').innerHTML = `<div><span>Pedidos</span><b>${orders.length}</b></div><div><span>Bruto</span><b>${money(gross)}</b></div><div><span>Líquido</span><b>${money(net)}</b></div>`;
    q('#shopInfo').innerHTML = store ? `<h3>${escape(store.name)}</h3><p class="small">${store.open_time || '—'}–${store.close_time || '—'} · ${escape(store.category_label || 'Categoria não informada')}</p><label class="small">Aceitar pedidos <input id="shopAccepting" type="checkbox" ${store.is_accepting_orders ? 'checked' : ''} ${store.status !== 'approved' ? 'disabled' : ''} style="width:auto"></label><div class="actions"><button class="alt" id="saveShopStatus" ${store.status !== 'approved' ? 'disabled' : ''}>Salvar status</button></div>` : '<p class="notice">Preencha o formulário abaixo para enviar a solicitação.</p>';
    q('#orders').innerHTML = orders.length ? orders.map(order => { const action = nextAction(order); return `<article class="order"><div class="row"><b>${escape(order.public_code)}</b><span class="status">${orderStatus(order.status)}</span></div><p class="small">${order.items.map(item => `${item.quantity}× ${escape(item.product_name_snapshot)}`).join(', ')} · ${escape(order.address_snapshot?.neighborhood || 'Endereço protegido')}</p><div class="row"><b>${money(order.total_amount)}</b><span class="small">preparo: ${order.prep_minutes || '—'} min</span></div><div class="actions">${action ? `<button data-order-status="${order.id}" data-next-status="${action[1]}">${action[0]}</button>` : ''}${order.status === 'awaiting_store_confirmation' ? `<button class="alt" data-order-status="${order.id}" data-next-status="rejected_by_store">Recusar</button>` : ''}</div></article>`; }).join('') : '<p class="notice">Nenhum pedido real recebido ainda.</p>';
    q('#products').innerHTML = products.length ? products.map(product => `<article class="product"><div class="row"><div><h3>${escape(product.name)}</h3><span class="small">${escape(product.description || '')}</span></div><label class="small">Disponível <input id="available-${product.id}" type="checkbox" ${product.is_available ? 'checked' : ''} style="width:auto"></label></div><div class="row" style="margin-top:10px"><input id="price-${product.id}" type="number" min="0" step=".01" value="${product.price}" style="max-width:140px"><button class="alt" data-product="${product.id}">Salvar preço</button></div></article>`).join('') : '<p class="notice">O cardápio aparecerá quando os produtos forem cadastrados e aprovados.</p>';
    const statusButton = q('#saveShopStatus'); if (statusButton) statusButton.onclick = async () => { try { await api.setStoreAcceptingOrders(store.id, q('#shopAccepting').checked); await load(); toast('Status da loja atualizado.'); } catch (error) { toast(error.message); } };
    q('#orders').onclick = async event => { const button = event.target.closest('[data-order-status]'); if (!button) return; try { await api.transitionOrder(button.dataset.orderStatus, button.dataset.nextStatus, button.dataset.nextStatus === 'accepted_by_store' ? { prep_minutes: 25 } : {}); await load(); toast('Pedido atualizado.'); } catch (error) { toast(error.message); } };
    q('#products').onclick = async event => { const button = event.target.closest('[data-product]'); if (!button) return; try { await api.updateOwnedProduct(button.dataset.product, q(`#price-${button.dataset.product}`).value, q(`#available-${button.dataset.product}`).checked); await load(); toast('Cardápio atualizado para todos os painéis.'); } catch (error) { toast(error.message); } };
  }
  async function load() {
    const identity = await api.identity();
    if (!identity) return showLogin();
    dashboard = await api.storeDashboard(); render();
    if (!unsubscribe) unsubscribe = await api.subscribe(() => load().catch(error => console.warn(error)));
  }
  q('#shopForm').onsubmit = async event => {
    event.preventDefault(); const form = new FormData(event.target); const files = form.getAll('documents').filter(file => file instanceof File && file.size);
    try {
      const storeId = await api.submitStoreApplication({ name: form.get('name'), category: form.get('category'), phone: form.get('phone'), open: form.get('open'), close: form.get('close'), minOrder: 0, zones: String(form.get('zones')).split(',').map(name => name.trim()).filter(Boolean).map(name => ({ name, max_distance_km: Number(form.get('maxDistance') || 5), base_delivery_fee: Number(form.get('baseFee') || 0), fee_per_km: 0 })) });
      for (const file of files) await api.uploadApplicationDocument('store', storeId, file);
      event.target.reset(); await load(); toast('Solicitação enviada para aprovação administrativa.');
    } catch (error) { toast(error.message); }
  };
  load().catch(error => showLogin(error.message));
})();
