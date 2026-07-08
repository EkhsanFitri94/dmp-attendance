/* ============================================================
   DMP Attendance App - app.js
   IndexedDB storage + UI logic
   ============================================================ */

// ─── Database Layer ───────────────────────────────────────────
class AttendanceDB {
  constructor() {
    this.DB_NAME = 'dmp-attendance';
    this.VERSION = 2;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('students')) {
          const studentsStore = db.createObjectStore('students', { keyPath: 'id', autoIncrement: true });
          studentsStore.createIndex('name', 'name', { unique: false });
          studentsStore.createIndex('registeredAt', 'registeredAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('attendance')) {
          const attStore = db.createObjectStore('attendance', { keyPath: 'id', autoIncrement: true });
          attStore.createIndex('studentId', 'studentId', { unique: false });
          attStore.createIndex('date', 'date', { unique: false });
          attStore.createIndex('studentId_date', ['studentId', 'date'], { unique: false });
        }
      };
      req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
      req.onerror = (e) => { console.error('DB init error:', e.target.error); reject(e.target.error); };
    });
  }

  // ── Students ──
  addStudent(data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('students', 'readwrite');
      const store = tx.objectStore('students');
      const record = { ...data, registeredAt: new Date().toISOString() };
      const req = store.add(record);
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  getStudents() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('students', 'readonly');
      const store = tx.objectStore('students');
      const req = store.getAll();
      req.onsuccess = (e) => resolve(e.target.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  getStudent(id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('students', 'readonly');
      const store = tx.objectStore('students');
      const req = store.get(id);
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  deleteStudent(id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['students', 'attendance'], 'readwrite');
      const studentStore = tx.objectStore('students');
      const attStore = tx.objectStore('attendance');

      studentStore.delete(id);

      // Delete all attendance records for this student
      const idx = attStore.index('studentId');
      const cursorReq = idx.openCursor(IDBKeyRange.only(id));
      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  searchStudents(query) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('students', 'readonly');
      const store = tx.objectStore('students');
      const req = store.getAll();
      req.onsuccess = (e) => {
        const all = e.target.result || [];
        const q = query.toLowerCase().trim();
        const results = all.filter(s =>
          s.name.toLowerCase().includes(q) ||
          (s.phone && s.phone.includes(q)) ||
          (s.email && s.email.toLowerCase().includes(q))
        );
        resolve(results);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // ── Attendance ──
  checkIn(studentId, studentName) {
    return new Promise((resolve, reject) => {
      const today = getTodayDate();
      const tx = this.db.transaction('attendance', 'readwrite');
      const store = tx.objectStore('attendance');
      const idx = store.index('studentId_date');

      // Check if already checked in today
      const checkReq = idx.get([studentId, today]);
      checkReq.onsuccess = (e) => {
        if (e.target.result) {
          reject(new Error('Already checked in today'));
          return;
        }
        const record = {
          studentId,
          studentName,
          date: today,
          checkInTime: new Date().toISOString(),
          checkOutTime: null,
          status: 'present'
        };
        const addReq = store.add(record);
        addReq.onsuccess = (e2) => resolve(e2.target.result);
        addReq.onerror = (e2) => reject(e2.target.error);
      };
      checkReq.onerror = (e) => reject(e.target.error);
    });
  }

  checkOut(attendanceId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('attendance', 'readwrite');
      const store = tx.objectStore('attendance');
      const req = store.get(attendanceId);
      req.onsuccess = (e) => {
        const record = e.target.result;
        if (!record) { reject(new Error('Record not found')); return; }
        if (record.checkOutTime) { reject(new Error('Already checked out')); return; }
        record.checkOutTime = new Date().toISOString();
        record.status = 'completed';
        const putReq = store.put(record);
        putReq.onsuccess = () => resolve(record);
        putReq.onerror = (e2) => reject(e2.target.error);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  getTodayAttendance() {
    return new Promise((resolve, reject) => {
      const today = getTodayDate();
      const tx = this.db.transaction('attendance', 'readonly');
      const store = tx.objectStore('attendance');
      const idx = store.index('date');
      const req = idx.getAll(today);
      req.onsuccess = (e) => resolve(e.target.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  getCurrentlyPresent() {
    return new Promise((resolve, reject) => {
      const today = getTodayDate();
      const tx = this.db.transaction('attendance', 'readonly');
      const store = tx.objectStore('attendance');
      const idx = store.index('date');
      const req = idx.getAll(today);
      req.onsuccess = (e) => {
        const all = e.target.result || [];
        resolve(all.filter(r => r.status === 'present'));
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  getAttendanceByDate(date) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('attendance', 'readonly');
      const store = tx.objectStore('attendance');
      const idx = store.index('date');
      const req = idx.getAll(date);
      req.onsuccess = (e) => resolve(e.target.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────
function getTodayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

function formatTime(isoString) {
  if (!isoString) return '--:--';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}

function calcDuration(checkIn, checkOut) {
  if (!checkIn || !checkOut) return '';
  const ms = new Date(checkOut) - new Date(checkIn);
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function calcDurationHours(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const ms = new Date(checkOut) - new Date(checkIn);
  return ms / 3600000;
}

function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2500);
}

function hideAllModals() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

function showModal(modalId) {
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById(modalId).classList.remove('hidden');
}

// ─── App State ────────────────────────────────────────────────
const db = new AttendanceDB();
let currentStudentIdToDelete = null;
let currentAttendanceToCheckOut = null;
let appUrl = window.location.href.split('?')[0]; // Base URL for QR

// ─── Navigation ───────────────────────────────────────────────
function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  const navBtn = document.querySelector(`.nav-btn[data-page="${page}"]`);
  if (navBtn) navBtn.classList.add('active');

  // Refresh page content
  switch(page) {
    case 'dashboard': loadDashboard(); break;
    case 'checkin': setupCheckIn(); break;
    case 'checkout': loadCheckOut(); break;
    case 'students': loadStudents(); break;
    case 'register': break;
  }
}

// ─── Dashboard ────────────────────────────────────────────────
async function loadDashboard() {
  document.getElementById('today-date').textContent = new Date().toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  const students = await db.getStudents();
  const todayAttendance = await db.getTodayAttendance();

  document.getElementById('stat-total-students').textContent = students.length;

  const present = todayAttendance.filter(a => a.status === 'present');
  const checkedOut = todayAttendance.filter(a => a.status === 'completed');

  document.getElementById('stat-checked-in').textContent = present.length;
  document.getElementById('stat-checked-out').textContent = checkedOut.length;

  // Average hours
  const completed = todayAttendance.filter(a => a.checkOutTime);
  if (completed.length > 0) {
    const totalHrs = completed.reduce((sum, a) => sum + calcDurationHours(a.checkInTime, a.checkOutTime), 0);
    const avg = totalHrs / completed.length;
    document.getElementById('stat-avg-hours').textContent = avg.toFixed(1) + 'h';
  } else {
    document.getElementById('stat-avg-hours').textContent = '0h';
  }

  // Today's list
  const list = document.getElementById('today-attendance-list');
  if (todayAttendance.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>No attendance records for today yet.</p></div>';
    return;
  }

  list.innerHTML = todayAttendance.sort((a,b) => new Date(b.checkInTime) - new Date(a.checkInTime)).map(a => {
    const duration = a.checkOutTime ? calcDuration(a.checkInTime, a.checkOutTime) : 'Present';
    const statusClass = a.status === 'present' ? 'time-in' : 'time-out';
    return `
      <div class="attendance-item">
        <div class="item-left">
          <div class="item-avatar">👤</div>
          <div class="item-info">
            <div class="item-name">${escapeHtml(a.studentName)}</div>
            <div class="item-sub">In: ${formatTime(a.checkInTime)}${a.checkOutTime ? ' · Out: ' + formatTime(a.checkOutTime) : ''}</div>
          </div>
        </div>
        <div class="item-time">
          <span class="${statusClass}">${duration}</span>
        </div>
      </div>
    `;
  }).join('');
}

// ─── Check-In ─────────────────────────────────────────────────
function setupCheckIn() {
  const input = document.getElementById('checkin-search');
  input.value = '';
  input.focus();
  document.getElementById('checkin-results').innerHTML = '<div class="empty-state"><div class="empty-icon">👆</div><p>Search for a student to check them in.</p></div>';
}

document.getElementById('checkin-search').addEventListener('input', async function() {
  const query = this.value.trim();
  if (!query) {
    setupCheckIn();
    return;
  }

  const students = await db.searchStudents(query);
  const todayAttendance = await db.getTodayAttendance();
  const todayCheckedInIds = new Set(todayAttendance.map(a => a.studentId));

  const resultsDiv = document.getElementById('checkin-results');

  if (students.length === 0) {
    resultsDiv.innerHTML = '<div class="empty-state"><div class="empty-icon">🔎</div><p>No students found matching "' + escapeHtml(query) + '"</p></div>';
    return;
  }

  resultsDiv.innerHTML = students.map(s => {
    const alreadyIn = todayCheckedInIds.has(s.id);
    return `
      <div class="student-item">
        <div class="item-left">
          <div class="item-avatar">${s.profilePicture ? `<img src="${s.profilePicture}" alt="">` : '👤'}</div>
          <div class="item-info">
            <div class="item-name">${escapeHtml(s.name)}</div>
            <div class="item-sub">${s.age ? s.age + ' yrs' : ''}${s.phone ? ' · ' + escapeHtml(s.phone) : ''}</div>
          </div>
        </div>
        <div class="item-actions">
          ${alreadyIn
            ? '<span style="color:var(--green);font-size:12px;font-weight:600;">✅ In</span>'
            : `<button class="btn btn-success btn-sm btn-checkin" data-id="${s.id}" data-name="${escapeHtml(s.name)}">Check In</button>`
          }
        </div>
      </div>
    `;
  }).join('');

  // Bind check-in buttons
  resultsDiv.querySelectorAll('.btn-checkin').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id);
      const name = btn.dataset.name;
      showCheckInConfirm(id, name);
    });
  });
});

function showCheckInConfirm(studentId, studentName) {
  const now = new Date();
  document.getElementById('modal-checkin-body').innerHTML = `
    <p style="text-align:center;font-size:15px;">
      Check in <strong>${studentName}</strong>?
    </p>
    <p style="text-align:center;color:var(--text-secondary);font-size:13px;">
      Time: ${now.toLocaleTimeString('en-MY', { hour:'2-digit', minute:'2-digit' })}
      <br>Date: ${now.toLocaleDateString('en-MY', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
    </p>
  `;
  document.getElementById('btn-confirm-checkin').onclick = () => performCheckIn(studentId, studentName);
  showModal('modal-confirm-checkin');
}

async function performCheckIn(studentId, studentName) {
  try {
    await db.checkIn(studentId, studentName);
    hideAllModals();
    showToast(`${studentName} checked in! ✅`, 'success');
    // Refresh search results
    document.getElementById('checkin-search').dispatchEvent(new Event('input'));
    loadDashboard();
  } catch (err) {
    hideAllModals();
    showToast(err.message, 'error');
  }
}

// ─── Check-Out ────────────────────────────────────────────────
async function loadCheckOut() {
  const present = await db.getCurrentlyPresent();
  const list = document.getElementById('checkout-list');
  document.getElementById('checkout-count').textContent = present.length;

  if (present.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">🏠</div><p>No one is currently checked in.</p></div>';
    return;
  }

  list.innerHTML = present.map(a => {
    const duration = calcDuration(a.checkInTime, new Date().toISOString());
    return `
      <div class="attendance-item">
        <div class="item-left">
          <div class="item-avatar">👤</div>
          <div class="item-info">
            <div class="item-name">${escapeHtml(a.studentName)}</div>
            <div class="item-sub">Since: ${formatTime(a.checkInTime)} · ${duration}</div>
          </div>
        </div>
        <div class="item-actions">
          <button class="btn btn-danger btn-sm btn-checkout" data-id="${a.id}" data-name="${escapeHtml(a.studentName)}">Check Out</button>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.btn-checkout').forEach(btn => {
    btn.addEventListener('click', () => {
      currentAttendanceToCheckOut = parseInt(btn.dataset.id);
      const name = btn.dataset.name;
      showCheckOutConfirm(currentAttendanceToCheckOut, name);
    });
  });
}

function showCheckOutConfirm(attendanceId, studentName) {
  const now = new Date();
  document.getElementById('modal-checkout-body').innerHTML = `
    <p style="text-align:center;font-size:15px;">
      Check out <strong>${studentName}</strong>?
    </p>
    <p style="text-align:center;color:var(--text-secondary);font-size:13px;">
      Time: ${now.toLocaleTimeString('en-MY', { hour:'2-digit', minute:'2-digit' })}
    </p>
  `;
  document.getElementById('btn-confirm-checkout').onclick = () => performCheckOut(attendanceId, studentName);
  showModal('modal-confirm-checkout');
}

async function performCheckOut(attendanceId, studentName) {
  try {
    await db.checkOut(attendanceId);
    hideAllModals();
    showToast(`${studentName} checked out! 🚪`, 'success');
    await loadCheckOut();
    loadDashboard();
  } catch (err) {
    hideAllModals();
    showToast(err.message, 'error');
  }
}

// ─── Register ─────────────────────────────────────────────────
let profilePictureData = null;

document.getElementById('photo-upload-area').addEventListener('click', () => {
  document.getElementById('photo-input').click();
});

document.getElementById('photo-input').addEventListener('change', function() {
  const file = this.files[0];
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) {
    showToast('Photo too large. Max 2MB.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    profilePictureData = e.target.result;
    const preview = document.getElementById('photo-preview');
    preview.classList.add('has-photo');
    preview.innerHTML = `<img src="${profilePictureData}" alt="Profile photo">`;
  };
  reader.readAsDataURL(file);
});

document.getElementById('register-form').addEventListener('submit', async function(e) {
  e.preventDefault();

  const data = {
    name: document.getElementById('reg-name').value.trim(),
    age: parseInt(document.getElementById('reg-age').value) || null,
    phone: document.getElementById('reg-phone').value.trim(),
    email: document.getElementById('reg-email').value.trim(),
    address: document.getElementById('reg-address').value.trim(),
    reasonToJoin: document.getElementById('reg-reason').value.trim(),
    profilePicture: profilePictureData
  };

  if (!data.name) { showToast('Name is required', 'error'); return; }
  if (!data.reasonToJoin) { showToast('Reason to join is required', 'error'); return; }

  try {
    await db.addStudent(data);
    showToast(`${data.name} registered successfully! 🎉`, 'success');
    this.reset();
    profilePictureData = null;
    const preview = document.getElementById('photo-preview');
    preview.classList.remove('has-photo');
    preview.innerHTML = '<span class="photo-placeholder">📷</span><span>Tap to add photo</span>';
    loadDashboard();
  } catch (err) {
    showToast('Failed to register: ' + err.message, 'error');
  }
});

// ─── Students List ────────────────────────────────────────────
async function loadStudents() {
  const query = document.getElementById('students-search').value.trim();
  const students = query ? await db.searchStudents(query) : await db.getStudents();
  const todayAttendance = await db.getTodayAttendance();
  const todayMap = new Map();
  todayAttendance.forEach(a => todayMap.set(a.studentId, a));

  const list = document.getElementById('students-list');

  if (students.length === 0) {
    list.innerHTML = query
      ? '<div class="empty-state"><div class="empty-icon">🔎</div><p>No students found.</p></div>'
      : '<div class="empty-state"><div class="empty-icon">📝</div><p>No students registered yet.</p></div>';
    return;
  }

  list.innerHTML = students.sort((a,b) => a.name.localeCompare(b.name)).map(s => {
    const todayRecord = todayMap.get(s.id);
    let statusBadge = '';
    if (todayRecord && todayRecord.status === 'present') {
      statusBadge = '<span class="count-badge" style="background:var(--green-light);color:var(--green);">Present</span>';
    } else if (todayRecord && todayRecord.status === 'completed') {
      statusBadge = '<span class="count-badge" style="background:var(--red-light);color:var(--red);">Done</span>';
    } else {
      statusBadge = '<span class="count-badge" style="background:var(--bg);color:var(--text-muted);">Absent</span>';
    }

    return `
      <div class="student-item student-detail-trigger" data-id="${s.id}">
        <div class="item-left">
          <div class="item-avatar">${s.profilePicture ? `<img src="${s.profilePicture}" alt="">` : '👤'}</div>
          <div class="item-info">
            <div class="item-name">${escapeHtml(s.name)}</div>
            <div class="item-sub">${s.phone ? escapeHtml(s.phone) + ' · ' : ''}${s.age ? s.age + 'yrs' : ''}</div>
          </div>
        </div>
        ${statusBadge}
      </div>
    `;
  }).join('');

  // Click to view detail
  list.querySelectorAll('.student-detail-trigger').forEach(item => {
    item.addEventListener('click', () => showStudentDetail(parseInt(item.dataset.id)));
  });
}

document.getElementById('students-search').addEventListener('input', loadStudents);

async function showStudentDetail(studentId) {
  const student = await db.getStudent(studentId);
  if (!student) { showToast('Student not found', 'error'); return; }

  document.getElementById('modal-detail-body').innerHTML = `
    ${student.profilePicture ? `<img src="${student.profilePicture}" alt="Photo" class="detail-photo">` : '<div style="text-align:center;font-size:48px;">👤</div>'}
    <div class="detail-grid">
      <span class="detail-label">Name</span><span class="detail-value">${escapeHtml(student.name)}</span>
      <span class="detail-label">Age</span><span class="detail-value">${student.age || '-'}</span>
      <span class="detail-label">Phone</span><span class="detail-value">${escapeHtml(student.phone || '-')}</span>
      <span class="detail-label">Email</span><span class="detail-value">${escapeHtml(student.email || '-')}</span>
      <span class="detail-label">Address</span><span class="detail-value">${escapeHtml(student.address || '-')}</span>
      <span class="detail-label">Reason</span><span class="detail-value">${escapeHtml(student.reasonToJoin || '-')}</span>
      <span class="detail-label">Registered</span><span class="detail-value">${formatDate(student.registeredAt)}</span>
    </div>
  `;

  currentStudentIdToDelete = studentId;
  showModal('modal-student-detail');
}

document.getElementById('btn-delete-student').addEventListener('click', () => {
  hideAllModals();
  showModal('modal-delete-confirm');
});

document.getElementById('btn-confirm-delete').addEventListener('click', async () => {
  if (currentStudentIdToDelete === null) return;
  try {
    const student = await db.getStudent(currentStudentIdToDelete);
    await db.deleteStudent(currentStudentIdToDelete);
    hideAllModals();
    showToast(`${student ? student.name : 'Student'} deleted`, 'success');
    currentStudentIdToDelete = null;
    loadStudents();
    loadDashboard();
  } catch (err) {
    hideAllModals();
    showToast('Failed to delete', 'error');
  }
});

// ─── QR Code ──────────────────────────────────────────────────
document.getElementById('btn-show-qr').addEventListener('click', () => {
  showModal('modal-qr');
  const container = document.getElementById('qr-container');
  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(appUrl);
  container.innerHTML = `<img src="${qrUrl}" alt="QR Code" width="220" height="220" style="border-radius:8px;" onerror="this.parentElement.innerHTML='<p style=color:var(--red)>Failed to load QR. Check internet connection.</p>'">`;
  document.getElementById('qr-url-display').textContent = appUrl;
});

document.getElementById('btn-copy-url').addEventListener('click', () => {
  navigator.clipboard.writeText(appUrl).then(
    () => showToast('URL copied!', 'success'),
    () => showToast('Failed to copy', 'error')
  );
});

// ─── Modal Close Handlers ─────────────────────────────────────
document.getElementById('modal-overlay').addEventListener('click', function(e) {
  if (e.target === this) hideAllModals();
});

document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', hideAllModals);
});

// ─── Nav Handlers ─────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.page));
});

// ─── Clock Update ─────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  document.getElementById('header-clock').textContent =
    now.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });
}

// ─── Escape HTML ──────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Init ─────────────────────────────────────────────────────
async function init() {
  try {
    await db.init();
    updateClock();
    setInterval(updateClock, 30000);
    loadDashboard();
  } catch (err) {
    console.error('App init failed:', err);
    document.body.innerHTML = '<div style="padding:40px;text-align:center;"><h2>App failed to load</h2><p>Please try refreshing the page.</p></div>';
  }
}

document.addEventListener('DOMContentLoaded', init);

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
