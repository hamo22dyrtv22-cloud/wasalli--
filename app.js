(() => {
  "use strict";

  /* =========================================================
     WASALLI DELIVERY MANAGEMENT
     وصلي - نظام إدارة التوصيل
     ========================================================= */

  const CONFIG = window.WASALLI_CONFIG || {};

  const SUPABASE_URL =
    CONFIG.SUPABASE_URL ||
    "https://xagwkneegevbllexhvzz.supabase.co";

  const SUPABASE_KEY =
    CONFIG.SUPABASE_PUBLISHABLE_KEY ||
    "sb_publishable_8Ni4JHptJSjge_fG0vQVGQ_fcEVXEw7";

  if (!window.supabase) {
    console.error("Supabase library is not loaded.");
    return;
  }

  const sb = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
  );

  /* =========================================================
     CONSTANTS
     ========================================================= */

  const APP_NAME = CONFIG.APP_NAME || "وصلّي";
  const CITY = CONFIG.CITY || "كربلاء المقدسة";

  const DEFAULT_DELIVERY_FEE =
    Number(CONFIG.DEFAULT_DELIVERY_FEE || 3000);

  const COURIER_PERCENT =
    Number(CONFIG.COURIER_PERCENT || 70);

  const COMPANY_PERCENT =
    Number(CONFIG.COMPANY_PERCENT || 30);

  const OFFER_PRIORITY_SECONDS =
    Number(CONFIG.OFFER_PRIORITY_SECONDS || 60);

  const LATE_ORDER_MINUTES =
    Number(CONFIG.LATE_ORDER_MINUTES || 5);

  const DEFAULT_MAX_ACTIVE_ORDERS = 3;

  const ACTIVE_ORDER_STATUSES = [
    "assigned",
    "accepted",
    "picked_up",
    "on_the_way"
  ];

  const CLOSED_ORDER_STATUSES = [
    "delivered",
    "returned",
    "cancelled"
  ];

  const ORDER_STATUS_LABELS = {
    new: "طلب جديد",
    assigned: "مُسند",
    accepted: "تم قبول الطلب",
    picked_up: "تم الاستلام من المحل",
    on_the_way: "بالطريق",
    road: "بالطريق",
    delivered: "تم التسليم",
    returned: "راجع",
    cancelled: "ملغي"
  };

  const PAYMENT_LABELS = {
    cash: "نقداً عند الاستلام",
    cod: "نقداً عند الاستلام",
    prepaid: "مدفوع مسبقاً",
    electronic: "دفع إلكتروني",
    shop_account: "على حساب المحل"
  };

  const DELIVERY_PAYER_LABELS = {
    customer: "الزبون",
    shop: "المحل",
    split: "مشترك"
  };

  const REJECTION_LABELS = {
    far: "المكان بعيد",
    busy: "مشغول حالياً",
    bike_issue: "عطل بالمركبة",
    other: "سبب آخر"
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

  /* =========================================================
     STATE
     ========================================================= */

  const state = {
    session: null,
    profile: null,

    page: "dashboard",

    orders: [],
    shops: [],
    couriers: [],
    profiles: [],
    settings: {},

    orderOffers: [],
    currentCourier: null,

    notifications: [],

    financialLedger: [],
    courierPayments: [],
    expenses: [],

    map: null,
    mapMarkers: [],

    realtimeChannel: null,

    offerSoundTimer: null,
    dispatchTimer: null,
    locationWatchId: null,

    currentModal: null,

    loading: false
  };

  /* =========================================================
     DOM HELPERS
     ========================================================= */

  const $ = selector =>
    document.querySelector(selector);

  const $$ = selector =>
    Array.from(document.querySelectorAll(selector));

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function money(value) {
    return new Intl.NumberFormat("ar-IQ").format(
      safeNumber(value)
    ) + " د.ع";
  }

  function dateTime(value) {
    if (!value) return "—";

    try {
      return new Intl.DateTimeFormat(
        "ar-IQ",
        {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        }
      ).format(new Date(value));
    } catch {
      return String(value);
    }
  }

  function shortTime(value) {
    if (!value) return "—";

    try {
      return new Intl.DateTimeFormat(
        "ar-IQ",
        {
          hour: "2-digit",
          minute: "2-digit"
        }
      ).format(new Date(value));
    } catch {
      return "";
    }
  }

  function orderCode(order) {
    if (!order) return "—";

    if (order.order_number !== null &&
        order.order_number !== undefined) {
      return `W-${order.order_number}`;
    }

    return String(order.id || "").slice(0, 8);
  }

  function statusLabel(status) {
    return ORDER_STATUS_LABELS[status] || status || "—";
  }

  function paymentLabel(value) {
    return PAYMENT_LABELS[value] || value || "—";
  }

  function payerLabel(value) {
    return DELIVERY_PAYER_LABELS[value] || value || "—";
  }

  function roleLabel(value) {
    return ROLE_LABELS[value] || value || "—";
  }

  function normalizeIraqiPhone(phone) {
    let value = String(phone || "")
      .replace(/\D/g, "");

    if (!value) return "";

    if (value.startsWith("00964")) {
      value = value.slice(2);
    }

    if (value.startsWith("964")) {
      return value;
    }

    if (value.startsWith("0")) {
      return "964" + value.slice(1);
    }

    if (value.startsWith("7")) {
      return "964" + value;
    }

    return value;
  }

  function localPhone(phone) {
    const value = normalizeIraqiPhone(phone);

    if (value.startsWith("964")) {
      return "0" + value.slice(3);
    }

    return phone || "";
  }

  function phoneEmail(phone) {
    const normalized = normalizeIraqiPhone(phone);
    return `${normalized}@phone.wasalli.local`;
  }

  function googleMapsUrl(lat, lng) {
    if (
      lat === null ||
      lat === undefined ||
      lng === null ||
      lng === undefined
    ) {
      return "";
    }

    return (
      "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(`${lat},${lng}`)
    );
  }

  function wazeUrl(lat, lng) {
    if (
      lat === null ||
      lat === undefined ||
      lng === null ||
      lng === undefined
    ) {
      return "";
    }

    return (
      "https://www.waze.com/ul?ll=" +
      encodeURIComponent(`${lat},${lng}`) +
      "&navigate=yes"
    );
  }

  function whatsappUrl(phone) {
    const normalized = normalizeIraqiPhone(phone);

    if (!normalized) return "";

    return `https://wa.me/${normalized}`;
  }

  function callUrl(phone) {
    if (!phone) return "";
    return `tel:${localPhone(phone)}`;
  }

  function openExternal(url) {
    if (!url) {
      toast("المعلومة المطلوبة غير متوفرة.", "warning");
      return;
    }

    window.open(
      url,
      "_blank",
      "noopener,noreferrer"
    );
  }

  /* =========================================================
     ROLE HELPERS
     ========================================================= */

  function currentRole() {
    return state.profile?.role || "pending";
  }

  function isAdmin() {
    return currentRole() === "admin";
  }

  function isOperations() {
    return currentRole() === "operations";
  }

  function isAccountant() {
    return currentRole() === "accountant";
  }

  function isCourier() {
    return currentRole() === "courier";
  }

  function isShop() {
    return currentRole() === "shop";
  }

  function isAdminOrOperations() {
    return isAdmin() || isOperations();
  }

  function isFinanceUser() {
    return isAdmin() || isAccountant();
  }

  function isActiveProfile() {
    return Boolean(state.profile?.is_active);
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
      ["reports", "📊", "الملخص الأسبوعي"],
      ["settings", "⚙️", "الحساب"]
    ],

    courier: [
      ["dashboard", "⌂", "الرئيسية"],
      ["orders", "📦", "طلباتي"],
      ["accounts", "💰", "حسابي"],
      ["settings", "⚙️", "الحساب"]
    ]
  };

  function renderNavigation() {
    const nav = $("#navList");
    if (!nav) return;

    const items =
      NAV[currentRole()] ||
      NAV.courier;

    nav.innerHTML = items
      .map(
        ([page, icon, label]) => `
          <button
            type="button"
            class="nav-item ${
              state.page === page
                ? "active"
                : ""
            }"
            data-page="${escapeHTML(page)}"
          >
            <span class="nav-icon">${icon}</span>
            <span>${escapeHTML(label)}</span>
          </button>
        `
      )
      .join("");

    $$("[data-page]").forEach(button => {
      button.addEventListener(
        "click",
        () => {
          state.page =
            button.dataset.page;

          closeSidebar();
          renderNavigation();
          renderPage();
        }
      );
    });
  }

  function setTitle(title, subtitle = "") {
    const titleEl = $("#pageTitle");
    const subtitleEl = $("#pageSubtitle");

    if (titleEl) {
      titleEl.textContent = title;
    }

    if (subtitleEl) {
      subtitleEl.textContent =
        subtitle || CITY;
    }
  }

  /* =========================================================
     TOAST
     ========================================================= */

  function toast(message, type = "success") {
    let host = $("#toastHost");

    if (!host) {
      host = document.createElement("div");
      host.id = "toastHost";
      document.body.appendChild(host);
    }

    const item =
      document.createElement("div");

    item.className =
      `wasalli-toast wasalli-toast-${type}`;

    item.textContent = message;

    host.appendChild(item);

    requestAnimationFrame(() => {
      item.classList.add("show");
    });

    setTimeout(() => {
      item.classList.remove("show");

      setTimeout(
        () => item.remove(),
        300
      );
    }, 3500);
  }

  /* =========================================================
     CONFIRMATION
     ========================================================= */

  function confirmAction(
    message,
    confirmText = "تأكيد"
  ) {
    return new Promise(resolve => {
      openModal(`
        <div class="wasalli-confirm">
          <div class="wasalli-confirm-icon">!</div>

          <h2>تأكيد العملية</h2>

          <p>${escapeHTML(message)}</p>

          <div class="form-actions">
            <button
              type="button"
              class="btn btn-ghost"
              id="cancelConfirmation"
            >
              رجوع
            </button>

            <button
              type="button"
              class="btn btn-danger"
              id="confirmConfirmation"
            >
              ${escapeHTML(confirmText)}
            </button>
          </div>
        </div>
      `);

      $("#cancelConfirmation")
        ?.addEventListener(
          "click",
          () => {
            closeModal();
            resolve(false);
          }
        );

      $("#confirmConfirmation")
        ?.addEventListener(
          "click",
          () => {
            closeModal();
            resolve(true);
          }
        );
    });
  }

  /* =========================================================
     MODAL
     ========================================================= */

  function ensureModal() {
    let modal = $("#dynamicModal");

    if (!modal) {
      modal = document.createElement("div");

      modal.id = "dynamicModal";
      modal.className =
        "wasalli-modal hidden";

      modal.innerHTML = `
        <div
          class="wasalli-modal-backdrop"
          data-close-modal
        ></div>

        <div
          class="wasalli-modal-panel"
          id="dynamicModalContent"
        ></div>
      `;

      document.body.appendChild(modal);
    }

    return modal;
  }

  function openModal(html) {
    const modal = ensureModal();

    const content =
      $("#dynamicModalContent");

    if (content) {
      content.innerHTML = html;
    }

    modal.classList.remove("hidden");

    document.body.classList.add(
      "modal-open"
    );

    state.currentModal = modal;

    bindClose();
  }

  function closeModal() {
    const modal = $("#dynamicModal");

    if (modal) {
      modal.classList.add("hidden");
    }

    document.body.classList.remove(
      "modal-open"
    );

    state.currentModal = null;
  }

  function bindClose() {
    $$(
      "[data-close], [data-close-modal]"
    ).forEach(button => {
      button.onclick = closeModal;
    });
  }

  /* =========================================================
     SIDEBAR
     ========================================================= */

  function openSidebar() {
    $("#sidebar")
      ?.classList.add("open");

    $("#sidebarBackdrop")
      ?.classList.add("show");
  }

  function closeSidebar() {
    $("#sidebar")
      ?.classList.remove("open");

    $("#sidebarBackdrop")
      ?.classList.remove("show");
  }

  /* =========================================================
     DYNAMIC DESIGN
     لا نحتاج تعديل app.css
     ========================================================= */

  function injectWasalliEnhancements() {
    if ($("#wasalliEnhancementStyles")) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "wasalliEnhancementStyles";

    style.textContent = `
      :root {
        --wasalli-purple: #6f35a5;
        --wasalli-purple-dark: #54247f;
        --wasalli-turquoise: #18b7b0;
        --wasalli-bg-soft: #f7f4fb;
        --wasalli-danger: #c62828;
        --wasalli-warning: #ef8c00;
        --wasalli-success: #17874c;
      }

      #toastHost {
        position: fixed;
        top: 18px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 99999;
        width: min(92vw, 430px);
        pointer-events: none;
      }

      .wasalli-toast {
        background: #fff;
        border-radius: 14px;
        padding: 13px 16px;
        margin-bottom: 8px;
        box-shadow: 0 10px 35px rgba(0,0,0,.15);
        transform: translateY(-15px);
        opacity: 0;
        transition: .25s ease;
        border-right: 5px solid var(--wasalli-purple);
        direction: rtl;
      }

      .wasalli-toast.show {
        transform: translateY(0);
        opacity: 1;
      }

      .wasalli-toast-error {
        border-right-color: var(--wasalli-danger);
      }

      .wasalli-toast-warning {
        border-right-color: var(--wasalli-warning);
      }

      .wasalli-modal {
        position: fixed;
        inset: 0;
        z-index: 9000;
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 18px;
      }

      .wasalli-modal.hidden {
        display: none !important;
      }

      .wasalli-modal-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(22,13,31,.56);
        backdrop-filter: blur(3px);
      }

      .wasalli-modal-panel {
        position: relative;
        width: min(96vw, 760px);
        max-height: 92vh;
        overflow: auto;
        background: white;
        border-radius: 24px;
        padding: 22px;
        box-shadow: 0 25px 70px rgba(0,0,0,.25);
        direction: rtl;
      }

      body.modal-open {
        overflow: hidden;
      }

      .wasalli-confirm {
        text-align: center;
        padding: 15px;
      }

      .wasalli-confirm-icon {
        width: 58px;
        height: 58px;
        margin: 0 auto 12px;
        border-radius: 50%;
        background: #fff0f0;
        color: var(--wasalli-danger);
        display: grid;
        place-items: center;
        font-size: 30px;
        font-weight: 900;
      }

      .btn-danger {
        background: var(--wasalli-danger) !important;
        color: #fff !important;
        border-color: var(--wasalli-danger) !important;
      }

      .courier-mobile-shell {
        max-width: 620px;
        margin: 0 auto;
      }

      .courier-shift-card {
        border-radius: 22px;
        padding: 18px;
        margin-bottom: 14px;
        background:
          linear-gradient(
            135deg,
            var(--wasalli-purple),
            var(--wasalli-purple-dark)
          );
        color: white;
        box-shadow: 0 12px 30px rgba(111,53,165,.22);
      }

      .courier-shift-card h2,
      .courier-shift-card p {
        color: inherit;
      }

      .shift-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }

      .shift-status {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 7px 11px;
        border-radius: 999px;
        background: rgba(255,255,255,.17);
        font-size: 13px;
      }

      .shift-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #fff;
      }

      .shift-dot.live {
        background: #4cff9a;
        box-shadow: 0 0 0 5px rgba(76,255,154,.16);
      }

      .courier-primary-action {
        width: 100%;
        min-height: 50px;
        margin-top: 15px;
        border: 0;
        border-radius: 15px;
        font-weight: 800;
        cursor: pointer;
        background: white;
        color: var(--wasalli-purple-dark);
      }

      .courier-availability {
        margin-top: 10px;
        display: flex;
        gap: 8px;
      }

      .courier-availability button {
        flex: 1;
      }

      .courier-stats-grid {
        display: grid;
        grid-template-columns:
          repeat(2, minmax(0,1fr));
        gap: 10px;
        margin: 14px 0;
      }

      .courier-stat {
        background: #fff;
        border-radius: 18px;
        padding: 14px;
        box-shadow: 0 7px 22px rgba(0,0,0,.06);
      }

      .courier-stat strong {
        display: block;
        font-size: 21px;
        margin-top: 5px;
        color: var(--wasalli-purple-dark);
      }

      .offer-card {
        background: #fff;
        border-radius: 22px;
        padding: 18px;
        margin-bottom: 13px;
        border: 2px solid rgba(24,183,176,.38);
        box-shadow: 0 10px 28px rgba(0,0,0,.08);
        animation: offerPulse 1.7s ease-in-out infinite;
      }

      @keyframes offerPulse {
        0%,100% {
          box-shadow: 0 10px 28px rgba(0,0,0,.08);
        }
        50% {
          box-shadow: 0 12px 32px rgba(24,183,176,.24);
        }
      }

      .offer-card h3 {
        margin: 0 0 12px;
      }

      .offer-route {
        display: grid;
        grid-template-columns:
          1fr auto 1fr;
        align-items: center;
        gap: 8px;
        background: var(--wasalli-bg-soft);
        padding: 12px;
        border-radius: 15px;
      }

      .offer-route-arrow {
        color: var(--wasalli-turquoise);
        font-size: 20px;
      }

      .offer-info-grid {
        display: grid;
        grid-template-columns:
          repeat(2,minmax(0,1fr));
        gap: 8px;
        margin-top: 10px;
      }

      .offer-info-box {
        border: 1px solid #eee;
        border-radius: 13px;
        padding: 10px;
      }

      .offer-info-box small {
        display: block;
        opacity: .65;
        margin-bottom: 4px;
      }

      .offer-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 9px;
        margin-top: 13px;
      }

      .offer-accept {
        background: var(--wasalli-turquoise) !important;
        color: #fff !important;
      }

      .current-order-card {
        background: #fff;
        border-radius: 22px;
        padding: 18px;
        margin-bottom: 13px;
        box-shadow: 0 9px 28px rgba(0,0,0,.08);
      }

      .order-action-grid {
        display: grid;
        grid-template-columns:
          repeat(2,minmax(0,1fr));
        gap: 9px;
        margin-top: 12px;
      }

      .order-action-grid .wide {
        grid-column: 1 / -1;
      }

      .action-call {
        background: #188c4d !important;
        color: #fff !important;
      }

      .action-whatsapp {
        background: #25D366 !important;
        color: #fff !important;
      }

      .action-map {
        background: #2677df !important;
        color: #fff !important;
      }

      .late-order-row,
      .late-order-card {
        border: 2px solid rgba(198,40,40,.35) !important;
        background: #fff6f6 !important;
      }

      .wasalli-badge {
        display: inline-flex;
        align-items: center;
        padding: 5px 9px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        background: #eee;
      }

      .badge-new {
        background: #efe4ff;
        color: #62269b;
      }

      .badge-success {
        background: #e1f7eb;
        color: #137a44;
      }

      .badge-warning {
        background: #fff1d7;
        color: #a25c00;
      }

      .badge-danger {
        background: #ffe2e2;
        color: #a91e1e;
      }

      .badge-info {
        background: #ddf8f6;
        color: #087b76;
      }

      .entity-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
      }

      .archive-button {
        background: #fff !important;
        color: var(--wasalli-danger) !important;
        border: 1px solid rgba(198,40,40,.3) !important;
      }

      .financial-summary-grid {
        display: grid;
        grid-template-columns:
          repeat(3,minmax(0,1fr));
        gap: 12px;
      }

      .financial-summary-box {
        background: white;
        border-radius: 18px;
        padding: 16px;
        box-shadow: 0 8px 24px rgba(0,0,0,.06);
      }

      .mobile-section-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        margin: 18px 0 10px;
      }

      .mobile-section-title h2 {
        margin: 0;
        font-size: 18px;
      }

      @media (max-width: 700px) {
        .wasalli-modal {
          padding: 0;
          align-items: flex-end;
        }

        .wasalli-modal-panel {
          width: 100%;
          max-height: 94vh;
          border-radius: 24px 24px 0 0;
          padding: 18px;
        }

        .financial-summary-grid {
          grid-template-columns: 1fr;
        }

        .courier-stats-grid {
          grid-template-columns:
            repeat(2,minmax(0,1fr));
        }

        .offer-info-grid {
          grid-template-columns:
            repeat(2,minmax(0,1fr));
        }

        .offer-actions {
          grid-template-columns: 1fr 1fr;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /* =========================================================
     AUTH SCREEN
     ========================================================= */

  function showAuth() {
    stopRealtime();
    stopOfferSound();
    stopDispatchTimer();
    stopLocationTracking();

    $("#authScreen")
      ?.classList.remove("hidden");

    $("#appScreen")
      ?.classList.add("hidden");

    $("#pendingScreen")
      ?.classList.add("hidden");
  }

  function showPending() {
    $("#authScreen")
      ?.classList.add("hidden");

    $("#appScreen")
      ?.classList.add("hidden");

    $("#pendingScreen")
      ?.classList.remove("hidden");
  }

  function showApp() {
    $("#authScreen")
      ?.classList.add("hidden");

    $("#pendingScreen")
      ?.classList.add("hidden");

    $("#appScreen")
      ?.classList.remove("hidden");
  }

  /* =========================================================
     AUTH
     ========================================================= */
function setAuthMessage(message) {
  const el = document.getElementById("authMessage");
  if (el) {
    el.textContent = message;
  } else {
    console.log(message);
  }
}
async function login(event) {
  event?.preventDefault();

  const input =
    $("#loginIdentifier")?.value?.trim() ||
    $("#loginEmail")?.value?.trim() ||
    $("#loginPhone")?.value?.trim() ||
    "";

  const password =
    $("#loginPassword")?.value || "";

  if (!input || !password) {
    setAuthMessage(
      "اكتب رقم الهاتف أو البريد الإلكتروني وكلمة المرور."
    );
    return;
  }

  let email = "";

  // تسجيل الدخول بالبريد الإلكتروني
  if (input.includes("@")) {
    email = input.toLowerCase();
  }

  // تسجيل الدخول برقم الهاتف
  else {
    const phone = normalizeIraqiPhone(input);

    if (!phone) {
      setAuthMessage(
        "رقم الهاتف غير صحيح. اكتب رقم عراقي صحيح أو استخدم البريد الإلكتروني."
      );
      return;
    }

    email = phoneEmail(phone);
  }

  setAuthMessage("جاري تسجيل الدخول...");

  try {
    const { data, error } =
      await sb.auth.signInWithPassword({
        email,
        password
      });
console.log("LOGIN FINISHED", { data, error });
    if (error) {
      console.error("Login error:", error);

      setAuthMessage(
        "تعذر تسجيل الدخول. تأكد من رقم الهاتف أو البريد الإلكتروني وكلمة المرور."
      );
      return;
    }

    if (!data?.session) {
      setAuthMessage(
        "تعذر إنشاء جلسة تسجيل الدخول."
      );
      return;
    }

    setAuthMessage("");

    await enterSession(data.session);

  } catch (error) {
    console.error(
      "Login exception:",
      error
    );

    setAuthMessage(
      "حدث خطأ أثناء تسجيل الدخول. حاول مرة أخرى."
    );
  }
}
  /* =========================================================
     SIGNUP
     ========================================================= */

  async function signup(event) {
    event?.preventDefault();

    const fullName =
      $("#signupName")?.value?.trim() ||
      "";

    const phone =
      normalizeIraqiPhone(
        $("#signupPhone")?.value || ""
      );

    const password =
      $("#signupPassword")?.value || "";

    const requestedRole =
      $("#signupType")?.value ||
      "courier";

    const area =
      $("#signupArea")?.value ||
      null;

    const address =
      $("#signupAddress")?.value?.trim() ||
      null;

    const vehicleType =
      $("#signupVehicleType")
        ?.value?.trim() ||
      null;

    const vehicleNumber =
      $("#signupVehicleNumber")
        ?.value?.trim() ||
      null;

    const emergencyPhone =
      normalizeIraqiPhone(
        $("#signupEmergencyPhone")
          ?.value || ""
      ) || null;

    if (
      !fullName ||
      !phone ||
      !password
    ) {
      setAuthMessage(
        "أكمل الاسم ورقم الهاتف وكلمة المرور."
      );

      return;
    }

    if (password.length < 6) {
      setAuthMessage(
        "كلمة المرور يجب أن تكون 6 أحرف على الأقل."
      );

      return;
    }

    if (
      !["courier", "shop"].includes(
        requestedRole
      )
    ) {
      setAuthMessage(
        "نوع الحساب غير مسموح حالياً."
      );

      return;
    }

    setAuthMessage(
      "جاري إنشاء الحساب..."
    );

    const email =
      phoneEmail(phone);

    const { data, error } =
      await sb.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            phone,
            requested_role:
              requestedRole
          }
        }
      });

    if (error) {
      console.error(error);

      setAuthMessage(
        "تعذر إنشاء الحساب: " +
          error.message
      );

      return;
    }

    if (!data.user) {
      setAuthMessage(
        "تعذر إنشاء الحساب."
      );
      return;
    }

    const profilePayload = {
      id: data.user.id,
      full_name: fullName,
      phone,
      email,
      role: "pending",
      requested_role: requestedRole,
      is_active: false,
      area,
      address,
      vehicle_type:
        requestedRole === "courier"
          ? vehicleType
          : null,
      vehicle_number:
        requestedRole === "courier"
          ? vehicleNumber
          : null,
      emergency_phone:
        requestedRole === "courier"
          ? emergencyPhone
          : null,
      updated_at:
        new Date().toISOString()
    };

    const { error: profileError } =
      await sb
        .from("profiles")
        .upsert(
          profilePayload,
          { onConflict: "id" }
        );

    if (profileError) {
      console.error(profileError);
    }

    setAuthMessage(
      "تم إنشاء الحساب. بانتظار موافقة الإدارة."
    );

    if (data.session) {
      await enterSession(
        data.session
      );
    }
  }

  function toggleSignupFields() {
    const role =
      $("#signupType")?.value;

    const courierFields =
      $("#courierSignupFields");

    if (courierFields) {
      courierFields.classList.toggle(
        "hidden",
        role !== "courier"
      );
    }
  }

  function populateSignupAreas() {
    const select =
      $("#signupArea");

    if (!select) return;

    if (select.options.length > 1) {
      return;
    }

    const commonAreas = [
      "مركز كربلاء",
      "باب الخان",
      "باب بغداد",
      "باب طويريج",
      "باب القبلة",
      "العباسية",
      "الحر",
      "الحسين",
      "الإسكان",
      "المعلمين",
      "البلدية",
      "الأنصار",
      "الحي الصناعي",
      "سيف سعد",
      "الملحق",
      "الجمعية",
      "العامل",
      "رمضان",
      "الغدير",
      "الوفاء",
      "الانتفاضة",
      "الرسالة",
      "الجامعة"
    ];

    commonAreas.forEach(area => {
      const option =
        document.createElement(
          "option"
        );

      option.value = area;
      option.textContent = area;

      select.appendChild(option);
    });
  }

  /* =========================================================
     SESSION
     ========================================================= */

  async function enterSession(session) {
    state.session = session;

    const { data: profile, error } =
      await sb
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .maybeSingle();

    if (error) {
      console.error(error);

      toast(
        "تعذر تحميل الحساب.",
        "error"
      );

      return;
    }

    if (!profile) {
      toast(
        "ملف الحساب غير موجود.",
        "error"
      );

      await sb.auth.signOut();
      return;
    }

    state.profile = profile;

    if (
      !profile.is_active ||
      profile.role === "pending"
    ) {
      showPending();
      return;
    }

    showApp();

    if (isCourier()) {
      state.page = "dashboard";
    } else if (isAccountant()) {
      state.page = "dashboard";
    } else {
      state.page = "dashboard";
    }

    updateUserHeader();

    renderNavigation();

    await loadAll();

    startRealtime();

    if (isAdminOrOperations()) {
      startDispatchTimer();
    }

    if (
      isCourier() &&
      state.currentCourier?.is_on_shift
    ) {
      startLocationTracking();
    }

    renderPage();
  }

  function updateUserHeader() {
    const name =
      state.profile?.full_name ||
      "مستخدم";

    const role =
      roleLabel(currentRole());

    if ($("#userName")) {
      $("#userName").textContent =
        name;
    }

    if ($("#userRole")) {
      $("#userRole").textContent =
        role;
    }

    if ($("#userAvatar")) {
      $("#userAvatar").textContent =
        name.trim().charAt(0) || "و";
    }
  }

  async function logout() {
    stopRealtime();
    stopOfferSound();
    stopDispatchTimer();
    stopLocationTracking();

    await sb.auth.signOut();

    resetState();

    showAuth();
  }

  function resetState() {
    state.session = null;
    state.profile = null;

    state.page = "dashboard";

    state.orders = [];
    state.shops = [];
    state.couriers = [];
    state.profiles = [];

    state.orderOffers = [];
    state.currentCourier = null;

    state.notifications = [];

    state.financialLedger = [];
    state.courierPayments = [];
    state.expenses = [];

    state.map = null;
    state.mapMarkers = [];
  }

  /* =========================================================
     DATA LOADING
     ========================================================= */

  async function loadAll(showMessage = false) {
    if (!state.profile) return;

    state.loading = true;

    try {
      const jobs = [];

      if (
        isAdmin() ||
        isOperations() ||
        isShop() ||
        isCourier()
      ) {
        jobs.push(loadOrders());
      }

      if (
        isAdminOrOperations() ||
        isShop()
      ) {
        jobs.push(loadShops());
      }

      if (
        isAdminOrOperations()
      ) {
        jobs.push(loadCouriers());
      }

      if (isAdmin()) {
        jobs.push(loadProfiles());
      }

      jobs.push(loadNotifications());

      if (isCourier()) {
        jobs.push(loadCurrentCourier());
        jobs.push(loadCourierOffers());
      }

      if (isFinanceUser()) {
        jobs.push(loadFinanceData());
      }

      await Promise.all(jobs);

      if (showMessage) {
        toast(
          "تم تحديث البيانات."
        );
      }
    } catch (error) {
      console.error(error);

      toast(
        "حدث خطأ أثناء تحديث البيانات.",
        "error"
      );
    } finally {
      state.loading = false;
    }
  }

  async function loadOrders() {
    let query =
      sb
        .from("orders")
        .select("*")
        .order(
          "created_at",
          { ascending: false }
        )
        .limit(500);

    const { data, error } =
      await query;

    if (error) {
      console.error(
        "loadOrders",
        error
      );
      return;
    }

    state.orders = data || [];
  }

  async function loadShops() {
    const { data, error } =
      await sb
        .from("shops")
        .select("*")
        .order("name");

    if (error) {
      console.error(
        "loadShops",
        error
      );
      return;
    }

    state.shops = data || [];
  }

  async function loadCouriers() {
    const { data, error } =
      await sb
        .from("couriers")
        .select("*")
        .order("name");

    if (error) {
      console.error(
        "loadCouriers",
        error
      );
      return;
    }

    state.couriers = data || [];
  }

  async function loadProfiles() {
    const { data, error } =
      await sb
        .from("profiles")
        .select("*")
        .order(
          "created_at",
          { ascending: false }
        );

    if (error) {
      console.error(
        "loadProfiles",
        error
      );
      return;
    }

    state.profiles = data || [];
  }

  async function loadNotifications() {
    let query =
      sb
        .from("notifications")
        .select("*")
        .order(
          "created_at",
          { ascending: false }
        )
        .limit(100);

    const { data, error } =
      await query;

    if (error) {
      console.error(
        "loadNotifications",
        error
      );
      return;
    }

    const role = currentRole();

    state.notifications =
      (data || []).filter(item => {
        if (item.user_id) {
          return (
            item.user_id ===
            state.session?.user?.id
          );
        }

        if (item.target_role) {
          return (
            item.target_role === role
          );
        }

        return isAdmin();
      });

    updateNotificationBadge();
  }

  async function loadCurrentCourier() {
    if (!isCourier()) {
      state.currentCourier = null;
      return;
    }

    let courier = null;

    if (state.profile?.courier_id) {
      const { data, error } =
        await sb
          .from("couriers")
          .select("*")
          .eq(
            "id",
            state.profile.courier_id
          )
          .maybeSingle();

      if (!error) {
        courier = data;
      }
    }

    if (!courier) {
      const { data, error } =
        await sb
          .from("couriers")
          .select("*")
          .eq(
            "user_id",
            state.session.user.id
          )
          .maybeSingle();

      if (!error) {
        courier = data;
      }
    }

    state.currentCourier =
      courier || null;
  }

  async function loadCourierOffers() {
    if (!isCourier()) {
      state.orderOffers = [];
      return;
    }

    if (!state.currentCourier) {
      await loadCurrentCourier();
    }

    if (!state.currentCourier) {
      state.orderOffers = [];
      return;
    }

    const { data, error } =
      await sb
        .from("order_offers")
        .select(`
          id,
          order_id,
          courier_id,
          offer_stage,
          status,
          offered_at,
          responded_at,
          rejection_reason,
          rejection_note,
          expires_at,
          expanded_at
        `)
        .eq(
          "courier_id",
          state.currentCourier.id
        )
        .eq("status", "offered")
        .order(
          "offered_at",
          { ascending: false }
        );

    if (error) {
      console.error(
        "loadCourierOffers",
        error
      );

      state.orderOffers = [];
      return;
    }

    state.orderOffers =
      data || [];

    syncOfferSound();
  }

  async function loadFinanceData() {
    if (!isFinanceUser()) {
      return;
    }

    const [
      ledgerResult,
      paymentResult,
      expenseResult
    ] = await Promise.all([
      sb
        .from(
          "wasalli_financial_ledger"
        )
        .select("*")
        .order(
          "created_at",
          { ascending: false }
        )
        .limit(1000),

      sb
        .from(
          "wasalli_courier_payments"
        )
        .select("*")
        .order(
          "created_at",
          { ascending: false }
        )
        .limit(500),

      sb
        .from("wasalli_expenses")
        .select("*")
        .order(
          "created_at",
          { ascending: false }
        )
        .limit(500)
    ]);

    if (!ledgerResult.error) {
      state.financialLedger =
        ledgerResult.data || [];
    }

    if (!paymentResult.error) {
      state.courierPayments =
        paymentResult.data || [];
    }

    if (!expenseResult.error) {
      state.expenses =
        expenseResult.data || [];
    }
  }

  /* =========================================================
     NOTIFICATION BADGE
     ========================================================= */

  function updateNotificationBadge() {
    const unread =
      state.notifications.filter(
        item => !item.is_read
      ).length;

    const badge =
      $("#notificationBadge");

    if (!badge) return;

    badge.textContent =
      unread > 99
        ? "99+"
        : String(unread);

    badge.classList.toggle(
      "hidden",
      unread === 0
    );
  }

  /* =========================================================
     ORDER HELPERS
     ========================================================= */

  function getShop(order) {
    if (!order) return null;

    return (
      state.shops.find(
        shop =>
          String(shop.id) ===
          String(order.shop_id)
      ) || null
    );
  }

  function getCourier(order) {
    if (!order) return null;

    return (
      state.couriers.find(
        courier =>
          String(courier.id) ===
          String(order.courier_id)
      ) || null
    );
  }

  function orderShopName(order) {
    return (
      getShop(order)?.name ||
      order?.shop ||
      "غير محدد"
    );
  }

  function orderCourierName(order) {
    return (
      getCourier(order)?.name ||
      order?.courier ||
      "غير مسند"
    );
  }

  function orderCustomerName(order) {
    return (
      order?.customer_name ||
      order?.customer ||
      "زبون"
    );
  }

  function orderCustomerPhone(order) {
    return (
      order?.customer_phone ||
      order?.phone ||
      ""
    );
  }

  function orderAddress(order) {
    return (
      order?.detailed_address ||
      order?.delivery_address ||
      order?.address ||
      ""
    );
  }

  function orderDeliveryFee(order) {
    return safeNumber(
      order?.delivery_fee ??
      order?.fee ??
      DEFAULT_DELIVERY_FEE
    );
  }

  function orderPaymentMode(order) {
    return (
      order?.payment_mode ||
      order?.payment_method ||
      "cash"
    );
  }

  function orderDeliveryPayer(order) {
    return (
      order?.delivery_fee_payer ||
      order?.delivery_payer ||
      "customer"
    );
  }

  function orderPickupLat(order) {
    return (
      order?.pickup_lat ??
      order?.pickup_latitude ??
      getShop(order)?.lat ??
      getShop(order)?.latitude ??
      null
    );
  }

  function orderPickupLng(order) {
    return (
      order?.pickup_lng ??
      order?.pickup_longitude ??
      getShop(order)?.lng ??
      getShop(order)?.longitude ??
      null
    );
  }

  function orderCustomerLat(order) {
    return (
      order?.customer_lat ??
      order?.latitude ??
      null
    );
  }

  function orderCustomerLng(order) {
    return (
      order?.customer_lng ??
      order?.longitude ??
      null
    );
  }

  function isLateOrder(order) {
    if (
      !order ||
      order.status !== "new" ||
      order.courier_id
    ) {
      return false;
    }

    const created =
      new Date(
        order.dispatch_started_at ||
        order.created_at
      ).getTime();

    if (!Number.isFinite(created)) {
      return false;
    }

    return (
      Date.now() - created >=
      LATE_ORDER_MINUTES *
        60 *
        1000
    );
  }

  function courierAssignedOrders() {
    if (!state.currentCourier) {
      return [];
    }

    return state.orders.filter(
      order =>
        String(order.courier_id) ===
          String(
            state.currentCourier.id
          )
    );
  }

  function courierActiveOrders() {
    return courierAssignedOrders()
      .filter(order =>
        ACTIVE_ORDER_STATUSES.includes(
          order.status
        )
      );
  }

  function todayStart() {
    const date = new Date();

    date.setHours(
      0,
      0,
      0,
      0
    );

    return date;
  }

  function isToday(value) {
    if (!value) return false;

    return (
      new Date(value).getTime() >=
      todayStart().getTime()
    );
  }

  function courierTodayOrders() {
    return courierAssignedOrders()
      .filter(order =>
        isToday(order.created_at)
      );
  }

  function courierTodayEarnings() {
    return courierTodayOrders()
      .filter(order =>
        ["delivered", "returned"]
          .includes(order.status)
      )
      .reduce(
        (total, order) =>
          total +
          orderDeliveryFee(order) *
            (COURIER_PERCENT / 100),
        0
      );
  }

  function calculateAmountToCollect(order) {
    if (!order) return 0;

    if (
      safeNumber(
        order.courier_collection_amount
      ) > 0
    ) {
      return safeNumber(
        order.courier_collection_amount
      );
    }

    if (
      safeNumber(
        order.amount_to_collect
      ) > 0
    ) {
      return safeNumber(
        order.amount_to_collect
      );
    }

    const goods =
      safeNumber(order.goods_value);

    const delivery =
      orderDeliveryFee(order);

    const mode =
      orderPaymentMode(order);

    const payer =
      orderDeliveryPayer(order);

    if (
      mode === "prepaid" ||
      mode === "electronic"
    ) {
      return 0;
    }

    if (payer === "shop") {
      return goods;
    }

    if (payer === "customer") {
      return goods + delivery;
    }

    return goods + delivery;
  }

  function courierCashLiability() {
    return courierAssignedOrders()
      .filter(order =>
        ["delivered", "returned"]
          .includes(order.status)
      )
      .reduce(
        (total, order) =>
          total +
          safeNumber(
            order.courier_collection_amount ||
            order.amount_to_collect ||
            calculateAmountToCollect(order)
          ),
        0
      );
  }

  /* =========================================================
     STATUS BADGES
     ========================================================= */

  function statusBadge(status) {
    let cls = "badge-info";

    if (status === "new") {
      cls = "badge-new";
    }

    if (
      status === "delivered"
    ) {
      cls = "badge-success";
    }

    if (
      status === "returned"
    ) {
      cls = "badge-warning";
    }

    if (
      status === "cancelled"
    ) {
      cls = "badge-danger";
    }

    return `
      <span
        class="wasalli-badge ${cls}"
      >
        ${escapeHTML(
          statusLabel(status)
        )}
      </span>
    `;
  }

  /* =========================================================
     REALTIME
     ========================================================= */

  function stopRealtime() {
    if (state.realtimeChannel) {
      try {
        sb.removeChannel(
          state.realtimeChannel
        );
      } catch (error) {
        console.warn(error);
      }
    }

    state.realtimeChannel = null;
  }

  function startRealtime() {
    stopRealtime();

    if (!state.session) return;

    const channel =
      sb.channel(
        "wasalli-live-" +
        state.session.user.id
      );

    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "orders"
      },
      async payload => {
        await loadOrders();

        if (
          isCourier() &&
          payload.eventType === "UPDATE"
        ) {
          await loadCourierOffers();
        }

        renderPage();
      }
    );

    if (isCourier()) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_offers",
          filter:
            `courier_id=eq.${state.currentCourier?.id || ""}`
        },
        async () => {
          const previous =
            state.orderOffers.length;

          await loadCourierOffers();

          if (
            state.orderOffers.length >
            previous
          ) {
            playOfferTone();
            toast(
              "عندك عرض توصيل جديد.",
              "success"
            );
          }

          renderPage();
        }
      );
    }

    channel.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications"
      },
      async () => {
        await loadNotifications();
      }
    );

    state.realtimeChannel =
      channel.subscribe();
  }

  /* =========================================================
     OFFER SOUND
     ========================================================= */

  function playOfferTone() {
    try {
      const audio =
        $("#notificationSound");

      if (audio) {
        audio.currentTime = 0;

        audio.play().catch(
          () => synthOfferTone()
        );

        return;
      }

      synthOfferTone();
    } catch {
      synthOfferTone();
    }
  }

  function synthOfferTone() {
    try {
      const AudioContext =
        window.AudioContext ||
        window.webkitAudioContext;

      if (!AudioContext) return;

      const ctx =
        new AudioContext();

      const oscillator =
        ctx.createOscillator();

      const gain =
        ctx.createGain();

      oscillator.type = "sine";
      oscillator.frequency.value =
        740;

      gain.gain.setValueAtTime(
        0.0001,
        ctx.currentTime
      );

      gain.gain.exponentialRampToValueAtTime(
        0.18,
        ctx.currentTime + 0.02
      );

      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + 0.45
      );

      oscillator.connect(gain);
      gain.connect(ctx.destination);

      oscillator.start();

      oscillator.stop(
        ctx.currentTime + 0.48
      );
    } catch {
      // تجاهل خطأ الصوت
    }
  }

  function startOfferSound() {
    if (state.offerSoundTimer) {
      return;
    }

    playOfferTone();

    state.offerSoundTimer =
      setInterval(
        () => {
          if (
            state.orderOffers.length
          ) {
            playOfferTone();
          } else {
            stopOfferSound();
          }
        },
        4500
      );
  }

  function stopOfferSound() {
    if (state.offerSoundTimer) {
      clearInterval(
        state.offerSoundTimer
      );
    }

    state.offerSoundTimer = null;
  }

  function syncOfferSound() {
    if (
      isCourier() &&
      state.orderOffers.length > 0
    ) {
      startOfferSound();
    } else {
      stopOfferSound();
    }
  }

  /* =========================================================
     DISPATCH TIMER
     ========================================================= */

  function startDispatchTimer() {
    stopDispatchTimer();

    runDispatchTick();

    state.dispatchTimer =
      setInterval(
        runDispatchTick,
        15000
      );
  }

  function stopDispatchTimer() {
    if (state.dispatchTimer) {
      clearInterval(
        state.dispatchTimer
      );
    }

    state.dispatchTimer = null;
  }

  async function runDispatchTick() {
    if (!isAdminOrOperations()) {
      return;
    }

    try {
      await Promise.all([
        sb.rpc(
          "wasalli_expand_dispatch"
        ),
        sb.rpc(
          "wasalli_check_late_orders"
        )
      ]);
    } catch (error) {
      console.warn(
        "Dispatch tick:",
        error
      );
    }
  }

  /* =========================================================
     COURIER LOCATION
     ========================================================= */

  function getCurrentPosition() {
    return new Promise(
      (resolve, reject) => {
        if (!navigator.geolocation) {
          reject(
            new Error(
              "الموقع غير مدعوم على هذا الجهاز."
            )
          );
          return;
        }

        navigator.geolocation
          .getCurrentPosition(
            resolve,
            reject,
            {
              enableHighAccuracy: true,
              timeout: 15000,
              maximumAge: 10000
            }
          );
      }
    );
  }

  function startLocationTracking() {
    stopLocationTracking();

    if (
      !isCourier() ||
      !state.currentCourier?.is_on_shift
    ) {
      return;
    }

    if (!navigator.geolocation) {
      toast(
        "المتصفح لا يدعم تحديد الموقع.",
        "warning"
      );
      return;
    }

    state.locationWatchId =
      navigator.geolocation.watchPosition(
        async position => {
          const {
            latitude,
            longitude,
            accuracy
          } = position.coords;

          const { error } =
            await sb.rpc(
              "wasalli_update_location",
              {
                p_latitude:
                  latitude,
                p_longitude:
                  longitude,
                p_accuracy:
                  accuracy || null
              }
            );

          if (error) {
            console.warn(
              "Location update:",
              error
            );
          } else if (
            state.currentCourier
          ) {
            state.currentCourier.latitude =
              latitude;

            state.currentCourier.longitude =
              longitude;

            state.currentCourier.last_location_at =
              new Date().toISOString();
          }
        },
        error => {
          console.warn(
            "Location watch:",
            error
          );
        },
        {
          enableHighAccuracy: true,
          maximumAge: 15000,
          timeout: 20000
        }
      );
  }

  function stopLocationTracking() {
    if (
      state.locationWatchId !== null &&
      navigator.geolocation
    ) {
      navigator.geolocation
        .clearWatch(
          state.locationWatchId
        );
    }

    state.locationWatchId = null;
  }

  /* =========================================================
     COURIER SHIFT ACTIONS
     ========================================================= */

  async function startCourierShift() {
    try {
      let lat = null;
      let lng = null;

      try {
        const position =
          await getCurrentPosition();

        lat =
          position.coords.latitude;

        lng =
          position.coords.longitude;
      } catch (error) {
        console.warn(error);

        const proceed =
          await confirmAction(
            "تعذر الحصول على موقعك. هل تريد بدء الدوام بدون إرسال الموقع الأولي؟",
            "بدء الدوام"
          );

        if (!proceed) {
          return;
        }
      }

      const { error } =
        await sb.rpc(
          "wasalli_start_shift",
          {
            p_latitude: lat,
            p_longitude: lng
          }
        );

      if (error) {
        throw error;
      }

      await loadCurrentCourier();
      await loadCourierOffers();

      startLocationTracking();

      renderPage();

      toast(
        "تم بدء الدوام وأصبحت متاحاً للطلبات."
      );
    } catch (error) {
      console.error(error);

      toast(
        "تعذر بدء الدوام: " +
          error.message,
        "error"
      );
    }
  }

  async function endCourierShift() {
    const confirmed =
      await confirmAction(
        "إنهاء الدوام سيوقف استقبال الطلبات ومشاركة الموقع.",
        "إنهاء الدوام"
      );

    if (!confirmed) return;

    try {
      let lat = null;
      let lng = null;

      try {
        const position =
          await getCurrentPosition();

        lat =
          position.coords.latitude;

        lng =
          position.coords.longitude;
      } catch {
        // يمكن إنهاء الدوام بدون GPS
      }

      const { error } =
        await sb.rpc(
          "wasalli_end_shift",
          {
            p_latitude: lat,
            p_longitude: lng
          }
        );

      if (error) {
        throw error;
      }

      stopLocationTracking();
      stopOfferSound();

      await loadCurrentCourier();
      await loadCourierOffers();

      renderPage();

      toast("تم إنهاء الدوام.");
    } catch (error) {
      console.error(error);

      toast(
        "تعذر إنهاء الدوام: " +
          error.message,
        "error"
      );
    }
  }

  async function setCourierAvailability(
    available
  ) {
    try {
      const { error } =
        await sb.rpc(
          "wasalli_set_availability",
          {
            p_available:
              Boolean(available)
          }
        );

      if (error) {
        throw error;
      }

      await loadCurrentCourier();
      await loadCourierOffers();

      renderPage();

      toast(
        available
          ? "أصبحت متاحاً لاستقبال الطلبات."
          : "تم إيقاف استقبال الطلبات مؤقتاً."
      );
    } catch (error) {
      console.error(error);

      toast(
        error.message ||
          "تعذر تغيير حالة التوفر.",
        "error"
      );
    }
  }

  /* =========================================================
     PAGE ROUTER
     ========================================================= */

  function renderPage() {
    if (
      !state.profile ||
      !isActiveProfile()
    ) {
      return;
    }

    renderNavigation();

    switch (state.page) {
      case "dashboard":
        renderDashboard();
        break;

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
        state.page = "dashboard";
        renderDashboard();
        break;
    }
  }

  /* =========================================================
     DASHBOARD ROUTER
     ========================================================= */

  function renderDashboard() {
    if (isCourier()) {
      renderCourierDashboard();
      return;
    }

    if (isAccountant()) {
      renderFinanceDashboard();
      return;
    }

    if (isShop()) {
      renderShopDashboard();
      return;
    }

    renderManagementDashboard();
  }
    /* =========================================================
     MANAGEMENT DASHBOARD
     ========================================================= */

  function renderManagementDashboard() {
    if (!isAdminOrOperations()) {
      state.page = "dashboard";
      renderDashboard();
      return;
    }

    setTitle(
      isAdmin()
        ? "لوحة التحكم"
        : "لوحة العمليات",
      "نظرة مباشرة على عمليات وصلّي"
    );

    const totalOrders =
      state.orders.length;

    const newOrders =
      state.orders.filter(
        order => order.status === "new"
      ).length;

    const activeOrders =
      state.orders.filter(order =>
        ACTIVE_ORDER_STATUSES.includes(
          order.status
        )
      ).length;

    const deliveredToday =
      state.orders.filter(
        order =>
          order.status === "delivered" &&
          isToday(order.delivered_at)
      ).length;

    const returnedToday =
      state.orders.filter(
        order =>
          order.status === "returned" &&
          isToday(
            order.returned_at ||
            order.updated_at
          )
      ).length;

    const lateOrders =
      state.orders.filter(
        isLateOrder
      );

    const availableCouriers =
      state.couriers.filter(
        courier =>
          courier.is_active !== false &&
          !courier.archived_at &&
          courier.is_on_shift &&
          (
            courier.status ===
              "available" ||
            courier.is_available === true
          )
      ).length;

    const onShiftCouriers =
      state.couriers.filter(
        courier =>
          courier.is_active !== false &&
          !courier.archived_at &&
          courier.is_on_shift
      ).length;

    const content = $("#content");

    if (!content) return;

    content.innerHTML = `
      <div class="stats-grid">
        ${dashboardStat(
          "📦",
          "إجمالي الطلبات",
          totalOrders
        )}

        ${dashboardStat(
          "🆕",
          "طلبات جديدة",
          newOrders
        )}

        ${dashboardStat(
          "🛵",
          "طلبات نشطة",
          activeOrders
        )}

        ${dashboardStat(
          "✅",
          "تسليم اليوم",
          deliveredToday
        )}

        ${dashboardStat(
          "↩️",
          "راجع اليوم",
          returnedToday
        )}

        ${dashboardStat(
          "📍",
          "مندوبون بالدوام",
          onShiftCouriers
        )}

        ${dashboardStat(
          "🟢",
          "متاحون الآن",
          availableCouriers
        )}

        ${dashboardStat(
          "⚠️",
          "طلبات متأخرة",
          lateOrders.length,
          lateOrders.length
            ? "danger"
            : ""
        )}
      </div>

      ${
        lateOrders.length
          ? `
            <div class="card late-order-card">
              <div class="card-header">
                <div>
                  <h2>⚠️ طلبات تحتاج تدخل</h2>
                  <p>
                    لم يقبلها أي مندوب منذ أكثر من
                    ${LATE_ORDER_MINUTES}
                    دقائق
                  </p>
                </div>

                <button
                  class="btn btn-primary"
                  id="viewLateOrders"
                >
                  عرض الطلبات
                </button>
              </div>

              <div class="simple-list">
                ${lateOrders
                  .slice(0, 8)
                  .map(
                    order => `
                      <button
                        type="button"
                        class="simple-list-item"
                        data-open-order="${order.id}"
                      >
                        <strong>
                          ${escapeHTML(
                            orderCode(order)
                          )}
                        </strong>

                        <span>
                          ${escapeHTML(
                            orderShopName(order)
                          )}
                          ←
                          ${escapeHTML(
                            order.delivery_area ||
                            orderAddress(order) ||
                            "غير محدد"
                          )}
                        </span>

                        <span>
                          ${dateTime(
                            order.created_at
                          )}
                        </span>
                      </button>
                    `
                  )
                  .join("")}
              </div>
            </div>
          `
          : ""
      }

      <div class="card">
        <div class="card-header">
          <div>
            <h2>آخر الطلبات</h2>
            <p>
              أحدث حركة تشغيلية في وصلّي
            </p>
          </div>

          <button
            class="btn btn-primary"
            id="dashboardNewOrder"
          >
            + طلب جديد
          </button>
        </div>

        ${managementOrdersTable(
          state.orders.slice(0, 12)
        )}
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2>حالة المندوبين</h2>
            <p>
              الدوام والتوفر والطلبات النشطة
            </p>
          </div>

          <button
            class="btn btn-ghost"
            id="dashboardCouriers"
          >
            كل المندوبين
          </button>
        </div>

        <div class="courier-overview-grid">
          ${state.couriers
            .filter(
              courier =>
                courier.is_active !== false &&
                !courier.archived_at
            )
            .slice(0, 12)
            .map(courierOverviewCard)
            .join("") ||
            `
              <div class="empty-state">
                لا يوجد مندوبون.
              </div>
            `}
        </div>
      </div>
    `;

    $("#dashboardNewOrder")
      ?.addEventListener(
        "click",
        openNewOrderModal
      );

    $("#viewLateOrders")
      ?.addEventListener(
        "click",
        () => {
          state.page = "orders";
          renderPage();
        }
      );

    $("#dashboardCouriers")
      ?.addEventListener(
        "click",
        () => {
          state.page = "couriers";
          renderPage();
        }
      );

    bindOrderOpenButtons();
  }

  function dashboardStat(
    icon,
    label,
    value,
    type = ""
  ) {
    return `
      <div class="stat-card ${
        type
          ? `stat-${type}`
          : ""
      }">
        <div class="stat-icon">
          ${icon}
        </div>

        <div>
          <span>${escapeHTML(label)}</span>
          <strong>
            ${escapeHTML(value)}
          </strong>
        </div>
      </div>
    `;
  }

  function courierOverviewCard(
    courier
  ) {
    const active =
      state.orders.filter(
        order =>
          String(order.courier_id) ===
            String(courier.id) &&
          ACTIVE_ORDER_STATUSES.includes(
            order.status
          )
      ).length;

    const available =
      courier.is_on_shift &&
      (
        courier.status ===
          "available" ||
        courier.is_available === true
      );

    return `
      <div class="courier-overview-card">
        <div class="courier-overview-head">
          <div>
            <strong>
              ${escapeHTML(
                courier.name ||
                "مندوب"
              )}
            </strong>

            <small>
              ${escapeHTML(
                courier.area ||
                "كربلاء"
              )}
            </small>
          </div>

          <span
            class="wasalli-badge ${
              available
                ? "badge-success"
                : courier.is_on_shift
                  ? "badge-warning"
                  : ""
            }"
          >
            ${
              available
                ? "متاح"
                : courier.is_on_shift
                  ? "غير متاح"
                  : "خارج الدوام"
            }
          </span>
        </div>

        <div class="courier-overview-footer">
          <span>
            طلبات نشطة:
            <strong>${active}</strong>
          </span>

          ${
            courier.last_location_at
              ? `
                <span>
                  آخر موقع:
                  ${shortTime(
                    courier.last_location_at
                  )}
                </span>
              `
              : ""
          }
        </div>
      </div>
    `;
  }

  /* =========================================================
     SHOP DASHBOARD
     ========================================================= */

  function renderShopDashboard() {
    setTitle(
      "لوحة المحل",
      "طلبات المحل وحالته المالية"
    );

    const orders =
      state.orders || [];

    const today =
      orders.filter(order =>
        isToday(order.created_at)
      );

    const active =
      orders.filter(order =>
        [
          "new",
          ...ACTIVE_ORDER_STATUSES
        ].includes(order.status)
      );

    const delivered =
      orders.filter(
        order =>
          order.status === "delivered"
      );

    const returned =
      orders.filter(
        order =>
          order.status === "returned"
      );

    const content = $("#content");

    if (!content) return;

    content.innerHTML = `
      <div class="stats-grid">
        ${dashboardStat(
          "📦",
          "طلبات اليوم",
          today.length
        )}

        ${dashboardStat(
          "🛵",
          "قيد التنفيذ",
          active.length
        )}

        ${dashboardStat(
          "✅",
          "تم التسليم",
          delivered.length
        )}

        ${dashboardStat(
          "↩️",
          "راجع",
          returned.length
        )}
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2>الطلبات الأخيرة</h2>
            <p>
              آخر طلبات المحل
            </p>
          </div>

          <button
            class="btn btn-primary"
            id="shopNewOrder"
          >
            + طلب جديد
          </button>
        </div>

        ${shopOrdersList(
          orders.slice(0, 15)
        )}
      </div>
    `;

    $("#shopNewOrder")
      ?.addEventListener(
        "click",
        openNewOrderModal
      );

    bindOrderOpenButtons();
  }

  /* =========================================================
     COURIER DASHBOARD
     ========================================================= */

  function renderCourierDashboard() {
    setTitle(
      "وصلّي",
      "واجهة المندوب"
    );

    const courier =
      state.currentCourier;

    const content = $("#content");

    if (!content) return;

    if (!courier) {
      content.innerHTML = `
        <div class="card">
          <div class="empty-state">
            حسابك غير مربوط بسجل مندوب.
            تواصل مع الإدارة.
          </div>
        </div>
      `;
      return;
    }

    const assigned =
      courierAssignedOrders();

    const active =
      courierActiveOrders();

    const today =
      courierTodayOrders();

    const deliveredToday =
      today.filter(
        order =>
          order.status ===
          "delivered"
      ).length;

    const returnedToday =
      today.filter(
        order =>
          order.status ===
          "returned"
      ).length;

    const earnings =
      courierTodayEarnings();

    const cash =
      courierCashLiability();

    const onShift =
      Boolean(courier.is_on_shift);

    const available =
      onShift &&
      (
        courier.status ===
          "available" ||
        courier.is_available === true
      );

    content.innerHTML = `
      <div class="courier-mobile-shell">

        <section class="courier-shift-card">
          <div class="shift-top">
            <div>
              <small>حالة الدوام</small>

              <h2>
                ${
                  onShift
                    ? "أنت بالدوام"
                    : "خارج الدوام"
                }
              </h2>
            </div>

            <span class="shift-status">
              <span
                class="shift-dot ${
                  onShift
                    ? "live"
                    : ""
                }"
              ></span>

              ${
                onShift
                  ? available
                    ? "متاح"
                    : "متوقف مؤقتاً"
                  : "متوقف"
              }
            </span>
          </div>

          ${
            onShift
              ? `
                <button
                  type="button"
                  class="courier-primary-action"
                  id="endShiftBtn"
                >
                  إنهاء الدوام
                </button>

                <div class="courier-availability">
                  <button
                    type="button"
                    class="btn ${
                      available
                        ? "btn-primary"
                        : "btn-ghost"
                    }"
                    id="makeAvailableBtn"
                  >
                    🟢 متاح
                  </button>

                  <button
                    type="button"
                    class="btn ${
                      !available
                        ? "btn-primary"
                        : "btn-ghost"
                    }"
                    id="makeUnavailableBtn"
                  >
                    ⏸ غير متاح
                  </button>
                </div>
              `
              : `
                <button
                  type="button"
                  class="courier-primary-action"
                  id="startShiftBtn"
                >
                  بدء الدوام
                </button>
              `
          }

          ${
            courier.last_location_at
              ? `
                <small
                  style="
                    display:block;
                    margin-top:10px;
                    opacity:.82
                  "
                >
                  آخر تحديث للموقع:
                  ${dateTime(
                    courier.last_location_at
                  )}
                </small>
              `
              : ""
          }
        </section>

        <div class="courier-stats-grid">
          <div class="courier-stat">
            <span>طلبات اليوم</span>
            <strong>${today.length}</strong>
          </div>

          <div class="courier-stat">
            <span>طلبات نشطة</span>
            <strong>${active.length}</strong>
          </div>

          <div class="courier-stat">
            <span>تم التسليم</span>
            <strong>${deliveredToday}</strong>
          </div>

          <div class="courier-stat">
            <span>راجع</span>
            <strong>${returnedToday}</strong>
          </div>

          <div class="courier-stat">
            <span>أرباح اليوم</span>
            <strong>
              ${money(earnings)}
            </strong>
          </div>

          <div class="courier-stat">
            <span>الكاش بالعهدة</span>
            <strong>
              ${money(cash)}
            </strong>
          </div>
        </div>

        ${
          state.orderOffers.length
            ? `
              <div class="mobile-section-title">
                <h2>
                  🔔 طلبات جديدة
                </h2>

                <span
                  class="wasalli-badge badge-info"
                >
                  ${state.orderOffers.length}
                </span>
              </div>

              <div id="courierOffersList">
                ${state.orderOffers
                  .map(renderCourierOfferCard)
                  .join("")}
              </div>
            `
            : `
              <div class="card">
                <div class="empty-state">
                  ${
                    !onShift
                      ? "ابدأ الدوام حتى تستقبل الطلبات."
                      : !available
                        ? "أنت غير متاح حالياً. فعّل التوفر لاستقبال الطلبات."
                        : "لا توجد عروض توصيل جديدة حالياً."
                  }
                </div>
              </div>
            `
        }

        ${
          active.length
            ? `
              <div class="mobile-section-title">
                <h2>
                  طلبي الحالي
                </h2>

                <span
                  class="wasalli-badge badge-success"
                >
                  ${active.length}
                </span>
              </div>

              ${active
                .map(
                  renderCourierCurrentOrderCard
                )
                .join("")}
            `
            : ""
        }

        <div class="mobile-section-title">
          <h2>آخر طلباتي</h2>
        </div>

        ${
          assigned.length
            ? assigned
                .filter(
                  order =>
                    !ACTIVE_ORDER_STATUSES.includes(
                      order.status
                    )
                )
                .slice(0, 10)
                .map(
                  renderCourierHistoryCard
                )
                .join("") ||
              `
                <div class="card">
                  <div class="empty-state">
                    لا توجد طلبات مكتملة بعد.
                  </div>
                </div>
              `
            : `
              <div class="card">
                <div class="empty-state">
                  لا توجد طلبات مسندة إليك بعد.
                </div>
              </div>
            `
        }
      </div>
    `;

    $("#startShiftBtn")
      ?.addEventListener(
        "click",
        startCourierShift
      );

    $("#endShiftBtn")
      ?.addEventListener(
        "click",
        endCourierShift
      );

    $("#makeAvailableBtn")
      ?.addEventListener(
        "click",
        () =>
          setCourierAvailability(true)
      );

    $("#makeUnavailableBtn")
      ?.addEventListener(
        "click",
        () =>
          setCourierAvailability(false)
      );

    bindCourierOfferActions();
    bindCourierOrderActions();
  }

  /* =========================================================
     COURIER OFFER CARD
     ========================================================= */

  function renderCourierOfferCard(
    offer
  ) {
    /*
      قبل قبول الطلب لا نعرض:
      - اسم الزبون
      - الهاتف
      - العنوان التفصيلي
      - GPS

      نحاول استخدام بيانات الطلب الموجودة محلياً فقط
      للحصول على الملخص الآمن.
    */

    const order =
      state.orders.find(
        item =>
          String(item.id) ===
          String(offer.order_id)
      );

    const pickup =
      order?.pickup_area ||
      orderShopName(order) ||
      "منطقة الاستلام";

    const delivery =
      order?.delivery_area ||
      "منطقة التوصيل";

    const fee =
      order
        ? orderDeliveryFee(order)
        : DEFAULT_DELIVERY_FEE;

    const payment =
      order
        ? paymentLabel(
            orderPaymentMode(order)
          )
        : "—";

    const payer =
      order
        ? payerLabel(
            orderDeliveryPayer(order)
          )
        : "—";

    return `
      <article
        class="offer-card"
        data-offer-card="${offer.id}"
      >
        <div
          style="
            display:flex;
            justify-content:space-between;
            gap:10px;
            align-items:center;
          "
        >
          <div>
            <small>
              عرض توصيل جديد
            </small>

            <h3>
              ${
                order
                  ? escapeHTML(
                      orderCode(order)
                    )
                  : "طلب توصيل"
              }
            </h3>
          </div>

          <span
            class="wasalli-badge badge-info"
          >
            مرحلة
            ${safeNumber(
              offer.offer_stage
            ) || 1}
          </span>
        </div>

        <div class="offer-route">
          <div>
            <small>الاستلام</small>
            <strong>
              ${escapeHTML(pickup)}
            </strong>
          </div>

          <div class="offer-route-arrow">
            ←
          </div>

          <div>
            <small>التوصيل</small>
            <strong>
              ${escapeHTML(delivery)}
            </strong>
          </div>
        </div>

        <div class="offer-info-grid">
          <div class="offer-info-box">
            <small>أجرة التوصيل</small>
            <strong>
              ${money(fee)}
            </strong>
          </div>

          <div class="offer-info-box">
            <small>طريقة الدفع</small>
            <strong>
              ${escapeHTML(payment)}
            </strong>
          </div>

          <div class="offer-info-box">
            <small>أجرة التوصيل على</small>
            <strong>
              ${escapeHTML(payer)}
            </strong>
          </div>

          <div class="offer-info-box">
            <small>وقت العرض</small>
            <strong>
              ${shortTime(
                offer.offered_at
              )}
            </strong>
          </div>
        </div>

        <div class="offer-actions">
          <button
            type="button"
            class="btn offer-accept"
            data-accept-offer="${offer.id}"
          >
            ✓ قبول الطلب
          </button>

          <button
            type="button"
            class="btn btn-ghost"
            data-reject-offer="${offer.id}"
          >
            رفض
          </button>
        </div>
      </article>
    `;
  }

  function bindCourierOfferActions() {
    $$("[data-accept-offer]")
      .forEach(button => {
        button.addEventListener(
          "click",
          () =>
            acceptCourierOffer(
              button.dataset
                .acceptOffer
            )
        );
      });

    $$("[data-reject-offer]")
      .forEach(button => {
        button.addEventListener(
          "click",
          () =>
            openRejectOfferModal(
              button.dataset
                .rejectOffer
            )
        );
      });
  }

  async function acceptCourierOffer(
    offerId
  ) {
    const button =
      document.querySelector(
        `[data-accept-offer="${CSS.escape(
          String(offerId)
        )}"]`
      );

    if (button) {
      button.disabled = true;
      button.textContent =
        "جاري القبول...";
    }

    try {
      const { data, error } =
        await sb.rpc(
          "wasalli_accept_offer",
          {
            p_offer_id: offerId
          }
        );

      if (error) {
        throw error;
      }

      stopOfferSound();

      await Promise.all([
        loadOrders(),
        loadCourierOffers(),
        loadCurrentCourier()
      ]);

      renderPage();

      toast(
        "تم قبول الطلب. ظهرت الآن تفاصيل الزبون."
      );

      return data;
    } catch (error) {
      console.error(error);

      await loadCourierOffers();

      renderPage();

      const message =
        String(
          error?.message || ""
        ).includes(
          "مندوب آخر"
        )
          ? "سبقك مندوب آخر وقبل الطلب."
          : error.message ||
            "تعذر قبول الطلب.";

      toast(message, "error");
    }
  }

  function openRejectOfferModal(
    offerId
  ) {
    openModal(`
      <div class="modal-heading">
        <div>
          <h2>رفض الطلب</h2>
          <p>
            اختر سبب الرفض.
            هذا الطلب لن يظهر لك مرة أخرى.
          </p>
        </div>

        <button
          type="button"
          class="icon-btn"
          data-close
        >
          ×
        </button>
      </div>

      <div class="form-grid">
        <div class="field full">
          <label>سبب الرفض</label>

          <select
            id="rejectReason"
          >
            <option value="far">
              المكان بعيد
            </option>

            <option value="busy">
              مشغول حالياً
            </option>

            <option value="bike_issue">
              عطل بالمركبة
            </option>

            <option value="other">
              سبب آخر
            </option>
          </select>
        </div>

        <div
          class="field full hidden"
          id="rejectNoteWrap"
        >
          <label>
            اكتب السبب
          </label>

          <textarea
            id="rejectNote"
            rows="3"
            placeholder="اكتب سبب الرفض..."
          ></textarea>
        </div>
      </div>

      <div class="form-actions">
        <button
          type="button"
          class="btn btn-ghost"
          data-close
        >
          رجوع
        </button>

        <button
          type="button"
          class="btn btn-danger"
          id="confirmRejectOffer"
        >
          تأكيد الرفض
        </button>
      </div>
    `);

    $("#rejectReason")
      ?.addEventListener(
        "change",
        event => {
          $("#rejectNoteWrap")
            ?.classList.toggle(
              "hidden",
              event.target.value !==
                "other"
            );
        }
      );

    $("#confirmRejectOffer")
      ?.addEventListener(
        "click",
        () =>
          rejectCourierOffer(
            offerId
          )
      );
  }

  async function rejectCourierOffer(
    offerId
  ) {
    const reason =
      $("#rejectReason")?.value ||
      "";

    const note =
      $("#rejectNote")
        ?.value?.trim() ||
      null;

    if (
      reason === "other" &&
      !note
    ) {
      toast(
        "اكتب سبب الرفض.",
        "warning"
      );
      return;
    }

    try {
      const { error } =
        await sb.rpc(
          "wasalli_reject_offer",
          {
            p_offer_id: offerId,
            p_reason: reason,
            p_note: note
          }
        );

      if (error) {
        throw error;
      }

      closeModal();

      await loadCourierOffers();

      renderPage();

      toast(
        "تم رفض العرض."
      );
    } catch (error) {
      console.error(error);

      toast(
        error.message ||
          "تعذر رفض العرض.",
        "error"
      );
    }
  }

  /* =========================================================
     COURIER CURRENT ORDER CARD
     ========================================================= */

  function renderCourierCurrentOrderCard(
    order
  ) {
    const phone =
      orderCustomerPhone(order);

    const customerLat =
      orderCustomerLat(order);

    const customerLng =
      orderCustomerLng(order);

    const pickupLat =
      orderPickupLat(order);

    const pickupLng =
      orderPickupLng(order);

    const collect =
      calculateAmountToCollect(
        order
      );

    return `
      <article
        class="current-order-card"
      >
        <div
          style="
            display:flex;
            justify-content:space-between;
            align-items:flex-start;
            gap:10px;
          "
        >
          <div>
            <small>الطلب</small>

            <h2
              style="
                margin:4px 0 5px
              "
            >
              ${escapeHTML(
                orderCode(order)
              )}
            </h2>

            ${statusBadge(
              order.status
            )}
          </div>

          <strong>
            ${money(
              orderDeliveryFee(order)
            )}
          </strong>
        </div>

        <div
          class="offer-route"
          style="margin-top:14px"
        >
          <div>
            <small>المحل</small>
            <strong>
              ${escapeHTML(
                orderShopName(order)
              )}
            </strong>
          </div>

          <div class="offer-route-arrow">
            ←
          </div>

          <div>
            <small>الزبون</small>
            <strong>
              ${escapeHTML(
                orderCustomerName(order)
              )}
            </strong>
          </div>
        </div>

        <div
          style="
            margin-top:13px;
            line-height:1.8
          "
        >
          <div>
            <strong>
              📍 العنوان:
            </strong>

            ${escapeHTML(
              orderAddress(order) ||
              "غير محدد"
            )}
          </div>

          ${
            order.nearest_landmark
              ? `
                <div>
                  <strong>
                    🏛 أقرب نقطة:
                  </strong>

                  ${escapeHTML(
                    order.nearest_landmark
                  )}
                </div>
              `
              : ""
          }

          <div>
            <strong>
              💵 قيمة البضاعة:
            </strong>

            ${money(
              order.goods_value
            )}
          </div>

          <div>
            <strong>
              💰 تستلم من الزبون:
            </strong>

            ${money(collect)}
          </div>

          <div>
            <strong>
              💳 الدفع:
            </strong>

            ${escapeHTML(
              paymentLabel(
                orderPaymentMode(
                  order
                )
              )
            )}
          </div>

          ${
            order.notes
              ? `
                <div>
                  <strong>
                    📝 ملاحظات:
                  </strong>

                  ${escapeHTML(
                    order.notes
                  )}
                </div>
              `
              : ""
          }
        </div>

        <div class="order-action-grid">
          ${
            phone
              ? `
                <button
                  type="button"
                  class="btn action-call"
                  data-call-phone="${escapeHTML(
                    phone
                  )}"
                >
                  ☎ اتصال
                </button>

                <button
                  type="button"
                  class="btn action-whatsapp"
                  data-whatsapp-phone="${escapeHTML(
                    phone
                  )}"
                >
                  واتساب
                </button>
              `
              : ""
          }

          ${
            pickupLat !== null &&
            pickupLng !== null
              ? `
                <button
                  type="button"
                  class="btn action-map"
                  data-google-map="${pickupLat},${pickupLng}"
                >
                  خرائط المحل
                </button>

                <button
                  type="button"
                  class="btn btn-ghost"
                  data-waze-map="${pickupLat},${pickupLng}"
                >
                  Waze للمحل
                </button>
              `
              : ""
          }

          ${
            customerLat !== null &&
            customerLng !== null
              ? `
                <button
                  type="button"
                  class="btn action-map"
                  data-google-map="${customerLat},${customerLng}"
                >
                  خرائط الزبون
                </button>

                <button
                  type="button"
                  class="btn btn-ghost"
                  data-waze-map="${customerLat},${customerLng}"
                >
                  Waze للزبون
                </button>
              `
              : order.customer_location_link
                ? `
                  <button
                    type="button"
                    class="btn action-map wide"
                    data-external-url="${escapeHTML(
                      order.customer_location_link
                    )}"
                  >
                    فتح موقع الزبون
                  </button>
                `
                : ""
          }

          ${courierStatusActionButtons(
            order
          )}
        </div>
      </article>
    `;
  }

  function courierStatusActionButtons(
    order
  ) {
    if (!order) return "";

    if (
      CLOSED_ORDER_STATUSES.includes(
        order.status
      )
    ) {
      return "";
    }

    if (
      order.status === "accepted" ||
      order.status === "assigned"
    ) {
      return `
        <button
          type="button"
          class="btn btn-primary wide"
          data-courier-status="picked_up"
          data-order-id="${order.id}"
        >
          ✓ استلمت الطلب من المحل
        </button>

        <button
          type="button"
          class="btn btn-ghost wide"
          data-courier-return="${order.id}"
        >
          تعذر إكمال الطلب / راجع
        </button>
      `;
    }

    if (
      order.status === "picked_up"
    ) {
      return `
        <button
          type="button"
          class="btn btn-primary wide"
          data-courier-status="on_the_way"
          data-order-id="${order.id}"
        >
          🛵 أنا بالطريق للزبون
        </button>

        <button
          type="button"
          class="btn btn-ghost wide"
          data-courier-return="${order.id}"
        >
          الطلب راجع
        </button>
      `;
    }

    if (
      order.status === "on_the_way" ||
      order.status === "road"
    ) {
      return `
        <button
          type="button"
          class="btn btn-primary wide"
          data-courier-status="delivered"
          data-order-id="${order.id}"
        >
          ✓ تم تسليم الطلب
        </button>

        <button
          type="button"
          class="btn btn-ghost wide"
          data-courier-return="${order.id}"
        >
          لم يتم التسليم / راجع
        </button>
      `;
    }

    return "";
  }

  function renderCourierHistoryCard(
    order
  ) {
    const returnedNeedsShop =
      order.status === "returned" &&
      !order.returned_to_shop_at;

    return `
      <article
        class="current-order-card"
      >
        <div
          style="
            display:flex;
            justify-content:space-between;
            gap:10px;
          "
        >
          <div>
            <strong>
              ${escapeHTML(
                orderCode(order)
              )}
            </strong>

            <div
              style="margin-top:6px"
            >
              ${statusBadge(
                order.status
              )}
            </div>
          </div>

          <strong>
            ${money(
              orderDeliveryFee(order) *
              (
                COURIER_PERCENT /
                100
              )
            )}
          </strong>
        </div>

        <div
          style="
            margin-top:10px;
            opacity:.8
          "
        >
          ${escapeHTML(
            orderShopName(order)
          )}
          —
          ${dateTime(
            order.updated_at ||
            order.created_at
          )}
        </div>

        ${
          returnedNeedsShop
            ? `
              <button
                type="button"
                class="btn btn-primary"
                style="
                  width:100%;
                  margin-top:12px
                "
                data-returned-shop="${order.id}"
              >
                ✓ تم إرجاع الطلب للمحل
              </button>
            `
            : ""
        }
      </article>
    `;
  }

  function bindCourierOrderActions() {
    $$("[data-call-phone]")
      .forEach(button => {
        button.onclick = () =>
          openExternal(
            callUrl(
              button.dataset.callPhone
            )
          );
      });

    $$("[data-whatsapp-phone]")
      .forEach(button => {
        button.onclick = () =>
          openExternal(
            whatsappUrl(
              button.dataset
                .whatsappPhone
            )
          );
      });

    $$("[data-google-map]")
      .forEach(button => {
        button.onclick = () => {
          const [lat, lng] =
            String(
              button.dataset
                .googleMap
            )
              .split(",")
              .map(Number);

          openExternal(
            googleMapsUrl(
              lat,
              lng
            )
          );
        };
      });

    $$("[data-waze-map]")
      .forEach(button => {
        button.onclick = () => {
          const [lat, lng] =
            String(
              button.dataset
                .wazeMap
            )
              .split(",")
              .map(Number);

          openExternal(
            wazeUrl(lat, lng)
          );
        };
      });

    $$("[data-external-url]")
      .forEach(button => {
        button.onclick = () =>
          openExternal(
            button.dataset
              .externalUrl
          );
      });

    $$("[data-courier-status]")
      .forEach(button => {
        button.onclick = () =>
          courierUpdateStatus(
            button.dataset.orderId,
            button.dataset
              .courierStatus
          );
      });

    $$("[data-courier-return]")
      .forEach(button => {
        button.onclick = () =>
          openCourierReturnModal(
            button.dataset
              .courierReturn
          );
      });

    $$("[data-returned-shop]")
      .forEach(button => {
        button.onclick = () =>
          confirmReturnedToShop(
            button.dataset
              .returnedShop
          );
      });
  }

  async function courierUpdateStatus(
    orderId,
    status
  ) {
    try {
      const { error } =
        await sb.rpc(
          "wasalli_courier_order_status",
          {
            p_order_id: orderId,
            p_status: status
          }
        );

      if (error) {
        throw error;
      }

      await loadOrders();

      renderPage();

      toast(
        status === "picked_up"
          ? "تم تسجيل استلام الطلب."
          : status ===
              "on_the_way"
            ? "تم تسجيل أنك بالطريق."
            : status ===
                "delivered"
              ? "تم تسجيل تسليم الطلب."
              : "تم تحديث الطلب."
      );
    } catch (error) {
      console.error(error);

      toast(
        "تعذر تحديث الطلب: " +
          error.message,
        "error"
      );
    }
  }

  function openCourierReturnModal(
    orderId
  ) {
    openModal(`
      <div class="modal-heading">
        <div>
          <h2>إرجاع الطلب</h2>
          <p>
            سيتم تسجيل الطلب كراجع.
          </p>
        </div>

        <button
          type="button"
          class="icon-btn"
          data-close
        >
          ×
        </button>
      </div>

      <div class="field">
        <label>
          سبب الإرجاع
        </label>

        <textarea
          id="courierReturnReason"
          rows="4"
          placeholder="مثال: الزبون لم يرد، العنوان غير صحيح..."
        ></textarea>
      </div>

      <div class="form-actions">
        <button
          class="btn btn-ghost"
          data-close
        >
          رجوع
        </button>

        <button
          class="btn btn-danger"
          id="confirmCourierReturn"
        >
          تأكيد الراجع
        </button>
      </div>
    `);

    $("#confirmCourierReturn")
      ?.addEventListener(
        "click",
        async () => {
          const reason =
            $("#courierReturnReason")
              ?.value?.trim() ||
            "";

          if (!reason) {
            toast(
              "اكتب سبب الإرجاع.",
              "warning"
            );
            return;
          }

          try {
            const { error } =
              await sb.rpc(
                "wasalli_courier_order_status",
                {
                  p_order_id:
                    orderId,
                  p_status:
                    "returned"
                }
              );

            if (error) {
              throw error;
            }

            /*
              نخزن السبب إذا سمحت
              سياسة الطلب الحالية.
              فشل هذه الخطوة لا يلغي
              نجاح تحويل الحالة.
            */
            try {
              await sb
                .from("orders")
                .update({
                  returned_reason:
                    reason,
                  status_note:
                    reason,
                  returned_at:
                    new Date()
                      .toISOString()
                })
                .eq(
                  "id",
                  orderId
                );
            } catch {
              // لا نوقف العملية
            }

            closeModal();

            await loadOrders();

            renderPage();

            toast(
              "تم تسجيل الطلب كراجع."
            );
          } catch (error) {
            console.error(error);

            toast(
              error.message ||
                "تعذر إرجاع الطلب.",
              "error"
            );
          }
        }
      );
  }

  async function confirmReturnedToShop(
    orderId
  ) {
    const confirmed =
      await confirmAction(
        "هل تم تسليم الطلب الراجع فعلياً إلى المحل؟",
        "نعم، تم الإرجاع"
      );

    if (!confirmed) return;

    try {
      const { error } =
        await sb.rpc(
          "wasalli_returned_to_shop",
          {
            p_order_id: orderId
          }
        );

      if (error) {
        throw error;
      }

      await loadOrders();

      renderPage();

      toast(
        "تم تأكيد إرجاع الطلب للمحل."
      );
    } catch (error) {
      console.error(error);

      toast(
        error.message ||
          "تعذر تسجيل الإرجاع للمحل.",
        "error"
      );
    }
  }

  /* =========================================================
     FINANCE DASHBOARD
     ========================================================= */

  function renderFinanceDashboard() {
    if (!isFinanceUser()) {
      state.page = "dashboard";
      renderDashboard();
      return;
    }

    setTitle(
      "الملخص المالي",
      "حسابات وصلّي والتسويات"
    );

    const companyIncome =
      state.financialLedger
        .filter(
          entry =>
            entry.entry_type ===
              "company_delivery_share" &&
            !entry.is_reversal
        )
        .reduce(
          (sum, entry) =>
            sum +
            safeNumber(entry.amount),
          0
        );

    const courierShares =
      state.financialLedger
        .filter(
          entry =>
            entry.entry_type ===
              "courier_delivery_share" &&
            !entry.is_reversal
        )
        .reduce(
          (sum, entry) =>
            sum +
            safeNumber(entry.amount),
          0
        );

    const remittances =
      state.courierPayments.reduce(
        (sum, payment) =>
          sum +
          safeNumber(
            payment.amount
          ),
        0
      );

    const expenses =
      state.expenses
        .filter(
          expense =>
            !expense.reversed_at
        )
        .reduce(
          (sum, expense) =>
            sum +
            safeNumber(
              expense.amount
            ),
          0
        );

    const content = $("#content");

    if (!content) return;

    content.innerHTML = `
      <div class="financial-summary-grid">
        ${financeSummaryBox(
          "حصة وصلّي",
          companyIncome,
          "30% من أجور التوصيل"
        )}

        ${financeSummaryBox(
          "حصص المندوبين",
          courierShares,
          "70% من أجور التوصيل"
        )}

        ${financeSummaryBox(
          "المبالغ المستلمة",
          remittances,
          "تسويات المندوبين"
        )}

        ${financeSummaryBox(
          "المصاريف",
          expenses,
          "المصاريف غير المعكوسة"
        )}

        ${financeSummaryBox(
          "صافي حصة الشركة",
          companyIncome -
            expenses,
          "قبل أي تسويات إضافية"
        )}
      </div>

      <div
        class="card"
        style="margin-top:15px"
      >
        <div class="card-header">
          <div>
            <h2>
              آخر الحركات المالية
            </h2>

            <p>
              سجل مالي محفوظ
            </p>
          </div>

          <button
            class="btn btn-primary"
            id="financeAccountsBtn"
          >
            فتح الحسابات
          </button>
        </div>

        ${financeLedgerTable(
          state.financialLedger
            .slice(0, 15)
        )}
      </div>
    `;

    $("#financeAccountsBtn")
      ?.addEventListener(
        "click",
        () => {
          state.page = "accounts";
          renderPage();
        }
      );
  }

  function financeSummaryBox(
    title,
    value,
    subtitle
  ) {
    return `
      <div class="financial-summary-box">
        <span>
          ${escapeHTML(title)}
        </span>

        <strong
          style="
            display:block;
            font-size:22px;
            margin:7px 0
          "
        >
          ${money(value)}
        </strong>

        <small>
          ${escapeHTML(subtitle)}
        </small>
      </div>
    `;
  }

  /* =========================================================
     ORDERS PAGE
     ========================================================= */

  function renderOrders() {
    if (isCourier()) {
      renderCourierOrdersPage();
      return;
    }

    setTitle(
      isShop()
        ? "طلباتي"
        : "الطلبات",
      isShop()
        ? "طلبات المحل"
        : "إدارة عمليات التوصيل"
    );

    const content = $("#content");

    if (!content) return;

    const canCreate =
      isAdminOrOperations() ||
      isShop();

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>
              ${
                isShop()
                  ? "طلبات المحل"
                  : "كل الطلبات"
              }
            </h2>

            <p>
              ${state.orders.length}
              طلب
            </p>
          </div>

          ${
            canCreate
              ? `
                <button
                  class="btn btn-primary"
                  id="newOrderBtn"
                >
                  + طلب جديد
                </button>
              `
              : ""
          }
        </div>

        <div
          class="order-filter-bar"
        >
          <input
            id="orderSearch"
            type="search"
            placeholder="بحث بالرقم، الزبون، الهاتف، المحل..."
          />

          <select
            id="orderStatusFilter"
          >
            <option value="">
              كل الحالات
            </option>

            <option value="new">
              طلب جديد
            </option>

            <option value="accepted">
              مقبول
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

        <div id="ordersResults">
          ${
            isShop()
              ? shopOrdersList(
                  state.orders
                )
              : managementOrdersTable(
                  state.orders
                )
          }
        </div>
      </div>
    `;

    $("#newOrderBtn")
      ?.addEventListener(
        "click",
        openNewOrderModal
      );

    $("#orderSearch")
      ?.addEventListener(
        "input",
        filterOrdersPage
      );

    $("#orderStatusFilter")
      ?.addEventListener(
        "change",
        filterOrdersPage
      );

    bindOrderOpenButtons();
  }

  function renderCourierOrdersPage() {
    setTitle(
      "طلباتي",
      "الطلبات والعروض"
    );

    renderCourierDashboard();
  }

  function filterOrdersPage() {
    const search =
      $("#orderSearch")
        ?.value?.trim()
        .toLowerCase() ||
      "";

    const status =
      $("#orderStatusFilter")
        ?.value ||
      "";

    const filtered =
      state.orders.filter(
        order => {
          if (
            status &&
            order.status !== status
          ) {
            return false;
          }

          if (!search) {
            return true;
          }

          const haystack = [
            orderCode(order),
            orderCustomerName(order),
            orderCustomerPhone(order),
            orderShopName(order),
            orderCourierName(order),
            orderAddress(order),
            order.pickup_area,
            order.delivery_area
          ]
            .join(" ")
            .toLowerCase();

          return haystack.includes(
            search
          );
        }
      );

    const target =
      $("#ordersResults");

    if (!target) return;

    target.innerHTML =
      isShop()
        ? shopOrdersList(filtered)
        : managementOrdersTable(
            filtered
          );

    bindOrderOpenButtons();
  }

  function managementOrdersTable(
    orders
  ) {
    if (!orders.length) {
      return `
        <div class="empty-state">
          لا توجد طلبات.
        </div>
      `;
    }

    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>الطلب</th>
              <th>المحل</th>
              <th>المنطقة</th>
              <th>المندوب</th>
              <th>الأجرة</th>
              <th>الحالة</th>
              <th>الوقت</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            ${orders
              .map(
                order => `
                  <tr
                    class="${
                      isLateOrder(order)
                        ? "late-order-row"
                        : ""
                    }"
                  >
                    <td>
                      <strong>
                        ${escapeHTML(
                          orderCode(order)
                        )}
                      </strong>
                    </td>

                    <td>
                      ${escapeHTML(
                        orderShopName(
                          order
                        )
                      )}
                    </td>

                    <td>
                      ${escapeHTML(
                        order.delivery_area ||
                        orderAddress(
                          order
                        ) ||
                        "—"
                      )}
                    </td>

                    <td>
                      ${escapeHTML(
                        orderCourierName(
                          order
                        )
                      )}
                    </td>

                    <td>
                      ${money(
                        orderDeliveryFee(
                          order
                        )
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
                        class="btn btn-ghost btn-sm"
                        data-open-order="${order.id}"
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
  }

  function shopOrdersList(
    orders
  ) {
    if (!orders.length) {
      return `
        <div class="empty-state">
          لا توجد طلبات.
        </div>
      `;
    }

    return `
      <div class="simple-list">
        ${orders
          .map(
            order => `
              <button
                type="button"
                class="simple-list-item ${
                  isLateOrder(order)
                    ? "late-order-row"
                    : ""
                }"
                data-open-order="${order.id}"
              >
                <div>
                  <strong>
                    ${escapeHTML(
                      orderCode(order)
                    )}
                  </strong>

                  <span>
                    ${escapeHTML(
                      orderCustomerName(
                        order
                      )
                    )}
                  </span>
                </div>

                <div>
                  ${statusBadge(
                    order.status
                  )}
                </div>

                <div>
                  ${money(
                    orderDeliveryFee(
                      order
                    )
                  )}
                </div>
              </button>
            `
          )
          .join("")}
      </div>
    `;
  }

  function bindOrderOpenButtons() {
    $$("[data-open-order]")
      .forEach(button => {
        button.onclick = () => {
          const order =
            state.orders.find(
              item =>
                String(item.id) ===
                String(
                  button.dataset
                    .openOrder
                )
            );

          if (order) {
            openOrder(order);
          }
        };
      });
  }

  /* =========================================================
     NEW ORDER
     ========================================================= */

  function openNewOrderModal() {
    if (
      !isAdminOrOperations() &&
      !isShop()
    ) {
      toast(
        "ليس لديك صلاحية لإضافة طلب.",
        "error"
      );
      return;
    }

    const ownShopId =
      isShop()
        ? state.profile?.shop_id
        : null;

    const shopOptions =
      state.shops
        .filter(
          shop =>
            shop.is_active !== false &&
            !shop.archived_at
        )
        .map(
          shop => `
            <option
              value="${shop.id}"
              ${
                String(shop.id) ===
                String(ownShopId)
                  ? "selected"
                  : ""
              }
            >
              ${escapeHTML(
                shop.name
              )}
            </option>
          `
        )
        .join("");

    openModal(`
      <div class="modal-heading">
        <div>
          <h2>طلب جديد</h2>

          <p>
            أدخل معلومات الطلب.
          </p>
        </div>

        <button
          class="icon-btn"
          data-close
        >
          ×
        </button>
      </div>

      <div class="form-grid">
        <div class="field">
          <label>المحل</label>

          <select
            id="newOrderShop"
            ${isShop()
              ? "disabled"
              : ""}
          >
            <option value="">
              اختر المحل
            </option>

            ${shopOptions}
          </select>
        </div>

        <div class="field">
          <label>
            تصنيف التسعير
          </label>

          <select
            id="newOrderPricing"
          >
            <option value="B">
              B — ${money(
                CONFIG.PRICING?.B ||
                3000
              )}
            </option>

            <option value="A">
              A — ${money(
                CONFIG.PRICING?.A ||
                2000
              )}
            </option>

            <option value="C">
              C — سعر يدوي
            </option>
          </select>
        </div>

        <div class="field">
          <label>اسم الزبون</label>

          <input
            id="newOrderCustomer"
            type="text"
            placeholder="اسم الزبون"
          />
        </div>

        <div class="field">
          <label>رقم الهاتف</label>

          <input
            id="newOrderPhone"
            type="tel"
            placeholder="07xxxxxxxxx"
          />
        </div>

        <div class="field">
          <label>
            منطقة الاستلام
          </label>

          <input
            id="newOrderPickupArea"
            type="text"
            placeholder="مثال: باب الخان"
          />
        </div>

        <div class="field">
          <label>
            منطقة التوصيل
          </label>

          <input
            id="newOrderDeliveryArea"
            type="text"
            placeholder="مثال: حي الحسين"
          />
        </div>

        <div class="field full">
          <label>
            العنوان التفصيلي
          </label>

          <input
            id="newOrderAddress"
            type="text"
            placeholder="الحي، الشارع، أقرب نقطة..."
          />
        </div>

        <div class="field">
          <label>
            أقرب نقطة دالة
          </label>

          <input
            id="newOrderLandmark"
            type="text"
            placeholder="مثال: قرب مدرسة..."
          />
        </div>

        <div class="field">
          <label>
            رابط موقع الزبون
          </label>

          <input
            id="newOrderLocationLink"
            type="url"
            placeholder="رابط Google Maps"
          />
        </div>

        <div class="field">
          <label>
            قيمة البضاعة
          </label>

          <input
            id="newOrderGoods"
            type="number"
            min="0"
            step="250"
            value="0"
          />
        </div>

        <div class="field">
          <label>
            أجرة التوصيل
          </label>

          <input
            id="newOrderFee"
            type="number"
            min="0"
            step="250"
            value="${DEFAULT_DELIVERY_FEE}"
          />
        </div>

        <div class="field">
          <label>
            طريقة الدفع
          </label>

          <select
            id="newOrderPayment"
          >
            <option value="cash">
              نقداً عند الاستلام
            </option>

            <option value="prepaid">
              مدفوع مسبقاً
            </option>

            <option value="electronic">
              دفع إلكتروني
            </option>

            <option value="shop_account">
              على حساب المحل
            </option>
          </select>
        </div>

        <div class="field">
          <label>
            أجرة التوصيل على
          </label>

          <select
            id="newOrderPayer"
          >
            <option value="customer">
              الزبون
            </option>

            <option value="shop">
              المحل
            </option>

            <option value="split">
              مشترك
            </option>
          </select>
        </div>

        ${
          isAdminOrOperations()
            ? `
              <div class="field">
                <label>
                  إسناد مباشر
                </label>

                <select
                  id="newOrderCourier"
                >
                  <option value="">
                    توزيع تلقائي
                  </option>

                  ${state.couriers
                    .filter(
                      courier =>
                        courier.is_active !==
                          false &&
                        !courier.archived_at
                    )
                    .map(
                      courier => `
                        <option
                          value="${courier.id}"
                        >
                          ${escapeHTML(
                            courier.name
                          )}
                        </option>
                      `
                    )
                    .join("")}
                </select>
              </div>
            `
            : ""
        }

        <div class="field full">
          <label>ملاحظات</label>

          <textarea
            id="newOrderNotes"
            rows="3"
            placeholder="أي ملاحظات مهمة..."
          ></textarea>
        </div>
      </div>

      <div
        class="card"
        style="
          margin-top:14px;
          background:#f8f6fb
        "
      >
        <strong>
          المبلغ المتوقع استلامه من الزبون:
        </strong>

        <div
          id="newOrderCollectPreview"
          style="
            font-size:22px;
            font-weight:900;
            margin-top:6px;
            color:var(--wasalli-purple)
          "
        >
          ${money(
            DEFAULT_DELIVERY_FEE
          )}
        </div>
      </div>

      <div class="form-actions">
        <button
          class="btn btn-ghost"
          data-close
        >
          إلغاء
        </button>

        <button
          class="btn btn-primary"
          id="saveNewOrder"
        >
          إنشاء الطلب
        </button>
      </div>
    `);

    const selectedShop =
      state.shops.find(
        shop =>
          String(shop.id) ===
          String(
            $("#newOrderShop")
              ?.value
          )
      );

    if (
      selectedShop &&
      $("#newOrderPickupArea")
    ) {
      $("#newOrderPickupArea")
        .value =
        selectedShop.area || "";
    }

    [
      "#newOrderGoods",
      "#newOrderFee",
      "#newOrderPayment",
      "#newOrderPayer"
    ].forEach(selector => {
      $(selector)
        ?.addEventListener(
          "input",
          updateNewOrderCollectPreview
        );

      $(selector)
        ?.addEventListener(
          "change",
          updateNewOrderCollectPreview
        );
    });

    $("#newOrderPricing")
      ?.addEventListener(
        "change",
        event => {
          const value =
            event.target.value;

          if (value === "A") {
            $("#newOrderFee").value =
              CONFIG.PRICING?.A ||
              2000;
          }

          if (value === "B") {
            $("#newOrderFee").value =
              CONFIG.PRICING?.B ||
              3000;
          }

          if (value === "C") {
            $("#newOrderFee").focus();
          }

          updateNewOrderCollectPreview();
        }
      );

    $("#newOrderShop")
      ?.addEventListener(
        "change",
        event => {
          const shop =
            state.shops.find(
              item =>
                String(item.id) ===
                String(
                  event.target.value
                )
            );

          if (
            shop &&
            $("#newOrderPickupArea")
          ) {
            $("#newOrderPickupArea")
              .value =
              shop.area || "";
          }
        }
      );

    $("#saveNewOrder")
      ?.addEventListener(
        "click",
        saveNewOrder
      );

    updateNewOrderCollectPreview();
  }

  function updateNewOrderCollectPreview() {
    const goods =
      safeNumber(
        $("#newOrderGoods")?.value
      );

    const fee =
      safeNumber(
        $("#newOrderFee")?.value
      );

    const payment =
      $("#newOrderPayment")?.value ||
      "cash";

    const payer =
      $("#newOrderPayer")?.value ||
      "customer";

    let amount = 0;

    if (
      payment !== "prepaid" &&
      payment !== "electronic"
    ) {
      if (payer === "shop") {
        amount = goods;
      } else {
        amount = goods + fee;
      }
    }

    if (
      $("#newOrderCollectPreview")
    ) {
      $("#newOrderCollectPreview")
        .textContent =
        money(amount);
    }
  }

  async function saveNewOrder() {
    const shopId =
      isShop()
        ? state.profile?.shop_id
        : $("#newOrderShop")
            ?.value ||
          null;

    const shop =
      state.shops.find(
        item =>
          String(item.id) ===
          String(shopId)
      );

    const customer =
      $("#newOrderCustomer")
        ?.value?.trim() ||
      "";

    const phone =
      localPhone(
        $("#newOrderPhone")
          ?.value ||
        ""
      );

    const address =
      $("#newOrderAddress")
        ?.value?.trim() ||
      "";

    const pickupArea =
      $("#newOrderPickupArea")
        ?.value?.trim() ||
      shop?.area ||
      "";

    const deliveryArea =
      $("#newOrderDeliveryArea")
        ?.value?.trim() ||
      "";

    const goods =
      safeNumber(
        $("#newOrderGoods")?.value
      );

    const fee =
      safeNumber(
        $("#newOrderFee")?.value
      );

    const payment =
      $("#newOrderPayment")?.value ||
      "cash";

    const payer =
      $("#newOrderPayer")?.value ||
      "customer";

    const pricing =
      $("#newOrderPricing")?.value ||
      "B";

    const courierId =
      isAdminOrOperations()
        ? $("#newOrderCourier")
            ?.value ||
          null
        : null;

    const courier =
      state.couriers.find(
        item =>
          String(item.id) ===
          String(courierId)
      );

    if (!shopId) {
      toast(
        "اختر المحل.",
        "warning"
      );
      return;
    }

    if (!customer) {
      toast(
        "اكتب اسم الزبون.",
        "warning"
      );
      return;
    }

    if (!phone) {
      toast(
        "اكتب رقم هاتف الزبون.",
        "warning"
      );
      return;
    }

    if (!deliveryArea) {
      toast(
        "اكتب منطقة التوصيل.",
        "warning"
      );
      return;
    }

    if (!address) {
      toast(
        "اكتب عنوان التوصيل.",
        "warning"
      );
      return;
    }

    if (fee < 0) {
      toast(
        "أجرة التوصيل غير صحيحة.",
        "warning"
      );
      return;
    }

    let amountToCollect = 0;

    if (
      payment !== "prepaid" &&
      payment !== "electronic"
    ) {
      if (payer === "shop") {
        amountToCollect = goods;
      } else {
        amountToCollect =
          goods + fee;
      }
    }

    const payload = {
      shop_id: shopId,
      courier_id:
        courierId || null,

      customer_name:
        customer,
      customer:
        customer,

      customer_phone:
        phone,
      phone,

      delivery_address:
        address,
      detailed_address:
        address,
      address,

      pickup_area:
        pickupArea,

      delivery_area:
        deliveryArea,

      nearest_landmark:
        $("#newOrderLandmark")
          ?.value?.trim() ||
        null,

      customer_location_link:
        $("#newOrderLocationLink")
          ?.value?.trim() ||
        null,

      delivery_fee: fee,
      fee,

      goods_value: goods,

      payment_mode:
        payment,

      payment_method:
        payment,

      delivery_fee_payer:
        payer,

      delivery_payer:
        payer,

      pricing_class:
        pricing,

      amount_to_collect:
        amountToCollect,

      courier_collection_amount:
        amountToCollect,

      status:
        courierId
          ? "accepted"
          : "new",

      shop:
        shop?.name || null,

      courier:
        courier?.name || null,

      notes:
        $("#newOrderNotes")
          ?.value?.trim() ||
        null,

      source:
        isShop()
          ? "shop"
          : "admin",

      created_by:
        state.session.user.id,

      assigned_at:
        courierId
          ? new Date()
              .toISOString()
          : null,

      assigned_by:
        courierId
          ? state.session.user.id
          : null,

      updated_at:
        new Date().toISOString()
    };

    if (shop) {
      payload.pickup_lat =
        shop.lat ??
        shop.latitude ??
        null;

      payload.pickup_lng =
        shop.lng ??
        shop.longitude ??
        null;

      payload.pickup_latitude =
        payload.pickup_lat;

      payload.pickup_longitude =
        payload.pickup_lng;

      payload.pickup_address =
        shop.detailed_address ||
        shop.address ||
        null;
    }

    const saveButton =
      $("#saveNewOrder");

    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent =
        "جاري إنشاء الطلب...";
    }

    try {
      const { data, error } =
        await sb
          .from("orders")
          .insert(payload)
          .select()
          .single();

      if (error) {
        throw error;
      }

      closeModal();

      await loadOrders();

      if (isCourier()) {
        await loadCourierOffers();
      }

      renderPage();

      toast(
        courierId
          ? "تم إنشاء الطلب وإسناده للمندوب."
          : "تم إنشاء الطلب وبدأ التوزيع التلقائي."
      );

      return data;
    } catch (error) {
      console.error(error);

      toast(
        "تعذر إنشاء الطلب: " +
          error.message,
        "error"
      );

      if (saveButton) {
        saveButton.disabled =
          false;

        saveButton.textContent =
          "إنشاء الطلب";
      }
    }
  }

  /* =========================================================
     OPEN ORDER
     ========================================================= */

  function openOrder(order) {
    if (!order) return;

    /*
      المندوب لا يصل لهذه النافذة
      للعرض غير المقبول. طلباته هنا
      مسندة له بالفعل.
    */

    const courier =
      getCourier(order);

    const shop =
      getShop(order);

    const canManage =
      isAdminOrOperations();

    const canSeeCustomer =
      canManage ||
      isShop() ||
      (
        isCourier() &&
        String(order.courier_id) ===
          String(
            state.currentCourier?.id
          )
      );

    openModal(`
      <div class="modal-heading">
        <div>
          <small>الطلب</small>

          <h2>
            ${escapeHTML(
              orderCode(order)
            )}
          </h2>

          ${statusBadge(
            order.status
          )}
        </div>

        <button
          class="icon-btn"
          data-close
        >
          ×
        </button>
      </div>

      <div class="order-detail-grid">
        <div class="detail-box">
          <small>المحل</small>
          <strong>
            ${escapeHTML(
              shop?.name ||
              orderShopName(order)
            )}
          </strong>
        </div>

        <div class="detail-box">
          <small>المندوب</small>
          <strong>
            ${escapeHTML(
              courier?.name ||
              orderCourierName(order)
            )}
          </strong>
        </div>

        <div class="detail-box">
          <small>منطقة الاستلام</small>
          <strong>
            ${escapeHTML(
              order.pickup_area ||
              shop?.area ||
              "—"
            )}
          </strong>
        </div>

        <div class="detail-box">
          <small>منطقة التوصيل</small>
          <strong>
            ${escapeHTML(
              order.delivery_area ||
              "—"
            )}
          </strong>
        </div>

        ${
          canSeeCustomer
            ? `
              <div class="detail-box">
                <small>الزبون</small>
                <strong>
                  ${escapeHTML(
                    orderCustomerName(
                      order
                    )
                  )}
                </strong>
              </div>

              <div class="detail-box">
                <small>الهاتف</small>
                <strong>
                  ${escapeHTML(
                    orderCustomerPhone(
                      order
                    ) ||
                    "—"
                  )}
                </strong>
              </div>

              <div class="detail-box full">
                <small>
                  العنوان التفصيلي
                </small>

                <strong>
                  ${escapeHTML(
                    orderAddress(order) ||
                    "—"
                  )}
                </strong>
              </div>
            `
            : ""
        }

        <div class="detail-box">
          <small>قيمة البضاعة</small>
          <strong>
            ${money(
              order.goods_value
            )}
          </strong>
        </div>

        <div class="detail-box">
          <small>أجرة التوصيل</small>
          <strong>
            ${money(
              orderDeliveryFee(
                order
              )
            )}
          </strong>
        </div>

        <div class="detail-box">
          <small>طريقة الدفع</small>
          <strong>
            ${escapeHTML(
              paymentLabel(
                orderPaymentMode(
                  order
                )
              )
            )}
          </strong>
        </div>

        <div class="detail-box">
          <small>
            أجرة التوصيل على
          </small>

          <strong>
            ${escapeHTML(
              payerLabel(
                orderDeliveryPayer(
                  order
                )
              )
            )}
          </strong>
        </div>

        <div class="detail-box">
          <small>
            المبلغ المطلوب جمعه
          </small>

          <strong>
            ${money(
              calculateAmountToCollect(
                order
              )
            )}
          </strong>
        </div>

        <div class="detail-box">
          <small>تاريخ الإنشاء</small>
          <strong>
            ${dateTime(
              order.created_at
            )}
          </strong>
        </div>

        ${
          order.notes
            ? `
              <div class="detail-box full">
                <small>الملاحظات</small>

                <strong>
                  ${escapeHTML(
                    order.notes
                  )}
                </strong>
              </div>
            `
            : ""
        }
      </div>

      ${
        canManage
          ? managementOrderControls(
              order
            )
          : ""
      }

      <div class="form-actions">
        <button
          class="btn btn-ghost"
          data-close
        >
          إغلاق
        </button>
      </div>
    `);

    bindManagementOrderControls(
      order
    );
  }

  function managementOrderControls(
    order
  ) {
    const closed =
      CLOSED_ORDER_STATUSES
        .includes(order.status);

    return `
      <div
        class="card"
        style="margin-top:16px"
      >
        <h3>إدارة الطلب</h3>

        <div class="form-grid">
          <div class="field">
            <label>المندوب</label>

            <select
              id="manageOrderCourier"
              ${closed
                ? "disabled"
                : ""}
            >
              <option value="">
                بدون مندوب
              </option>

              ${state.couriers
                .filter(
                  courier =>
                    courier.is_active !==
                      false &&
                    !courier.archived_at
                )
                .map(
                  courier => `
                    <option
                      value="${courier.id}"
                      ${
                        String(
                          courier.id
                        ) ===
                        String(
                          order.courier_id
                        )
                          ? "selected"
                          : ""
                      }
                    >
                      ${escapeHTML(
                        courier.name
                      )}
                    </option>
                  `
                )
                .join("")}
            </select>
          </div>

          <div class="field">
            <label>الحالة</label>

            <select
              id="manageOrderStatus"
            >
              ${[
                "new",
                "accepted",
                "picked_up",
                "on_the_way",
                "delivered",
                "returned",
                "cancelled"
              ]
                .map(
                  status => `
                    <option
                      value="${status}"
                      ${
                        order.status ===
                        status
                          ? "selected"
                          : ""
                      }
                    >
                      ${escapeHTML(
                        statusLabel(
                          status
                        )
                      )}
                    </option>
                  `
                )
                .join("")}
            </select>
          </div>

          <div class="field full">
            <label>
              ملاحظة التغيير
            </label>

            <textarea
              id="manageOrderNote"
              rows="2"
              placeholder="اختياري"
            ></textarea>
          </div>
        </div>

        <div class="form-actions">
          <button
            class="btn btn-primary"
            id="saveManagedOrder"
          >
            حفظ التغيير
          </button>
        </div>
      </div>
    `;
  }

  function bindManagementOrderControls(
    order
  ) {
    $("#saveManagedOrder")
      ?.addEventListener(
        "click",
        () =>
          saveManagedOrder(
            order
          )
      );
  }

  async function saveManagedOrder(
    order
  ) {
    if (!isAdminOrOperations()) {
      return;
    }

    const courierId =
      $("#manageOrderCourier")
        ?.value ||
      null;

    const status =
      $("#manageOrderStatus")
        ?.value ||
      order.status;

    const note =
      $("#manageOrderNote")
        ?.value?.trim() ||
      null;

    const courier =
      state.couriers.find(
        item =>
          String(item.id) ===
          String(courierId)
      );

    const oldStatus =
      order.status;

    const payload = {
      courier_id:
        courierId,
      courier:
        courier?.name || null,
      status,
      status_note:
        note,
      updated_at:
        new Date().toISOString()
    };

    if (
      courierId &&
      String(courierId) !==
        String(order.courier_id)
    ) {
      payload.assigned_at =
        new Date().toISOString();

      payload.assigned_by =
        state.session.user.id;

      if (status === "new") {
        payload.status =
          "accepted";
      }
    }

    if (
      status === "cancelled" &&
      oldStatus !== "cancelled"
    ) {
      payload.cancelled_at =
        new Date().toISOString();

      payload.cancelled_reason =
        note ||
        "إلغاء من الإدارة";
    }

    if (
      status === "returned" &&
      oldStatus !== "returned"
    ) {
      payload.returned_at =
        new Date().toISOString();

      payload.returned_reason =
        note ||
        "راجع بواسطة الإدارة";
    }

    if (
      status === "picked_up" &&
      !order.picked_up_at
    ) {
      payload.picked_up_at =
        new Date().toISOString();
    }

    if (
      status === "on_the_way" &&
      !order.on_the_way_at
    ) {
      payload.on_the_way_at =
        new Date().toISOString();
    }

    if (
      status === "delivered" &&
      !order.delivered_at
    ) {
      payload.delivered_at =
        new Date().toISOString();
    }

    try {
      const { error } =
        await sb
          .from("orders")
          .update(payload)
          .eq("id", order.id);

      if (error) {
        throw error;
      }

      /*
        إضافة سجل تدقيق للحالة.
        إذا كان عندنا trigger في قاعدة
        البيانات سيبقى هو المرجع الأساسي.
      */
      if (
        oldStatus !==
        payload.status
      ) {
        try {
          await sb
            .from(
              "order_status_history"
            )
            .insert({
              order_id:
                order.id,
              old_status:
                oldStatus,
              new_status:
                payload.status,
              status:
                payload.status,
              changed_by:
                state.session.user.id,
              note,
              notes: note,
              metadata: {
                source:
                  "management_ui",
                courier_id:
                  courierId
              }
            });
        } catch (historyError) {
          console.warn(
            historyError
          );
        }
      }

      closeModal();

      await loadOrders();

      renderPage();

      toast(
        "تم تحديث الطلب."
      );
    } catch (error) {
      console.error(error);

      toast(
        "تعذر تحديث الطلب: " +
          error.message,
        "error"
      );
    }
  }
    /* =========================================================
     SHOPS PAGE
     ========================================================= */

  function renderShops() {
    if (!isAdminOrOperations()) {
      state.page = "dashboard";
      renderPage();
      return;
    }

    setTitle(
      "المحلات",
      "إدارة المحلات المتعاونة مع وصلّي"
    );

    const activeShops =
      state.shops.filter(
        shop =>
          shop.is_active !== false &&
          !shop.archived_at
      );

    const archivedShops =
      state.shops.filter(
        shop =>
          shop.is_active === false ||
          shop.archived_at
      );

    const content = $("#content");

    if (!content) return;

    content.innerHTML = `
      <div class="stats-grid">
        ${dashboardStat(
          "🏪",
          "المحلات الفعالة",
          activeShops.length
        )}

        ${dashboardStat(
          "📦",
          "طلبات المحلات",
          state.orders.filter(
            order => order.shop_id
          ).length
        )}

        ${dashboardStat(
          "🗃️",
          "مؤرشفة",
          archivedShops.length
        )}
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2>المحلات</h2>

            <p>
              ${activeShops.length}
              محل فعال
            </p>
          </div>

          <div class="entity-actions">
            <button
              type="button"
              class="btn btn-primary"
              id="addShopBtn"
            >
              + إضافة محل
            </button>

            ${
              isAdmin() &&
              archivedShops.length
                ? `
                  <button
                    type="button"
                    class="btn btn-ghost"
                    id="showArchivedShopsBtn"
                  >
                    الأرشيف
                  </button>
                `
                : ""
            }
          </div>
        </div>

        <div class="order-filter-bar">
          <input
            id="shopSearch"
            type="search"
            placeholder="بحث باسم المحل أو الهاتف أو المنطقة..."
          />
        </div>

        <div
          id="shopsResults"
          class="entity-card-grid"
        >
          ${renderShopCards(
            activeShops
          )}
        </div>
      </div>
    `;

    $("#addShopBtn")
      ?.addEventListener(
        "click",
        openShopModal
      );

    $("#showArchivedShopsBtn")
      ?.addEventListener(
        "click",
        openArchivedShopsModal
      );

    $("#shopSearch")
      ?.addEventListener(
        "input",
        event => {
          const value =
            event.target.value
              .trim()
              .toLowerCase();

          const filtered =
            activeShops.filter(
              shop =>
                [
                  shop.name,
                  shop.phone,
                  shop.area,
                  shop.address,
                  shop.detailed_address
                ]
                  .join(" ")
                  .toLowerCase()
                  .includes(value)
            );

          const target =
            $("#shopsResults");

          if (target) {
            target.innerHTML =
              renderShopCards(
                filtered
              );

            bindShopActions();
          }
        }
      );

    bindShopActions();
  }

  function renderShopCards(shops) {
    if (!shops.length) {
      return `
        <div class="empty-state">
          لا توجد محلات.
        </div>
      `;
    }

    return shops
      .map(shop => {
        const orders =
          state.orders.filter(
            order =>
              String(
                order.shop_id
              ) ===
              String(shop.id)
          );

        const activeOrders =
          orders.filter(order =>
            [
              "new",
              ...ACTIVE_ORDER_STATUSES
            ].includes(
              order.status
            )
          ).length;

        const delivered =
          orders.filter(
            order =>
              order.status ===
              "delivered"
          ).length;

        return `
          <article class="entity-card">
            <div class="entity-card-head">
              <div
                class="entity-avatar"
              >
                🏪
              </div>

              <div>
                <h3>
                  ${escapeHTML(
                    shop.name ||
                    "محل"
                  )}
                </h3>

                <p>
                  ${escapeHTML(
                    shop.area ||
                    CITY
                  )}
                </p>
              </div>
            </div>

            <div class="entity-info">
              <div>
                <small>
                  الهاتف
                </small>

                <strong>
                  ${escapeHTML(
                    shop.phone ||
                    "—"
                  )}
                </strong>
              </div>

              <div>
                <small>
                  طلبات نشطة
                </small>

                <strong>
                  ${activeOrders}
                </strong>
              </div>

              <div>
                <small>
                  تم التسليم
                </small>

                <strong>
                  ${delivered}
                </strong>
              </div>

              <div>
                <small>
                  كل الطلبات
                </small>

                <strong>
                  ${orders.length}
                </strong>
              </div>
            </div>

            <div class="entity-actions">
              <button
                type="button"
                class="btn btn-ghost"
                data-edit-shop="${shop.id}"
              >
                تعديل
              </button>

              ${
                shop.phone
                  ? `
                    <button
                      type="button"
                      class="btn btn-ghost"
                      data-shop-call="${escapeHTML(
                        shop.phone
                      )}"
                    >
                      اتصال
                    </button>
                  `
                  : ""
              }

              ${
                isAdmin()
                  ? `
                    <button
                      type="button"
                      class="btn archive-button"
                      data-delete-shop="${shop.id}"
                    >
                      حذف
                    </button>
                  `
                  : ""
              }
            </div>
          </article>
        `;
      })
      .join("");
  }

  function bindShopActions() {
    $$("[data-edit-shop]")
      .forEach(button => {
        button.onclick = () => {
          const shop =
            state.shops.find(
              item =>
                String(item.id) ===
                String(
                  button.dataset
                    .editShop
                )
            );

          if (shop) {
            openShopModal(shop);
          }
        };
      });

    $$("[data-shop-call]")
      .forEach(button => {
        button.onclick = () =>
          openExternal(
            callUrl(
              button.dataset
                .shopCall
            )
          );
      });

    $$("[data-delete-shop]")
      .forEach(button => {
        button.onclick = () =>
          adminDeleteShop(
            button.dataset
              .deleteShop
          );
      });
  }

  /* =========================================================
     ADD / EDIT SHOP
     ========================================================= */

  function openShopModal(
    shop = null
  ) {
    if (!isAdminOrOperations()) {
      return;
    }

    const editing =
      Boolean(shop);

    openModal(`
      <div class="modal-heading">
        <div>
          <h2>
            ${
              editing
                ? "تعديل المحل"
                : "إضافة محل"
            }
          </h2>

          <p>
            بيانات المحل وموقع الاستلام.
          </p>
        </div>

        <button
          type="button"
          class="icon-btn"
          data-close
        >
          ×
        </button>
      </div>

      <div class="form-grid">
        <div class="field">
          <label>
            اسم المحل
          </label>

          <input
            id="shopNameInput"
            type="text"
            value="${escapeHTML(
              shop?.name || ""
            )}"
          />
        </div>

        <div class="field">
          <label>
            رقم الهاتف
          </label>

          <input
            id="shopPhoneInput"
            type="tel"
            value="${escapeHTML(
              shop?.phone || ""
            )}"
          />
        </div>

        <div class="field">
          <label>
            المنطقة
          </label>

          <input
            id="shopAreaInput"
            type="text"
            value="${escapeHTML(
              shop?.area || ""
            )}"
            placeholder="مثال: باب الخان"
          />
        </div>

        <div class="field">
          <label>
            نوع النشاط
          </label>

          <input
            id="shopTypeInput"
            type="text"
            value="${escapeHTML(
              shop?.shop_type ||
              shop?.category ||
              ""
            )}"
            placeholder="مطعم، متجر، صيدلية..."
          />
        </div>

        <div class="field full">
          <label>
            العنوان
          </label>

          <input
            id="shopAddressInput"
            type="text"
            value="${escapeHTML(
              shop?.detailed_address ||
              shop?.address ||
              ""
            )}"
          />
        </div>

        <div class="field">
          <label>
            خط العرض
          </label>

          <input
            id="shopLatInput"
            type="number"
            step="any"
            value="${
              shop?.latitude ??
              shop?.lat ??
              ""
            }"
          />
        </div>

        <div class="field">
          <label>
            خط الطول
          </label>

          <input
            id="shopLngInput"
            type="number"
            step="any"
            value="${
              shop?.longitude ??
              shop?.lng ??
              ""
            }"
          />
        </div>

        <div class="field full">
          <button
            type="button"
            class="btn btn-ghost"
            id="shopUseCurrentLocation"
          >
            📍 استخدام موقعي الحالي
          </button>
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
          type="button"
          class="btn btn-primary"
          id="saveShopBtn"
        >
          ${
            editing
              ? "حفظ التعديلات"
              : "إضافة المحل"
          }
        </button>
      </div>
    `);

    $("#shopUseCurrentLocation")
      ?.addEventListener(
        "click",
        async () => {
          try {
            const position =
              await getCurrentPosition();

            $("#shopLatInput").value =
              position.coords.latitude;

            $("#shopLngInput").value =
              position.coords.longitude;

            toast(
              "تم تحديد الموقع."
            );
          } catch (error) {
            toast(
              "تعذر الحصول على الموقع.",
              "error"
            );
          }
        }
      );

    $("#saveShopBtn")
      ?.addEventListener(
        "click",
        () =>
          saveShop(shop)
      );
  }

  async function saveShop(
    existingShop = null
  ) {
    if (!isAdminOrOperations()) {
      return;
    }

    const name =
      $("#shopNameInput")
        ?.value?.trim() ||
      "";

    const phone =
      localPhone(
        $("#shopPhoneInput")
          ?.value ||
        ""
      );

    const area =
      $("#shopAreaInput")
        ?.value?.trim() ||
      "";

    const address =
      $("#shopAddressInput")
        ?.value?.trim() ||
      "";

    const latRaw =
      $("#shopLatInput")
        ?.value;

    const lngRaw =
      $("#shopLngInput")
        ?.value;

    if (!name) {
      toast(
        "اكتب اسم المحل.",
        "warning"
      );
      return;
    }

    const payload = {
      name,
      phone: phone || null,
      area: area || null,
      address:
        address || null,
      detailed_address:
        address || null,
      latitude:
        latRaw !== ""
          ? Number(latRaw)
          : null,
      longitude:
        lngRaw !== ""
          ? Number(lngRaw)
          : null,
      lat:
        latRaw !== ""
          ? Number(latRaw)
          : null,
      lng:
        lngRaw !== ""
          ? Number(lngRaw)
          : null,
      shop_type:
        $("#shopTypeInput")
          ?.value?.trim() ||
        null,
      is_active: true,
      updated_at:
        new Date().toISOString()
    };

    try {
      let result;

      if (existingShop) {
        result =
          await sb
            .from("shops")
            .update(payload)
            .eq(
              "id",
              existingShop.id
            );
      } else {
        result =
          await sb
            .from("shops")
            .insert(payload);
      }

      if (result.error) {
        throw result.error;
      }

      closeModal();

      await loadShops();

      renderPage();

      toast(
        existingShop
          ? "تم تحديث المحل."
          : "تمت إضافة المحل."
      );
    } catch (error) {
      console.error(error);

      toast(
        "تعذر حفظ المحل: " +
          error.message,
        "error"
      );
    }
  }

  /* =========================================================
     ADMIN DELETE / ARCHIVE SHOP
     ========================================================= */

  async function adminDeleteShop(
    shopId
  ) {
    if (!isAdmin()) {
      toast(
        "الحذف متاح للإدارة فقط.",
        "error"
      );
      return;
    }

    const shop =
      state.shops.find(
        item =>
          String(item.id) ===
          String(shopId)
      );

    if (!shop) return;

    const confirmed =
      await confirmAction(
        `هل تريد حذف "${shop.name}"؟ إذا كان للمحل سجل طلبات أو حسابات فسيتم أرشفته بدلاً من حذف بياناته التاريخية.`,
        "تأكيد الحذف"
      );

    if (!confirmed) return;

    try {
      const { data, error } =
        await sb.rpc(
          "wasalli_admin_delete_shop",
          {
            p_shop_id: shopId
          }
        );

      if (error) {
        throw error;
      }

      await Promise.all([
        loadShops(),
        loadOrders()
      ]);

      renderPage();

      const action =
        data?.action ||
        data?.result ||
        "";

      toast(
        String(action)
          .toLowerCase()
          .includes("archive")
          ? "تمت أرشفة المحل مع الاحتفاظ بسجلاته."
          : "تم حذف المحل."
      );
    } catch (error) {
      console.error(error);

      toast(
        "تعذر حذف المحل: " +
          error.message,
        "error"
      );
    }
  }

  function openArchivedShopsModal() {
    if (!isAdmin()) return;

    const archived =
      state.shops.filter(
        shop =>
          shop.is_active === false ||
          shop.archived_at
      );

    openModal(`
      <div class="modal-heading">
        <div>
          <h2>
            أرشيف المحلات
          </h2>

          <p>
            السجلات المؤرشفة محفوظة
            لحماية تاريخ الطلبات والحسابات.
          </p>
        </div>

        <button
          class="icon-btn"
          data-close
        >
          ×
        </button>
      </div>

      ${
        archived.length
          ? `
            <div class="simple-list">
              ${archived
                .map(
                  shop => `
                    <div
                      class="simple-list-item"
                    >
                      <div>
                        <strong>
                          ${escapeHTML(
                            shop.name
                          )}
                        </strong>

                        <span>
                          ${escapeHTML(
                            shop.area ||
                            "—"
                          )}
                        </span>
                      </div>

                      <span
                        class="wasalli-badge badge-warning"
                      >
                        مؤرشف
                      </span>
                    </div>
                  `
                )
                .join("")}
            </div>
          `
          : `
            <div class="empty-state">
              لا توجد محلات مؤرشفة.
            </div>
          `
      }
    `);
  }

  /* =========================================================
     COURIERS PAGE
     ========================================================= */

  function renderCouriers() {
    if (!isAdminOrOperations()) {
      state.page = "dashboard";
      renderPage();
      return;
    }

    setTitle(
      "المندوبون",
      "إدارة المندوبين والدوام والتوفر"
    );

    const activeCouriers =
      state.couriers.filter(
        courier =>
          courier.is_active !== false &&
          !courier.archived_at
      );

    const archivedCouriers =
      state.couriers.filter(
        courier =>
          courier.is_active === false ||
          courier.archived_at
      );

    const onShift =
      activeCouriers.filter(
        courier =>
          courier.is_on_shift
      ).length;

    const available =
      activeCouriers.filter(
        courier =>
          courier.is_on_shift &&
          (
            courier.is_available ||
            courier.status ===
              "available"
          )
      ).length;

    const content = $("#content");

    if (!content) return;

    content.innerHTML = `
      <div class="stats-grid">
        ${dashboardStat(
          "🛵",
          "المندوبون",
          activeCouriers.length
        )}

        ${dashboardStat(
          "🟣",
          "بالدوام",
          onShift
        )}

        ${dashboardStat(
          "🟢",
          "متاحون",
          available
        )}

        ${dashboardStat(
          "🗃️",
          "مؤرشفون",
          archivedCouriers.length
        )}
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2>
              قائمة المندوبين
            </h2>

            <p>
              متابعة حالة كل مندوب
            </p>
          </div>

          <div class="entity-actions">
            <button
              type="button"
              class="btn btn-primary"
              id="addCourierBtn"
            >
              + إضافة مندوب
            </button>

            ${
              isAdmin() &&
              archivedCouriers.length
                ? `
                  <button
                    type="button"
                    class="btn btn-ghost"
                    id="showArchivedCouriersBtn"
                  >
                    الأرشيف
                  </button>
                `
                : ""
            }
          </div>
        </div>

        <div class="order-filter-bar">
          <input
            id="courierSearch"
            type="search"
            placeholder="بحث باسم المندوب أو الهاتف أو المنطقة..."
          />
        </div>

        <div
          id="couriersResults"
          class="entity-card-grid"
        >
          ${renderCourierCards(
            activeCouriers
          )}
        </div>
      </div>
    `;

    $("#addCourierBtn")
      ?.addEventListener(
        "click",
        openCourierModal
      );

    $("#showArchivedCouriersBtn")
      ?.addEventListener(
        "click",
        openArchivedCouriersModal
      );

    $("#courierSearch")
      ?.addEventListener(
        "input",
        event => {
          const value =
            event.target.value
              .trim()
              .toLowerCase();

          const filtered =
            activeCouriers.filter(
              courier =>
                [
                  courier.name,
                  courier.phone,
                  courier.area,
                  courier.vehicle_type,
                  courier.vehicle_number
                ]
                  .join(" ")
                  .toLowerCase()
                  .includes(value)
            );

          const target =
            $("#couriersResults");

          if (target) {
            target.innerHTML =
              renderCourierCards(
                filtered
              );

            bindCourierManagementActions();
          }
        }
      );

    bindCourierManagementActions();
  }

  function renderCourierCards(
    couriers
  ) {
    if (!couriers.length) {
      return `
        <div class="empty-state">
          لا يوجد مندوبون.
        </div>
      `;
    }

    return couriers
      .map(courier => {
        const orders =
          state.orders.filter(
            order =>
              String(
                order.courier_id
              ) ===
              String(courier.id)
          );

        const activeOrders =
          orders.filter(order =>
            ACTIVE_ORDER_STATUSES.includes(
              order.status
            )
          ).length;

        const deliveredToday =
          orders.filter(
            order =>
              order.status ===
                "delivered" &&
              isToday(
                order.delivered_at
              )
          ).length;

        const available =
          courier.is_on_shift &&
          (
            courier.is_available ||
            courier.status ===
              "available"
          );

        return `
          <article class="entity-card">
            <div class="entity-card-head">
              <div
                class="entity-avatar"
              >
                🛵
              </div>

              <div>
                <h3>
                  ${escapeHTML(
                    courier.name ||
                    "مندوب"
                  )}
                </h3>

                <p>
                  ${escapeHTML(
                    courier.area ||
                    CITY
                  )}
                </p>
              </div>

              <span
                class="wasalli-badge ${
                  available
                    ? "badge-success"
                    : courier.is_on_shift
                      ? "badge-warning"
                      : ""
                }"
              >
                ${
                  available
                    ? "متاح"
                    : courier.is_on_shift
                      ? "غير متاح"
                      : "خارج الدوام"
                }
              </span>
            </div>

            <div class="entity-info">
              <div>
                <small>
                  الهاتف
                </small>

                <strong>
                  ${escapeHTML(
                    courier.phone ||
                    "—"
                  )}
                </strong>
              </div>

              <div>
                <small>
                  طلبات نشطة
                </small>

                <strong>
                  ${activeOrders}
                </strong>
              </div>

              <div>
                <small>
                  تسليم اليوم
                </small>

                <strong>
                  ${deliveredToday}
                </strong>
              </div>

              <div>
                <small>
                  الحد الأقصى
                </small>

                <strong>
                  ${
                    courier.max_active_orders ??
                    DEFAULT_MAX_ACTIVE_ORDERS
                  }
                </strong>
              </div>
            </div>

            ${
              courier.vehicle_type ||
              courier.vehicle_number
                ? `
                  <div
                    style="
                      margin-top:10px;
                      font-size:13px;
                      opacity:.75
                    "
                  >
                    ${
                      courier.vehicle_type
                        ? escapeHTML(
                            courier.vehicle_type
                          )
                        : ""
                    }

                    ${
                      courier.vehicle_number
                        ? ` — ${escapeHTML(
                            courier.vehicle_number
                          )}`
                        : ""
                    }
                  </div>
                `
                : ""
            }

            ${
              courier.last_location_at
                ? `
                  <div
                    style="
                      margin-top:7px;
                      font-size:12px;
                      opacity:.65
                    "
                  >
                    آخر تحديث للموقع:
                    ${dateTime(
                      courier.last_location_at
                    )}
                  </div>
                `
                : ""
            }

            <div class="entity-actions">
              <button
                type="button"
                class="btn btn-ghost"
                data-edit-courier="${courier.id}"
              >
                تعديل
              </button>

              ${
                courier.phone
                  ? `
                    <button
                      type="button"
                      class="btn btn-ghost"
                      data-courier-call="${escapeHTML(
                        courier.phone
                      )}"
                    >
                      اتصال
                    </button>
                  `
                  : ""
              }

              ${
                courier.latitude !==
                  null &&
                courier.latitude !==
                  undefined &&
                courier.longitude !==
                  null &&
                courier.longitude !==
                  undefined
                  ? `
                    <button
                      type="button"
                      class="btn btn-ghost"
                      data-courier-map="${courier.latitude},${courier.longitude}"
                    >
                      الموقع
                    </button>
                  `
                  : ""
              }

              ${
                isAdmin()
                  ? `
                    <button
                      type="button"
                      class="btn archive-button"
                      data-delete-courier="${courier.id}"
                    >
                      حذف
                    </button>
                  `
                  : ""
              }
            </div>
          </article>
        `;
      })
      .join("");
  }

  function bindCourierManagementActions() {
    $$("[data-edit-courier]")
      .forEach(button => {
        button.onclick = () => {
          const courier =
            state.couriers.find(
              item =>
                String(item.id) ===
                String(
                  button.dataset
                    .editCourier
                )
            );

          if (courier) {
            openCourierModal(
              courier
            );
          }
        };
      });

    $$("[data-courier-call]")
      .forEach(button => {
        button.onclick = () =>
          openExternal(
            callUrl(
              button.dataset
                .courierCall
            )
          );
      });

    $$("[data-courier-map]")
      .forEach(button => {
        button.onclick = () => {
          const [lat, lng] =
            String(
              button.dataset
                .courierMap
            )
              .split(",")
              .map(Number);

          openExternal(
            googleMapsUrl(
              lat,
              lng
            )
          );
        };
      });

    $$("[data-delete-courier]")
      .forEach(button => {
        button.onclick = () =>
          adminDeleteCourier(
            button.dataset
              .deleteCourier
          );
      });
  }

  /* =========================================================
     ADD / EDIT COURIER
     ========================================================= */

  function openCourierModal(
    courier = null
  ) {
    if (!isAdminOrOperations()) {
      return;
    }

    const editing =
      Boolean(courier);

    openModal(`
      <div class="modal-heading">
        <div>
          <h2>
            ${
              editing
                ? "تعديل المندوب"
                : "إضافة مندوب"
            }
          </h2>

          <p>
            بيانات المندوب وإعدادات التشغيل.
          </p>
        </div>

        <button
          type="button"
          class="icon-btn"
          data-close
        >
          ×
        </button>
      </div>

      <div class="form-grid">
        <div class="field">
          <label>
            اسم المندوب
          </label>

          <input
            id="courierNameInput"
            type="text"
            value="${escapeHTML(
              courier?.name || ""
            )}"
          />
        </div>

        <div class="field">
          <label>
            رقم الهاتف
          </label>

          <input
            id="courierPhoneInput"
            type="tel"
            value="${escapeHTML(
              courier?.phone || ""
            )}"
          />
        </div>

        <div class="field">
          <label>
            المنطقة
          </label>

          <input
            id="courierAreaInput"
            type="text"
            value="${escapeHTML(
              courier?.area || ""
            )}"
          />
        </div>

        <div class="field">
          <label>
            نوع المركبة
          </label>

          <input
            id="courierVehicleInput"
            type="text"
            value="${escapeHTML(
              courier?.vehicle_type ||
              ""
            )}"
            placeholder="دراجة نارية"
          />
        </div>

        <div class="field">
          <label>
            رقم المركبة
          </label>

          <input
            id="courierVehicleNumberInput"
            type="text"
            value="${escapeHTML(
              courier?.vehicle_number ||
              ""
            )}"
          />
        </div>

        <div class="field">
          <label>
            هاتف الطوارئ
          </label>

          <input
            id="courierEmergencyInput"
            type="tel"
            value="${escapeHTML(
              courier?.emergency_phone ||
              ""
            )}"
          />
        </div>

        <div class="field">
          <label>
            أقصى عدد طلبات نشطة
          </label>

          <input
            id="courierMaxOrdersInput"
            type="number"
            min="1"
            max="20"
            value="${
              courier?.max_active_orders ??
              DEFAULT_MAX_ACTIVE_ORDERS
            }"
          />
        </div>

        <div class="field">
          <label>
            حالة الحساب
          </label>

          <select
            id="courierActiveInput"
          >
            <option
              value="true"
              ${
                courier?.is_active !==
                false
                  ? "selected"
                  : ""
              }
            >
              فعال
            </option>

            <option
              value="false"
              ${
                courier?.is_active ===
                false
                  ? "selected"
                  : ""
              }
            >
              متوقف
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
          type="button"
          class="btn btn-primary"
          id="saveCourierBtn"
        >
          ${
            editing
              ? "حفظ التعديلات"
              : "إضافة المندوب"
          }
        </button>
      </div>
    `);

    $("#saveCourierBtn")
      ?.addEventListener(
        "click",
        () =>
          saveCourier(courier)
      );
  }

  async function saveCourier(
    existingCourier = null
  ) {
    if (!isAdminOrOperations()) {
      return;
    }

    const name =
      $("#courierNameInput")
        ?.value?.trim() ||
      "";

    const phone =
      localPhone(
        $("#courierPhoneInput")
          ?.value ||
        ""
      );

    if (!name) {
      toast(
        "اكتب اسم المندوب.",
        "warning"
      );
      return;
    }

    const payload = {
      name,
      phone:
        phone || null,

      area:
        $("#courierAreaInput")
          ?.value?.trim() ||
        null,

      vehicle_type:
        $("#courierVehicleInput")
          ?.value?.trim() ||
        null,

      vehicle_number:
        $("#courierVehicleNumberInput")
          ?.value?.trim() ||
        null,

      emergency_phone:
        localPhone(
          $("#courierEmergencyInput")
            ?.value ||
          ""
        ) || null,

      max_active_orders:
        Math.max(
          1,
          safeNumber(
            $("#courierMaxOrdersInput")
              ?.value ||
            DEFAULT_MAX_ACTIVE_ORDERS
          )
        ),

      is_active:
        $("#courierActiveInput")
          ?.value !== "false",

      updated_at:
        new Date().toISOString()
    };

    /*
      عند إنشاء مندوب يدوي من الإدارة
      لا نربطه بحساب Auth تلقائياً.
      الربط التلقائي يتم عند اعتماد
      طلب التسجيل.
    */

    if (!existingCourier) {
      payload.status =
        "unavailable";

      payload.is_available =
        false;

      payload.is_on_shift =
        false;
    }

    try {
      let result;

      if (existingCourier) {
        result =
          await sb
            .from("couriers")
            .update(payload)
            .eq(
              "id",
              existingCourier.id
            );
      } else {
        result =
          await sb
            .from("couriers")
            .insert(payload);
      }

      if (result.error) {
        throw result.error;
      }

      closeModal();

      await loadCouriers();

      renderPage();

      toast(
        existingCourier
          ? "تم تحديث بيانات المندوب."
          : "تمت إضافة المندوب."
      );
    } catch (error) {
      console.error(error);

      toast(
        "تعذر حفظ المندوب: " +
          error.message,
        "error"
      );
    }
  }

  /* =========================================================
     ADMIN DELETE / ARCHIVE COURIER
     ========================================================= */

  async function adminDeleteCourier(
    courierId
  ) {
    if (!isAdmin()) {
      toast(
        "الحذف متاح للإدارة فقط.",
        "error"
      );
      return;
    }

    const courier =
      state.couriers.find(
        item =>
          String(item.id) ===
          String(courierId)
      );

    if (!courier) return;

    const activeOrders =
      state.orders.filter(
        order =>
          String(
            order.courier_id
          ) ===
            String(courierId) &&
          ACTIVE_ORDER_STATUSES.includes(
            order.status
          )
      );

    if (activeOrders.length) {
      toast(
        `لا يمكن حذف أو أرشفة المندوب حالياً لأن لديه ${activeOrders.length} طلب نشط.`,
        "warning"
      );
      return;
    }

    const confirmed =
      await confirmAction(
        `هل تريد حذف "${courier.name}"؟ إذا كان لديه طلبات أو سجلات مالية فسيتم أرشفته فقط حتى لا تضيع البيانات القديمة.`,
        "تأكيد الحذف"
      );

    if (!confirmed) return;

    try {
      const { data, error } =
        await sb.rpc(
          "wasalli_admin_delete_courier",
          {
            p_courier_id:
              courierId
          }
        );

      if (error) {
        throw error;
      }

      await Promise.all([
        loadCouriers(),
        loadOrders()
      ]);

      renderPage();

      const action =
        data?.action ||
        data?.result ||
        "";

      toast(
        String(action)
          .toLowerCase()
          .includes("archive")
          ? "تمت أرشفة المندوب مع الاحتفاظ بسجلاته."
          : "تم حذف المندوب."
      );
    } catch (error) {
      console.error(error);

      toast(
        "تعذر حذف المندوب: " +
          error.message,
        "error"
      );
    }
  }

  function openArchivedCouriersModal() {
    if (!isAdmin()) return;

    const archived =
      state.couriers.filter(
        courier =>
          courier.is_active === false ||
          courier.archived_at
      );

    openModal(`
      <div class="modal-heading">
        <div>
          <h2>
            أرشيف المندوبين
          </h2>

          <p>
            المندوبون المؤرشفون لا يستقبلون
            طلبات جديدة وتبقى سجلاتهم محفوظة.
          </p>
        </div>

        <button
          class="icon-btn"
          data-close
        >
          ×
        </button>
      </div>

      ${
        archived.length
          ? `
            <div class="simple-list">
              ${archived
                .map(
                  courier => `
                    <div
                      class="simple-list-item"
                    >
                      <div>
                        <strong>
                          ${escapeHTML(
                            courier.name
                          )}
                        </strong>

                        <span>
                          ${escapeHTML(
                            courier.phone ||
                            "—"
                          )}
                        </span>
                      </div>

                      <span
                        class="wasalli-badge badge-warning"
                      >
                        مؤرشف
                      </span>
                    </div>
                  `
                )
                .join("")}
            </div>
          `
          : `
            <div class="empty-state">
              لا يوجد مندوبون مؤرشفون.
            </div>
          `
      }
    `);
  }

  /* =========================================================
     MAP PAGE
     ========================================================= */

  function renderMap() {
    if (!isAdminOrOperations()) {
      state.page = "dashboard";
      renderPage();
      return;
    }

    setTitle(
      "خريطة العمليات",
      "مواقع المندوبين والمحلات في كربلاء"
    );

    const content = $("#content");

    if (!content) return;

    const locatedCouriers =
      state.couriers.filter(
        courier =>
          courier.is_active !== false &&
          !courier.archived_at &&
          courier.is_on_shift &&
          courier.latitude !== null &&
          courier.latitude !== undefined &&
          courier.longitude !== null &&
          courier.longitude !== undefined
      );

    const locatedShops =
      state.shops.filter(
        shop => {
          const lat =
            shop.latitude ??
            shop.lat;

          const lng =
            shop.longitude ??
            shop.lng;

          return (
            shop.is_active !== false &&
            !shop.archived_at &&
            lat !== null &&
            lat !== undefined &&
            lng !== null &&
            lng !== undefined
          );
        }
      );

    content.innerHTML = `
      <div class="stats-grid">
        ${dashboardStat(
          "🛵",
          "مندوبون على الخريطة",
          locatedCouriers.length
        )}

        ${dashboardStat(
          "🏪",
          "محلات محددة الموقع",
          locatedShops.length
        )}

        ${dashboardStat(
          "📦",
          "طلبات نشطة",
          state.orders.filter(
            order =>
              ACTIVE_ORDER_STATUSES.includes(
                order.status
              )
          ).length
        )}
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2>
              خريطة وصلّي
            </h2>

            <p>
              تظهر مواقع المندوبين أثناء الدوام فقط
            </p>
          </div>

          <button
            type="button"
            class="btn btn-ghost"
            id="refreshMapBtn"
          >
            تحديث
          </button>
        </div>

        <div
          id="operationsMap"
          style="
            width:100%;
            height:min(68vh,650px);
            min-height:430px;
            border-radius:18px;
            overflow:hidden;
            background:#eee;
          "
        ></div>
      </div>
    `;

    $("#refreshMapBtn")
      ?.addEventListener(
        "click",
        async () => {
          await Promise.all([
            loadCouriers(),
            loadShops(),
            loadOrders()
          ]);

          renderMap();

          toast(
            "تم تحديث الخريطة."
          );
        }
      );

    setTimeout(
      initializeOperationsMap,
      50
    );
  }

  function initializeOperationsMap() {
    const mapElement =
      $("#operationsMap");

    if (!mapElement) return;

    if (!window.L) {
      mapElement.innerHTML = `
        <div
          class="empty-state"
          style="
            height:100%;
            display:grid;
            place-items:center;
          "
        >
          تعذر تحميل مكتبة الخريطة.
        </div>
      `;
      return;
    }

    if (state.map) {
      try {
        state.map.remove();
      } catch {
        // تجاهل
      }

      state.map = null;
      state.mapMarkers = [];
    }

    const defaultLat =
      Number(
        CONFIG.MAP?.LAT ||
        32.6160
      );

    const defaultLng =
      Number(
        CONFIG.MAP?.LNG ||
        44.0249
      );

    const defaultZoom =
      Number(
        CONFIG.MAP?.ZOOM ||
        13
      );

    const map =
      window.L.map(
        mapElement
      ).setView(
        [
          defaultLat,
          defaultLng
        ],
        defaultZoom
      );

    state.map = map;

    window.L
      .tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          maxZoom: 19,
          attribution:
            "&copy; OpenStreetMap contributors"
        }
      )
      .addTo(map);

    const bounds = [];

    state.shops
      .filter(
        shop =>
          shop.is_active !== false &&
          !shop.archived_at
      )
      .forEach(shop => {
        const lat =
          Number(
            shop.latitude ??
            shop.lat
          );

        const lng =
          Number(
            shop.longitude ??
            shop.lng
          );

        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lng)
        ) {
          return;
        }

        const marker =
          window.L.marker(
            [lat, lng]
          )
            .addTo(map)
            .bindPopup(`
              <div dir="rtl">
                <strong>
                  🏪 ${escapeHTML(
                    shop.name ||
                    "محل"
                  )}
                </strong>

                <br>

                ${escapeHTML(
                  shop.area ||
                  ""
                )}

                ${
                  shop.phone
                    ? `
                      <br>
                      ${escapeHTML(
                        shop.phone
                      )}
                    `
                    : ""
                }
              </div>
            `);

        state.mapMarkers.push(
          marker
        );

        bounds.push(
          [lat, lng]
        );
      });

    state.couriers
      .filter(
        courier =>
          courier.is_active !== false &&
          !courier.archived_at &&
          courier.is_on_shift
      )
      .forEach(courier => {
        const lat =
          Number(
            courier.latitude
          );

        const lng =
          Number(
            courier.longitude
          );

        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lng)
        ) {
          return;
        }

        const activeOrders =
          state.orders.filter(
            order =>
              String(
                order.courier_id
              ) ===
                String(
                  courier.id
                ) &&
              ACTIVE_ORDER_STATUSES.includes(
                order.status
              )
          ).length;

        const available =
          courier.is_available ||
          courier.status ===
            "available";

        const marker =
          window.L.marker(
            [lat, lng]
          )
            .addTo(map)
            .bindPopup(`
              <div dir="rtl">
                <strong>
                  🛵 ${escapeHTML(
                    courier.name ||
                    "مندوب"
                  )}
                </strong>

                <br>

                الحالة:
                ${
                  available
                    ? "متاح"
                    : "مشغول / غير متاح"
                }

                <br>

                الطلبات النشطة:
                ${activeOrders}

                ${
                  courier.last_location_at
                    ? `
                      <br>
                      آخر تحديث:
                      ${escapeHTML(
                        dateTime(
                          courier.last_location_at
                        )
                      )}
                    `
                    : ""
                }
              </div>
            `);

        state.mapMarkers.push(
          marker
        );

        bounds.push(
          [lat, lng]
        );
      });

    state.orders
      .filter(
        order =>
          ACTIVE_ORDER_STATUSES.includes(
            order.status
          )
      )
      .forEach(order => {
        const lat =
          Number(
            orderCustomerLat(
              order
            )
          );

        const lng =
          Number(
            orderCustomerLng(
              order
            )
          );

        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lng)
        ) {
          return;
        }

        const marker =
          window.L.circleMarker(
            [lat, lng],
            {
              radius: 7
            }
          )
            .addTo(map)
            .bindPopup(`
              <div dir="rtl">
                <strong>
                  📦 ${escapeHTML(
                    orderCode(order)
                  )}
                </strong>

                <br>

                ${escapeHTML(
                  statusLabel(
                    order.status
                  )
                )}

                <br>

                ${escapeHTML(
                  order.delivery_area ||
                  orderAddress(
                    order
                  ) ||
                  ""
                )}
              </div>
            `);

        state.mapMarkers.push(
          marker
        );

        bounds.push(
          [lat, lng]
        );
      });

    if (bounds.length > 1) {
      map.fitBounds(
        bounds,
        {
          padding: [35, 35],
          maxZoom: 15
        }
      );
    } else if (
      bounds.length === 1
    ) {
      map.setView(
        bounds[0],
        15
      );
    }

    setTimeout(
      () =>
        map.invalidateSize(),
      200
    );
  }

  /* =========================================================
     EXTRA STYLES FOR PART 3
     ========================================================= */

  function injectPart3Styles() {
    if (
      $("#wasalliPart3Styles")
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "wasalliPart3Styles";

    style.textContent = `
      .entity-card-grid {
        display: grid;
        grid-template-columns:
          repeat(
            auto-fit,
            minmax(260px,1fr)
          );
        gap: 13px;
      }

      .entity-card {
        background: #fff;
        border: 1px solid #eee;
        border-radius: 20px;
        padding: 16px;
        box-shadow:
          0 8px 24px
          rgba(0,0,0,.05);
      }

      .entity-card-head {
        display: flex;
        align-items: center;
        gap: 11px;
        margin-bottom: 13px;
      }

      .entity-card-head > div:nth-child(2) {
        flex: 1;
        min-width: 0;
      }

      .entity-card-head h3 {
        margin: 0 0 4px;
      }

      .entity-card-head p {
        margin: 0;
        opacity: .65;
        font-size: 13px;
      }

      .entity-avatar {
        width: 46px;
        height: 46px;
        flex: 0 0 46px;
        display: grid;
        place-items: center;
        border-radius: 15px;
        background: #f4eefb;
        font-size: 22px;
      }

      .entity-info {
        display: grid;
        grid-template-columns:
          repeat(2,minmax(0,1fr));
        gap: 8px;
      }

      .entity-info > div {
        padding: 9px 10px;
        border-radius: 12px;
        background: #fafafa;
      }

      .entity-info small {
        display: block;
        opacity: .6;
        margin-bottom: 3px;
      }

      .entity-info strong {
        font-size: 14px;
        word-break: break-word;
      }

      .entity-actions {
        margin-top: 13px;
      }

      .order-filter-bar {
        display: grid;
        grid-template-columns:
          minmax(0,2fr)
          minmax(160px,1fr);
        gap: 10px;
        margin-bottom: 14px;
      }

      .order-filter-bar input,
      .order-filter-bar select {
        width: 100%;
        min-height: 44px;
        border: 1px solid #ddd;
        border-radius: 12px;
        padding: 0 12px;
        background: #fff;
      }

      .order-detail-grid {
        display: grid;
        grid-template-columns:
          repeat(2,minmax(0,1fr));
        gap: 10px;
        margin-top: 15px;
      }

      .detail-box {
        border: 1px solid #eee;
        border-radius: 14px;
        padding: 11px;
      }

      .detail-box.full {
        grid-column: 1 / -1;
      }

      .detail-box small {
        display: block;
        opacity: .6;
        margin-bottom: 5px;
      }

      .detail-box strong {
        word-break: break-word;
      }

      .courier-overview-grid {
        display: grid;
        grid-template-columns:
          repeat(
            auto-fit,
            minmax(220px,1fr)
          );
        gap: 10px;
      }

      .courier-overview-card {
        border: 1px solid #eee;
        border-radius: 16px;
        padding: 13px;
      }

      .courier-overview-head {
        display: flex;
        justify-content: space-between;
        gap: 8px;
      }

      .courier-overview-head small {
        display: block;
        margin-top: 4px;
        opacity: .6;
      }

      .courier-overview-footer {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 11px;
        font-size: 12px;
        opacity: .8;
      }

      @media (max-width: 700px) {
        .entity-card-grid {
          grid-template-columns: 1fr;
        }

        .order-filter-bar {
          grid-template-columns: 1fr;
        }

        .order-detail-grid {
          grid-template-columns: 1fr;
        }

        .detail-box.full {
          grid-column: auto;
        }
      }
    `;

    document.head.appendChild(
      style
    );
  }

  injectPart3Styles();
   /* =========================================================
     ACCOUNTS / FINANCE
     ========================================================= */

  function buildCourierBalances() {
    return state.couriers
      .filter(
        courier =>
          courier.is_active !== false &&
          !courier.archived_at
      )
      .map(courier => {
        const courierOrders =
          state.orders.filter(
            order =>
              String(order.courier_id) ===
              String(courier.id)
          );

        const closedOrders =
          courierOrders.filter(order =>
            ["delivered", "returned"].includes(
              order.status
            )
          );

        const cashCollected =
          closedOrders.reduce(
            (sum, order) =>
              sum +
              safeNumber(
                order.amount_to_collect ??
                order.courier_collection_amount
              ),
            0
          );

        const payments =
          state.courierPayments
            .filter(
              payment =>
                String(payment.courier_id) ===
                String(courier.id)
            )
            .reduce(
              (sum, payment) =>
                sum +
                safeNumber(payment.amount),
              0
            );

        return {
          courier,
          cashCollected,
          payments,
          balance: Math.max(
            0,
            cashCollected - payments
          )
        };
      });
  }

  function renderAccounts() {
    if (isCourier()) {
      renderCourierAccount();
      return;
    }

    if (!isFinanceUser()) {
      state.page = "dashboard";
      renderPage();
      return;
    }

    setTitle(
      "الحسابات",
      "تسويات المندوبين والمصاريف والسجل المالي"
    );

    const balances =
      buildCourierBalances();

    const totalLiability =
      balances.reduce(
        (sum, item) =>
          sum + item.balance,
        0
      );

    const totalPayments =
      state.courierPayments.reduce(
        (sum, payment) =>
          sum +
          safeNumber(payment.amount),
        0
      );

    const totalExpenses =
      state.expenses
        .filter(
          expense =>
            !expense.reversed_at
        )
        .reduce(
          (sum, expense) =>
            sum +
            safeNumber(expense.amount),
          0
        );

    const companyIncome =
      state.financialLedger
        .filter(
          entry =>
            entry.entry_type ===
              "company_delivery_share" &&
            !entry.is_reversal
        )
        .reduce(
          (sum, entry) =>
            sum +
            safeNumber(entry.amount),
          0
        );

    const content = $("#content");

    if (!content) return;

    content.innerHTML = `
      <div class="financial-summary-grid">
        ${financeSummaryBox(
          "عهدة المندوبين",
          totalLiability,
          "المبلغ المتبقي بذمة المندوبين"
        )}

        ${financeSummaryBox(
          "المبالغ المستلمة",
          totalPayments,
          "إجمالي التسويات المسجلة"
        )}

        ${financeSummaryBox(
          "حصة وصلّي",
          companyIncome,
          "حصة الشركة من أجور التوصيل"
        )}

        ${financeSummaryBox(
          "المصاريف",
          totalExpenses,
          "المصاريف الفعالة"
        )}

        ${financeSummaryBox(
          "الصافي",
          companyIncome - totalExpenses,
          "حصة الشركة بعد المصاريف"
        )}
      </div>

      <div
        class="card"
        style="margin-top:15px"
      >
        <div class="card-header">
          <div>
            <h2>حسابات المندوبين</h2>
            <p>
              تسجيل التسديدات الكاملة أو الجزئية
            </p>
          </div>
        </div>

        ${
          balances.length
            ? `
              <div class="table-wrap">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>المندوب</th>
                      <th>الكاش المحصل</th>
                      <th>المسدد</th>
                      <th>المتبقي</th>
                      <th></th>
                    </tr>
                  </thead>

                  <tbody>
                    ${balances
                      .map(
                        item => `
                          <tr>
                            <td>
                              <strong>
                                ${escapeHTML(
                                  item.courier.name ||
                                  "مندوب"
                                )}
                              </strong>
                            </td>

                            <td>
                              ${money(
                                item.cashCollected
                              )}
                            </td>

                            <td>
                              ${money(
                                item.payments
                              )}
                            </td>

                            <td>
                              <strong>
                                ${money(
                                  item.balance
                                )}
                              </strong>
                            </td>

                            <td>
                              <button
                                type="button"
                                class="btn btn-primary btn-sm"
                                data-courier-payment="${item.courier.id}"
                              >
                                استلام مبلغ
                              </button>
                            </td>
                          </tr>
                        `
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            `
            : `
              <div class="empty-state">
                لا توجد حسابات مندوبين.
              </div>
            `
        }
      </div>

      <div
        class="card"
        style="margin-top:15px"
      >
        <div class="card-header">
          <div>
            <h2>المصاريف</h2>
            <p>
              لا يتم حذف المصروف نهائياً،
              وإنما يعكس عند التصحيح.
            </p>
          </div>

          <button
            type="button"
            class="btn btn-primary"
            id="addExpenseBtn"
          >
            + تسجيل مصروف
          </button>
        </div>

        ${expensesTable()}
      </div>

      <div
        class="card"
        style="margin-top:15px"
      >
        <div class="card-header">
          <div>
            <h2>آخر التسويات</h2>
          </div>
        </div>

        ${courierPaymentsTable()}
      </div>

      <div
        class="card"
        style="margin-top:15px"
      >
        <div class="card-header">
          <div>
            <h2>السجل المالي</h2>
          </div>
        </div>

        ${financeLedgerTable(
          state.financialLedger.slice(
            0,
            50
          )
        )}
      </div>
    `;

    $$("[data-courier-payment]")
      .forEach(button => {
        button.onclick = () =>
          openCourierPaymentModal(
            button.dataset
              .courierPayment
          );
      });

    $("#addExpenseBtn")
      ?.addEventListener(
        "click",
        openExpenseModal
      );

    $$("[data-reverse-expense]")
      .forEach(button => {
        button.onclick = () =>
          reverseExpense(
            button.dataset
              .reverseExpense
          );
      });
  }

  function renderCourierAccount() {
    setTitle(
      "حسابي",
      "أرباحك وعهدة الكاش"
    );

    const courier =
      state.currentCourier;

    const content = $("#content");

    if (!content) return;

    if (!courier) {
      content.innerHTML = `
        <div class="card">
          <div class="empty-state">
            حسابك غير مربوط بسجل مندوب.
          </div>
        </div>
      `;
      return;
    }

    const myOrders =
      state.orders.filter(
        order =>
          String(order.courier_id) ===
          String(courier.id)
      );

    const closed =
      myOrders.filter(order =>
        ["delivered", "returned"].includes(
          order.status
        )
      );

    const deliveryFees =
      closed.reduce(
        (sum, order) =>
          sum +
          orderDeliveryFee(order),
        0
      );

    const earnings =
      deliveryFees *
      (COURIER_PERCENT / 100);

    const collected =
      closed.reduce(
        (sum, order) =>
          sum +
          safeNumber(
            order.amount_to_collect ??
            order.courier_collection_amount
          ),
        0
      );

    const payments =
      state.courierPayments
        .filter(
          payment =>
            String(payment.courier_id) ===
            String(courier.id)
        )
        .reduce(
          (sum, payment) =>
            sum +
            safeNumber(payment.amount),
          0
        );

    const balance =
      Math.max(
        0,
        collected - payments
      );

    content.innerHTML = `
      <div class="financial-summary-grid">
        ${financeSummaryBox(
          "أرباحي",
          earnings,
          `${COURIER_PERCENT}% من أجور التوصيل`
        )}

        ${financeSummaryBox(
          "الكاش المحصل",
          collected,
          "إجمالي المبالغ المستلمة"
        )}

        ${financeSummaryBox(
          "المسدد للشركة",
          payments,
          "المبالغ المسلمة"
        )}

        ${financeSummaryBox(
          "العهدة الحالية",
          balance,
          "المبلغ المتبقي بذمتك"
        )}
      </div>

      <div
        class="card"
        style="margin-top:15px"
      >
        <div class="card-header">
          <h2>طلباتي المكتملة</h2>
        </div>

        ${
          closed.length
            ? `
              <div class="simple-list">
                ${closed
                  .slice(0, 30)
                  .map(
                    order => `
                      <div
                        class="simple-list-item"
                      >
                        <div>
                          <strong>
                            ${escapeHTML(
                              orderCode(order)
                            )}
                          </strong>

                          <span>
                            ${dateTime(
                              order.delivered_at ||
                              order.returned_at ||
                              order.updated_at
                            )}
                          </span>
                        </div>

                        <div>
                          ${statusBadge(
                            order.status
                          )}
                        </div>

                        <strong>
                          ${money(
                            orderDeliveryFee(
                              order
                            ) *
                            (
                              COURIER_PERCENT /
                              100
                            )
                          )}
                        </strong>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            `
            : `
              <div class="empty-state">
                لا توجد طلبات مكتملة.
              </div>
            `
        }
      </div>
    `;
  }

  function openCourierPaymentModal(
    courierId
  ) {
    const courier =
      state.couriers.find(
        item =>
          String(item.id) ===
          String(courierId)
      );

    if (!courier) return;

    const balanceItem =
      buildCourierBalances().find(
        item =>
          String(
            item.courier.id
          ) ===
          String(courierId)
      );

    const balance =
      balanceItem?.balance || 0;

    openModal(`
      <div class="modal-heading">
        <div>
          <h2>استلام مبلغ</h2>
          <p>
            ${escapeHTML(
              courier.name
            )}
          </p>
        </div>

        <button
          class="icon-btn"
          data-close
        >
          ×
        </button>
      </div>

      <div class="card">
        <small>
          العهدة الحالية
        </small>

        <strong
          style="
            display:block;
            font-size:24px;
            margin-top:5px
          "
        >
          ${money(balance)}
        </strong>
      </div>

      <div
        class="form-grid"
        style="margin-top:14px"
      >
        <div class="field">
          <label>المبلغ المستلم</label>

          <input
            id="courierPaymentAmount"
            type="number"
            min="1"
            step="250"
            value="${balance || ""}"
          />
        </div>

        <div class="field">
          <label>ملاحظات</label>

          <input
            id="courierPaymentNote"
            type="text"
            placeholder="اختياري"
          />
        </div>
      </div>

      <div class="form-actions">
        <button
          class="btn btn-ghost"
          data-close
        >
          إلغاء
        </button>

        <button
          class="btn btn-primary"
          id="saveCourierPaymentBtn"
        >
          تسجيل الاستلام
        </button>
      </div>
    `);

    $("#saveCourierPaymentBtn")
      ?.addEventListener(
        "click",
        () =>
          receiveCourierPayment(
            courierId
          )
      );
  }

  async function receiveCourierPayment(
    courierId
  ) {
    const amount =
      safeNumber(
        $("#courierPaymentAmount")
          ?.value
      );

    const note =
      $("#courierPaymentNote")
        ?.value?.trim() ||
      null;

    if (amount <= 0) {
      toast(
        "اكتب مبلغاً صحيحاً.",
        "warning"
      );
      return;
    }

    try {
      const { data, error } =
        await sb.rpc(
          "wasalli_receive_courier_payment",
          {
            p_courier_id:
              courierId,
            p_amount:
              amount,
            p_notes:
              note
          }
        );

      if (error) {
        throw error;
      }

      closeModal();

      await loadAll(false);

      state.page = "accounts";
      renderPage();

      toast(
        "تم تسجيل استلام المبلغ."
      );

      printCourierPaymentReceipt(
        courierId,
        amount,
        note,
        data
      );
    } catch (error) {
      console.error(error);

      toast(
        "تعذر تسجيل التسوية: " +
          error.message,
        "error"
      );
    }
  }

  function printCourierPaymentReceipt(
    courierId,
    amount,
    note,
    result
  ) {
    const courier =
      state.couriers.find(
        item =>
          String(item.id) ===
          String(courierId)
      );

    const transaction =
      result?.id ||
      result?.payment_id ||
      Date.now();

    const receipt = `
      <html dir="rtl">
        <head>
          <meta charset="UTF-8">
          <title>
            وصل استلام - وصلّي
          </title>

          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 30px;
              direction: rtl;
            }

            .receipt {
              max-width: 520px;
              margin: auto;
              border: 2px solid #552583;
              border-radius: 18px;
              padding: 24px;
            }

            h1 {
              color: #552583;
              margin-top: 0;
            }

            .row {
              display: flex;
              justify-content: space-between;
              border-bottom: 1px dashed #ccc;
              padding: 10px 0;
              gap: 20px;
            }

            .amount {
              font-size: 25px;
              font-weight: 800;
              color: #552583;
            }

            small {
              color: #666;
            }
          </style>
        </head>

        <body>
          <div class="receipt">
            <h1>وصلّي</h1>
            <h2>وصل استلام مبلغ</h2>

            <div class="row">
              <span>المندوب</span>
              <strong>
                ${escapeHTML(
                  courier?.name ||
                  "—"
                )}
              </strong>
            </div>

            <div class="row">
              <span>المبلغ</span>
              <strong class="amount">
                ${money(amount)}
              </strong>
            </div>

            <div class="row">
              <span>التاريخ</span>
              <strong>
                ${dateTime(
                  new Date()
                    .toISOString()
                )}
              </strong>
            </div>

            <div class="row">
              <span>
                رقم العملية
              </span>

              <strong>
                ${escapeHTML(
                  transaction
                )}
              </strong>
            </div>

            ${
              note
                ? `
                  <div class="row">
                    <span>
                      ملاحظات
                    </span>

                    <strong>
                      ${escapeHTML(
                        note
                      )}
                    </strong>
                  </div>
                `
                : ""
            }

            <p>
              <small>
                وصل إلكتروني صادر من نظام وصلّي.
              </small>
            </p>
          </div>

          <script>
            window.onload = () => {
              window.print();
            };
          <\/script>
        </body>
      </html>
    `;

    const printWindow =
      window.open(
        "",
        "_blank",
        "width=700,height=800"
      );

    if (!printWindow) {
      return;
    }

    printWindow.document.open();
    printWindow.document.write(
      receipt
    );
    printWindow.document.close();
  }

  function courierPaymentsTable() {
    if (
      !state.courierPayments.length
    ) {
      return `
        <div class="empty-state">
          لا توجد تسويات مسجلة.
        </div>
      `;
    }

    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>المندوب</th>
              <th>المبلغ</th>
              <th>التاريخ</th>
              <th>ملاحظات</th>
            </tr>
          </thead>

          <tbody>
            ${state.courierPayments
              .slice(0, 50)
              .map(payment => {
                const courier =
                  state.couriers.find(
                    item =>
                      String(item.id) ===
                      String(
                        payment.courier_id
                      )
                  );

                return `
                  <tr>
                    <td>
                      ${escapeHTML(
                        courier?.name ||
                        "—"
                      )}
                    </td>

                    <td>
                      <strong>
                        ${money(
                          payment.amount
                        )}
                      </strong>
                    </td>

                    <td>
                      ${dateTime(
                        payment.created_at
                      )}
                    </td>

                    <td>
                      ${escapeHTML(
                        payment.notes ||
                        "—"
                      )}
                    </td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function expensesTable() {
    if (!state.expenses.length) {
      return `
        <div class="empty-state">
          لا توجد مصاريف مسجلة.
        </div>
      `;
    }

    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>الفئة</th>
              <th>الوصف</th>
              <th>المبلغ</th>
              <th>التاريخ</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            ${state.expenses
              .slice(0, 50)
              .map(
                expense => `
                  <tr>
                    <td>
                      ${escapeHTML(
                        expense.category ||
                        "أخرى"
                      )}
                    </td>

                    <td>
                      ${escapeHTML(
                        expense.description ||
                        "—"
                      )}
                    </td>

                    <td>
                      <strong>
                        ${money(
                          expense.amount
                        )}
                      </strong>
                    </td>

                    <td>
                      ${dateTime(
                        expense.created_at
                      )}
                    </td>

                    <td>
                      ${
                        expense.reversed_at
                          ? `
                            <span
                              class="wasalli-badge badge-warning"
                            >
                              معكوس
                            </span>
                          `
                          : `
                            <span
                              class="wasalli-badge badge-success"
                            >
                              فعال
                            </span>
                          `
                      }
                    </td>

                    <td>
                      ${
                        !expense.reversed_at
                          ? `
                            <button
                              class="btn btn-ghost btn-sm"
                              data-reverse-expense="${expense.id}"
                            >
                              عكس
                            </button>
                          `
                          : ""
                      }
                    </td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function openExpenseModal() {
    if (!isFinanceUser()) return;

    openModal(`
      <div class="modal-heading">
        <div>
          <h2>تسجيل مصروف</h2>
          <p>
            المصروف يبقى محفوظاً في السجل.
          </p>
        </div>

        <button
          class="icon-btn"
          data-close
        >
          ×
        </button>
      </div>

      <div class="form-grid">
        <div class="field">
          <label>الفئة</label>

          <select id="expenseCategory">
            <option value="fuel">
              وقود
            </option>

            <option value="maintenance">
              صيانة
            </option>

            <option value="purchases">
              مشتريات
            </option>

            <option value="printing">
              طباعة
            </option>

            <option value="communications">
              اتصالات
            </option>

            <option value="other">
              أخرى
            </option>
          </select>
        </div>

        <div class="field">
          <label>المبلغ</label>

          <input
            id="expenseAmount"
            type="number"
            min="1"
            step="250"
          />
        </div>

        <div class="field full">
          <label>الوصف</label>

          <textarea
            id="expenseDescription"
            rows="3"
            placeholder="تفاصيل المصروف..."
          ></textarea>
        </div>
      </div>

      <div class="form-actions">
        <button
          class="btn btn-ghost"
          data-close
        >
          إلغاء
        </button>

        <button
          class="btn btn-primary"
          id="saveExpenseBtn"
        >
          حفظ المصروف
        </button>
      </div>
    `);

    $("#saveExpenseBtn")
      ?.addEventListener(
        "click",
        saveExpense
      );
  }

  async function saveExpense() {
    if (!isFinanceUser()) return;

    const amount =
      safeNumber(
        $("#expenseAmount")
          ?.value
      );

    const category =
      $("#expenseCategory")
        ?.value ||
      "other";

    const description =
      $("#expenseDescription")
        ?.value?.trim() ||
      "";

    if (amount <= 0) {
      toast(
        "اكتب مبلغاً صحيحاً.",
        "warning"
      );
      return;
    }

    if (!description) {
      toast(
        "اكتب وصف المصروف.",
        "warning"
      );
      return;
    }

    try {
      const { error } =
        await sb
          .from(
            "wasalli_expenses"
          )
          .insert({
            amount,
            category,
            description,
            created_by:
              state.session.user.id
          });

      if (error) {
        throw error;
      }

      closeModal();

      await loadAll(false);

      state.page = "accounts";
      renderPage();

      toast(
        "تم تسجيل المصروف."
      );
    } catch (error) {
      console.error(error);

      toast(
        "تعذر تسجيل المصروف: " +
          error.message,
        "error"
      );
    }
  }

  async function reverseExpense(
    expenseId
  ) {
    if (!isFinanceUser()) return;

    const reason =
      window.prompt(
        "اكتب سبب عكس المصروف:"
      );

    if (!reason?.trim()) {
      return;
    }

    const confirmed =
      await confirmAction(
        "سيبقى المصروف الأصلي محفوظاً ويُعلّم كمعكوس. متابعة؟",
        "عكس المصروف"
      );

    if (!confirmed) return;

    try {
      const { error } =
        await sb
          .from(
            "wasalli_expenses"
          )
          .update({
            reversed_at:
              new Date()
                .toISOString(),
            reversed_by:
              state.session.user.id,
            reversal_reason:
              reason.trim()
          })
          .eq(
            "id",
            expenseId
          );

      if (error) {
        throw error;
      }

      await loadAll(false);

      state.page = "accounts";
      renderPage();

      toast(
        "تم عكس المصروف."
      );
    } catch (error) {
      console.error(error);

      toast(
        "تعذر عكس المصروف: " +
          error.message,
        "error"
      );
    }
  }

  function financeLedgerTable(
    entries
  ) {
    if (!entries?.length) {
      return `
        <div class="empty-state">
          لا توجد حركات مالية.
        </div>
      `;
    }

    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>النوع</th>
              <th>المبلغ</th>
              <th>الوصف</th>
              <th>التاريخ</th>
            </tr>
          </thead>

          <tbody>
            ${entries
              .map(
                entry => `
                  <tr>
                    <td>
                      ${escapeHTML(
                        financeEntryLabel(
                          entry.entry_type
                        )
                      )}
                    </td>

                    <td>
                      <strong>
                        ${money(
                          entry.amount
                        )}
                      </strong>
                    </td>

                    <td>
                      ${escapeHTML(
                        entry.description ||
                        "—"
                      )}
                    </td>

                    <td>
                      ${dateTime(
                        entry.created_at
                      )}
                    </td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function financeEntryLabel(type) {
    const labels = {
      courier_delivery_share:
        "حصة المندوب",
      company_delivery_share:
        "حصة وصلّي",
      courier_payment:
        "تسديد مندوب",
      expense:
        "مصروف",
      reversal:
        "عكس مالي"
    };

    return (
      labels[type] ||
      type ||
      "حركة مالية"
    );
  }

  /* =========================================================
     REPORTS
     ========================================================= */

  function renderReports() {
    if (
      !isAdmin() &&
      !isFinanceUser()
    ) {
      state.page = "dashboard";
      renderPage();
      return;
    }

    setTitle(
      "التقارير",
      "ملخص عمليات وصلّي"
    );

    const delivered =
      state.orders.filter(
        order =>
          order.status === "delivered"
      );

    const returned =
      state.orders.filter(
        order =>
          order.status === "returned"
      );

    const cancelled =
      state.orders.filter(
        order =>
          order.status === "cancelled"
      );

    const totalFees =
      [...delivered, ...returned]
        .reduce(
          (sum, order) =>
            sum +
            orderDeliveryFee(order),
          0
        );

    const courierShare =
      totalFees *
      (COURIER_PERCENT / 100);

    const companyShare =
      totalFees *
      (COMPANY_PERCENT / 100);

    const content = $("#content");

    if (!content) return;

    content.innerHTML = `
      <div class="financial-summary-grid">
        ${financeSummaryBox(
          "إجمالي الطلبات",
          state.orders.length,
          "كل الطلبات المسجلة"
        )}

        ${financeSummaryBox(
          "تم التسليم",
          delivered.length,
          "طلبات مكتملة"
        )}

        ${financeSummaryBox(
          "راجع",
          returned.length,
          "طلبات راجعة"
        )}

        ${financeSummaryBox(
          "ملغي",
          cancelled.length,
          "طلبات ملغاة"
        )}

        ${financeSummaryBox(
          "أجور التوصيل",
          totalFees,
          "التسليم + الراجع"
        )}

        ${financeSummaryBox(
          "حصص المندوبين",
          courierShare,
          `${COURIER_PERCENT}%`
        )}

        ${financeSummaryBox(
          "حصة وصلّي",
          companyShare,
          `${COMPANY_PERCENT}%`
        )}
      </div>

      <div
        class="card"
        style="margin-top:15px"
      >
        <div class="card-header">
          <h2>حالات الطلبات</h2>
        </div>

        <div class="simple-list">
          ${[
            "new",
            "accepted",
            "picked_up",
            "on_the_way",
            "delivered",
            "returned",
            "cancelled"
          ]
            .map(status => {
              const count =
                state.orders.filter(
                  order =>
                    order.status ===
                    status
                ).length;

              return `
                <div
                  class="simple-list-item"
                >
                  <span>
                    ${statusBadge(
                      status
                    )}
                  </span>

                  <strong>
                    ${count}
                  </strong>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>

      <div
        class="card"
        style="margin-top:15px"
      >
        <div class="card-header">
          <h2>
            أداء المندوبين
          </h2>
        </div>

        ${
          state.couriers.length
            ? `
              <div class="table-wrap">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>المندوب</th>
                      <th>تسليم</th>
                      <th>راجع</th>
                      <th>أجور التوصيل</th>
                      <th>حصة المندوب</th>
                    </tr>
                  </thead>

                  <tbody>
                    ${state.couriers
                      .filter(
                        courier =>
                          !courier.archived_at
                      )
                      .map(courier => {
                        const orders =
                          state.orders.filter(
                            order =>
                              String(
                                order.courier_id
                              ) ===
                              String(
                                courier.id
                              )
                          );

                        const done =
                          orders.filter(
                            order =>
                              order.status ===
                              "delivered"
                          );

                        const back =
                          orders.filter(
                            order =>
                              order.status ===
                              "returned"
                          );

                        const fees =
                          [
                            ...done,
                            ...back
                          ].reduce(
                            (sum, order) =>
                              sum +
                              orderDeliveryFee(
                                order
                              ),
                            0
                          );

                        return `
                          <tr>
                            <td>
                              ${escapeHTML(
                                courier.name
                              )}
                            </td>

                            <td>
                              ${done.length}
                            </td>

                            <td>
                              ${back.length}
                            </td>

                            <td>
                              ${money(fees)}
                            </td>

                            <td>
                              <strong>
                                ${money(
                                  fees *
                                  (
                                    COURIER_PERCENT /
                                    100
                                  )
                                )}
                              </strong>
                            </td>
                          </tr>
                        `;
                      })
                      .join("")}
                  </tbody>
                </table>
              </div>
            `
            : `
              <div class="empty-state">
                لا توجد بيانات.
              </div>
            `
        }
      </div>
    `;
  }

  /* =========================================================
     USERS / APPROVALS
     ========================================================= */

  function renderUsers() {
    if (!isAdmin()) {
      state.page = "dashboard";
      renderPage();
      return;
    }

    setTitle(
      "الحسابات والصلاحيات",
      "مراجعة الحسابات الجديدة وإدارة المستخدمين"
    );

    const profiles =
      state.profiles || [];

    const pending =
      profiles.filter(
        profile =>
          profile.role ===
            "pending" ||
          profile.requested_role ||
          profile.is_active === false
      );

    const active =
      profiles.filter(
        profile =>
          profile.is_active !== false &&
          profile.role !== "pending"
      );

    const content = $("#content");

    if (!content) return;

    content.innerHTML = `
      <div class="stats-grid">
        ${dashboardStat(
          "⏳",
          "بانتظار المراجعة",
          pending.length
        )}

        ${dashboardStat(
          "👥",
          "حسابات فعالة",
          active.length
        )}
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2>
              طلبات التسجيل
            </h2>

            <p>
              الموافقة أو الرفض من الإدارة
            </p>
          </div>
        </div>

        ${
          pending.length
            ? `
              <div class="entity-card-grid">
                ${pending
                  .map(
                    profile => `
                      <article
                        class="entity-card"
                      >
                        <div
                          class="entity-card-head"
                        >
                          <div
                            class="entity-avatar"
                          >
                            👤
                          </div>

                          <div>
                            <h3>
                              ${escapeHTML(
                                profile.full_name ||
                                "مستخدم"
                              )}
                            </h3>

                            <p>
                              ${escapeHTML(
                                profile.phone ||
                                profile.email ||
                                "—"
                              )}
                            </p>
                          </div>
                        </div>

                        <div
                          class="entity-info"
                        >
                          <div>
                            <small>
                              الدور المطلوب
                            </small>

                            <strong>
                              ${escapeHTML(
                                roleLabelSafe(
                                  profile.requested_role ||
                                  profile.role
                                )
                              )}
                            </strong>
                          </div>

                          <div>
                            <small>
                              المنطقة
                            </small>

                            <strong>
                              ${escapeHTML(
                                profile.area ||
                                "—"
                              )}
                            </strong>
                          </div>
                        </div>

                        <div
                          class="entity-actions"
                        >
                          <button
                            class="btn btn-primary"
                            data-approve-profile="${profile.id}"
                          >
                            موافقة
                          </button>

                          <button
                            class="btn btn-danger"
                            data-reject-profile="${profile.id}"
                          >
                            رفض
                          </button>
                        </div>
                      </article>
                    `
                  )
                  .join("")}
              </div>
            `
            : `
              <div class="empty-state">
                لا توجد طلبات تسجيل معلقة.
              </div>
            `
        }
      </div>

      <div
        class="card"
        style="margin-top:15px"
      >
        <div class="card-header">
          <h2>
            المستخدمون الفعالون
          </h2>
        </div>

        ${
          active.length
            ? `
              <div class="table-wrap">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>الاسم</th>
                      <th>الهاتف</th>
                      <th>الدور</th>
                      <th>الحالة</th>
                    </tr>
                  </thead>

                  <tbody>
                    ${active
                      .map(
                        profile => `
                          <tr>
                            <td>
                              <strong>
                                ${escapeHTML(
                                  profile.full_name ||
                                  "—"
                                )}
                              </strong>
                            </td>

                            <td>
                              ${escapeHTML(
                                profile.phone ||
                                profile.email ||
                                "—"
                              )}
                            </td>

                            <td>
                              ${escapeHTML(
                                roleLabelSafe(
                                  profile.role
                                )
                              )}
                            </td>

                            <td>
                              <span
                                class="wasalli-badge badge-success"
                              >
                                فعال
                              </span>
                            </td>
                          </tr>
                        `
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            `
            : `
              <div class="empty-state">
                لا توجد حسابات فعالة.
              </div>
            `
        }
      </div>
    `;

    $$("[data-approve-profile]")
      .forEach(button => {
        button.onclick = () =>
          approveProfile(
            button.dataset
              .approveProfile
          );
      });

    $$("[data-reject-profile]")
      .forEach(button => {
        button.onclick = () =>
          rejectProfile(
            button.dataset
              .rejectProfile
          );
      });
  }

  function roleLabelSafe(role) {
    const labels = {
      admin: "الإدارة",
      operations: "العمليات",
      accountant: "المحاسب",
      shop: "محل",
      courier: "مندوب",
      customer: "زبون",
      hotel: "فندق",
      pending: "قيد المراجعة"
    };

    return (
      labels[role] ||
      role ||
      "قيد المراجعة"
    );
  }

  async function approveProfile(
    profileId
  ) {
    if (!isAdmin()) return;

    const profile =
      state.profiles.find(
        item =>
          String(item.id) ===
          String(profileId)
      );

    if (!profile) return;

    const role =
      profile.requested_role &&
      profile.requested_role !==
        "pending"
        ? profile.requested_role
        : (
            profile.role !== "pending"
              ? profile.role
              : "courier"
          );

    const confirmed =
      await confirmAction(
        `الموافقة على حساب ${profile.full_name || ""} كـ ${roleLabelSafe(role)}؟`,
        "موافقة"
      );

    if (!confirmed) return;

    try {
      let courierId =
        profile.courier_id ||
        null;

      let shopId =
        profile.shop_id ||
        null;

      if (
        role === "courier" &&
        !courierId
      ) {
        const {
          data: courier,
          error: courierError
        } =
          await sb
            .from("couriers")
            .insert({
              user_id:
                profile.id,
              name:
                profile.full_name ||
                "مندوب",
              phone:
                profile.phone ||
                null,
              area:
                profile.area ||
                null,
              vehicle_type:
                profile.vehicle_type ||
                null,
              vehicle_number:
                profile.vehicle_number ||
                null,
              emergency_phone:
                profile.emergency_phone ||
                null,
              status:
                "unavailable",
              is_available:
                false,
              is_on_shift:
                false,
              is_active:
                true,
              max_active_orders:
                DEFAULT_MAX_ACTIVE_ORDERS
            })
            .select()
            .single();

        if (courierError) {
          throw courierError;
        }

        courierId =
          courier.id;
      }

      if (
        role === "shop" &&
        !shopId
      ) {
        const {
          data: shop,
          error: shopError
        } =
          await sb
            .from("shops")
            .insert({
              user_id:
                profile.id,
              name:
                profile.full_name ||
                "محل",
              phone:
                profile.phone ||
                null,
              area:
                profile.area ||
                null,
              address:
                profile.address ||
                null,
              is_active:
                true
            })
            .select()
            .single();

        if (shopError) {
          throw shopError;
        }

        shopId = shop.id;
      }

      const { error } =
        await sb
          .from("profiles")
          .update({
            role,
            is_active: true,
            courier_id:
              courierId,
            shop_id:
              shopId,
            approved_at:
              new Date()
                .toISOString(),
            approved_by:
              state.session.user.id,
            suspended_at:
              null,
            suspended_by:
              null,
            updated_at:
              new Date()
                .toISOString()
          })
          .eq(
            "id",
            profileId
          );

      if (error) {
        throw error;
      }

      await loadAll(false);

      state.page = "users";
      renderPage();

      toast(
        "تم اعتماد الحساب."
      );
    } catch (error) {
      console.error(error);

      toast(
        "تعذر اعتماد الحساب: " +
          error.message,
        "error"
      );
    }
  }

  async function rejectProfile(
    profileId
  ) {
    if (!isAdmin()) return;

    const reason =
      window.prompt(
        "اكتب سبب رفض التسجيل:"
      );

    if (!reason?.trim()) {
      toast(
        "سبب الرفض مطلوب.",
        "warning"
      );
      return;
    }

    const confirmed =
      await confirmAction(
        "هل تريد رفض طلب التسجيل؟",
        "تأكيد الرفض"
      );

    if (!confirmed) return;

    try {
      const { error } =
        await sb
          .from("profiles")
          .update({
            role: "pending",
            is_active: false,
            suspended_at:
              new Date()
                .toISOString(),
            suspended_by:
              state.session.user.id,
            updated_at:
              new Date()
                .toISOString()
          })
          .eq(
            "id",
            profileId
          );

      if (error) {
        throw error;
      }

      /*
        نحاول تسجيل سبب الرفض في
        registration_requests إذا كان
        هناك سجل لهذا المستخدم.
      */
      try {
        await sb
          .from(
            "registration_requests"
          )
          .update({
            status:
              "rejected",
            rejection_reason:
              reason.trim(),
            reviewed_by:
              state.session.user.id,
            reviewed_at:
              new Date()
                .toISOString()
          })
          .eq(
            "user_id",
            profileId
          );
      } catch {
        // يبقى الحساب مرفوضاً حتى
        // لو لم يوجد سجل registration_requests
      }

      await loadAll(false);

      state.page = "users";
      renderPage();

      toast(
        "تم رفض طلب التسجيل."
      );
    } catch (error) {
      console.error(error);

      toast(
        "تعذر رفض الحساب: " +
          error.message,
        "error"
      );
    }
  }

  /* =========================================================
     SETTINGS
     ========================================================= */

  function renderSettings() {
    setTitle(
      "الإعدادات",
      isAdmin()
        ? "إعدادات نظام وصلّي"
        : "إعدادات الحساب"
    );

    const content = $("#content");

    if (!content) return;

    content.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>الحساب</h2>

            <p>
              ${escapeHTML(
                state.profile?.full_name ||
                ""
              )}
            </p>
          </div>
        </div>

        <div class="order-detail-grid">
          <div class="detail-box">
            <small>الاسم</small>

            <strong>
              ${escapeHTML(
                state.profile?.full_name ||
                "—"
              )}
            </strong>
          </div>

          <div class="detail-box">
            <small>الدور</small>

            <strong>
              ${escapeHTML(
                roleLabelSafe(
                  state.profile?.role
                )
              )}
            </strong>
          </div>

          <div class="detail-box">
            <small>الهاتف</small>

            <strong>
              ${escapeHTML(
                state.profile?.phone ||
                "—"
              )}
            </strong>
          </div>
        </div>
      </div>

      ${
        isAdmin()
          ? `
            <div
              class="card"
              style="margin-top:15px"
            >
              <div class="card-header">
                <div>
                  <h2>
                    إعدادات التشغيل
                  </h2>

                  <p>
                    القيم العامة للنظام
                  </p>
                </div>
              </div>

              <div class="form-grid">
                <div class="field">
                  <label>
                    اسم الشركة
                  </label>

                  <input
                    id="settingCompanyName"
                    value="${escapeHTML(
                      state.settings
                        ?.company_name ||
                      APP_NAME ||
                      "وصلّي"
                    )}"
                  />
                </div>

                <div class="field">
                  <label>
                    المدينة
                  </label>

                  <input
                    id="settingCity"
                    value="${escapeHTML(
                      state.settings
                        ?.city ||
                      CITY
                    )}"
                  />
                </div>

                <div class="field">
                  <label>
                    أجرة التوصيل الافتراضية
                  </label>

                  <input
                    id="settingDefaultFee"
                    type="number"
                    min="0"
                    value="${safeNumber(
                      state.settings
                        ?.default_delivery_fee ||
                      DEFAULT_DELIVERY_FEE
                    )}"
                  />
                </div>

                <div class="field">
                  <label>
                    نسبة المندوب %
                  </label>

                  <input
                    id="settingCourierPercent"
                    type="number"
                    min="0"
                    max="100"
                    value="${COURIER_PERCENT}"
                  />
                </div>

                <div class="field">
                  <label>
                    نسبة وصلّي %
                  </label>

                  <input
                    id="settingCompanyPercent"
                    type="number"
                    min="0"
                    max="100"
                    value="${COMPANY_PERCENT}"
                  />
                </div>

                <div class="field">
                  <label>
                    الحد الافتراضي للطلبات النشطة
                  </label>

                  <input
                    id="settingMaxOrders"
                    type="number"
                    min="1"
                    max="20"
                    value="${DEFAULT_MAX_ACTIVE_ORDERS}"
                  />
                </div>
              </div>

              <div class="form-actions">
                <button
                  class="btn btn-primary"
                  id="saveSettingsBtn"
                >
                  حفظ الإعدادات
                </button>
              </div>
            </div>
          `
          : ""
      }

      <div
        class="card"
        style="margin-top:15px"
      >
        <button
          id="settingsLogoutBtn"
          class="btn btn-danger"
          style="width:100%"
        >
          تسجيل الخروج
        </button>
      </div>
    `;

    $("#saveSettingsBtn")
      ?.addEventListener(
        "click",
        saveSystemSettings
      );

    $("#settingsLogoutBtn")
      ?.addEventListener(
        "click",
        logout
      );
  }

  async function saveSystemSettings() {
    if (!isAdmin()) return;

    const courierPct =
      safeNumber(
        $("#settingCourierPercent")
          ?.value
      );

    const companyPct =
      safeNumber(
        $("#settingCompanyPercent")
          ?.value
      );

    if (
      courierPct +
        companyPct !==
      100
    ) {
      toast(
        "نسبة المندوب + نسبة وصلّي يجب أن تساوي 100%.",
        "warning"
      );
      return;
    }

    const settings = [
      {
        key:
          "company_name",
        value:
          $("#settingCompanyName")
            ?.value?.trim() ||
          "وصلّي"
      },
      {
        key:
          "city",
        value:
          $("#settingCity")
            ?.value?.trim() ||
          CITY
      },
      {
        key:
          "default_delivery_fee",
        value:
          safeNumber(
            $("#settingDefaultFee")
              ?.value
          )
      },
      {
        key:
          "courier_percent",
        value:
          courierPct
      },
      {
        key:
          "company_percent",
        value:
          companyPct
      },
      {
        key:
          "default_max_active_orders",
        value:
          Math.max(
            1,
            safeNumber(
              $("#settingMaxOrders")
                ?.value
            )
          )
      }
    ];

    try {
      for (
        const setting of settings
      ) {
        const { error } =
          await sb
            .from("app_settings")
            .upsert(
              {
                key:
                  setting.key,
                value:
                  setting.value,
                updated_at:
                  new Date()
                    .toISOString()
              },
              {
                onConflict: "key"
              }
            );

        if (error) {
          throw error;
        }
      }

      await loadAll(false);

      state.page = "settings";
      renderPage();

      toast(
        "تم حفظ الإعدادات."
      );
    } catch (error) {
      console.error(error);

      toast(
        "تعذر حفظ الإعدادات: " +
          error.message,
        "error"
      );
    }
  }

  /* =========================================================
     NOTIFICATIONS
     ========================================================= */

  async function loadNotificationCount() {
    const badge =
      $("#notificationBadge");

    if (!badge) return;

    if (!isAdminOrOperations()) {
      badge.classList.add(
        "hidden"
      );
      return;
    }

    try {
      const { data, error } =
        await sb
          .from("notifications")
          .select("*")
          .order(
            "created_at",
            {
              ascending: false
            }
          )
          .limit(50);

      if (error) {
        throw error;
      }

      state.notifications =
        data || [];

      const unread =
        state.notifications.filter(
          item =>
            !item.is_read
        ).length;

      badge.textContent =
        unread;

      badge.classList.toggle(
        "hidden",
        unread === 0
      );
    } catch (error) {
      console.warn(error);

      badge.classList.add(
        "hidden"
      );
    }
  }

  async function openNotifications() {
    if (!isAdminOrOperations()) {
      toast(
        "الإشعارات التشغيلية للإدارة والعمليات.",
        "warning"
      );
      return;
    }

    await loadNotificationCount();

    openModal(`
      <div class="modal-heading">
        <div>
          <h2>الإشعارات</h2>

          <p>
            آخر إشعارات التشغيل
          </p>
        </div>

        <button
          class="icon-btn"
          data-close
        >
          ×
        </button>
      </div>

      ${
        state.notifications
          ?.length
          ? `
            <div class="simple-list">
              ${state.notifications
                .map(
                  item => `
                    <div
                      class="simple-list-item ${
                        !item.is_read
                          ? "notification-unread"
                          : ""
                      }"
                    >
                      <div>
                        <strong>
                          ${escapeHTML(
                            item.title ||
                            "إشعار"
                          )}
                        </strong>

                        <span>
                          ${escapeHTML(
                            item.message ||
                            ""
                          )}
                        </span>
                      </div>

                      <small>
                        ${dateTime(
                          item.created_at
                        )}
                      </small>
                    </div>
                  `
                )
                .join("")}
            </div>
          `
          : `
            <div class="empty-state">
              لا توجد إشعارات.
            </div>
          `
      }
    `);

    try {
      const unreadIds =
        (state.notifications || [])
          .filter(
            item =>
              !item.is_read
          )
          .map(
            item => item.id
          );

      if (unreadIds.length) {
        await sb
          .from("notifications")
          .update({
            is_read: true
          })
          .in(
            "id",
            unreadIds
          );

        await loadNotificationCount();
      }
    } catch (error) {
      console.warn(error);
    }
  }

  /* =========================================================
     FINAL PAGE ROUTER
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
        break;
    }
  }

  /* =========================================================
     FINAL STATIC EVENTS
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

    $$(".auth-tab")
      .forEach(button => {
        button.addEventListener(
          "click",
          () => {
            $$(".auth-tab")
              .forEach(tab =>
                tab.classList.remove(
                  "active"
                )
              );

            button.classList.add(
              "active"
            );

            const loginMode =
              button.dataset
                .authTab ===
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

            if (
              $("#authMessage")
            ) {
              $("#authMessage")
                .textContent = "";
            }
          }
        );
      });

    window.addEventListener(
      "resize",
      () => {
        if (
          window.innerWidth >
          900
        ) {
          closeSidebar();
        }

        state.map
          ?.invalidateSize?.();
      }
    );
  }

  /* =========================================================
     BOOT
     ========================================================= */

  async function boot() {
    bindStaticEvents();

    try {
      if (
        typeof populateSignupAreas ===
        "function"
      ) {
        populateSignupAreas();
      }

      const {
        data: { session }
      } =
        await sb.auth.getSession();

      if (session) {
        await enterSession(
          session
        );
      } else {
        showAuth();
      }

      sb.auth.onAuthStateChange(
        (event, session) => {
          if (
            event ===
            "SIGNED_OUT"
          ) {
            stopRealtime?.();

            state.session = null;
            state.profile = null;
            state.currentCourier =
              null;
            state.orderOffers = [];

            showAuth();
          }

          if (
            event ===
              "SIGNED_IN" &&
            session &&
            !state.session
          ) {
            enterSession(
              session
            );
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
const loginFormFix = document.getElementById("loginForm");

if (loginFormFix) {
  loginFormFix.onsubmit = async function (event) {
    event.preventDefault();
    await login(event);
  };
}
  
  boot();

})();
