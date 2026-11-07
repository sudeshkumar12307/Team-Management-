import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = n => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const sum = a => a.reduce((t, o) => t + (+o.amount || 0), 0);
const hhmm = t => t ? new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "–";
const list = async (c, f, v) => (await getDocs(query(collection(db, c), where(f, "==", v)))).docs.map(d => ({ id: d.id, ...d.data() }));
const toast = m => { const t = $("#toast"); t.textContent = m; t.classList.remove("hidden"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add("hidden"), 3000); };
const errMsg = e => {
  const c = e.code || "";
  if (c.includes("email-already")) return "This email is already registered.";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "Wrong email or password.";
  if (c.includes("weak-password")) return "Password must be at least 6 characters.";
  if (c.includes("permission-denied")) return "Not allowed for your account.";
  return e.message || "Something went wrong.";
};
const upiLink = (pa, pn, am, tn) => `upi://pay?pa=${encodeURIComponent(pa)}&pn=${encodeURIComponent(pn || "")}${am ? "&am=" + am : ""}&cu=INR&tn=${encodeURIComponent(tn || "")}`;

const ROLE_LABEL = { admin: "Admin", superdistributor: "Super Distributor", distributor: "Distributor", retailer: "Retailer", operator: "Operator" };
const DEFAULT_LEVELS = [{ name: "Trainee", min: 0, extra: 0 }, { name: "Operator", min: 20, extra: 1 }, { name: "Senior", min: 60, extra: 2 }, { name: "Lead", min: 150, extra: 3 }];
const STATUSES = ["received", "processing", "submitted", "completed", "rejected"];
const DEFAULT_SERVICES = [
  ["Photocopy / Xerox", 2, "Print & Copy"], ["Print out (B/W)", 5, "Print & Copy"], ["Print out (Colour)", 15, "Print & Copy"],
  ["Scanning", 10, "Print & Copy"], ["Lamination", 20, "Print & Copy"], ["Binding / Spiral", 40, "Print & Copy"],
  ["Passport size photos", 50, "Photo"], ["Typing / DTP (per page)", 30, "Typing"], ["Resume / CV making", 150, "Typing"],
  ["Online job application", 100, "Online forms"], ["Exam / admission form filling", 100, "Online forms"],
  ["Scholarship application help", 100, "Online forms"], ["Certificate application help (official portal)", 100, "Online forms"],
  ["Bill payment help", 20, "Payments"], ["Ticket booking", 50, "Travel"], ["Email / account creation", 50, "Online forms"],
  ["Document upload / compress", 20, "Online forms"]
];

/* ---------- state ---------- */
const S = { user: null, me: null, owner: null, settings: { feeDistributor: 0, feeSuperDistributor: 0, adminUpi: "", adminUpiName: "" }, of: "open", cm: today().slice(0, 7), tab: "login" };
let registering = false;
const SID = () => S.me.role === "operator" ? S.me.shopId : S.me.id;
const cfgOf = o => ({
  commissionPct: +(o?.commissionPct ?? 10), bonusTarget: +(o?.bonusTarget ?? 50), bonusAmount: +(o?.bonusAmount ?? 500),
  levels: (o?.levels && o.levels.length ? o.levels : DEFAULT_LEVELS)
});
function opStats(orders, opId) {
  const done = orders.filter(o => o.operatorId === opId && o.status === "completed");
  const mo = done.filter(o => (o.date || "").startsWith(today().slice(0, 7)));
  const paid = mo.filter(o => o.payStatus === "paid");
  return { life: done.length, mo: mo.length, rev: sum(paid) };
}
function earnings(level, st, cfg) {
  const lv = cfg.levels.find(l => l.name === level) || cfg.levels[0];
  const pct = cfg.commissionPct + (+lv.extra || 0);
  const base = st.rev * pct / 100;
  const bonus = cfg.bonusTarget > 0 && st.mo >= cfg.bonusTarget ? cfg.bonusAmount : 0;
  return { pct, base, bonus, total: base + bonus };
}
const eligibleLevel = (cfg, life) => [...cfg.levels].reverse().find(l => life >= +l.min) || cfg.levels[0];

/* ---------- boot ---------- */
onAuthStateChanged(auth, async u => { if (!registering) await load(u); });
async function load(u) {
  S.user = u; S.me = null; S.owner = null;
  try {
    const s = await getDoc(doc(db, "settings", "global"));
    if (s.exists()) Object.assign(S.settings, s.data());
  } catch (e) { console.error(e); }
  if (u) {
    let snap;
    for (let i = 0; i < 4; i++) {
      snap = await getDoc(doc(db, "users", u.uid));
      if (snap.exists()) break;
      await new Promise(r => setTimeout(r, 500));
    }
    if (snap && snap.exists()) S.me = { id: u.uid, ...snap.data() };
    if (S.me?.role === "operator") {
      if (S.me.active === false) { await signOut(auth); toast("This operator account is deactivated."); return; }
      const o = await getDoc(doc(db, "users", S.me.shopId));
      S.owner = { id: o.id, ...o.data() };
    } else if (S.me?.role === "retailer") S.owner = S.me;
  }
  route();
}

/* ---------- layout ---------- */
const MENU = {
  admin: [["dash", "Home"], ["users", "Users"], ["settings", "Settings"]],
  distributor: [["dash", "Network"]], superdistributor: [["dash", "Network"]],
  retailer: [["dash", "Home"], ["orders", "Orders"], ["services", "Services"], ["team", "Team"], ["cash", "Cash"], ["settings", "Shop"]],
  operator: [["dash", "Home"], ["orders", "Orders"], ["services", "Services"], ["attendance", "Attendance"]]
};
function chrome(page) {
  if (!S.me) { $("#top").innerHTML = `<b>Cyber Cafe Manager</b>`; $("#nav").innerHTML = ""; return; }
  $("#top").innerHTML = `<div><b>${esc(S.me.role === "retailer" || S.me.role === "operator" ? (S.owner?.shopName || "Cyber Cafe") : "Cyber Cafe Manager")}</b><br><span>${esc(S.me.name)} · ${ROLE_LABEL[S.me.role]}</span></div><button data-act="logout">Logout</button>`;
  const blocked = S.me.status !== "active" && S.me.role !== "operator";
  $("#nav").innerHTML = blocked ? "" : (MENU[S.me.role] || []).map(([k, l]) => `<a href="#/${k}" class="${k === page ? "on" : ""}">${l}</a>`).join("");
}
const show = html => { $("#view").innerHTML = html; window.scrollTo(0, 0); };
function modal(html) { const m = $("#modal"); m.innerHTML = `<div class="box">${html}<br><button class="sec" data-act="closeModal" style="margin-top:12px">Close</button></div>`; m.classList.remove("hidden"); }
function qrModal(title, pa, pn, am, tn) {
  const link = upiLink(pa, pn, am, tn);
  modal(`<h3>${esc(title)}</h3><canvas id="qrc"></canvas><p><b>${inr(am)}</b><br><span class="muted small">UPI ID: ${esc(pa)}</span></p><a class="btn" href="${esc(link)}">Open UPI app</a>`);
  if (window.QRCode) window.QRCode.toCanvas($("#qrc"), link, { width: 220 });
}

/* ---------- router ---------- */
async function route() {
  const [, page = "dash", arg] = location.hash.slice(1).split("/");
  $("#modal").classList.add("hidden");
  try {
    if (page === "shop") { chrome(null); return show(await shopPage(arg)); }
    if (!S.user) { chrome(null); return show(authPage(page, arg)); }
    if (!S.me) { chrome(null); return show(`<div class="card center"><p>Profile not found for this login.</p><button data-act="logout">Logout</button></div>`); }
    chrome(page);
    if (S.me.status === "suspended") return show(`<div class="card center"><h3>Account suspended</h3><p class="muted">Please contact the admin.</p></div>`);
    if (S.me.status === "pending_payment") return show(payPage());
    const P = PAGES[S.me.role]?.[page] || PAGES[S.me.role]?.dash;
    show(await P());
  } catch (e) { console.error(e); show(`<div class="card"><b>Error</b><p>${esc(errMsg(e))}</p></div>`); }
}
window.addEventListener("hashchange", route);

/* ---------- auth + public pages ---------- */
function authPage(page, ref) {
  const reg = page === "register";
  const fee = r => r === "distributor" ? S.settings.feeDistributor : S.settings.feeSuperDistributor;
  return `<div class="card"><div class="tabs"><button class="${reg ? "" : "on"}" data-act="go" data-to="#/login">Login</button><button class="${reg ? "on" : ""}" data-act="go" data-to="#/register${ref ? "/" + esc(ref) : ""}">Register</button></div>
  ${reg ? `<form data-form="register"><input type="hidden" name="ref" value="${esc(ref || "")}">
    <label>Register as</label><select name="role"><option value="retailer">Retailer / Cyber cafe – FREE</option>
    <option value="distributor">Distributor – registration fee ${inr(fee("distributor"))}</option>
    <option value="superdistributor">Super Distributor – registration fee ${inr(fee("superdistributor"))}</option></select>
    <label>Your name</label><input name="name" required><label>Mobile number</label><input name="phone" type="tel" required>
    <label>Shop / business name</label><input name="shopName"><label>Email</label><input name="email" type="email" required>
    <label>Password (min 6)</label><input name="password" type="password" minlength="6" required>
    <p class="muted small">Distributor and Super Distributor accounts become active after the registration fee is paid and approved by the admin.</p>
    <button style="width:100%">Create account</button></form>`
  : `<form data-form="login"><label>Email</label><input name="email" type="email" required><label>Password</label><input name="password" type="password" required>
    <br><button style="width:100%">Login</button></form><p class="center"><a href="#" data-act="reset">Forgot password?</a></p>`}</div>`;
}
async function shopPage(uid) {
  const s = await getDoc(doc(db, "shops", uid || "x"));
  if (!s.exists()) return `<div class="card center">Shop not found.</div>`;
  const sh = s.data();
  const svcs = (await list("services", "shopId", uid)).sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="card"><h2>${esc(sh.shopName)}</h2><p class="muted">${esc(sh.address)}<br>${sh.phone ? `Call: <a href="tel:${esc(sh.phone)}">${esc(sh.phone)}</a>` : ""}</p></div>
  <div class="card"><h3>Services</h3>${svcs.map(v => `<div class="svc"><div>${esc(v.name)}<br><span class="muted small">${inr(v.price)}</span></div><span class="tag ${v.available ? "ok" : "bad"}">${v.available ? "Available" : "Not available"}</span></div>`).join("") || "<p class='muted'>No services listed yet.</p>"}</div>
  ${sh.upiId ? `<div class="card"><h3>Pay via UPI</h3><label>Amount (₹)</label><input id="payamt" type="number" min="1"><br><button data-act="shopPay" data-pa="${esc(sh.upiId)}" data-pn="${esc(sh.upiName || sh.shopName)}">Show QR / Pay</button></div>` : ""}
  <p class="center small muted">Applications are submitted through the official portals by this private service centre.</p>`;
}

/* ---------- distributor payment ---------- */
function payPage() {
  const r = S.me.role, fee = r === "distributor" ? S.settings.feeDistributor : S.settings.feeSuperDistributor;
  return `<div class="card"><h2>Complete registration</h2><p>Registration fee for <b>${ROLE_LABEL[r]}</b>: <b>${inr(fee)}</b></p>
  ${S.me.paymentSubmitted ? `<p><span class="tag warn">Waiting for admin approval</span></p><p class="muted small">Reference submitted: ${esc(S.me.paymentRef)}</p>`
  : `${S.settings.adminUpi ? `<button data-act="feeQr" data-fee="${fee}">Pay ${inr(fee)} via UPI</button>` : `<p class="muted">Admin has not set a UPI ID yet.</p>`}
  <form data-form="pay"><label>After paying, enter the UPI reference / UTR number</label><input name="ref" required><br><button class="ok">Submit payment details</button></form>`}</div>`;
}

/* ---------- PAGES ---------- */
const PAGES = { admin: {}, distributor: {}, superdistributor: {}, retailer: {}, operator: {} };

/* Admin */
PAGES.admin.dash = async () => {
  const us = await getDocs(collection(db, "users")).then(s => s.docs.map(d => ({ id: d.id, ...d.data() })));
  const c = r => us.filter(u => u.role === r).length;
  const pend = us.filter(u => u.status === "pending_payment" && u.paymentSubmitted);
  return `<h2>Admin Home</h2><div class="grid"><div class="stat"><b>${c("retailer")}</b><span>Retailers</span></div><div class="stat"><b>${c("distributor")}</b><span>Distributors</span></div><div class="stat"><b>${c("superdistributor")}</b><span>Super Distributors</span></div><div class="stat"><b>${c("operator")}</b><span>Operators</span></div></div>
  <div class="card"><h3>Payments waiting for approval (${pend.length})</h3>${pend.map(u => `<div class="svc"><div><b>${esc(u.name)}</b> <span class="tag info">${ROLE_LABEL[u.role]}</span><br><span class="muted small">Fee ${inr(u.role === "distributor" ? S.settings.feeDistributor : S.settings.feeSuperDistributor)} · Ref ${esc(u.paymentRef)}</span></div><div class="row"><button class="ok sm" data-act="approve" data-id="${u.id}">Approve</button><button class="bad sm" data-act="rejectPay" data-id="${u.id}">Reject</button></div></div>`).join("") || "<p class='muted'>Nothing pending.</p>"}</div>`;
};
PAGES.admin.users = async () => {
  const us = (await getDocs(collection(db, "users")).then(s => s.docs.map(d => ({ id: d.id, ...d.data() })))).filter(u => u.role !== "admin").sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return `<h2>All users</h2><div class="card scroll"><table><tr><th>Name</th><th>Role</th><th>Status</th><th></th></tr>${us.map(u => `<tr><td>${esc(u.name)}<br><span class="muted small">${esc(u.phone)}</span></td><td>${ROLE_LABEL[u.role]}</td><td><span class="tag ${u.status === "active" ? "ok" : "warn"}">${esc(u.status)}</span></td><td>${u.status === "suspended" ? `<button class="ok sm" data-act="setStatus" data-id="${u.id}" data-s="active">Activate</button>` : `<button class="bad sm" data-act="setStatus" data-id="${u.id}" data-s="suspended">Suspend</button>`}</td></tr>`).join("")}</table></div>`;
};
PAGES.admin.settings = async () => `<h2>Admin Settings</h2><div class="card"><form data-form="adminSettings">
  <label>Distributor registration fee (₹)</label><input name="feeDistributor" type="number" min="0" value="${+S.settings.feeDistributor || 0}">
  <label>Super Distributor registration fee (₹)</label><input name="feeSuperDistributor" type="number" min="0" value="${+S.settings.feeSuperDistributor || 0}">
  <label>Your UPI ID (fees are received here)</label><input name="adminUpi" value="${esc(S.settings.adminUpi)}" placeholder="name@bank">
  <label>Name shown on UPI</label><input name="adminUpiName" value="${esc(S.settings.adminUpiName)}"><br><button>Save settings</button></form>
  <p class="muted small">Retailers always register free.</p></div>`;

/* Distributor / Super distributor */
PAGES.distributor.dash = PAGES.superdistributor.dash = async () => {
  const kids = await list("users", "referredBy", S.me.id);
  const link = `${location.origin}/#/register/${S.me.id}`;
  return `<h2>My Network</h2><div class="grid"><div class="stat"><b>${kids.length}</b><span>Total sign-ups</span></div><div class="stat"><b>${kids.filter(k => k.role === "retailer").length}</b><span>Retailers</span></div><div class="stat"><b>${kids.filter(k => k.role !== "retailer").length}</b><span>Distributors</span></div></div>
  <div class="card"><h3>Your referral link</h3><p class="small" style="word-break:break-all">${esc(link)}</p><button data-act="copy" data-v="${esc(link)}">Copy link</button></div>
  <div class="card"><h3>People you added</h3>${kids.map(k => `<div class="svc"><div>${esc(k.name)}<br><span class="muted small">${esc(k.phone)}</span></div><span class="tag info">${ROLE_LABEL[k.role]}</span></div>`).join("") || "<p class='muted'>No one yet. Share your link.</p>"}</div>`;
};

/* Retailer + operator shared */
async function shopData() {
  const orders = (await list("orders", "shopId", SID())).sort((a, b) => b.created - a.created);
  return orders;
}
PAGES.retailer.dash = async () => {
  const [orders, svcs, ops] = await Promise.all([shopData(), list("services", "shopId", SID()), list("users", "shopId", SID())]);
  const t = today(), m = t.slice(0, 7);
  const td = orders.filter(o => o.date === t), mo = orders.filter(o => o.date.startsWith(m));
  const link = `${location.origin}/#/shop/${S.me.id}`;
  return `<h2>Today</h2><div class="grid"><div class="stat"><b>${td.length}</b><span>Orders today</span></div><div class="stat"><b>${inr(sum(td.filter(o => o.payStatus === "paid")))}</b><span>Collected today</span></div><div class="stat"><b>${orders.filter(o => !["completed", "rejected"].includes(o.status)).length}</b><span>Pending work</span></div><div class="stat"><b>${inr(sum(mo.filter(o => o.payStatus === "paid")))}</b><span>This month</span></div><div class="stat"><b>${inr(sum(orders.filter(o => o.payStatus === "unpaid" && o.status !== "rejected")))}</b><span>Payment due</span></div><div class="stat"><b>${svcs.filter(s => s.available).length}/${svcs.length}</b><span>Services available</span></div><div class="stat"><b>${ops.filter(o => o.role === "operator" && o.active !== false).length}</b><span>Active operators</span></div></div>
  ${!S.me.upiId ? `<div class="card"><span class="tag warn">Set your UPI ID</span> in the Shop tab so customers can pay directly into your bank account.</div>` : ""}
  <div class="card"><h3>Your customer page</h3><p class="muted small">Customers can see available services and pay by UPI.</p><p class="small" style="word-break:break-all">${esc(link)}</p><button data-act="copy" data-v="${esc(link)}">Copy link</button></div>
  <div class="card"><h3>Your referral link (to invite other cafes)</h3><p class="small" style="word-break:break-all">${esc(location.origin)}/#/register/${S.me.id}</p></div>`;
};
PAGES.operator.dash = async () => {
  const orders = (await shopData()).filter(o => o.operatorId === S.me.id);
  const cfg = cfgOf(S.owner), st = opStats(orders, S.me.id), e = earnings(S.me.level, st, cfg);
  const next = cfg.levels.find(l => +l.min > st.life);
  const td = orders.filter(o => o.date === today());
  return `<h2>Hello, ${esc(S.me.name)}</h2><div class="grid"><div class="stat"><b>${S.me.level || "Trainee"}</b><span>Your level</span></div><div class="stat"><b>${td.length}</b><span>My orders today</span></div><div class="stat"><b>${st.mo}</b><span>Completed this month</span></div><div class="stat"><b>${inr(st.rev)}</b><span>Paid work this month</span></div></div>
  <div class="card"><h3>Extra income this month</h3><p>Commission (${e.pct}%): <b>${inr(e.base)}</b><br>Target bonus: <b>${inr(e.bonus)}</b> ${cfg.bonusTarget ? `<span class="muted small">(${st.mo}/${cfg.bonusTarget} orders)</span>` : ""}<br>Total: <b>${inr(e.total)}</b></p>
  ${next ? `<p class="muted small">${next.min - st.life} more completed orders to reach <b>${esc(next.name)}</b>.</p>` : `<p class="muted small">You are at the top level.</p>`}</div>`;
};

/* Orders */
PAGES.retailer.orders = PAGES.operator.orders = async () => {
  const isOp = S.me.role === "operator";
  const [all, svcs, ops] = await Promise.all([shopData(), list("services", "shopId", SID()), isOp ? [] : list("users", "shopId", SID())]);
  let orders = isOp ? all.filter(o => o.operatorId === S.me.id) : all;
  const t = today();
  orders = orders.filter(o => S.of === "all" ? true : S.of === "today" ? o.date === t : S.of === "done" ? ["completed", "rejected"].includes(o.status) : !["completed", "rejected"].includes(o.status));
  const avail = svcs.filter(s => s.available).sort((a, b) => a.name.localeCompare(b.name));
  const opList = ops.filter(o => o.role === "operator" && o.active !== false);
  return `<h2>Orders</h2><details class="card"><summary><b>+ New order / application</b></summary><form data-form="order">
  <label>Customer name</label><input name="customerName" required><label>Mobile</label><input name="phone" type="tel">
  <label>Service</label><select name="serviceId" data-chg="svcprice" required><option value="">Select…</option>${avail.map(s => `<option value="${s.id}" data-price="${s.price}" data-name="${esc(s.name)}">${esc(s.name)} – ${inr(s.price)}</option>`).join("")}</select>
  <label>Amount (₹)</label><input name="amount" type="number" min="0" step="0.01" required>
  ${isOp ? "" : `<label>Assign to</label><select name="operatorId"><option value="">Myself (owner)</option>${opList.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join("")}</select>`}
  <label>Notes (documents received, official portal reference)</label><textarea name="notes" rows="2"></textarea><br><button>Save order</button></form></details>
  <div class="tabs">${[["open", "Open"], ["today", "Today"], ["done", "Done"], ["all", "All"]].map(([k, l]) => `<button class="${S.of === k ? "on" : ""}" data-act="of" data-v="${k}">${l}</button>`).join("")}</div>
  ${orders.map(o => `<div class="card"><div class="between"><b>${esc(o.customerName)}</b><span class="muted small">${esc(o.ref)}</span></div>
  <div class="muted small">${esc(o.serviceName)} · ${inr(o.amount)} · ${esc(o.date)}<br>${esc(o.phone || "")} ${o.operatorName ? "· " + esc(o.operatorName) : ""}</div>${o.notes ? `<div class="small">${esc(o.notes)}</div>` : ""}
  <div class="row" style="margin-top:8px"><select data-chg="status" data-id="${o.id}">${STATUSES.map(s => `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}</select>
  ${o.payStatus === "paid" ? `<span class="tag ok">Paid (${esc(o.payMode)})</span>` : `<span class="tag bad">Unpaid</span><button class="sm gold" data-act="orderQr" data-id="${o.id}" data-amt="${o.amount}" data-ref="${esc(o.ref)}">QR</button><button class="sm ok" data-act="paid" data-id="${o.id}" data-m="upi">Paid UPI</button><button class="sm sec" data-act="paid" data-id="${o.id}" data-m="cash">Paid Cash</button>`}
  ${isOp ? "" : `<button class="sm bad" data-act="delOrder" data-id="${o.id}">Delete</button>`}</div></div>`).join("") || `<p class="muted center">No orders here.</p>`}`;
};

/* Services */
PAGES.retailer.services = PAGES.operator.services = async () => {
  const isOp = S.me.role === "operator";
  const svcs = (await list("services", "shopId", SID())).sort((a, b) => (a.category || "").localeCompare(b.category || "") || a.name.localeCompare(b.name));
  return `<h2>Services</h2>${isOp ? "" : `<details class="card"><summary><b>+ Add service</b></summary><form data-form="addService"><label>Service name</label><input name="name" required><div class="row"><div><label>Price (₹)</label><input name="price" type="number" min="0" required></div><div><label>Category</label><input name="category" placeholder="e.g. Online forms"></div></div><br><button>Add</button></form></details>
  ${svcs.length ? "" : `<div class="card center"><p>No services yet.</p><button class="gold" data-act="seed">Add common cyber cafe services</button></div>`}`}
  <div class="card">${svcs.map(v => `<div class="svc"><div>${esc(v.name)}<br><span class="muted small">${esc(v.category || "")} · ${inr(v.price)}</span></div>${isOp ? `<span class="tag ${v.available ? "ok" : "bad"}">${v.available ? "Available" : "Off"}</span>` : `<div class="row" style="flex:0"><button class="sm sec" data-act="editPrice" data-id="${v.id}" data-p="${v.price}">₹</button><button class="sm bad" data-act="delService" data-id="${v.id}">✕</button><div class="switch ${v.available ? "on" : ""}" data-act="togService" data-id="${v.id}" data-on="${v.available ? 1 : 0}"></div></div>`}</div>`).join("") || "<p class='muted'>Nothing here.</p>"}</div>`;
};

/* Team (retailer) */
PAGES.retailer.team = async () => {
  const [orders, users, att] = await Promise.all([shopData(), list("users", "shopId", SID()), list("attendance", "shopId", SID())]);
  const ops = users.filter(u => u.role === "operator"), cfg = cfgOf(S.me), t = today();
  const rows = ops.map(o => {
    const st = opStats(orders, o.id), e = earnings(o.level, st, cfg), el = eligibleLevel(cfg, st.life);
    const can = cfg.levels.findIndex(l => l.name === el.name) > cfg.levels.findIndex(l => l.name === (o.level || "Trainee"));
    const a = att.find(x => x.operatorId === o.id && x.date === t);
    return `<div class="card"><div class="between"><div><b>${esc(o.name)}</b> <span class="tag info">${esc(o.level || "Trainee")}</span> ${o.active === false ? `<span class="tag bad">Inactive</span>` : ""}<br><span class="muted small">${esc(o.phone)} · ${esc(o.email)}</span></div><span class="tag ${a ? "ok" : ""}">${a ? "In " + hhmm(a.in) + (a.out ? " – " + hhmm(a.out) : "") : "Not in"}</span></div>
    <div class="grid" style="margin:8px 0"><div class="stat"><b>${st.mo}</b><span>Done this month</span></div><div class="stat"><b>${inr(st.rev)}</b><span>Paid work</span></div><div class="stat"><b>${inr(e.total)}</b><span>Extra income (${e.pct}%${e.bonus ? " + bonus" : ""})</span></div><div class="stat"><b>${st.life}</b><span>Lifetime done</span></div></div>
    <div class="row">${can ? `<button class="gold sm" data-act="promote" data-id="${o.id}" data-lv="${esc(el.name)}">Promote to ${esc(el.name)}</button>` : ""}<button class="sm sec" data-act="toggleOp" data-id="${o.id}" data-on="${o.active === false ? 0 : 1}">${o.active === false ? "Activate" : "Deactivate"}</button></div></div>`;
  }).join("");
  const recent = att.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  return `<h2>My Team</h2><details class="card"><summary><b>+ Add operator</b></summary><form data-form="addOp"><label>Name</label><input name="name" required><label>Mobile</label><input name="phone" type="tel" required><label>Login email</label><input name="email" type="email" required><label>Password (min 6)</label><input name="password" type="password" minlength="6" required><br><button>Create operator login</button></form></details>
  ${rows || `<p class="muted center">No operators yet.</p>`}
  <div class="card"><h3>Recent attendance</h3><div class="scroll"><table><tr><th>Date</th><th>Operator</th><th>In</th><th>Out</th></tr>${recent.map(a => `<tr><td>${esc(a.date)}</td><td>${esc(a.operatorName)}</td><td>${hhmm(a.in)}</td><td>${hhmm(a.out)}</td></tr>`).join("")}</table></div></div>`;
};

/* Attendance (operator) */
PAGES.operator.attendance = async () => {
  const mine = (await list("attendance", "shopId", S.me.shopId)).filter(a => a.operatorId === S.me.id).sort((a, b) => b.date.localeCompare(a.date));
  const t = mine.find(a => a.date === today());
  return `<h2>Attendance</h2><div class="card center"><p>${t ? `Checked in at <b>${hhmm(t.in)}</b>${t.out ? ` · out at <b>${hhmm(t.out)}</b>` : ""}` : "You have not checked in today."}</p>
  ${!t ? `<button class="ok" data-act="checkin">Check in</button>` : !t.out ? `<button class="bad" data-act="checkout">Check out</button>` : ""}</div>
  <div class="card"><h3>History</h3><table><tr><th>Date</th><th>In</th><th>Out</th></tr>${mine.slice(0, 31).map(a => `<tr><td>${esc(a.date)}</td><td>${hhmm(a.in)}</td><td>${hhmm(a.out)}</td></tr>`).join("")}</table></div>`;
};

/* Cash book (retailer) */
PAGES.retailer.cash = async () => {
  const [orders, led, users] = await Promise.all([shopData(), list("ledger", "shopId", S.me.id), list("users", "shopId", S.me.id)]);
  const m = S.cm, cfg = cfgOf(S.me);
  const paid = orders.filter(o => o.date.startsWith(m) && o.payStatus === "paid");
  const entries = led.filter(l => l.date.startsWith(m)).sort((a, b) => b.created - a.created);
  const inc = entries.filter(l => l.type === "income"), exp = entries.filter(l => l.type === "expense");
  const payout = users.filter(u => u.role === "operator").reduce((t, o) => {
    const done = orders.filter(x => x.operatorId === o.id && x.status === "completed" && x.date.startsWith(m));
    const st = { mo: done.length, rev: sum(done.filter(x => x.payStatus === "paid")) };
    return t + earnings(o.level, st, cfg).total;
  }, 0);
  const net = sum(paid) + sum(inc) - sum(exp) - payout;
  const bySvc = {}; paid.forEach(o => { bySvc[o.serviceName] = bySvc[o.serviceName] || { n: 0, a: 0 }; bySvc[o.serviceName].n++; bySvc[o.serviceName].a += +o.amount; });
  return `<h2>Cash Book</h2><input type="month" value="${m}" data-chg="cm"><br><br>
  <div class="grid"><div class="stat"><b>${inr(sum(paid))}</b><span>Order income</span></div><div class="stat"><b>${inr(sum(inc))}</b><span>Other income</span></div><div class="stat"><b>${inr(sum(exp))}</b><span>Expenses</span></div><div class="stat"><b>${inr(payout)}</b><span>Operator extra income</span></div><div class="stat"><b>${inr(net)}</b><span>Net profit</span></div></div>
  <details class="card"><summary><b>+ Add income / expense</b></summary><form data-form="ledger"><div class="row"><select name="type"><option value="expense">Expense</option><option value="income">Income</option></select><input name="amount" type="number" min="0" step="0.01" placeholder="Amount" required></div><label>Note (rent, paper, electricity…)</label><input name="note" required><br><button>Save</button></form></details>
  <div class="card"><h3>Entries</h3>${entries.map(l => `<div class="svc"><div>${esc(l.note)}<br><span class="muted small">${esc(l.date)}</span></div><div><span class="tag ${l.type === "income" ? "ok" : "bad"}">${l.type === "income" ? "+" : "−"}${inr(l.amount)}</span> <button class="sm bad" data-act="delLedger" data-id="${l.id}">✕</button></div></div>`).join("") || "<p class='muted'>None this month.</p>"}</div>
  <div class="card"><h3>Service-wise income</h3><table><tr><th>Service</th><th>Orders</th><th>Amount</th></tr>${Object.entries(bySvc).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.n}</td><td>${inr(v.a)}</td></tr>`).join("")}</table></div>`;
};

/* Shop settings (retailer) */
PAGES.retailer.settings = async () => {
  const m = S.me, cfg = cfgOf(m);
  return `<h2>Shop Settings</h2><form data-form="shop"><div class="card"><h3>Shop details</h3>
  <label>Shop name</label><input name="shopName" value="${esc(m.shopName)}" required><label>Mobile</label><input name="phone" value="${esc(m.phone)}"><label>Address</label><input name="address" value="${esc(m.address)}"></div>
  <div class="card"><h3>UPI – customers pay directly to your bank</h3><label>Your UPI ID</label><input name="upiId" value="${esc(m.upiId)}" placeholder="name@bank"><label>Name on UPI account</label><input name="upiName" value="${esc(m.upiName)}">
  <p class="muted small">Payments go straight from the customer to your bank account. Mark each order as paid after you see the money.</p></div>
  <div class="card"><h3>Operator incentives</h3><div class="row"><div><label>Commission % on paid work</label><input name="commissionPct" type="number" step="0.1" min="0" value="${cfg.commissionPct}"></div></div>
  <div class="row"><div><label>Monthly target (orders)</label><input name="bonusTarget" type="number" min="0" value="${cfg.bonusTarget}"></div><div><label>Target bonus (₹)</label><input name="bonusAmount" type="number" min="0" value="${cfg.bonusAmount}"></div></div>
  <p class="muted small">Levels: lifetime completed orders needed, and extra commission % at that level.</p>
  ${cfg.levels.map((l, i) => `<div class="row"><div><label>${esc(l.name)} – min orders</label><input name="lmin${i}" type="number" min="0" value="${l.min}"></div><div><label>Extra %</label><input name="lex${i}" type="number" step="0.1" min="0" value="${l.extra}"></div></div>`).join("")}</div>
  <button style="width:100%">Save</button></form>`;
};

/* ---------- actions ---------- */
const run = fn => async (...a) => { try { await fn(...a); } catch (e) { console.error(e); toast(errMsg(e)); } };
const A = {
  logout: run(async () => { await signOut(auth); location.hash = "#/login"; }),
  go: t => { location.hash = t.dataset.to; },
  closeModal: () => $("#modal").classList.add("hidden"),
  copy: run(async t => { await navigator.clipboard.writeText(t.dataset.v); toast("Link copied"); }),
  reset: run(async () => { const e = prompt("Enter your email"); if (e) { await sendPasswordResetEmail(auth, e); toast("Reset link sent"); } }),
  of: t => { S.of = t.dataset.v; route(); },
  feeQr: t => qrModal("Registration fee", S.settings.adminUpi, S.settings.adminUpiName, t.dataset.fee, "Registration"),
  shopPay: t => { const a = +$("#payamt").value; if (!(a > 0)) return toast("Enter amount"); qrModal("Pay " + t.dataset.pn, t.dataset.pa, t.dataset.pn, a, "Payment"); },
  orderQr: t => { if (!S.owner.upiId) return toast("Set UPI ID in Shop settings first"); qrModal("Collect payment", S.owner.upiId, S.owner.upiName || S.owner.shopName, t.dataset.amt, t.dataset.ref); },
  approve: run(async t => { await updateDoc(doc(db, "users", t.dataset.id), { status: "active", approvedAt: Date.now() }); toast("Approved"); route(); }),
  rejectPay: run(async t => { await updateDoc(doc(db, "users", t.dataset.id), { paymentSubmitted: false, paymentRef: "" }); toast("Rejected – user can resubmit"); route(); }),
  setStatus: run(async t => { await updateDoc(doc(db, "users", t.dataset.id), { status: t.dataset.s }); route(); }),
  paid: run(async t => { await updateDoc(doc(db, "orders", t.dataset.id), { payStatus: "paid", payMode: t.dataset.m, paidAt: Date.now() }); route(); }),
  delOrder: run(async t => { if (confirm("Delete this order?")) { await deleteDoc(doc(db, "orders", t.dataset.id)); route(); } }),
  togService: run(async t => { await updateDoc(doc(db, "services", t.dataset.id), { available: t.dataset.on !== "1" }); route(); }),
  delService: run(async t => { if (confirm("Delete service?")) { await deleteDoc(doc(db, "services", t.dataset.id)); route(); } }),
  editPrice: run(async t => { const p = prompt("New price (₹)", t.dataset.p); if (p !== null && !isNaN(+p)) { await updateDoc(doc(db, "services", t.dataset.id), { price: +p }); route(); } }),
  seed: run(async () => { await Promise.all(DEFAULT_SERVICES.map(([name, price, category]) => addDoc(collection(db, "services"), { shopId: S.me.id, name, price, category, available: true }))); route(); }),
  promote: run(async t => { await updateDoc(doc(db, "users", t.dataset.id), { level: t.dataset.lv }); toast("Promoted to " + t.dataset.lv); route(); }),
  toggleOp: run(async t => { await updateDoc(doc(db, "users", t.dataset.id), { active: t.dataset.on !== "1" }); route(); }),
  delLedger: run(async t => { await deleteDoc(doc(db, "ledger", t.dataset.id)); route(); }),
  checkin: run(async () => { await setDoc(doc(db, "attendance", S.me.id + "_" + today()), { shopId: S.me.shopId, operatorId: S.me.id, operatorName: S.me.name, date: today(), in: Date.now(), out: null }); route(); }),
  checkout: run(async () => { await updateDoc(doc(db, "attendance", S.me.id + "_" + today()), { out: Date.now() }); route(); })
};
const CHG = {
  svcprice: sel => { const o = sel.selectedOptions[0]; sel.form.amount.value = o?.dataset.price ?? ""; },
  status: run(async sel => { const d = { status: sel.value }; if (sel.value === "completed") d.completedAt = Date.now(); await updateDoc(doc(db, "orders", sel.dataset.id), d); toast("Updated"); }),
  cm: i => { S.cm = i.value || today().slice(0, 7); route(); }
};
const F = {
  login: run(async f => { const d = Object.fromEntries(new FormData(f)); await signInWithEmailAndPassword(auth, d.email, d.password); location.hash = "#/dash"; }),
  register: async f => {
    const d = Object.fromEntries(new FormData(f));
    registering = true;
    try {
      const c = await createUserWithEmailAndPassword(auth, d.email, d.password);
      const prof = { name: d.name, phone: d.phone, email: d.email, role: d.role, status: d.role === "retailer" ? "active" : "pending_payment", shopName: d.shopName || "", referredBy: d.ref || "", createdAt: Date.now() };
      if (d.role === "retailer") Object.assign(prof, { upiId: "", upiName: "", address: "", commissionPct: 10, bonusTarget: 50, bonusAmount: 500, levels: DEFAULT_LEVELS });
      await setDoc(doc(db, "users", c.user.uid), prof);
      if (d.role === "retailer") await setDoc(doc(db, "shops", c.user.uid), { shopName: d.shopName || d.name, phone: d.phone, address: "", upiId: "", upiName: "" });
      registering = false;
      location.hash = "#/dash";
      await load(auth.currentUser);
    } catch (e) { registering = false; toast(errMsg(e)); }
  },
  pay: run(async f => { await updateDoc(doc(db, "users", S.me.id), { paymentRef: new FormData(f).get("ref"), paymentSubmitted: true }); await load(auth.currentUser); }),
  adminSettings: run(async f => {
    const d = Object.fromEntries(new FormData(f));
    const v = { feeDistributor: +d.feeDistributor || 0, feeSuperDistributor: +d.feeSuperDistributor || 0, adminUpi: d.adminUpi.trim(), adminUpiName: d.adminUpiName.trim() };
    await setDoc(doc(db, "settings", "global"), v, { merge: true }); Object.assign(S.settings, v); toast("Saved");
  }),
  order: run(async f => {
    const d = Object.fromEntries(new FormData(f)), opt = f.serviceId.selectedOptions[0];
    const isOp = S.me.role === "operator";
    let opId = isOp ? S.me.id : d.operatorId, opName = isOp ? S.me.name : (f.operatorId?.selectedOptions[0]?.text || "");
    if (!isOp && !d.operatorId) { opId = ""; opName = ""; }
    await addDoc(collection(db, "orders"), { shopId: SID(), ref: "CC" + String(Date.now()).slice(-7), customerName: d.customerName, phone: d.phone, serviceId: d.serviceId, serviceName: opt.dataset.name, amount: +d.amount, status: "received", payStatus: "unpaid", payMode: "", operatorId: opId, operatorName: opName, notes: d.notes, date: today(), created: Date.now() });
    toast("Order saved"); route();
  }),
  addService: run(async f => { const d = Object.fromEntries(new FormData(f)); await addDoc(collection(db, "services"), { shopId: S.me.id, name: d.name, price: +d.price, category: d.category, available: true }); route(); }),
  addOp: run(async f => {
    const d = Object.fromEntries(new FormData(f));
    const sec = initializeApp(firebaseConfig, "sec" + Date.now());
    const sa = getAuth(sec);
    const c = await createUserWithEmailAndPassword(sa, d.email, d.password);
    await signOut(sa);
    await setDoc(doc(db, "users", c.user.uid), { name: d.name, phone: d.phone, email: d.email, role: "operator", shopId: S.me.id, level: "Trainee", active: true, status: "active", createdAt: Date.now() });
    toast("Operator created. Share the email and password with them."); route();
  }),
  ledger: run(async f => { const d = Object.fromEntries(new FormData(f)); await addDoc(collection(db, "ledger"), { shopId: S.me.id, type: d.type, amount: +d.amount, note: d.note, date: today(), created: Date.now() }); route(); }),
  shop: run(async f => {
    const d = Object.fromEntries(new FormData(f));
    const levels = DEFAULT_LEVELS.map((l, i) => ({ name: l.name, min: +d["lmin" + i] || 0, extra: +d["lex" + i] || 0 }));
    const u = { shopName: d.shopName, phone: d.phone, address: d.address, upiId: d.upiId.trim(), upiName: d.upiName.trim(), commissionPct: +d.commissionPct || 0, bonusTarget: +d.bonusTarget || 0, bonusAmount: +d.bonusAmount || 0, levels };
    await updateDoc(doc(db, "users", S.me.id), u);
    await setDoc(doc(db, "shops", S.me.id), { shopName: u.shopName, phone: u.phone, address: u.address, upiId: u.upiId, upiName: u.upiName });
    Object.assign(S.me, u); S.owner = S.me; toast("Saved"); chrome("settings");
  })
};
document.addEventListener("click", e => { const t = e.target.closest("[data-act]"); if (t && A[t.dataset.act]) { e.preventDefault(); A[t.dataset.act](t); } });
document.addEventListener("change", e => { const t = e.target.closest("[data-chg]"); if (t && CHG[t.dataset.chg]) CHG[t.dataset.chg](t); });
document.addEventListener("submit", e => { const f = e.target.closest("[data-form]"); if (f) { e.preventDefault(); F[f.dataset.form]?.(f); } });
