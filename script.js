const services = [
  { name: "House Painting", icon: "fas fa-brush", price: 1200, desc: "Interior and exterior painting solutions." },
  { name: "AC Repair & Installation", icon: "fas fa-wind", price: 1500, desc: "Start-to-end air conditioning service." },
  { name: "Water Purifier Service", icon: "fas fa-water", price: 800, desc: "RO repair and maintenance." },
  { name: "TV Repair", icon: "fas fa-tv", price: 900, desc: "Television diagnostics and repair." },
  { name: "CCTV Installation", icon: "fas fa-video", price: 1700, desc: "Secure camera setup and support." },
  { name: "Electrical Services", icon: "fas fa-bolt", price: 1100, desc: "Wiring, fixing, and electrical safety checks." },
  { name: "Plumbing Services", icon: "fas fa-faucet", price: 1000, desc: "Leaks, pipework, and sanitary repairs." },
  { name: "Home Cleaning", icon: "fas fa-broom", price: 1300, desc: "Deep cleaning and sofa steam cleaning." },
  { name: "Pest Control", icon: "fas fa-bug", price: 1400, desc: "Safe pest removal and prevention." },
  { name: "Appliance Repair", icon: "fas fa-cogs", price: 1100, desc: "Fridge, washing machine and appliance fixes." },
  { name: "Car Cleaning", icon: "fas fa-car", price: 1000, desc: "Interior and exterior car detailing." },
  { name: "Gardening Services", icon: "fas fa-seedling", price: 900, desc: "Lawn care, plants and garden maintenance." }
];

const testimonialsList = [
  { text: "Impressed with speed and professionalism. The home cleaning team did a fantastic job.", name: "Ananya R." },
  { text: "Plumbing issue solved in 45 minutes. Affordable and skilled technicians.", name: "Rohit S." },
  { text: "Amazing experience with AC installation. On-time and very courteous staff.", name: "Meera T." }
];

let providerChatPollTimer = null;
let adminChatPollTimer = null;
let adminChatProvidersCache = [];
let lastChatAlertAt = 0;
let bookingEventsSource = null;
let bookingRefreshTimer = null;
let bookingSseDisconnectCount = 0;
let bookingFallbackPollTimer = null;
let adminBookingSnapshot = [];
let systemWarningBanner = null;
const chatNotificationState = {
  provider: {},
  admin: {}
};

function showSystemWarning(message) {
  const text = String(message || "").trim();
  if (!text) return;

  if (!systemWarningBanner) {
    systemWarningBanner = document.createElement("div");
    systemWarningBanner.id = "systemWarningBanner";
    systemWarningBanner.style.position = "sticky";
    systemWarningBanner.style.top = "0";
    systemWarningBanner.style.zIndex = "9999";
    systemWarningBanner.style.width = "100%";
    systemWarningBanner.style.background = "#fff4e5";
    systemWarningBanner.style.color = "#7a2e00";
    systemWarningBanner.style.borderBottom = "1px solid #ffd7b0";
    systemWarningBanner.style.padding = "10px 14px";
    systemWarningBanner.style.fontWeight = "600";
    systemWarningBanner.style.fontSize = "0.95rem";
    systemWarningBanner.style.lineHeight = "1.35";
  }

  systemWarningBanner.textContent = text;
  if (!systemWarningBanner.parentElement) {
    document.body.prepend(systemWarningBanner);
  }
}

async function checkSystemHealth() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) return;

    const health = await response.json();
    const warnings = Array.isArray(health.warnings) ? health.warnings.filter(Boolean) : [];
    if (!warnings.length) return;

    showSystemWarning(`System notice: ${warnings[0]}`);
  } catch (error) {
    // Ignore health-check failure to avoid blocking page behavior.
  }
}

function formatWhatsAppPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}

function getWhatsAppPhoneLink(phone) {
  const normalized = formatWhatsAppPhone(phone);
  if (!normalized) return phone || "";
  return `<a class="phone-whatsapp-link" href="https://wa.me/${normalized}" target="_blank" rel="noopener noreferrer">${phone}</a>`;
}

function getMapAddressLink(address) {
  const value = String(address || "").trim();
  if (!value) return "";
  const encoded = encodeURIComponent(value);
  return `<a class="phone-whatsapp-link" href="https://www.google.com/maps/search/?api=1&query=${encoded}" target="_blank" rel="noopener noreferrer">${escapeHtml(value)}</a>`;
}

function getPhotoUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/")) {
    return value;
  }
  return `/${value}`;
}

function renderWorkPhotosList(photos = [], title = "", options = {}) {
  if (!Array.isArray(photos) || !photos.length) {
    return "";
  }

  const canDelete = !!options.canDelete;
  const bookingId = String(options.bookingId || "");
  const phase = String(options.phase || "");

  const items = photos.map((p) => {
    const src = getPhotoUrl(p.url);
    if (!src) return "";
    const uploadedLabel = p.uploadedAt ? new Date(p.uploadedAt).toLocaleString() : "";
    return `
      <div class="work-photo-item">
        <a href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer" class="work-photo-link">
          <img src="${escapeHtml(src)}" alt="Work photo" class="work-photo-thumb" />
        </a>
        ${canDelete && bookingId && phase ? `<button type="button" class="work-photo-delete-btn" data-booking-id="${escapeHtml(bookingId)}" data-phase="${escapeHtml(phase)}" data-url="${escapeHtml(src)}">Delete</button>` : ""}
        ${uploadedLabel ? `<span class="work-photo-time">${escapeHtml(uploadedLabel)}</span>` : ""}
      </div>
    `;
  }).join("");

  if (!items) return "";

  return `
    <div class="work-photo-group">
      ${title ? `<p><b>${escapeHtml(title)}:</b></p>` : ""}
      <div class="work-photo-grid">${items}</div>
    </div>
  `;
}

function renderPaymentHistoryList(history = []) {
  if (!Array.isArray(history) || !history.length) {
    return "<p class=\"payment-ledger-empty\">No payment transactions yet.</p>";
  }

  return `
    <div class="payment-ledger-list">
      ${history.slice().sort((a, b) => new Date(b.transactionDate || b.createdAt || 0) - new Date(a.transactionDate || a.createdAt || 0)).map((row) => {
        const amount = Number(row.amount || 0).toFixed(2);
        const method = escapeHtml(row.method || "-");
        const ref = escapeHtml(row.referenceId || "-");
        const notes = escapeHtml(row.notes || "");
        const date = row.transactionDate || row.createdAt;
        const when = date ? new Date(date).toLocaleString() : "-";
        return `
          <div class="payment-ledger-row">
            <span><b>₹${amount}</b></span>
            <span>${method}</span>
            <span>Ref: ${ref}</span>
            <span>${escapeHtml(when)}</span>
            ${notes ? `<span>Note: ${notes}</span>` : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatChatTime(value) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString();
}

function playChatBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 840;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.start(now);
    osc.stop(now + 0.18);
  } catch (e) {
    // Ignore browser restrictions for audio context.
  }
}

function showBrowserNotification(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, { body });
  }
}

function requestBrowserNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "default") return;
  Notification.requestPermission().catch(() => {});
}

function triggerChatAlert(title, body) {
  const now = Date.now();
  if (now - lastChatAlertAt < 2000) return;
  lastChatAlertAt = now;

  if (navigator.vibrate) {
    navigator.vibrate([80, 40, 80]);
  }
  playChatBeep();
  showBrowserNotification(title, body);
}

function renderProviderAdminChatMessages(container, messages, myRole, options = {}) {
  if (!container) return;
  if (!messages.length) {
    container.innerHTML = "<p>No messages yet. Start the conversation.</p>";
    return;
  }

  const allowDelete = !!options.allowDelete;

  container.innerHTML = messages.map((m) => {
    const mine = m.senderRole === myRole;
    const who = m.senderRole === "admin" ? "Admin" : (m.senderName || "Provider");
    const messageId = String(m._id || m.id || "");
    return `
      <div class="chat-bubble ${mine ? "mine" : "other"}">
        <span class="chat-bubble-meta">${escapeHtml(who)} • ${escapeHtml(formatChatTime(m.createdAt))}</span>
        <div>${escapeHtml(m.message)}</div>
        ${allowDelete && messageId ? `<button type="button" class="chat-delete-btn" data-message-id="${escapeHtml(messageId)}">Delete</button>` : ""}
      </div>
    `;
  }).join("");

  container.scrollTop = container.scrollHeight;
}

function getChatState(role, contextKey = "default") {
  if (!chatNotificationState[role][contextKey]) {
    chatNotificationState[role][contextKey] = {
      initialized: false,
      lastIncomingMs: 0,
      unread: 0
    };
  }
  return chatNotificationState[role][contextKey];
}

function getChatBadgeElement(role) {
  if (role === "provider") return document.getElementById("providerChatBadge");
  if (role === "admin") return document.getElementById("adminChatBadge");
  return null;
}

function getTotalUnread(role) {
  return Object.values(chatNotificationState[role] || {}).reduce((sum, state) => sum + (state.unread || 0), 0);
}

function updateChatBadgeUI(role) {
  const badge = getChatBadgeElement(role);
  if (!badge) return;

  const total = getTotalUnread(role);
  if (!total) {
    badge.textContent = "0";
    badge.classList.add("chat-widget-badge-hidden");
    return;
  }

  badge.textContent = String(total > 99 ? "99+" : total);
  badge.classList.remove("chat-widget-badge-hidden");
}

function processIncomingChatNotifications(role, contextKey, messages, myRole, isPanelOpen) {
  const state = getChatState(role, contextKey);
  let newlyReceived = 0;

  const incomingTimes = messages
    .filter((m) => m.senderRole !== myRole)
    .map((m) => new Date(m.createdAt).getTime())
    .filter((t) => !Number.isNaN(t));

  const latestIncomingMs = incomingTimes.length ? Math.max(...incomingTimes) : 0;

  if (!state.initialized) {
    state.initialized = true;
    state.lastIncomingMs = latestIncomingMs;
    state.unread = 0;
    updateChatBadgeUI(role);
    return { newlyReceived: 0, unread: state.unread };
  }

  if (latestIncomingMs > state.lastIncomingMs) {
    newlyReceived = incomingTimes.filter((t) => t > state.lastIncomingMs).length;
    if (isPanelOpen) {
      state.unread = 0;
    } else {
      state.unread += newlyReceived;
    }
    state.lastIncomingMs = latestIncomingMs;
  } else if (isPanelOpen) {
    state.unread = 0;
  }

  updateChatBadgeUI(role);
  return { newlyReceived, unread: state.unread };
}

function clearChatUnread(role, contextKey = "default") {
  const state = getChatState(role, contextKey);
  state.unread = 0;
  updateChatBadgeUI(role);
}

function getChatUnread(role, contextKey = "default") {
  const state = getChatState(role, contextKey);
  return state.unread || 0;
}

function openChatWidgetPanel(panelId, inputId) {
  const panel = document.getElementById(panelId);
  const input = inputId ? document.getElementById(inputId) : null;
  if (!panel) return;
  panel.classList.remove("chat-widget-hidden");
  panel.classList.add("chat-widget-open");
  if (input) {
    setTimeout(() => input.focus(), 100);
  }
}

function setupChatWidget(toggleId, panelId, closeId, inputId, onOpen) {
  const toggleBtn = document.getElementById(toggleId);
  const panel = document.getElementById(panelId);
  const closeBtn = closeId ? document.getElementById(closeId) : null;
  const input = inputId ? document.getElementById(inputId) : null;
  if (!toggleBtn || !panel) return;

  const openPanel = () => {
    panel.classList.remove("chat-widget-hidden");
    panel.classList.add("chat-widget-open");
    if (typeof onOpen === "function") onOpen();
    if (input) {
      setTimeout(() => input.focus(), 100);
    }
  };

  const closePanel = () => {
    panel.classList.remove("chat-widget-open");
    panel.classList.add("chat-widget-hidden");
  };

  toggleBtn.addEventListener("click", () => {
    if (panel.classList.contains("chat-widget-open")) {
      closePanel();
    } else {
      openPanel();
    }
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", closePanel);
  }
}

async function loadProviderAdminChatMessages() {
  const container = document.getElementById("providerChatMessages");
  if (!container) return;

  const token = localStorage.getItem("homeease_access_token");
  if (!token) {
    container.innerHTML = "<p>Please log in to use chat.</p>";
    return;
  }

  try {
    const res = await fetch("/api/chat/messages", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to load chat");

    const panel = document.getElementById("providerChatWidgetPanel");
    const isOpen = !!panel && panel.classList.contains("chat-widget-open");
    processIncomingChatNotifications("provider", "default", data, "provider", isOpen);

    renderProviderAdminChatMessages(container, data, "provider");
  } catch (error) {
    container.innerHTML = `<p>${escapeHtml(error.message || "Error loading chat")}</p>`;
  }
}

function setupProviderAdminChat() {
  const form = document.getElementById("providerChatForm");
  const input = document.getElementById("providerChatInput");
  const status = document.getElementById("providerChatStatus");
  if (!form || !input) return;

  setupChatWidget(
    "providerChatWidgetToggle",
    "providerChatWidgetPanel",
    "providerChatWidgetClose",
    "providerChatInput",
    () => {
      clearChatUnread("provider", "default");
      loadProviderAdminChatMessages();
    }
  );

  if (providerChatPollTimer) clearInterval(providerChatPollTimer);
  loadProviderAdminChatMessages();
  providerChatPollTimer = setInterval(loadProviderAdminChatMessages, 8000);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = localStorage.getItem("homeease_access_token");
    const message = input.value.trim();
    if (!token || !message) return;

    try {
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ message })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to send message");
      input.value = "";
      if (status) {
        status.textContent = "Message sent.";
        status.style.color = "var(--primary-dark)";
      }
      await loadProviderAdminChatMessages();
    } catch (error) {
      if (status) {
        status.textContent = error.message || "Failed to send message";
        status.style.color = "var(--danger)";
      }
    }
  });
}

async function loadAdminChatProviders() {
  const select = document.getElementById("adminChatProviderSelect");
  if (!select) return;

  const token = localStorage.getItem("homeease_access_token");
  if (!token) return;

  try {
    const res = await fetch("/api/admin/providers", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const providers = await res.json();
    if (!res.ok) throw new Error("Failed to load providers");

    adminChatProvidersCache = providers;

    const currentValue = select.value;
    select.innerHTML = '<option value="">Select provider</option>' + providers.map((p) => `
      <option value="${p._id}">${escapeHtml(p.name)} (${escapeHtml(p.email)})${getChatUnread("admin", p._id) ? ` • ${getChatUnread("admin", p._id)} new` : ""}</option>
    `).join("");

    if (currentValue) select.value = currentValue;
  } catch (error) {
    select.innerHTML = '<option value="">Failed to load providers</option>';
  }
}

async function pollAdminChatNotifications() {
  const select = document.getElementById("adminChatProviderSelect");
  const panel = document.getElementById("adminChatWidgetPanel");
  const token = localStorage.getItem("homeease_access_token");
  if (!select || !panel || !token) return;

  if (!adminChatProvidersCache.length) {
    await loadAdminChatProviders();
  }

  const currentProviderId = select.value;
  const isPanelOpen = panel.classList.contains("chat-widget-open");
  let firstIncomingProviderId = "";

  for (const provider of adminChatProvidersCache) {
    try {
      const res = await fetch(`/api/chat/messages?providerId=${encodeURIComponent(provider._id)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) continue;
      const data = await res.json();

      const isCurrentOpen = isPanelOpen && currentProviderId === provider._id;
      const result = processIncomingChatNotifications("admin", provider._id, data, "admin", isCurrentOpen);
      if (result.newlyReceived > 0 && !firstIncomingProviderId) {
        firstIncomingProviderId = provider._id;
      }

      if (result.newlyReceived > 0) {
        triggerChatAlert(
          "New provider message",
          `${provider.name || "Provider"} sent ${result.newlyReceived} new message${result.newlyReceived > 1 ? "s" : ""}`
        );
      }
    } catch (error) {
      // Ignore single provider chat poll failures.
    }
  }

  await loadAdminChatProviders();

  if (!isPanelOpen && firstIncomingProviderId) {
    select.value = firstIncomingProviderId;
    openChatWidgetPanel("adminChatWidgetPanel", "adminChatInput");
    clearChatUnread("admin", firstIncomingProviderId);
    await loadAdminProviderChatMessages();
    await loadAdminChatProviders();
  }
}

async function loadAdminProviderChatMessages() {
  const select = document.getElementById("adminChatProviderSelect");
  const container = document.getElementById("adminChatMessages");
  if (!select || !container) return;

  const providerId = select.value;
  if (!providerId) {
    container.innerHTML = "<p>Select a provider to view chat.</p>";
    return;
  }

  const token = localStorage.getItem("homeease_access_token");
  if (!token) {
    container.innerHTML = "<p>Please log in to use chat.</p>";
    return;
  }

  try {
    const res = await fetch(`/api/chat/messages?providerId=${encodeURIComponent(providerId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Failed to load chat");

    const panel = document.getElementById("adminChatWidgetPanel");
    const isOpen = !!panel && panel.classList.contains("chat-widget-open");
    processIncomingChatNotifications("admin", providerId, data, "admin", isOpen);

    renderProviderAdminChatMessages(container, data, "admin", { allowDelete: true });
  } catch (error) {
    container.innerHTML = `<p>${escapeHtml(error.message || "Error loading chat")}</p>`;
  }
}

function setupAdminProviderChat() {
  const form = document.getElementById("adminChatForm");
  const select = document.getElementById("adminChatProviderSelect");
  const input = document.getElementById("adminChatInput");
  const deleteBtn = document.getElementById("adminChatDeleteBtn");
  const status = document.getElementById("adminChatStatus");
  const widgetToggle = document.getElementById("adminChatWidgetToggle");
  const messagesBox = document.getElementById("adminChatMessages");
  if (!form || !select || !input) return;

  if (widgetToggle) {
    widgetToggle.addEventListener("click", requestBrowserNotificationPermission, { once: true });
  }
  input.addEventListener("focus", requestBrowserNotificationPermission, { once: true });

  setupChatWidget(
    "adminChatWidgetToggle",
    "adminChatWidgetPanel",
    "adminChatWidgetClose",
    "adminChatInput",
    () => {
      const providerId = select.value;
      if (providerId) clearChatUnread("admin", providerId);
      loadAdminProviderChatMessages();
      loadAdminChatProviders();
    }
  );

  if (adminChatPollTimer) clearInterval(adminChatPollTimer);

  loadAdminChatProviders().then(async () => {
    await loadAdminProviderChatMessages();
    await pollAdminChatNotifications();
  });
  adminChatPollTimer = setInterval(() => {
    pollAdminChatNotifications();
    loadAdminProviderChatMessages();
  }, 8000);

  select.addEventListener("change", async () => {
    const providerId = select.value;
    if (providerId) {
      clearChatUnread("admin", providerId);
      await loadAdminChatProviders();
    }
    loadAdminProviderChatMessages();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = localStorage.getItem("homeease_access_token");
    const providerId = select.value;
    const message = input.value.trim();
    if (!token || !providerId || !message) return;

    try {
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ providerId, message })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to send message");
      input.value = "";
      if (status) {
        status.textContent = "Message sent.";
        status.style.color = "var(--primary-dark)";
      }
      await loadAdminProviderChatMessages();
    } catch (error) {
      if (status) {
        status.textContent = error.message || "Failed to send message";
        status.style.color = "var(--danger)";
      }
    }
  });

  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      const token = localStorage.getItem("homeease_access_token");
      const providerId = select.value;
      if (!token || !providerId) {
        if (status) {
          status.textContent = "Please select a provider first.";
          status.style.color = "var(--danger)";
        }
        return;
      }

      const shouldDelete = window.confirm("Delete full chat history only for the selected provider? This cannot be undone.");
      if (!shouldDelete) return;

      try {
        const res = await fetch(`/api/chat/messages?providerId=${encodeURIComponent(providerId)}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Failed to delete chat history");

        const state = getChatState("admin", providerId);
        state.initialized = false;
        state.lastIncomingMs = 0;
        state.unread = 0;
        updateChatBadgeUI("admin");

        if (status) {
          status.textContent = "Chat history deleted.";
          status.style.color = "var(--primary-dark)";
        }

        await loadAdminProviderChatMessages();
        await loadAdminChatProviders();
      } catch (error) {
        if (status) {
          status.textContent = error.message || "Failed to delete chat history";
          status.style.color = "var(--danger)";
        }
      }
    });
  }

  if (messagesBox) {
    messagesBox.addEventListener("click", async (event) => {
      const btn = event.target.closest(".chat-delete-btn");
      if (!btn) return;

      const messageId = btn.getAttribute("data-message-id");
      const providerId = select.value;
      const token = localStorage.getItem("homeease_access_token");
      if (!messageId || !providerId || !token) return;

      const shouldDelete = window.confirm("Delete this chat message?");
      if (!shouldDelete) return;

      try {
        const res = await fetch(`/api/chat/messages/${encodeURIComponent(messageId)}?providerId=${encodeURIComponent(providerId)}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Failed to delete message");

        if (status) {
          status.textContent = "Message deleted.";
          status.style.color = "var(--primary-dark)";
        }
        await loadAdminProviderChatMessages();
      } catch (error) {
        if (status) {
          status.textContent = error.message || "Failed to delete message";
          status.style.color = "var(--danger)";
        }
      }
    });
  }
}

function populateFeaturedServices() {
  const container = document.getElementById("featuredCards");
  if (!container) return;
  container.innerHTML = "";
  services.slice(0, 6).forEach((service) => {
    const card = document.createElement("article");
    card.className = "service-card";
    card.innerHTML = `<i class="${service.icon}"></i><h3>${service.name}</h3><p>${service.desc}</p><strong>Estimate: ₹${service.price}</strong>`;
    container.appendChild(card);
  });
}

function populateServicesPage() {
  const container = document.getElementById("serviceCards");
  if (!container) return;
  const searchInput = document.getElementById("serviceSearchInput");
  const query = searchInput ? searchInput.value.trim().toLowerCase() : "";
  container.innerHTML = "";
  services.filter((s) => !query || s.name.toLowerCase().includes(query)).forEach((service) => {
    const card = document.createElement("article");
    card.className = "service-card";
    card.innerHTML = `<i class="${service.icon}"></i><h3>${service.name}</h3><p>${service.desc}</p><strong>₹${service.price}</strong>`;
    container.appendChild(card);
  });
}

function populateBookingForm() {
  const select = document.getElementById("serviceType");
  if (!select) return;
  select.innerHTML = '<option value="">Select service</option>';
  services.forEach((s) => {
    const option = document.createElement("option");
    option.value = s.name;
    option.textContent = `${s.name} (₹${s.price})`;
    select.appendChild(option);
  });
  select.addEventListener("change", () => {
    const priceInput = document.getElementById("price");
    const selected = services.find((s) => s.name === select.value);
    priceInput.value = selected ? selected.price : "0";
  });
}

async function renderBookings(bookings = [], container) {
  if (!container) return;
  if (!bookings.length) {
    container.innerHTML = "<p>No bookings found.</p>";
    return;
  }

  const user = getCurrentUser();
  const isAdmin = user && user.role === "admin";
  const token = localStorage.getItem("homeease_access_token");

  container.innerHTML = bookings.map((b) => `
    <article class="booking-record">
      <h4>${b.serviceType}</h4>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0;">
        <div>
          <p><strong>Customer:</strong> ${b.name}</p>
          <p><strong>Phone:</strong> ${getWhatsAppPhoneLink(b.phone)}</p>
          <p><strong>Address:</strong> ${getMapAddressLink(b.address)}</p>
          <p><strong>Service Date:</strong> ${b.date}</p>
        </div>
        <div>
          <p><strong>Price:</strong> ₹${b.price}</p>
          <p><strong>Status:</strong> <span class="status-${b.status || 'pending'}" id="status-${b._id}">${b.status || 'pending'}</span></p>
          <p><strong>Followup:</strong> ${b.followupStatus || 'Not set'}</p>
          <p><strong>Booked on:</strong> ${new Date(b.createdAt).toLocaleDateString()}</p>
        </div>
      </div>
      ${b.notes ? `<p><strong>Notes:</strong> ${b.notes}</p>` : ''}
      ${b.userId ? `<p><strong>User ID:</strong> ${b.userId}</p>` : ''}

      ${isAdmin ? `
      <div style="margin-top: 1rem; padding: 1rem; background: var(--light-bg); border-radius: 8px;">
        <div style="display: flex; gap: 1rem; align-items: center; margin-bottom: 1rem;">
          <label style="font-weight: 600;">Update Status:</label>
          <select class="status-select" data-id="${b._id}" style="flex: 1; padding: 0.5rem; border: 1px solid var(--border); border-radius: 4px;">
            <option value="pending" ${b.status === "pending" ? "selected" : ""}>Pending</option>
            <option value="confirmed" ${b.status === "confirmed" ? "selected" : ""}>Confirmed</option>
            <option value="completed" ${b.status === "completed" ? "selected" : ""}>Completed</option>
            <option value="cancelled" ${b.status === "cancelled" ? "selected" : ""}>Cancelled</option>
          </select>
        </div>
        <div style="margin-bottom: 1rem;">
          <label style="font-weight: 600; display: block; margin-bottom: 0.5rem;">Followup Notes:</label>
          <textarea class="followup-textarea" data-id="${b._id}" placeholder="Add followup notes (e.g., customer satisfaction check, warranty follow-up)" style="width: 100%; padding: 0.5rem; border: 1px solid var(--border); border-radius: 4px; min-height: 80px;">${b.followupStatus || ""}</textarea>
        </div>
        <button class="btn btn-primary update-followup-btn" data-id="${b._id}" style="width: 100%;">Update Followup</button>
      </div>
      ` : ''}
    </article>
  `).join("");

  // Add event listeners for status changes (only for admins)
  if (isAdmin && token) {
    container.querySelectorAll(".status-select").forEach(select => {
      select.addEventListener("change", async (e) => {
        const bookingId = e.target.getAttribute("data-id");
        const newStatus = e.target.value;
        try {
          const updateResponse = await fetch(`/api/admin/bookings/${bookingId}/status`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ status: newStatus })
          });
          if (updateResponse.ok) {
            // Update the status display
            const statusSpan = document.getElementById(`status-${bookingId}`);
            if (statusSpan) {
              statusSpan.className = `status-${newStatus}`;
              statusSpan.textContent = newStatus;
            }
          } else {
            alert("Failed to update status");
          }
        } catch (err) {
          console.error("Status update error", err);
          alert("Error updating status");
        }
      });
    });

    // Add event listeners for followup updates (only for admins)
    container.querySelectorAll(".update-followup-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const bookingId = btn.getAttribute("data-id");
        const textarea = container.querySelector(`.followup-textarea[data-id="${bookingId}"]`);
        const followupStatus = textarea ? textarea.value.trim() : "";
        try {
          const updateResponse = await fetch(`/api/admin/bookings/${bookingId}/followup`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ followupStatus })
          });
          if (updateResponse.ok) {
            alert("Followup status updated successfully");
          } else {
            alert("Failed to update followup status");
          }
        } catch (err) {
          console.error("Followup update error", err);
          alert("Error updating followup status");
        }
      });
    });
  }
}

async function fetchMyBookings(phone = "") {
  const container = document.getElementById("bookingsContainer");
  if (!container) return;

  const token = localStorage.getItem("homeease_access_token");
  if (!token) {
    container.innerHTML = "<p>Please log in to view your bookings.</p>";
    return [];
  }

  try {
    let url = "/api/my-bookings";
    if (phone) {
      url += `?phone=${encodeURIComponent(phone)}`;
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error(`API ${response.status}`);
    }

    const bookings = await response.json();
    await renderBookings(bookings, container);
    return bookings;
  } catch (err) {
    console.warn("API fetch failed; falling back to localStorage", err);
    const saved = JSON.parse(localStorage.getItem("bookings") || "[]");
    const filtered = phone ? saved.filter((b) => b.phone === phone) : saved;
    await renderBookings(filtered, container);
    return filtered;
  }
}

async function mountRecentBookings() {
  const user = getCurrentUser();
  const phone = user && user.phone ? user.phone : "";

  if (phone) {
    const mb = document.getElementById("bookingMobileSearch");
    if (mb) mb.value = phone;
  }

  await fetchMyBookings(phone);
}

function normalizePaymentLedgerRows(bookings = []) {
  const rows = [];
  bookings.forEach((b) => {
    const bookingId = String(b._id || b.id || "");
    const history = Array.isArray(b.paymentHistory) ? b.paymentHistory : [];
    history.forEach((row) => {
      rows.push({
        bookingId,
        serviceType: b.serviceType || "",
        customerName: b.name || "",
        providerName: b.providerId && typeof b.providerId === "object" ? (b.providerId.name || "") : "",
        amount: Number(row.amount || 0),
        method: row.method || "",
        referenceId: row.referenceId || "",
        notes: row.notes || "",
        transactionDate: row.transactionDate || row.createdAt || ""
      });
    });
  });
  return rows;
}

function downloadTextFile(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportPaymentLedgerCsv() {
  const rows = normalizePaymentLedgerRows(adminBookingSnapshot);
  if (!rows.length) {
    alert("No payment ledger entries found to export.");
    return;
  }

  const header = ["Booking ID", "Service", "Customer", "Provider", "Amount", "Method", "Reference ID", "Transaction Date", "Notes"];
  const csvRows = [header.join(",")];

  rows.forEach((row) => {
    const cols = [
      row.bookingId,
      row.serviceType,
      row.customerName,
      row.providerName,
      row.amount.toFixed(2),
      row.method,
      row.referenceId,
      row.transactionDate ? new Date(row.transactionDate).toISOString() : "",
      row.notes
    ].map((value) => `"${String(value || "").replace(/"/g, '""')}"`);
    csvRows.push(cols.join(","));
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  downloadTextFile(`payment-ledger-${stamp}.csv`, csvRows.join("\n"), "text/csv;charset=utf-8");
}

function exportPaymentLedgerPdf() {
  const rows = normalizePaymentLedgerRows(adminBookingSnapshot);
  if (!rows.length) {
    alert("No payment ledger entries found to export.");
    return;
  }

  const win = window.open("", "_blank", "width=1024,height=768");
  if (!win) {
    alert("Unable to open export window. Please allow popups and try again.");
    return;
  }

  const tableRows = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.bookingId)}</td>
      <td>${escapeHtml(row.serviceType)}</td>
      <td>${escapeHtml(row.customerName)}</td>
      <td>${escapeHtml(row.providerName || "-")}</td>
      <td>Rs ${row.amount.toFixed(2)}</td>
      <td>${escapeHtml(row.method)}</td>
      <td>${escapeHtml(row.referenceId)}</td>
      <td>${escapeHtml(row.transactionDate ? new Date(row.transactionDate).toLocaleString() : "-")}</td>
      <td>${escapeHtml(row.notes || "")}</td>
    </tr>
  `).join("");

  win.document.write(`
    <html>
      <head>
        <title>Payment Ledger Export</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; color: #1f2937; }
          h1 { margin: 0 0 8px; font-size: 22px; }
          p { margin: 0 0 14px; color: #4b5563; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #d1d5db; padding: 6px; text-align: left; vertical-align: top; }
          th { background: #f3f4f6; }
        </style>
      </head>
      <body>
        <h1>Payment Ledger</h1>
        <p>Generated at: ${escapeHtml(new Date().toLocaleString())}</p>
        <table>
          <thead>
            <tr>
              <th>Booking ID</th><th>Service</th><th>Customer</th><th>Provider</th><th>Amount</th><th>Method</th><th>Reference ID</th><th>Transaction Date</th><th>Notes</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

function setupPaymentExportActions() {
  const csvBtn = document.getElementById("exportPaymentsCsvBtn");
  const pdfBtn = document.getElementById("exportPaymentsPdfBtn");
  if (csvBtn && !csvBtn.dataset.bound) {
    csvBtn.dataset.bound = "1";
    csvBtn.addEventListener("click", exportPaymentLedgerCsv);
  }
  if (pdfBtn && !pdfBtn.dataset.bound) {
    pdfBtn.dataset.bound = "1";
    pdfBtn.addEventListener("click", exportPaymentLedgerPdf);
  }
}

async function mountAdminBookings() {
  const container = document.getElementById("adminBookings");
  if (!container) return;

  let providers = [];

  const getProviderOptions = (selectedProviderId = "") => {
    const selected = String(selectedProviderId || "");
    return '<option value="">Unassigned</option>' + providers.map((p) => {
      const pid = String(p._id || p.id || "");
      return `<option value="${escapeHtml(pid)}" ${pid === selected ? "selected" : ""}>${escapeHtml(p.name || "Provider")}</option>`;
    }).join("");
  };

  const renderBookings = (bookings) => {
    adminBookingSnapshot = Array.isArray(bookings) ? bookings : [];
    setupPaymentExportActions();

    container.innerHTML = bookings.length ? bookings.map((b, i) => {
      const bookingId = String(b._id || b.id || "");
      const assignedProviderId = String((b.providerId && (b.providerId._id || b.providerId.id || b.providerId)) || "");
      const assignedProviderName = b.providerId && typeof b.providerId === "object"
        ? (b.providerId.name || "Assigned")
        : (assignedProviderId ? "Assigned" : "Unassigned");
      return `
      <div class="booking-record-card">
        <h4>Booking #${i + 1} - ${b.serviceType}</h4>
        <p><b>Name:</b> ${b.name}</p>
        <p><b>Phone:</b> ${getWhatsAppPhoneLink(b.phone)}</p>
        <p><b>Address:</b> ${getMapAddressLink(b.address)}</p>
        <p><b>Date:</b> ${b.date}</p>
        <p><b>Price:</b> ₹${b.price}</p>
        <p><b>Notes:</b> ${b.notes || "None"}</p>
        <p><b>Status:</b> <span class="status-${b.status}">${b.status}</span></p>
        <p><b>Assigned Provider:</b> ${escapeHtml(assignedProviderName)}</p>
        <label>Assign Provider:</label>
        <select class="assign-provider-select" data-id="${bookingId}">
          ${getProviderOptions(assignedProviderId)}
        </select>
        <button class="btn btn-primary assign-provider-btn" data-id="${bookingId}">Assign Job</button>
        <label>Update Status:</label>
        <select class="status-select" data-id="${bookingId}">
          <option value="pending" ${b.status === "pending" ? "selected" : ""}>Pending</option>
          <option value="confirmed" ${b.status === "confirmed" ? "selected" : ""}>Confirmed</option>
          <option value="completed" ${b.status === "completed" ? "selected" : ""}>Completed</option>
          <option value="cancelled" ${b.status === "cancelled" ? "selected" : ""}>Cancelled</option>
        </select>
        <p><b>Followup Status:</b></p>
        <textarea class="followup-textarea" data-id="${bookingId}" placeholder="Add followup notes (e.g., customer satisfaction check, warranty follow-up)">${b.followupStatus || ""}</textarea>
        <button class="btn btn-outline update-followup-btn" data-id="${bookingId}">Update Followup</button>
        <p><b>Payment:</b></p>
        <select class="payment-status-select" data-id="${bookingId}">
          <option value="unpaid" ${(b.paymentStatus || "unpaid") === "unpaid" ? "selected" : ""}>Unpaid</option>
          <option value="partial" ${(b.paymentStatus || "unpaid") === "partial" ? "selected" : ""}>Partial</option>
          <option value="paid" ${(b.paymentStatus || "unpaid") === "paid" ? "selected" : ""}>Paid</option>
        </select>
        <input type="number" min="0" step="0.01" class="payment-amount-input" data-id="${bookingId}" value="${Number(b.amountPaid || 0)}" placeholder="Amount paid" />
        <button class="btn btn-outline update-payment-btn" data-id="${bookingId}">Update Payment</button>
        <label>Add Payment Transaction:</label>
        <input type="number" min="0.01" step="0.01" class="payment-ledger-amount" data-id="${bookingId}" placeholder="Amount" />
        <input type="text" class="payment-ledger-method" data-id="${bookingId}" placeholder="Method (UPI/Cash/Card)" />
        <input type="text" class="payment-ledger-ref" data-id="${bookingId}" placeholder="Reference ID" />
        <input type="date" class="payment-ledger-date" data-id="${bookingId}" />
        <input type="text" class="payment-ledger-notes" data-id="${bookingId}" placeholder="Notes (optional)" />
        <button class="btn btn-primary add-payment-ledger-btn" data-id="${bookingId}">Add Payment Entry</button>
        <p><b>Payment Ledger:</b></p>
        ${renderPaymentHistoryList(b.paymentHistory || [])}
        <p><b>Work Photos:</b></p>
        ${renderWorkPhotosList((b.workPhotos && b.workPhotos.before) || [], "Before Photos", { canDelete: false })}
        ${renderWorkPhotosList((b.workPhotos && b.workPhotos.after) || [], "After Photos", { canDelete: false })}
      </div>
    `;
    }).join("") : "<p>No bookings found.</p>";

    // Add event listeners for status changes
    container.querySelectorAll(".status-select").forEach(select => {
      select.addEventListener("change", async (e) => {
        const bookingId = e.target.getAttribute("data-id");
        const newStatus = e.target.value;
        try {
          const updateResponse = await fetch(`/api/admin/bookings/${bookingId}/status`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ status: newStatus })
          });
          if (updateResponse.ok) {
            // Update the status display
            const statusSpan = e.target.parentElement.querySelector(`span[class^="status-"]`);
            statusSpan.className = `status-${newStatus}`;
            statusSpan.textContent = newStatus;
          } else {
            alert("Failed to update status");
          }
        } catch (err) {
          console.error("Status update error", err);
          alert("Error updating status");
        }
      });
    });

    // Add event listeners for followup updates
    container.querySelectorAll(".update-followup-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const bookingId = btn.getAttribute("data-id");
        const textarea = btn.parentElement.querySelector(`.followup-textarea[data-id="${bookingId}"]`);
        const followupStatus = textarea.value.trim();
        try {
          const updateResponse = await fetch(`/api/admin/bookings/${bookingId}/followup`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ followupStatus })
          });
          if (updateResponse.ok) {
            alert("Followup status updated successfully");
          } else {
            alert("Failed to update followup status");
          }
        } catch (err) {
          console.error("Followup update error", err);
          alert("Error updating followup status");
        }
      });
    });

    container.querySelectorAll(".assign-provider-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const bookingId = btn.getAttribute("data-id");
        const providerSelect = container.querySelector(`.assign-provider-select[data-id="${bookingId}"]`);
        const providerId = providerSelect ? providerSelect.value : "";
        if (!providerId) {
          alert("Please select a provider");
          return;
        }

        try {
          const response = await fetch(`/api/admin/bookings/${bookingId}/assign`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ providerId })
          });
          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.message || "Failed to assign provider");
          }
          alert("Job assigned successfully");
          await mountAdminBookings();
        } catch (error) {
          alert(error.message || "Error assigning provider");
        }
      });
    });

    container.querySelectorAll(".update-payment-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const bookingId = btn.getAttribute("data-id");
        const statusSelect = container.querySelector(`.payment-status-select[data-id="${bookingId}"]`);
        const amountInput = container.querySelector(`.payment-amount-input[data-id="${bookingId}"]`);
        const paymentStatus = statusSelect ? statusSelect.value : "unpaid";
        const amountPaid = amountInput ? Number(amountInput.value || 0) : 0;

        try {
          const response = await fetch(`/api/admin/bookings/${bookingId}/payment`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ paymentStatus, amountPaid })
          });
          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.message || "Failed to update payment");
          }
          alert("Payment updated successfully");
          await mountAdminBookings();
        } catch (error) {
          alert(error.message || "Error updating payment");
        }
      });
    });

    container.querySelectorAll(".add-payment-ledger-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const bookingId = btn.getAttribute("data-id");
        const amountInput = container.querySelector(`.payment-ledger-amount[data-id="${bookingId}"]`);
        const methodInput = container.querySelector(`.payment-ledger-method[data-id="${bookingId}"]`);
        const refInput = container.querySelector(`.payment-ledger-ref[data-id="${bookingId}"]`);
        const dateInput = container.querySelector(`.payment-ledger-date[data-id="${bookingId}"]`);
        const notesInput = container.querySelector(`.payment-ledger-notes[data-id="${bookingId}"]`);

        const amount = amountInput ? Number(amountInput.value || 0) : 0;
        const method = methodInput ? methodInput.value.trim() : "";
        const referenceId = refInput ? refInput.value.trim() : "";
        const transactionDate = dateInput && dateInput.value ? `${dateInput.value}T00:00:00.000Z` : new Date().toISOString();
        const notes = notesInput ? notesInput.value.trim() : "";

        try {
          const response = await fetch(`/api/admin/bookings/${bookingId}/payment-history`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ amount, method, referenceId, transactionDate, notes })
          });
          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.message || "Failed to add payment entry");
          }

          alert("Payment transaction added");
          await mountAdminBookings();
          await mountAdminStats();
        } catch (error) {
          alert(error.message || "Error adding payment entry");
        }
      });
    });
  };

  const token = localStorage.getItem("homeease_access_token");
  if (token) {
    try {
      const providersRes = await fetch("/api/admin/providers", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (providersRes.ok) {
        providers = await providersRes.json();
      }

      const response = await fetch("/api/admin/bookings", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        const apiData = await response.json();
        return renderBookings(apiData);
      }
      if (response.status === 401) {
        const newToken = await refreshAccessToken();
        if (newToken) {
          const retry = await fetch("/api/admin/bookings", {
            headers: { Authorization: `Bearer ${newToken}` }
          });
          if (retry.ok) {
            const apiData = await retry.json();
            return renderBookings(apiData);
          }
        }
      }
      console.warn("Admin API load failed", response.status);
    } catch (err) {
      console.warn("Admin API error", err);
    }
  }

  const saved = JSON.parse(localStorage.getItem("bookings") || "[]");
  renderBookings(saved);
}

async function mountAdminStats() {
  const totalBookingsEl = document.getElementById("totalBookings");
  const pendingApprovalsEl = document.getElementById("pendingApprovals");
  const totalProvidersEl = document.getElementById("totalProviders");

  if (!totalBookingsEl || !pendingApprovalsEl || !totalProvidersEl) return;

  const token = localStorage.getItem("homeease_access_token");
  if (!token) return;

  try {
    // Fetch bookings count
    const bookingsResponse = await fetch("/api/admin/bookings", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (bookingsResponse.ok) {
      const bookings = await bookingsResponse.json();
      totalBookingsEl.textContent = bookings.length;
    }

    // Fetch pending users count
    const pendingResponse = await fetch("/api/admin/pending-users", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (pendingResponse.ok) {
      const pending = await pendingResponse.json();
      pendingApprovalsEl.textContent = pending.length;
    }

    // Fetch providers count
    const providersResponse = await fetch("/api/admin/providers", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (providersResponse.ok) {
      const providers = await providersResponse.json();
      totalProvidersEl.textContent = providers.length;
    }
  } catch (err) {
    console.error("Stats load error", err);
  }
}

async function mountPendingUsers() {
  const container = document.getElementById("pendingUsers");
  if (!container) return;

  const token = localStorage.getItem("homeease_access_token");
  if (!token) return;

  try {
    const response = await fetch("/api/admin/pending-users", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.ok) {
      const users = await response.json();
      container.innerHTML = users.length ? users.map(u => `
        <div class="booking-record-card">
          <h4>${u.name} (${u.role})</h4>
          <p><b>Email:</b> ${u.email}</p>
          <p><b>Registered:</b> ${new Date(u.createdAt).toLocaleDateString()}</p>
          <button class="btn btn-primary approve-btn" data-id="${u._id}">Approve</button>
        </div>
      `).join("") : "<p>No pending users.</p>";

      // Add event listeners to approve buttons
      container.querySelectorAll(".approve-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const userId = btn.getAttribute("data-id");
          try {
            const approveResponse = await fetch(`/api/admin/approve-user/${userId}`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` }
            });
            if (approveResponse.ok) {
              btn.textContent = "Approved";
              btn.disabled = true;
              btn.classList.add("btn-outline");
            } else {
              alert("Failed to approve user");
            }
          } catch (err) {
            console.error("Approve error", err);
            alert("Error approving user");
          }
        });
      });
    } else {
      container.innerHTML = "<p>Failed to load pending users.</p>";
    }
  } catch (err) {
    console.error("Pending users error", err);
    container.innerHTML = "<p>Error loading pending users.</p>";
  }
}

async function mountProviderDetails() {
  const container = document.getElementById("providerDetails");
  if (!container) return;

  const token = localStorage.getItem("homeease_access_token");
  if (!token) return;

  try {
    const response = await fetch("/api/admin/providers", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.ok) {
      const providers = await response.json();
      container.innerHTML = providers.length ? providers.map(p => `
        <div class="booking-record-card">
          <h4>${p.name}</h4>
          <p><b>Email:</b> ${p.email}</p>
          <p><b>Joined:</b> ${new Date(p.createdAt).toLocaleDateString()}</p>
        </div>
      `).join("") : "<p>No approved providers.</p>";
    } else {
      container.innerHTML = "<p>Failed to load provider details.</p>";
    }
  } catch (err) {
    console.error("Provider details error", err);
    container.innerHTML = "<p>Error loading provider details.</p>";
  }
}

// User management functions
async function searchUsers(query) {
  const token = localStorage.getItem("homeease_access_token");
  if (!token) return [];

  try {
    const response = await fetch(`/api/admin/users/search?q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.ok) {
      return await response.json();
    }
  } catch (err) {
    console.error("User search error", err);
  }
  return [];
}

async function getUserDetails(userId) {
  const token = localStorage.getItem("homeease_access_token");
  if (!token) return null;

  try {
    const response = await fetch(`/api/admin/users/${userId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.ok) {
      return await response.json();
    }
  } catch (err) {
    console.error("User details error", err);
  }
  return null;
}

async function updateUser(userId, userData) {
  const token = localStorage.getItem("homeease_access_token");
  if (!token) return { success: false, message: "Not authenticated" };

  try {
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(userData)
    });
    const data = await response.json();
    return {
      success: response.ok,
      message: data.message,
      user: data.user
    };
  } catch (err) {
    console.error("User update error", err);
    return { success: false, message: "Network error" };
  }
}

function setupUserManagement() {
  const searchBtn = document.getElementById("searchUserBtn");
  const searchInput = document.getElementById("userSearch");
  const userDetails = document.getElementById("userDetails");
  const userForm = document.getElementById("userUpdateForm");
  const messageEl = document.getElementById("userUpdateMessage");

  if (!searchBtn || !searchInput || !userDetails || !userForm) return;

  searchBtn.addEventListener("click", async () => {
    const query = searchInput.value.trim();
    if (!query) {
      alert("Please enter a search query");
      return;
    }

    const users = await searchUsers(query);
    if (users.length === 0) {
      alert("No users found");
      userDetails.style.display = "none";
      return;
    }

    if (users.length === 1) {
      // Directly load the user
      loadUserForEditing(users[0]);
    } else {
      // Show selection dialog
      const userList = users.map(u => `${u.name} (${u.email})`).join("\n");
      const selectedIndex = prompt(`Multiple users found:\n${userList}\n\nEnter the number (1-${users.length}) to select:`);
      const index = parseInt(selectedIndex) - 1;
      if (index >= 0 && index < users.length) {
        loadUserForEditing(users[index]);
      }
    }
  });

  userForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const userId = document.getElementById("userId").value;
    const userData = {
      name: document.getElementById("userName").value.trim(),
      email: document.getElementById("userEmail").value.trim(),
      phone: document.getElementById("userPhone").value.trim(),
      password: document.getElementById("userPassword").value,
      role: document.getElementById("userRole").value,
      status: document.getElementById("userStatus").value
    };

    messageEl.textContent = "Updating user...";
    messageEl.style.color = "var(--primary-dark)";

    const result = await updateUser(userId, userData);

    if (result.success) {
      messageEl.textContent = result.message;
      messageEl.style.color = "var(--success)";
      // Clear password field
      document.getElementById("userPassword").value = "";
    } else {
      messageEl.textContent = result.message;
      messageEl.style.color = "var(--danger)";
    }
  });
}

function loadUserForEditing(user) {
  document.getElementById("userId").value = user._id;
  document.getElementById("userName").value = user.name;
  document.getElementById("userEmail").value = user.email;
  document.getElementById("userPhone").value = user.phone;
  document.getElementById("userRole").value = user.role;
  document.getElementById("userStatus").value = user.status;
  document.getElementById("userPassword").value = ""; // Clear password field
  document.getElementById("userDetails").style.display = "block";
  document.getElementById("userUpdateMessage").textContent = "";
}

// User dashboard functions
async function loadUserProfile() {
  const container = document.getElementById("userProfile");
  if (!container) return;

  const token = localStorage.getItem("homeease_access_token");
  if (!token) {
    container.innerHTML = "<p>Please log in to view your profile.</p>";
    return;
  }

  try {
    const response = await fetch("/api/profile", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.ok) {
      const user = await response.json();
      document.getElementById("userName").textContent = user.name;
      document.getElementById("userEmail").textContent = user.email;
      document.getElementById("userPhone").textContent = user.phone;
      document.getElementById("userRole").textContent = `Role: ${user.role}`;
    } else {
      container.innerHTML = "<p>Failed to load profile.</p>";
    }
  } catch (err) {
    console.error("Profile load error", err);
    container.innerHTML = "<p>Error loading profile.</p>";
  }
}

async function loadUserBookings() {
  const container = document.getElementById("userBookings");
  if (!container) return;

  const token = localStorage.getItem("homeease_access_token");
  if (!token) {
    container.innerHTML = "<p>Please log in to view your bookings.</p>";
    return;
  }

  try {
    const response = await fetch("/api/my-bookings", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.ok) {
      const bookings = await response.json();
      await renderBookings(bookings, container);
    } else {
      container.innerHTML = "<p>Failed to load bookings.</p>";
    }
  } catch (err) {
    console.error("User bookings load error", err);
    container.innerHTML = "<p>Error loading bookings.</p>";
  }
}

// Admin user management functions
async function loadUserStats() {
  const statsContainer = document.getElementById("userStats");
  if (!statsContainer) return;

  const token = localStorage.getItem("homeease_access_token");
  if (!token) return;

  try {
    const response = await fetch("/api/admin/user-stats", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.ok) {
      const stats = await response.json();
      document.getElementById("totalUsers").textContent = stats.totalUsers;
      document.getElementById("totalProviders").textContent = stats.totalProviders;
      document.getElementById("totalAdmins").textContent = stats.totalAdmins;
      document.getElementById("pendingUsers").textContent = stats.pendingUsers;
    }
  } catch (err) {
    console.error("User stats load error", err);
  }
}

async function loadAllUsers(search = "", role = "", status = "") {
  const container = document.getElementById("usersList");
  if (!container) return;

  const token = localStorage.getItem("homeease_access_token");
  if (!token) return;

  try {
    let url = "/api/admin/all-users";
    const params = new URLSearchParams();
    if (search) params.append("search", search);
    if (role) params.append("role", role);
    if (status) params.append("status", status);
    if (params.toString()) url += "?" + params.toString();

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.ok) {
      const users = await response.json();
      container.innerHTML = users.length ? users.map(u => `
        <div class="booking-record-card">
          <h4>${u.name}</h4>
          <p><b>Email:</b> ${u.email}</p>
          <p><b>Phone:</b> ${getWhatsAppPhoneLink(u.phone)}</p>
          <p><b>Role:</b> ${u.role}</p>
          <p><b>Status:</b> <span class="status-${u.status}">${u.status}</span></p>
          <p><b>Joined:</b> ${new Date(u.createdAt).toLocaleDateString()}</p>
          <button class="btn btn-primary edit-user-btn" data-id="${u._id}" style="margin-right: 0.5rem;">Edit</button>
          <button class="btn btn-outline delete-user-btn" data-id="${u._id}" style="background: var(--danger); color: white; border-color: var(--danger);">Delete</button>
        </div>
      `).join("") : "<p>No users found.</p>";

      // Add event listeners
      container.querySelectorAll(".edit-user-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const userId = btn.getAttribute("data-id");
          const user = users.find(u => u._id === userId);
          if (user) loadUserForEditing(user);
        });
      });

      container.querySelectorAll(".delete-user-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          if (confirm("Are you sure you want to delete this user and all their bookings?")) {
            const userId = btn.getAttribute("data-id");
            await deleteUser(userId);
            await loadAllUsers(search, role, status); // Refresh list
          }
        });
      });
    } else {
      container.innerHTML = "<p>Failed to load users.</p>";
    }
  } catch (err) {
    console.error("Users load error", err);
    container.innerHTML = "<p>Error loading users.</p>";
  }
}

async function deleteUser(userId) {
  const token = localStorage.getItem("homeease_access_token");
  if (!token) return { success: false, message: "Not authenticated" };

  try {
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();
    return {
      success: response.ok,
      message: data.message
    };
  } catch (err) {
    console.error("User delete error", err);
    return { success: false, message: "Network error" };
  }
}

// Provider dashboard functions
async function loadProviderProfile() {
  const container = document.getElementById("providerProfile");
  if (!container) return;

  const token = localStorage.getItem("homeease_access_token");
  if (!token) {
    container.innerHTML = "<p>Please log in to view your profile.</p>";
    return;
  }

  try {
    const response = await fetch("/api/profile", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.ok) {
      const user = await response.json();

      const providerNameEl = document.getElementById("providerName");
      const providerEmailEl = document.getElementById("providerEmail");
      const providerPhoneEl = document.getElementById("providerPhone");
      const providerStatusEl = document.getElementById("providerStatus");

      // Backward-compatible: support both old ID-based markup and new container-only layout.
      if (providerNameEl && providerEmailEl && providerPhoneEl) {
        providerNameEl.textContent = user.name || "-";
        providerEmailEl.textContent = user.email || "-";
        providerPhoneEl.textContent = user.phone || "-";
        if (providerStatusEl) providerStatusEl.textContent = "Status: Active";
      } else {
        container.innerHTML = `
          <p><strong>Name:</strong> ${user.name || "-"}</p>
          <p><strong>Email:</strong> ${user.email || "-"}</p>
          <p><strong>Phone:</strong> ${getWhatsAppPhoneLink(user.phone || "-")}</p>
          <p><strong>Status:</strong> Active</p>
        `;
      }
    } else {
      container.innerHTML = "<p>Failed to load profile.</p>";
    }
  } catch (err) {
    console.error("Provider profile load error", err);
    container.innerHTML = "<p>Error loading profile.</p>";
  }
}

async function loadProviderStats() {
  const statsContainer = document.getElementById("providerStats");
  if (!statsContainer) return;

  const token = localStorage.getItem("homeease_access_token");
  if (!token) return;

  try {
    const response = await fetch("/api/provider/stats", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.ok) {
      const stats = await response.json();
      document.getElementById("totalBookings").textContent = stats.totalBookings;
      document.getElementById("completedBookings").textContent = stats.completedBookings;
      document.getElementById("pendingBookings").textContent = stats.pendingBookings;
      document.getElementById("totalEarnings").textContent = `₹${stats.totalEarnings}`;
    }
  } catch (err) {
    console.error("Provider stats load error", err);
  }
}

async function loadProviderBookings(status = "") {
  const container = document.getElementById("providerBookings");
  if (!container) return;

  const token = localStorage.getItem("homeease_access_token");
  if (!token) {
    container.innerHTML = "<p>Please log in to view bookings.</p>";
    return;
  }

  try {
    let url = "/api/provider/bookings";
    if (status) url += `?status=${status}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.ok) {
      const bookings = await response.json();
      const user = getCurrentUser();
      const myProviderId = String((user && user.id) || (user && user._id) || "");

      container.innerHTML = bookings.length ? bookings.map((b) => {
        const bookingProviderId = String(
          (b.providerId && (b.providerId._id || b.providerId.id || b.providerId)) || ""
        );
        const isMine = bookingProviderId && bookingProviderId === myProviderId;
        const canAccept = b.status === "pending" && !bookingProviderId;

        return `
        <div class="booking-record-card">
          <h4>${b.serviceType}</h4>
          <p><b>Customer:</b> ${b.name}</p>
          <p><b>Phone:</b> ${getWhatsAppPhoneLink(b.phone)}</p>
          <p><b>Address:</b> ${getMapAddressLink(b.address)}</p>
          <p><b>Date:</b> ${b.date}</p>
          <p><b>Price:</b> ₹${b.price}</p>
          <p><b>Status:</b> <span class="status-${b.status}">${b.status}</span></p>
          <p><b>Payment:</b> ${(b.paymentStatus || "unpaid")} (₹${Number(b.amountPaid || 0).toFixed(2)} paid)</p>
          ${b.completedAt ? `<p><b>Completed On:</b> ${new Date(b.completedAt).toLocaleString()}</p>` : ""}
          ${b.notes ? `<p><b>Notes:</b> ${b.notes}</p>` : ""}
          ${b.followupStatus ? `<p><b>Followup:</b> ${b.followupStatus}</p>` : ""}
          ${renderPaymentHistoryList(b.paymentHistory || [])}
          ${renderWorkPhotosList((b.workPhotos && b.workPhotos.before) || [], "Before Photos", { canDelete: isMine, bookingId: (b._id || b.id), phase: "before" })}
          ${renderWorkPhotosList((b.workPhotos && b.workPhotos.after) || [], "After Photos", { canDelete: isMine, bookingId: (b._id || b.id), phase: "after" })}
          ${canAccept ? `<button class="btn btn-primary provider-accept-btn" data-id="${b._id || b.id}">Accept Booking</button>` : ""}
          ${isMine ? `<div class="provider-update-box" style="margin-top: 0.75rem;">
            <label style="display:block; font-weight:600; margin-bottom:0.35rem;">Update Status</label>
            <select class="provider-status-select" data-id="${b._id || b.id}" style="width:100%; padding:0.5rem; border:1px solid var(--border); border-radius:8px; margin-bottom:0.5rem;">
              <option value="pending" ${b.status === "pending" ? "selected" : ""}>Pending</option>
              <option value="confirmed" ${b.status === "confirmed" ? "selected" : ""}>Confirmed</option>
              <option value="completed" ${b.status === "completed" ? "selected" : ""}>Completed</option>
              <option value="cancelled" ${b.status === "cancelled" ? "selected" : ""}>Cancelled</option>
            </select>
            <label style="display:block; font-weight:600; margin-bottom:0.35rem;">Update Followup</label>
            <textarea class="provider-followup-textarea" data-id="${b._id || b.id}" placeholder="Add or update followup..." style="width:100%; min-height:70px; padding:0.5rem; border:1px solid var(--border); border-radius:8px; margin-bottom:0.5rem;">${b.followupStatus || ""}</textarea>
            <button class="btn btn-outline provider-update-btn" data-id="${b._id || b.id}" style="width:100%;">Update Booking</button>
            <label style="display:block; font-weight:600; margin:0.6rem 0 0.35rem;">Upload Before Photo</label>
            <input type="file" accept="image/*" class="provider-before-photo-input" data-id="${b._id || b.id}" style="margin-bottom:0.4rem;" />
            <label style="display:block; font-weight:600; margin-bottom:0.35rem;">Upload After Photo</label>
            <input type="file" accept="image/*" class="provider-after-photo-input" data-id="${b._id || b.id}" style="margin-bottom:0.5rem;" />
            <button class="btn btn-primary provider-photo-upload-btn" data-id="${b._id || b.id}" style="width:100%;">Upload Work Photos</button>
          </div>` : ""}
        </div>
      `;
      }).join("") : "<p>No bookings found.</p>";

      container.querySelectorAll(".provider-accept-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const bookingId = btn.getAttribute("data-id");
          btn.disabled = true;
          btn.textContent = "Accepting...";
          try {
            const acceptRes = await fetch(`/api/provider/bookings/${bookingId}/accept`, {
              method: "PUT",
              headers: { Authorization: `Bearer ${token}` }
            });
            const data = await acceptRes.json();
            if (!acceptRes.ok) throw new Error(data.message || "Failed to accept booking");
            await loadProviderStats();
            await loadProviderBookings(status);
          } catch (error) {
            alert(error.message || "Failed to accept booking");
            btn.disabled = false;
            btn.textContent = "Accept Booking";
          }
        });
      });

      container.querySelectorAll(".provider-update-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const bookingId = btn.getAttribute("data-id");
          const statusSelect = container.querySelector(`.provider-status-select[data-id="${bookingId}"]`);
          const followupTextarea = container.querySelector(`.provider-followup-textarea[data-id="${bookingId}"]`);

          const nextStatus = statusSelect ? statusSelect.value : undefined;
          const nextFollowup = followupTextarea ? followupTextarea.value.trim() : "";

          btn.disabled = true;
          btn.textContent = "Updating...";

          try {
            const updateRes = await fetch(`/api/provider/bookings/${bookingId}/update`, {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
              },
              body: JSON.stringify({ status: nextStatus, followupStatus: nextFollowup })
            });
            const data = await updateRes.json();
            if (!updateRes.ok) throw new Error(data.message || "Failed to update booking");

            await loadProviderStats();
            await loadProviderBookings(status);
          } catch (error) {
            alert(error.message || "Failed to update booking");
            btn.disabled = false;
            btn.textContent = "Update Booking";
          }
        });
      });

      container.querySelectorAll(".provider-photo-upload-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const bookingId = btn.getAttribute("data-id");
          const beforeInput = container.querySelector(`.provider-before-photo-input[data-id="${bookingId}"]`);
          const afterInput = container.querySelector(`.provider-after-photo-input[data-id="${bookingId}"]`);
          const beforeFile = beforeInput && beforeInput.files && beforeInput.files[0];
          const afterFile = afterInput && afterInput.files && afterInput.files[0];

          if (!beforeFile && !afterFile) {
            alert("Select at least one image before uploading");
            return;
          }

          const formData = new FormData();
          if (beforeFile) formData.append("beforePhoto", beforeFile);
          if (afterFile) formData.append("afterPhoto", afterFile);

          btn.disabled = true;
          btn.textContent = "Uploading...";

          try {
            const uploadRes = await fetch(`/api/provider/bookings/${bookingId}/photos`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
              body: formData
            });
            const data = await uploadRes.json();
            if (!uploadRes.ok) throw new Error(data.message || "Failed to upload photos");

            await loadProviderBookings(status);
          } catch (error) {
            alert(error.message || "Failed to upload photos");
            btn.disabled = false;
            btn.textContent = "Upload Work Photos";
          }
        });
      });

      container.querySelectorAll(".work-photo-delete-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const bookingId = btn.getAttribute("data-booking-id");
          const phase = btn.getAttribute("data-phase");
          const url = btn.getAttribute("data-url");
          if (!bookingId || !phase || !url) return;

          const shouldDelete = window.confirm("Delete this uploaded photo?");
          if (!shouldDelete) return;

          btn.disabled = true;
          btn.textContent = "Deleting...";

          try {
            const delRes = await fetch(`/api/provider/bookings/${encodeURIComponent(bookingId)}/photos`, {
              method: "DELETE",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
              },
              body: JSON.stringify({ phase, url })
            });
            const data = await delRes.json();
            if (!delRes.ok) throw new Error(data.message || "Failed to delete photo");

            await loadProviderBookings(status);
          } catch (error) {
            alert(error.message || "Failed to delete photo");
            btn.disabled = false;
            btn.textContent = "Delete";
          }
        });
      });
    } else {
      container.innerHTML = "<p>Failed to load bookings.</p>";
    }
  } catch (err) {
    console.error("Provider bookings load error", err);
    container.innerHTML = "<p>Error loading bookings.</p>";
  }
}

async function loadAllBookings() {
  const container = document.getElementById("bookingsContainer");
  const countElement = document.getElementById("bookingCount");
  if (!container) return;

  if (countElement) countElement.textContent = "Loading bookings...";

  const token = localStorage.getItem("homeease_access_token");
  if (!token) {
    container.innerHTML = "<p>Please log in to view bookings.</p>";
    if (countElement) countElement.textContent = "Not logged in";
    return;
  }

  try {
    // Try admin endpoint first, fallback to general bookings endpoint
    let response = await fetch("/api/admin/bookings", {
      headers: { Authorization: `Bearer ${token}` }
    });

    // If admin endpoint fails (not admin), try general bookings endpoint
    if (!response.ok) {
      response = await fetch("/api/bookings");
    }

    if (response.ok) {
      const bookings = await response.json();
      if (countElement) countElement.textContent = `${bookings.length} booking${bookings.length !== 1 ? 's' : ''} found`;
      await renderBookings(bookings, container);
    } else {
      container.innerHTML = "<p>Failed to load bookings.</p>";
      if (countElement) countElement.textContent = "Failed to load";
    }
  } catch (err) {
    console.error("Load all bookings error", err);
    container.innerHTML = "<p>Error loading bookings.</p>";
    if (countElement) countElement.textContent = "Error loading";
  }
}

async function loadContacts(search = "") {
  const container = document.getElementById("contactsContainer");
  const countElement = document.getElementById("contactCount");
  if (!container) return;

  if (countElement) countElement.textContent = "Loading messages...";

  const token = localStorage.getItem("homeease_access_token");
  if (!token) {
    container.innerHTML = "<p>Please log in to view contacts.</p>";
    if (countElement) countElement.textContent = "Not logged in";
    return;
  }

  try {
    let url = "/api/contact";
    if (search) {
      url += `?search=${encodeURIComponent(search)}`;
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (response.ok) {
      const contacts = await response.json();
      if (countElement) countElement.textContent = `${contacts.length} message${contacts.length !== 1 ? 's' : ''} found`;
      renderContacts(contacts, container);
    } else {
      container.innerHTML = "<p>Failed to load contacts.</p>";
      if (countElement) countElement.textContent = "Failed to load";
    }
  } catch (err) {
    console.error("Load contacts error", err);
    container.innerHTML = "<p>Error loading contacts.</p>";
    if (countElement) countElement.textContent = "Error loading";
  }
}

function renderContacts(contacts, container) {
  if (!container) return;
  if (!contacts.length) {
    container.innerHTML = "<p>No contact messages found.</p>";
    return;
  }

  container.innerHTML = contacts.map((contact) => `
    <article class="booking-record">
      <h4>${contact.subject}</h4>
      <div class="contact-message-meta">
        <div>
          <p><strong>From:</strong> ${contact.name}</p>
          <p><strong>Email:</strong> <a class="contact-email-link" href="mailto:${contact.email}">${contact.email}</a></p>
          <p><strong>Phone:</strong> ${getWhatsAppPhoneLink(contact.phone || "")}</p>
          <p><strong>Received:</strong> ${new Date(contact.createdAt).toLocaleDateString()}</p>
        </div>
        <div>
          <p><strong>Time:</strong> ${new Date(contact.createdAt).toLocaleTimeString()}</p>
          <p><strong>Message:</strong></p>
        </div>
      </div>
      <div class="contact-message-body">
        <p>${contact.message}</p>
      </div>
    </article>
  `).join("");
}

function setupContactSearch() {
  const searchBtn = document.getElementById("searchContacts");
  const clearBtn = document.getElementById("clearContactSearch");
  const searchInput = document.getElementById("contactSearch");

  if (!searchBtn || !searchInput) return;

  searchBtn.addEventListener("click", async () => {
    const search = searchInput.value.trim();
    await loadContacts(search);
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      searchInput.value = "";
      await loadContacts();
    });
  }

  // Allow search on Enter key
  searchInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      searchBtn.click();
    }
  });
}

async function mountTestimonials() {
  const container = document.getElementById("testimonials");
  if (!container) return;

  try {
    const res = await fetch("/api/testimonials");
    if (res.ok) {
      const data = await res.json();
      if (data.length) {
        container.innerHTML = data.map((t) => `
          <article class="testimonial-card">
            <p>${t.content}</p><h4>${t.name}</h4><span>${"⭐".repeat(t.rating)}</span>
          </article>
        `).join("");
        return;
      }
    }
  } catch (err) {
    console.warn("Testimonials API failed", err);
  }

  // Fallback static
  container.innerHTML = testimonialsList.map((t) => `
    <article class="testimonial-card">
      <p>${t.text}</p><h4>${t.name}</h4><span>⭐⭐⭐⭐⭐</span>
    </article>
  `).join("");
}

function setupUserFilters() {
  const searchInput = document.getElementById("userSearch");
  const roleFilter = document.getElementById("roleFilter");
  const statusFilter = document.getElementById("statusFilter");

  const applyFilters = () => {
    const search = searchInput ? searchInput.value.trim() : "";
    const role = roleFilter ? roleFilter.value : "";
    const status = statusFilter ? statusFilter.value : "";
    loadAllUsers(search, role, status);
  };

  if (searchInput) {
    searchInput.addEventListener("input", applyFilters);
  }
  if (roleFilter) {
    roleFilter.addEventListener("change", applyFilters);
  }
  if (statusFilter) {
    statusFilter.addEventListener("change", applyFilters);
  }
}

function setupProviderFilters() {
  const statusFilter = document.getElementById("bookingStatusFilter");

  if (statusFilter) {
    statusFilter.addEventListener("change", () => {
      const status = statusFilter.value;
      loadProviderBookings(status);
    });
  }
}

async function updateUser(event) {
  event.preventDefault();

  const userId = document.getElementById("userId").value;
  const name = document.getElementById("userName").value.trim();
  const email = document.getElementById("userEmail").value.trim();
  const phone = document.getElementById("userPhone").value.trim();
  const role = document.getElementById("userRole").value;
  const status = document.getElementById("userStatus").value;
  const password = document.getElementById("userPassword").value;

  if (!name || !email || !phone) {
    document.getElementById("userUpdateMessage").textContent = "Name, email, and phone are required.";
    document.getElementById("userUpdateMessage").style.color = "var(--danger)";
    return;
  }

  const token = localStorage.getItem("homeease_access_token");
  if (!token) {
    document.getElementById("userUpdateMessage").textContent = "Not authenticated.";
    document.getElementById("userUpdateMessage").style.color = "var(--danger)";
    return;
  }

  try {
    const updateData = { name, email, phone, role, status };
    if (password) updateData.password = password;

    const response = await fetch(`/api/admin/users/${userId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(updateData)
    });

    const data = await response.json();
    document.getElementById("userUpdateMessage").textContent = data.message;
    document.getElementById("userUpdateMessage").style.color = response.ok ? "var(--success)" : "var(--danger)";

    if (response.ok) {
      // Refresh the user list
      const searchInput = document.getElementById("userSearch");
      const roleFilter = document.getElementById("roleFilter");
      const statusFilter = document.getElementById("statusFilter");
      const search = searchInput ? searchInput.value.trim() : "";
      const role = roleFilter ? roleFilter.value : "";
      const status = statusFilter ? statusFilter.value : "";
      await loadAllUsers(search, role, status);

      // Hide the form
      document.getElementById("userDetails").style.display = "none";
    }
  } catch (err) {
    console.error("User update error", err);
    document.getElementById("userUpdateMessage").textContent = "Network error occurred.";
    document.getElementById("userUpdateMessage").style.color = "var(--danger)";
  }
}

function setupBookingSubmit() {
  const form = document.getElementById("bookingForm");
  if (!form) return;

  const user = getCurrentUser();
  const nameInput = document.getElementById("name");
  const phoneInput = document.getElementById("phone");

  if (user) {
    if (nameInput && user.name) {
      nameInput.value = user.name;
      nameInput.readOnly = true;
    }
    if (phoneInput && user.phone) {
      phoneInput.value = user.phone;
      phoneInput.readOnly = true;
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const currentUser = getCurrentUser();
    const name = (currentUser && currentUser.name) ? currentUser.name : document.getElementById("name").value.trim();
    const phone = (currentUser && currentUser.phone) ? currentUser.phone : document.getElementById("phone").value.trim();
    const address = document.getElementById("address").value.trim();
    const date = document.getElementById("date").value;
    const serviceType = document.getElementById("serviceType").value;
    const price = document.getElementById("price").value;
    const notes = document.getElementById("notes").value.trim();
    const msgEl = document.getElementById("bookingMessage");

    const payload = { name, phone, address, date, serviceType, price, notes };
    
    try {
      const headers = { "Content-Type": "application/json" };
    const token = localStorage.getItem("homeease_access_token");
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch("/api/bookings", {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });
      
      if (res.status === 401) {
        // Token expired or invalid, redirect to login
        localStorage.removeItem("homeease_access_token");
        localStorage.removeItem("homeease_refresh_token");
        localStorage.removeItem("homeease_user");
        window.location.href = "login.html";
        return;
      }
      
      if (!res.ok) throw new Error("Network response was not ok");
      const data = await res.json();
      msgEl.textContent = "Booking confirmed! ID: " + data.id;
      msgEl.style.color = "var(--primary-dark)";
      const existing = JSON.parse(localStorage.getItem("bookings") || "[]");
      localStorage.setItem("bookings", JSON.stringify([...existing, payload]));
      mountRecentBookings();
      form.reset();
      document.getElementById("price").value = 0;
    } catch (error) {
      msgEl.textContent = "Booking saved locally. (Server is unavailable).";
      msgEl.style.color = "var(--danger)";
      const existing = JSON.parse(localStorage.getItem("bookings") || "[]");
      localStorage.setItem("bookings", JSON.stringify([...existing, payload]));
      mountRecentBookings();
      console.warn(error);
    }
  });
}

function setupContactForm() {
  const form = document.getElementById("contactForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("contactName").value.trim();
    const email = document.getElementById("contactEmail").value.trim();
    const phone = document.getElementById("contactPhone").value.trim();
    const subject = document.getElementById("contactSubject").value.trim();
    const message = document.getElementById("contactMessage").value.trim();
    const status = document.getElementById("contactStatus");

    if (!/^[0-9]{10}$/.test(phone)) {
      status.textContent = "Please enter a valid 10-digit mobile number.";
      status.style.color = "var(--danger)";
      return;
    }

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, subject, message })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Submit failed");
      status.textContent = "Message sent! We'll contact you soon.";
      status.style.color = "var(--primary-dark)";
      form.reset();
    } catch (err) {
      status.textContent = err.message;
      status.style.color = "var(--danger)";
    }
  });
}

function setupReviewForm() {
  const form = document.getElementById("reviewForm");
  if (!form) return;

  const nameInput = document.getElementById("reviewName");
  const ratingInput = document.getElementById("reviewRating");
  const contentInput = document.getElementById("reviewContent");
  const status = document.getElementById("reviewStatus");
  const user = getCurrentUser();

  if (user && nameInput) {
    nameInput.value = user.name;
    nameInput.readOnly = true;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const token = localStorage.getItem("homeease_access_token");
    if (!token) {
      status.textContent = "Please login first to submit a review.";
      status.style.color = "var(--danger)";
      return;
    }

    const payload = {
      name: nameInput.value.trim(),
      content: contentInput.value.trim(),
      rating: Number(ratingInput.value || 5)
    };

    if (!payload.name || !payload.content) {
      status.textContent = "Name and review content are required.";
      status.style.color = "var(--danger)";
      return;
    }

    try {
      const res = await fetch("/api/testimonials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem("homeease_access_token");
          localStorage.removeItem("homeease_refresh_token");
          localStorage.removeItem("homeease_user");
          window.location.href = "login.html";
          return;
        }
        throw new Error(data.message || "Failed to submit review");
      }

      status.textContent = "Thanks! Your review has been submitted.";
      status.style.color = "var(--primary-dark)";
      form.reset();
      if (user && nameInput) {
        nameInput.value = user.name;
      }
      await mountTestimonials();
    } catch (err) {
      status.textContent = err.message || "Unable to submit review right now.";
      status.style.color = "var(--danger)";
    }
  });
}

function setupAuth() {
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");

  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("registerName").value.trim();
      const email = document.getElementById("registerEmail").value.trim();
      const phone = document.getElementById("registerPhone").value.trim();
      const password = document.getElementById("registerPassword").value;
      const role = document.getElementById("registerRole").value;
      const messageEl = document.getElementById("registerMessage");

      try {
        const res = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, phone, password, role })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Registration failed");

        localStorage.setItem("homeease_access_token", data.accessToken);
        localStorage.setItem("homeease_refresh_token", data.refreshToken);
        localStorage.setItem("homeease_user", JSON.stringify(data.user));
        messageEl.style.color = "var(--primary-dark)";
        if (data.user.role === "user" || data.user.role === "provider") {
          messageEl.textContent = "Account created successfully! Pending admin approval. Admin will approve within 72 hours.";
        } else {
          messageEl.textContent = "Account created successfully! Redirecting...";
          setTimeout(() => window.location.href = "index.html", 1000);
        }
      } catch (err) {
        messageEl.style.color = "var(--danger)";
        messageEl.textContent = err.message;
      }
    });
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("loginEmail").value.trim();
      const phone = document.getElementById("loginPhone").value.trim();
      const password = document.getElementById("loginPassword").value;
      const messageEl = document.getElementById("loginMessage");

      try {
        const loginBody = { password };
        if (phone) loginBody.phone = phone;
        else loginBody.email = email;

        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(loginBody)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Login failed");

        localStorage.setItem("homeease_access_token", data.accessToken);
        localStorage.setItem("homeease_refresh_token", data.refreshToken);
        localStorage.setItem("homeease_user", JSON.stringify(data.user));
        messageEl.style.color = "var(--primary-dark)";
        messageEl.textContent = "Logged in successfully! Redirecting...";
        setTimeout(() => {
          if (data.user.role === "admin") {
            window.location.href = "admin.html";
          } else {
            window.location.href = "index.html";
          }
        }, 1000);
      } catch (err) {
        messageEl.style.color = "var(--danger)";
        messageEl.textContent = err.message;
      }
    });
  }
}

function getCurrentUser() {
  const user = localStorage.getItem("homeease_user");
  return user ? JSON.parse(user) : null;
}

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem("homeease_refresh_token");
  if (!refreshToken) return null;

  try {
    const res = await fetch("/api/refresh-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken })
    });
    if (!res.ok) {
      logout();
      return null;
    }
    const data = await res.json();
    localStorage.setItem("homeease_access_token", data.accessToken);
    return data.accessToken;
  } catch (error) {
    console.warn("refreshAccessToken failed", error);
    logout();
    return null;
  }
}

function logout() {
  const refreshToken = localStorage.getItem("homeease_refresh_token");
  if (refreshToken) {
    fetch("/api/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken })
    }).catch(() => {});
  }
  localStorage.removeItem("homeease_access_token");
  localStorage.removeItem("homeease_refresh_token");
  localStorage.removeItem("homeease_user");
  window.location.href = "login.html";
}

function setupAuthUI() {
  const container = document.querySelector(".nav-actions");
  if (!container) return;

  // Remove existing login button if user is authenticated
  const user = getCurrentUser();
  if (user) {
    const userLbl = document.createElement("span");
    userLbl.textContent = `${user.name} (${user.role})`;
    userLbl.className = "nav-user-label";

    const logoutBtn = document.createElement("button");
    logoutBtn.textContent = "Logout";
    logoutBtn.className = "btn btn-outline";
    logoutBtn.addEventListener("click", logout);

    const adminLink = document.createElement("a");
    if (user.role === "admin") {
      adminLink.href = "admin.html";
      adminLink.textContent = "Admin";
      adminLink.className = "btn btn-outline";
      adminLink.style.marginLeft = "0.35rem";
      container.appendChild(adminLink);
    }

    const loginLink = container.querySelector("a[href='login.html']");
    if (loginLink) loginLink.remove();

    const registerLink = container.querySelector("a[href='register.html']");
    if (registerLink) registerLink.remove();

    container.appendChild(userLbl);
    container.appendChild(logoutBtn);
  }
}

function setupMenuToggle() {
  const menuToggle = document.getElementById("menuToggle");
  const menu = document.getElementById("menu");
  if (!menuToggle || !menu) return;
  menuToggle.addEventListener("click", () => menu.classList.toggle("open"));
}

function setupEstimate() {
  const priceList = document.getElementById("priceList");
  if (!priceList) return;
  priceList.innerHTML = services.map((s) => `<li><span>${s.name}</span><strong>₹${s.price}</strong></li>`).join("");
}

function setupSearchButtons() {
  const serviceSearchBtn = document.getElementById("serviceSearchBtn");
  const homeSearch = document.getElementById("searchBtn");

  if (serviceSearchBtn) serviceSearchBtn.addEventListener("click", populateServicesPage);
  if (homeSearch) homeSearch.addEventListener("click", () => {
    const query = document.getElementById("homeSearch").value.trim();
    localStorage.setItem("serviceFilter", query);
    window.location.href = "services.html";
  });

  const stored = localStorage.getItem("serviceFilter");
  if (stored && document.getElementById("serviceSearchInput")) {
    document.getElementById("serviceSearchInput").value = stored;
    localStorage.removeItem("serviceFilter");
    populateServicesPage();
  }
}

function setupBookingSearch() {
  const searchBtn = document.getElementById("searchBookingByMobile");
  const clearBtn = document.getElementById("clearBookingSearch");
  const phoneInput = document.getElementById("bookingMobileSearch");
  const message = document.getElementById("bookingSearchMessage");

  if (!searchBtn || !phoneInput || !message) return;

  const page = window.location.pathname.split("/").pop();
  const user = getCurrentUser();
  if (page === "booking.html" && user && user.phone) {
    phoneInput.value = user.phone;
    phoneInput.readOnly = true;
    searchBtn.style.display = "none";
    if (clearBtn) clearBtn.style.display = "none";
    message.textContent = `Showing bookings for your login mobile: ${user.phone}`;
    message.style.color = "var(--primary-dark)";
    return;
  }

  // Store all bookings for filtering
  let allBookings = [];

  // Load all bookings initially
  loadAllBookings().then(() => {
    // Get the bookings from the container to store them
    const container = document.getElementById("bookingsContainer");
    if (container) {
      // We can't easily extract bookings from rendered HTML, so we'll reload when filtering
    }
  });

  searchBtn.addEventListener("click", async () => {
    const phone = phoneInput.value.trim();
    if (!/^[0-9]{10}$/.test(phone)) {
      message.textContent = "Enter a valid 10-digit mobile number.";
      message.style.color = "var(--danger)";
      return;
    }

    message.textContent = "Filtering...";
    message.style.color = "var(--primary-dark)";

    const token = localStorage.getItem("homeease_access_token");
    if (!token) {
      message.textContent = "Not authenticated.";
      message.style.color = "var(--danger)";
      return;
    }

    try {
      // Try admin endpoint first, fallback to general bookings endpoint
      let response = await fetch("/api/admin/bookings", {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        response = await fetch("/api/bookings");
      }

      if (response.ok) {
        const bookings = await response.json();
        const filteredBookings = bookings.filter(b => b.phone === phone);

        if (!filteredBookings.length) {
          message.textContent = `No bookings found for ${phone}.`;
          message.style.color = "var(--danger)";
        } else {
          message.textContent = `Found ${filteredBookings.length} booking(s) for ${phone}.`;
          message.style.color = "var(--success)";
          await renderBookings(filteredBookings, document.getElementById("bookingsContainer"));
          document.getElementById("bookingCount").textContent = `Showing ${filteredBookings.length} filtered booking${filteredBookings.length !== 1 ? 's' : ''}`;
        }
      } else {
        message.textContent = "Failed to search bookings.";
        message.style.color = "var(--danger)";
      }
    } catch (err) {
      console.error("Search error", err);
      message.textContent = "Error searching bookings.";
      message.style.color = "var(--danger)";
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      phoneInput.value = "";
      message.textContent = "";
      await loadAllBookings();
    });
  }
}

function scheduleBookingRefresh(task) {
  if (bookingRefreshTimer) clearTimeout(bookingRefreshTimer);
  bookingRefreshTimer = setTimeout(() => {
    bookingRefreshTimer = null;
    task();
  }, 450);
}

function getBookingRefreshTask(page) {
  if (page === "admin.html") {
    return async () => {
      await mountAdminStats();
      await mountAdminBookings();
    };
  }

  if (page === "provider.html") {
    return async () => {
      const filterSelect = document.getElementById("bookingStatusFilter");
      const status = filterSelect ? filterSelect.value : "";
      await loadProviderStats();
      await loadProviderBookings(status);
    };
  }

  return async () => {};
}

function stopBookingFallbackPolling() {
  if (bookingFallbackPollTimer) {
    clearInterval(bookingFallbackPollTimer);
    bookingFallbackPollTimer = null;
  }
}

function startBookingFallbackPolling(page) {
  if (bookingFallbackPollTimer) return;
  const refreshTask = getBookingRefreshTask(page);
  bookingFallbackPollTimer = setInterval(() => {
    refreshTask();
  }, 12000);
}

function setupBookingLiveUpdates(page) {
  if (bookingEventsSource) {
    bookingEventsSource.close();
    bookingEventsSource = null;
  }
  stopBookingFallbackPolling();
  bookingSseDisconnectCount = 0;

  const token = localStorage.getItem("homeease_access_token");
  if (!token) return;

  if (typeof EventSource === "undefined") {
    startBookingFallbackPolling(page);
    return;
  }

  const streamUrl = `/api/stream/bookings?token=${encodeURIComponent(token)}`;
  bookingEventsSource = new EventSource(streamUrl);
  const refreshTask = getBookingRefreshTask(page);

  bookingEventsSource.onopen = () => {
    bookingSseDisconnectCount = 0;
    stopBookingFallbackPolling();
  };

  bookingEventsSource.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data || "{}");
      if (payload.type !== "booking-update") return;

      scheduleBookingRefresh(refreshTask);
    } catch (err) {
      // Ignore malformed SSE payloads.
    }
  };

  bookingEventsSource.onerror = () => {
    bookingSseDisconnectCount += 1;
    if (bookingSseDisconnectCount >= 3) {
      startBookingFallbackPolling(page);
    }
  };
}

function init() {
  const page = window.location.pathname.split("/").pop();
  const user = getCurrentUser();
  checkSystemHealth();

  const isHomePage = page === "index.html" || page === "";
  if (isHomePage && user && user.role === "provider") {
    window.location.href = "provider.html";
    return;
  }

  if (page === "booking.html" && !user) {
    window.location.href = "login.html";
    return;
  }

  if (page === "admin.html") {
    if (!user || user.role !== "admin") {
      window.location.href = "login.html";
      return;
    }
    mountAdminStats();
    mountPendingUsers();
    mountProviderDetails();
    setupUserManagement();
    setupAdminProviderChat();
    setupBookingLiveUpdates(page);
  }

  // Initialize user dashboard
  if (page === "user.html") {
    if (!user || user.role !== "user") {
      window.location.href = "login.html";
      return;
    }
    loadUserProfile();
    loadUserBookings();
  }

  // Initialize admin user management
  if (page === "adminuser.html") {
    if (!user || user.role !== "admin") {
      window.location.href = "login.html";
      return;
    }
    loadUserStats();
    loadAllUsers();
    setupUserFilters();

    // Setup user update form
    const userForm = document.getElementById("userUpdateForm");
    if (userForm) {
      userForm.addEventListener("submit", updateUser);
    }
  }

  // Initialize provider dashboard
  if (page === "provider.html") {
    if (!user || user.role !== "provider") {
      window.location.href = "login.html";
      return;
    }
    loadProviderProfile();
    loadProviderStats();
    loadProviderBookings();
    setupProviderFilters();
    setupProviderAdminChat();
    setupBookingLiveUpdates(page);
  }

  // Initialize booking records page
  if (page === "bookingrecord.html") {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    loadAllBookings();
    setupBookingSearch();
  }

  // Initialize contact admin page
  if (page === "contactadmin.html") {
    if (!user || user.role !== "admin") {
      window.location.href = "login.html";
      return;
    }
    loadContacts();
    setupContactSearch();
  }

  populateFeaturedServices();
  populateServicesPage();
  populateBookingForm();
  mountRecentBookings();
  mountAdminBookings();
  mountTestimonials();
  setupBookingSubmit();
  setupContactForm();
  setupReviewForm();
  setupAuth();
  setupAuthUI();
  setupMenuToggle();
  setupEstimate();
  setupSearchButtons();
  setupBookingSearch();
}

if (document.readyState !== "loading") {
  init();
} else {
  document.addEventListener("DOMContentLoaded", init);
}

window.addEventListener("beforeunload", () => {
  if (bookingEventsSource) {
    bookingEventsSource.close();
    bookingEventsSource = null;
  }
  stopBookingFallbackPolling();
});
