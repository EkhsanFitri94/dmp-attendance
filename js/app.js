/* ============================================================
   DMP Attendance App - app.js
   IndexedDB storage + dual-mode UI (student/admin)
   ============================================================ */

const DEFAULT_PIN = '1234';
const APP_URL = window.location.href.split('?')[0].split('#')[0];

// ─── Database Layer ───────────────────────────────────────────
class AttendanceDB {
  constructor() { this.DB_NAME = 'dmp-attendance'; this.VERSION = 2; this.db = null; }

  async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('students')) {
          const store = db.createObjectStore('students', { keyPath: 'id', autoIncrement: true });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('registeredAt', 'registeredAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('attendance')) {
          const att = db.createObjectStore('attendance', { keyPath: 'id', autoIncrement: true });
          att.createIndex('studentId', 'studentId', { unique: false });
          att.createIndex('date', 'date', { unique: false });
          att.createIndex('studentId_date', ['studentId', 'date'], { unique: false });
        }
      };
      req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
      req.onerror = (e) => { console.error('DB error:', e.target.error); reject(e.target.error); };
    });
  }

  addStudent(data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('students', 'readwrite');
      const store = tx.objectStore('students');
      const req = store.add({ ...data, registeredAt: new Date().toISOString() });
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  getStudents() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('students', 'readonly');
      const req = tx.objectStore('students').getAll();
      req.onsuccess = (e) => resolve(e.target.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  getStudent(id) {
    return new Promise((resolve, reject) => {
      const req = this.db.transaction('students','readonly').objectStore('students').get(id);
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  deleteStudent(id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['students','attendance'], 'readwrite');
      tx.objectStore('students').delete(id);
      const curReq = tx.objectStore('attendance').index('studentId').openCursor(IDBKeyRange.only(id));
      curReq.onsuccess = (e) => { const c = e.target.result; if (c) { c.delete(); c.continue(); } };
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  searchStudents(query) {
    return new Promise((resolve, reject) => {
      const req = this.db.transaction('students','readonly').objectStore('students').getAll();
      req.onsuccess = (e) => {
        const q = query.toLowerCase().trim();
        resolve((e.target.result||[]).filter(s =>
          s.name.toLowerCase().includes(q) || (s.phone&&s.phone.includes(q)) || (s.email&&s.email.toLowerCase().includes(q))
        ));
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  checkIn(studentId, studentName) {
    return new Promise((resolve, reject) => {
      const today = getTodayDate();
      const tx = this.db.transaction('attendance','readwrite');
      const store = tx.objectStore('attendance');
      const idx = store.index('studentId_date');
      const checkReq = idx.get([studentId, today]);
      checkReq.onsuccess = (e) => {
        if (e.target.result) { reject(new Error('Already checked in today')); return; }
        const req = store.add({ studentId, studentName, date: today, checkInTime: new Date().toISOString(), checkOutTime: null, status: 'present' });
        req.onsuccess = (e2) => resolve(e2.target.result);
        req.onerror = (e2) => reject(e2.target.error);
      };
      checkReq.onerror = (e) => reject(e.target.error);
    });
  }

  checkOut(attendanceId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('attendance','readwrite');
      const req = tx.objectStore('attendance').get(attendanceId);
      req.onsuccess = (e) => {
        const r = e.target.result;
        if (!r) { reject(new Error('Record not found')); return; }
        if (r.checkOutTime) { reject(new Error('Already checked out')); return; }
        r.checkOutTime = new Date().toISOString(); r.status = 'completed';
        tx.objectStore('attendance').put(r).onsuccess = () => resolve(r);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  getTodayAttendance() {
    return new Promise((resolve, reject) => {
      const req = this.db.transaction('attendance','readonly').objectStore('attendance').index('date').getAll(getTodayDate());
      req.onsuccess = (e) => resolve(e.target.result||[]);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  getCurrentlyPresent() {
    return this.getTodayAttendance().then(all => all.filter(r => r.status==='present'));
  }
}

// ─── Helpers ──────────────────────────────────────────────────
function getTodayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

function formatTime(iso) {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString('en-MY', { hour:'2-digit', minute:'2-digit', hour12:true });
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-MY', { day:'numeric', month:'short', year:'numeric' });
}

function calcDuration(cIn, cOut) {
  if (!cIn||!cOut) return '';
  const ms = new Date(cOut)-new Date(cIn);
  const h = Math.floor(ms/3600000), m = Math.floor((ms%3600000)/60000);
  if (h===0) return `${m}m`; if (m===0) return `${h}h`; return `${h}h ${m}m`;
}

function calcDurationHours(cIn, cOut) {
  if (!cIn||!cOut) return 0;
  return (new Date(cOut)-new Date(cIn))/3600000;
}

function showToast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `toast ${type}`;
  t.classList.remove('hidden'); setTimeout(() => t.classList.add('hidden'), 2500);
}

function hideAllModals() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

function showModal(modalId) {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById(modalId).classList.remove('hidden');
}

function escapeHtml(str) {
  const d = document.createElement('div'); d.textContent = str; return d.innerHTML;
}

// ─── PIN Management ───────────────────────────────────────────
function getPin() { return localStorage.getItem('dmp_admin_pin') || DEFAULT_PIN; }
function setPin(pin) { localStorage.setItem('dmp_admin_pin', pin); }

// Admin state is in-memory only (resets every page load for security & to fix iOS issue)
let adminUnlocked = false;
function isAdminUnlocked() { return adminUnlocked; }
function unlockAdmin() { adminUnlocked = true; }
function lockAdmin() { adminUnlocked = false; }

// ─── Mode Switching ───────────────────────────────────────────
function switchToAdminMode() {
  document.body.className = 'admin-mode';
  document.getElementById('student-view').classList.add('hidden');
  document.getElementById('admin-view').classList.remove('hidden');
  loadDashboard();
}

function switchToStudentMode() {
  lockAdmin();
  document.body.className = 'student-mode';
  document.getElementById('admin-view').classList.add('hidden');
  document.getElementById('student-view').classList.remove('hidden');
  hideAllModals();
  resetRegistrationForm();
}

// ─── Student Registration (shared by both student & admin views) ──
let studentPhotoData = null;
let adminPhotoData = null;

function setupStudentRegistration() {
  // Student view registration
  document.getElementById('photo-upload-area').addEventListener('click', () => document.getElementById('photo-input').click());
  document.getElementById('photo-input').addEventListener('change', function() { handlePhotoUpload(this, 'student'); });

  document.getElementById('register-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    await doRegister({
      name: document.getElementById('reg-name').value.trim(),
      age: parseInt(document.getElementById('reg-age').value)||null,
      phone: document.getElementById('reg-phone').value.trim(),
      email: document.getElementById('reg-email').value.trim(),
      address: document.getElementById('reg-address').value.trim(),
      reasonToJoin: document.getElementById('reg-reason').value.trim(),
      profilePicture: studentPhotoData
    });
    // On success in student view, show success card
  });

  // Admin view registration
  document.getElementById('admin-photo-area').addEventListener('click', () => document.getElementById('admin-photo-input').click());
  document.getElementById('admin-photo-input').addEventListener('change', function() { handlePhotoUpload(this, 'admin'); });

  document.getElementById('admin-register-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    await doRegister({
      name: document.getElementById('admin-reg-name').value.trim(),
      age: parseInt(document.getElementById('admin-reg-age').value)||null,
      phone: document.getElementById('admin-reg-phone').value.trim(),
      email: document.getElementById('admin-reg-email').value.trim(),
      address: document.getElementById('admin-reg-address').value.trim(),
      reasonToJoin: document.getElementById('admin-reg-reason').value.trim(),
      profilePicture: adminPhotoData
    });
    this.reset();
    adminPhotoData = null;
    resetAdminPhotoPreview();
    loadDashboard();
  });
}

function handlePhotoUpload(input, mode) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2*1024*1024) { showToast('Photo too large. Max 2MB.', 'error'); return; }

  const reader = new FileReader();
  reader.onload = (e) => {
    const data = e.target.result;
    if (mode==='student') {
      studentPhotoData = data;
      updatePhotoPreview('photo-preview', data);
    } else {
      adminPhotoData = data;
      updatePhotoPreview('admin-photo-preview', data);
    }
  };
  reader.readAsDataURL(file);
}

function updatePhotoPreview(previewId, dataUrl) {
  const preview = document.getElementById(previewId);
  preview.classList.add('has-photo');
  preview.innerHTML = `<img src="${dataUrl}" alt="Photo">`;
}

function resetPhotoPreview(previewId) {
  const preview = document.getElementById(previewId);
  preview.classList.remove('has-photo');
  preview.innerHTML = '<span class="photo-placeholder">📷</span><span>Tap to add photo</span>';
}

function resetAdminPhotoPreview() { resetPhotoPreview('admin-photo-preview'); }

async function doRegister(data) {
  if (!data.name) { showToast('Name is required', 'error'); return; }
  if (!data.reasonToJoin) { showToast('Reason to join is required', 'error'); return; }

  try {
    await db.addStudent(data);
    showToast(`${data.name} registered! ✅`, 'success');

    const isStudentView = document.body.classList.contains('student-mode');
    if (isStudentView) {
      // Kiosk mode: show success briefly, then reset form for next student
      document.getElementById('register-form').classList.add('hidden');
      document.getElementById('reg-success').classList.remove('hidden');
      // Auto-reset after 3 seconds for next student
      setTimeout(() => {
        document.getElementById('reg-success').classList.add('hidden');
        document.getElementById('register-form').classList.remove('hidden');
        resetStudentRegistrationForm();
      }, 3000);
    } else {
      // Admin side: reset immediately
      resetStudentRegistrationForm();
      loadDashboard();
    }
  } catch (err) {
    showToast('Failed to register: ' + err.message, 'error');
  }
}

document.getElementById('btn-register-another').addEventListener('click', () => {
  document.getElementById('reg-success').classList.add('hidden');
  document.getElementById('register-form').classList.remove('hidden');
  resetStudentRegistrationForm();
});

function resetStudentRegistrationForm() {
  document.getElementById('register-form').reset();
  studentPhotoData = null;
  resetPhotoPreview('photo-preview');
}

function resetRegistrationForm() {
  resetStudentRegistrationForm();
  document.getElementById('reg-success').classList.add('hidden');
  document.getElementById('register-form').classList.remove('hidden');
}

// ─── Admin - Dashboard ────────────────────────────────────────
async function loadDashboard() {
  if (!isAdminUnlocked()) return;

  document.getElementById('today-date').textContent = new Date().toLocaleDateString('en-MY', { weekday:'short', day:'numeric', month:'short', year:'numeric' });

  const students = await db.getStudents();
  const todayAttendance = await db.getTodayAttendance();
  const present = todayAttendance.filter(a => a.status==='present');
  const completed = todayAttendance.filter(a => a.status==='completed');

  document.getElementById('stat-total-students').textContent = students.length;
  document.getElementById('stat-checked-in').textContent = present.length;
  document.getElementById('stat-checked-out').textContent = completed.length;

  const withCheckout = todayAttendance.filter(a => a.checkOutTime);
  if (withCheckout.length > 0) {
    const totalHrs = withCheckout.reduce((s,a) => s+calcDurationHours(a.checkInTime,a.checkOutTime),0);
    document.getElementById('stat-avg-hours').textContent = (totalHrs/withCheckout.length).toFixed(1)+'h';
  } else {
    document.getElementById('stat-avg-hours').textContent = '0h';
  }

  const list = document.getElementById('today-attendance-list');
  if (todayAttendance.length===0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>No attendance records for today yet.</p></div>';
    return;
  }

  list.innerHTML = todayAttendance.sort((a,b)=>new Date(b.checkInTime)-new Date(a.checkInTime)).map(a => {
    const d = a.checkOutTime ? calcDuration(a.checkInTime,a.checkOutTime) : 'Present';
    return `<div class="attendance-item"><div class="item-left"><div class="item-avatar">👤</div><div class="item-info"><div class="item-name">${escapeHtml(a.studentName)}</div><div class="item-sub">In: ${formatTime(a.checkInTime)}${a.checkOutTime?' · Out: '+formatTime(a.checkOutTime):''}</div></div></div><div class="item-time"><span class="${a.status==='present'?'time-in':'time-out'}">${d}</span></div></div>`;
  }).join('');
}

// ─── Admin - Check-In ─────────────────────────────────────────
function setupCheckIn() {
  document.getElementById('checkin-search').value = '';
  document.getElementById('checkin-results').innerHTML = '<div class="empty-state"><div class="empty-icon">👆</div><p>Search for a student to check them in.</p></div>';
}

document.getElementById('checkin-search').addEventListener('input', async function() {
  const q = this.value.trim();
  if (!q) { setupCheckIn(); return; }

  const students = await db.searchStudents(q);
  const todayAtt = await db.getTodayAttendance();
  const checkedInIds = new Set(todayAtt.map(a=>a.studentId));
  const div = document.getElementById('checkin-results');

  if (students.length===0) {
    div.innerHTML = `<div class="empty-state"><div class="empty-icon">🔎</div><p>No students found matching "${escapeHtml(q)}"</p></div>`;
    return;
  }

  div.innerHTML = students.map(s => {
    const inToday = checkedInIds.has(s.id);
    return `<div class="student-item"><div class="item-left"><div class="item-avatar">${s.profilePicture?`<img src="${s.profilePicture}" alt="">`:'👤'}</div><div class="item-info"><div class="item-name">${escapeHtml(s.name)}</div><div class="item-sub">${s.age?s.age+' yrs':''}${s.phone?' · '+escapeHtml(s.phone):''}</div></div></div><div class="item-actions">${inToday?'<span style="color:var(--green);font-size:12px;font-weight:600;">✅ In</span>':`<button class="btn btn-success btn-sm btn-checkin" data-id="${s.id}" data-name="${escapeHtml(s.name)}">Check In</button>`}</div></div>`;
  }).join('');

  div.querySelectorAll('.btn-checkin').forEach(btn => {
    btn.addEventListener('click', () => showCheckInConfirm(parseInt(btn.dataset.id), btn.dataset.name));
  });
});

function showCheckInConfirm(sid, name) {
  const now = new Date();
  document.getElementById('modal-checkin-body').innerHTML = `<p style="text-align:center;font-size:15px;">Check in <strong>${name}</strong>?</p><p style="text-align:center;color:var(--text-secondary);font-size:13px;">Time: ${now.toLocaleTimeString('en-MY',{hour:'2-digit',minute:'2-digit'})}<br>Date: ${now.toLocaleDateString('en-MY',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p>`;
  document.getElementById('btn-confirm-checkin').onclick = () => performCheckIn(sid, name);
  showModal('modal-confirm-checkin');
}

async function performCheckIn(sid, name) {
  try {
    await db.checkIn(sid, name);
    hideAllModals();
    showToast(`${name} checked in! ✅`, 'success');
    document.getElementById('checkin-search').dispatchEvent(new Event('input'));
    loadDashboard();
  } catch (err) {
    hideAllModals(); showToast(err.message, 'error');
  }
}

// ─── Admin - Check-Out ────────────────────────────────────────
async function loadCheckOut() {
  const present = await db.getCurrentlyPresent();
  document.getElementById('checkout-count').textContent = present.length;
  const list = document.getElementById('checkout-list');

  if (present.length===0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">🏠</div><p>No one is currently checked in.</p></div>';
    return;
  }

  list.innerHTML = present.map(a => {
    const dur = calcDuration(a.checkInTime, new Date().toISOString());
    return `<div class="attendance-item"><div class="item-left"><div class="item-avatar">👤</div><div class="item-info"><div class="item-name">${escapeHtml(a.studentName)}</div><div class="item-sub">Since: ${formatTime(a.checkInTime)} · ${dur}</div></div></div><div class="item-actions"><button class="btn btn-danger btn-sm btn-checkout" data-id="${a.id}" data-name="${escapeHtml(a.studentName)}">Check Out</button></div></div>`;
  }).join('');

  list.querySelectorAll('.btn-checkout').forEach(btn => {
    btn.addEventListener('click', () => {
      const aid = parseInt(btn.dataset.id);
      showCheckOutConfirm(aid, btn.dataset.name);
    });
  });
}

function showCheckOutConfirm(aid, name) {
  const now = new Date();
  document.getElementById('modal-checkout-body').innerHTML = `<p style="text-align:center;font-size:15px;">Check out <strong>${name}</strong>?</p><p style="text-align:center;color:var(--text-secondary);font-size:13px;">Time: ${now.toLocaleTimeString('en-MY',{hour:'2-digit',minute:'2-digit'})}</p>`;
  document.getElementById('btn-confirm-checkout').onclick = () => performCheckOut(aid, name);
  showModal('modal-confirm-checkout');
}

async function performCheckOut(aid, name) {
  try {
    await db.checkOut(aid);
    hideAllModals();
    showToast(`${name} checked out! 🚪`, 'success');
    await loadCheckOut();
    loadDashboard();
  } catch (err) {
    hideAllModals(); showToast(err.message, 'error');
  }
}

// ─── Admin - Students List ────────────────────────────────────
async function loadStudents() {
  const q = document.getElementById('students-search').value.trim();
  const students = q ? await db.searchStudents(q) : await db.getStudents();
  const todayAtt = await db.getTodayAttendance();
  const todayMap = new Map(); todayAtt.forEach(a => todayMap.set(a.studentId, a));
  const list = document.getElementById('students-list');

  if (students.length===0) {
    list.innerHTML = q ? '<div class="empty-state"><div class="empty-icon">🔎</div><p>No students found.</p></div>' : '<div class="empty-state"><div class="empty-icon">📝</div><p>No students registered yet.</p></div>';
    return;
  }

  list.innerHTML = students.sort((a,b)=>a.name.localeCompare(b.name)).map(s => {
    const rec = todayMap.get(s.id);
    let badge = '';
    if (rec&&rec.status==='present') badge = '<span class="count-badge" style="background:var(--green-light);color:var(--green);">Present</span>';
    else if (rec&&rec.status==='completed') badge = '<span class="count-badge" style="background:var(--red-light);color:var(--red);">Done</span>';
    else badge = '<span class="count-badge" style="background:var(--bg);color:var(--text-muted);">Absent</span>';
    return `<div class="student-item student-detail-trigger" data-id="${s.id}"><div class="item-left"><div class="item-avatar">${s.profilePicture?`<img src="${s.profilePicture}" alt="">`:'👤'}</div><div class="item-info"><div class="item-name">${escapeHtml(s.name)}</div><div class="item-sub">${s.phone?escapeHtml(s.phone)+' · ':''}${s.age?s.age+'yrs':''}</div></div></div>${badge}</div>`;
  }).join('');

  list.querySelectorAll('.student-detail-trigger').forEach(item => {
    item.addEventListener('click', () => showStudentDetail(parseInt(item.dataset.id)));
  });
}

document.getElementById('students-search').addEventListener('input', loadStudents);

let currentDeleteId = null;

async function showStudentDetail(sid) {
  const s = await db.getStudent(sid);
  if (!s) { showToast('Student not found','error'); return; }
  document.getElementById('modal-detail-body').innerHTML = `${s.profilePicture?`<img src="${s.profilePicture}" alt="Photo" class="detail-photo">`:'<div style="text-align:center;font-size:48px;">👤</div>'}<div class="detail-grid"><span class="detail-label">Name</span><span class="detail-value">${escapeHtml(s.name)}</span><span class="detail-label">Age</span><span class="detail-value">${s.age||'-'}</span><span class="detail-label">Phone</span><span class="detail-value">${escapeHtml(s.phone||'-')}</span><span class="detail-label">Email</span><span class="detail-value">${escapeHtml(s.email||'-')}</span><span class="detail-label">Address</span><span class="detail-value">${escapeHtml(s.address||'-')}</span><span class="detail-label">Reason</span><span class="detail-value">${escapeHtml(s.reasonToJoin||'-')}</span><span class="detail-label">Registered</span><span class="detail-value">${formatDate(s.registeredAt)}</span></div>`;
  currentDeleteId = sid;
  showModal('modal-student-detail');
}

document.getElementById('btn-delete-student').addEventListener('click', () => {
  hideAllModals();
  showModal('modal-delete-confirm');
});

document.getElementById('btn-confirm-delete').addEventListener('click', async () => {
  if (currentDeleteId===null) return;
  try {
    const s = await db.getStudent(currentDeleteId);
    await db.deleteStudent(currentDeleteId);
    hideAllModals();
    showToast(`${s?s.name:'Student'} deleted`,'success');
    currentDeleteId = null;
    loadStudents();
    loadDashboard();
  } catch (err) {
    hideAllModals(); showToast('Failed to delete','error');
  }
});

// ─── PIN Modal & Auth ─────────────────────────────────────────
function showPinModal() {
  document.getElementById('pin-input').value = '';
  document.getElementById('pin-error').classList.add('hidden');
  showModal('modal-pin');
  setTimeout(() => document.getElementById('pin-input').focus(), 300);
}

document.getElementById('btn-admin-access').addEventListener('click', (e) => {
  e.preventDefault();
  showPinModal();
});

document.getElementById('btn-pin-submit').addEventListener('click', () => {
  const enteredPin = document.getElementById('pin-input').value.trim();
  if (enteredPin === getPin()) {
    unlockAdmin();
    hideAllModals();
    switchToAdminMode();
  } else {
    document.getElementById('pin-error').classList.remove('hidden');
    document.getElementById('pin-input').value = '';
    document.getElementById('pin-input').focus();
  }
});

document.getElementById('pin-input').addEventListener('keydown', (e) => {
  if (e.key==='Enter') document.getElementById('btn-pin-submit').click();
});

// Admin lock button
document.getElementById('btn-admin-lock').addEventListener('click', () => {
  if (confirm('Lock admin access? You will need to enter the PIN again.')) {
    switchToStudentMode();
  }
});

// ─── Change PIN ───────────────────────────────────────────────
let changePinVisible = false;

// Long press on header clock to change PIN
document.getElementById('btn-admin-lock').addEventListener('dblclick', () => {
  showChangePinModal();
});

// Add change-pin from dashboard (subtle)
async function showChangePinModal() {
  document.getElementById('change-pin-new').value = '';
  document.getElementById('change-pin-confirm').value = '';
  document.getElementById('change-pin-error').classList.add('hidden');
  showModal('modal-change-pin');
  setTimeout(() => document.getElementById('change-pin-new').focus(), 300);
}

document.getElementById('btn-change-pin-save').addEventListener('click', () => {
  const p1 = document.getElementById('change-pin-new').value.trim();
  const p2 = document.getElementById('change-pin-confirm').value.trim();
  if (!p1||!p2||p1!==p2||p1.length<1||p1.length>6) {
    document.getElementById('change-pin-error').classList.remove('hidden');
    return;
  }
  setPin(p1);
  hideAllModals();
  showToast('Admin PIN changed!','success');
});

// ─── Navigation ───────────────────────────────────────────────
function navigateTo(page) {
  document.querySelectorAll('#admin-view .page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  document.querySelector(`.nav-btn[data-page="${page}"]`).classList.add('active');

  switch(page) {
    case 'dashboard': loadDashboard(); break;
    case 'checkin': setupCheckIn(); document.getElementById('checkin-search').focus(); break;
    case 'checkout': loadCheckOut(); break;
    case 'students': loadStudents(); break;
    case 'register': break;
  }
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.page));
});

// ─── Modal Close ──────────────────────────────────────────────
document.getElementById('modal-overlay').addEventListener('click', function(e) {
  if (e.target===this) hideAllModals();
});
document.querySelectorAll('.modal-close').forEach(btn => { btn.addEventListener('click', hideAllModals); });

// ─── Clock ────────────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById('header-clock');
  if (el) el.textContent = new Date().toLocaleTimeString('en-MY', { hour:'2-digit', minute:'2-digit' });
}

// ─── Init ─────────────────────────────────────────────────────
const db = new AttendanceDB();

async function init() {
  try {
    await db.init();
    setupStudentRegistration();
    updateClock();
    setInterval(updateClock, 30000);

    // Always start in student/registration view (admin must enter PIN)
    // No sessionStorage — prevents iOS from accidentally showing dashboard
    switchToStudentMode();
  } catch (err) {
    console.error('Init failed:', err);
    document.getElementById('student-view').innerHTML = '<div style="padding:40px;text-align:center;"><h2>App failed to load</h2><p>Please refresh the page.</p></div>';
  }
}

document.addEventListener('DOMContentLoaded', init);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
