/* ============================================
   Carmen Burruel Salón ✨ — Admin Logic
   Firebase Firestore for persistence
   ============================================ */

// ── Firebase Config (Loaded from firebase-config.js) ──
// const firebaseConfig is now global

let db;

let SERVICES = [];
const DEFAULT_SERVICES = [
    { name: 'Micropigmentación de Cejas', duration: 240, emoji: '✒️', price: '$1,800 MXN' },
    { name: 'Cejas HD', duration: 120, emoji: '📐', price: '$450 MXN' },
    { name: 'Cejas 4K', duration: 150, emoji: '🎨', price: '$550 MXN' },
    { name: 'Depilación con Hilo (por zonas)', duration: 60, emoji: '🧵', price: '$150 MXN' },
    { name: 'Facial de Limpieza Profunda', duration: 120, emoji: '🧴', price: '$500 MXN' },
    { name: 'Lash Lifting', duration: 120, emoji: '👁️', price: '$450 MXN' },
    { name: 'Hollywood Peeling', duration: 120, emoji: '🖤', price: '$600 MXN' },
    { name: 'Levantamiento de Párpados', duration: 120, emoji: '⚡', price: '$600 MXN' },
    { name: 'Remoción de Tatuaje (chico)', duration: 120, emoji: '🗑️', price: '$700 MXN' },
    { name: 'Remoción de Verrugas (hasta 10)', duration: 120, emoji: '🩺', price: '$700 MXN' }
];

const DEFAULT_HOURS = {
    1: { open: '09:00', close: '21:00' },
    2: { open: '09:00', close: '21:00' },
    3: { open: '09:00', close: '21:00' },
    4: { open: '09:00', close: '21:00' },
    5: { open: '09:00', close: '21:00' },
    6: { open: '09:00', close: '21:00' },
    0: null
};

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Default admin password hash (SHA-256 of "salon2026")
const DEFAULT_PASSWORD_HASH = '7b5978b5b219b5a5e3d4b2c1a0f8e3d2c1b0a9f8e7d6c5b4a3928170605040302';

// ── State ──
let blockedDays = {};
let customHours = {};
let dayLocations = {};
let appointments = [];
let calendarMonth = new Date().getMonth();
let calendarYear = new Date().getFullYear();
let currentFilter = 'upcoming';
let selectedDayStr = null;
let maintenanceMode = false;
let defaultHours = { ...DEFAULT_HOURS };

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    initFirebase();
    bindLoginEvents();
});

function initFirebase() {
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    db = firebase.firestore();
}

// ── Simple password hashing ──
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Login ──
function bindLoginEvents() {
    document.getElementById('btnLogin').addEventListener('click', attemptLogin);
    document.getElementById('adminPassword').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') attemptLogin();
    });
}

async function attemptLogin() {
    const password = document.getElementById('adminPassword').value;
    if (!password) return;

    const hash = await hashPassword(password);

    // Check password from Firestore
    const doc = await db.collection('stefcitas_settings').doc('admin').get();
    let storedHash;

    if (doc.exists && doc.data().passwordHash) {
        storedHash = doc.data().passwordHash;
    } else {
        // First time — set default password "salon2026"
        const defaultHash = await hashPassword('1234');
        await db.collection('stefcitas_settings').doc('admin').set({
            passwordHash: defaultHash
        }, { merge: true });
        storedHash = defaultHash;
        document.getElementById('loginHint').textContent = 'Primera vez: usa "1234" como contraseña';
    }

    if (hash === storedHash) {
        showAdminPanel();
    } else {
        const errorEl = document.getElementById('loginError');
        errorEl.style.display = 'block';
        errorEl.style.animation = 'none';
        // Force reflow
        errorEl.offsetHeight;
        errorEl.style.animation = 'shake 0.4s ease';
    }
}

function showAdminPanel() {
    document.getElementById('loginGate').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
    startDataListeners();
    bindAdminEvents();
    renderServicesTable();
}

// ── Real-time Data ──
function startDataListeners() {
    // Settings (blocked days + custom hours)
    db.collection('stefcitas_settings').doc('availability').onSnapshot(doc => {
        if (doc.exists) {
            const data = doc.data();
            blockedDays = data.blockedDays || {};
            customHours = data.customHours || {};
            dayLocations = data.dayLocations || {};
            maintenanceMode = data.maintenanceMode || false;
            updateMaintenanceUI();

            // Parse defaultHours from Firestore if they exist
            if (data.defaultHours) {
                defaultHours = {};
                for (let i = 0; i <= 6; i++) {
                    defaultHours[i] = data.defaultHours[i] || null;
                }
            } else {
                defaultHours = { ...DEFAULT_HOURS };
            }
            renderDefaultHoursTable();
        } else {
            // Document doesn't exist yet (brand new project), render defaults
            blockedDays = {};
            customHours = {};
            dayLocations = {};
            maintenanceMode = false;
            updateMaintenanceUI();
            defaultHours = { ...DEFAULT_HOURS };
            renderDefaultHoursTable();
        }
        renderAdminCalendar();
    });

    // Appointments
    db.collection('stefcitas_appointments').onSnapshot(snapshot => {
        appointments = [];
        snapshot.forEach(doc => {
            appointments.push({ id: doc.id, ...doc.data() });
        });
        renderAppointments();
        renderAdminCalendar();
    });

    // Services
    db.collection('stefcitas_settings').doc('services').onSnapshot(doc => {
        if (doc.exists && doc.data().list && doc.data().list.length > 0) {
            SERVICES = doc.data().list;
        } else {
            SERVICES = [...DEFAULT_SERVICES];
        }
        renderServicesTable();
    });
}

// ── Admin Events ──
function bindAdminEvents() {
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`panel${capitalize(tab)}`).classList.add('active');
        });
    });

    // Calendar nav
    document.getElementById('adminPrevMonth').addEventListener('click', () => {
        calendarMonth--;
        if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
        renderAdminCalendar();
    });
    document.getElementById('adminNextMonth').addEventListener('click', () => {
        calendarMonth++;
        if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
        renderAdminCalendar();
    });

    // Close day detail
    document.getElementById('closeDayDetail').addEventListener('click', () => {
        document.getElementById('dayDetail').style.display = 'none';
        selectedDayStr = null;
    });

    // Appointment filters
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentFilter = btn.dataset.filter;
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderAppointments();
        });
    });

    // Change password
    document.getElementById('btnChangePassword').addEventListener('click', changePassword);

    // Services
    document.getElementById('btnSaveServices').addEventListener('click', saveServices);
    document.getElementById('btnAddService').addEventListener('click', () => {
        SERVICES.push({ name: '', duration: 60, emoji: '✨', price: '' });
        renderServicesTable();
    });

    // Maintenance Mode Toggle
    const btnToggleMaintenance = document.getElementById('btnToggleMaintenance');
    if (btnToggleMaintenance) {
        btnToggleMaintenance.addEventListener('click', async () => {
            try {
                btnToggleMaintenance.disabled = true;
                const newMode = !maintenanceMode;
                await db.collection('stefcitas_settings').doc('availability').set({
                    maintenanceMode: newMode
                }, { merge: true });
                showToast(newMode ? 'Página desactivada (Mensaje activo)' : 'Página activada para citas', 'success');
            } catch (error) {
                console.error('Error toggling maintenance mode:', error);
                showToast('Error al cambiar estado de la página.', 'error');
            } finally {
                btnToggleMaintenance.disabled = false;
            }
        });
    }

    // Save Default Hours
    const btnSaveDefaultHours = document.getElementById('btnSaveDefaultHours');
    if (btnSaveDefaultHours) {
        btnSaveDefaultHours.addEventListener('click', saveDefaultHours);
    }

    // Assign Range
    const btnAssignRange = document.getElementById('btnAssignRange');
    if (btnAssignRange) {
        btnAssignRange.addEventListener('click', assignDateRange);
    }
}

// ── Admin Calendar ──
function renderAdminCalendar() {
    const grid = document.getElementById('adminCalGrid');
    const label = document.getElementById('adminCalLabel');

    label.textContent = `${MONTH_NAMES[calendarMonth]} ${calendarYear}`;

    // Remove old day cells (keep headers)
    grid.querySelectorAll('.cal-day').forEach(el => el.remove());

    const firstDay = new Date(calendarYear, calendarMonth, 1);
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();

    let startCol = firstDay.getDay() - 1;
    if (startCol < 0) startCol = 6;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < startCol; i++) {
        const empty = document.createElement('div');
        empty.className = 'cal-day empty';
        grid.appendChild(empty);
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(calendarYear, calendarMonth, d);
        const dateStr = formatDateStr(date);
        const dayOfWeek = date.getDay();

        const dayLoc = dayLocations[dateStr] || 'Mexicali';

        const cell = document.createElement('div');
        cell.className = 'cal-day';

        const numSpan = document.createElement('span');
        numSpan.className = 'day-number';
        numSpan.textContent = d;
        cell.appendChild(numSpan);

        const locSpan = document.createElement('span');
        locSpan.className = 'day-location-badge';
        locSpan.textContent = dayLoc === 'Hermosillo' ? 'HMO' : 'MXL';
        cell.appendChild(locSpan);

        const isClosedGeneral = defaultHours[dayOfWeek] === null || defaultHours[dayOfWeek] === undefined;
        const isBlocked = blockedDays[dateStr] === true;

        if (dayLoc === 'Hermosillo') {
            cell.classList.add('loc-hermosillo');
        } else {
            cell.classList.add('loc-mexicali');
        }

        if (isClosedGeneral) {
            cell.classList.add('closed-general');
        }
        if (isBlocked) {
            cell.classList.add('blocked');
        }

        if (date.getTime() === today.getTime()) {
            cell.classList.add('today');
        }

        // Count appointments for this day
        const dayAppts = appointments.filter(a => a.date === dateStr);
        if (dayAppts.length > 0) {
            const badge = document.createElement('span');
            badge.className = 'appt-count';
            badge.textContent = dayAppts.length;
            cell.appendChild(badge);
        }

        cell.addEventListener('click', () => showDayDetail(date, dateStr));

        grid.appendChild(cell);
    }
}

// ── Day Detail ──
function showDayDetail(date, dateStr) {
    selectedDayStr = dateStr;
    const panel = document.getElementById('dayDetail');
    const title = document.getElementById('dayDetailTitle');
    const body = document.getElementById('dayDetailBody');

    title.textContent = `${DAY_NAMES[date.getDay()]} ${date.getDate()} de ${MONTH_NAMES[date.getMonth()]}`;

    const isBlocked = blockedDays[dateStr] === true;
    const hours = getHoursForDate(date);
    const dayAppts = appointments.filter(a => a.date === dateStr);

    let html = '';

    // Status
    html += `
        <div class="detail-row">
            <span class="detail-label">Estado</span>
            <span class="detail-value" style="color: ${isBlocked ? '#f87171' : '#4ade80'}; display: flex; align-items: center; gap: 6px;">
                ${isBlocked ? 
                    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line></svg> Bloqueado` : 
                    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> Disponible`
                }
            </span>
        </div>
    `;

    // Location Select
    const currentLoc = dayLocations[dateStr] || 'Mexicali';
    html += `
        <div class="detail-row" style="flex-direction: column; gap:10px; align-items: stretch;">
            <span class="detail-label">Ubicación asignada</span>
            <select id="dayLocationSelect" class="input-select" style="min-height: 40px; padding: 8px 32px 8px 16px; border-radius: 12px; font-size: 0.9em;" onchange="saveDayLocation('${dateStr}', this.value)">
                <option value="Mexicali" ${currentLoc === 'Mexicali' ? 'selected' : ''}>Mexicali, B.C.</option>
                <option value="Hermosillo" ${currentLoc === 'Hermosillo' ? 'selected' : ''}>Hermosillo, Son.</option>
            </select>
        </div>
    `;

    // Hours
    if (hours) {
        html += `
            <div class="detail-row">
                <span class="detail-label">Horario</span>
                <span class="detail-value">${formatTime12(hours.open)} — ${formatTime12(hours.close)}</span>
            </div>
        `;
    }

    // Custom hours input
    const currentCustom = customHours[dateStr];
    const defaultH = DEFAULT_HOURS[date.getDay()];
    const openVal = currentCustom ? currentCustom.open : (defaultH ? defaultH.open : '16:00');
    const closeVal = currentCustom ? currentCustom.close : (defaultH ? defaultH.close : '21:00');

    html += `
        <div class="detail-row" style="flex-direction: column; gap:10px; align-items: stretch;">
            <span class="detail-label">Horario personalizado para este día</span>
            <div class="custom-hours-row">
                <input type="time" id="customOpen" value="${openVal}">
                <span style="color:rgba(255,255,255,0.3)">—</span>
                <input type="time" id="customClose" value="${closeVal}">
                <button class="btn-save-hours" onclick="saveCustomHours('${dateStr}')">Guardar</button>
                ${currentCustom ? `<button class="btn-reset-hours" onclick="resetCustomHours('${dateStr}')">Reset</button>` : ''}
            </div>
        </div>
    `;

    // Appointments for this day
    if (dayAppts.length > 0) {
        html += `<div class="detail-row" style="flex-direction: column; gap:10px; align-items: stretch;">
            <span class="detail-label">Citas (${dayAppts.length})</span>`;
        dayAppts.sort((a, b) => a.time.localeCompare(b.time)).forEach(a => {
            html += `
                <div class="appt-card" style="margin:0;">
                    <span class="appt-emoji">${a.serviceEmoji || '📋'}</span>
                    <div class="appt-info">
                        <span class="appt-service">${a.service}</span>
                        <span class="appt-datetime">${a.time} · ${formatDuration(a.duration)}</span>
                        <span class="appt-client">${a.clientName} · ${a.clientPhone}</span>
                    </div>
                    <button class="btn-cancel-appt" onclick="cancelAppointment('${a.id}')">Cancelar</button>
                </div>
            `;
        });
        html += `</div>`;
    }

    // Block/unblock button
    html += `
        <button class="btn-block ${isBlocked ? 'unblock' : 'block'}" onclick="toggleBlockDay('${dateStr}', ${isBlocked})">
            ${isBlocked ? 'Desbloquear este día' : 'Bloquear este día'}
        </button>
    `;

    body.innerHTML = html;
    panel.style.display = 'block';
}

// ── Block/Unblock Day ──
async function toggleBlockDay(dateStr, currentlyBlocked) {
    try {
        const docRef = db.collection('stefcitas_settings').doc('availability');

        if (currentlyBlocked) {
            // ATOMIC delete of the specific key — no race condition possible
            await docRef.update({
                [`blockedDays.${dateStr}`]: firebase.firestore.FieldValue.delete()
            });
        } else {
            // ATOMIC set of the specific key
            await docRef.update({
                [`blockedDays.${dateStr}`]: true
            });
        }

        // Force local state update immediately (snapshot will confirm later)
        if (currentlyBlocked) {
            delete blockedDays[dateStr];
        } else {
            blockedDays[dateStr] = true;
        }

        showToast(currentlyBlocked ? 'Día desbloqueado' : 'Día bloqueado', 'success');

        // Re-render immediately
        renderAdminCalendar();
        if (selectedDayStr === dateStr) {
            const parts = dateStr.split('-');
            const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            showDayDetail(date, dateStr);
        }
    } catch (error) {
        console.error('Error updating blocked days:', error);
        showToast('Error al actualizar. Intenta de nuevo.', 'error');
    }
}

// ── Save Day Location ──
async function saveDayLocation(dateStr, location) {
    try {
        const newDayLocations = { ...dayLocations };
        newDayLocations[dateStr] = location;

        await db.collection('stefcitas_settings').doc('availability').set({
            dayLocations: newDayLocations
        }, { merge: true });

        // Update local state immediately
        dayLocations = newDayLocations;
        showToast(`Ubicación guardada: ${location}`, 'success');

        // Re-render calendar to update border indicators
        renderAdminCalendar();
    } catch (error) {
        console.error('Error saving day location:', error);
        showToast('Error al guardar la ubicación.', 'error');
    }
}

// ── Custom Hours ──
async function saveCustomHours(dateStr) {
    const open = document.getElementById('customOpen').value;
    const close = document.getElementById('customClose').value;

    if (!open || !close) return;

    try {
        const newCustom = { ...customHours };
        newCustom[dateStr] = { open, close };

        await db.collection('stefcitas_settings').doc('availability').set({
            blockedDays: blockedDays,
            customHours: newCustom
        }, { merge: true });

        showToast('Horario personalizado guardado', 'success');
    } catch (error) {
        console.error('Error saving custom hours:', error);
        showToast('Error al guardar horario personalizado.', 'error');
    }
}

async function resetCustomHours(dateStr) {
    try {
        const newCustom = { ...customHours };
        delete newCustom[dateStr];

        await db.collection('stefcitas_settings').doc('availability').set({
            blockedDays: blockedDays,
            customHours: newCustom
        }, { merge: true });

        showToast('Horario restablecido', 'info');
    } catch (error) {
        console.error('Error resetting custom hours:', error);
        showToast('Error al restablecer horario.', 'error');
    }
}

// ── Appointments List ──
function renderAppointments() {
    const list = document.getElementById('appointmentsList');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let filtered = [...appointments];

    if (currentFilter === 'upcoming') {
        filtered = filtered.filter(a => new Date(a.date + 'T23:59:59') >= today);
    } else if (currentFilter === 'past') {
        filtered = filtered.filter(a => new Date(a.date + 'T23:59:59') < today);
    }

    // Sort by date then time
    filtered.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return (a.time || '').localeCompare(b.time || '');
    });

    if (filtered.length === 0) {
        list.innerHTML = `<div class="no-appts">No hay citas ${currentFilter === 'upcoming' ? 'próximas' : currentFilter === 'past' ? 'pasadas' : ''}</div>`;
        return;
    }

    list.innerHTML = filtered.map(a => {
        const d = new Date(a.date + 'T00:00:00');
        return `
            <div class="appt-card">
                <span class="appt-emoji">${a.serviceEmoji || '📋'}</span>
                <div class="appt-info">
                    <span class="appt-service">${a.service}</span>
                    <span class="appt-datetime">${DAY_NAMES[d.getDay()]} ${d.getDate()} de ${MONTH_NAMES[d.getMonth()]} · ${a.time} · 📍 ${a.location || 'Mexicali'}</span>
                    <span class="appt-client">👤 ${a.clientName}</span>
                    <span class="appt-phone">📱 ${a.clientPhone}</span>
                </div>
                <button class="btn-cancel-appt" onclick="cancelAppointment('${a.id}')">Cancelar</button>
            </div>
        `;
    }).join('');
}

// ── Cancel Appointment ──
async function cancelAppointment(id) {
    if (!confirm('¿Estás segura de que quieres cancelar esta cita?')) return;

    try {
        await db.collection('stefcitas_appointments').doc(id).delete();
        showToast('Cita cancelada', 'success');
    } catch (error) {
        console.error('Error cancelling appointment:', error);
        showToast('Error al cancelar la cita.', 'error');
    }
}

// ── Change Password ──
async function changePassword() {
    const newPass = document.getElementById('newPassword').value;
    const confirmPass = document.getElementById('confirmPassword').value;
    const msg = document.getElementById('passwordMsg');

    if (!newPass || newPass.length < 4) {
        msg.innerHTML = `
            <span style="display: inline-flex; align-items: center; gap: 6px; justify-content: center; width: 100%;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line></svg>
                La contraseña debe tener al menos 4 caracteres
            </span>
        `;
        msg.className = 'settings-note error';
        return;
    }

    if (newPass !== confirmPass) {
        msg.innerHTML = `
            <span style="display: inline-flex; align-items: center; gap: 6px; justify-content: center; width: 100%;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line></svg>
                Las contraseñas no coinciden
            </span>
        `;
        msg.className = 'settings-note error';
        return;
    }

    try {
        const hash = await hashPassword(newPass);
        await db.collection('stefcitas_settings').doc('admin').set({
            passwordHash: hash
        }, { merge: true });

        msg.innerHTML = `
            <span style="display: inline-flex; align-items: center; gap: 6px; justify-content: center; width: 100%;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                Contraseña actualizada con éxito
            </span>
        `;
        msg.className = 'settings-note success';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
    } catch (error) {
        msg.innerHTML = `
            <span style="display: inline-flex; align-items: center; gap: 6px; justify-content: center; width: 100%;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line></svg>
                Error al cambiar la contraseña
            </span>
        `;
        msg.className = 'settings-note error';
    }
}

// ── Services Table ──
function renderServicesTable() {
    const table = document.getElementById('servicesTable');
    if (!SERVICES) return;

    // Build header row
    const headerRow = `
        <div class="service-header-row hide-on-mobile" style="display:flex; gap:10px; padding:0 10px 8px 10px; color:rgba(255,255,255,0.5); font-size:0.85em; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">
            <span style="width:60px; text-align:center;">Emoji</span>
            <span style="flex:2;">Nombre del Servicio</span>
            <span style="width:110px;">Duración</span>
            <span style="flex:1;">Precio Visible</span>
            <span style="width:40px;"></span>
        </div>
    `;

    const rows = SERVICES.map((s, idx) => `
        <div class="service-row new-service-row">
            <div class="service-col" style="width:60px;">
                <label class="mobile-label">Emoji</label>
                <input type="text" class="input-text service-emoji" value="${s.emoji}" data-idx="${idx}" placeholder="✨" style="text-align:center;">
            </div>
            <div class="service-col" style="flex:2;">
                <label class="mobile-label">Servicio</label>
                <input type="text" class="input-text service-name" value="${s.name}" data-idx="${idx}" placeholder="Nombre del servicio">
            </div>
            <div class="service-col" style="width:110px;">
                <label class="mobile-label">Duración (min)</label>
                <input type="number" class="input-text service-duration" value="${s.duration}" data-idx="${idx}" placeholder="60">
            </div>
            <div class="service-col" style="flex:1;">
                <label class="mobile-label">Precio Visible</label>
                <input type="text" class="input-text service-price" value="${s.price}" data-idx="${idx}" placeholder="Ej. $500 MXN">
            </div>
            <div class="service-col" style="width:40px; justify-content:flex-end;">
                <button class="btn-cancel-appt btn-delete-service" onclick="deleteService(${idx})" style="margin:0; width:40px; height:40px; font-size:16px; padding:0; display:flex; align-items:center; justify-content:center;" title="Eliminar servicio">🗑️</button>
            </div>
        </div>
    `).join('');

    table.innerHTML = headerRow + rows;
}

function deleteService(idx) {
    if (confirm('¿Eliminar este servicio? (Debes hacer clic en Guardar Cambios para que sea definitivo)')) {
        SERVICES.splice(idx, 1);
        renderServicesTable();
    }
}

async function saveServices() {
    const btn = document.getElementById('btnSaveServices');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
        const emojis = document.querySelectorAll('.service-emoji');
        const names = document.querySelectorAll('.service-name');
        const durations = document.querySelectorAll('.service-duration');
        const prices = document.querySelectorAll('.service-price');

        const newList = [];
        for (let i = 0; i < emojis.length; i++) {
            if (names[i].value.trim()) {
                newList.push({
                    emoji: emojis[i].value.trim() || '✨',
                    name: names[i].value.trim(),
                    duration: parseInt(durations[i].value) || 60,
                    price: prices[i].value.trim()
                });
            }
        }

        await db.collection('stefcitas_settings').doc('services').set({
            list: newList
        }, { merge: true });

        showToast('Servicios guardados con éxito', 'success');
    } catch (error) {
        console.error('Error saving services:', error);
        showToast('Error al guardar servicios', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar Cambios';
    }
}

// ── Helpers ──
function getHoursForDate(date) {
    const dateStr = formatDateStr(date);
    if (customHours[dateStr]) return customHours[dateStr];
    const dow = date.getDay();
    return defaultHours[dow] || null;
}

function formatDateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatDuration(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}min`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}min`;
}

function formatTime12(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// ── Toast Notification ──
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let svgIcon = '';
    if (type === 'success') {
        svgIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
    } else if (type === 'error') {
        svgIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line></svg>`;
    } else {
        svgIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C8A96B" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }
    toast.innerHTML = `<span class="toast-icon" style="display: flex; align-items: center; justify-content: center;">${svgIcon}</span>${message}`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ── Assign Date Range ──
async function assignDateRange() {
    const startVal = document.getElementById('rangeStart').value;
    const endVal = document.getElementById('rangeEnd').value;
    const locationVal = document.getElementById('rangeLocation').value;

    if (!startVal || !endVal) {
        showToast('Por favor selecciona ambas fechas.', 'error');
        return;
    }

    const startDate = new Date(startVal + 'T00:00:00');
    const endDate = new Date(endVal + 'T00:00:00');

    if (startDate > endDate) {
        showToast('La fecha inicial no puede ser posterior a la fecha final.', 'error');
        return;
    }

    const btn = document.getElementById('btnAssignRange');
    btn.disabled = true;
    btn.textContent = 'Guardando rango...';

    try {
        const newDayLocations = { ...dayLocations };
        let curr = new Date(startDate);
        while (curr <= endDate) {
            const dateStr = formatDateStr(curr);
            newDayLocations[dateStr] = locationVal;
            curr.setDate(curr.getDate() + 1);
        }

        await db.collection('stefcitas_settings').doc('availability').set({
            dayLocations: newDayLocations
        }, { merge: true });

        dayLocations = newDayLocations;
        showToast(`Rango asignado con éxito a ${locationVal === 'Hermosillo' ? 'Hermosillo' : 'Mexicali'}`, 'success');
        
        // Reset inputs
        document.getElementById('rangeStart').value = '';
        document.getElementById('rangeEnd').value = '';
        
        // Re-render
        renderAdminCalendar();
    } catch (error) {
        console.error('Error saving date range:', error);
        showToast('Error al guardar el rango de fechas.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Asignar Rango';
    }
}

function updateMaintenanceUI() {
    const btn = document.getElementById('btnToggleMaintenance');
    const status = document.getElementById('maintenanceStatus');
    if (!btn || !status) return;

    if (maintenanceMode) {
        btn.textContent = 'ACTIVAR PÁGINA';
        btn.style.background = 'linear-gradient(135deg, #ec4899, #be185d)';
        btn.style.boxShadow = '0 4px 16px rgba(236, 72, 153, 0.3)';
        status.textContent = 'Estado: página inactiva (Mensaje activo)';
        status.style.color = '#ef4444';
    } else {
        btn.textContent = 'DESACTIVAR PÁGINA';
        btn.style.background = '#ef4444';
        btn.style.boxShadow = '0 4px 16px rgba(239, 68, 68, 0.3)';
        status.textContent = 'Estado: página activa';
        status.style.color = '#4ade80';
    }
}

function renderDefaultHoursTable() {
    const container = document.getElementById('defaultHoursTable');
    if (!container) return;

    const dayLabels = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    container.innerHTML = '';

    for (let i = 0; i <= 6; i++) {
        const h = defaultHours[i];
        const isOpen = h !== null && h !== undefined;
        const openVal = isOpen ? h.open : '09:00';
        const closeVal = isOpen ? h.close : '18:00';

        const row = document.createElement('div');
        row.className = 'hours-row';
        row.style.cssText = 'align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 16px; background: rgba(255, 255, 255, 0.02); border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.04);';

        row.innerHTML = `
            <span class="hours-day" style="flex: 1; min-width: 100px; font-weight: 700; color: #fff;">${dayLabels[i]}</span>
            <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.9em; font-weight: 600; color: rgba(255,255,255,0.7);">
                    <input type="checkbox" id="chkDay${i}" ${isOpen ? 'checked' : ''}> Abierto
                </label>
                <input type="time" id="openDay${i}" value="${openVal}" ${isOpen ? '' : 'disabled'}>
                <span style="color: rgba(255,255,255,0.3)">—</span>
                <input type="time" id="closeDay${i}" value="${closeVal}" ${isOpen ? '' : 'disabled'}>
            </div>
        `;

        const chk = row.querySelector(`#chkDay${i}`);
        const openInput = row.querySelector(`#openDay${i}`);
        const closeInput = row.querySelector(`#closeDay${i}`);
        chk.addEventListener('change', () => {
            openInput.disabled = !chk.checked;
            closeInput.disabled = !chk.checked;
        });

        container.appendChild(row);
    }
}

async function saveDefaultHours() {
    const btn = document.getElementById('btnSaveDefaultHours');
    if (!btn) return;

    try {
        btn.disabled = true;
        const newHours = {};
        for (let i = 0; i <= 6; i++) {
            const chk = document.getElementById(`chkDay${i}`);
            if (chk && chk.checked) {
                const openVal = document.getElementById(`openDay${i}`).value;
                const closeVal = document.getElementById(`closeDay${i}`).value;
                newHours[i] = { open: openVal, close: closeVal };
            } else {
                newHours[i] = null;
            }
        }

        await db.collection('stefcitas_settings').doc('availability').set({
            defaultHours: newHours
        }, { merge: true });

        showToast('Horarios predeterminados guardados', 'success');
    } catch (error) {
        console.error('Error saving default hours:', error);
        showToast('Error al guardar horarios', 'error');
    } finally {
        btn.disabled = false;
    }
}
