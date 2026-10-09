(() => {
  "use strict";

  /* =========================================================
     WASALLI — CLEAN REBUILD
     Self-contained app.js: UI + responsive styles + logic
     ========================================================= */

  const CONFIG = window.WASALLI_CONFIG || {};
  const SUPABASE_URL = CONFIG.SUPABASE_URL || "https://xagwkneegevbllexhvzz.supabase.co";
  const SUPABASE_KEY = CONFIG.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_8Ni4JHptJSjge_fG0vQVGQ_fcEVXEw7";

  const DEFAULTS = {
    appName: CONFIG.APP_NAME || "وصلّي",
    city: CONFIG.CITY || "كربلاء المقدسة",
    deliveryFee: Number(CONFIG.DEFAULT_DELIVERY_FEE || 3000),
    courierPercent: Number(CONFIG.COURIER_PERCENT || 70),
    companyPercent: Number(CONFIG.COMPANY_PERCENT || 30),
    maxActiveOrders: Number(CONFIG.DEFAULT_MAX_ACTIVE_ORDERS || 3),
    pricingA: Number(CONFIG.PRICING?.A || 2000),
    pricingB: Number(CONFIG.PRICING?.B || 3000),
    lateOrderMinutes: Number(CONFIG.LATE_ORDER_MINUTES || 5)
  };

  const ACTIVE_STATUSES = ["assigned", "accepted", "picked_up", "on_the_way"];
  const CLOSED_STATUSES = ["delivered", "returned", "cancelled"];

  const STATUS_LABELS = {
    new: "طلب جديد",
    assigned: "مُسند",
    accepted: "مقبول",
    picked_up: "تم الاستلام من المحل",
    on_the_way: "بالطريق",
    road: "بالطريق",
    delivered: "تم التسليم",
    returned: "راجع",
    cancelled: "ملغي"
  };

  const ROLE_LABELS = {
    admin: "الإدارة",
    operations: "العمليات",
    accountant: "المحاسب",
    courier: "المندوب",
    shop: "المحل",
    customer: "الزبون",
    hotel: "الفندق",
    pending: "بانتظار الموافقة"
  };

  const NAV = {
    admin: [
      ["dashboard", "⌂", "لوحة التحكم"],
      ["orders", "📦", "الطلبات"],
      ["shops", "🏪", "المحلات"],
      ["couriers", "🛵", "المندوبون"],
      ["map", "🗺️", "الخريطة"],
      ["pricing", "📍", "المناطق والتسعير"],
      ["accounts", "💰", "الحسابات"],
      ["reports", "📊", "التقارير"],
      ["users", "👥", "الحسابات والصلاحيات"],
      ["settings", "⚙️", "الإعدادات"]
    ],
    operations: [
      ["dashboard", "⌂", "لوحة العمليات"],
      ["orders", "📦", "الطلبات"],
      ["shops", "🏪", "المحلات"],
      ["couriers", "🛵", "المندوبون"],
      ["map", "🗺️", "الخريطة"],
      ["pricing", "📍", "المناطق والتسعير"],
      ["reports", "📊", "التقارير"],
      ["settings", "⚙️", "الإعدادات"]
    ],
    accountant: [
      ["dashboard", "⌂", "الملخص المالي"],
      ["accounts", "💰", "الحسابات"],
      ["reports", "📊", "التقارير"],
      ["settings", "⚙️", "الحساب"]
    ],
    shop: [
      ["dashboard", "⌂", "لوحة التحكم"],
      ["orders", "📦", "طلباتي"],
      ["accounts", "💰", "الحساب"],
      ["reports", "📊", "الملخص"],
      ["settings", "⚙️", "الحساب"]
    ],
    courier: [
      ["dashboard", "⌂", "الرئيسية"],
      ["orders", "📦", "طلباتي"],
      ["accounts", "💰", "حسابي"],
      ["settings", "⚙️", "الحساب"]
    ]
  };

  const state = {
    sb: null,
    root: null,
    session: null,
    profile: null,
    page: "dashboard",
    settings: {},
    orders: [],
    shops: [],
    couriers: [],
    profiles: [],
    offers: [],
    currentCourier: null,
    notifications: [],
    ledger: [],
    payments: [],
    expenses: [],
    realtime: null,
    dispatchTimer: null,
    activationPromise: null,
    loading: false,
    destroyed: false
  };

  /* =========================================================
     UTILITIES
     ========================================================= */

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function money(value) {
    return new Intl.NumberFormat("ar-IQ").format(safeNumber(value)) + " د.ع";
  }

  function dateTime(value) {
    if (!value) return "—";
    try {
      return new Intl.DateTimeFormat("ar-IQ", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(value));
    } catch {
      return String(value);
    }
  }

  function todayStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function isToday(value) {
    if (!value) return false;
    const t = new Date(value).getTime();
    return Number.isFinite(t) && t >= todayStart().getTime();
  }

  function normalizeIraqiPhone(phone) {
    let value = String(phone || "").replace(/\D/g, "");
    if (!value) return "";
    if (value.startsWith("00964")) value = value.slice(2);
    if (value.startsWith("964")) return value;
    if (value.startsWith("0")) return "964" + value.slice(1);
    if (value.startsWith("7")) return "964" + value;
    return value;
  }

  function localPhone(phone) {
    const p = normalizeIraqiPhone(phone);
    return p.startsWith("964") ? "0" + p.slice(3) : String(phone || "");
  }

  function phoneEmail(phone) {
    const p = normalizeIraqiPhone(phone);
    return p ? `${p}@phone.wasalli.local` : "";
  }

  function role() {
    return state.profile?.role || "pending";
  }

  function isAdmin() { return role() === "admin"; }
  function isOperations() { return role() === "operations"; }
  function isAccountant() { return role() === "accountant"; }
  function isCourier() { return role() === "courier"; }
  function isShop() { return role() === "shop"; }
  function isAdminOrOperations() { return isAdmin() || isOperations(); }
  function isFinanceUser() { return isAdmin() || isAccountant(); }

  function setting(key, fallback) {
    const raw = state.settings[key];
    if (raw === undefined || raw === null || raw === "") return fallback;
    if (typeof raw !== "string") return raw;
    try { return JSON.parse(raw); } catch { return raw; }
  }

  function defaultFee() { return safeNumber(setting("default_delivery_fee", DEFAULTS.deliveryFee), DEFAULTS.deliveryFee); }
  function courierPercent() { return safeNumber(setting("courier_percent", DEFAULTS.courierPercent), DEFAULTS.courierPercent); }
  function companyPercent() { return safeNumber(setting("company_percent", DEFAULTS.companyPercent), DEFAULTS.companyPercent); }
  function pricingA() { return safeNumber(setting("pricing_a", DEFAULTS.pricingA), DEFAULTS.pricingA); }
  function pricingB() { return safeNumber(setting("pricing_b", DEFAULTS.pricingB), DEFAULTS.pricingB); }

  function orderCode(order) {
    if (order?.order_number !== undefined && order?.order_number !== null) return `W-${order.order_number}`;
    return String(order?.id || "").slice(0, 8) || "—";
  }

  function statusLabel(status) { return STATUS_LABELS[status] || status || "—"; }
  function roleLabel(r) { return ROLE_LABELS[r] || r || "—"; }

  function getShop(order) {
    return state.shops.find(x => String(x.id) === String(order?.shop_id)) || null;
  }

  function getCourier(order) {
    return state.couriers.find(x => String(x.id) === String(order?.courier_id)) || null;
  }

  function shopName(order) { return getShop(order)?.name || order?.shop || "غير محدد"; }
  function courierName(order) { return getCourier(order)?.name || order?.courier || "غير مسند"; }
  function customerName(order) { return order?.customer_name || order?.customer || "زبون"; }
  function customerPhone(order) { return order?.customer_phone || order?.phone || ""; }
  function orderAddress(order) { return order?.detailed_address || order?.delivery_address || order?.address || ""; }
  function orderFee(order) { return safeNumber(order?.delivery_fee ?? order?.fee ?? defaultFee()); }
  function orderGoods(order) { return safeNumber(order?.goods_value); }
  function amountToCollect(order) {
    const direct = safeNumber(order?.courier_collection_amount || order?.amount_to_collect);
    if (direct > 0) return direct;
    const mode = order?.payment_mode || order?.payment_method || "cash";
    if (["prepaid", "electronic"].includes(mode)) return 0;
    const payer = order?.delivery_fee_payer || order?.delivery_payer || "customer";
    return orderGoods(order) + (payer === "shop" ? 0 : orderFee(order));
  }

  function isLate(order) {
    if (!order || order.status !== "new" || order.courier_id) return false;
    const t = new Date(order.dispatch_started_at || order.created_at).getTime();
    return Number.isFinite(t) && Date.now() - t >= DEFAULTS.lateOrderMinutes * 60000;
  }

  function googleMapsUrl(lat, lng) {
    if (lat === null || lat === undefined || lng === null || lng === undefined || lat === "" || lng === "") return "";
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
  }

  function safeExternalUrl(value) {
    if (!value) return "";
    try {
      const u = new URL(String(value), window.location.href);
      return ["http:", "https:"].includes(u.protocol) ? u.href : "";
    } catch {
      return "";
    }
  }

  function orderCustomerLat(order) { return order?.customer_lat ?? order?.latitude ?? null; }
  function orderCustomerLng(order) { return order?.customer_lng ?? order?.longitude ?? null; }

  function qs(selector) { return state.root?.querySelector(selector) || null; }
  function qsa(selector) { return state.root ? Array.from(state.root.querySelectorAll(selector)) : []; }

  function debounce(fn, delay = 250) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), delay);
    };
  }

  /* =========================================================
     DATABASE RESILIENCE
     ========================================================= */

  function missingColumn(error) {
    const msg = String(error?.message || "");
    let m = msg.match(/Could not find the '([^']+)' column/i);
    if (m) return m[1];
    m = msg.match(/column\s+"([^"]+)"\s+of\s+relation/i);
    if (m) return m[1];
    m = msg.match(/column\s+([a-zA-Z0-9_]+)\s+does not exist/i);
    return m ? m[1] : null;
  }

  async function resilientInsert(table, payload, returnRow = true) {
    let data = { ...payload };
    for (let i = 0; i < 16; i++) {
      let q = state.sb.from(table).insert(data);
      if (returnRow) q = q.select().maybeSingle();
      const result = await q;
      if (!result.error) return result;
      const col = missingColumn(result.error);
      if (col && Object.prototype.hasOwnProperty.call(data, col)) {
        delete data[col];
        continue;
      }
      return result;
    }
    return { data: null, error: new Error(`تعذر الإدخال في ${table}.`) };
  }

  async function resilientUpdate(table, payload, column, value, returnRow = false) {
    let data = { ...payload };
    for (let i = 0; i < 16; i++) {
      let q = state.sb.from(table).update(data).eq(column, value);
      if (returnRow) q = q.select().maybeSingle();
      const result = await q;
      if (!result.error) return result;
      const col = missingColumn(result.error);
      if (col && Object.prototype.hasOwnProperty.call(data, col)) {
        delete data[col];
        continue;
      }
      return result;
    }
    return { data: null, error: new Error(`تعذر التحديث في ${table}.`) };
  }

  async function loadTable(table, configure) {
    try {
      let q = state.sb.from(table).select("*");
      if (configure) q = configure(q);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.warn(`[Wasalli] ${table}:`, error);
      return [];
    }
  }

  /* =========================================================
     SELF-CONTAINED UI
     ========================================================= */

  function buildUI() {
    document.documentElement.lang = "ar";
    document.documentElement.dir = "rtl";
    document.body.style.margin = "0";
    document.body.style.minHeight = "100vh";

    const host = document.createElement("div");
    host.id = "wasalliMount";
    document.body.replaceChildren(host);
    const root = host.attachShadow({ mode: "open" });
    state.root = root;

    root.innerHTML = `
      <style>${APP_CSS}</style>
      <div id="appRoot" class="root">
        <section id="authView" class="auth-view">
          <div class="auth-layout">
            <div class="auth-brand-panel">
              <div class="big-logo"><span>و</span></div>
              <h1>وصلّي</h1>
              <p>إدارة التوصيل في كربلاء من مكان واحد</p>
              <div class="brand-points">
                <span>طلبات</span><span>مندوبون</span><span>محلات</span><span>حسابات</span>
              </div>
            </div>
            <div class="auth-card-wrap">
              <div class="auth-card">
                <div class="mobile-brand"><span class="mini-logo">و</span><strong>وصلّي</strong></div>
                <div class="auth-tabs">
                  <button type="button" class="auth-tab active" data-auth="login">تسجيل الدخول</button>
                  <button type="button" class="auth-tab" data-auth="signup">إنشاء حساب</button>
                </div>

                <form id="loginForm" class="auth-form">
                  <label>رقم الهاتف أو البريد الإلكتروني</label>
                  <input id="loginIdentifier" autocomplete="username" placeholder="07XXXXXXXXX أو name@email.com" />
                  <label>كلمة المرور</label>
                  <input id="loginPassword" type="password" autocomplete="current-password" placeholder="••••••••" />
                  <button id="loginBtn" class="primary-btn" type="submit">تسجيل الدخول</button>
                </form>

                <form id="signupForm" class="auth-form hidden">
                  <label>الاسم الكامل</label>
                  <input id="signupName" autocomplete="name" placeholder="الاسم الكامل" />
                  <label>رقم الهاتف العراقي</label>
                  <input id="signupPhone" inputmode="tel" autocomplete="tel" placeholder="07XXXXXXXXX" />
                  <label>نوع الحساب</label>
                  <select id="signupType"><option value="courier">مندوب</option><option value="shop">محل / مشروع</option></select>
                  <label>المنطقة</label>
                  <input id="signupArea" placeholder="مثال: باب الخان" />
                  <label>العنوان</label>
                  <input id="signupAddress" placeholder="العنوان المختصر" />
                  <div id="courierSignupFields">
                    <label>نوع المركبة</label>
                    <input id="signupVehicleType" placeholder="دراجة / سيارة" />
                    <label>رقم المركبة</label>
                    <input id="signupVehicleNumber" placeholder="اختياري" />
                  </div>
                  <label>كلمة المرور</label>
                  <input id="signupPassword" type="password" autocomplete="new-password" placeholder="6 أحرف على الأقل" />
                  <button id="signupBtn" class="primary-btn" type="submit">إنشاء الحساب</button>
                </form>
                <div id="authMessage" class="auth-message" aria-live="polite"></div>
              </div>
            </div>
          </div>
        </section>

        <section id="pendingView" class="pending-view hidden">
          <div class="pending-card">
            <div class="pending-icon">⏳</div>
            <h2>الحساب بانتظار الموافقة</h2>
            <p>تم تسجيل الدخول بنجاح، لكن الحساب لم يُفعّل بعد من إدارة وصلّي.</p>
            <button id="pendingLogout" class="secondary-btn">تسجيل الخروج</button>
          </div>
        </section>

        <section id="appView" class="app-view hidden">
          <div class="shell">
            <div id="sidebarBackdrop" class="sidebar-backdrop"></div>
            <aside id="sidebar" class="sidebar">
              <div class="side-brand"><div class="logo-box">و</div><div><strong>وصلّي</strong><small>لخدمات التوصيل</small></div></div>
              <nav id="navList" class="nav-list"></nav>
              <div class="side-user">
                <div id="userAvatar" class="avatar">و</div>
                <div class="user-meta"><strong id="userName">مستخدم</strong><small id="userRole">—</small></div>
              </div>
              <button id="logoutBtn" class="logout-btn">تسجيل الخروج</button>
            </aside>

            <main class="main">
              <header class="topbar">
                <div class="topbar-title-row">
                  <button id="menuToggle" class="icon-btn menu-btn" aria-label="القائمة">☰</button>
                  <div><h1 id="pageTitle">لوحة التحكم</h1><p id="pageSubtitle">${escapeHTML(DEFAULTS.city)}</p></div>
                </div>
                <div class="top-actions">
                  <button id="notificationBtn" class="icon-btn" title="الإشعارات">🔔<span id="notificationBadge" class="notif-badge hidden">0</span></button>
                  <button id="refreshBtn" class="icon-btn" title="تحديث">↻</button>
                </div>
              </header>
              <section id="content" class="content"><div class="loading-card">جاري تحميل النظام...</div></section>
            </main>
          </div>
        </section>

        <div id="toastHost" class="toast-host"></div>
        <div id="modal" class="modal hidden"><div class="modal-backdrop" data-close-modal></div><div id="modalPanel" class="modal-panel"></div></div>
      </div>
    `;

    bindBaseUI();
  }

  const APP_CSS = `
    :host { all: initial; }
    *,*::before,*::after{box-sizing:border-box}
    .root{--p:#5f2b93;--pd:#3f176d;--p2:#783ab3;--t:#17b8b1;--bg:#f6f4f9;--card:#fff;--text:#241a2d;--muted:#776b80;--line:#e9e3ee;--danger:#c83232;--success:#15834b;--warn:#b86a00;font-family:"Tahoma","Arial",sans-serif;color:var(--text);background:var(--bg);min-height:100vh;direction:rtl;font-size:15px}
    button,input,select,textarea{font:inherit} button{cursor:pointer}.hidden{display:none!important}
    .auth-view{min-height:100vh;background:linear-gradient(135deg,#f6f1fb,#fff)}
    .auth-layout{min-height:100vh;display:grid;grid-template-columns:minmax(340px,.9fr) minmax(520px,1.1fr)}
    .auth-brand-panel{background:linear-gradient(155deg,#35126e 0%,#4930ba 48%,#6b30bf 100%);color:#fff;padding:64px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;position:relative;overflow:hidden}
    .auth-brand-panel:before,.auth-brand-panel:after{content:"";position:absolute;border-radius:50%;background:rgba(255,255,255,.06)}.auth-brand-panel:before{width:420px;height:420px;top:-180px;left:-150px}.auth-brand-panel:after{width:300px;height:300px;bottom:-120px;right:-90px}
    .big-logo{width:116px;height:116px;border-radius:31px;background:#fff;color:var(--pd);display:grid;place-items:center;font-size:66px;font-weight:900;box-shadow:0 18px 50px rgba(0,0,0,.18);z-index:1}.auth-brand-panel h1{font-size:54px;margin:18px 0 2px;z-index:1}.auth-brand-panel p{font-size:19px;opacity:.9;z-index:1}.brand-points{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:22px;z-index:1}.brand-points span{padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.13)}
    .auth-card-wrap{display:grid;place-items:center;padding:36px}.auth-card{width:min(100%,470px);background:#fff;border:1px solid var(--line);border-radius:28px;padding:28px;box-shadow:0 20px 70px rgba(59,30,79,.12)}.mobile-brand{display:none;align-items:center;gap:10px;font-size:23px;margin-bottom:22px}.mini-logo{width:42px;height:42px;display:grid;place-items:center;border-radius:12px;background:var(--p);color:#fff;font-size:26px;font-weight:900}
    .auth-tabs{display:grid;grid-template-columns:1fr 1fr;background:#f4eff8;border-radius:14px;padding:4px;margin-bottom:24px}.auth-tab{border:0;background:transparent;padding:12px;border-radius:11px;color:var(--muted);font-weight:800}.auth-tab.active{background:var(--p);color:#fff;box-shadow:0 5px 14px rgba(95,43,147,.25)}
    .auth-form{display:grid;gap:10px}.auth-form label{font-size:13px;font-weight:800;margin-top:5px}.auth-form input,.auth-form select,.field input,.field select,.field textarea,.filter-input{width:100%;border:1px solid #ded5e6;background:#fff;border-radius:12px;padding:12px 13px;outline:none;color:var(--text);transition:.2s}.auth-form input:focus,.auth-form select:focus,.field input:focus,.field select:focus,.field textarea:focus,.filter-input:focus{border-color:var(--p);box-shadow:0 0 0 3px rgba(95,43,147,.09)}
    .primary-btn,.secondary-btn,.danger-btn,.ghost-btn,.success-btn{border:0;border-radius:12px;padding:11px 15px;font-weight:800;transition:.18s;display:inline-flex;align-items:center;justify-content:center;gap:7px}.primary-btn{background:linear-gradient(135deg,var(--p),var(--p2));color:#fff}.secondary-btn{background:#eee7f4;color:var(--pd)}.danger-btn{background:#ffe7e7;color:#9d2222}.success-btn{background:#e1f6e9;color:#11683b}.ghost-btn{background:#fff;color:var(--text);border:1px solid var(--line)}.primary-btn:hover,.secondary-btn:hover,.danger-btn:hover,.ghost-btn:hover,.success-btn:hover{transform:translateY(-1px)}button:disabled{opacity:.55;cursor:not-allowed;transform:none!important}.auth-message{min-height:24px;margin-top:14px;text-align:center;color:#9c3232;font-weight:700;font-size:13px}
    .pending-view{min-height:100vh;display:grid;place-items:center;padding:22px;background:linear-gradient(145deg,#f8f4fc,#fff)}.pending-card{width:min(100%,520px);background:#fff;border-radius:26px;padding:38px;text-align:center;box-shadow:0 18px 60px rgba(60,30,80,.12)}.pending-icon{font-size:48px}.pending-card h2{margin:12px 0}.pending-card p{color:var(--muted);line-height:1.9;margin-bottom:24px}
    .shell{min-height:100vh;display:grid;grid-template-areas:"main side";grid-template-columns:minmax(0,1fr) 286px}.sidebar{grid-area:side;background:linear-gradient(180deg,#1f268d 0%,#562bb6 65%,#6f36bf 100%);color:#fff;min-height:100vh;padding:24px 18px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow:auto;z-index:50}.side-brand{display:flex;align-items:center;gap:12px;padding:2px 7px 24px;border-bottom:1px solid rgba(255,255,255,.14)}.logo-box{width:56px;height:56px;border-radius:17px;background:#fff;color:#25258e;display:grid;place-items:center;font-size:35px;font-weight:900}.side-brand strong{font-size:25px;display:block}.side-brand small{opacity:.82}.nav-list{display:grid;gap:5px;padding:20px 0;flex:1}.nav-item{width:100%;border:0;background:transparent;color:rgba(255,255,255,.88);border-radius:12px;padding:11px 12px;text-align:right;display:flex;align-items:center;gap:11px;font-weight:700}.nav-item:hover,.nav-item.active{background:rgba(255,255,255,.16);color:#fff}.nav-icon{width:27px;text-align:center;font-size:18px}.side-user{display:flex;align-items:center;gap:10px;border-top:1px solid rgba(255,255,255,.14);padding:18px 4px 10px}.avatar{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;background:var(--t);color:#fff;font-size:22px;font-weight:900}.user-meta{min-width:0}.user-meta strong,.user-meta small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.user-meta small{opacity:.75;margin-top:3px}.logout-btn{width:100%;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.1);color:#fff;border-radius:12px;padding:11px;font-weight:800}.main{grid-area:main;min-width:0}.topbar{min-height:88px;background:#fff;border-bottom:1px solid var(--line);padding:16px 26px;display:flex;align-items:center;justify-content:space-between;gap:16px;position:sticky;top:0;z-index:30}.topbar-title-row{display:flex;align-items:center;gap:13px}.topbar h1{font-size:24px;margin:0 0 4px}.topbar p{margin:0;color:var(--muted);font-size:13px}.top-actions{display:flex;gap:8px}.icon-btn{width:42px;height:42px;border:1px solid var(--line);border-radius:12px;background:#fff;display:grid;place-items:center;position:relative;font-size:19px}.menu-btn{display:none}.notif-badge{position:absolute;top:-6px;left:-5px;min-width:19px;height:19px;border-radius:99px;padding:0 5px;background:#d93030;color:#fff;font-size:11px;display:grid;place-items:center;border:2px solid #fff}.content{padding:24px;max-width:1600px;margin:0 auto}.loading-card,.empty{background:#fff;border:1px dashed #d8cce2;border-radius:18px;padding:30px;text-align:center;color:var(--muted)}
    .stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;margin-bottom:18px}.stat-card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:17px;display:flex;align-items:center;gap:13px;box-shadow:0 5px 22px rgba(45,25,65,.04)}.stat-icon{width:45px;height:45px;border-radius:14px;background:#f1e9f8;display:grid;place-items:center;font-size:21px}.stat-card small{display:block;color:var(--muted);margin-bottom:5px}.stat-card strong{font-size:23px}.card{background:#fff;border:1px solid var(--line);border-radius:20px;padding:18px;box-shadow:0 5px 22px rgba(45,25,65,.04)}.card+.card{margin-top:15px}.card-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}.card-header h2{margin:0;font-size:19px}.card-header p{margin:5px 0 0;color:var(--muted);font-size:13px}.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.filters{display:grid;grid-template-columns:minmax(180px,1fr) repeat(2,minmax(130px,.3fr));gap:9px;margin-bottom:14px}.table-wrap{width:100%;overflow:auto;border:1px solid var(--line);border-radius:14px}.data-table{width:100%;border-collapse:collapse;min-width:780px}.data-table th,.data-table td{padding:12px 11px;text-align:right;border-bottom:1px solid #eee9f2;white-space:nowrap}.data-table th{background:#faf8fc;color:#6e6177;font-size:12px}.data-table tbody tr:hover{background:#fcfaff}.data-table tr:last-child td{border-bottom:0}.mobile-list{display:none}.entity-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.entity-card{border:1px solid var(--line);border-radius:17px;padding:15px;background:#fff}.entity-head{display:flex;align-items:center;gap:10px;margin-bottom:12px}.entity-icon{width:43px;height:43px;border-radius:13px;background:#f0e8f7;display:grid;place-items:center;font-size:21px}.entity-head h3{margin:0;font-size:16px}.entity-head p{margin:4px 0 0;color:var(--muted);font-size:12px}.info-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.info-box{background:#faf8fc;border-radius:11px;padding:10px}.info-box small{display:block;color:var(--muted);margin-bottom:3px}.actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.btn-sm{padding:7px 10px;border-radius:10px;font-size:12px}.badge{display:inline-flex;align-items:center;padding:5px 9px;border-radius:999px;font-size:11px;font-weight:800;background:#eee}.badge-new{background:#eee3ff;color:#5d2694}.badge-ok{background:#dff6e8;color:#126a3c}.badge-warn{background:#fff0d4;color:#9b5a00}.badge-danger{background:#ffe3e3;color:#9a2626}.badge-info{background:#dcf7f5;color:#087b76}.late{box-shadow:inset 4px 0 0 #d23b3b;background:#fff8f8}.page-actions{display:flex;gap:8px;flex-wrap:wrap}.muted{color:var(--muted)}.strong{font-weight:900}.kpi{font-size:26px;font-weight:900}.section-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:22px 0 10px}.section-title h2{font-size:19px;margin:0}
    .form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.field{display:grid;gap:6px}.field.full{grid-column:1/-1}.field label{font-size:12px;font-weight:800}.modal{position:fixed;inset:0;z-index:999;display:grid;place-items:center;padding:18px}.modal-backdrop{position:absolute;inset:0;background:rgba(25,14,35,.56);backdrop-filter:blur(3px)}.modal-panel{position:relative;width:min(96vw,780px);max-height:92vh;overflow:auto;background:#fff;border-radius:22px;padding:20px;box-shadow:0 28px 80px rgba(0,0,0,.28)}.modal-title{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:17px}.modal-title h2{margin:0}.close-btn{width:37px;height:37px;border:0;border-radius:11px;background:#f2edf5;font-size:20px}.form-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;flex-wrap:wrap}.toast-host{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2000;width:min(92vw,430px);pointer-events:none}.toast{background:#fff;border-radius:13px;padding:13px 15px;margin-bottom:8px;box-shadow:0 12px 40px rgba(0,0,0,.18);border-right:5px solid var(--p);animation:toastIn .22s ease}.toast.error{border-right-color:#c83232}.toast.warning{border-right-color:#e28a00}.toast.success{border-right-color:#17834c}@keyframes toastIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}
    .sidebar-backdrop{display:none}.courier-hero{background:linear-gradient(135deg,var(--p),var(--pd));color:#fff;border-radius:22px;padding:20px}.courier-hero .badge{background:rgba(255,255,255,.16);color:#fff}.offer-card{border:2px solid rgba(23,184,177,.35);border-radius:18px;padding:15px;background:#fff;margin-bottom:10px}.route{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;background:#f8f5fa;border-radius:12px;padding:11px;margin:10px 0}.financial-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.map-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.link-btn{text-decoration:none}.nowrap{white-space:nowrap}.mobile-only{display:none}.danger-text{color:#a52a2a}.success-text{color:#137343}
    @media(max-width:1200px){.stats-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.entity-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:900px){.shell{display:block}.sidebar{position:fixed;right:0;top:0;width:min(86vw,310px);transform:translateX(105%);transition:.23s ease;box-shadow:-20px 0 50px rgba(0,0,0,.2)}.sidebar.open{transform:none}.sidebar-backdrop{display:block;position:fixed;inset:0;background:rgba(20,10,30,.44);z-index:45;opacity:0;pointer-events:none;transition:.2s}.sidebar-backdrop.show{opacity:1;pointer-events:auto}.menu-btn{display:grid}.topbar{padding:13px 15px}.content{padding:15px}.auth-layout{display:block}.auth-brand-panel{display:none}.auth-card-wrap{min-height:100vh;padding:18px}.mobile-brand{display:flex}.auth-card{padding:21px}.filters{grid-template-columns:1fr 1fr}.filters .filter-input:first-child{grid-column:1/-1}.entity-grid{grid-template-columns:1fr}.financial-grid,.map-grid{grid-template-columns:1fr 1fr}}
    @media(max-width:650px){.topbar h1{font-size:19px}.topbar p{font-size:11px}.stats-grid{grid-template-columns:1fr 1fr;gap:9px}.stat-card{padding:12px;gap:8px}.stat-icon{width:38px;height:38px}.stat-card strong{font-size:19px}.card{padding:13px;border-radius:16px}.card-header{align-items:flex-start}.desktop-table{display:none}.mobile-list{display:grid;gap:9px}.mobile-order-card{border:1px solid var(--line);border-radius:14px;padding:12px;background:#fff}.mobile-order-card .row{display:flex;justify-content:space-between;gap:10px;margin:6px 0}.filters{grid-template-columns:1fr}.filters .filter-input:first-child{grid-column:auto}.form-grid{grid-template-columns:1fr}.field.full{grid-column:auto}.modal{padding:0;align-items:end}.modal-panel{width:100%;max-height:94vh;border-radius:22px 22px 0 0;padding:16px}.financial-grid,.map-grid{grid-template-columns:1fr}.auth-card-wrap{place-items:center}.auth-card{border-radius:20px}.brand-points{display:none}.page-actions{width:100%}.page-actions button{flex:1}.top-actions .icon-btn{width:39px;height:39px}.info-grid{grid-template-columns:1fr 1fr}.mobile-only{display:block}}
  `;

  function bindBaseUI() {
    qs("#loginForm")?.addEventListener("submit", login);
    qs("#signupForm")?.addEventListener("submit", signup);
    qs("#signupType")?.addEventListener("change", toggleSignupFields);
    qs("#pendingLogout")?.addEventListener("click", logout);
    qs("#logoutBtn")?.addEventListener("click", logout);
    qs("#menuToggle")?.addEventListener("click", openSidebar);
    qs("#sidebarBackdrop")?.addEventListener("click", closeSidebar);
    qs("#refreshBtn")?.addEventListener("click", async () => {
      await loadAll(true);
      renderPage();
    });
    qs("#notificationBtn")?.addEventListener("click", openNotifications);
    qsa(".auth-tab").forEach(btn => btn.addEventListener("click", () => switchAuth(btn.dataset.auth)));
    qs("#modal")?.addEventListener("click", e => {
      if (e.target?.hasAttribute?.("data-close-modal")) closeModal();
    });
    window.addEventListener("resize", () => { if (window.innerWidth > 900) closeSidebar(); });
  }

  function switchAuth(mode) {
    qsa(".auth-tab").forEach(b => b.classList.toggle("active", b.dataset.auth === mode));
    qs("#loginForm")?.classList.toggle("hidden", mode !== "login");
    qs("#signupForm")?.classList.toggle("hidden", mode !== "signup");
    setAuthMessage("");
  }

  function toggleSignupFields() {
    const courier = qs("#signupType")?.value === "courier";
    qs("#courierSignupFields")?.classList.toggle("hidden", !courier);
  }

  function showAuth() {
    stopRealtime();
    stopDispatchTimer();
    qs("#authView")?.classList.remove("hidden");
    qs("#pendingView")?.classList.add("hidden");
    qs("#appView")?.classList.add("hidden");
    closeModal();
  }

  function showPending() {
    qs("#authView")?.classList.add("hidden");
    qs("#pendingView")?.classList.remove("hidden");
    qs("#appView")?.classList.add("hidden");
  }

  function showApp() {
    qs("#authView")?.classList.add("hidden");
    qs("#pendingView")?.classList.add("hidden");
    qs("#appView")?.classList.remove("hidden");
  }

  function openSidebar() {
    qs("#sidebar")?.classList.add("open");
    qs("#sidebarBackdrop")?.classList.add("show");
  }

  function closeSidebar() {
    qs("#sidebar")?.classList.remove("open");
    qs("#sidebarBackdrop")?.classList.remove("show");
  }

  function openModal(html) {
    const modal = qs("#modal");
    const panel = qs("#modalPanel");
    if (!modal || !panel) return;
    panel.innerHTML = html;
    modal.classList.remove("hidden");
  }

  function closeModal() {
    qs("#modal")?.classList.add("hidden");
    const panel = qs("#modalPanel");
    if (panel) panel.innerHTML = "";
  }

  function modalHeader(title, subtitle = "") {
    return `<div class="modal-title"><div><h2>${escapeHTML(title)}</h2>${subtitle ? `<p class="muted">${escapeHTML(subtitle)}</p>` : ""}</div><button class="close-btn" data-close-modal>×</button></div>`;
  }

  function toast(message, type = "success") {
    const host = qs("#toastHost");
    if (!host) return;
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = String(message || "");
    host.appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }

  function setAuthMessage(message, type = "error") {
    const el = qs("#authMessage");
    if (!el) return;
    el.textContent = message || "";
    el.style.color = type === "success" ? "#157548" : type === "info" ? "#5f2b93" : "#9c3232";
  }

  function setPageTitle(title, subtitle = "") {
    if (qs("#pageTitle")) qs("#pageTitle").textContent = title;
    if (qs("#pageSubtitle")) qs("#pageSubtitle").textContent = subtitle || setting("city", DEFAULTS.city);
  }

  function setBusy(button, busy, busyText = "جاري...") {
    if (!button) return;
    if (busy) {
      button.dataset.oldText = button.textContent;
      button.disabled = true;
      button.textContent = busyText;
    } else {
      button.disabled = false;
      if (button.dataset.oldText) button.textContent = button.dataset.oldText;
    }
  }

  /* =========================================================
     AUTH + SESSION
     ========================================================= */

  async function login(event) {
    event?.preventDefault();
    const btn = qs("#loginBtn");
    const input = qs("#loginIdentifier")?.value?.trim() || "";
    const password = qs("#loginPassword")?.value || "";
    if (!input || !password) return setAuthMessage("اكتب رقم الهاتف أو البريد الإلكتروني وكلمة المرور.");

    let email = "";
    if (input.includes("@")) email = input.toLowerCase();
    else {
      const phone = normalizeIraqiPhone(input);
      if (!phone || phone.length < 10) return setAuthMessage("رقم الهاتف غير صحيح.");
      email = phoneEmail(phone);
    }

    setBusy(btn, true, "جاري تسجيل الدخول...");
    setAuthMessage("جاري التحقق من الحساب...", "info");
    try {
      const { data, error } = await state.sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data?.session) throw new Error("لم يتم إنشاء جلسة تسجيل دخول.");
      setAuthMessage("");
      await activateSession(data.session);
    } catch (error) {
      console.error("[Wasalli login]", error);
      setAuthMessage("تعذر تسجيل الدخول. تأكد من البيانات وحاول مرة أخرى.");
    } finally {
      setBusy(btn, false);
    }
  }

  async function signup(event) {
    event?.preventDefault();
    const btn = qs("#signupBtn");
    const fullName = qs("#signupName")?.value?.trim() || "";
    const phone = normalizeIraqiPhone(qs("#signupPhone")?.value || "");
    const password = qs("#signupPassword")?.value || "";
    const requestedRole = qs("#signupType")?.value || "courier";
    const area = qs("#signupArea")?.value?.trim() || null;
    const address = qs("#signupAddress")?.value?.trim() || null;
    const vehicleType = requestedRole === "courier" ? (qs("#signupVehicleType")?.value?.trim() || null) : null;
    const vehicleNumber = requestedRole === "courier" ? (qs("#signupVehicleNumber")?.value?.trim() || null) : null;

    if (!fullName || !phone || !password) return setAuthMessage("أكمل الاسم ورقم الهاتف وكلمة المرور.");
    if (password.length < 6) return setAuthMessage("كلمة المرور يجب أن تكون 6 أحرف على الأقل.");
    if (!["courier", "shop"].includes(requestedRole)) return setAuthMessage("نوع الحساب غير مسموح.");

    const email = phoneEmail(phone);
    setBusy(btn, true, "جاري إنشاء الحساب...");
    setAuthMessage("جاري إنشاء الحساب...", "info");
    try {
      const { data, error } = await state.sb.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName, phone, requested_role: requestedRole } }
      });
      if (error) throw error;
      if (!data?.user) throw new Error("تعذر إنشاء المستخدم.");

      const payload = {
        id: data.user.id,
        full_name: fullName,
        phone,
        email,
        role: "pending",
        requested_role: requestedRole,
        is_active: false,
        area,
        address,
        vehicle_type: vehicleType,
        vehicle_number: vehicleNumber,
        updated_at: new Date().toISOString()
      };

      let upsert = await state.sb.from("profiles").upsert(payload, { onConflict: "id" });
      if (upsert.error) console.warn("[Wasalli profile signup]", upsert.error);

      setAuthMessage("تم إنشاء الحساب. بانتظار موافقة الإدارة.", "success");
      if (data.session) await activateSession(data.session);
    } catch (error) {
      console.error("[Wasalli signup]", error);
      setAuthMessage(`تعذر إنشاء الحساب: ${error?.message || "خطأ غير معروف"}`);
    } finally {
      setBusy(btn, false);
    }
  }

  async function loadProfile(session) {
    const { data, error } = await state.sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
    if (error) throw error;
    if (data) return data;

    const meta = session.user.user_metadata || {};
    const fallback = {
      id: session.user.id,
      full_name: meta.full_name || "مستخدم",
      phone: meta.phone || null,
      email: session.user.email || null,
      role: "pending",
      requested_role: meta.requested_role || "courier",
      is_active: false,
      updated_at: new Date().toISOString()
    };
    const created = await state.sb.from("profiles").upsert(fallback, { onConflict: "id" }).select().maybeSingle();
    if (created.error) return fallback;
    return created.data || fallback;
  }

  async function activateSession(session) {
    if (!session?.user?.id) return showAuth();
    if (state.activationPromise) return state.activationPromise;

    state.activationPromise = (async () => {
      try {
        state.session = session;
        const profile = await loadProfile(session);
        state.profile = profile;
        updateUserHeader();

        if (!profile?.is_active || profile.role === "pending") {
          showPending();
          return;
        }

        if (!NAV[profile.role]) {
          toast("نوع صلاحية الحساب غير معروف. راجع الإدارة.", "error");
          showPending();
          return;
        }

        state.page = "dashboard";
        showApp();
        renderNavigation();
        renderLoading("جاري تحميل بيانات الحساب...");
        await loadAll(false);
        renderNavigation();
        renderPage();
        startRealtime();
        if (isAdminOrOperations()) startDispatchTimer();
      } catch (error) {
        console.error("[Wasalli activateSession]", error);
        toast("تعذر تحميل الحساب: " + (error?.message || "خطأ غير معروف"), "error");
        showAuth();
      } finally {
        state.activationPromise = null;
      }
    })();

    return state.activationPromise;
  }

  async function logout() {
    const buttons = [qs("#logoutBtn"), qs("#pendingLogout")].filter(Boolean);
    buttons.forEach(b => setBusy(b, true, "جاري الخروج..."));
    try {
      stopRealtime();
      stopDispatchTimer();
      await state.sb.auth.signOut();
    } catch (error) {
      console.warn("[Wasalli logout]", error);
    } finally {
      resetState();
      showAuth();
      buttons.forEach(b => setBusy(b, false));
    }
  }

  function resetState() {
    state.session = null;
    state.profile = null;
    state.page = "dashboard";
    state.settings = {};
    state.orders = [];
    state.shops = [];
    state.couriers = [];
    state.profiles = [];
    state.offers = [];
    state.currentCourier = null;
    state.notifications = [];
    state.ledger = [];
    state.payments = [];
    state.expenses = [];
    updateUserHeader();
  }

  function updateUserHeader() {
    const name = state.profile?.full_name || "مستخدم";
    if (qs("#userName")) qs("#userName").textContent = name;
    if (qs("#userRole")) qs("#userRole").textContent = roleLabel(role());
    if (qs("#userAvatar")) qs("#userAvatar").textContent = name.trim().charAt(0) || "و";
  }

  /* =========================================================
     DATA LOADING
     ========================================================= */

  async function loadSettings() {
    const rows = await loadTable("app_settings", q => q.limit(200));
    const obj = {};
    rows.forEach(row => { if (row?.key) obj[row.key] = row.value; });
    state.settings = obj;
  }

  async function loadCurrentCourier() {
    state.currentCourier = null;
    if (!isCourier()) return;
    let data = null;
    if (state.profile?.courier_id) {
      const r = await state.sb.from("couriers").select("*").eq("id", state.profile.courier_id).maybeSingle();
      if (!r.error) data = r.data;
    }
    if (!data) {
      const r = await state.sb.from("couriers").select("*").eq("user_id", state.session.user.id).maybeSingle();
      if (!r.error) data = r.data;
    }
    state.currentCourier = data || null;
  }

  async function loadOrders() {
    try {
      let q = state.sb.from("orders").select("*").order("created_at", { ascending: false }).limit(700);
      if (isShop() && state.profile?.shop_id) q = q.eq("shop_id", state.profile.shop_id);
      if (isCourier() && state.currentCourier?.id) q = q.eq("courier_id", state.currentCourier.id);
      const { data, error } = await q;
      if (error) throw error;
      state.orders = data || [];
    } catch (error) {
      console.warn("[Wasalli orders]", error);
      state.orders = [];
    }
  }

  async function loadShops() {
    if (isCourier() || isAccountant()) { state.shops = []; return; }
    try {
      let q = state.sb.from("shops").select("*").order("name", { ascending: true });
      if (isShop() && state.profile?.shop_id) q = q.eq("id", state.profile.shop_id);
      const { data, error } = await q;
      if (error) throw error;
      state.shops = data || [];
    } catch (error) {
      console.warn("[Wasalli shops]", error);
      state.shops = [];
    }
  }

  async function loadCouriers() {
    try {
      let q = state.sb.from("couriers").select("*").order("name", { ascending: true });
      if (isCourier() && state.currentCourier?.id) q = q.eq("id", state.currentCourier.id);
      const { data, error } = await q;
      if (error) throw error;
      state.couriers = data || [];
    } catch (error) {
      console.warn("[Wasalli couriers]", error);
      state.couriers = [];
    }
  }

  async function loadProfiles() {
    if (!isAdmin()) { state.profiles = []; return; }
    state.profiles = await loadTable("profiles", q => q.order("created_at", { ascending: false }).limit(500));
  }

  async function loadOffers() {
    state.offers = [];
    if (!isCourier() || !state.currentCourier?.id) return;
    try {
      const { data, error } = await state.sb.from("order_offers").select("*").eq("courier_id", state.currentCourier.id).eq("status", "offered").order("offered_at", { ascending: false });
      if (error) throw error;
      state.offers = data || [];
    } catch (error) {
      console.warn("[Wasalli offers]", error);
    }
  }

  async function loadNotifications() {
    try {
      const { data, error } = await state.sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      const r = role();
      state.notifications = (data || []).filter(n => {
        if (n.user_id) return String(n.user_id) === String(state.session?.user?.id);
        if (n.target_role) return n.target_role === r;
        return isAdmin();
      });
    } catch (error) {
      state.notifications = [];
      console.warn("[Wasalli notifications]", error);
    }
    updateNotificationBadge();
  }

  async function loadFinance() {
    if (!isFinanceUser()) { state.ledger = []; state.payments = []; state.expenses = []; return; }
    const [ledger, payments, expenses] = await Promise.all([
      loadTable("wasalli_financial_ledger", q => q.order("created_at", { ascending: false }).limit(1200)),
      loadTable("wasalli_courier_payments", q => q.order("created_at", { ascending: false }).limit(500)),
      loadTable("wasalli_expenses", q => q.order("created_at", { ascending: false }).limit(500))
    ]);
    state.ledger = ledger;
    state.payments = payments;
    state.expenses = expenses;
  }

  async function loadAll(showMessage = false) {
    if (!state.profile) return;
    state.loading = true;
    try {
      await loadSettings();
      if (isCourier()) await loadCurrentCourier();
      const jobs = [loadOrders(), loadNotifications()];
      if (!isCourier() && !isAccountant()) jobs.push(loadShops());
      if (isAdminOrOperations() || isAccountant()) jobs.push(loadCouriers());
      if (isCourier()) jobs.push(loadCouriers(), loadOffers());
      if (isAdmin()) jobs.push(loadProfiles());
      if (isFinanceUser()) jobs.push(loadFinance());
      await Promise.all(jobs);
      if (showMessage) toast("تم تحديث البيانات.");
    } catch (error) {
      console.error("[Wasalli loadAll]", error);
      toast("تم تحميل النظام مع تعذر بعض البيانات.", "warning");
    } finally {
      state.loading = false;
    }
  }

  /* =========================================================
     NAVIGATION + ROUTER
     ========================================================= */

  function renderNavigation() {
    const nav = qs("#navList");
    if (!nav) return;
    const items = NAV[role()] || [];
    nav.innerHTML = items.map(([page, icon, label]) => `
      <button class="nav-item ${state.page === page ? "active" : ""}" type="button" data-page="${escapeHTML(page)}">
        <span class="nav-icon">${icon}</span><span>${escapeHTML(label)}</span>
      </button>
    `).join("");
    nav.querySelectorAll("[data-page]").forEach(btn => btn.addEventListener("click", () => {
      state.page = btn.dataset.page;
      closeSidebar();
      renderNavigation();
      renderPage();
    }));
  }

  function canOpenPage(page) {
    return (NAV[role()] || []).some(x => x[0] === page) || page === "dashboard";
  }

  function renderPage() {
    if (!state.profile?.is_active || role() === "pending") return;
    if (!canOpenPage(state.page)) state.page = "dashboard";
    renderNavigation();
    switch (state.page) {
      case "orders": return renderOrders();
      case "shops": return renderShops();
      case "couriers": return renderCouriers();
      case "map": return renderMap();
      case "pricing": return renderPricing();
      case "accounts": return renderAccounts();
      case "reports": return renderReports();
      case "users": return renderUsers();
      case "settings": return renderSettings();
      default: return renderDashboard();
    }
  }

  function renderLoading(message = "جاري التحميل...") {
    const c = qs("#content");
    if (c) c.innerHTML = `<div class="loading-card">${escapeHTML(message)}</div>`;
  }

  function stat(icon, label, value, extra = "") {
    return `<div class="stat-card"><div class="stat-icon">${icon}</div><div><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong>${extra ? `<div class="muted" style="font-size:11px;margin-top:3px">${escapeHTML(extra)}</div>` : ""}</div></div>`;
  }

  function statusBadge(status) {
    let cls = "badge-info";
    if (status === "new") cls = "badge-new";
    if (status === "delivered") cls = "badge-ok";
    if (status === "returned") cls = "badge-warn";
    if (status === "cancelled") cls = "badge-danger";
    return `<span class="badge ${cls}">${escapeHTML(statusLabel(status))}</span>`;
  }

  /* =========================================================
     DASHBOARDS
     ========================================================= */

  function renderDashboard() {
    if (isCourier()) return renderCourierDashboard();
    if (isAccountant()) return renderFinanceDashboard();
    if (isShop()) return renderShopDashboard();
    return renderManagementDashboard();
  }

  function renderManagementDashboard() {
    setPageTitle(isOperations() ? "لوحة العمليات" : "لوحة التحكم", "نظرة مباشرة على عمليات وصلّي");
    const total = state.orders.length;
    const newCount = state.orders.filter(o => o.status === "new").length;
    const active = state.orders.filter(o => ACTIVE_STATUSES.includes(o.status)).length;
    const delivered = state.orders.filter(o => o.status === "delivered" && isToday(o.delivered_at || o.updated_at || o.created_at)).length;
    const returned = state.orders.filter(o => o.status === "returned" && isToday(o.returned_at || o.updated_at || o.created_at)).length;
    const onShift = state.couriers.filter(c => c.is_on_shift).length;
    const available = state.couriers.filter(c => c.is_on_shift && (c.is_available || c.status === "available")).length;
    const late = state.orders.filter(isLate).length;
    const recent = state.orders.slice(0, 12);

    qs("#content").innerHTML = `
      <div class="stats-grid">
        ${stat("📦", "إجمالي الطلبات", total)}
        ${stat("🆕", "طلبات جديدة", newCount)}
        ${stat("🚚", "طلبات نشطة", active)}
        ${stat("✅", "تسليم اليوم", delivered)}
        ${stat("↩", "راجع اليوم", returned)}
        ${stat("🛵", "مندوبون بالدوام", onShift)}
        ${stat("🟢", "متاحون الآن", available)}
        ${stat("⚠", "طلبات متأخرة", late)}
      </div>
      <div class="card">
        <div class="card-header"><div><h2>آخر الطلبات</h2><p>أحدث حركة تشغيلية</p></div><div class="page-actions"><button id="dashNewOrder" class="primary-btn">+ طلب جديد</button><button id="dashAllOrders" class="ghost-btn">كل الطلبات</button></div></div>
        ${ordersTable(recent)}
        ${ordersMobile(recent)}
      </div>`;

    qs("#dashNewOrder")?.addEventListener("click", openNewOrderModal);
    qs("#dashAllOrders")?.addEventListener("click", () => { state.page = "orders"; renderPage(); });
    bindOrderOpenButtons();
  }

  function renderShopDashboard() {
    setPageTitle("لوحة التحكم", "ملخص طلبات المحل");
    const delivered = state.orders.filter(o => o.status === "delivered").length;
    const active = state.orders.filter(o => ACTIVE_STATUSES.includes(o.status) || o.status === "new").length;
    const returned = state.orders.filter(o => o.status === "returned").length;
    qs("#content").innerHTML = `
      <div class="stats-grid">${stat("📦","إجمالي الطلبات",state.orders.length)}${stat("🚚","قيد التنفيذ",active)}${stat("✅","تم التسليم",delivered)}${stat("↩","راجع",returned)}</div>
      <div class="card"><div class="card-header"><div><h2>آخر طلباتي</h2></div><button id="shopNewOrder" class="primary-btn">+ طلب جديد</button></div>${ordersTable(state.orders.slice(0,15))}${ordersMobile(state.orders.slice(0,15))}</div>`;
    qs("#shopNewOrder")?.addEventListener("click", openNewOrderModal);
    bindOrderOpenButtons();
  }

  function courierAssignedOrders() {
    if (!state.currentCourier) return state.orders;
    return state.orders.filter(o => String(o.courier_id) === String(state.currentCourier.id));
  }

  function renderCourierDashboard() {
    setPageTitle("الرئيسية", "واجهة المندوب");
    const courier = state.currentCourier;
    const orders = courierAssignedOrders();
    const active = orders.filter(o => ACTIVE_STATUSES.includes(o.status));
    const today = orders.filter(o => isToday(o.created_at));
    const delivered = today.filter(o => o.status === "delivered").length;
    const returned = today.filter(o => o.status === "returned").length;
    const earnings = today.filter(o => ["delivered", "returned"].includes(o.status)).reduce((s,o) => s + orderFee(o) * courierPercent()/100, 0);
    const cash = orders.filter(o => ["delivered","returned"].includes(o.status)).reduce((s,o) => s + amountToCollect(o), 0);
    const onShift = Boolean(courier?.is_on_shift);
    const available = Boolean(courier?.is_available || courier?.status === "available");

    qs("#content").innerHTML = `
      <div class="courier-hero">
        <div class="card-header" style="margin:0"><div><h2 style="margin:0">${escapeHTML(courier?.name || state.profile?.full_name || "مندوب")}</h2><p style="color:rgba(255,255,255,.8)">${escapeHTML(courier?.area || setting("city", DEFAULTS.city))}</p></div><span class="badge">${onShift ? (available ? "🟢 متاح" : "⏸ غير متاح") : "⛔ خارج الدوام"}</span></div>
        <div class="actions">${onShift ? `<button id="endShift" class="ghost-btn">إنهاء الدوام</button><button id="toggleAvailability" class="secondary-btn">${available ? "إيقاف استقبال الطلبات" : "أصبح متاحاً"}</button>` : `<button id="startShift" class="ghost-btn">بدء الدوام</button>`}</div>
      </div>
      <div class="stats-grid" style="margin-top:14px">${stat("📦","طلبات اليوم",today.length)}${stat("🚚","نشطة",active.length)}${stat("✅","تسليم",delivered)}${stat("↩","راجع",returned)}${stat("💰","أرباح اليوم",money(earnings))}${stat("💵","الكاش بالعهدة",money(cash))}</div>
      ${state.offers.length ? `<div class="section-title"><h2>🔔 عروض توصيل جديدة</h2><span class="badge badge-info">${state.offers.length}</span></div><div>${state.offers.map(renderOfferCard).join("")}</div>` : `<div class="card"><div class="empty">${!onShift ? "ابدأ الدوام لاستقبال الطلبات." : !available ? "فعّل التوفر لاستقبال الطلبات." : "لا توجد عروض جديدة حالياً."}</div></div>`}
      ${active.length ? `<div class="section-title"><h2>الطلبات الحالية</h2></div><div class="entity-grid">${active.map(renderCourierOrderCard).join("")}</div>` : ""}
      <div class="section-title"><h2>آخر الطلبات</h2></div>${ordersMobile(orders.slice(0,12), true)}
    `;

    qs("#startShift")?.addEventListener("click", () => setCourierShift(true));
    qs("#endShift")?.addEventListener("click", () => setCourierShift(false));
    qs("#toggleAvailability")?.addEventListener("click", () => setCourierAvailability(!available));
    bindOfferActions();
    bindCourierOrderActions();
    bindOrderOpenButtons();
  }

  function renderFinanceDashboard() {
    setPageTitle("الملخص المالي", "الحركة المالية في وصلّي");
    const income = state.ledger.filter(x => safeNumber(x.amount) > 0).reduce((s,x)=>s+safeNumber(x.amount),0);
    const expenses = state.expenses.filter(x => !x.reversed_at).reduce((s,x)=>s+safeNumber(x.amount),0);
    const payments = state.payments.reduce((s,x)=>s+safeNumber(x.amount),0);
    qs("#content").innerHTML = `<div class="financial-grid">${stat("💰","إجمالي السجل",money(income))}${stat("🧾","المصاريف",money(expenses))}${stat("🛵","تسديدات المندوبين",money(payments))}</div><div class="card" style="margin-top:15px"><div class="card-header"><h2>آخر الحركات المالية</h2></div>${ledgerTable(state.ledger.slice(0,30))}</div>`;
  }

  /* =========================================================
     ORDERS
     ========================================================= */

  function ordersTable(orders) {
    if (!orders.length) return `<div class="empty desktop-table">لا توجد طلبات.</div>`;
    return `<div class="table-wrap desktop-table"><table class="data-table"><thead><tr><th>الطلب</th><th>المحل</th><th>الزبون</th><th>المنطقة</th><th>المندوب</th><th>الحالة</th><th>الأجرة</th><th>التاريخ</th><th></th></tr></thead><tbody>${orders.map(o => `<tr class="${isLate(o)?"late":""}"><td><strong>${escapeHTML(orderCode(o))}</strong></td><td>${escapeHTML(shopName(o))}</td><td>${escapeHTML(customerName(o))}</td><td>${escapeHTML(o.delivery_area || "—")}</td><td>${escapeHTML(courierName(o))}</td><td>${statusBadge(o.status)}</td><td>${money(orderFee(o))}</td><td>${dateTime(o.created_at)}</td><td><button class="ghost-btn btn-sm" data-open-order="${escapeHTML(o.id)}">فتح</button></td></tr>`).join("")}</tbody></table></div>`;
  }

  function ordersMobile(orders, courierMode = false) {
    if (!orders.length) return `<div class="mobile-list"><div class="empty">لا توجد طلبات.</div></div>`;
    return `<div class="mobile-list">${orders.map(o => `<article class="mobile-order-card ${isLate(o)?"late":""}"><div class="row"><strong>${escapeHTML(orderCode(o))}</strong>${statusBadge(o.status)}</div><div class="row"><span class="muted">${courierMode ? "المحل" : "الزبون"}</span><span>${escapeHTML(courierMode ? shopName(o) : customerName(o))}</span></div><div class="row"><span class="muted">المنطقة</span><span>${escapeHTML(o.delivery_area || "—")}</span></div><div class="row"><span class="muted">الأجرة</span><strong>${money(orderFee(o))}</strong></div><button class="ghost-btn btn-sm" data-open-order="${escapeHTML(o.id)}" style="width:100%;margin-top:8px">فتح الطلب</button></article>`).join("")}</div>`;
  }

  function renderOrders() {
    setPageTitle(isCourier() ? "طلباتي" : isShop() ? "طلبات المحل" : "الطلبات", "إدارة ومتابعة الطلبات");
    const canCreate = isAdminOrOperations() || isShop();
    qs("#content").innerHTML = `
      <div class="card">
        <div class="card-header"><div><h2>الطلبات</h2><p>${state.orders.length} طلب</p></div>${canCreate ? `<button id="newOrderBtn" class="primary-btn">+ طلب جديد</button>` : ""}</div>
        <div class="filters"><input id="orderSearch" class="filter-input" placeholder="بحث بالرقم أو الزبون أو الهاتف أو المنطقة..."><select id="orderStatusFilter" class="filter-input"><option value="">كل الحالات</option>${Object.entries(STATUS_LABELS).map(([v,l])=>`<option value="${v}">${escapeHTML(l)}</option>`).join("")}</select><select id="orderCourierFilter" class="filter-input"><option value="">كل المندوبين</option>${state.couriers.map(c=>`<option value="${escapeHTML(c.id)}">${escapeHTML(c.name || "مندوب")}</option>`).join("")}</select></div>
        <div id="ordersResults">${ordersTable(state.orders)}${ordersMobile(state.orders, isCourier())}</div>
      </div>`;
    qs("#newOrderBtn")?.addEventListener("click", openNewOrderModal);
    const refresh = () => filterOrders();
    qs("#orderSearch")?.addEventListener("input", refresh);
    qs("#orderStatusFilter")?.addEventListener("change", refresh);
    qs("#orderCourierFilter")?.addEventListener("change", refresh);
    bindOrderOpenButtons();
  }

  function filterOrders() {
    const term = (qs("#orderSearch")?.value || "").trim().toLowerCase();
    const status = qs("#orderStatusFilter")?.value || "";
    const courier = qs("#orderCourierFilter")?.value || "";
    const list = state.orders.filter(o => {
      const text = [orderCode(o), customerName(o), customerPhone(o), o.delivery_area, orderAddress(o), shopName(o), courierName(o)].join(" ").toLowerCase();
      return (!term || text.includes(term)) && (!status || o.status === status) && (!courier || String(o.courier_id) === String(courier));
    });
    const target = qs("#ordersResults");
    if (target) target.innerHTML = ordersTable(list) + ordersMobile(list, isCourier());
    bindOrderOpenButtons();
  }

  function bindOrderOpenButtons() {
    qsa("[data-open-order]").forEach(btn => btn.addEventListener("click", () => openOrder(btn.dataset.openOrder)));
  }

  function shopOptions(selected = "") {
    return state.shops.filter(s => s.is_active !== false && !s.archived_at).map(s => `<option value="${escapeHTML(s.id)}" ${String(selected)===String(s.id)?"selected":""}>${escapeHTML(s.name || "محل")}</option>`).join("");
  }

  function courierOptions(selected = "") {
    return state.couriers.filter(c => c.is_active !== false && !c.archived_at).map(c => `<option value="${escapeHTML(c.id)}" ${String(selected)===String(c.id)?"selected":""}>${escapeHTML(c.name || "مندوب")}</option>`).join("");
  }

  function openNewOrderModal() {
    if (!(isAdminOrOperations() || isShop())) return;
    const ownShop = isShop() ? state.profile?.shop_id : "";
    openModal(`${modalHeader("إنشاء طلب جديد", "كربلاء فقط — أدخل بيانات التوصيل")}
      <div class="form-grid">
        ${isShop() ? "" : `<div class="field"><label>المحل</label><select id="newShop"><option value="">اختر المحل</option>${shopOptions()}</select></div>`}
        <div class="field"><label>اسم الزبون</label><input id="newCustomer"></div>
        <div class="field"><label>رقم الهاتف</label><input id="newPhone" inputmode="tel"></div>
        <div class="field"><label>منطقة الاستلام</label><input id="newPickupArea"></div>
        <div class="field"><label>منطقة التوصيل</label><input id="newDeliveryArea"></div>
        <div class="field full"><label>العنوان التفصيلي</label><textarea id="newAddress" rows="2"></textarea></div>
        <div class="field"><label>أقرب نقطة دالة</label><input id="newLandmark"></div>
        <div class="field"><label>رابط موقع الزبون</label><input id="newLocationLink" placeholder="Google Maps"></div>
        <div class="field"><label>قيمة البضاعة</label><input id="newGoods" type="number" min="0" value="0"></div>
        <div class="field"><label>فئة التسعير</label><select id="newPricing"><option value="A">A — ${money(pricingA())}</option><option value="B" selected>B — ${money(pricingB())}</option><option value="C">C — يدوي</option></select></div>
        <div class="field"><label>أجرة التوصيل</label><input id="newFee" type="number" min="0" value="${defaultFee()}"></div>
        <div class="field"><label>طريقة الدفع</label><select id="newPayment"><option value="cash">نقداً عند الاستلام</option><option value="prepaid">مدفوع مسبقاً</option><option value="electronic">إلكتروني</option><option value="shop_account">على حساب المحل</option></select></div>
        <div class="field"><label>أجرة التوصيل على</label><select id="newPayer"><option value="customer">الزبون</option><option value="shop">المحل</option></select></div>
        ${isAdminOrOperations() ? `<div class="field"><label>إسناد مباشر لمندوب</label><select id="newCourier"><option value="">بدون إسناد</option>${courierOptions()}</select></div>` : ""}
        <div class="field full"><label>ملاحظات</label><textarea id="newNotes" rows="2"></textarea></div>
      </div>
      <div class="card" style="margin-top:12px;background:#faf8fc"><span class="muted">المبلغ المطلوب تحصيله من الزبون</span><div id="collectPreview" class="kpi">${money(defaultFee())}</div></div>
      <div class="form-actions"><button class="ghost-btn" data-close-modal>إلغاء</button><button id="saveNewOrder" class="primary-btn">إنشاء الطلب</button></div>`);

    const pricing = qs("#newPricing");
    pricing?.addEventListener("change", () => {
      if (pricing.value === "A") qs("#newFee").value = pricingA();
      if (pricing.value === "B") qs("#newFee").value = pricingB();
      if (pricing.value === "C") qs("#newFee").focus();
      updateCollectPreview();
    });
    ["#newGoods","#newFee","#newPayment","#newPayer"].forEach(s => qs(s)?.addEventListener("input", updateCollectPreview));
    qs("#newShop")?.addEventListener("change", () => {
      const s = state.shops.find(x => String(x.id) === String(qs("#newShop")?.value));
      if (s && qs("#newPickupArea")) qs("#newPickupArea").value = s.area || "";
    });
    qs("#saveNewOrder")?.addEventListener("click", () => saveNewOrder(ownShop));
    updateCollectPreview();
  }

  function updateCollectPreview() {
    const goods = safeNumber(qs("#newGoods")?.value);
    const fee = safeNumber(qs("#newFee")?.value);
    const payment = qs("#newPayment")?.value || "cash";
    const payer = qs("#newPayer")?.value || "customer";
    let amount = 0;
    if (!["prepaid","electronic"].includes(payment)) amount = goods + (payer === "shop" ? 0 : fee);
    if (qs("#collectPreview")) qs("#collectPreview").textContent = money(amount);
  }

  async function saveNewOrder(ownShopId = "") {
    const btn = qs("#saveNewOrder");
    const shopId = ownShopId || qs("#newShop")?.value || null;
    const shop = state.shops.find(x => String(x.id) === String(shopId));
    const customer = qs("#newCustomer")?.value?.trim() || "";
    const phone = localPhone(qs("#newPhone")?.value || "");
    const deliveryArea = qs("#newDeliveryArea")?.value?.trim() || "";
    const address = qs("#newAddress")?.value?.trim() || "";
    if (!shopId) return toast("اختر المحل.", "warning");
    if (!customer || !phone || !deliveryArea || !address) return toast("أكمل اسم الزبون والهاتف والمنطقة والعنوان.", "warning");

    const fee = Math.max(0, safeNumber(qs("#newFee")?.value));
    const goods = Math.max(0, safeNumber(qs("#newGoods")?.value));
    const payment = qs("#newPayment")?.value || "cash";
    const payer = qs("#newPayer")?.value || "customer";
    const courierId = isAdminOrOperations() ? (qs("#newCourier")?.value || null) : null;
    const courier = state.couriers.find(x => String(x.id) === String(courierId));
    let collect = 0;
    if (!["prepaid","electronic"].includes(payment)) collect = goods + (payer === "shop" ? 0 : fee);

    const payload = {
      shop_id: shopId,
      courier_id: courierId,
      customer_name: customer,
      customer,
      customer_phone: phone,
      phone,
      delivery_address: address,
      detailed_address: address,
      address,
      pickup_area: qs("#newPickupArea")?.value?.trim() || shop?.area || "",
      delivery_area: deliveryArea,
      nearest_landmark: qs("#newLandmark")?.value?.trim() || null,
      customer_location_link: qs("#newLocationLink")?.value?.trim() || null,
      delivery_fee: fee,
      fee,
      goods_value: goods,
      payment_mode: payment,
      payment_method: payment,
      delivery_fee_payer: payer,
      delivery_payer: payer,
      pricing_class: qs("#newPricing")?.value || "B",
      amount_to_collect: collect,
      courier_collection_amount: collect,
      status: courierId ? "assigned" : "new",
      shop: shop?.name || null,
      courier: courier?.name || null,
      notes: qs("#newNotes")?.value?.trim() || null,
      source: isShop() ? "shop" : "admin",
      created_by: state.session.user.id,
      assigned_at: courierId ? new Date().toISOString() : null,
      dispatch_started_at: !courierId ? new Date().toISOString() : null
    };

    setBusy(btn, true, "جاري الحفظ...");
    try {
      const { error } = await resilientInsert("orders", payload, false);
      if (error) throw error;
      closeModal();
      await loadAll(false);
      state.page = "orders";
      renderPage();
      toast("تم إنشاء الطلب.");
    } catch (error) {
      console.error(error);
      toast("تعذر إنشاء الطلب: " + (error?.message || "خطأ"), "error");
    } finally { setBusy(btn, false); }
  }

  function openOrder(id) {
    const o = state.orders.find(x => String(x.id) === String(id));
    if (!o) return;
    const phone = customerPhone(o);
    const mapUrl = safeExternalUrl(o.customer_location_link) || googleMapsUrl(orderCustomerLat(o), orderCustomerLng(o));
    const canManage = isAdminOrOperations();
    openModal(`${modalHeader(`الطلب ${orderCode(o)}`, statusLabel(o.status))}
      <div class="info-grid">
        <div class="info-box"><small>المحل</small><strong>${escapeHTML(shopName(o))}</strong></div>
        <div class="info-box"><small>المندوب</small><strong>${escapeHTML(courierName(o))}</strong></div>
        <div class="info-box"><small>الزبون</small><strong>${escapeHTML(customerName(o))}</strong></div>
        <div class="info-box"><small>الهاتف</small><strong>${escapeHTML(phone || "—")}</strong></div>
        <div class="info-box"><small>منطقة التوصيل</small><strong>${escapeHTML(o.delivery_area || "—")}</strong></div>
        <div class="info-box"><small>أجرة التوصيل</small><strong>${money(orderFee(o))}</strong></div>
        <div class="info-box"><small>قيمة البضاعة</small><strong>${money(orderGoods(o))}</strong></div>
        <div class="info-box"><small>المبلغ للتحصيل</small><strong>${money(amountToCollect(o))}</strong></div>
      </div>
      <div class="card" style="margin-top:12px"><small class="muted">العنوان</small><p>${escapeHTML(orderAddress(o) || "—")}</p>${o.nearest_landmark ? `<small class="muted">أقرب نقطة: ${escapeHTML(o.nearest_landmark)}</small>` : ""}</div>
      <div class="actions">
        ${phone ? `<a class="success-btn link-btn" href="tel:${escapeHTML(phone)}">📞 اتصال</a><a class="success-btn link-btn" target="_blank" rel="noopener" href="https://wa.me/${normalizeIraqiPhone(phone)}">واتساب</a>` : ""}
        ${mapUrl ? `<a class="ghost-btn link-btn" target="_blank" rel="noopener" href="${escapeHTML(mapUrl)}">📍 فتح الموقع</a>` : ""}
      </div>
      ${canManage ? `<div class="section-title"><h2>إدارة الطلب</h2></div><div class="form-grid"><div class="field"><label>المندوب</label><select id="editOrderCourier"><option value="">غير مسند</option>${courierOptions(o.courier_id)}</select></div><div class="field"><label>الحالة</label><select id="editOrderStatus">${Object.entries(STATUS_LABELS).map(([v,l])=>`<option value="${v}" ${o.status===v?"selected":""}>${escapeHTML(l)}</option>`).join("")}</select></div></div><div class="form-actions"><button id="saveOrderManage" class="primary-btn">حفظ التغييرات</button></div>` : ""}`);
    qs("#saveOrderManage")?.addEventListener("click", () => saveManagedOrder(o));
  }

  async function saveManagedOrder(order) {
    const btn = qs("#saveOrderManage");
    const courierId = qs("#editOrderCourier")?.value || null;
    const status = qs("#editOrderStatus")?.value || order.status;
    const courier = state.couriers.find(x => String(x.id) === String(courierId));
    const now = new Date().toISOString();
    const payload = { courier_id: courierId, courier: courier?.name || null, status, updated_at: now };
    if (courierId && !order.courier_id) payload.assigned_at = now;
    if (status === "accepted") payload.accepted_at = now;
    if (status === "picked_up") payload.picked_up_at = now;
    if (status === "on_the_way") payload.on_the_way_at = now;
    if (status === "delivered") payload.delivered_at = now;
    if (status === "returned") payload.returned_at = now;
    if (status === "cancelled") payload.cancelled_at = now;
    setBusy(btn,true,"جاري الحفظ...");
    try {
      const { error } = await resilientUpdate("orders", payload, "id", order.id);
      if (error) throw error;
      closeModal(); await loadAll(false); renderPage(); toast("تم تحديث الطلب.");
    } catch (error) { toast("تعذر تحديث الطلب: " + (error?.message || "خطأ"), "error"); }
    finally { setBusy(btn,false); }
  }

  /* =========================================================
     SHOPS
     ========================================================= */

  function renderShops() {
    if (!isAdminOrOperations()) return goDashboard();
    setPageTitle("المحلات", "إدارة المحلات المتعاونة مع وصلّي");
    const active = state.shops.filter(s => s.is_active !== false && !s.archived_at);
    const archived = state.shops.filter(s => s.is_active === false || s.archived_at);
    qs("#content").innerHTML = `<div class="card"><div class="card-header"><div><h2>المحلات</h2><p>${active.length} محل فعال</p></div><button id="addShopBtn" class="primary-btn">+ إضافة محل</button></div><input id="shopSearch" class="filter-input" placeholder="بحث باسم المحل أو الهاتف أو المنطقة..." style="margin-bottom:13px"><div id="shopsGrid" class="entity-grid">${shopCards(active)}</div></div>${archived.length ? `<div class="card"><div class="card-header"><h2>الأرشيف</h2><span class="badge">${archived.length}</span></div><div class="entity-grid">${shopCards(archived,true)}</div></div>` : ""}`;
    qs("#addShopBtn")?.addEventListener("click", () => openShopModal());
    qs("#shopSearch")?.addEventListener("input", e => { const t=e.target.value.toLowerCase(); const list=active.filter(s=>[s.name,s.phone,s.area,s.address].join(" ").toLowerCase().includes(t)); if(qs("#shopsGrid")) qs("#shopsGrid").innerHTML=shopCards(list); bindShopActions(); });
    bindShopActions();
  }

  function shopCards(list, archived = false) {
    if (!list.length) return `<div class="empty">لا توجد محلات.</div>`;
    return list.map(s => `<article class="entity-card"><div class="entity-head"><div class="entity-icon">🏪</div><div><h3>${escapeHTML(s.name || "محل")}</h3><p>${escapeHTML(s.area || "—")}</p></div></div><div class="info-grid"><div class="info-box"><small>الهاتف</small><strong>${escapeHTML(s.phone || "—")}</strong></div><div class="info-box"><small>الحالة</small><strong>${archived?"مؤرشف":"فعال"}</strong></div></div><div class="actions"><button class="ghost-btn btn-sm" data-edit-shop="${escapeHTML(s.id)}">تعديل</button>${isAdmin()?`<button class="${archived?"success-btn":"danger-btn"} btn-sm" data-toggle-shop="${escapeHTML(s.id)}" data-active="${archived?"1":"0"}">${archived?"استرجاع":"أرشفة"}</button>`:""}</div></article>`).join("");
  }

  function bindShopActions() {
    qsa("[data-edit-shop]").forEach(b=>b.addEventListener("click",()=>openShopModal(state.shops.find(s=>String(s.id)===String(b.dataset.editShop)))));
    qsa("[data-toggle-shop]").forEach(b=>b.addEventListener("click",()=>toggleShop(b.dataset.toggleShop,b.dataset.active==="1")));
  }

  function openShopModal(shop = null) {
    openModal(`${modalHeader(shop?"تعديل محل":"إضافة محل")}<div class="form-grid"><div class="field"><label>اسم المحل</label><input id="shopName" value="${escapeHTML(shop?.name||"")}"></div><div class="field"><label>الهاتف</label><input id="shopPhone" value="${escapeHTML(shop?.phone||"")}"></div><div class="field"><label>المنطقة</label><input id="shopArea" value="${escapeHTML(shop?.area||"")}"></div><div class="field full"><label>العنوان</label><textarea id="shopAddress">${escapeHTML(shop?.address||"")}</textarea></div></div><div class="form-actions"><button class="ghost-btn" data-close-modal>إلغاء</button><button id="saveShopBtn" class="primary-btn">حفظ</button></div>`);
    qs("#saveShopBtn")?.addEventListener("click",()=>saveShop(shop));
  }

  async function saveShop(shop) {
    const btn=qs("#saveShopBtn"); const name=qs("#shopName")?.value?.trim(); if(!name)return toast("اسم المحل مطلوب.","warning");
    const payload={name,phone:localPhone(qs("#shopPhone")?.value||""),area:qs("#shopArea")?.value?.trim()||null,address:qs("#shopAddress")?.value?.trim()||null,is_active:true,updated_at:new Date().toISOString()};
    setBusy(btn,true,"جاري الحفظ...");
    try{const r=shop?await resilientUpdate("shops",payload,"id",shop.id):await resilientInsert("shops",payload,false);if(r.error)throw r.error;closeModal();await loadAll(false);renderPage();toast("تم حفظ المحل.");}catch(e){toast("تعذر حفظ المحل: "+(e?.message||"خطأ"),"error");}finally{setBusy(btn,false)}
  }

  async function toggleShop(id, active) {
    const payload={is_active:active,archived_at:active?null:new Date().toISOString(),updated_at:new Date().toISOString()};
    const r=await resilientUpdate("shops",payload,"id",id); if(r.error)return toast("تعذر تحديث المحل.","error"); await loadAll(false);renderPage();toast(active?"تم استرجاع المحل.":"تمت أرشفة المحل.");
  }

  /* =========================================================
     COURIERS
     ========================================================= */

  function renderCouriers() {
    if (!isAdminOrOperations()) return goDashboard();
    setPageTitle("المندوبون", "إدارة المندوبين والدوام والتوفر");
    const active=state.couriers.filter(c=>c.is_active!==false&&!c.archived_at); const archived=state.couriers.filter(c=>c.is_active===false||c.archived_at);
    qs("#content").innerHTML=`<div class="stats-grid">${stat("🛵","المندوبون",active.length)}${stat("🟢","متاحون",active.filter(c=>c.is_on_shift&&(c.is_available||c.status==="available")).length)}${stat("⏱","بالدوام",active.filter(c=>c.is_on_shift).length)}${stat("📦","طلبات نشطة",state.orders.filter(o=>ACTIVE_STATUSES.includes(o.status)).length)}</div><div class="card"><div class="card-header"><div><h2>المندوبون</h2></div><button id="addCourierBtn" class="primary-btn">+ إضافة مندوب</button></div><input id="courierSearch" class="filter-input" placeholder="بحث بالاسم أو الهاتف أو المنطقة..." style="margin-bottom:13px"><div id="couriersGrid" class="entity-grid">${courierCards(active)}</div></div>${archived.length?`<div class="card"><div class="card-header"><h2>الأرشيف</h2></div><div class="entity-grid">${courierCards(archived,true)}</div></div>`:""}`;
    qs("#addCourierBtn")?.addEventListener("click",()=>openCourierModal());
    qs("#courierSearch")?.addEventListener("input",e=>{const t=e.target.value.toLowerCase();const l=active.filter(c=>[c.name,c.phone,c.area,c.vehicle_type,c.vehicle_number].join(" ").toLowerCase().includes(t));if(qs("#couriersGrid"))qs("#couriersGrid").innerHTML=courierCards(l);bindCourierManagement();});
    bindCourierManagement();
  }

  function courierCards(list, archived=false) {
    if(!list.length)return `<div class="empty">لا يوجد مندوبون.</div>`;
    return list.map(c=>{const activeOrders=state.orders.filter(o=>String(o.courier_id)===String(c.id)&&ACTIVE_STATUSES.includes(o.status)).length;const available=c.is_on_shift&&(c.is_available||c.status==="available");return `<article class="entity-card"><div class="entity-head"><div class="entity-icon">🛵</div><div><h3>${escapeHTML(c.name||"مندوب")}</h3><p>${escapeHTML(c.area||"—")}</p></div></div><div class="info-grid"><div class="info-box"><small>الهاتف</small><strong>${escapeHTML(c.phone||"—")}</strong></div><div class="info-box"><small>الحالة</small><strong class="${available?"success-text":""}">${archived?"مؤرشف":available?"متاح":c.is_on_shift?"غير متاح":"خارج الدوام"}</strong></div><div class="info-box"><small>طلبات نشطة</small><strong>${activeOrders}</strong></div><div class="info-box"><small>المركبة</small><strong>${escapeHTML(c.vehicle_type||"—")}</strong></div></div><div class="actions"><button class="ghost-btn btn-sm" data-edit-courier="${escapeHTML(c.id)}">تعديل</button>${isAdmin()?`<button class="${archived?"success-btn":"danger-btn"} btn-sm" data-toggle-courier="${escapeHTML(c.id)}" data-active="${archived?"1":"0"}">${archived?"استرجاع":"أرشفة"}</button>`:""}</div></article>`}).join("");
  }

  function bindCourierManagement(){qsa("[data-edit-courier]").forEach(b=>b.addEventListener("click",()=>openCourierModal(state.couriers.find(c=>String(c.id)===String(b.dataset.editCourier)))));qsa("[data-toggle-courier]").forEach(b=>b.addEventListener("click",()=>toggleCourier(b.dataset.toggleCourier,b.dataset.active==="1")));}

  function openCourierModal(c=null){openModal(`${modalHeader(c?"تعديل مندوب":"إضافة مندوب")}<div class="form-grid"><div class="field"><label>الاسم</label><input id="courierName" value="${escapeHTML(c?.name||"")}"></div><div class="field"><label>الهاتف</label><input id="courierPhone" value="${escapeHTML(c?.phone||"")}"></div><div class="field"><label>المنطقة</label><input id="courierArea" value="${escapeHTML(c?.area||"")}"></div><div class="field"><label>نوع المركبة</label><input id="courierVehicle" value="${escapeHTML(c?.vehicle_type||"")}"></div><div class="field"><label>رقم المركبة</label><input id="courierVehicleNo" value="${escapeHTML(c?.vehicle_number||"")}"></div><div class="field"><label>الحد الأعلى للطلبات النشطة</label><input id="courierMax" type="number" min="1" value="${safeNumber(c?.max_active_orders||setting("default_max_active_orders",DEFAULTS.maxActiveOrders))}"></div></div><div class="form-actions"><button class="ghost-btn" data-close-modal>إلغاء</button><button id="saveCourierBtn" class="primary-btn">حفظ</button></div>`);qs("#saveCourierBtn")?.addEventListener("click",()=>saveCourier(c));}

  async function saveCourier(c){const btn=qs("#saveCourierBtn");const name=qs("#courierName")?.value?.trim();if(!name)return toast("اسم المندوب مطلوب.","warning");const payload={name,phone:localPhone(qs("#courierPhone")?.value||""),area:qs("#courierArea")?.value?.trim()||null,vehicle_type:qs("#courierVehicle")?.value?.trim()||null,vehicle_number:qs("#courierVehicleNo")?.value?.trim()||null,max_active_orders:Math.max(1,safeNumber(qs("#courierMax")?.value,DEFAULTS.maxActiveOrders)),is_active:true,updated_at:new Date().toISOString()};setBusy(btn,true,"جاري الحفظ...");try{const r=c?await resilientUpdate("couriers",payload,"id",c.id):await resilientInsert("couriers",{...payload,status:"unavailable",is_available:false,is_on_shift:false},false);if(r.error)throw r.error;closeModal();await loadAll(false);renderPage();toast("تم حفظ المندوب.");}catch(e){toast("تعذر حفظ المندوب: "+(e?.message||"خطأ"),"error");}finally{setBusy(btn,false)}}

  async function toggleCourier(id,active){const r=await resilientUpdate("couriers",{is_active:active,archived_at:active?null:new Date().toISOString(),updated_at:new Date().toISOString()},"id",id);if(r.error)return toast("تعذر تحديث المندوب.","error");await loadAll(false);renderPage();toast(active?"تم استرجاع المندوب.":"تمت أرشفة المندوب.");}

  /* =========================================================
     MAP / PRICING
     ========================================================= */

  function renderMap() {
    if (!isAdminOrOperations()) return goDashboard();
    setPageTitle("الخريطة", "مواقع الطلبات والجهات المسجلة");
    const points = [];
    state.orders.forEach(o => { const lat=orderCustomerLat(o), lng=orderCustomerLng(o); if(lat!=null&&lng!=null) points.push({type:"طلب",name:`${orderCode(o)} — ${customerName(o)}`,url:googleMapsUrl(lat,lng)}); else if(safeExternalUrl(o.customer_location_link)) points.push({type:"طلب",name:`${orderCode(o)} — ${customerName(o)}`,url:safeExternalUrl(o.customer_location_link)}); });
    state.shops.forEach(s=>{const lat=s.lat??s.latitude,lng=s.lng??s.longitude;if(lat!=null&&lng!=null)points.push({type:"محل",name:s.name||"محل",url:googleMapsUrl(lat,lng)});});
    qs("#content").innerHTML=`<div class="card"><div class="card-header"><div><h2>المواقع</h2><p>${points.length} موقع متوفر</p></div></div>${points.length?`<div class="map-grid">${points.slice(0,100).map(p=>`<div class="entity-card"><div class="entity-head"><div class="entity-icon">📍</div><div><h3>${escapeHTML(p.name)}</h3><p>${escapeHTML(p.type)}</p></div></div><a class="primary-btn link-btn" target="_blank" rel="noopener" href="${escapeHTML(p.url)}">فتح في الخرائط</a></div>`).join("")}</div>`:`<div class="empty">لا توجد إحداثيات أو روابط خرائط محفوظة حالياً.</div>`}</div>`;
  }

  function renderPricing() {
    if (!isAdminOrOperations()) return goDashboard();
    setPageTitle("المناطق والتسعير", "إعداد فئات أجور التوصيل");
    const editable=isAdmin();
    qs("#content").innerHTML=`<div class="card"><div class="card-header"><div><h2>فئات التسعير</h2><p>يمكن اختيار الفئة عند إنشاء الطلب أو تحديد سعر يدوي.</p></div></div><div class="form-grid"><div class="field"><label>الفئة A</label><input id="priceA" type="number" min="0" value="${pricingA()}" ${editable?"":"disabled"}></div><div class="field"><label>الفئة B</label><input id="priceB" type="number" min="0" value="${pricingB()}" ${editable?"":"disabled"}></div><div class="field"><label>السعر الافتراضي</label><input id="defaultFeeSetting" type="number" min="0" value="${defaultFee()}" ${editable?"":"disabled"}></div><div class="field"><label>المدينة</label><input value="${escapeHTML(setting("city",DEFAULTS.city))}" disabled></div></div>${editable?`<div class="form-actions"><button id="savePricingBtn" class="primary-btn">حفظ التسعير</button></div>`:""}</div>`;
    qs("#savePricingBtn")?.addEventListener("click",savePricing);
  }

  async function savePricing(){const btn=qs("#savePricingBtn");setBusy(btn,true,"جاري الحفظ...");try{await saveSettingsRows([{key:"pricing_a",value:safeNumber(qs("#priceA")?.value)},{key:"pricing_b",value:safeNumber(qs("#priceB")?.value)},{key:"default_delivery_fee",value:safeNumber(qs("#defaultFeeSetting")?.value)}]);await loadSettings();renderPage();toast("تم حفظ التسعير.");}catch(e){toast("تعذر حفظ التسعير: "+(e?.message||"خطأ"),"error");}finally{setBusy(btn,false)}}

  /* =========================================================
     ACCOUNTS / FINANCE
     ========================================================= */

  function renderAccounts() {
    if (isCourier()) return renderCourierAccount();
    if (isShop()) return renderShopAccount();
    if (!isFinanceUser()) return goDashboard();
    setPageTitle("الحسابات", "السجل المالي والتسويات والمصاريف");
    const ledgerTotal=state.ledger.reduce((s,x)=>s+safeNumber(x.amount),0);const expenseTotal=state.expenses.filter(x=>!x.reversed_at).reduce((s,x)=>s+safeNumber(x.amount),0);const paymentTotal=state.payments.reduce((s,x)=>s+safeNumber(x.amount),0);
    qs("#content").innerHTML=`<div class="financial-grid">${stat("📒","صافي السجل",money(ledgerTotal))}${stat("🧾","المصاريف",money(expenseTotal))}${stat("🛵","تسديدات المندوبين",money(paymentTotal))}</div><div class="card" style="margin-top:15px"><div class="card-header"><h2>السجل المالي</h2>${isAdmin()?`<div class="page-actions"><button id="addExpenseBtn" class="primary-btn">+ مصروف</button><button id="addPaymentBtn" class="ghost-btn">+ تسديد مندوب</button></div>`:""}</div>${ledgerTable(state.ledger)}</div><div class="card"><div class="card-header"><h2>المصاريف</h2></div>${expensesTable()}</div><div class="card"><div class="card-header"><h2>تسديدات المندوبين</h2></div>${paymentsTable()}</div>`;
    qs("#addExpenseBtn")?.addEventListener("click",openExpenseModal);qs("#addPaymentBtn")?.addEventListener("click",openPaymentModal);
  }

  function ledgerTable(rows){if(!rows.length)return `<div class="empty">لا توجد حركات مالية.</div>`;return `<div class="table-wrap"><table class="data-table"><thead><tr><th>النوع</th><th>الوصف</th><th>المبلغ</th><th>التاريخ</th></tr></thead><tbody>${rows.slice(0,120).map(x=>`<tr><td>${escapeHTML(x.entry_type||x.type||"حركة")}</td><td>${escapeHTML(x.description||x.notes||"—")}</td><td><strong>${money(x.amount)}</strong></td><td>${dateTime(x.created_at)}</td></tr>`).join("")}</tbody></table></div>`}
  function expensesTable(){if(!state.expenses.length)return `<div class="empty">لا توجد مصاريف.</div>`;return `<div class="table-wrap"><table class="data-table"><thead><tr><th>الفئة</th><th>الوصف</th><th>المبلغ</th><th>التاريخ</th></tr></thead><tbody>${state.expenses.slice(0,100).map(x=>`<tr><td>${escapeHTML(x.category||"أخرى")}</td><td>${escapeHTML(x.description||"—")}</td><td>${money(x.amount)}</td><td>${dateTime(x.created_at)}</td></tr>`).join("")}</tbody></table></div>`}
  function paymentsTable(){if(!state.payments.length)return `<div class="empty">لا توجد تسديدات.</div>`;return `<div class="table-wrap"><table class="data-table"><thead><tr><th>المندوب</th><th>المبلغ</th><th>التاريخ</th><th>ملاحظات</th></tr></thead><tbody>${state.payments.slice(0,100).map(x=>`<tr><td>${escapeHTML(state.couriers.find(c=>String(c.id)===String(x.courier_id))?.name||"—")}</td><td>${money(x.amount)}</td><td>${dateTime(x.created_at)}</td><td>${escapeHTML(x.notes||"—")}</td></tr>`).join("")}</tbody></table></div>`}

  function openExpenseModal(){openModal(`${modalHeader("تسجيل مصروف")}<div class="form-grid"><div class="field"><label>الفئة</label><input id="expenseCategory" placeholder="وقود / صيانة / أخرى"></div><div class="field"><label>المبلغ</label><input id="expenseAmount" type="number" min="0"></div><div class="field full"><label>الوصف</label><textarea id="expenseDesc"></textarea></div></div><div class="form-actions"><button class="ghost-btn" data-close-modal>إلغاء</button><button id="saveExpenseBtn" class="primary-btn">حفظ</button></div>`);qs("#saveExpenseBtn")?.addEventListener("click",saveExpense)}
  async function saveExpense(){const btn=qs("#saveExpenseBtn"),amount=safeNumber(qs("#expenseAmount")?.value),category=qs("#expenseCategory")?.value?.trim()||"أخرى";if(amount<=0)return toast("اكتب مبلغاً صحيحاً.","warning");setBusy(btn,true,"جاري الحفظ...");try{const r=await resilientInsert("wasalli_expenses",{category,description:qs("#expenseDesc")?.value?.trim()||null,amount,created_by:state.session.user.id,created_at:new Date().toISOString()},false);if(r.error)throw r.error;closeModal();await loadFinance();renderPage();toast("تم تسجيل المصروف.");}catch(e){toast("تعذر تسجيل المصروف: "+(e?.message||"خطأ"),"error");}finally{setBusy(btn,false)}}

  function openPaymentModal(){openModal(`${modalHeader("تسجيل تسديد مندوب")}<div class="form-grid"><div class="field"><label>المندوب</label><select id="paymentCourier"><option value="">اختر المندوب</option>${courierOptions()}</select></div><div class="field"><label>المبلغ</label><input id="paymentAmount" type="number" min="0"></div><div class="field full"><label>ملاحظات</label><textarea id="paymentNotes"></textarea></div></div><div class="form-actions"><button class="ghost-btn" data-close-modal>إلغاء</button><button id="savePaymentBtn" class="primary-btn">حفظ</button></div>`);qs("#savePaymentBtn")?.addEventListener("click",savePayment)}
  async function savePayment(){const btn=qs("#savePaymentBtn"),courier_id=qs("#paymentCourier")?.value||null,amount=safeNumber(qs("#paymentAmount")?.value);if(!courier_id||amount<=0)return toast("اختر المندوب واكتب مبلغاً صحيحاً.","warning");setBusy(btn,true,"جاري الحفظ...");try{const r=await resilientInsert("wasalli_courier_payments",{courier_id,amount,notes:qs("#paymentNotes")?.value?.trim()||null,created_by:state.session.user.id,created_at:new Date().toISOString()},false);if(r.error)throw r.error;closeModal();await loadFinance();renderPage();toast("تم تسجيل التسديد.");}catch(e){toast("تعذر تسجيل التسديد: "+(e?.message||"خطأ"),"error");}finally{setBusy(btn,false)}}

  function renderCourierAccount(){setPageTitle("حسابي","ملخص أرباح المندوب");const orders=courierAssignedOrders();const done=orders.filter(o=>["delivered","returned"].includes(o.status));const total=done.reduce((s,o)=>s+orderFee(o)*courierPercent()/100,0);const today=done.filter(o=>isToday(o.delivered_at||o.returned_at||o.updated_at)).reduce((s,o)=>s+orderFee(o)*courierPercent()/100,0);const cash=done.reduce((s,o)=>s+amountToCollect(o),0);qs("#content").innerHTML=`<div class="stats-grid">${stat("💰","إجمالي الحصة",money(total),`${courierPercent()}% من أجور التوصيل`)}${stat("📅","حصة اليوم",money(today))}${stat("💵","الكاش بالعهدة",money(cash))}${stat("✅","طلبات مكتملة",done.length)}</div><div class="card"><div class="card-header"><h2>الطلبات المكتملة</h2></div>${ordersTable(done.slice(0,50))}${ordersMobile(done.slice(0,50),true)}</div>`;bindOrderOpenButtons()}
  function renderShopAccount(){setPageTitle("الحساب","ملخص طلبات المحل");const delivered=state.orders.filter(o=>o.status==="delivered"),returned=state.orders.filter(o=>o.status==="returned");const fees=[...delivered,...returned].reduce((s,o)=>s+orderFee(o),0);qs("#content").innerHTML=`<div class="stats-grid">${stat("📦","الطلبات",state.orders.length)}${stat("✅","تم التسليم",delivered.length)}${stat("↩","راجع",returned.length)}${stat("💰","أجور التوصيل",money(fees))}</div><div class="card">${ordersTable(state.orders.slice(0,50))}${ordersMobile(state.orders.slice(0,50))}</div>`;bindOrderOpenButtons()}

  /* =========================================================
     REPORTS
     ========================================================= */

  function renderReports(){setPageTitle("التقارير","ملخص عمليات وصلّي");const delivered=state.orders.filter(o=>o.status==="delivered"),returned=state.orders.filter(o=>o.status==="returned"),cancelled=state.orders.filter(o=>o.status==="cancelled");const fees=[...delivered,...returned].reduce((s,o)=>s+orderFee(o),0);const courierShare=fees*courierPercent()/100,companyShare=fees*companyPercent()/100;qs("#content").innerHTML=`<div class="stats-grid">${stat("📦","إجمالي الطلبات",state.orders.length)}${stat("✅","تم التسليم",delivered.length)}${stat("↩","راجع",returned.length)}${stat("❌","ملغي",cancelled.length)}${stat("💰","أجور التوصيل",money(fees))}${isFinanceUser()?stat("🛵","حصص المندوبين",money(courierShare)):""}${isFinanceUser()?stat("🏢","حصة وصلّي",money(companyShare)):""}</div><div class="card"><div class="card-header"><div><h2>تصدير التقرير</h2><p>تنزيل ملخص الطلبات بصيغة CSV</p></div><button id="exportReportBtn" class="primary-btn">تنزيل CSV</button></div></div>`;qs("#exportReportBtn")?.addEventListener("click",exportOrdersCsv)}

  function exportOrdersCsv(){const rows=[["order","status","shop","customer","phone","area","courier","fee","goods","created_at"],...state.orders.map(o=>[orderCode(o),statusLabel(o.status),shopName(o),customerName(o),customerPhone(o),o.delivery_area||"",courierName(o),orderFee(o),orderGoods(o),o.created_at||""])];const csv="\ufeff"+rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\n");const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`wasalli-report-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

  /* =========================================================
     USERS / PERMISSIONS
     ========================================================= */

  function renderUsers(){if(!isAdmin())return goDashboard();setPageTitle("الحسابات والصلاحيات","مراجعة وتفعيل حسابات المستخدمين");const pending=state.profiles.filter(p=>!p.is_active||p.role==="pending"),active=state.profiles.filter(p=>p.is_active&&p.role!=="pending");qs("#content").innerHTML=`<div class="card"><div class="card-header"><div><h2>طلبات التسجيل</h2><p>${pending.length} بانتظار المراجعة</p></div></div>${pending.length?`<div class="entity-grid">${pending.map(p=>profileCard(p,true)).join("")}</div>`:`<div class="empty">لا توجد طلبات معلقة.</div>`}</div><div class="card"><div class="card-header"><div><h2>المستخدمون الفعالون</h2><p>${active.length} حساب</p></div></div><div class="entity-grid">${active.map(p=>profileCard(p,false)).join("")}</div></div>`;bindProfileActions()}

  function profileCard(p,pending){return `<article class="entity-card"><div class="entity-head"><div class="entity-icon">👤</div><div><h3>${escapeHTML(p.full_name||"مستخدم")}</h3><p>${escapeHTML(p.phone||p.email||"—")}</p></div></div><div class="info-grid"><div class="info-box"><small>الدور</small><strong>${escapeHTML(roleLabel(pending?(p.requested_role||p.role):p.role))}</strong></div><div class="info-box"><small>المنطقة</small><strong>${escapeHTML(p.area||"—")}</strong></div></div><div class="actions">${pending?`<button class="success-btn btn-sm" data-approve="${escapeHTML(p.id)}">موافقة</button><button class="danger-btn btn-sm" data-reject="${escapeHTML(p.id)}">رفض</button>`:`<button class="ghost-btn btn-sm" data-edit-profile="${escapeHTML(p.id)}">الصلاحية</button>${p.id!==state.session?.user?.id?`<button class="danger-btn btn-sm" data-suspend="${escapeHTML(p.id)}">تعطيل</button>`:""}`}</div></article>`}

  function bindProfileActions(){qsa("[data-approve]").forEach(b=>b.addEventListener("click",()=>approveProfile(b.dataset.approve)));qsa("[data-reject]").forEach(b=>b.addEventListener("click",()=>rejectProfile(b.dataset.reject)));qsa("[data-edit-profile]").forEach(b=>b.addEventListener("click",()=>openRoleModal(b.dataset.editProfile)));qsa("[data-suspend]").forEach(b=>b.addEventListener("click",()=>suspendProfile(b.dataset.suspend)))}

  async function approveProfile(id){const p=state.profiles.find(x=>String(x.id)===String(id));if(!p)return;const target=(p.requested_role&&p.requested_role!=="pending")?p.requested_role:(p.role&&p.role!=="pending"?p.role:"courier");try{let courierId=p.courier_id||null,shopId=p.shop_id||null;if(target==="courier"&&!courierId){const r=await resilientInsert("couriers",{user_id:p.id,name:p.full_name||"مندوب",phone:p.phone||null,area:p.area||null,vehicle_type:p.vehicle_type||null,vehicle_number:p.vehicle_number||null,status:"offline",is_available:false,is_on_shift:false,is_active:true,max_active_orders:safeNumber(setting("default_max_active_orders",DEFAULTS.maxActiveOrders))},true);if(r.error)throw r.error;courierId=r.data?.id||null}if(target==="shop"&&!shopId){const r=await resilientInsert("shops",{user_id:p.id,name:p.full_name||"محل",phone:p.phone||null,area:p.area||null,address:p.address||null,is_active:true},true);if(r.error)throw r.error;shopId=r.data?.id||null}const r=await resilientUpdate("profiles",{role:target,is_active:true,courier_id:courierId,shop_id:shopId,approved_at:new Date().toISOString(),approved_by:state.session.user.id,suspended_at:null,suspended_by:null,updated_at:new Date().toISOString()},"id",id);if(r.error)throw r.error;await loadProfiles();renderPage();toast("تم اعتماد الحساب.");}catch(e){toast("تعذر اعتماد الحساب: "+(e?.message||"خطأ"),"error")}}
  async function rejectProfile(id){const reason=window.prompt("سبب رفض التسجيل:");if(!reason?.trim())return;const r=await resilientUpdate("profiles",{role:"pending",is_active:false,suspended_at:new Date().toISOString(),suspended_by:state.session.user.id,updated_at:new Date().toISOString()},"id",id);if(r.error)return toast("تعذر رفض الحساب.","error");try{await state.sb.from("registration_requests").update({status:"rejected",rejection_reason:reason.trim(),reviewed_by:state.session.user.id,reviewed_at:new Date().toISOString()}).eq("user_id",id)}catch{}await loadProfiles();renderPage();toast("تم رفض الحساب.")}
  function openRoleModal(id){const p=state.profiles.find(x=>String(x.id)===String(id));if(!p)return;openModal(`${modalHeader("تعديل الصلاحية",p.full_name||"")}<div class="field"><label>الدور</label><select id="profileRole">${["admin","operations","accountant","courier","shop"].map(r=>`<option value="${r}" ${p.role===r?"selected":""}>${roleLabel(r)}</option>`).join("")}</select></div><div class="form-actions"><button class="ghost-btn" data-close-modal>إلغاء</button><button id="saveRoleBtn" class="primary-btn">حفظ</button></div>`);qs("#saveRoleBtn")?.addEventListener("click",async()=>{const r=await resilientUpdate("profiles",{role:qs("#profileRole")?.value,is_active:true,updated_at:new Date().toISOString()},"id",id);if(r.error)return toast("تعذر تعديل الصلاحية.","error");closeModal();await loadProfiles();renderPage();toast("تم تعديل الصلاحية.")})}
  async function suspendProfile(id){const r=await resilientUpdate("profiles",{is_active:false,suspended_at:new Date().toISOString(),suspended_by:state.session.user.id,updated_at:new Date().toISOString()},"id",id);if(r.error)return toast("تعذر تعطيل الحساب.","error");await loadProfiles();renderPage();toast("تم تعطيل الحساب.")}

  /* =========================================================
     SETTINGS
     ========================================================= */

  function renderSettings(){setPageTitle("الإعدادات",isAdmin()?"إعدادات نظام وصلّي":"إعدادات الحساب");qs("#content").innerHTML=`<div class="card"><div class="card-header"><div><h2>الحساب</h2><p>${escapeHTML(state.profile?.full_name||"")}</p></div></div><div class="info-grid"><div class="info-box"><small>الاسم</small><strong>${escapeHTML(state.profile?.full_name||"—")}</strong></div><div class="info-box"><small>الدور</small><strong>${escapeHTML(roleLabel(role()))}</strong></div><div class="info-box"><small>الهاتف</small><strong>${escapeHTML(state.profile?.phone||"—")}</strong></div><div class="info-box"><small>البريد</small><strong>${escapeHTML(state.profile?.email||state.session?.user?.email||"—")}</strong></div></div></div>${isAdmin()?`<div class="card"><div class="card-header"><div><h2>إعدادات التشغيل</h2><p>القيم العامة للنظام</p></div></div><div class="form-grid"><div class="field"><label>اسم الشركة</label><input id="settingCompanyName" value="${escapeHTML(setting("company_name",DEFAULTS.appName))}"></div><div class="field"><label>المدينة</label><input id="settingCity" value="${escapeHTML(setting("city",DEFAULTS.city))}"></div><div class="field"><label>أجرة التوصيل الافتراضية</label><input id="settingFee" type="number" min="0" value="${defaultFee()}"></div><div class="field"><label>نسبة المندوب %</label><input id="settingCourierPct" type="number" min="0" max="100" value="${courierPercent()}"></div><div class="field"><label>نسبة وصلّي %</label><input id="settingCompanyPct" type="number" min="0" max="100" value="${companyPercent()}"></div><div class="field"><label>الحد الافتراضي للطلبات النشطة</label><input id="settingMaxOrders" type="number" min="1" value="${safeNumber(setting("default_max_active_orders",DEFAULTS.maxActiveOrders))}"></div></div><div class="form-actions"><button id="saveSettingsBtn" class="primary-btn">حفظ الإعدادات</button></div></div>`:""}<div class="card"><button id="settingsLogout" class="danger-btn" style="width:100%">تسجيل الخروج</button></div>`;qs("#saveSettingsBtn")?.addEventListener("click",saveSystemSettings);qs("#settingsLogout")?.addEventListener("click",logout)}

  async function saveSettingsRows(rows){for(const item of rows){const {error}=await state.sb.from("app_settings").upsert({key:item.key,value:item.value,updated_at:new Date().toISOString()},{onConflict:"key"});if(error)throw error}}
  async function saveSystemSettings(){const btn=qs("#saveSettingsBtn"),cp=safeNumber(qs("#settingCourierPct")?.value),wp=safeNumber(qs("#settingCompanyPct")?.value);if(cp+wp!==100)return toast("نسبة المندوب + نسبة وصلّي يجب أن تساوي 100%.","warning");setBusy(btn,true,"جاري الحفظ...");try{await saveSettingsRows([{key:"company_name",value:qs("#settingCompanyName")?.value?.trim()||DEFAULTS.appName},{key:"city",value:qs("#settingCity")?.value?.trim()||DEFAULTS.city},{key:"default_delivery_fee",value:safeNumber(qs("#settingFee")?.value)},{key:"courier_percent",value:cp},{key:"company_percent",value:wp},{key:"default_max_active_orders",value:Math.max(1,safeNumber(qs("#settingMaxOrders")?.value,DEFAULTS.maxActiveOrders))}]);await loadSettings();renderPage();toast("تم حفظ الإعدادات.");}catch(e){toast("تعذر حفظ الإعدادات: "+(e?.message||"خطأ"),"error");}finally{setBusy(btn,false)}}

  /* =========================================================
     COURIER OPERATIONS / OFFERS
     ========================================================= */

  async function setCourierShift(on){if(!state.currentCourier)return toast("ملف المندوب غير مرتبط بالحساب.","error");const payload={is_on_shift:on,is_available:on,status:on?"available":"offline",updated_at:new Date().toISOString()};const r=await resilientUpdate("couriers",payload,"id",state.currentCourier.id);if(r.error)return toast("تعذر تغيير الدوام.","error");await loadCurrentCourier();await loadOffers();renderPage();toast(on?"تم بدء الدوام.":"تم إنهاء الدوام.")}
  async function setCourierAvailability(on){if(!state.currentCourier)return;const r=await resilientUpdate("couriers",{is_available:on,status:on?"available":"unavailable",updated_at:new Date().toISOString()},"id",state.currentCourier.id);if(r.error)return toast("تعذر تغيير التوفر.","error");await loadCurrentCourier();await loadOffers();renderPage();toast(on?"أصبحت متاحاً لاستقبال الطلبات.":"تم إيقاف استقبال الطلبات.")}

  function renderOfferCard(offer){const o=state.orders.find(x=>String(x.id)===String(offer.order_id));return `<article class="offer-card"><div class="card-header"><div><h3 style="margin:0">عرض توصيل</h3><p>${dateTime(offer.offered_at)}</p></div><span class="badge badge-info">جديد</span></div><div class="route"><strong>${escapeHTML(o?.pickup_area||shopName(o)||"منطقة الاستلام")}</strong><span>←</span><strong>${escapeHTML(o?.delivery_area||"منطقة التوصيل")}</strong></div><div class="info-grid"><div class="info-box"><small>أجرة التوصيل</small><strong>${money(o?orderFee(o):defaultFee())}</strong></div><div class="info-box"><small>حصة المندوب</small><strong>${money((o?orderFee(o):defaultFee())*courierPercent()/100)}</strong></div></div><div class="actions"><button class="success-btn" data-accept-offer="${escapeHTML(offer.id)}">قبول</button><button class="danger-btn" data-reject-offer="${escapeHTML(offer.id)}">رفض</button></div></article>`}
  function bindOfferActions(){qsa("[data-accept-offer]").forEach(b=>b.addEventListener("click",()=>acceptOffer(b.dataset.acceptOffer)));qsa("[data-reject-offer]").forEach(b=>b.addEventListener("click",()=>rejectOfferPrompt(b.dataset.rejectOffer)))}
  async function acceptOffer(id){try{const {error}=await state.sb.rpc("wasalli_accept_offer",{p_offer_id:id});if(error)throw error;await loadOrders();await loadOffers();renderPage();toast("تم قبول الطلب.");}catch(e){toast(e?.message||"تعذر قبول العرض.","error")}}
  async function rejectOfferPrompt(id){const reason=window.prompt("سبب الرفض: بعيد / مشغول / عطل / سبب آخر");if(!reason)return;try{const {error}=await state.sb.rpc("wasalli_reject_offer",{p_offer_id:id,p_reason:"other",p_note:reason});if(error)throw error;await loadOffers();renderPage();toast("تم رفض العرض.");}catch(e){toast(e?.message||"تعذر رفض العرض.","error")}}

  function renderCourierOrderCard(o){const next=o.status==="assigned"?"accepted":o.status==="accepted"?"picked_up":o.status==="picked_up"?"on_the_way":o.status==="on_the_way"?"delivered":null;const nextLabel={accepted:"قبول الطلب",picked_up:"تم الاستلام من المحل",on_the_way:"انطلقت للزبون",delivered:"تم التسليم"}[next];return `<article class="entity-card"><div class="card-header"><div><h3 style="margin:0">${escapeHTML(orderCode(o))}</h3><p>${escapeHTML(shopName(o))}</p></div>${statusBadge(o.status)}</div><div class="info-grid"><div class="info-box"><small>الزبون</small><strong>${escapeHTML(customerName(o))}</strong></div><div class="info-box"><small>الهاتف</small><strong>${escapeHTML(customerPhone(o)||"—")}</strong></div><div class="info-box"><small>المنطقة</small><strong>${escapeHTML(o.delivery_area||"—")}</strong></div><div class="info-box"><small>التحصيل</small><strong>${money(amountToCollect(o))}</strong></div></div><div class="actions">${next?`<button class="primary-btn btn-sm" data-courier-next="${escapeHTML(o.id)}" data-status="${next}">${escapeHTML(nextLabel)}</button>`:""}<button class="ghost-btn btn-sm" data-open-order="${escapeHTML(o.id)}">التفاصيل</button>${!CLOSED_STATUSES.includes(o.status)?`<button class="danger-btn btn-sm" data-courier-return="${escapeHTML(o.id)}">راجع</button>`:""}</div></article>`}
  function bindCourierOrderActions(){qsa("[data-courier-next]").forEach(b=>b.addEventListener("click",()=>courierUpdateStatus(b.dataset.courierNext,b.dataset.status)));qsa("[data-courier-return]").forEach(b=>b.addEventListener("click",()=>courierReturnOrder(b.dataset.courierReturn)))}
  async function courierUpdateStatus(id,status){const now=new Date().toISOString(),payload={status,updated_at:now};if(status==="accepted")payload.accepted_at=now;if(status==="picked_up")payload.picked_up_at=now;if(status==="on_the_way")payload.on_the_way_at=now;if(status==="delivered")payload.delivered_at=now;const r=await resilientUpdate("orders",payload,"id",id);if(r.error)return toast("تعذر تحديث الطلب.","error");await loadOrders();renderPage();toast("تم تحديث حالة الطلب.")}
  async function courierReturnOrder(id){const reason=window.prompt("سبب الراجع:");if(!reason)return;const r=await resilientUpdate("orders",{status:"returned",return_reason:reason,returned_at:new Date().toISOString(),updated_at:new Date().toISOString()},"id",id);if(r.error)return toast("تعذر تسجيل الراجع.","error");await loadOrders();renderPage();toast("تم تسجيل الطلب راجع.")}

  /* =========================================================
     NOTIFICATIONS / REALTIME / DISPATCH
     ========================================================= */

  function updateNotificationBadge(){const b=qs("#notificationBadge");if(!b)return;const n=state.notifications.filter(x=>!x.is_read).length;b.textContent=n>99?"99+":String(n);b.classList.toggle("hidden",n===0)}
  function openNotifications(){openModal(`${modalHeader("الإشعارات","آخر إشعارات النظام")}${state.notifications.length?`<div class="entity-grid">${state.notifications.map(n=>`<div class="entity-card"><strong>${escapeHTML(n.title||"إشعار")}</strong><p>${escapeHTML(n.message||"")}</p><small class="muted">${dateTime(n.created_at)}</small></div>`).join("")}</div>`:`<div class="empty">لا توجد إشعارات.</div>`}`);const ids=state.notifications.filter(n=>!n.is_read).map(n=>n.id);if(ids.length)state.sb.from("notifications").update({is_read:true}).in("id",ids).then(()=>{state.notifications.forEach(n=>n.is_read=true);updateNotificationBadge()})}

  const realtimeRefresh = debounce(async()=>{if(!state.session)return;await loadAll(false);renderPage()},450);
  function startRealtime(){stopRealtime();if(!state.session)return;try{let ch=state.sb.channel(`wasalli-live-${state.session.user.id}`);["orders","shops","couriers","notifications","order_offers"].forEach(table=>{ch=ch.on("postgres_changes",{event:"*",schema:"public",table},realtimeRefresh)});state.realtime=ch.subscribe();}catch(e){console.warn("[Wasalli realtime]",e)}}
  function stopRealtime(){if(state.realtime){try{state.sb?.removeChannel?.(state.realtime)}catch{}state.realtime=null}}
  function startDispatchTimer(){stopDispatchTimer();const tick=async()=>{if(!isAdminOrOperations())return;try{await Promise.all([state.sb.rpc("wasalli_expand_dispatch"),state.sb.rpc("wasalli_check_late_orders")])}catch{}};tick();state.dispatchTimer=setInterval(tick,15000)}
  function stopDispatchTimer(){if(state.dispatchTimer)clearInterval(state.dispatchTimer);state.dispatchTimer=null}

  function goDashboard(){state.page="dashboard";renderPage()}

  /* =========================================================
     BOOT
     ========================================================= */

  async function waitForSupabase(timeoutMs = 15000) {
    if (!window.supabase?.createClient) {
      const existing = document.querySelector('script[data-wasalli-supabase]');
      if (!existing) {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
        script.async = true;
        script.dataset.wasalliSupabase = "1";
        document.head.appendChild(script);
      }
    }

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (window.supabase?.createClient) return window.supabase;
      await new Promise(r => setTimeout(r, 60));
    }
    throw new Error("تعذر تحميل مكتبة Supabase.");
  }

  async function init() {
    try {
      const lib = await waitForSupabase();
      state.sb = lib.createClient(SUPABASE_URL, SUPABASE_KEY);
      buildUI();
      toggleSignupFields();

      state.sb.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT") {
          resetState();
          showAuth();
        }
        if (event === "USER_UPDATED" && session && state.session?.user?.id === session.user.id) {
          state.session = session;
        }
      });

      const { data, error } = await state.sb.auth.getSession();
      if (error) throw error;
      if (data?.session) await activateSession(data.session);
      else showAuth();
    } catch (error) {
      console.error("[Wasalli boot]", error);
      document.body.innerHTML = `<div dir="rtl" style="font-family:Arial;padding:30px;text-align:center"><h2>تعذر تشغيل وصلّي</h2><p>${escapeHTML(error?.message || "خطأ غير معروف")}</p></div>`;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
