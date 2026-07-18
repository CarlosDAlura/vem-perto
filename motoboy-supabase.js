(() => {
  const api = window.VemPertoSupabase;
  const q = selector => document.querySelector(selector);
  const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const orderStatus = value => ({ awaiting_courier: 'Aguardando motoboy', courier_assigned: 'Motoboy atribuído', courier_to_store: 'A caminho da loja', picked_up: 'Pedido retirado', on_the_way: 'A caminho do cliente', delivered: 'Entregue' })[value] || value;
  let dashboard = null; let unsubscribe = null;
  const toast = text => { q('#toast').textContent = text; q('#toast').style.display = 'block'; setTimeout(() => q('#toast').style.display = 'none', 2900); };
  const nextAction = order => ({ courier_assigned: ['Ir até a loja', 'courier_to_store'], courier_to_store: ['Confirmar retirada', 'picked_up'], picked_up: ['A caminho do cliente', 'on_the_way'], on_the_way: ['Confirmar entrega', 'delivered'] })[order.status];

  function showLogin(message = '') {
    q('#identity').textContent = 'Acesso necessário'; q('#online').disabled = true;
    q('#deliveries').innerHTML = `<div class="notice"><b>${escape(message || 'Entre com sua conta para receber corridas.')}</b><form id="courierLogin" class="form" style="margin-top:12px"><label>E-mail<input name="email" type="email" required></label><label>Senha<input name="password" type="password" required></label><button class="wide">Entrar</button></form><p class="small">Se ainda não possui conta, crie-a primeiro no aplicativo do cliente.</p></div>`;
    q('#metrics').innerHTML = '<div><span>Entregas concluídas</span><b>—</b></div><div><span>Ganhos</span><b>—</b></div>';
    q('#courierLogin').onsubmit = async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.target)); try { await api.signIn(data.email, data.password); await load(); toast('Login realizado com sucesso.'); } catch (error) { toast(error.message); } };
  }
  function render() {
    const { identity, courier, offers, orders } = dashboard;
    q('#identity').textContent = `${identity.profile.full_name} · ${courier?.status === 'approved' ? 'Aprovado' : courier ? 'Em análise' : 'Cadastro pendente'}`;
    q('#online').checked = !!courier?.is_online; q('#online').disabled = courier?.status !== 'approved';
    const mine = orders.filter(order => order.assignment?.courier_id === courier?.id);
    const delivered = mine.filter(order => order.status === 'delivered');
    const earned = mine.filter(order => order.status === 'delivered').reduce((total, order) => total + Number(order.financial?.courier_net || order.order_financials?.courier_net || 0), 0);
    q('#metrics').innerHTML = `<div><span>Entregas concluídas</span><b>${delivered.length}</b></div><div><span>Ganhos</span><b>${money(earned)}</b></div>`;
    const available = offers.map(offer => `<article class="delivery"><div class="row"><b>${escape(offer.public_code)}</b><span class="status">Disponível</span></div><p class="small">${escape(offer.store_name)} → ${escape(offer.delivery_neighborhood)}</p><div class="row"><span>Você recebe <b>${money(offer.courier_net)}</b></span><span class="small">${escape(offer.item_summary)}</span></div><div class="actions"><button data-accept-offer="${offer.order_id}">Aceitar corrida</button></div></article>`).join('');
    const assigned = mine.map(order => { const action = nextAction(order); return `<article class="delivery"><div class="row"><b>${escape(order.public_code)}</b><span class="status ${order.status === 'delivered' ? 'done' : 'busy'}">${orderStatus(order.status)}</span></div><p class="small">${escape(order.store?.name || 'Loja')} → ${escape(order.address_snapshot?.neighborhood || 'Cliente')}</p><div class="row"><span>Você recebe <b>${money(order.financial?.courier_net || order.order_financials?.courier_net)}</b></span><span class="small">${order.items.map(item => escape(item.product_name_snapshot)).join(', ')}</span></div><div class="actions">${action ? `<button data-order-status="${order.id}" data-next-status="${action[1]}">${action[0]}</button>` : ''}</div></article>`; }).join('');
    q('#deliveries').innerHTML = available || assigned || '<p class="notice">Nenhuma corrida disponível. Fique online para receber pedidos.</p>';
    q('#deliveries').onclick = async event => { const accept = event.target.closest('[data-accept-offer]'); const status = event.target.closest('[data-order-status]'); try { if (accept) await api.assignCourier(accept.dataset.acceptOffer); if (status) await api.transitionOrder(status.dataset.orderStatus, status.dataset.nextStatus); await load(); toast('Entrega atualizada.'); } catch (error) { toast(error.message); } };
  }
  async function load() {
    const identity = await api.identity(); if (!identity) return showLogin(); dashboard = await api.courierDashboard(); render(); if (!unsubscribe) unsubscribe = await api.subscribe(() => load().catch(error => console.warn(error)));
  }
  q('#online').onchange = async event => { try { await api.setCourierOnline(event.target.checked); await load(); toast(event.target.checked ? 'Você está online.' : 'Você está offline.'); } catch (error) { toast(error.message); event.target.checked = !event.target.checked; } };
  q('#courierForm').onsubmit = async event => {
    event.preventDefault(); const form = new FormData(event.target); const files = form.getAll('documents').filter(file => file instanceof File && file.size);
    try { const courierId = await api.submitCourierApplication(form.get('phone')); for (const file of files) await api.uploadApplicationDocument('courier', courierId, file); event.target.reset(); await load(); toast('Cadastro enviado para aprovação.'); } catch (error) { toast(error.message); }
  };
  load().catch(error => showLogin(error.message));
})();
