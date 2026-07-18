/*
 * Vem Perto Core
 * Fonte única de dados para os painéis no modo local demonstrativo.
 * A API pública deste arquivo é a mesma que deve ser atendida pelo backend
 * central quando Supabase/PostgreSQL (ou equivalente) for conectado.
 */
(() => {
  const KEY = 'vemPertoCentralState.v2';
  const CHANNEL = 'vem-perto-central-events';
  const orderStates = [
    'Criado', 'Aguardando confirmação da loja', 'Aceito pela loja', 'Recusado pela loja',
    'Em preparação', 'Pronto para retirada', 'Aguardando motoboy', 'Motoboy atribuído',
    'Motoboy a caminho da loja', 'Pedido retirado', 'A caminho do cliente', 'Entregue', 'Cancelado'
  ];
  const allowedTransitions = {
    customer: {'Criado':['Aguardando confirmação da loja','Cancelado']},
    merchant: {
      'Aguardando confirmação da loja':['Aceito pela loja','Recusado pela loja'],
      'Aceito pela loja':['Em preparação'], 'Em preparação':['Pronto para retirada'],
      'Pronto para retirada':['Aguardando motoboy']
    },
    courier: {
      'Aguardando motoboy':['Motoboy atribuído'], 'Motoboy atribuído':['Motoboy a caminho da loja'],
      'Motoboy a caminho da loja':['Pedido retirado'], 'Pedido retirado':['A caminho do cliente'],
      'A caminho do cliente':['Entregue']
    },
    admin: Object.fromEntries(orderStates.map(status => [status, orderStates.filter(next => next !== status)]))
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const id = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`.toUpperCase();
  const now = () => new Date().toISOString();
  const defaultState = () => ({
    schemaVersion: 2,
    users: [],
    shops: [
      {id:'SHOP-BURGUER',ownerId:'MERCHANT-DEMO',name:'Burguer do Bairro',category:'Hambúrguer',status:'approved',open:'11:00',close:'23:00',zones:['Centro','Vila Nova','Jardim'],maxDistance:6,baseFee:3.5,feePerKm:1.2,rating:4.8,reviews:243},
      {id:'SHOP-FORNO',ownerId:'MERCHANT-FORNO',name:'Forno da Vila',category:'Pizza',status:'approved',open:'18:00',close:'23:30',zones:['Centro','Vila Nova'],maxDistance:5,baseFee:4,feePerKm:1.4,rating:4.7,reviews:189},
      {id:'SHOP-VERDE',ownerId:'MERCHANT-VERDE',name:'Verde & Fresco',category:'Saudável',status:'approved',open:'10:00',close:'20:00',zones:['Centro','Jardim'],maxDistance:4,baseFee:2.5,feePerKm:1,rating:4.9,reviews:96},
      {id:'SHOP-MERCADO',ownerId:'MERCHANT-MERCADO',name:'Mercado Central',category:'Mercado',status:'approved',open:'08:00',close:'21:00',zones:['Centro','Vila Nova','Jardim'],maxDistance:8,baseFee:3,feePerKm:.9,rating:4.6,reviews:322}
    ],
    products: [
      {id:'PROD-BURGUER',shopId:'SHOP-BURGUER',name:'Combo Clássico',description:'Hambúrguer artesanal com batata',price:29.9,available:true,prepMinutes:18,image:'burger-do-bairro.png',category:'Combos'},
      {id:'PROD-FORNO',shopId:'SHOP-FORNO',name:'Pizza Margherita',description:'Pizza artesanal',price:42.9,available:true,prepMinutes:24,image:'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=900&q=85',category:'Pizzas'},
      {id:'PROD-VERDE',shopId:'SHOP-VERDE',name:'Bowl da Casa',description:'Bowl fresco e saudável',price:26.9,available:true,prepMinutes:15,image:'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=85',category:'Saudável'},
      {id:'PROD-MERCADO',shopId:'SHOP-MERCADO',name:'Compras essenciais',description:'Seleção do dia',price:18.5,available:true,prepMinutes:10,image:'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=85',category:'Mercado'}
    ],
    couriers: [{id:'COURIER-DEMO',userId:'COURIER-DEMO',name:'João da Moto',status:'approved',online:true,phone:'(00) 90000-0000',rating:4.9,earnings:0,deliveries:0}],
    orders: [], messages: [], notifications: [], reviews: [], audit: [],
    coupons:[{code:'BEMVINDO10',type:'percent',value:10,minOrder:25,active:true},{code:'PERTO5',type:'fixed',value:5,minOrder:30,active:true},{code:'FRETEPERTO',type:'shipping',value:0,minOrder:20,active:true}],
    loyalty:{}, finance:{serviceRate:.10,courierRate:.72,platformFeeRate:.18}, categories:['Combos','Pizzas','Saudável','Mercado']
  });
  const migrateLegacy = state => {
    const legacyUsers = readRaw('vpUsers', []);
    if (legacyUsers.length && !state.users.length) state.users = legacyUsers.map(user => ({id:id('USER'),name:user.name,email:user.email,phone:user.phone||'',roles:['customer'],status:user.blocked?'blocked':'active'}));
    return state;
  };
  const readRaw = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const read = () => migrateLegacy(readRaw(KEY, defaultState()));
  const save = state => localStorage.setItem(KEY, JSON.stringify(state));
  const listeners = new Set();
  const bus = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
  const emit = (event, payload) => { listeners.forEach(listener => listener({event,payload,state:getState()})); if (bus) bus.postMessage({event,payload,at:Date.now()}); };
  if (bus) bus.onmessage = message => emit(message.data.event, message.data.payload);
  window.addEventListener('storage', event => { if (event.key === KEY) emit('state:changed', {}); });
  const mutate = (event, fn) => { const state = read(); const result = fn(state); save(state); emit(event, result); return clone(result); };
  const note = (state, userIds, title, body, orderId) => userIds.filter(Boolean).forEach(userId => state.notifications.unshift({id:id('NOT'),userId,title,body,orderId,createdAt:now(),read:false}));
  const audit = (state, actor, action, orderId, details={}) => state.audit.unshift({id:id('AUD'),actor,action,orderId,details,at:now()});
  const visibleShop = shop => shop && shop.status === 'approved';
  const financials = ({subtotal,deliveryFee,discount}) => {
    const total = Number(Math.max(0, subtotal + deliveryFee - discount).toFixed(2));
    const commission = Number((subtotal * .10).toFixed(2));
    const courierNet = Number((deliveryFee * .72).toFixed(2));
    return {subtotal,deliveryFee,discount,total,platformCommission:commission,shopNet:Number((subtotal-commission).toFixed(2)),courierNet,platformRevenue:Number((commission+deliveryFee-courierNet).toFixed(2))};
  };
  const getState = () => clone(read());
  const registerUser = input => mutate('user:created', state => { const email=String(input.email||'').toLowerCase(); if(state.users.some(user=>user.email===email))throw new Error('Já existe uma conta com este e-mail.'); const user={id:id('USER'),name:input.name,email,phone:input.phone||'',password:input.password||'',roles:input.roles||['customer'],status:'active',createdAt:now()};state.users.push(user);audit(state,user.id,'user.created',null,{roles:user.roles});return user; });
  const findUser = email => getState().users.find(user=>user.email===String(email||'').toLowerCase());
  const requestShop = input => mutate('shop:requested', state => {const ownerId=input.ownerId||id('MERCHANT');let user=state.users.find(x=>x.id===ownerId);if(!user){user={id:ownerId,name:input.ownerName||input.name,email:String(input.email||`${ownerId}@local`).toLowerCase(),phone:input.phone||'',roles:['merchant'],status:'active',createdAt:now()};state.users.push(user);}else if(!user.roles.includes('merchant'))user.roles.push('merchant');const shop={id:id('SHOP'),ownerId,name:input.name,category:input.category||'Outros',status:'pending',open:input.open||'09:00',close:input.close||'18:00',zones:input.zones||[],maxDistance:Number(input.maxDistance||0),baseFee:Number(input.baseFee||0),feePerKm:Number(input.feePerKm||0),rating:0,reviews:0,documents:input.documents||[],createdAt:now()};state.shops.push(shop);note(state,['ADMIN-DEMO'],'Nova solicitacao de loja',`${shop.name} aguarda aprovacao.`,null);audit(state,ownerId,'shop.requested',null,{shopId:shop.id});return shop;});
  const registerCourier = input => mutate('courier:registered', state => {const userId=input.userId||id('COURIER');let user=state.users.find(x=>x.id===userId);if(!user){user={id:userId,name:input.name,email:String(input.email||`${userId}@local`).toLowerCase(),phone:input.phone||'',roles:['courier'],status:'active',createdAt:now()};state.users.push(user);}else if(!user.roles.includes('courier'))user.roles.push('courier');const courier={id:id('COURIER'),userId,name:input.name,status:'pending',online:false,phone:input.phone||'',rating:0,earnings:0,deliveries:0,documents:input.documents||[],createdAt:now()};state.couriers.push(courier);note(state,['ADMIN-DEMO'],'Novo cadastro de motoboy',`${courier.name} aguarda aprovacao.`,null);audit(state,userId,'courier.registered',null,{courierId:courier.id});return courier;});
  const updateCourier = (courierId, changes, actor) => mutate('courier:updated', state => {const courier=state.couriers.find(x=>x.id===courierId);if(!courier)throw new Error('Motoboy nao encontrado.');if(actor.role!=='admin'&&courier.userId!==actor.id)throw new Error('Sem permissao.');Object.assign(courier,changes,{updatedAt:now()});audit(state,actor.id,'courier.updated',null,{courierId,changes});return courier;});
  const updateUser = (userId, changes, actor) => mutate('user:updated', state => {if(actor.role!=='admin')throw new Error('Sem permissao.');const user=state.users.find(x=>x.id===userId);if(!user)throw new Error('Usuario nao encontrado.');Object.assign(user,changes,{updatedAt:now()});audit(state,actor.id,'user.updated',null,{userId,changes});return user;});
  const upsertCoupon = (coupon, actor) => mutate('coupon:updated', state => {if(actor.role!=='admin')throw new Error('Sem permissao.');const code=String(coupon.code||'').trim().toUpperCase();if(!code)throw new Error('Informe o codigo do cupom.');const current=state.coupons.find(x=>x.code===code);const value={code,type:coupon.type||'percent',value:Number(coupon.value||0),minOrder:Number(coupon.minOrder||0),active:coupon.active!==false,updatedAt:now()};if(current)Object.assign(current,value);else state.coupons.push(value);audit(state,actor.id,'coupon.updated',null,{code});return current||value;});
  const sendNotification = ({userIds=[],title,body,orderId=null}, actor) => mutate('notification:created', state => {if(actor.role!=='admin')throw new Error('Sem permissao.');const recipients=userIds.length?userIds:state.users.filter(x=>x.status==='active').map(x=>x.id);note(state,recipients,title,body,orderId);audit(state,actor.id,'notification.created',orderId,{recipients:recipients.length});return {recipients:recipients.length};});
  const updateCategories = (categories, actor) => mutate('categories:updated', state => {if(actor.role!=='admin')throw new Error('Sem permissao.');state.categories=[...new Set(categories.map(x=>String(x).trim()).filter(Boolean))];audit(state,actor.id,'categories.updated',null,{count:state.categories.length});return state.categories;});
  const getCustomerCatalog = () => { const state=read(); return state.shops.filter(visibleShop).map(shop => ({...shop,products:state.products.filter(product=>product.shopId===shop.id)})); };
  const createOrder = input => mutate('order:created', state => {
    const shop=state.shops.find(x=>x.id===input.shopId); if (!visibleShop(shop)) throw new Error('A loja não está disponível para pedidos.');
    const items=input.items.map(item=>{const product=state.products.find(x=>x.id===item.productId&&x.shopId===shop.id);if(!product||!product.available)throw new Error('Um produto não está disponível.');return {productId:product.id,name:product.name,price:Number(product.price),quantity:item.quantity||1,additions:item.additions||[]};});
    const subtotal=items.reduce((sum,item)=>sum+item.price*item.quantity,0); let deliveryFee=Number(input.deliveryFee||shop.baseFee||0),discount=0;
    const coupon=input.coupon&&state.coupons.find(x=>x.active&&x.code===String(input.coupon).toUpperCase()); if(coupon&&subtotal>=coupon.minOrder){if(coupon.type==='percent')discount=subtotal*coupon.value/100;if(coupon.type==='fixed')discount=coupon.value;if(coupon.type==='shipping')deliveryFee=0;}
    const order={id:id('ORDER'),customerId:input.customerId,shopId:shop.id,courierId:null,items,address:input.address,status:'Aguardando confirmação da loja',createdAt:now(),updatedAt:now(),prepMinutes:null,financial:financials({subtotal,deliveryFee,discount}),coupon:coupon?.code||null,chatId:id('CHAT')};
    state.orders.unshift(order); note(state,[input.customerId,shop.ownerId],'Pedido criado',`Pedido ${order.id} aguardando confirmação da loja.`,order.id); audit(state,input.customerId,'order.created',order.id); return order;
  });
  const transitionOrder = (orderId, next, actor) => mutate('order:status', state => {
    const order=state.orders.find(x=>x.id===orderId); if(!order) throw new Error('Pedido não encontrado.');
    if(!orderStates.includes(next)) throw new Error('Status inválido.'); const allowed=allowedTransitions[actor.role]?.[order.status]||[];
    if(!allowed.includes(next)) throw new Error(`O perfil ${actor.role} não pode mudar ${order.status} para ${next}.`);
    if(actor.role==='merchant'&&order.shopId!==actor.shopId) throw new Error('Pedido não pertence a esta loja.');
    if(actor.role==='courier'&&next==='Motoboy atribuído'){const courier=state.couriers.find(x=>x.id===actor.courierId);if(!courier?.online||courier.status!=='approved')throw new Error('Motoboy indisponível.');order.courierId=actor.courierId;}
    if(actor.role==='courier'&&order.courierId!==actor.courierId) throw new Error('Pedido não está atribuído a este motoboy.');
    order.status=next;order.updatedAt=now();if(next==='Aceito pela loja')order.prepMinutes=Number(actor.prepMinutes||25); if(next==='Entregue'){const c=state.couriers.find(x=>x.id===order.courierId);if(c){c.earnings=Number((c.earnings+order.financial.courierNet).toFixed(2));c.deliveries+=1;}state.loyalty[order.customerId]=(state.loyalty[order.customerId]||0)+Math.floor(order.financial.total);}
    const shop=state.shops.find(x=>x.id===order.shopId), courier=state.couriers.find(x=>x.id===order.courierId);note(state,[order.customerId,shop?.ownerId,courier?.userId],'Pedido atualizado',`${order.id}: ${next}.`,order.id);audit(state,actor.id||actor.courierId,`order.${next}`,order.id);return order;
  });
  const updateProduct = (productId, changes, actor) => mutate('product:updated', state => { const product=state.products.find(x=>x.id===productId);if(!product)throw new Error('Produto não encontrado.');const shop=state.shops.find(x=>x.id===product.shopId);if(actor.role!=='admin'&&shop.ownerId!==actor.id)throw new Error('Sem permissão para editar este produto.');Object.assign(product,changes,{updatedAt:now()});audit(state,actor.id,'product.updated',null,{productId,changes});return product; });
  const updateShop = (shopId, changes, actor) => mutate('shop:updated', state => {const shop=state.shops.find(x=>x.id===shopId);if(!shop)throw new Error('Loja não encontrada.');if(actor.role!=='admin'&&shop.ownerId!==actor.id)throw new Error('Sem permissão.');Object.assign(shop,changes,{updatedAt:now()});audit(state,actor.id,'shop.updated',null,{shopId,changes});return shop;});
  const setCourierOnline = (courierId, online, actor) => updateCourier(courierId,{online:!!online},actor);
  const sendMessage = ({orderId,fromId,toIds,text,type='text'}) => mutate('message:sent', state => {const order=state.orders.find(x=>x.id===orderId);if(!order)throw new Error('Pedido não encontrado.');const allowed=[order.customerId,(state.shops.find(x=>x.id===order.shopId)||{}).ownerId,order.courierId].filter(Boolean);if(!allowed.includes(fromId)||toIds.some(id=>!allowed.includes(id)))throw new Error('Participante não autorizado neste chat.');const message={id:id('MSG'),orderId,fromId,toIds,text,type,createdAt:now(),readBy:[fromId]};state.messages.push(message);note(state,toIds,'Nova mensagem',text,orderId);return message;});
  const reviewOrder = ({orderId,customerId,food,delivery,service,comment}) => mutate('review:created', state => {const order=state.orders.find(x=>x.id===orderId);if(!order||order.customerId!==customerId||order.status!=='Entregue')throw new Error('Avaliação não permitida.');if(state.reviews.some(x=>x.orderId===orderId))throw new Error('Pedido já avaliado.');const review={id:id('REV'),orderId,shopId:order.shopId,customerId,food,delivery,service,average:(food+delivery+service)/3,comment,createdAt:now()};state.reviews.push(review);const shop=state.shops.find(x=>x.id===order.shopId);shop.rating=Number(((shop.rating*shop.reviews+review.average)/(shop.reviews+1)).toFixed(1));shop.reviews+=1;note(state,[shop.ownerId],'Nova avaliação',`Pedido ${orderId}: ${review.average.toFixed(1)} estrelas.`,orderId);return review;});
  const subscribe = listener => {listeners.add(listener);return()=>listeners.delete(listener)};
  window.VemPertoCore = {mode:'local-shared-demo',orderStates,getState,registerUser,findUser,requestShop,registerCourier,updateCourier,updateUser,upsertCoupon,sendNotification,updateCategories,getCustomerCatalog,createOrder,transitionOrder,updateProduct,updateShop,setCourierOnline,sendMessage,reviewOrder,subscribe,financials,resetDemo:()=>{localStorage.removeItem(KEY);emit('state:reset',{});}};
})();
