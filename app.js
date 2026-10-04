(() => {
"use strict";

const C = window.WASALLI_CONFIG;
const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_PUBLISHABLE_KEY);

const state = {
  session: null,
  profile: null,
  orders: [],
  shops: [],
  couriers: [],
  profiles: [],
  settlements: [],
  settings: {
    default_delivery_fee: C.DEFAULT_DELIVERY_FEE,
    courier_percent: C.DEFAULT_COURIER_PERCENT,
    company_percent: C.DEFAULT_COMPANY_PERCENT,
    company_name: C.APP_NAME,
    city: C.CITY,
    whatsapp: ""
  },
  page: "dashboard"
};

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const esc = (v="") => String(v ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const money = n => Number(n || 0).toLocaleString("ar-IQ") + " د.ع";
const dateTime = v => v ? new Date(v).toLocaleString("ar-IQ") : "—";
const todayKey = () => new Date().toISOString().slice(0,10);

function toast(msg, type="ok"){
  const el = $("#toast");
  el.textContent = msg;
  el.style.background = type === "error" ? "#d94b5b" : type === "warn" ? "#9b6a00" : "#241d2f";
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>el.classList.remove("show"), 2800);
}

function statusBadge(status){
 const map = {
  new:["طلب جديد","badge-new"],
  assigned:["أُسند","badge-assigned"],
  accepted:["تم القبول","badge-assigned"],
  picked_up:["تم الاستلام","badge-assigned"],
  on_the_way:["بالطريق","badge-road"],
  delivered:["تم التسليم","badge-done"],
  cancelled:["ملغي","badge-cancel"]
};
  const [t,c] = map[status] || [status || "غير محدد","badge-new"];
  return `<span class="badge ${c}">${esc(t)}</span>`;
}

function roleLabel(role){
  return ({admin:"الإدارة",shop:"المحل",courier:"المندوب",pending:"قيد المراجعة"})[role] || role || "—";
}

function isAdmin(){ return state.profile?.role === "admin"; }
function isShop(){ return state.profile?.role === "shop"; }
function isCourier(){ return state.profile?.role === "courier"; }

const NAV = {
  admin:[
    ["dashboard","⌂","لوحة التحكم"],
    ["orders","📦","الطلبات"],
    ["shops","🏪","المحلات"],
    ["couriers","🛵","المندوبون"],
    ["map","🗺️","الخريطة"],
    ["accounts","💰","الحسابات"],
    ["reports","📊","التقارير"],
    ["users","👥","الحسابات والصلاحيات"],
    ["settings","⚙️","الإعدادات"]
  ],
  shop:[
    ["dashboard","⌂","لوحة التحكم"],
    ["orders","📦","طلباتي"],
    ["settings","⚙️","الحساب"]
  ],
  courier:[
    ["dashboard","⌂","لوحة التحكم"],
    ["orders","📦","طلباتي"],
    ["accounts","💰","حسابي"],
    ["settings","⚙️","الحساب"]
  ]
};

async function boot(){
  bindStaticEvents();
  const { data:{ session } } = await sb.auth.getSession();
  if(session) await enterSession(session);
  else showAuth();

  sb.auth.onAuthStateChange((event, session) => {
    if(event === "SIGNED_OUT"){
      resetState();
      showAuth();
    }
  });
}

function bindStaticEvents(){
  $("#loginForm").addEventListener("submit", login);
  $("#signupForm").addEventListener("submit", signup);
  $("#pendingLogout").addEventListener("click", logout);
  $("#refreshBtn").addEventListener("click", ()=>loadAll(true));
  $("#menuToggle").addEventListener("click", ()=>$("#sidebar").classList.toggle("open"));
  $$(".auth-tab").forEach(btn => btn.addEventListener("click", ()=>{
    $$(".auth-tab").forEach(x=>x.classList.remove("active"));
    btn.classList.add("active");
    const loginMode = btn.dataset.authTab === "login";
    $("#loginForm").classList.toggle("hidden", !loginMode);
    $("#signupForm").classList.toggle("hidden", loginMode);
    $("#authMessage").textContent = "";
  }));
}

async function login(e){
  e.preventDefault();
  const email = $("#loginEmail").value.trim();
  const password = $("#loginPassword").value;
  $("#authMessage").textContent = "جاري تسجيل الدخول...";
  const { data, error } = await sb.auth.signInWithPassword({email,password});
  if(error){
    $("#authMessage").textContent = "تعذر تسجيل الدخول. تأكد من البريد وكلمة المرور.";
    return;
  }
  await enterSession(data.session);
}

async function signup(e){
  e.preventDefault();
  const full_name = $("#signupName").value.trim();
  const email = $("#signupEmail").value.trim();
  const password = $("#signupPassword").value;
  $("#authMessage").textContent = "جاري إنشاء الحساب...";
  const { data, error } = await sb.auth.signUp({
    email, password,
    options:{ data:{ full_name } }
  });
  if(error){
    $("#authMessage").textContent = error.message;
    return;
  }
  $("#authMessage").style.color = "#20a36a";
  $("#authMessage").textContent = data.session
    ? "تم إنشاء الحساب. بانتظار تفعيل الإدارة."
    : "تم إنشاء الحساب. افتح رسالة التأكيد في بريدك ثم سجل الدخول.";
}

async function enterSession(session){
  state.session = session;
  const { data: profile, error } = await sb
    .from("profiles")
    .select("*")
    .eq("id", session.user.id)
    .maybeSingle();

  if(error){
    console.error(error);
    toast("تعذر قراءة الملف الشخصي", "error");
    return;
  }
  state.profile = profile || {
    id:session.user.id,
    full_name:session.user.user_metadata?.full_name || session.user.email,
    email:session.user.email,
    role:"pending",
    is_active:false
  };

  if(!state.profile.is_active || state.profile.role === "pending"){
    $("#authView").classList.add("hidden");
    $("#appView").classList.add("hidden");
    $("#pendingView").classList.remove("hidden");
    return;
  }

  $("#authView").classList.add("hidden");
  $("#pendingView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  buildNav();
  setUserMini();
  await loadAll(false);
}

function showAuth(){
  $("#appView").classList.add("hidden");
  $("#pendingView").classList.add("hidden");
  $("#authView").classList.remove("hidden");
  $("#authMessage").style.color = "";
  $("#authMessage").textContent = "";
}

function resetState(){
  state.session=null; state.profile=null;
  state.orders=[]; state.shops=[]; state.couriers=[]; state.profiles=[];
}

async function logout(){ await sb.auth.signOut(); }

function buildNav(){
  const items = NAV[state.profile.role] || [];
  $("#navMenu").innerHTML = items.map(([id,icon,label]) =>
    `<button class="nav-btn ${state.page===id?"active":""}" data-page="${id}">
      <span class="nav-icon">${icon}</span><span>${label}</span>
    </button>`).join("");
  $$(".nav-btn").forEach(btn=>btn.addEventListener("click",()=>{
    state.page = btn.dataset.page;
    renderPage();
    $("#sidebar").classList.remove("open");
  }));
}

function setUserMini(){
  const name = state.profile.full_name || state.profile.email || "مستخدم";
  $("#userName").textContent = name;
  $("#userRole").textContent = roleLabel(state.profile.role);
  $("#userAvatar").textContent = name.trim().charAt(0) || "و";
}

async function loadAll(showToast=false){
  const tasks = [loadSettings(), loadShops(), loadCouriers(), loadOrders(), loadSettlements()];
  if(isAdmin()) tasks.push(loadProfiles());
  await Promise.all(tasks);
  renderPage();
  if(showToast) toast("تم تحديث البيانات");
}

async function loadSettings(){
  const { data, error } = await sb.from("app_settings").select("key,value");
  if(error){ console.warn("settings", error); return; }
  for(const row of data || []){
    state.settings[row.key] = row.value?.value ?? row.value ?? state.settings[row.key];
  }
}

async function loadShops(){
  let q = sb.from("shops").select("*").order("created_at",{ascending:false});
  const {data,error}=await q;
  if(error){ console.warn(error); state.shops=[]; return; }
  state.shops=data||[];
}

async function loadCouriers(){
  const {data,error}=await sb.from("couriers").select("*").order("created_at",{ascending:false});
  if(error){ console.warn(error); state.couriers=[]; return; }
  state.couriers=data||[];
}

async function loadOrders(){
  let q = sb.from("orders").select("*").order("created_at",{ascending:false});
  const {data,error}=await q;
  if(error){ console.warn(error); state.orders=[]; toast("تعذر تحميل الطلبات", "error"); return; }
  state.orders=data||[];
}
async function loadSettlements(){
  const {data,error} = await sb
    .from("courier_settlements")
    .select("*")
    .order("created_at",{ascending:false});

  if(error){
    console.warn("settlements",error);
    state.settlements=[];
    return;
  }

  state.settlements=data||[];
}
async function loadProfiles(){
  const {data,error}=await sb.from("profiles").select("*").order("created_at",{ascending:false});
  if(error){ console.warn(error); state.profiles=[]; return; }
  state.profiles=data||[];
}

function renderPage(){
  buildNav();
  const pages = {
    dashboard:renderDashboard,
    orders:renderOrders,
    shops:renderShops,
    couriers:renderCouriers,
    map:renderMap,
    accounts:renderAccounts,
    reports:renderReports,
    users:renderUsers,
    settings:renderSettings
  };
  (pages[state.page] || renderDashboard)();
}

function setTitle(title, subtitle="إدارة عمليات وصلّي في كربلاء المقدسة"){
  $("#pageTitle").textContent=title;
  $("#pageSubtitle").textContent=subtitle;
}

function deliveredOrders(){
  return state.orders.filter(o=>o.status==="delivered");
}

function renderDashboard(){
  setTitle("لوحة التحكم");
  const all=state.orders, done=deliveredOrders();
  const today=all.filter(o=>(o.created_at||"").slice(0,10)===todayKey());
  const fees=done.reduce((s,o)=>s+Number(o.fee||0),0);

  const cards = isShop()
    ? [
      ["طلباتي",all.length,"إجمالي الطلبات"],
      ["اليوم",today.length,"طلبات اليوم"],
      ["تم التسليم",done.length,"طلبات مكتملة"],
      ["أجور التوصيل",money(fees),"المكتمل"]
    ]
    : isCourier()
    ? [
      ["المسند إليّ",all.length,"كل الطلبات"],
      ["اليوم",today.length,"طلبات اليوم"],
      ["تم التسليم",done.length,"مكتمل"],
      ["مستحقاتي",money(fees*(Number(state.settings.courier_percent)||75)/100),"تقريبي"]
    ]
    : [
      ["الطلبات",all.length,"إجمالي الطلبات"],
      ["طلبات اليوم",today.length,"منذ بداية اليوم"],
      ["المندوبون",state.couriers.length,"مسجلون بالنظام"],
      ["أجور مكتملة",money(fees),"من الطلبات المسلّمة"]
    ];

  $("#content").innerHTML = `
    <div class="grid stats-grid">
      ${cards.map(c=>`<div class="card stat"><div class="label">${c[0]}</div><div class="value">${c[1]}</div><div class="hint">${c[2]}</div></div>`).join("")}
    </div>
    <div class="grid two-col" style="margin-top:18px">
      <div class="card">
        <div class="card-header"><h2>أحدث الطلبات</h2><button class="btn btn-ghost" data-go="orders">عرض الكل</button></div>
        ${ordersTable(all.slice(0,6), false)}
      </div>
      <div class="card">
        <div class="card-header"><h2>ملخص سريع</h2></div>
        <div class="kpi-line"><span>طلبات جديدة</span><strong>${all.filter(o=>o.status==="new").length}</strong></div>
        <div class="kpi-line"><span>بالطريق</span><strong>${all.filter(o=>o.status==="on_the_way").length}</strong></div>
        <div class="kpi-line"><span>تم التسليم</span><strong>${done.length}</strong></div>
        ${isAdmin()?`<div class="kpi-line"><span>المحلات</span><strong>${state.shops.length}</strong></div>`:""}
      </div>
    </div>`;
  $$("[data-go]").forEach(b=>b.onclick=()=>{state.page=b.dataset.go;renderPage();});
}

function filteredOrders(term=""){
  term=term.toLowerCase().trim();
  if(!term) return state.orders;
  return state.orders.filter(o =>
    String(o.id||"").toLowerCase().includes(term) ||
    String(o.customer||"").toLowerCase().includes(term) ||
    String(o.shop||"").toLowerCase().includes(term) ||
    String(o.phone||"").toLowerCase().includes(term)
  );
}

function ordersTable(list, withActions=true){
  if(!list.length) return `<div class="empty">لا توجد طلبات حالياً</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>الطلب</th><th>المحل</th><th>الزبون</th><th>المندوب</th><th>الأجرة</th><th>الحالة</th>${withActions?"<th>إجراء</th>":""}</tr></thead>
    <tbody>${list.map(o=>`<tr>
      <td><strong>#${esc(o.order_number || o.id)}</strong><small style="display:block;color:#777">${dateTime(o.created_at)}</small></td>
      <td>${esc(o.shop || shopName(o.shop_id))}</td>
      <td><strong>${esc(o.customer)}</strong><small style="display:block;color:#777">${esc(o.phone||"")}</small></td>
      <td>${esc(o.courier || courierName(o.courier_id) || "غير مسند")}</td>
      <td>${money(o.fee)}</td>
      <td>${statusBadge(o.status)}</td>
      ${withActions?`<td><button class="btn btn-ghost" data-order="${esc(o.id)}">فتح</button></td>`:""}
    </tr>`).join("")}</tbody>
  </table></div>`;
}

function shopName(id){ return state.shops.find(s=>String(s.id)===String(id))?.name || ""; }
function courierName(id){ return state.couriers.find(c=>String(c.id)===String(id))?.name || ""; }

function renderOrders(){
  setTitle(isAdmin()?"إدارة الطلبات":"طلباتي");
  $("#content").innerHTML = `
    <div class="card">
      <div class="card-header">
        <h2>📦 الطلبات</h2>
        ${!isCourier()?`<button id="newOrderBtn" class="btn btn-primary">+ إضافة طلب</button>`:""}
      </div>
      <div class="search-row"><input id="orderSearch" placeholder="🔎 ابحث برقم الطلب أو الزبون أو المحل..."></div>
      <div id="ordersList">${ordersTable(state.orders)}</div>
    </div>`;
  $("#orderSearch").oninput=e=>$("#ordersList").innerHTML=ordersTable(filteredOrders(e.target.value));
  $("#newOrderBtn")?.addEventListener("click",()=>openOrderModal());
  bindOrderButtons();
}

function bindOrderButtons(){
  $$("[data-order]").forEach(b=>b.onclick=()=>openOrderDetails(b.dataset.order));
}

function openOrderModal(){
  const fixedShop = isShop() ? String(state.profile.shop_id || "") : "";
  const shopOptions = state.shops.map(s=>`<option value="${esc(s.id)}" ${fixedShop===String(s.id)?"selected":""}>${esc(s.name)}</option>`).join("");
  const courierOptions = state.couriers.filter(c=>c.is_active!==false).map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  modal("إضافة طلب جديد", `
    <form id="orderForm">
      <div class="form-grid">
        <div class="field"><label>المحل</label>
          <select id="fShop" ${isShop()?"disabled":""} required>
            <option value="">اختر المحل</option>${shopOptions}
          </select>
        </div>
        <div class="field"><label>اسم الزبون</label><input id="fCustomer" required></div>
        <div class="field"><label>رقم الهاتف</label><input id="fPhone" inputmode="tel"></div>
        <div class="field"><label>أجرة التوصيل</label><input id="fFee" type="number" value="${Number(state.settings.default_delivery_fee)||3000}" min="0"></div>
        ${isAdmin()?`<div class="field"><label>المندوب</label><select id="fCourier"><option value="">غير مسند</option>${courierOptions}</select></div>`:""}
        <div class="field ${isAdmin()?"":"full"}"><label>الحالة</label><select id="fStatus">
          <option value="new">طلب جديد</option>
          ${isAdmin()?`<option value="assigned">مُسند</option><option value="on_the_way">بالطريق</option><option value="delivered">تم التسليم</option>`:""}
        </select></div>
        <div class="field full"><label>العنوان</label><textarea id="fAddress" placeholder="العنوان أو أقرب نقطة دالة"></textarea></div>
        <div class="field full"><label>ملاحظات</label><textarea id="fNotes"></textarea></div>
      </div>
      <div class="form-actions"><button class="btn btn-ghost" type="button" data-close>إلغاء</button><button class="btn btn-primary" type="submit">حفظ الطلب</button></div>
    </form>`);
  bindClose();
  $("#orderForm").onsubmit=saveOrder;
}

async function saveOrder(e){
  e.preventDefault();
  const shopId = isShop()?state.profile.shop_id:$("#fShop").value;
  const courierId = isAdmin()?$("#fCourier")?.value:"";
  if(!shopId){toast("اختر المحل","warn");return;}
  const shop = state.shops.find(s=>String(s.id)===String(shopId));
  const courier = state.couriers.find(c=>String(c.id)===String(courierId));
  const payload = {
   
  shop_id:String(shopId),
  shop:shop?.name || "",
  
    customer_name:$("#fCustomer").value.trim(),
    phone:$("#fPhone").value.trim(),
    fee:Number($("#fFee").value)||Number(state.settings.default_delivery_fee)||3000,
    courier_id:courierId?String(courierId):null,
    courier:courier?.name || null,
    status:$("#fStatus").value,
    address:$("#fAddress").value.trim(),
    notes:$("#fNotes").value.trim(),
    created_by:state.session.user.id
  };
  const {error}=await sb.from("orders").insert(payload);
  if(error){console.error(error);toast("تعذر حفظ الطلب: "+error.message,"error");return;}
  closeModal(); toast("تمت إضافة الطلب ✅"); await loadOrders(); renderOrders();
}

function openOrderDetails(id){
  const o=state.orders.find(x=>String(x.id)===String(id));
  if(!o)return;
  const canManage=isAdmin();
  const courierFlow=isCourier();
  const courierOptions=state.couriers.map(c=>`<option value="${esc(c.id)}" ${String(o.courier_id||"")===String(c.id)?"selected":""}>${esc(c.name)}</option>`).join("");
  modal(`الطلب #${esc(o.order_number||o.id)}`,`
    <div class="quick-list">
      <div class="quick-item"><span>المحل</span><strong>${esc(o.shop||shopName(o.shop_id))}</strong></div>
      <div class="quick-item"><span>الزبون</span><strong>${esc(o.customer||"—")}</strong></div>
      <div class="quick-item"><span>الهاتف</span><strong>${esc(o.phone||"—")}</strong></div>
      <div class="quick-item"><span>العنوان</span><strong>${esc(o.address||"—")}</strong></div>
      <div class="quick-item"><span>الأجرة</span><strong>${money(o.fee)}</strong></div>
      <div class="quick-item"><span>الحالة</span>${statusBadge(o.status)}</div>
    </div>
    ${canManage?`
      <div class="form-grid" style="margin-top:18px">
        <div class="field"><label>المندوب</label><select id="editCourier"><option value="">غير مسند</option>${courierOptions}</select></div>
        <div class="field"><label>الحالة</label><select id="editStatus">
          ${["new","assigned","picked_up","on_the_way","delivered","cancelled"].map(s=>`<option value="${s}" ${o.status===s?"selected":""}>${statusLabel(s)}</option>`).join("")}
        </select></div>
      </div>
      <div class="form-actions"><button class="btn btn-ghost" data-close>إغلاق</button><button id="saveOrderEdit" class="btn btn-primary">حفظ التغيير</button></div>
    `:courierFlow?`
      <div class="actions" style="margin-top:18px">
        ${o.status==="assigned"||o.status==="new"?`<button class="btn btn-secondary" data-cstatus="picked_up">استلمت الطلب</button>`:""}
        ${o.status==="picked_up"?`<button class="btn btn-primary" data-cstatus="on_the_way">بالطريق</button>`:""}
        ${o.status==="on_the_way"?`<button class="btn btn-primary" data-cstatus="delivered">تم التسليم</button>`:""}
        <button class="btn btn-ghost" data-close>إغلاق</button>
      </div>
    `:`<div class="form-actions"><button class="btn btn-ghost" data-close>إغلاق</button></div>`}
  `);
  bindClose();
  $("#saveOrderEdit")?.addEventListener("click",()=>adminUpdateOrder(o));
  $$("[data-cstatus]").forEach(b=>b.onclick=()=>courierUpdateStatus(o,b.dataset.cstatus));
}

 function statusLabel(s){
  return ({
    new:"طلب جديد",
    assigned:"أُسند",
    accepted:"تم القبول",
    picked_up:"تم الاستلام",
    on_the_way:"بالطريق",
    delivered:"تم التسليم",
    cancelled:"ملغي"
  })[s] || s;
}
async function adminUpdateOrder(o){
  const courierId=$("#editCourier").value || null;
  const courier=state.couriers.find(c=>String(c.id)===String(courierId));
  const payload={courier_id:courierId,courier:courier?.name||null,status:$("#editStatus").value,updated_at:new Date().toISOString()};
  const {error}=await sb.from("orders").update(payload).eq("id",o.id);
  if(error){toast(error.message,"error");return;}
  closeModal(); await loadOrders(); renderOrders(); toast("تم تحديث الطلب");
}

async function courierUpdateStatus(o,status){
  const {error}=await sb.rpc("courier_set_order_status",{p_order_id:String(o.id),p_status:status});
  if(error){console.error(error);toast("تعذر تحديث الحالة: "+error.message,"error");return;}
  closeModal(); await loadOrders(); renderOrders(); toast("تم تحديث حالة الطلب");
}

function renderShops(){
  if(!isAdmin()){state.page="dashboard";return renderDashboard();}
  setTitle("المحلات");
  $("#content").innerHTML=`<div class="card">
    <div class="card-header"><h2>🏪 المحلات</h2><button id="newShop" class="btn btn-primary">+ إضافة محل</button></div>
    ${entityTable(state.shops,"shop")}
  </div>`;
  $("#newShop").onclick=()=>entityModal("shop");
}

function renderCouriers(){
  if(!isAdmin()){state.page="dashboard";return renderDashboard();}
  setTitle("المندوبون");
  $("#content").innerHTML=`<div class="card">
    <div class="card-header"><h2>🛵 المندوبون</h2><button id="newCourier" class="btn btn-primary">+ إضافة مندوب</button></div>
    ${entityTable(state.couriers,"courier")}
  </div>`;
  $("#newCourier").onclick=()=>entityModal("courier");
}

function entityTable(list,type){
  if(!list.length)return `<div class="empty">لا توجد بيانات حالياً</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>الاسم</th><th>الهاتف</th><th>الحالة</th><th>تاريخ الإضافة</th></tr></thead><tbody>
    ${list.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${esc(x.phone||"—")}</td><td>${x.is_active===false?'<span class="badge badge-cancel">موقوف</span>':'<span class="badge badge-done">فعّال</span>'}</td><td>${dateTime(x.created_at)}</td></tr>`).join("")}
  </tbody></table></div>`;
}

function entityModal(type){
  const isS=type==="shop";
  modal(isS?"إضافة محل":"إضافة مندوب",`<form id="entityForm">
    <div class="form-grid">
      <div class="field"><label>الاسم</label><input id="eName" required></div>
      <div class="field"><label>الهاتف</label><input id="ePhone"></div>
      ${isS?`<div class="field"><label>خط العرض (اختياري)</label><input id="eLat" type="number" step="any"></div><div class="field"><label>خط الطول (اختياري)</label><input id="eLng" type="number" step="any"></div>`:""}
    </div>
    <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary">حفظ</button></div>
  </form>`);
  bindClose();
  $("#entityForm").onsubmit=async e=>{
    e.preventDefault();
    const payload={name:$("#eName").value.trim(),phone:$("#ePhone").value.trim(),is_active:true};
    if(isS){payload.lat=$("#eLat").value||null;payload.lng=$("#eLng").value||null;}
    const {error}=await sb.from(isS?"shops":"couriers").insert(payload);
    if(error){toast(error.message,"error");return;}
    closeModal(); toast("تم الحفظ ✅"); await (isS?loadShops():loadCouriers()); isS?renderShops():renderCouriers();
  };
}

function renderMap(){
  if(!isAdmin()){state.page="dashboard";return renderDashboard();}
  setTitle("الخريطة التشغيلية","عرض تشغيلي لكربلاء — بدون تتبع حي للزبائن");
  const located=state.shops.filter(s=>s.lat&&s.lng).length;
  $("#content").innerHTML=`
    <div class="card">
      <div class="card-header"><h2>🗺️ كربلاء المقدسة</h2><span class="badge badge-new">${located} محل بإحداثيات</span></div>
      <div class="map-box">
        <iframe loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=43.94%2C32.56%2C44.12%2C32.70&layer=mapnik&marker=32.616%2C44.024"></iframe>
        <div class="map-overlay">الخريطة مرجعية للإدارة وليست تتبعاً حياً للمندوب.</div>
      </div>
    </div>`;
}

function renderAccounts(){
  setTitle(isCourier() ? "حسابي" : "الحسابات");

  const courierPct = Number(state.settings.courier_percent) || 70;
  const companyPct = Number(state.settings.company_percent) || 30;

  // فقط الطلبات المسلّمة التي لم تتم تسويتها
  const unsettled = state.orders.filter(o =>
    o.status === "delivered" && !o.settlement_id
  );

  if(isCourier()){
    const myOrders = unsettled.filter(o =>
      String(o.courier_id || "") === String(state.profile?.courier_id || "")
    );

    const total = myOrders.reduce((s,o) => s + Number(o.fee || 0), 0);

    $("#content").innerHTML = `
      <div class="grid stats-grid">
        <div class="card stat">
          <div class="label">طلبات غير مسوّاة</div>
          <div class="value">${myOrders.length}</div>
        </div>

        <div class="card stat">
          <div class="label">إجمالي أجور التوصيل</div>
          <div class="value">${money(total)}</div>
        </div>

        <div class="card stat">
          <div class="label">نسبتي</div>
          <div class="value">${courierPct}%</div>
        </div>

        <div class="card stat">
          <div class="label">مستحقاتي</div>
          <div class="value">${money(total * courierPct / 100)}</div>
        </div>
      </div>
    `;
    return;
  }

  if(!isAdmin()){
    state.page = "dashboard";
    return renderDashboard();
  }

  const rows = state.couriers.map(c => {
    const os = unsettled.filter(o =>
      String(o.courier_id || "") === String(c.id) ||
      (!o.courier_id && o.courier === c.name)
    );

    const total = os.reduce((s,o) => s + Number(o.fee || 0), 0);

    return {
      id: c.id,
      name: c.name,
      count: os.length,
      total,
      courier: total * courierPct / 100,
      company: total * companyPct / 100
    };
  });

  $("#content").innerHTML = `
    <div class="card">
      <div class="card-header">
        <h2>حسابات المندوبين</h2>
        <span class="badge badge-new">
          المندوب ${courierPct}% — وصلّي ${companyPct}%
        </span>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>المندوب</th>
              <th>غير المسوّاة</th>
              <th>إجمالي الأجور</th>
              <th>مستحق المندوب</th>
              <th>حصة وصلّي</th>
              <th>التسوية</th>
            </tr>
          </thead>

          <tbody>
            ${rows.map(r => `
              <tr>
                <td><strong>${esc(r.name)}</strong></td>
                <td>${r.count}</td>
                <td>${money(r.total)}</td>
                <td>${money(r.courier)}</td>
                <td>${money(r.company)}</td>
                <td>
                  ${
                    r.count > 0
                    ? `<button class="btn btn-primary"
                         data-settle-courier="${esc(r.id)}">
                         تمت التسوية
                       </button>`
                    : `<span class="badge badge-done">لا توجد مستحقات</span>`
                  }
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  $$("[data-settle-courier]").forEach(btn => {
    btn.onclick = () => settleCourier(btn.dataset.settleCourier);
  });
}

async function settleCourier(courierId){
  if(!isAdmin()) return;

  const courier = state.couriers.find(c =>
    String(c.id) === String(courierId)
  );

  if(!courier){
    toast("لم يتم العثور على المندوب","error");
    return;
  }

  const orders = state.orders.filter(o =>
    o.status === "delivered" &&
    !o.settlement_id &&
    (
      String(o.courier_id || "") === String(courier.id) ||
      (!o.courier_id && o.courier === courier.name)
    )
  );

  if(!orders.length){
    toast("لا توجد طلبات تحتاج إلى تسوية","warn");
    return;
  }

  const courierPct = Number(state.settings.courier_percent) || 70;
  const companyPct = Number(state.settings.company_percent) || 30;

  const total = orders.reduce((s,o) => s + Number(o.fee || 0), 0);
  const courierShare = total * courierPct / 100;
  const companyShare = total * companyPct / 100;

  if(!confirm(
    `تأكيد التسوية ${courier.name}؟\n` +
    `عدد الطلبات: ${orders.length}\n` +
    `إجمالي الأجور: ${money(total)}\n` +
    `مستحق المندوب: ${money(courierShare)}\n` +
    `حصة وصلّي: ${money(companyShare)}`
  )) return;

  const {data:settlement,error:settlementError} = await sb
    .from("courier_settlements")
    .insert({
      courier_id: String(courier.id),
      courier_name: courier.name,
      orders_count: orders.length,
      total_fees: total,
      courier_share: courierShare,
      wasalli_share: companyShare,
      settled_by: state.session.user.id
    })
    .select("id")
    .single();

  if(settlementError){
    toast(settlementError.message,"error");
    return;
  }

  const orderIds = orders.map(o => o.id);

  const {error:updateError} = await sb
    .from("orders")
    .update({settlement_id:settlement.id})
    .in("id",orderIds);

  if(updateError){
    toast(updateError.message,"error");
    return;
  }

  await loadOrders();
  renderAccounts();
  toast("تمت تسوية حساب المندوب بنجاح");
}

function renderReports(){
  if(!isAdmin()){state.page="dashboard";return renderDashboard();}
  setTitle("التقارير");
 const byStatus=["new","assigned","accepted","picked_up","on_the_way","delivered","cancelled"].map(s=>[statusLabel(s),state.orders.filter(o=>o.status===s).length]);
  const totalFees=deliveredOrders().reduce((s,o)=>s+Number(o.fee||0),0);
  $("#content").innerHTML=`<div class="grid two-col">
    <div class="card"><div class="card-header"><h2>📊 حالات الطلبات</h2></div>
      ${byStatus.map(([n,v])=>`<div class="kpi-line"><span>${n}</span><strong>${v}</strong></div>`).join("")}
    </div>
    <div class="card"><div class="card-header"><h2>ملخص مالي</h2></div>
      <div class="kpi-line"><span>الطلبات المسلّمة</span><strong>${deliveredOrders().length}</strong></div>
      <div class="kpi-line"><span>إجمالي أجور التوصيل</span><strong class="money">${money(totalFees)}</strong></div>
      <div class="kpi-line"><span>حصة وصلّي</span><strong class="money">${money(totalFees*(Number(state.settings.company_percent)||25)/100)}</strong></div>
    </div>
  </div>`;
}

function renderUsers(){
  if(!isAdmin()){state.page="dashboard";return renderDashboard();}
  setTitle("الحسابات والصلاحيات");
  $("#content").innerHTML=`<div class="card">
    <div class="card-header"><h2>👥 المستخدمون</h2><span class="badge badge-pending">الجديد = قيد المراجعة</span></div>
    <div class="table-wrap"><table><thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>الربط</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>
      ${state.profiles.map(p=>`<tr>
        <td><strong>${esc(p.full_name||"—")}</strong></td>
        <td>${esc(p.email||"—")}</td>
        <td>${esc(roleLabel(p.role))}</td>
        <td>${p.role==="shop"?esc(shopName(p.shop_id)||"—"):p.role==="courier"?esc(courierName(p.courier_id)||"—"):"—"}</td>
        <td>${p.is_active?'<span class="badge badge-done">فعّال</span>':'<span class="badge badge-pending">موقوف/بانتظار</span>'}</td>
        <td><button class="btn btn-ghost" data-profile="${esc(p.id)}">إدارة</button></td>
      </tr>`).join("")}
    </tbody></table></div>
  </div>`;
  $$("[data-profile]").forEach(b=>b.onclick=()=>profileModal(b.dataset.profile));
}

function profileModal(id){
  const p=state.profiles.find(x=>x.id===id); if(!p)return;
  modal("إدارة الحساب",`<form id="profileForm">
    <div class="notice">${esc(p.email||"")} — ${esc(p.full_name||"")}</div>
    <div class="form-grid">
      <div class="field"><label>الدور</label><select id="pRole">
        <option value="pending" ${p.role==="pending"?"selected":""}>قيد المراجعة</option>
        <option value="shop" ${p.role==="shop"?"selected":""}>محل</option>
        <option value="courier" ${p.role==="courier"?"selected":""}>مندوب</option>
        <option value="admin" ${p.role==="admin"?"selected":""}>إدارة</option>
      </select></div>
      <div class="field"><label>الحالة</label><select id="pActive"><option value="true" ${p.is_active?"selected":""}>فعّال</option><option value="false" ${!p.is_active?"selected":""}>موقوف</option></select></div>
      <div class="field"><label>ربط بمحل</label><select id="pShop"><option value="">بدون</option>${state.shops.map(s=>`<option value="${esc(s.id)}" ${String(p.shop_id||"")===String(s.id)?"selected":""}>${esc(s.name)}</option>`).join("")}</select></div>
      <div class="field"><label>ربط بمندوب</label><select id="pCourier"><option value="">بدون</option>${state.couriers.map(c=>`<option value="${esc(c.id)}" ${String(p.courier_id||"")===String(c.id)?"selected":""}>${esc(c.name)}</option>`).join("")}</select></div>
    </div>
    <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>إلغاء</button><button class="btn btn-primary">حفظ</button></div>
  </form>`);
  bindClose();
  $("#profileForm").onsubmit=async e=>{
    e.preventDefault();
    const payload={role:$("#pRole").value,is_active:$("#pActive").value==="true",shop_id:$("#pShop").value||null,courier_id:$("#pCourier").value||null,updated_at:new Date().toISOString()};
    const {error}=await sb.from("profiles").update(payload).eq("id",p.id);
    if(error){toast(error.message,"error");return;}
    closeModal();await loadProfiles();renderUsers();toast("تم تحديث الحساب");
  };
}

function renderSettings(){
  setTitle("الإعدادات");
  const adminSettings=isAdmin()?`
    <form id="settingsForm">
      <div class="form-grid">
        <div class="field"><label>اسم الشركة</label><input id="sCompany" value="${esc(state.settings.company_name)}"></div>
        <div class="field"><label>منطقة العمل</label><input id="sCity" value="${esc(state.settings.city)}"></div>
        <div class="field"><label>أجرة التوصيل الافتراضية</label><input id="sFee" type="number" value="${Number(state.settings.default_delivery_fee)||3000}"></div>
        <div class="field"><label>رقم واتساب الطلبات</label><input id="sWhatsapp" value="${esc(state.settings.whatsapp||"")}"></div>
        <div class="field"><label>نسبة المندوب %</label><input id="sCourierPct" type="number" min="0" max="100" value="${Number(state.settings.courier_percent)||75}"></div>
        <div class="field"><label>نسبة وصلّي %</label><input id="sCompanyPct" type="number" min="0" max="100" value="${Number(state.settings.company_percent)||25}"></div>
      </div>
      <div class="form-actions"><button class="btn btn-primary">حفظ الإعدادات</button></div>
    </form>`:`<div class="notice">بيانات الحساب والصلاحيات تتم إدارتها من إدارة وصلّي.</div>`;

  $("#content").innerHTML=`<div class="card">
    <div class="card-header"><h2>⚙️ الإعدادات</h2></div>
    ${adminSettings}
    <div class="settings-danger">
      <button id="logoutBtn" class="btn btn-danger">🚪 تسجيل الخروج</button>
    </div>
  </div>`;
  $("#logoutBtn").onclick=logout;
  $("#settingsForm")?.addEventListener("submit",saveSettings);
}

async function saveSettings(e){
  e.preventDefault();
  const cp=Number($("#sCourierPct").value), wp=Number($("#sCompanyPct").value);
  if(cp+wp!==100){toast("نسبة المندوب + نسبة وصلّي يجب أن تساوي 100%","warn");return;}
  const pairs = {
    company_name:$("#sCompany").value.trim(),
    city:$("#sCity").value.trim(),
    default_delivery_fee:Number($("#sFee").value)||3000,
    whatsapp:$("#sWhatsapp").value.trim(),
    courier_percent:cp,
    company_percent:wp
  };
  const rows=Object.entries(pairs).map(([key,value])=>({key,value:{value},updated_at:new Date().toISOString()}));
  const {error}=await sb.from("app_settings").upsert(rows,{onConflict:"key"});
  if(error){toast(error.message,"error");return;}
  Object.assign(state.settings,pairs);toast("تم حفظ الإعدادات ✅");
}

function modal(title,body){
  $("#modalRoot").innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="modal-header"><h2>${esc(title)}</h2><button class="close-btn" data-close>✕</button></div>${body}</div></div>`;
}
function closeModal(){ $("#modalRoot").innerHTML=""; }
function bindClose(){
  $$("[data-close]",$("#modalRoot")).forEach(b=>b.onclick=closeModal);
  $(".modal-backdrop")?.addEventListener("click",e=>{if(e.target.classList.contains("modal-backdrop"))closeModal();});
}

boot();
})();
