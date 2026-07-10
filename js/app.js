/* ============================================================
   DMP Attendance App - app.js
   IndexedDB + dual-mode + full BM/EN standardization
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
      const req = tx.objectStore('students').add({ ...data, registeredAt: new Date().toISOString() });
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  getStudents() {
    return new Promise((resolve, reject) => {
      const req = this.db.transaction('students','readonly').objectStore('students').getAll();
      req.onsuccess = (e) => resolve(e.target.result||[]);
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

  updateStudent(id, data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('students','readwrite');
      const store = tx.objectStore('students');
      store.get(id).onsuccess = (e) => {
        const existing = e.target.result;
        if (!existing) { reject(new Error('Pelajar tidak dijumpai')); return; }
        store.put({ ...existing, ...data, id: id });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
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
      store.index('studentId_date').get([studentId, today]).onsuccess = (e) => {
        if (e.target.result) { reject(new Error('Pelajar sudah hadir hari ini')); return; }
        store.add({ studentId, studentName, date: today, checkInTime: new Date().toISOString(), checkOutTime: null, status: 'present' })
          .onsuccess = (e2) => resolve(e2.target.result);
      };
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async removeCheckIn(studentId) {
    const today = getTodayDate();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('attendance','readwrite');
      const idx = tx.objectStore('attendance').index('studentId_date');
      idx.openCursor(IDBKeyRange.only([studentId, today])).onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  checkOut(attendanceId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('attendance','readwrite');
      tx.objectStore('attendance').get(attendanceId).onsuccess = (e) => {
        const r = e.target.result;
        if (!r) { reject(new Error('Rekod tidak dijumpai')); return; }
        if (r.checkOutTime) { reject(new Error('Sudah check-out')); return; }
        r.checkOutTime = new Date().toISOString(); r.status = 'completed';
        tx.objectStore('attendance').put(r).onsuccess = () => resolve(r);
      };
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  getTodayAttendance() { return this.getAttendanceByDate(getTodayDate()); }

  getAttendanceByDate(date) {
    return new Promise((resolve, reject) => {
      const req = this.db.transaction('attendance','readonly').objectStore('attendance').index('date').getAll(date);
      req.onsuccess = (e) => resolve(e.target.result||[]);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  getCurrentlyPresent() { return this.getTodayAttendance().then(all => all.filter(r => r.status==='present')); }

  getStudentAttendanceHistory(studentId) {
    return new Promise((resolve, reject) => {
      const req = this.db.transaction('attendance','readonly').objectStore('attendance').index('studentId').getAll(studentId);
      req.onsuccess = (e) => resolve(e.target.result||[]);
      req.onerror = (e) => reject(e.target.error);
    });
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
  if (h===0) return `${m}m`; if (m===0) return `${h}j`; return `${h}j ${m}m`;
}
function calcDurationHours(cIn, cOut) {
  if (!cIn||!cOut) return 0;
  return (new Date(cOut)-new Date(cIn))/3600000;
}
function showToast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `toast ${type}`;
  t.classList.remove('hidden');
  t.style.animation = 'none'; t.offsetHeight; t.style.animation = 'toastIn 0.3s ease-out';
  setTimeout(() => t.classList.add('hidden'), 2800);
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
let adminUnlocked = false;
function getPin() { return localStorage.getItem('dmp_admin_pin') || DEFAULT_PIN; }
function setPin(pin) { localStorage.setItem('dmp_admin_pin', pin); }
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

// ─── Reason selector helper ───────────────────────────────────
function getReasonValue(selectId, otherId) {
  const select = document.getElementById(selectId);
  if (select.value === 'other') return document.getElementById(otherId).value.trim() || 'Others';
  return select.value;
}
function toggleReasonOther(selectId, otherId) {
  const select = document.getElementById(selectId);
  const other = document.getElementById(otherId);
  if (select.value === 'other') {
    other.classList.remove('hidden');
    other.setAttribute('required', '');
    setTimeout(() => other.focus(), 100);
  } else {
    other.classList.add('hidden');
    other.removeAttribute('required');
    other.value = '';
  }
}

// ─── Registration ─────────────────────────────────────────────
let studentPhotoData = null;
let adminPhotoData = null;

function setupStudentRegistration() {
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
      reasonToJoin: getReasonValue('reg-reason', 'reg-reason-other'),
      profilePicture: studentPhotoData
    });
  });

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
      reasonToJoin: getReasonValue('admin-reg-reason', 'admin-reg-reason-other'),
      profilePicture: adminPhotoData
    });
    this.reset();
    adminPhotoData = null; resetAdminPhotoPreview();
    loadDashboard();
  });

  document.getElementById('reg-reason').addEventListener('change', () => toggleReasonOther('reg-reason', 'reg-reason-other'));
  document.getElementById('admin-reg-reason').addEventListener('change', () => toggleReasonOther('admin-reg-reason', 'admin-reg-reason-other'));
  document.getElementById('reg-reason-other').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('register-form').requestSubmit(); }
  });
}

function handlePhotoUpload(input, mode) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2*1024*1024) { showToast('Gambar terlalu besar. Maksimum 2MB.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    const data = e.target.result;
    if (mode==='student') { studentPhotoData = data; updatePhotoPreview('photo-preview', data); }
    else { adminPhotoData = data; updatePhotoPreview('admin-photo-preview', data); }
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
  preview.innerHTML = '<span class="photo-placeholder">📷</span><span>Tap untuk tambah gambar</span>';
}
function resetAdminPhotoPreview() { resetPhotoPreview('admin-photo-preview'); }

async function doRegister(data) {
  if (!data.name) { showToast('Nama diperlukan', 'error'); return; }
  if (!data.reasonToJoin) { showToast('Sebab sertai kelas diperlukan', 'error'); return; }
  try {
    await db.addStudent(data);
    const isStudentView = document.body.classList.contains('student-mode');
    if (isStudentView) {
      document.getElementById('register-form').classList.add('hidden');
      const success = document.getElementById('reg-success');
      success.classList.remove('hidden');
      success.style.animation = 'none'; success.offsetHeight; success.style.animation = 'fadeIn 0.4s ease-out';
      setTimeout(() => {
        success.classList.add('hidden');
        document.getElementById('register-form').classList.remove('hidden');
        resetStudentRegistrationForm();
      }, 3000);
    } else {
      resetStudentRegistrationForm();
      loadDashboard();
    }
    showToast(`${data.name} berjaya didaftarkan! 🎉`, 'success');
  } catch (err) {
    showToast('Gagal mendaftar: ' + err.message, 'error');
  }
}

document.getElementById('btn-register-another').addEventListener('click', () => {
  document.getElementById('reg-success').classList.add('hidden');
  document.getElementById('register-form').classList.remove('hidden');
  resetStudentRegistrationForm();
});
function resetStudentRegistrationForm() {
  document.getElementById('register-form').reset();
  studentPhotoData = null; resetPhotoPreview('photo-preview');
}
function resetRegistrationForm() {
  resetStudentRegistrationForm();
  document.getElementById('reg-success').classList.add('hidden');
  document.getElementById('register-form').classList.remove('hidden');
}

// ─── Dashboard ────────────────────────────────────────────────
async function loadDashboard() {
  if (!isAdminUnlocked()) return;
  const picker = document.getElementById('dashboard-date');
  if (!picker.value) picker.value = getTodayDate();
  const viewDate = picker.value;
  const isToday = viewDate === getTodayDate();

  const [students, attendance] = await Promise.all([db.getStudents(), db.getAttendanceByDate(viewDate)]);
  const present = attendance.filter(a => a.status==='present');
  const completed = attendance.filter(a => a.status==='completed');

  // Animate stat values
  animateValue('stat-total-students', parseInt(document.getElementById('stat-total-students').textContent)||0, students.length, 400);
  animateValue('stat-checked-in', parseInt(document.getElementById('stat-checked-in').textContent)||0, isToday ? present.length : attendance.length, 400);
  animateValue('stat-checked-out', parseInt(document.getElementById('stat-checked-out').textContent)||0, completed.length, 400);

  const withCheckout = attendance.filter(a => a.checkOutTime);
  const avgHrs = withCheckout.length>0 ? (withCheckout.reduce((s,a)=>s+calcDurationHours(a.checkInTime,a.checkOutTime),0)/withCheckout.length) : 0;
  document.getElementById('stat-avg-hours').textContent = avgHrs.toFixed(1)+'j';

  const list = document.getElementById('today-attendance-list');
  if (attendance.length===0) {
    list.innerHTML = `<div class="empty-state fade-in"><div class="empty-icon">📭</div><p>${isToday ? 'Tiada rekod kehadiran untuk hari ini.' : 'Tiada rekod kehadiran untuk ' + viewDate + '.'}</p></div>`;
    return;
  }

  list.innerHTML = attendance.sort((a,b)=>new Date(b.checkInTime)-new Date(a.checkInTime)).map((a,i) => {
    const d = a.checkOutTime ? calcDuration(a.checkInTime,a.checkOutTime) : (isToday ? 'Hadir' : 'Tiada check-out');
    return `<div class="attendance-item fade-in" style="animation-delay:${i*40}ms"><div class="item-left"><div class="item-avatar">👤</div><div class="item-info"><div class="item-name">${escapeHtml(a.studentName)}</div><div class="item-sub">Masuk: ${formatTime(a.checkInTime)}${a.checkOutTime?' · Keluar: '+formatTime(a.checkOutTime):''}</div></div></div><div class="item-time"><span class="${a.status==='present'?'time-in':'time-out'}">${d}</span></div></div>`;
  }).join('');
}

function animateValue(elId, start, end, duration) {
  const el = document.getElementById(elId);
  if (start === end) { el.textContent = end; return; }
  const range = end - start;
  const startTime = performance.now();
  function step(t) {
    const elapsed = t - startTime;
    const progress = Math.min(elapsed/duration, 1);
    const eased = 1 - Math.pow(1-progress, 3);
    el.textContent = Math.round(start + range * eased);
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = end;
  }
  requestAnimationFrame(step);
}

document.getElementById('dashboard-date').addEventListener('change', loadDashboard);

// ─── Export Report ────────────────────────────────────────────
async function exportDailyReport() {
  const viewDate = document.getElementById('dashboard-date').value;
  const attendance = await db.getAttendanceByDate(viewDate);
  if (attendance.length === 0) { showToast('Tiada rekod untuk tarikh ini.', 'error'); return; }

  const now = new Date();
  const displayDate = new Date(viewDate + 'T00:00:00');
  const dateStr = displayDate.toLocaleDateString('en-MY', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const timeStr = now.toLocaleTimeString('en-MY', { hour:'2-digit', minute:'2-digit' });

  const present = attendance.filter(a => a.status === 'present');
  const completed = attendance.filter(a => a.status === 'completed');
  const all = attendance.sort((a,b) => new Date(a.checkInTime) - new Date(b.checkInTime));

  let report = `📊 *Laporan Kehadiran DMP*\n📅 ${dateStr}\n🕐 Dijana: ${timeStr}\n━━━━━━━━━━━━━━━━━━━━\n`;
  all.forEach((a, i) => {
    const icon = a.status === 'present' ? '🟢' : '✅';
    const dur = a.checkOutTime ? ` (${calcDuration(a.checkInTime, a.checkOutTime)})` : ' - *Masih Dalam Kelas*';
    report += `${icon} ${i+1}. ${a.studentName}\n   Masuk: ${formatTime(a.checkInTime)} | Keluar: ${a.checkOutTime ? formatTime(a.checkOutTime) : '----'}${dur}\n`;
  });
  report += `━━━━━━━━━━━━━━━━━━━━\n👥 Jumlah: ${attendance.length} pelajar\n🟢 Dalam Kelas: ${present.length}\n✅ Checked Out: ${completed.length}\n`;
  if (completed.length > 0) {
    const tHrs = completed.reduce((s,a) => s + calcDurationHours(a.checkInTime, a.checkOutTime), 0);
    report += `⏱️ Purata: ${(tHrs/completed.length).toFixed(1)}j\n`;
  }
  report += `\n📋 DMP Pusat Pengajian`;

  const plain = report.replace(/\\n/g, '\n');
  if (navigator.share) { try { await navigator.share({ title: 'Laporan DMP', text: plain }); return; } catch(e) {} }
  try {
    await navigator.clipboard.writeText(plain);
    showToast('Laporan disalin! Membuka WhatsApp...', 'success');
    setTimeout(() => window.open(`https://wa.me/?text=${encodeURIComponent(plain)}`, '_blank'), 500);
  } catch(e) {
    showToast('Buka WhatsApp untuk kongsi laporan 📤', 'success');
    setTimeout(() => window.open(`https://wa.me/?text=${encodeURIComponent(plain)}`, '_blank'), 300);
  }
}
document.getElementById('btn-export-report').addEventListener('click', exportDailyReport);

// ─── Backup & Restore ─────────────────────────────────────────
async function backupAllData() {
  try {
    const students = await db.getStudents();
    const allAtt = await new Promise((res, rej) => {
      const req = db.db.transaction('attendance','readonly').objectStore('attendance').getAll();
      req.onsuccess = (e) => res(e.target.result||[]);
      req.onerror = (e) => rej(e.target.error);
    });
    const backup = { version: 1, exportedAt: new Date().toISOString(), students, attendance: allAtt };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const now = new Date();
    a.href = url; a.download = `dmp-backup-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.json`;
    a.click(); URL.revokeObjectURL(url);
    showToast(`Backup disimpan! (${students.length} pelajar, ${allAtt.length} rekod) 📦`, 'success');
  } catch (err) { showToast('Backup gagal: ' + err.message, 'error'); }
}

async function restoreAllData(file) {
  try {
    const text = await file.text();
    const backup = JSON.parse(text);
    if (!backup.students || !backup.attendance) throw new Error('Fail backup tidak sah');
    if (!confirm(`Pulihkan ${backup.students.length} pelajar dan ${backup.attendance.length} rekod kehadiran?\n\n⚠️ AMARAN: Ini akan menggantikan SEMUA data sedia ada.`)) return;

    await new Promise((res, rej) => {
      const tx = db.db.transaction(['students','attendance'], 'readwrite');
      tx.objectStore('students').clear();
      tx.objectStore('attendance').clear();
      tx.oncomplete = () => res(); tx.onerror = (e) => rej(e.target.error);
    });
    await new Promise((res, rej) => {
      const tx = db.db.transaction('students','readwrite');
      for (const s of backup.students) tx.objectStore('students').put(s);
      tx.oncomplete = () => res(); tx.onerror = (e) => rej(e.target.error);
    });
    await new Promise((res, rej) => {
      const tx = db.db.transaction('attendance','readwrite');
      for (const a of backup.attendance) tx.objectStore('attendance').put(a);
      tx.oncomplete = () => res(); tx.onerror = (e) => rej(e.target.error);
    });
    showToast(`Dipulihkan: ${backup.students.length} pelajar, ${backup.attendance.length} rekod ✅`, 'success');
    loadDashboard();
  } catch (err) { showToast('Pulih gagal: ' + err.message, 'error'); }
}
document.getElementById('btn-backup-data').addEventListener('click', backupAllData);
document.getElementById('btn-restore-data').addEventListener('click', () => document.getElementById('restore-file-input').click());
document.getElementById('restore-file-input').addEventListener('change', function() {
  if (this.files[0]) { restoreAllData(this.files[0]); this.value = ''; }
});

// ─── Check-In ─────────────────────────────────────────────────
let checkInAllStudents = [];
let checkInTodayIds = new Set();

async function setupCheckIn() {
  document.getElementById('checkin-search').value = '';
  [checkInAllStudents, checkInTodayIds] = await Promise.all([
    db.getStudents(),
    db.getTodayAttendance().then(a => new Set(a.map(r => r.studentId)))
  ]);
  renderCheckInList();
}

function renderCheckInList(filterQuery = '') {
  const q = filterQuery.toLowerCase().trim();
  let students = q ? checkInAllStudents.filter(s => s.name.toLowerCase().includes(q) || (s.phone&&s.phone.includes(q))) : checkInAllStudents;
  students = [...students].sort((a, b) => {
    const aIn = checkInTodayIds.has(a.id), bIn = checkInTodayIds.has(b.id);
    if (aIn && !bIn) return 1; if (!aIn && bIn) return -1; return a.name.localeCompare(b.name);
  });

  const div = document.getElementById('checkin-results');
  if (students.length === 0) {
    div.innerHTML = q
      ? `<div class="empty-state fade-in"><div class="empty-icon">🔎</div><p>Tiada pelajar dijumpai: "${escapeHtml(q)}"</p></div>`
      : '<div class="empty-state fade-in"><div class="empty-icon">📝</div><p>Tiada pelajar berdaftar. Daftar dahulu di tab Register.</p></div>';
    return;
  }

  const notCheckedIn = students.filter(s => !checkInTodayIds.has(s.id));
  const checkedIn = students.filter(s => checkInTodayIds.has(s.id));

  let html = '';
  if (notCheckedIn.length > 0) {
    html += `<div class="checkin-group-label">⬜ Belum Hadir (${notCheckedIn.length})</div>`;
    html += notCheckedIn.map((s,i) => {
      return `<div class="student-item fade-in" style="animation-delay:${i*30}ms"><div class="item-left"><div class="item-avatar">${s.profilePicture ? `<img src="${s.profilePicture}" alt="">` : '👤'}</div><div class="item-info"><div class="item-name">${escapeHtml(s.name)}</div><div class="item-sub">${s.age ? s.age + ' thn' : ''}${s.phone ? ' · ' + escapeHtml(s.phone) : ''}</div></div></div><div class="item-actions"><button class="btn btn-checkin-pulse btn-sm" data-id="${s.id}" data-name="${escapeHtml(s.name)}">✅ Hadir</button></div></div>`;
    }).join('');
  }
  if (checkedIn.length > 0) {
    html += `<div class="checkin-group-label checkin-done-label">✅ Dah Hadir (${checkedIn.length})</div>`;
    html += checkedIn.map((s,i) => {
      return `<div class="student-item checkin-done-item fade-in" style="animation-delay:${i*30}ms"><div class="item-left"><div class="item-avatar">${s.profilePicture ? `<img src="${s.profilePicture}" alt="">` : '👤'}</div><div class="item-info"><div class="item-name">${escapeHtml(s.name)}</div><div class="item-sub">${s.age ? s.age + ' thn' : ''}${s.phone ? ' · ' + escapeHtml(s.phone) : ''}</div></div></div><div class="item-actions"><button class="btn btn-undo btn-sm" data-id="${s.id}" data-name="${escapeHtml(s.name)}">↩ Batal</button></div></div>`;
    }).join('');
  }

  div.innerHTML = html;
  div.querySelectorAll('.btn-checkin-pulse').forEach(btn => {
    btn.addEventListener('click', () => showCheckInConfirm(parseInt(btn.dataset.id), btn.dataset.name));
  });
  div.querySelectorAll('.btn-undo').forEach(btn => {
    btn.addEventListener('click', () => undoCheckIn(parseInt(btn.dataset.id), btn.dataset.name));
  });
}

document.getElementById('checkin-search').addEventListener('input', function() { renderCheckInList(this.value); });

function showCheckInConfirm(sid, name) {
  const now = new Date();
  document.getElementById('modal-checkin-body').innerHTML = `<div class="confirm-card"><div class="confirm-icon">✅</div><p class="confirm-name">${escapeHtml(name)}</p><p class="confirm-detail">${now.toLocaleTimeString('en-MY',{hour:'2-digit',minute:'2-digit'})}<br><small>${now.toLocaleDateString('en-MY',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</small></p></div>`;
  document.getElementById('btn-confirm-checkin').onclick = () => performCheckIn(sid, name);
  showModal('modal-confirm-checkin');
}

async function performCheckIn(sid, name) {
  try {
    await db.checkIn(sid, name);
    hideAllModals();
    showToast(`${name} hadir! ✅`, 'success');
    checkInTodayIds.add(sid);
    renderCheckInList(document.getElementById('checkin-search').value);
    loadDashboard();
  } catch (err) {
    hideAllModals(); showToast(err.message, 'error');
  }
}

async function undoCheckIn(sid, name) {
  if (!confirm(`Batal kehadiran ${name}?`)) return;
  try {
    await db.removeCheckIn(sid);
    showToast(`Kehadiran ${name} dibatalkan ↩`, 'success');
    checkInTodayIds.delete(sid);
    renderCheckInList(document.getElementById('checkin-search').value);
    loadDashboard();
  } catch (err) { showToast('Gagal batal: ' + err.message, 'error'); }
}

// ─── Check-Out ────────────────────────────────────────────────
async function loadCheckOut() {
  const present = await db.getCurrentlyPresent();
  document.getElementById('checkout-count').textContent = present.length;
  const list = document.getElementById('checkout-list');
  if (present.length===0) {
    list.innerHTML = '<div class="empty-state fade-in"><div class="empty-icon">🏠</div><p>Tiada pelajar sedang hadir.</p></div>';
    return;
  }
  list.innerHTML = present.map((a,i) => {
    const dur = calcDuration(a.checkInTime, new Date().toISOString());
    return `<div class="attendance-item fade-in" style="animation-delay:${i*40}ms"><div class="item-left"><div class="item-avatar pulse-dot"></div><div class="item-info"><div class="item-name">${escapeHtml(a.studentName)}</div><div class="item-sub">Sejak: ${formatTime(a.checkInTime)} · ${dur}</div></div></div><div class="item-actions"><button class="btn btn-danger btn-sm btn-checkout" data-id="${a.id}" data-name="${escapeHtml(a.studentName)}">🚪 Keluar</button></div></div>`;
  }).join('');
  list.querySelectorAll('.btn-checkout').forEach(btn => {
    btn.addEventListener('click', () => showCheckOutConfirm(parseInt(btn.dataset.id), btn.dataset.name));
  });
}

function showCheckOutConfirm(aid, name) {
  const now = new Date();
  document.getElementById('modal-checkout-body').innerHTML = `<div class="confirm-card"><div class="confirm-icon">🚪</div><p class="confirm-name">${escapeHtml(name)}</p><p class="confirm-detail">Check-out pada ${now.toLocaleTimeString('en-MY',{hour:'2-digit',minute:'2-digit'})}</p></div>`;
  document.getElementById('btn-confirm-checkout').onclick = () => performCheckOut(aid, name);
  showModal('modal-confirm-checkout');
}

async function performCheckOut(aid, name) {
  try {
    await db.checkOut(aid);
    hideAllModals();
    showToast(`${name} telah keluar! 🚪`, 'success');
    await loadCheckOut();
    loadDashboard();
  } catch (err) { hideAllModals(); showToast(err.message, 'error'); }
}

// ─── Students List ────────────────────────────────────────────
async function loadStudents() {
  const q = document.getElementById('students-search').value.trim();
  const students = q ? await db.searchStudents(q) : await db.getStudents();
  const todayAtt = await db.getTodayAttendance();
  const todayMap = new Map(); todayAtt.forEach(a => todayMap.set(a.studentId, a));
  const list = document.getElementById('students-list');

  if (students.length===0) {
    list.innerHTML = q ? '<div class="empty-state fade-in"><div class="empty-icon">🔎</div><p>Tiada pelajar dijumpai.</p></div>' : '<div class="empty-state fade-in"><div class="empty-icon">📝</div><p>Tiada pelajar berdaftar lagi.</p></div>';
    return;
  }

  list.innerHTML = students.sort((a,b)=>a.name.localeCompare(b.name)).map((s,i) => {
    const rec = todayMap.get(s.id);
    let badge = '';
    if (rec&&rec.status==='present') badge = '<span class="count-badge" style="background:var(--green-light);color:var(--green);">Hadir</span>';
    else if (rec&&rec.status==='completed') badge = '<span class="count-badge" style="background:var(--red-light);color:var(--red);">Selesai</span>';
    else badge = '<span class="count-badge" style="background:var(--bg);color:var(--text-muted);">Tidak Hadir</span>';
    return `<div class="student-item student-detail-trigger fade-in" data-id="${s.id}" style="animation-delay:${i*30}ms;cursor:pointer;"><div class="item-left"><div class="item-avatar">${s.profilePicture?`<img src="${s.profilePicture}" alt="">`:'👤'}</div><div class="item-info"><div class="item-name">${escapeHtml(s.name)}</div><div class="item-sub">${s.phone?escapeHtml(s.phone)+' · ':''}${s.age?s.age+' thn':''}</div></div></div>${badge}</div>`;
  }).join('');

  list.querySelectorAll('.student-detail-trigger').forEach(item => {
    item.addEventListener('click', () => showStudentDetail(parseInt(item.dataset.id)));
  });
}
document.getElementById('students-search').addEventListener('input', loadStudents);

let currentDeleteId = null;

async function showStudentDetail(sid) {
  const s = await db.getStudent(sid);
  if (!s) { showToast('Pelajar tidak dijumpai', 'error'); return; }

  const history = await db.getStudentAttendanceHistory(sid);
  const completedSessions = history.filter(a => a.checkOutTime);
  const totalHours = completedSessions.reduce((sum, a) => sum + calcDurationHours(a.checkInTime, a.checkOutTime), 0);
  const avgHours = completedSessions.length > 0 ? (totalHours / completedSessions.length) : 0;
  const sortedHistory = [...history].sort((a,b) => new Date(b.checkInTime) - new Date(a.checkInTime));
  const lastAttendance = sortedHistory[0] || null;
  const recentHistory = sortedHistory.slice(0, 10);

  let html = '';
  html += s.profilePicture ? `<img src="${s.profilePicture}" alt="Photo" class="detail-photo">` : '<div style="text-align:center;font-size:48px;">👤</div>';
  html += '<div class="detail-grid">';
  html += `<span class="detail-label">Nama</span><span class="detail-value">${escapeHtml(s.name)}</span>`;
  html += `<span class="detail-label">Umur</span><span class="detail-value">${s.age||'-'}</span>`;
  html += `<span class="detail-label">Telefon</span><span class="detail-value">${escapeHtml(s.phone||'-')}</span>`;
  html += `<span class="detail-label">Email</span><span class="detail-value">${escapeHtml(s.email||'-')}</span>`;
  html += `<span class="detail-label">Alamat</span><span class="detail-value">${escapeHtml(s.address||'-')}</span>`;
  html += `<span class="detail-label">Sebab</span><span class="detail-value">${escapeHtml(s.reasonToJoin||'-')}</span>`;
  html += `<span class="detail-label">Didaftar</span><span class="detail-value">${formatDate(s.registeredAt)}</span>`;
  html += '</div>';

  html += '<div class="detail-stats-section"><h4>📊 Sejarah Kehadiran</h4>';
  html += '<div class="detail-stats-grid">';
  html += `<div class="detail-stat"><span class="stat-num">${history.length}</span><span class="stat-label-sm">Jumlah Sesi</span></div>`;
  html += `<div class="detail-stat"><span class="stat-num">${completedSessions.length}</span><span class="stat-label-sm">Selesai</span></div>`;
  html += `<div class="detail-stat"><span class="stat-num">${totalHours.toFixed(1)}j</span><span class="stat-label-sm">Jumlah Jam</span></div>`;
  html += `<div class="detail-stat"><span class="stat-num">${avgHours.toFixed(1)}j</span><span class="stat-label-sm">Purata/Sesi</span></div>`;
  html += '</div>';
  if (lastAttendance) {
    html += `<div class="detail-last-att"><span class="detail-label-sm">Terakhir Hadir:</span> ${formatDate(lastAttendance.checkInTime)} (${formatTime(lastAttendance.checkInTime)})</div>`;
  }
  if (recentHistory.length > 0) {
    html += '<div class="detail-history-list"><h5>10 Sesi Terkini</h5>';
    recentHistory.forEach(a => {
      const icon = a.status==='present' ? '🟢' : '✅';
      const dur = a.checkOutTime ? calcDuration(a.checkInTime, a.checkOutTime) : 'Belum Keluar';
      html += `<div class="detail-history-item"><span>${icon}</span><span>${formatDate(a.checkInTime)}</span><span>${formatTime(a.checkInTime)}-${a.checkOutTime?formatTime(a.checkOutTime):'--:--'}</span><span class="history-dur">${dur}</span></div>`;
    });
    html += '</div>';
  } else {
    html += '<p class="no-history">Tiada rekod kehadiran.</p>';
  }
  html += '</div>';

  document.getElementById('modal-detail-body').innerHTML = html;
  currentDeleteId = sid;
  showModal('modal-student-detail');
}

document.getElementById('btn-edit-student').addEventListener('click', async () => {
  if (currentDeleteId === null) return;
  hideAllModals();
  const s = await db.getStudent(currentDeleteId);
  if (!s) return;

  document.getElementById('modal-edit-body').innerHTML = `
    <div class="form-group"><label>Nama Penuh *</label><input type="text" id="edit-name" value="${escapeHtml(s.name)}" required></div>
    <div class="form-row">
      <div class="form-group"><label>Umur</label><input type="number" id="edit-age" value="${s.age||''}" min="1" max="120"></div>
      <div class="form-group"><label>Telefon</label><input type="tel" id="edit-phone" value="${escapeHtml(s.phone||'')}"></div>
    </div>
    <div class="form-group"><label>Email</label><input type="email" id="edit-email" value="${escapeHtml(s.email||'')}"></div>
    <div class="form-group"><label>Alamat</label><textarea id="edit-address" rows="2">${escapeHtml(s.address||'')}</textarea></div>
    <div class="form-group"><label>Sebab Sertai</label><input type="text" id="edit-reason" value="${escapeHtml(s.reasonToJoin||'')}"></div>
  `;
  showModal('modal-edit-student');

  document.getElementById('btn-save-edit').onclick = async () => {
    const updated = {
      name: document.getElementById('edit-name').value.trim(),
      age: parseInt(document.getElementById('edit-age').value) || null,
      phone: document.getElementById('edit-phone').value.trim(),
      email: document.getElementById('edit-email').value.trim(),
      address: document.getElementById('edit-address').value.trim(),
      reasonToJoin: document.getElementById('edit-reason').value.trim()
    };
    if (!updated.name) { showToast('Nama diperlukan', 'error'); return; }
    try {
      await db.updateStudent(currentDeleteId, updated);
      hideAllModals();
      showToast(`${updated.name} dikemaskini!`, 'success');
      loadStudents(); loadDashboard();
    } catch (err) { showToast('Gagal kemaskini: ' + err.message, 'error'); }
  };
});

document.getElementById('btn-delete-student').addEventListener('click', () => {
  hideAllModals();
  document.getElementById('delete-pin-input').value = '';
  document.getElementById('delete-pin-error').classList.add('hidden');
  showModal('modal-delete-confirm');
  setTimeout(() => document.getElementById('delete-pin-input').focus(), 300);
});

document.getElementById('btn-confirm-delete').addEventListener('click', async () => {
  const pin = document.getElementById('delete-pin-input').value.trim();
  if (pin !== getPin()) {
    document.getElementById('delete-pin-error').classList.remove('hidden');
    document.getElementById('delete-pin-input').value = '';
    document.getElementById('delete-pin-input').focus();
    return;
  }
  if (currentDeleteId === null) return;
  try {
    const s = await db.getStudent(currentDeleteId);
    await db.deleteStudent(currentDeleteId);
    hideAllModals();
    showToast(`${s?s.name:'Pelajar'} dipadam`, 'success');
    currentDeleteId = null;
    loadStudents(); loadDashboard();
  } catch (err) { hideAllModals(); showToast('Gagal padam', 'error'); }
});

// ─── PIN Auth ─────────────────────────────────────────────────
function showPinModal() {
  document.getElementById('pin-input').value = '';
  document.getElementById('pin-error').classList.add('hidden');
  showModal('modal-pin');
  setTimeout(() => document.getElementById('pin-input').focus(), 300);
}
document.getElementById('btn-admin-access').addEventListener('click', (e) => { e.preventDefault(); showPinModal(); });
document.getElementById('btn-pin-submit').addEventListener('click', () => {
  if (document.getElementById('pin-input').value.trim() === getPin()) {
    unlockAdmin(); hideAllModals(); switchToAdminMode();
  } else {
    document.getElementById('pin-error').classList.remove('hidden');
    document.getElementById('pin-input').value = '';
    document.getElementById('pin-input').focus();
  }
});
document.getElementById('pin-input').addEventListener('keydown', (e) => { if (e.key==='Enter') document.getElementById('btn-pin-submit').click(); });
document.getElementById('btn-admin-lock').addEventListener('click', () => {
  if (confirm('Kunci akses admin? Anda perlu masukkan PIN semula.')) switchToStudentMode();
});

// Change PIN (double-click lock button)
document.getElementById('btn-admin-lock').addEventListener('dblclick', () => {
  document.getElementById('change-pin-new').value = '';
  document.getElementById('change-pin-confirm').value = '';
  document.getElementById('change-pin-error').classList.add('hidden');
  showModal('modal-change-pin');
  setTimeout(() => document.getElementById('change-pin-new').focus(), 300);
});
document.getElementById('btn-change-pin-save').addEventListener('click', () => {
  const p1 = document.getElementById('change-pin-new').value.trim();
  const p2 = document.getElementById('change-pin-confirm').value.trim();
  if (!p1||!p2||p1!==p2||p1.length<1||p1.length>6) {
    document.getElementById('change-pin-error').classList.remove('hidden'); return;
  }
  setPin(p1); hideAllModals();
  showToast('PIN admin ditukar!', 'success');
});

// ─── Navigation ───────────────────────────────────────────────
function navigateTo(page) {
  document.querySelectorAll('#admin-view .page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const pgEl = document.getElementById(`page-${page}`);
  pgEl.classList.add('active');
  pgEl.style.animation = 'none'; pgEl.offsetHeight; pgEl.style.animation = 'fadeIn 0.25s ease-out';
  document.querySelector(`.nav-btn[data-page="${page}"]`).classList.add('active');

  switch(page) {
    case 'dashboard': loadDashboard(); break;
    case 'checkin': setupCheckIn(); document.getElementById('checkin-search').focus(); break;
    case 'checkout': loadCheckOut(); break;
    case 'students': loadStudents(); break;
  }
}
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.page));
});

// ─── Modal Close ──────────────────────────────────────────────
document.getElementById('modal-overlay').addEventListener('click', function(e) {
  if (e.target===this) hideAllModals();
});
document.querySelectorAll('.modal-close').forEach(btn => btn.addEventListener('click', hideAllModals));

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
    switchToStudentMode();
  } catch (err) {
    console.error('Init failed:', err);
    document.getElementById('student-view').innerHTML = '<div style="padding:40px;text-align:center;"><h2>Aplikasi gagal dimuatkan</h2><p>Sila muat semula halaman.</p></div>';
  }
}
document.addEventListener('DOMContentLoaded', init);
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch(() => {}); }
