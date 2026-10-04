(() => {
  "use strict";

  /* =========================================================
     WASALLI — وصلّي
     Main Application
     ========================================================= */

  const C = window.WASALLI_CONFIG;

  if (!C || !window.supabase) {
    document.body.innerHTML =
      '<div style="padding:30px;text-align:center;font-family:Tahoma">تعذر تشغيل نظام وصلّي. تحقق من config.js واتصال الإنترنت.</div>';
    return;
  }

  const sb = window.supabase.createClient(
    C.SUPABASE_URL,
    C.SUPABASE_PUBLISHABLE_KEY
  );

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const $$ = (selector, root = document) =>
    [...root.querySelectorAll(selector)];

  const state = {
    session: null,
    profile: null,
    page: "dashboard",

    orders: [],
    shops: [],
    couriers: [],
    profiles: [],
    areas: [],
    settlements: [],
    notifications: [],

    map: null,
    markers: [],

    settings: {
      company_name: C.APP_NAME || "وصلّي",
      city: C.CITY || "كربلاء المقدسة",
      default_delivery_fee: Number(C.DEFAULT_DELIVERY_FEE || 3000),
      courier_percent: Number(C.COURIER_PERCENT || 70),
      company_percent: Number(C.COMPANY_PERCENT || 30),
      whatsapp: ""
    }
  };


  /* =========================================================
     HELPERS
     ========================================================= */

  function esc(value = "") {
    return String(value ?? "").replace(
      /[&<>"']/g,
      char =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;"
        })[char]
    );
  }

  function money(value) {
    return (
      Number(value || 0).toLocaleString("ar-IQ") +
      " د.ع"
    );
  }

  function dateTime(value) {
    if (!value) return "—";

    try {
      return new Date(value).toLocaleString("ar-IQ");
    } catch {
      return "—";
    }
  }

  function orderCode(order) {
    const number =
      order?.order_number ??
      order?.number ??
      "";

    return number
      ? `${C.ORDER_PREFIX || "W-"}${number}`
      : "—";
  }

  function orderFee(order) {
    return Number(
      order?.delivery_fee ??
      order?.fee ??
      C.DEFAULT_DELIVERY_FEE ??
      3000
    );
  }

  function customerName(order) {
    return (
      order?.customer_name ||
      order?.customer ||
      "—"
    );
  }

  function customerPhone(order) {
    return (
      order?.customer_phone ||
      order?.phone ||
      "—"
    );
  }

  function orderAddress(order) {
    return (
      order?.delivery_address ||
      order?.address ||
      "—"
    );
  }

  function shopName(id) {
    const shop = state.shops.find(
      item => String(item.id) === String(id)
    );

    return shop?.name || "—";
  }

  function courierName(id) {
    const courier = state.couriers.find(
      item => String(item.id) === String(id)
    );

    return courier?.name || "—";
  }

  function roleLabel(role) {
    const labels = {
      admin: "الإدارة",
      operations: "العمليات",
      accountant: "المحاسب",
      shop: "المحل",
      courier: "المندوب",
      customer: "الزبون",
      hotel: "الفندق",
      pending: "قيد المراجعة"
    };

    return labels[role] || role || "—";
  }

  function statusLabel(status) {
    const labels = {
      new: "طلب جديد",
      assigned: "بانتظار المندوب",
      accepted: "تم القبول",
      picked_up: "تم الاستلام",
      on_the_way: "بالطريق",
      delivered: "تم التسليم",
      returned: "راجع",
      cancelled: "ملغي"
    };

    return labels[status] || status || "—";
  }

  function statusBadge(status) {
    const classes = {
      new: "badge-new",
      assigned: "badge-assigned",
      accepted: "badge-accepted",
      picked_up: "badge-accepted",
      on_the_way: "badge-road",
      delivered: "badge-done",
      returned: "badge-return",
      cancelled: "badge-cancel"
    };

    return `
      <span class="badge ${classes[status] || "badge-new"}">
        ${esc(statusLabel(status))}
      </span>
    `;
  }

  function isAdmin() {
    return state.profile?.role === "admin";
  }

  function isOperations() {
    return state.profile?.role === "operations";
  }

  function isAccountant() {
    return state.profile?.role === "accountant";
  }

  function isShop() {
    return state.profile?.role === "shop";
  }

  function isCourier() {
    return state.profile?.role === "courier";
  }

  function canOperate() {
    return isAdmin() || isOperations();
  }

  function canFinance() {
    return isAdmin() || isAccountant();
  }

  function toast(message, type = "ok") {
    const element = $("#toast");

    if (!element) return;

    element.textContent = message;

    element.classList.remove(
      "hidden",
      "success",
      "error",
      "warning"
    );

    if (type === "error") {
      element.classList.add("error");
    } else if (type === "warn") {
      element.classList.add("warning");
    } else {
      element.classList.add("success");
    }

    clearTimeout(toast.timer);

    toast.timer = setTimeout(() => {
      element.classList.add("hidden");
    }, 3000);
  }

  function showLoading(show = true) {
    $("#globalLoading")?.classList.toggle(
      "hidden",
      !show
    );
  }

  function setTitle(title, subtitle = "") {
    const titleEl = $("#pageTitle");
    const subtitleEl = $("#pageSubtitle");

    if (titleEl) {
      titleEl.textContent = title;
    }

    if (subtitleEl) {
      subtitleEl.textContent =
        subtitle ||
        "إدارة عمليات وصلّي في كربلاء المقدسة";
    }
  }


  /* =========================================================
     PHONE AUTH
     ========================================================= */

  function normalizeIraqPhone(value) {
    let phone = String(value || "")
      .trim()
      .replace(/[^\d+]/g, "");

    if (phone.startsWith("+964")) {
      phone = "0" + phone.slice(4);
    } else if (phone.startsWith("964")) {
      phone = "0" + phone.slice(3);
    } else if (
      phone.startsWith("7") &&
      phone.length === 10
    ) {
      phone = "0" + phone;
    }

    return phone;
  }

  function validIraqPhone(phone) {
    return /^07\d{9}$/.test(
      normalizeIraqPhone(phone)
    );
  }

  function phoneAuthEmail(phone) {
    const normalized =
      normalizeIraqPhone(phone);

    const international =
      "964" + normalized.slice(1);

    return `${international}@phone.wasalli.local`;
  }


  /* =========================================================
     SIDEBAR
     ========================================================= */

  function openSidebar() {
    $("#sidebar")?.classList.add("open");
    $("#sidebarBackdrop")?.classList.remove(
      "hidden"
    );
    document.body.classList.add("no-scroll");
  }

  function closeSidebar() {
    $("#sidebar")?.classList.remove("open");
    $("#sidebarBackdrop")?.classList.add(
      "hidden"
    );
    document.body.classList.remove("no-scroll");
  }


  /* =========================================================
     AUTH UI
     ========================================================= */

  function showAuth() {
    $("#appView")?.classList.add("hidden");
    $("#pendingView")?.classList.add("hidden");
    $("#authView")?.classList.remove("hidden");

    if ($("#authMessage")) {
      $("#authMessage").textContent = "";
    }
  }

  function showPending() {
    $("#authView")?.classList.add("hidden");
    $("#appView")?.classList.add("hidden");
    $("#pendingView")?.classList.remove(
      "hidden"
    );
  }

  function showApp() {
    $("#authView")?.classList.add("hidden");
    $("#pendingView")?.classList.add("hidden");
    $("#appView")?.classList.remove("hidden");
  }

  function toggleSignupFields() {
    const type = $("#signupType")?.value;

    $("#courierSignupFields")?.classList.toggle(
      "hidden",
      type !== "courier"
    );

    $("#shopSignupFields")?.classList.toggle(
      "hidden",
      type !== "shop"
    );

    $("#hotelSignupFields")?.classList.toggle(
      "hidden",
      type !== "hotel"
    );
  }

  async function login(event) {
    event.preventDefault();

    const identifier =
      $("#loginIdentifier")?.value.trim();

    const password =
      $("#loginPassword")?.value || "";

    if (!identifier || !password) {
      $("#authMessage").textContent =
        "اكتب رقم الهاتف وكلمة المرور.";
      return;
    }

    let email;

    if (identifier.includes("@")) {
      email = identifier;
    } else {
      const phone =
        normalizeIraqPhone(identifier);

      if (!validIraqPhone(phone)) {
        $("#authMessage").textContent =
          "اكتب رقم هاتف عراقي صحيح مثل 07XXXXXXXXX";
        return;
      }

      email = phoneAuthEmail(phone);
    }

    $("#authMessage").textContent =
      "جاري تسجيل الدخول...";

    const { data, error } =
      await sb.auth.signInWithPassword({
        email,
        password
      });

    if (error) {
      console.error(error);

      $("#authMessage").textContent =
        "تعذر تسجيل الدخول. تأكد من رقم الهاتف وكلمة المرور.";

      return;
    }

    await enterSession(data.session);
  }

  async function legacyEmailLogin() {
    const email =
      $("#adminEmail")?.value.trim();

    const password =
      $("#adminEmailPassword")?.value || "";

    if (!email || !password) {
      $("#authMessage").textContent =
        "اكتب البريد الإلكتروني وكلمة المرور.";
      return;
    }

    $("#authMessage").textContent =
      "جاري تسجيل دخول الإدارة...";

    const { data, error } =
      await sb.auth.signInWithPassword({
        email,
        password
      });

    if (error) {
      console.error(error);

      $("#authMessage").textContent =
        "تعذر تسجيل الدخول بالبريد الإلكتروني.";

      return;
    }

    await enterSession(data.session);
  }

  async function signup(event) {
    event.preventDefault();

    const fullName =
      $("#signupName")?.value.trim();

    const phone =
      normalizeIraqPhone(
        $("#signupPhone")?.value
      );

    const role =
      $("#signupType")?.value;

    const password =
      $("#signupPassword")?.value || "";

    const confirmPassword =
      $("#signupPasswordConfirm")?.value || "";

    if (!fullName) {
      $("#authMessage").textContent =
        "اكتب الاسم الكامل.";
      return;
    }

    if (!validIraqPhone(phone)) {
      $("#authMessage").textContent =
        "اكتب رقم هاتف عراقي صحيح مثل 07XXXXXXXXX";
      return;
    }

    if (
      !["courier", "shop", "customer", "hotel"]
        .includes(role)
    ) {
      $("#authMessage").textContent =
        "اختر نوع الحساب.";
      return;
    }

    if (password.length < 8) {
      $("#authMessage").textContent =
        "كلمة المرور يجب أن تكون 8 أحرف على الأقل.";
      return;
    }

    if (password !== confirmPassword) {
      $("#authMessage").textContent =
        "كلمتا المرور غير متطابقتين.";
      return;
    }

    const metadata = {
      full_name: fullName,
      phone,
      requested_role: role
    };

    if (role === "courier") {
      metadata.courier_area =
        $("#courierArea")?.value || "";

      metadata.vehicle_type =
        $("#vehicleType")?.value || "";

      metadata.vehicle_number =
        $("#vehicleNumber")?.value.trim() || "";

      metadata.emergency_phone =
        normalizeIraqPhone(
          $("#emergencyPhone")?.value
        );
    }

    if (role === "shop") {
      metadata.shop_name =
        $("#shopName")?.value.trim() || "";

      metadata.responsible_name =
        $("#shopOwnerName")?.value.trim() || "";

      metadata.shop_area =
        $("#shopArea")?.value || "";

      metadata.shop_phone =
        normalizeIraqPhone(
          $("#shopPhone")?.value
        );

      metadata.shop_address =
        $("#shopAddress")?.value.trim() || "";
    }

    if (role === "hotel") {
      metadata.hotel_name =
        $("#hotelName")?.value.trim() || "";

      metadata.hotel_area =
        $("#hotelArea")?.value || "";

      metadata.hotel_address =
        $("#hotelAddress")?.value.trim() || "";
    }

    $("#authMessage").textContent =
      "جاري إرسال طلب التسجيل...";

    const { data, error } =
      await sb.auth.signUp({
        email: phoneAuthEmail(phone),
        password,
        options: {
          data: metadata
        }
      });

    if (error) {
      console.error(error);

      $("#authMessage").textContent =
        error.message;

      return;
    }

    $("#authMessage").style.color =
      "#20a36a";

    $("#authMessage").textContent =
      "تم إرسال طلب التسجيل. الحساب بانتظار موافقة إدارة وصلّي.";

    if (data.session) {
      await enterSession(data.session);
    }
  }

  async function logout() {
    closeSidebar();

    await sb.auth.signOut();

    state.session = null;
    state.profile = null;
    state.orders = [];
    state.shops = [];
    state.couriers = [];
    state.profiles = [];

    showAuth();
  }


  /* =========================================================
     SESSION
     ========================================================= */

  async function enterSession(session) {
    if (!session?.user?.id) {
      showAuth();
      return;
    }

    state.session = session;

    showLoading(true);

    const { data, error } = await sb
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .maybeSingle();

    showLoading(false);

    if (error) {
      console.error(error);

      toast(
        "تعذر قراءة بيانات الحساب.",
        "error"
      );

      return;
    }

    state.profile =
      data || {
        id: session.user.id,
        full_name:
          session.user.user_metadata?.full_name ||
          "",
        phone:
          session.user.user_metadata?.phone ||
          "",
        email: session.user.email,
        role: "pending",
        is_active: false
      };

    if (
      state.profile.role === "pending" ||
      !state.profile.is_active
    ) {
      showPending();
      return;
    }

    showApp();

    buildNav();
    setUserMini();

    await loadAll();

    renderPage();
  }


  /* =========================================================
     NAVIGATION
     ========================================================= */

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
      ["dashboard", "⌂", "لوحة التحكم"],
      ["orders", "📦", "الطلبات"],
      ["shops", "🏪", "المحلات"],
      ["couriers", "🛵", "المندوبون"],
      ["map", "🗺️", "غرفة العمليات"],
      ["pricing", "📍", "المناطق والتسعير"]
    ],

    accountant: [
      ["dashboard", "⌂", "لوحة التحكم"],
      ["accounts", "💰", "الحسابات"],
      ["reports", "📊", "التقارير"],
      ["settings", "⚙️", "الحساب"]
    ],

    shop: [
      ["dashboard", "⌂", "لوحة التحكم"],
      ["orders", "📦", "طلباتي"],
      ["settings", "⚙️", "الحساب"]
    ],

    courier: [
      ["dashboard", "⌂", "لوحة التحكم"],
      ["orders", "📦", "طلباتي"],
      ["accounts", "💰", "حسابي"],
      ["settings", "⚙️", "الحساب"]
    ],

    customer: [
      ["dashboard", "⌂", "حسابي"],
      ["settings", "⚙️", "الإعدادات"]
    ],

    hotel: [
      ["dashboard", "⌂", "حساب الفندق"],
      ["settings", "⚙️", "الإعدادات"]
    ]
  };

  function buildNav() {
    const menu = $("#navMenu");

    if (!menu) return;

    const items =
      NAV[state.profile?.role] || [];

    menu.innerHTML = items
      .map(
        ([page, icon, label]) => `
          <button
            class="nav-btn ${
              state.page === page
                ? "active"
                : ""
            }"
            data-page="${page}"
            type="button"
          >
            <span class="nav-icon">
              ${icon}
            </span>

            <span>
              ${esc(label)}
            </span>
          </button>
        `
      )
      .join("");

    $$(".nav-btn", menu).forEach(button => {
      button.addEventListener("click", () => {
        state.page =
          button.dataset.page;

        buildNav();
        closeSidebar();
        renderPage();
      });
    });
  }

  function setUserMini() {
    const name =
      state.profile?.full_name ||
      state.profile?.email ||
      "مستخدم";

    if ($("#userName")) {
      $("#userName").textContent = name;
    }

    if ($("#userRole")) {
      $("#userRole").textContent =
        roleLabel(state.profile?.role);
    }

    if ($("#userAvatar")) {
      $("#userAvatar").textContent =
        name.trim().charAt(0) || "و";
    }
  }


  /* =========================================================
     LOAD DATA
     ========================================================= */

  async function safeSelect(table, query = "*") {
    try {
      const { data, error } = await sb
        .from(table)
        .select(query);

      if (error) {
        console.warn(
          `Wasalli ${table}:`,
          error.message
        );

        return [];
      }

      return data || [];
    } catch (error) {
      console.warn(error);
      return [];
    }
  }

  async function loadAll(showToast = false) {
    showLoading(true);

    try {
      const role = state.profile?.role;

      const tasks = [];

      tasks.push(loadOrders());

      if (
        ["admin", "operations", "accountant"]
          .includes(role)
      ) {
        tasks.push(loadShops());
        tasks.push(loadCouriers());
      }

      if (role === "admin") {
        tasks.push(loadProfiles());
      }

      if (
        ["admin", "operations"]
          .includes(role)
      ) {
        tasks.push(loadAreas());
      }

      if (
        ["admin", "accountant", "courier"]
          .includes(role)
      ) {
        tasks.push(loadSettlements());
      }

      await Promise.all(tasks);

      await loadSettings();

      await loadNotificationCount();

      populateSignupAreas();

      if (showToast) {
        toast("تم تحديث البيانات");
      }
    } finally {
      showLoading(false);
    }
  }

  async function loadOrders() {
    let query = sb
      .from("orders")
      .select("*")
      .order("created_at", {
        ascending: false
      });

    const { data, error } = await query;

    if (error) {
      console.error(error);
      state.orders = [];
      return;
    }

    state.orders = data || [];
  }

  async function loadShops() {
    state.shops = await safeSelect("shops");
  }

  async function loadCouriers() {
    state.couriers =
      await safeSelect("couriers");
  }

  async function loadProfiles() {
    state.profiles =
      await safeSelect("profiles");
  }

  async function loadAreas() {
    const { data, error } = await sb
      .from("areas")
      .select("*")
      .order("name", {
        ascending: true
      });

    if (!error) {
      state.areas = data || [];
    }
  }

  async function loadSettlements() {
    const { data, error } = await sb
      .from("courier_settlements")
      .select("*")
      .order("settled_at", {
        ascending: false
      });

    if (!error) {
      state.settlements = data || [];
    }
  }

  async function loadSettings() {
    try {
      const { data, error } = await sb
        .from("app_settings")
        .select("*");

      if (error || !data) return;

      data.forEach(row => {
        let value = row.value;

        if (
          value &&
          typeof value === "object" &&
          "value" in value
        ) {
          value = value.value;
        }

        if (row.key === "company_name") {
          state.settings.company_name =
            value || state.settings.company_name;
        }

        if (row.key === "city") {
          state.settings.city =
            value || state.settings.city;
        }

        if (
          row.key ===
          "default_delivery_fee"
        ) {
          state.settings.default_delivery_fee =
            Number(value || 3000);
        }

        if (row.key === "courier_percent") {
          state.settings.courier_percent =
            Number(value || 70);
        }

        if (row.key === "company_percent") {
          state.settings.company_percent =
            Number(value || 30);
        }

        if (row.key === "whatsapp") {
          state.settings.whatsapp =
            value || "";
        }
      });
    } catch (error) {
      console.warn(error);
    }
  }


  /* =========================================================
     NOTIFICATIONS
     ========================================================= */

  async function loadNotificationCount() {
    const badge =
      $("#notificationBadge");

    if (!badge) return;

    if (!canOperate()) {
      badge.classList.add("hidden");
      return;
    }

    try {
      const { data, error } = await sb
        .from("notifications")
        .select("*")
        .order("created_at", {
          ascending: false
        })
        .limit(50);

      if (error) {
        badge.classList.add("hidden");
        return;
      }

      state.notifications = data || [];

      const unread =
        state.notifications.filter(
          item => !item.is_read
        ).length;

      badge.textContent = unread;

      badge.classList.toggle(
        "hidden",
        unread === 0
      );
    } catch {
      badge.classList.add("hidden");
    }
  }

  async function openNotifications() {
    if (!canOperate()) {
      toast(
        "الإشعارات التشغيلية خاصة بالإدارة والعمليات.",
        "warn"
      );
      return;
    }

    await loadNotificationCount();

    const body =
      state.notifications.length
        ? `
          <div class="notification-list">
            ${state.notifications
              .map(
                item => `
                  <div class="notification-item ${
                    item.is_read
                      ? ""
                      : "unread"
                  }">
                    <h4>
                      ${esc(
                        item.title ||
                          "إشعار"
                      )}
                    </h4>

                    <p>
                      ${esc(
                        item.message ||
                          ""
                      )}
                    </p>

                    <p>
                      ${dateTime(
                        item.created_at
                      )}
                    </p>
                  </div>
                `
              )
              .join("")}
          </div>
        `
        : `
          <div class="empty">
            لا توجد إشعارات.
          </div>
        `;

    openModal("الإشعارات", body);
  }


  /* =========================================================
     RENDER PAGE
     ========================================================= */

  function renderPage() {
    switch (state.page) {
      case "orders":
        renderOrders();
        break;

      case "shops":
        renderShops();
        break;

      case "couriers":
        renderCouriers();
        break;

      case "map":
        renderMap();
        break;

      case "pricing":
        renderPricing();
        break;

      case "accounts":
        renderAccounts();
        break;

      case "reports":
        renderReports();
        break;

      case "users":
        renderUsers();
        break;

      case "settings":
        renderSettings();
        break;

      default:
        renderDashboard();
    }
  }


  /* =========================================================
     DASHBOARD
     ========================================================= */

  function renderDashboard() {
    setTitle("لوحة التحكم");

    const today =
      new Date().toISOString().slice(0, 10);

    const todayOrders =
      state.orders.filter(order =>
        String(order.created_at || "")
          .startsWith(today)
      );

    const delivered =
      state.orders.filter(
        order =>
          order.status === "delivered"
      );

    const active =
      state.orders.filter(order =>
        [
          "new",
          "assigned",
          "accepted",
          "picked_up",
          "on_the_way"
        ].includes(order.status)
      );

    const returned =
      state.orders.filter(
        order =>
          order.status === "returned"
      );

    const totalFees =
      delivered.reduce(
        (sum, order) =>
          sum + orderFee(order),
        0
      );

    $("#content").innerHTML = `
      <div class="grid stats-grid">

        <div class="card stat">
          <div class="label">
            طلبات اليوم
          </div>

          <div class="value">
            ${todayOrders.length}
          </div>

          <div class="hint">
            جميع طلبات اليوم
          </div>
        </div>

        <div class="card stat">
          <div class="label">
            الطلبات النشطة
          </div>

          <div class="value">
            ${active.length}
          </div>

          <div class="hint">
            قيد التوصيل والمتابعة
          </div>
        </div>

        <div class="card stat">
          <div class="label">
            تم التسليم
          </div>

          <div class="value">
            ${delivered.length}
          </div>

          <div class="hint">
            إجمالي الطلبات المسلّمة
          </div>
        </div>

        <div class="card stat">
          <div class="label">
            الطلبات الراجعة
          </div>

          <div class="value">
            ${returned.length}
          </div>

          <div class="hint">
            تحتاج متابعة عند الزيادة
          </div>
        </div>

      </div>

      <div
        class="grid two-col"
        style="margin-top:18px"
      >

        <div class="card">

          <div class="card-header">
            <h2>
              أحدث الطلبات
            </h2>

            ${
              canOperate() || isShop()
                ? `
                  <button
                    class="btn btn-primary"
                    id="dashboardNewOrder"
                    type="button"
                  >
                    + طلب جديد
                  </button>
                `
                : ""
            }
          </div>

          ${
            state.orders.length
              ? `
                <div class="quick-list">
                  ${state.orders
                    .slice(0, 7)
                    .map(
                      order => `
                        <div class="quick-item">

                          <div>
                            <strong class="order-code">
                              ${esc(
                                orderCode(
                                  order
                                )
                              )}
                            </strong>

                            <div class="muted">
                              ${esc(
                                customerName(
                                  order
                                )
                              )}
                            </div>
                          </div>

                          <div>
                            ${statusBadge(
                              order.status
                            )}
                          </div>

                        </div>
                      `
                    )
                    .join("")}
                </div>
              `
              : `
                <div class="empty">
                  لا توجد طلبات حالياً.
                </div>
              `
          }

        </div>

        <div class="card">

          <div class="card-header">
            <h2>
              ملخص وصلّي
            </h2>
          </div>

          <div class="kpi-line">
            <span>
              المحلات
            </span>

            <strong>
              ${state.shops.length}
            </strong>
          </div>

          <div class="kpi-line">
            <span>
              المندوبون
            </span>

            <strong>
              ${state.couriers.length}
            </strong>
          </div>

          <div class="kpi-line">
            <span>
              أجور الطلبات المسلّمة
            </span>

            <strong class="money">
              ${money(totalFees)}
            </strong>
          </div>

          ${
            canFinance()
              ? `
                <div class="kpi-line">
                  <span>
                    حصة وصلّي ${state.settings.company_percent}%
                  </span>

                  <strong class="money">
                    ${money(
                      totalFees *
                        state.settings
                          .company_percent /
                        100
                    )}
                  </strong>
                </div>
              `
              : ""
          }

        </div>

      </div>
    `;

    $("#dashboardNewOrder")
      ?.addEventListener(
        "click",
        openNewOrder
      );
  }


  /* =========================================================
     ORDERS
     ========================================================= */

  function renderOrders() {
    setTitle(
      isShop()
        ? "طلباتي"
        : "إدارة الطلبات"
    );

    $("#content").innerHTML = `
      <div class="card">

        <div class="card-header">

          <h2>
            الطلبات
          </h2>

          ${
            canOperate() || isShop()
              ? `
                <button
                  id="newOrderBtn"
                  class="btn btn-primary"
                  type="button"
                >
                  + إضافة طلب
                </button>
              `
              : ""
          }

        </div>

        <div class="search-row">

          <input
            id="orderSearch"
            type="search"
            placeholder="بحث برقم W أو الزبون أو الهاتف أو العنوان..."
          >

          <select id="orderStatusFilter">
            <option value="">
              كل الحالات
            </option>
            <option value="new">
              طلب جديد
            </option>
            <option value="assigned">
              بانتظار المندوب
            </option>
            <option value="accepted">
              تم القبول
            </option>
            <option value="picked_up">
              تم الاستلام
            </option>
            <option value="on_the_way">
              بالطريق
            </option>
            <option value="delivered">
              تم التسليم
            </option>
            <option value="returned">
              راجع
            </option>
            <option value="cancelled">
              ملغي
            </option>
          </select>

        </div>

        <div id="ordersList"></div>

      </div>
    `;

    $("#newOrderBtn")
      ?.addEventListener(
        "click",
        openNewOrder
      );

    $("#orderSearch")
      ?.addEventListener(
        "input",
        drawOrdersTable
      );

    $("#orderStatusFilter")
      ?.addEventListener(
        "change",
        drawOrdersTable
      );

    drawOrdersTable();
  }

  function drawOrdersTable() {
    const container =
      $("#ordersList");

    if (!container) return;

    const search =
      ($("#orderSearch")?.value || "")
        .trim()
        .toLowerCase();

    const status =
      $("#orderStatusFilter")?.value || "";

    let orders =
      [...state.orders];

    if (status) {
      orders = orders.filter(
        order =>
          order.status === status
      );
    }

    if (search) {
      orders = orders.filter(order => {
        const haystack = [
          orderCode(order),
          customerName(order),
          customerPhone(order),
          orderAddress(order),
          order.shop,
          order.courier,
          shopName(order.shop_id),
          courierName(order.courier_id)
        ]
          .join(" ")
          .toLowerCase();

        return haystack.includes(search);
      });
    }

    if (!orders.length) {
      container.innerHTML = `
        <div class="empty">
          لا توجد طلبات مطابقة.
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="table-wrap">

        <table>

          <thead>
            <tr>
              <th>الطلب</th>
              <th>الزبون</th>
              <th>الهاتف</th>
              <th>المحل</th>
              <th>المندوب</th>
              <th>الأجرة</th>
              <th>الحالة</th>
              <th>التاريخ</th>
              <th>إجراء</th>
            </tr>
          </thead>

          <tbody>

            ${orders
              .map(
                order => `
                  <tr>

                    <td>
                      <strong class="order-code">
                        ${esc(
                          orderCode(order)
                        )}
                      </strong>
                    </td>

                    <td>
                      ${esc(
                        customerName(
                          order
                        )
                      )}
                    </td>

                    <td>
                      ${esc(
                        customerPhone(
                          order
                        )
                      )}
                    </td>

                    <td>
                      ${esc(
                        shopName(
                          order.shop_id
                        ) !== "—"
                          ? shopName(
                              order.shop_id
                            )
                          : order.shop ||
                              "—"
                      )}
                    </td>

                    <td>
                      ${esc(
                        courierName(
                          order.courier_id
                        ) !== "—"
                          ? courierName(
                              order.courier_id
                            )
                          : order.courier ||
                              "—"
                      )}
                    </td>

                    <td>
                      ${money(
                        orderFee(order)
                      )}
                    </td>

                    <td>
                      ${statusBadge(
                        order.status
                      )}
                    </td>

                    <td>
                      ${dateTime(
                        order.created_at
                      )}
                    </td>

                    <td>
                      <button
                        class="btn btn-ghost"
                        data-order-view="${esc(
                          order.id
                        )}"
                        type="button"
                      >
                        فتح
                      </button>
                    </td>

                  </tr>
                `
              )
              .join("")}

          </tbody>

        </table>

      </div>
    `;

    $$("[data-order-view]").forEach(
      button => {
        button.addEventListener(
          "click",
          () =>
            openOrder(
              button.dataset.orderView
            )
        );
      }
    );
  }

  function openNewOrder() {
    const shopsOptions =
      state.shops
        .filter(shop => shop.is_active !== false)
        .map(
          shop => `
            <option value="${esc(shop.id)}">
              ${esc(shop.name)}
            </option>
          `
        )
        .join("");

    const couriersOptions =
      state.couriers
        .filter(
          courier =>
            courier.is_active !== false
        )
        .map(
          courier => `
            <option value="${esc(courier.id)}">
              ${esc(courier.name)}
            </option>
          `
        )
        .join("");

    openModal(
      "إضافة طلب جديد",
      `
        <form id="orderForm">

          <div class="form-grid">

            ${
              !isShop()
                ? `
                  <div class="field">
                    <label>
                      المحل
                    </label>

                    <select id="fShop">
                      <option value="">
                        اختر المحل
                      </option>
                      ${shopsOptions}
                    </select>
                  </div>
                `
                : ""
            }

            <div class="field">
              <label>
                اسم الزبون
              </label>

              <input
                id="fCustomer"
                required
              >
            </div>

            <div class="field">
              <label>
                رقم الهاتف
              </label>

              <input
                id="fPhone"
                inputmode="tel"
                required
              >
            </div>

            <div class="field">
              <label>
                أجرة التوصيل
              </label>

              <input
                id="fFee"
                type="number"
                min="0"
                value="${Number(
                  state.settings
                    .default_delivery_fee
                )}"
                required
              >
            </div>

            ${
              canOperate()
                ? `
                  <div class="field">
                    <label>
                      المندوب
                    </label>

                    <select id="fCourier">
                      <option value="">
                        بدون تعيين
                      </option>
                      ${couriersOptions}
                    </select>
                  </div>
                `
                : ""
            }

            <div class="field">
              <label>
                مصدر الطلب
              </label>

              <select id="fSource">
                <option value="${
                  isShop()
                    ? "shop"
                    : "phone"
                }">
                  ${
                    isShop()
                      ? "المحل"
                      : "هاتف"
                  }
                </option>

                <option value="whatsapp">
                  واتساب
                </option>

                <option value="instagram">
                  إنستغرام
                </option>

                <option value="facebook">
                  فيسبوك
                </option>

                <option value="other">
                  أخرى
                </option>
              </select>
            </div>

            <div class="field full">
              <label>
                عنوان التوصيل
              </label>

              <textarea
                id="fAddress"
                required
              ></textarea>
            </div>

            <div class="field full">
              <label>
                ملاحظات
              </label>

              <textarea
                id="fNotes"
              ></textarea>
            </div>

          </div>

          <div class="form-actions">

            <button
              type="button"
              class="btn btn-ghost"
              data-close
            >
              إلغاء
            </button>

            <button
              type="submit"
              class="btn btn-primary"
            >
              حفظ الطلب
            </button>

          </div>

        </form>
      `
    );

    bindModalClose();

    $("#orderForm")
      ?.addEventListener(
        "submit",
        createOrder
      );
  }

  async function createOrder(event) {
    event.preventDefault();

    const phone =
      normalizeIraqPhone(
        $("#fPhone")?.value
      );

    if (!validIraqPhone(phone)) {
      toast(
        "رقم هاتف الزبون غير صحيح.",
        "warn"
      );
      return;
    }

    let shopId = null;

    if (isShop()) {
      shopId =
        state.profile?.shop_id ||
        null;
    } else {
      shopId =
        $("#fShop")?.value ||
        null;
    }

    const courierId =
      $("#fCourier")?.value ||
      null;

    const payload = {
      shop_id: shopId,
      courier_id: courierId,

      customer_name:
        $("#fCustomer")?.value.trim(),

      customer_phone: phone,

      delivery_address:
        $("#fAddress")?.value.trim(),

      delivery_fee:
        Number(
          $("#fFee")?.value ||
            state.settings
              .default_delivery_fee
        ),

      status:
        courierId
          ? "assigned"
          : "new",

      notes:
        $("#fNotes")?.value.trim() ||
        "",

      created_by:
        state.session?.user?.id ||
        null,

      updated_at:
        new Date().toISOString()
    };

    showLoading(true);

    const { error } = await sb
      .from("orders")
      .insert(payload);

    showLoading(false);

    if (error) {
      console.error(error);

      toast(
        error.message,
        "error"
      );

      return;
    }

    closeModal();

    await loadOrders();

    renderOrders();

    toast(
      "تم إنشاء الطلب بنجاح."
    );
  }

  function openOrder(id) {
    const order =
      state.orders.find(
        item =>
          String(item.id) ===
          String(id)
      );

    if (!order) return;

    const canChange =
      canOperate() ||
      isCourier();

    openModal(
      `الطلب ${orderCode(order)}`,
      `
        <div class="grid two-col">

          <div class="card">

            <div class="kpi-line">
              <span>الزبون</span>
              <strong>
                ${esc(
                  customerName(order)
                )}
              </strong>
            </div>

            <div class="kpi-line">
              <span>الهاتف</span>
              <strong>
                ${esc(
                  customerPhone(order)
                )}
              </strong>
            </div>

            <div class="kpi-line">
              <span>العنوان</span>
              <strong>
                ${esc(
                  orderAddress(order)
                )}
              </strong>
            </div>

            <div class="kpi-line">
              <span>المحل</span>
              <strong>
                ${esc(
                  shopName(
                    order.shop_id
                  )
                )}
              </strong>
            </div>

            <div class="kpi-line">
              <span>المندوب</span>
              <strong>
                ${esc(
                  courierName(
                    order.courier_id
                  )
                )}
              </strong>
            </div>

            <div class="kpi-line">
              <span>أجرة التوصيل</span>
              <strong class="money">
                ${money(
                  orderFee(order)
                )}
              </strong>
            </div>

          </div>

          <div class="card">

            <div class="kpi-line">
              <span>الحالة</span>
              <strong>
                ${statusBadge(
                  order.status
                )}
              </strong>
            </div>

            <div class="kpi-line">
              <span>تاريخ الإنشاء</span>
              <strong>
                ${dateTime(
                  order.created_at
                )}
              </strong>
            </div>

            <div class="kpi-line">
              <span>ملاحظات</span>
              <strong>
                ${esc(
                  order.notes ||
                    "—"
                )}
              </strong>
            </div>

          </div>

        </div>

        ${
          canChange
            ? `
              <div
                class="card"
                style="margin-top:15px"
              >

                <div class="card-header">
                  <h3>
                    تحديث الحالة
                  </h3>
                </div>

                <div class="form-grid">

                  <div class="field">

                    <label>
                      الحالة
                    </label>

                    <select id="editStatus">

                      <option
                        value="new"
                        ${
                          order.status ===
                          "new"
                            ? "selected"
                            : ""
                        }
                      >
                        طلب جديد
                      </option>

                      <option
                        value="assigned"
                        ${
                          order.status ===
                          "assigned"
                            ? "selected"
                            : ""
                        }
                      >
                        بانتظار المندوب
                      </option>

                      <option
                        value="accepted"
                        ${
                          order.status ===
                          "accepted"
                            ? "selected"
                            : ""
                        }
                      >
                        تم القبول
                      </option>

                      <option
                        value="picked_up"
                        ${
                          order.status ===
                          "picked_up"
                            ? "selected"
                            : ""
                        }
                      >
                        تم الاستلام
                      </option>

                      <option
                        value="on_the_way"
                        ${
                          order.status ===
                          "on_the_way"
                            ? "selected"
                            : ""
                        }
                      >
                        بالطريق
                      </option>

                      <option
                        value="delivered"
                        ${
                          order.status ===
                          "delivered"
                            ? "selected"
                            : ""
                        }
                      >
                        تم التسليم
                      </option>

                      <option
                        value="returned"
                        ${
                          order.status ===
                          "returned"
                            ? "selected"
                            : ""
                        }
                      >
                        راجع
                      </option>

                      ${
                        canOperate()
                          ? `
                            <option
                              value="cancelled"
                              ${
                                order.status ===
                                "cancelled"
                                  ? "selected"
                                  : ""
                              }
                            >
                              ملغي
                            </option>
                          `
                          : ""
                      }

                    </select>

                  </div>

                </div>

                <div class="form-actions">

                  <button
                    id="saveOrderStatus"
                    class="btn btn-primary"
                    type="button"
                  >
                    حفظ الحالة
                  </button>

                </div>

              </div>
            `
            : ""
        }
      `,
      true
    );

    bindModalClose();

    $("#saveOrderStatus")
      ?.addEventListener(
        "click",
        async () => {
          const newStatus =
            $("#editStatus")?.value;

          if (!newStatus) return;

          const update = {
            status: newStatus,
            updated_at:
              new Date().toISOString()
          };

          if (
            newStatus === "accepted"
          ) {
            update.accepted_at =
              new Date().toISOString();
          }

          if (
            newStatus === "picked_up"
          ) {
            update.picked_up_at =
              new Date().toISOString();
          }

          if (
            newStatus === "delivered"
          ) {
            update.delivered_at =
              new Date().toISOString();
          }

          if (
            newStatus === "cancelled"
          ) {
            update.cancelled_at =
              new Date().toISOString();
          }

          const { error } = await sb
            .from("orders")
            .update(update)
            .eq("id", order.id);

          if (error) {
            toast(
              error.message,
              "error"
            );
            return;
          }

          closeModal();

          await loadOrders();

          renderOrders();

          toast(
            "تم تحديث حالة الطلب."
          );
        }
      );
  }


  /* =========================================================
     SHOPS
     ========================================================= */

  function renderShops() {
    if (!canOperate()) {
      state.page = "dashboard";
      renderDashboard();
      return;
    }

    setTitle("المحلات");

    $("#content").innerHTML = `
      <div class="card">

        <div class="card-header">

          <h2>
            المحلات المتعاونة
          </h2>

          ${
            isAdmin()
              ? `
                <button
                  id="newShop"
                  class="btn btn-primary"
                  type="button"
                >
                  + إضافة محل
                </button>
              `
              : ""
          }

        </div>

        <div class="table-wrap">

          <table>

            <thead>
              <tr>
                <th>المحل</th>
                <th>الهاتف</th>
                <th>العنوان</th>
                <th>الحالة</th>
              </tr>
            </thead>

            <tbody>

              ${state.shops
                .map(
                  shop => `
                    <tr>
                      <td>
                        <strong>
                          ${esc(shop.name)}
                        </strong>
                      </td>

                      <td>
                        ${esc(
                          shop.phone ||
                            "—"
                        )}
                      </td>

                      <td>
                        ${esc(
                          shop.address ||
                            "—"
                        )}
                      </td>

                      <td>
                        ${
                          shop.is_active ===
                          false
                            ? `
                              <span class="badge badge-cancel">
                                موقوف
                              </span>
                            `
                            : `
                              <span class="badge badge-done">
                                فعّال
                              </span>
                            `
                        }
                      </td>
                    </tr>
                  `
                )
                .join("")}

            </tbody>

          </table>

        </div>

      </div>
    `;

    $("#newShop")
      ?.addEventListener(
        "click",
        newShopModal
      );
  }

  function newShopModal() {
    openModal(
      "إضافة محل",
      `
        <form id="entityForm">

          <div class="form-grid">

            <div class="field">
              <label>
                اسم المحل
              </label>
              <input id="eName" required>
            </div>

            <div class="field">
              <label>
                الهاتف
              </label>
              <input id="ePhone">
            </div>

            <div class="field full">
              <label>
                العنوان
              </label>
              <textarea id="eAddress"></textarea>
            </div>

          </div>

          <div class="form-actions">

            <button
              type="button"
              class="btn btn-ghost"
              data-close
            >
              إلغاء
            </button>

            <button
              class="btn btn-primary"
              type="submit"
            >
              حفظ
            </button>

          </div>

        </form>
      `
    );

    bindModalClose();

    $("#entityForm")
      ?.addEventListener(
        "submit",
        async event => {
          event.preventDefault();

          const { error } = await sb
            .from("shops")
            .insert({
              name:
                $("#eName").value.trim(),
              phone:
                normalizeIraqPhone(
                  $("#ePhone").value
                ),
              address:
                $("#eAddress").value.trim(),
              is_active: true
            });

          if (error) {
            toast(
              error.message,
              "error"
            );
            return;
          }

          closeModal();

          await loadShops();

          renderShops();

          toast("تمت إضافة المحل.");
        }
      );
  }


  /* =========================================================
     COURIERS
     ========================================================= */

  function renderCouriers() {
    if (!canOperate()) {
      state.page = "dashboard";
      renderDashboard();
      return;
    }

    setTitle("المندوبون");

    $("#content").innerHTML = `
      <div class="card">

        <div class="card-header">

          <h2>
            المندوبون
          </h2>

          ${
            isAdmin()
              ? `
                <button
                  id="newCourier"
                  class="btn btn-primary"
                  type="button"
                >
                  + إضافة مندوب
                </button>
              `
              : ""
          }

        </div>

        <div class="table-wrap">

          <table>

            <thead>
              <tr>
                <th>المندوب</th>
                <th>الهاتف</th>
                <th>الحالة</th>
                <th>التفعيل</th>
              </tr>
            </thead>

            <tbody>

              ${state.couriers
                .map(
                  courier => `
                    <tr>

                      <td>
                        <strong>
                          ${esc(
                            courier.name
                          )}
                        </strong>
                      </td>

                      <td>
                        ${esc(
                          courier.phone ||
                            "—"
                        )}
                      </td>

                      <td>
                        ${
                          courier.status ===
                          "available"
                            ? `
                              <span class="badge badge-done">
                                متاح
                              </span>
                            `
                            : `
                              <span class="badge badge-pending">
                                غير متاح
                              </span>
                            `
                        }
                      </td>

                      <td>
                        ${
                          courier.is_active ===
                          false
                            ? `
                              <span class="badge badge-cancel">
                                موقوف
                              </span>
                            `
                            : `
                              <span class="badge badge-done">
                                فعّال
                              </span>
                            `
                        }
                      </td>

                    </tr>
                  `
                )
                .join("")}

            </tbody>

          </table>

        </div>

      </div>
    `;

    $("#newCourier")
      ?.addEventListener(
        "click",
        newCourierModal
      );
  }

  function newCourierModal() {
    openModal(
      "إضافة مندوب",
      `
        <form id="entityForm">

          <div class="form-grid">

            <div class="field">
              <label>
                اسم المندوب
              </label>
              <input id="eName" required>
            </div>

            <div class="field">
              <label>
                الهاتف
              </label>
              <input id="ePhone">
            </div>

          </div>

          <div class="form-actions">

            <button
              type="button"
              class="btn btn-ghost"
              data-close
            >
              إلغاء
            </button>

            <button
              class="btn btn-primary"
              type="submit"
            >
              حفظ
            </button>

          </div>

        </form>
      `
    );

    bindModalClose();

    $("#entityForm")
      ?.addEventListener(
        "submit",
        async event => {
          event.preventDefault();

          const { error } = await sb
            .from("couriers")
            .insert({
              name:
                $("#eName").value.trim(),

              phone:
                normalizeIraqPhone(
                  $("#ePhone").value
                ),

              status: "available",
              is_active: true
            });

          if (error) {
            toast(
              error.message,
              "error"
            );
            return;
          }

          closeModal();

          await loadCouriers();

          renderCouriers();

          toast(
            "تمت إضافة المندوب."
          );
        }
      );
  }


  /* =========================================================
     MAP
     ========================================================= */

  function renderMap() {
    if (!canOperate()) {
      state.page = "dashboard";
      renderDashboard();
      return;
    }

    setTitle(
      "غرفة العمليات",
      "المحلات والمندوبون والطلبات النشطة"
    );

    $("#content").innerHTML = `
      <div class="card">

        <div class="card-header">
          <h2>
            خريطة كربلاء المقدسة
          </h2>

          <button
            id="refreshMap"
            class="btn btn-ghost"
            type="button"
          >
            تحديث
          </button>
        </div>

        <div class="map-shell">
          <div id="operationsMap"></div>
        </div>

      </div>
    `;

    setTimeout(initMap, 50);

    $("#refreshMap")
      ?.addEventListener(
        "click",
        async () => {
          await Promise.all([
            loadOrders(),
            loadShops(),
            loadCouriers()
          ]);

          initMap();
        }
      );
  }

  function initMap() {
    if (!window.L) {
      toast(
        "تعذر تحميل الخريطة.",
        "error"
      );
      return;
    }

    if (state.map) {
      state.map.remove();
      state.map = null;
    }

    const lat =
      Number(C.MAP?.LAT) ||
      32.616;

    const lng =
      Number(C.MAP?.LNG) ||
      44.0249;

    const zoom =
      Number(C.MAP?.ZOOM) ||
      13;

    state.map = L.map(
      "operationsMap"
    ).setView(
      [lat, lng],
      zoom
    );

    L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution:
          "&copy; OpenStreetMap"
      }
    ).addTo(state.map);

    state.shops.forEach(shop => {
      const shopLat =
        Number(
          shop.latitude ??
            shop.lat
        );

      const shopLng =
        Number(
          shop.longitude ??
            shop.lng
        );

      if (
        !Number.isFinite(shopLat) ||
        !Number.isFinite(shopLng)
      ) {
        return;
      }

      L.marker(
        [shopLat, shopLng]
      )
        .addTo(state.map)
        .bindPopup(
          `<strong>${esc(
            shop.name
          )}</strong><br>محل متعاون مع وصلّي`
        );
    });

    state.couriers.forEach(courier => {
      const courierLat =
        Number(courier.latitude);

      const courierLng =
        Number(courier.longitude);

      if (
        !Number.isFinite(
          courierLat
        ) ||
        !Number.isFinite(
          courierLng
        )
      ) {
        return;
      }

      L.marker(
        [courierLat, courierLng]
      )
        .addTo(state.map)
        .bindPopup(
          `<strong>${esc(
            courier.name
          )}</strong><br>${esc(
            courier.status ===
              "available"
              ? "متاح"
              : "غير متاح"
          )}`
        );
    });

    state.orders
      .filter(order =>
        [
          "new",
          "assigned",
          "accepted",
          "picked_up",
          "on_the_way"
        ].includes(order.status)
      )
      .forEach(order => {
        const orderLat =
          Number(order.latitude);

        const orderLng =
          Number(order.longitude);

        if (
          !Number.isFinite(
            orderLat
          ) ||
          !Number.isFinite(
            orderLng
          )
        ) {
          return;
        }

        L.circleMarker(
          [orderLat, orderLng],
          {
            radius: 9
          }
        )
          .addTo(state.map)
          .bindPopup(
            `<strong>${esc(
              orderCode(order)
            )}</strong><br>${esc(
              statusLabel(
                order.status
              )
            )}`
          );
      });

    setTimeout(() => {
      state.map?.invalidateSize();
    }, 200);
  }


  /* =========================================================
     PRICING
     ========================================================= */

  function renderPricing() {
    if (!canOperate()) {
      state.page = "dashboard";
      renderDashboard();
      return;
    }

    setTitle(
      "المناطق والتسعير"
    );

    $("#content").innerHTML = `
      <div class="grid three-col">

        <div class="card stat">
          <div class="label">
            الفئة A
          </div>
          <div class="value">
            ${money(
              C.PRICING?.A ||
                2000
            )}
          </div>
          <div class="hint">
            مسار قريب
          </div>
        </div>

        <div class="card stat">
          <div class="label">
            الفئة B
          </div>
          <div class="value">
            ${money(
              C.PRICING?.B ||
                3000
            )}
          </div>
          <div class="hint">
            المسار الاعتيادي
          </div>
        </div>

        <div class="card stat">
          <div class="label">
            الفئة C
          </div>
          <div class="value">
            يدوي
          </div>
          <div class="hint">
            تحدده الإدارة أو العمليات
          </div>
        </div>

      </div>

      <div
        class="card"
        style="margin-top:18px"
      >

        <div class="card-header">
          <h2>
            مناطق كربلاء
          </h2>
        </div>

        <div class="area-chips">

          ${
            state.areas.length
              ? state.areas
                  .map(
                    area => `
                      <span class="area-chip">
                        ${esc(
                          area.name
                        )}
                      </span>
                    `
                  )
                  .join("")
              : `
                <span class="muted">
                  لم يتم تحميل المناطق.
                </span>
              `
          }

        </div>

      </div>
    `;
  }


  /* =========================================================
     ACCOUNTS
     ========================================================= */

  function renderAccounts() {
    if (
      !canFinance() &&
      !isCourier()
    ) {
      state.page = "dashboard";
      renderDashboard();
      return;
    }

    setTitle(
      isCourier()
        ? "حسابي"
        : "الحسابات"
    );

    const delivered =
      state.orders.filter(
        order =>
          order.status ===
          "delivered"
      );

    const totalFees =
      delivered.reduce(
        (sum, order) =>
          sum + orderFee(order),
        0
      );

    const courierShare =
      totalFees *
      Number(
        state.settings
          .courier_percent
      ) /
      100;

    const companyShare =
      totalFees *
      Number(
        state.settings
          .company_percent
      ) /
      100;

    $("#content").innerHTML = `
      <div class="grid three-col">

        <div class="card stat">
          <div class="label">
            إجمالي أجور التوصيل
          </div>

          <div class="value">
            ${money(totalFees)}
          </div>
        </div>

        <div class="card stat">
          <div class="label">
            حصة المندوبين ${state.settings.courier_percent}%
          </div>

          <div class="value">
            ${money(
              courierShare
            )}
          </div>
        </div>

        <div class="card stat">
          <div class="label">
            حصة وصلّي ${state.settings.company_percent}%
          </div>

          <div class="value">
            ${money(
              companyShare
            )}
          </div>
        </div>

      </div>

      <div
        class="card"
        style="margin-top:18px"
      >

        <div class="card-header">
          <h2>
            سجل تسويات المندوبين
          </h2>
        </div>

        <div class="table-wrap">

          <table>

            <thead>
              <tr>
                <th>المندوب</th>
                <th>الطلبات</th>
                <th>الأجور</th>
                <th>مستحق المندوب</th>
                <th>حصة وصلّي</th>
                <th>التاريخ</th>
              </tr>
            </thead>

            <tbody>

              ${
                state.settlements.length
                  ? state.settlements
                      .map(
                        settlement => `
                          <tr>

                            <td>
                              ${esc(
                                settlement.courier_name ||
                                  courierName(
                                    settlement.courier_id
                                  )
                              )}
                            </td>

                            <td>
                              ${Number(
                                settlement.orders_count ||
                                  0
                              )}
                            </td>

                            <td>
                              ${money(
                                settlement.total_fees
                              )}
                            </td>

                            <td>
                              ${money(
                                settlement.courier_share
                              )}
                            </td>

                            <td>
                              ${money(
                                settlement.wasalli_share
                              )}
                            </td>

                            <td>
                              ${dateTime(
                                settlement.settled_at ||
                                  settlement.created_at
                              )}
                            </td>

                          </tr>
                        `
                      )
                      .join("")
                  : `
                    <tr>
                      <td
                        colspan="6"
                        class="empty"
                      >
                        لا توجد تسويات مسجلة.
                      </td>
                    </tr>
                  `
              }

            </tbody>

          </table>

        </div>

      </div>
    `;
  }


  /* =========================================================
     REPORTS
     ========================================================= */

  function renderReports() {
    if (!canFinance()) {
      state.page = "dashboard";
      renderDashboard();
      return;
    }

    setTitle("التقارير");

    const statuses = [
      "new",
      "assigned",
      "accepted",
      "picked_up",
      "on_the_way",
      "delivered",
      "returned",
      "cancelled"
    ];

    const delivered =
      state.orders.filter(
        order =>
          order.status ===
          "delivered"
      );

    const totalFees =
      delivered.reduce(
        (sum, order) =>
          sum + orderFee(order),
        0
      );

    $("#content").innerHTML = `
      <div class="grid two-col">

        <div class="card">

          <div class="card-header">
            <h2>
              حالات الطلبات
            </h2>
          </div>

          ${statuses
            .map(
              status => `
                <div class="kpi-line">

                  <span>
                    ${esc(
                      statusLabel(
                        status
                      )
                    )}
                  </span>

                  <strong>
                    ${
                      state.orders.filter(
                        order =>
                          order.status ===
                          status
                      ).length
                    }
                  </strong>

                </div>
              `
            )
            .join("")}

        </div>

        <div class="card">

          <div class="card-header">
            <h2>
              التقرير المالي
            </h2>
          </div>

          <div class="kpi-line">
            <span>
              الطلبات المسلّمة
            </span>

            <strong>
              ${delivered.length}
            </strong>
          </div>

          <div class="kpi-line">
            <span>
              إجمالي أجور التوصيل
            </span>

            <strong class="money">
              ${money(totalFees)}
            </strong>
          </div>

          <div class="kpi-line">
            <span>
              حصة وصلّي
            </span>

            <strong class="money">
              ${money(
                totalFees *
                  state.settings
                    .company_percent /
                  100
              )}
            </strong>
          </div>

        </div>

      </div>
    `;
  }


  /* =========================================================
     USERS
     ========================================================= */

  function renderUsers() {
    if (!isAdmin()) {
      state.page = "dashboard";
      renderDashboard();
      return;
    }

    setTitle(
      "الحسابات والصلاحيات"
    );

    $("#content").innerHTML = `
      <div class="card">

        <div class="card-header">
          <h2>
            المستخدمون
          </h2>

          <span class="badge badge-pending">
            التسجيل الجديد يحتاج موافقة
          </span>
        </div>

        <div class="table-wrap">

          <table>

            <thead>
              <tr>
                <th>الاسم</th>
                <th>الهاتف</th>
                <th>الدور</th>
                <th>الحالة</th>
                <th>إدارة</th>
              </tr>
            </thead>

            <tbody>

              ${state.profiles
                .map(
                  profile => `
                    <tr>

                      <td>
                        <strong>
                          ${esc(
                            profile.full_name ||
                              "—"
                          )}
                        </strong>
                      </td>

                      <td>
                        ${esc(
                          profile.phone ||
                            "—"
                        )}
                      </td>

                      <td>
                        ${esc(
                          roleLabel(
                            profile.role
                          )
                        )}
                      </td>

                      <td>
                        ${
                          profile.is_active
                            ? `
                              <span class="badge badge-done">
                                فعّال
                              </span>
                            `
                            : `
                              <span class="badge badge-pending">
                                موقوف / بانتظار
                              </span>
                            `
                        }
                      </td>

                      <td>
                        <button
                          class="btn btn-ghost"
                          data-profile="${esc(
                            profile.id
                          )}"
                          type="button"
                        >
                          إدارة
                        </button>
                      </td>

                    </tr>
                  `
                )
                .join("")}

            </tbody>

          </table>

        </div>

      </div>
    `;

    $$("[data-profile]").forEach(
      button => {
        button.addEventListener(
          "click",
          () =>
            profileModal(
              button.dataset.profile
            )
        );
      }
    );
  }

  function profileModal(id) {
    const profile =
      state.profiles.find(
        item =>
          String(item.id) ===
          String(id)
      );

    if (!profile) return;

    openModal(
      "إدارة الحساب",
      `
        <form id="profileForm">

          <div class="form-grid">

            <div class="field">
              <label>
                الاسم
              </label>

              <input
                value="${esc(
                  profile.full_name ||
                    ""
                )}"
                disabled
              >
            </div>

            <div class="field">
              <label>
                الهاتف
              </label>

              <input
                value="${esc(
                  profile.phone ||
                    ""
                )}"
                disabled
              >
            </div>

            <div class="field">

              <label>
                الدور
              </label>

              <select id="pRole">

                <option
                  value="pending"
                  ${
                    profile.role ===
                    "pending"
                      ? "selected"
                      : ""
                  }
                >
                  قيد المراجعة
                </option>

                <option
                  value="shop"
                  ${
                    profile.role ===
                    "shop"
                      ? "selected"
                      : ""
                  }
                >
                  محل
                </option>

                <option
                  value="courier"
                  ${
                    profile.role ===
                    "courier"
                      ? "selected"
                      : ""
                  }
                >
                  مندوب
                </option>

                <option
                  value="customer"
                  ${
                    profile.role ===
                    "customer"
                      ? "selected"
                      : ""
                  }
                >
                  زبون
                </option>

                <option
                  value="hotel"
                  ${
                    profile.role ===
                    "hotel"
                      ? "selected"
                      : ""
                  }
                >
                  فندق
                </option>

                <option
                  value="operations"
                  ${
                    profile.role ===
                    "operations"
                      ? "selected"
                      : ""
                  }
                >
                  عمليات
                </option>

                <option
                  value="accountant"
                  ${
                    profile.role ===
                    "accountant"
                      ? "selected"
                      : ""
                  }
                >
                  محاسب
                </option>

                <option
                  value="admin"
                  ${
                    profile.role ===
                    "admin"
                      ? "selected"
                      : ""
                  }
                >
                  إدارة
                </option>

              </select>

            </div>

            <div class="field">

              <label>
                حالة الحساب
              </label>

              <select id="pActive">

                <option
                  value="true"
                  ${
                    profile.is_active
                      ? "selected"
                      : ""
                  }
                >
                  فعّال
                </option>

                <option
                  value="false"
                  ${
                    !profile.is_active
                      ? "selected"
                      : ""
                  }
                >
                  موقوف
                </option>

              </select>

            </div>

          </div>

          <div class="form-actions">

            <button
              type="button"
              class="btn btn-ghost"
              data-close
            >
              إلغاء
            </button>

            <button
              class="btn btn-primary"
              type="submit"
            >
              حفظ
            </button>

          </div>

        </form>
      `
    );

    bindModalClose();

    $("#profileForm")
      ?.addEventListener(
        "submit",
        async event => {
          event.preventDefault();

          const { error } = await sb
            .from("profiles")
            .update({
              role:
                $("#pRole").value,

              is_active:
                $("#pActive").value ===
                "true",

              updated_at:
                new Date().toISOString()
            })
            .eq("id", profile.id);

          if (error) {
            toast(
              error.message,
              "error"
            );
            return;
          }

          closeModal();

          await loadProfiles();

          renderUsers();

          toast(
            "تم تحديث الحساب."
          );
        }
      );
  }


  /* =========================================================
     SETTINGS
     ========================================================= */

  function renderSettings() {
    setTitle("الإعدادات");

    $("#content").innerHTML = `
      <div class="card">

        <div class="card-header">
          <h2>
            الإعدادات
          </h2>
        </div>

        ${
          isAdmin()
            ? `
              <form id="settingsForm">

                <div class="form-grid">

                  <div class="field">
                    <label>
                      اسم الشركة
                    </label>

                    <input
                      id="sCompany"
                      value="${esc(
                        state.settings
                          .company_name
                      )}"
                    >
                  </div>

                  <div class="field">
                    <label>
                      منطقة العمل
                    </label>

                    <input
                      id="sCity"
                      value="${esc(
                        state.settings
                          .city
                      )}"
                    >
                  </div>

                  <div class="field">
                    <label>
                      أجرة التوصيل الافتراضية
                    </label>

                    <input
                      id="sFee"
                      type="number"
                      value="${Number(
                        state.settings
                          .default_delivery_fee
                      )}"
                    >
                  </div>

                  <div class="field">
                    <label>
                      واتساب الطلبات
                    </label>

                    <input
                      id="sWhatsapp"
                      value="${esc(
                        state.settings
                          .whatsapp
                      )}"
                    >
                  </div>

                  <div class="field">
                    <label>
                      نسبة المندوب %
                    </label>

                    <input
                      id="sCourierPct"
                      type="number"
                      min="0"
                      max="100"
                      value="${Number(
                        state.settings
                          .courier_percent
                      )}"
                    >
                  </div>

                  <div class="field">
                    <label>
                      نسبة وصلّي %
                    </label>

                    <input
                      id="sCompanyPct"
                      type="number"
                      min="0"
                      max="100"
                      value="${Number(
                        state.settings
                          .company_percent
                      )}"
                    >
                  </div>

                </div>

                <div class="form-actions">

                  <button
                    class="btn btn-primary"
                    type="submit"
                  >
                    حفظ الإعدادات
                  </button>

                </div>

              </form>
            `
            : `
              <div class="kpi-line">
                <span>
                  الاسم
                </span>

                <strong>
                  ${esc(
                    state.profile
                      ?.full_name ||
                      "—"
                  )}
                </strong>
              </div>

              <div class="kpi-line">
                <span>
                  رقم الهاتف
                </span>

                <strong>
                  ${esc(
                    state.profile
                      ?.phone ||
                      "—"
                  )}
                </strong>
              </div>

              <div class="kpi-line">
                <span>
                  نوع الحساب
                </span>

                <strong>
                  ${esc(
                    roleLabel(
                      state.profile?.role
                    )
                  )}
                </strong>
              </div>
            `
        }

        <div class="settings-danger">

          <button
            id="settingsLogoutBtn"
            class="btn btn-danger"
            type="button"
          >
            تسجيل الخروج
          </button>

        </div>

      </div>
    `;

    $("#settingsForm")
      ?.addEventListener(
        "submit",
        saveSettings
      );

    $("#settingsLogoutBtn")
      ?.addEventListener(
        "click",
        logout
      );
  }

  async function saveSettings(event) {
    event.preventDefault();

    if (!isAdmin()) return;

    const courierPercent =
      Number(
        $("#sCourierPct")?.value
      );

    const companyPercent =
      Number(
        $("#sCompanyPct")?.value
      );

    if (
      courierPercent +
        companyPercent !==
      100
    ) {
      toast(
        "نسبة المندوب + نسبة وصلّي يجب أن تساوي 100%.",
        "warn"
      );
      return;
    }

    const settings = {
      company_name:
        $("#sCompany")?.value.trim() ||
        "وصلّي",

      city:
        $("#sCity")?.value.trim() ||
        "كربلاء المقدسة",

      default_delivery_fee:
        Number(
          $("#sFee")?.value
        ) || 3000,

      whatsapp:
        $("#sWhatsapp")?.value.trim() ||
        "",

      courier_percent:
        courierPercent,

      company_percent:
        companyPercent
    };

    const rows =
      Object.entries(settings).map(
        ([key, value]) => ({
          key,
          value: { value },
          updated_at:
            new Date().toISOString()
        })
      );

    const { error } = await sb
      .from("app_settings")
      .upsert(rows, {
        onConflict: "key"
      });

    if (error) {
      toast(
        error.message,
        "error"
      );
      return;
    }

    Object.assign(
      state.settings,
      settings
    );

    toast(
      "تم حفظ الإعدادات."
    );
  }


  /* =========================================================
     MODALS
     ========================================================= */

  function openModal(
    title,
    body,
    large = false
  ) {
    const root =
      $("#modalRoot");

    if (!root) return;

    root.innerHTML = `
      <div class="modal-backdrop">

        <div
          class="modal ${
            large ? "large" : ""
          }"
        >

          <div class="modal-header">

            <h2>
              ${esc(title)}
            </h2>

            <button
              class="modal-close"
              data-close
              type="button"
              aria-label="إغلاق"
            >
              ×
            </button>

          </div>

          ${body}

        </div>

      </div>
    `;

    document.body.classList.add(
      "no-scroll"
    );

    bindModalClose();
  }

  function closeModal() {
    const root =
      $("#modalRoot");

    if (root) {
      root.innerHTML = "";
    }

    document.body.classList.remove(
      "no-scroll"
    );
  }

  function bindModalClose() {
    const root =
      $("#modalRoot");

    if (!root) return;

    $$("[data-close]", root).forEach(
      button => {
        button.onclick = closeModal;
      }
    );

    $(".modal-backdrop", root)
      ?.addEventListener(
        "click",
        event => {
          if (
            event.target.classList.contains(
              "modal-backdrop"
            )
          ) {
            closeModal();
          }
        }
      );
  }


  /* =========================================================
     SIGNUP AREA SELECTS
     ========================================================= */

  function populateSignupAreas() {
    const names =
      state.areas.length
        ? state.areas.map(
            area => area.name
          )
        : [
            "مركز كربلاء",
            "الولاية",
            "باب الخان",
            "باب بغداد",
            "باب طويريج",
            "الحسين",
            "العباس",
            "الحر",
            "حي الموظفين",
            "حي النقيب",
            "حي المعلمين",
            "حي رمضان",
            "حي الغدير",
            "حي العامل",
            "حي الأسرة",
            "حي البلدية",
            "حي الصحة",
            "حي العسكري",
            "حي الزهراء",
            "حي الرسالة",
            "حي الحسين",
            "حي الانتفاضة",
            "الإسكان",
            "الجمعية",
            "الملحق",
            "سيف سعد",
            "طريق النجف",
            "طريق بابل",
            "طريق بغداد",
            "الحسينية",
            "عين التمر",
            "الهندية",
            "الخيرات",
            "الجدول الغربي",
            "أخرى"
          ];

    [
      "#courierArea",
      "#shopArea",
      "#hotelArea"
    ].forEach(selector => {
      const select = $(selector);

      if (!select) return;

      const current =
        select.value;

      select.innerHTML = `
        <option value="">
          اختر المنطقة
        </option>

        ${names
          .map(
            name => `
              <option value="${esc(
                name
              )}">
                ${esc(name)}
              </option>
            `
          )
          .join("")}
      `;

      if (current) {
        select.value = current;
      }
    });
  }


  /* =========================================================
     STATIC EVENTS
     ========================================================= */

  function bindStaticEvents() {
    $("#loginForm")
      ?.addEventListener(
        "submit",
        login
      );

    $("#signupForm")
      ?.addEventListener(
        "submit",
        signup
      );

    $("#signupType")
      ?.addEventListener(
        "change",
        toggleSignupFields
      );

    $("#legacyLoginBtn")
      ?.addEventListener(
        "click",
        legacyEmailLogin
      );

    $("#pendingLogout")
      ?.addEventListener(
        "click",
        logout
      );

    $("#logoutBtn")
      ?.addEventListener(
        "click",
        logout
      );

    $("#menuToggle")
      ?.addEventListener(
        "click",
        openSidebar
      );

    $("#sidebarBackdrop")
      ?.addEventListener(
        "click",
        closeSidebar
      );

    $("#refreshBtn")
      ?.addEventListener(
        "click",
        async () => {
          await loadAll(true);
          renderPage();
        }
      );

    $("#notificationBtn")
      ?.addEventListener(
        "click",
        openNotifications
      );

    $$(".auth-tab").forEach(
      button => {
        button.addEventListener(
          "click",
          () => {
            $$(".auth-tab").forEach(
              tab =>
                tab.classList.remove(
                  "active"
                )
            );

            button.classList.add(
              "active"
            );

            const loginMode =
              button.dataset.authTab ===
              "login";

            $("#loginForm")
              ?.classList.toggle(
                "hidden",
                !loginMode
              );

            $("#signupForm")
              ?.classList.toggle(
                "hidden",
                loginMode
              );

            if ($("#authMessage")) {
              $("#authMessage")
                .textContent = "";
            }
          }
        );
      }
    );

    window.addEventListener(
      "resize",
      () => {
        if (
          window.innerWidth > 900
        ) {
          closeSidebar();
        }

        state.map?.invalidateSize();
      }
    );
  }


  /* =========================================================
     BOOT
     ========================================================= */

  async function boot() {
    bindStaticEvents();

    populateSignupAreas();

    try {
      const {
        data: { session }
      } =
        await sb.auth.getSession();

      if (session) {
        await enterSession(session);
      } else {
        showAuth();
      }

      sb.auth.onAuthStateChange(
        (event, session) => {
          if (
            event === "SIGNED_OUT"
          ) {
            state.session = null;
            state.profile = null;
            showAuth();
          }

          if (
            event === "SIGNED_IN" &&
            session &&
            !state.session
          ) {
            enterSession(session);
          }
        }
      );
    } catch (error) {
      console.error(error);

      showAuth();

      toast(
        "حدث خطأ أثناء تشغيل النظام.",
        "error"
      );
    }
  }

  boot();

})();
