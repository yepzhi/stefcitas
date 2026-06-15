/* ============================================
   Carmen Burruel Salón ✨ — Booking Logic
   Firebase Firestore for persistence
   ============================================ */

// ── Firebase Config (Loaded from firebase-config.js) ──
// const firebaseConfig is now global

let db;

// ── Services ──
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

// ── Default Business Hours ──
// 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 0=Sun
const DEFAULT_HOURS = {
    1: { open: '09:00', close: '21:00' }, // Lunes
    2: { open: '09:00', close: '21:00' }, // Martes
    3: { open: '09:00', close: '21:00' }, // Miércoles
    4: { open: '09:00', close: '21:00' }, // Jueves
    5: { open: '09:00', close: '21:00' }, // Viernes
    6: { open: '09:00', close: '21:00' }, // Sábado
    0: null                                // Domingo - cerrado
};
let defaultHours = { ...DEFAULT_HOURS };

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// ── State ──
let currentStep = 1;
let selectedLocation = '';
let selectedService = null;
let selectedDate = null;
let selectedTime = null;
let calendarMonth = new Date().getMonth();
let calendarYear = new Date().getFullYear();
let blockedDays = {};       // { "2026-03-10": true }
let customHours = {};       // { "2026-03-15": { open: "10:00", close: "18:00" } }
let dayLocations = {};      // { "2026-06-15": "Hermosillo" }
let appointments = [];      // from Firestore

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    // Render default services immediately so dropdown is never empty
    SERVICES = [...DEFAULT_SERVICES];
    renderServicesDropdown();
    initFirebase();
    bindEvents();
    renderCalendar();
});

function initFirebase() {
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    db = firebase.firestore();

    // Listen to settings (blocked days + custom hours) in real-time
    db.collection('stefcitas_settings').doc('availability').onSnapshot(doc => {
        if (doc.exists) {
            const data = doc.data();
            blockedDays = data.blockedDays || {};
            customHours = data.customHours || {};
            dayLocations = data.dayLocations || {};

            // Parse defaultHours from Firestore if they exist
            if (data.defaultHours) {
                defaultHours = {};
                for (let i = 0; i <= 6; i++) {
                    defaultHours[i] = data.defaultHours[i] || null;
                }
            } else {
                defaultHours = { ...DEFAULT_HOURS };
            }
            updateBusinessHoursLabel();
            
            // Check maintenance mode dynamically
            const maintenanceOverlay = document.getElementById('maintenanceOverlay');
            if (maintenanceOverlay) {
                if (data.maintenanceMode === true) {
                    maintenanceOverlay.style.display = 'flex';
                } else {
                    maintenanceOverlay.style.display = 'none';
                }
            }

            renderCalendar();
        }
    });

    // Listen to services — overrides defaults if admin has custom ones
    db.collection('stefcitas_settings').doc('services').onSnapshot(doc => {
        if (doc.exists && doc.data().list && doc.data().list.length > 0) {
            SERVICES = doc.data().list;
            renderServicesDropdown();
        } else {
            SERVICES = [...DEFAULT_SERVICES];
            renderServicesDropdown();
        }
    });

    // Listen to appointments in real-time
    db.collection('stefcitas_appointments').onSnapshot(snapshot => {
        appointments = [];
        snapshot.forEach(doc => {
            appointments.push({ id: doc.id, ...doc.data() });
        });
        // Re-render time slots if on step 3
        if (currentStep === 3 && selectedDate) {
            renderTimeSlots();
        }
    });
}

function renderServicesDropdown() {
    const select = document.getElementById('serviceSelect');
    if (!selectedLocation) {
        select.innerHTML = '<option value="" disabled selected>— Primero elige ubicación —</option>';
        select.disabled = true;
        return;
    }

    // Keep the first disabled option
    select.innerHTML = '<option value="" disabled selected>— Elige un servicio —</option>';
    select.disabled = false;

    SERVICES.forEach((service, index) => {
        const option = document.createElement('option');
        option.value = index;
        const durationStr = formatDuration(service.duration);
        option.textContent = `${service.emoji} ${service.name} — ${durationStr} · ${service.price}`;
        select.appendChild(option);
    });

    // Reset selection if it was already selected but no longer exists
    if (selectedService) {
        const foundIndex = SERVICES.findIndex(s => s.name === selectedService.name);
        if (foundIndex !== -1) {
            select.value = foundIndex;
            selectedService = SERVICES[foundIndex];
            showServiceInfo(selectedService);
        } else {
            resetBooking();
        }
    }
}

function bindEvents() {
    // Location select
    const locationSelect = document.getElementById('locationSelect');
    if (locationSelect) {
        locationSelect.addEventListener('change', (e) => {
            selectedLocation = e.target.value;
            selectedDate = null;
            selectedService = null;
            selectedTime = null;
            document.getElementById('serviceInfo').style.display = 'none';
            document.getElementById('btnNext1').disabled = true;
            document.getElementById('btnNext2').disabled = true;
            renderServicesDropdown();
            renderCalendar();
        });
    }

    // Service select
    document.getElementById('serviceSelect').addEventListener('change', (e) => {
        const idx = parseInt(e.target.value);
        if (!isNaN(idx)) {
            selectedService = SERVICES[idx];
            showServiceInfo(selectedService);
            document.getElementById('btnNext2').disabled = false;
        }
    });

    // Step navigation
    document.getElementById('btnNext1').addEventListener('click', () => goToStep(2));
    document.getElementById('btnBack2').addEventListener('click', () => goToStep(1));
    document.getElementById('btnNext2').addEventListener('click', () => goToStep(3));
    document.getElementById('btnBack3').addEventListener('click', () => goToStep(2));
    document.getElementById('btnNext3').addEventListener('click', () => goToStep(4));
    document.getElementById('btnBack4').addEventListener('click', () => goToStep(3));
    document.getElementById('btnNext4').addEventListener('click', () => goToStep(5));
    document.getElementById('btnBack5').addEventListener('click', () => goToStep(4));

    // Calendar nav
    document.getElementById('prevMonth').addEventListener('click', () => {
        calendarMonth--;
        if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
        renderCalendar();
    });
    document.getElementById('nextMonth').addEventListener('click', () => {
        calendarMonth++;
        if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
        renderCalendar();
    });

    // Client info validation
    document.getElementById('clientName').addEventListener('input', validateClientInfo);
    document.getElementById('clientPhone').addEventListener('input', validateClientInfo);

    // Confirm booking
    document.getElementById('btnConfirm').addEventListener('click', confirmBooking);

    // New booking
    document.getElementById('btnNewBooking').addEventListener('click', resetBooking);
}

// ── Service Info Display ──
function showServiceInfo(service) {
    const card = document.getElementById('serviceInfo');
    document.getElementById('serviceEmoji').textContent = service.emoji;
    document.getElementById('serviceName').textContent = service.name;
    document.getElementById('serviceDuration').textContent = `Duración: ${formatDuration(service.duration)} · ${service.price}`;
    card.style.display = 'block';
}

function formatDuration(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}min`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}min`;
}

// ── Step Navigation ──
function goToStep(step) {
    // Hide all panels
    document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('stepSuccess').style.display = 'none';

    // Show target panel
    const panel = document.getElementById(`step${step}`);
    if (panel) panel.classList.add('active');

    // Update progress bar
    document.querySelectorAll('.progress-step').forEach(ps => {
        const s = parseInt(ps.dataset.step);
        ps.classList.remove('active', 'completed');
        if (s === step) ps.classList.add('active');
        else if (s < step) ps.classList.add('completed');
    });

    // Update progress lines
    const lines = document.querySelectorAll('.progress-line');
    lines.forEach((line, i) => {
        if (i < step - 1) line.classList.add('filled');
        else line.classList.remove('filled');
    });

    currentStep = step;

    // Step-specific actions
    if (step === 1) renderCalendar();
    if (step === 3) renderTimeSlots();
    if (step === 5) renderConfirmation();
}

// ── Calendar ──
function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    const label = document.getElementById('calMonthLabel');

    label.textContent = `${MONTH_NAMES[calendarMonth]} ${calendarYear}`;

    // Remove old day cells (keep headers)
    grid.querySelectorAll('.cal-day').forEach(el => el.remove());

    const firstDay = new Date(calendarYear, calendarMonth, 1);
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();

    // JS getDay: 0=Sun. We need Mon=0 for grid
    let startCol = firstDay.getDay() - 1;
    if (startCol < 0) startCol = 6; // Sunday wraps

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Empty cells before first day
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

        const isPast = date < today;
        const isSunday = dayOfWeek === 0;
        const isBlocked = blockedDays[dateStr] === true;
        const hasHours = getHoursForDate(date) !== null;

        if (dayLoc === 'Hermosillo') {
            cell.classList.add('loc-hermosillo');
        } else {
            cell.classList.add('loc-mexicali');
        }

        const isWrongLocation = dayLoc !== selectedLocation;

        // Check if today is past closing time
        const now = new Date();
        let isTodayClosed = false;
        if (date.getTime() === today.getTime() && hasHours) {
            const closeMin = timeToMinutes(getHoursForDate(date).close);
            const nowMin = now.getHours() * 60 + now.getMinutes();
            isTodayClosed = nowMin >= closeMin;
        }

        const isFull = hasHours && !isPast && !isTodayClosed && !isSunday && !isBlocked && isDayFull(date);

        if (isPast || isTodayClosed || isSunday || isBlocked || !hasHours || isFull || isWrongLocation) {
            cell.classList.add('disabled');
            if (isFull) {
                cell.classList.add('full');
                cell.title = 'Día completo';
            }
        } else {
            cell.addEventListener('click', () => selectDate(date, cell));
        }

        // Highlight today
        if (date.getTime() === today.getTime()) {
            cell.classList.add('today');
        }

        // Selected state
        if (selectedDate && dateStr === formatDateStr(selectedDate)) {
            cell.classList.add('selected');
        }

        grid.appendChild(cell);
    }
}

// Check if a day has no available slots for the shortest service (60min)
function isDayFull(date) {
    const hours = getHoursForDate(date);
    if (!hours) return true;

    const openMin = timeToMinutes(hours.open);
    const closeMin = timeToMinutes(hours.close);

    // If times couldn't be parsed, don't mark as full
    if (isNaN(openMin) || isNaN(closeMin) || closeMin <= openMin) return false;

    const minDuration = 60; // Shortest service is 1 hour
    const dateStr = formatDateStr(date);
    const dateAppts = appointments.filter(a => a.date === dateStr);

    // No appointments = definitely not full
    if (dateAppts.length === 0) return false;

    for (let t = openMin; t + minDuration <= closeMin; t += 30) {
        const slotStart = t;
        const slotEnd = t + minDuration;
        const conflict = dateAppts.some(a => {
            const aStart = timeToMinutes(a.time);
            const aDuration = a.duration || (SERVICES.find(s => s.name === a.service) || {}).duration || 60;
            const aEnd = aStart + aDuration;
            return slotStart < aEnd && slotEnd > aStart;
        });
        if (!conflict) return false; // Found at least one free slot
    }
    return true; // No free slots
}

function selectDate(date, cell) {
    selectedDate = date;
    selectedTime = null;
    document.getElementById('btnNext1').disabled = false;

    // Update visual selection
    document.querySelectorAll('.cal-day.selected').forEach(c => c.classList.remove('selected'));
    cell.classList.add('selected');
}

// ── Time Slots ──
function renderTimeSlots() {
    const grid = document.getElementById('timeSlotsGrid');
    const label = document.getElementById('selectedDateLabel');
    grid.innerHTML = '';

    if (!selectedDate || !selectedService) return;

    const dayName = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][selectedDate.getDay()];
    label.textContent = `${dayName} ${selectedDate.getDate()} de ${MONTH_NAMES[selectedDate.getMonth()]}`;

    const hours = getHoursForDate(selectedDate);
    if (!hours) {
        grid.innerHTML = '<div class="no-slots-message">No hay horarios disponibles para este día</div>';
        return;
    }

    const openMin = timeToMinutes(hours.open);
    const closeMin = timeToMinutes(hours.close);
    const duration = selectedService.duration;
    const dateStr = formatDateStr(selectedDate);

    // Get existing appointments for this date
    const dateAppts = appointments.filter(a => a.date === dateStr);

    let slotCount = 0;

    for (let t = openMin; t + duration <= closeMin; t += 30) {
        const slotStart = t;
        const slotEnd = t + duration;

        // Check for conflicts with existing appointments
        const conflict = dateAppts.some(a => {
            const aStart = timeToMinutes(a.time);
            const aDuration = a.duration || (SERVICES.find(s => s.name === a.service) || {}).duration || 60;
            const aEnd = aStart + aDuration;
            return slotStart < aEnd && slotEnd > aStart;
        });

        // Skip past time slots for today
        const now = new Date();
        const isToday = selectedDate.toDateString() === now.toDateString();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        if (isToday && slotStart < nowMin) {
            continue;
        }

        const btn = document.createElement('div');
        btn.className = 'time-slot';
        btn.textContent = minutesToTime(t);

        if (conflict) {
            btn.classList.add('disabled');
            btn.title = 'Horario ocupado';
        } else {
            btn.addEventListener('click', () => selectTime(t, btn));
        }

        if (selectedTime === t) {
            btn.classList.add('selected');
        }

        grid.appendChild(btn);
        slotCount++;
    }

    if (slotCount === 0) {
        grid.innerHTML = '<div class="no-slots-message">No hay horarios disponibles para este servicio en este día</div>';
    }

    document.getElementById('btnNext3').disabled = selectedTime === null;
}

function selectTime(minutes, btn) {
    selectedTime = minutes;
    document.getElementById('btnNext3').disabled = false;

    document.querySelectorAll('.time-slot.selected').forEach(s => s.classList.remove('selected'));
    btn.classList.add('selected');
}

// ── Client Info Validation ──
function validateClientInfo() {
    const name = document.getElementById('clientName').value.trim();
    const phone = document.getElementById('clientPhone').value.trim();
    document.getElementById('btnNext4').disabled = !(name.length >= 2 && phone.length >= 7);
}

// ── Confirmation ──
function renderConfirmation() {
    const card = document.getElementById('confirmationCard');
    const dayName = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][selectedDate.getDay()];

    card.innerHTML = `
        <div class="confirm-row">
            <span class="confirm-label">Ubicación</span>
            <span class="confirm-value">${selectedLocation}</span>
        </div>
        <div class="confirm-divider"></div>
        <div class="confirm-row">
            <span class="confirm-label">Servicio</span>
            <span class="confirm-value">${selectedService.emoji} ${selectedService.name}</span>
        </div>
        <div class="confirm-divider"></div>
        <div class="confirm-row">
            <span class="confirm-label">Duración</span>
            <span class="confirm-value">${formatDuration(selectedService.duration)}</span>
        </div>
        <div class="confirm-divider"></div>
        <div class="confirm-row">
            <span class="confirm-label">Precio</span>
            <span class="confirm-value">${selectedService.price}</span>
        </div>
        <div class="confirm-divider"></div>
        <div class="confirm-row">
            <span class="confirm-label">Fecha</span>
            <span class="confirm-value">${dayName} ${selectedDate.getDate()} de ${MONTH_NAMES[selectedDate.getMonth()]}, ${selectedDate.getFullYear()}</span>
        </div>
        <div class="confirm-divider"></div>
        <div class="confirm-row">
            <span class="confirm-label">Hora</span>
            <span class="confirm-value">${minutesToTime(selectedTime)} — ${minutesToTime(selectedTime + selectedService.duration)}</span>
        </div>
        <div class="confirm-divider"></div>
        <div class="confirm-row">
            <span class="confirm-label">Cliente</span>
            <span class="confirm-value">${document.getElementById('clientName').value.trim()}</span>
        </div>
        <div class="confirm-row">
            <span class="confirm-label">Teléfono</span>
            <span class="confirm-value">${document.getElementById('clientPhone').value.trim()}</span>
        </div>
    `;
}

// ── Book Appointment ──
async function confirmBooking() {
    const btn = document.getElementById('btnConfirm');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
        const appointment = {
            service: selectedService.name,
            serviceEmoji: selectedService.emoji,
            duration: selectedService.duration,
            price: selectedService.price,
            date: formatDateStr(selectedDate),
            time: minutesToTime(selectedTime),
            location: selectedLocation,
            clientName: document.getElementById('clientName').value.trim(),
            clientPhone: document.getElementById('clientPhone').value.trim(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('stefcitas_appointments').add(appointment);

        // Show success screen
        showSuccess(appointment);

        // Open WhatsApp automatically
        const dayName = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const d = new Date(appointment.date + 'T00:00:00');
        const dayStr = `${dayName[d.getDay()]} ${d.getDate()} de ${MONTH_NAMES[d.getMonth()]}`;
        const waMessage = `Hola Stefany, acabo de agendar una cita para *${appointment.serviceEmoji} ${appointment.service}* en *${appointment.location}* el *${dayStr}* a las *${appointment.time}*. Mi nombre es *${appointment.clientName}*.`;
        const waUrl = `https://wa.me/5216864401681?text=${encodeURIComponent(waMessage)}`;
        
        // Timeout to ensure Firestore updates and UI transitions complete first
        setTimeout(() => {
            window.open(waUrl, '_blank');
        }, 500);

    } catch (error) {
        console.error('Error al guardar cita:', error);
        alert('Error al guardar la cita. Por favor intenta de nuevo.');
        btn.disabled = false;
        btn.textContent = 'Confirmar Cita ✨';
    }
}

function showSuccess(appt) {
    document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('stepSuccess').style.display = 'flex';

    // Fill success card
    const dayName = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const d = new Date(appt.date + 'T00:00:00');
    const dayStr = `${dayName[d.getDay()]} ${d.getDate()} de ${MONTH_NAMES[d.getMonth()]}`;

    document.getElementById('successCard').innerHTML = `
        <div class="confirm-row">
            <span class="confirm-label">Ubicación</span>
            <span class="confirm-value">${appt.location || 'Mexicali'}</span>
        </div>
        <div class="confirm-divider"></div>
        <div class="confirm-row">
            <span class="confirm-label">Servicio</span>
            <span class="confirm-value">${appt.serviceEmoji} ${appt.service}</span>
        </div>
        <div class="confirm-divider"></div>
        <div class="confirm-row">
            <span class="confirm-label">Fecha</span>
            <span class="confirm-value">${dayStr}</span>
        </div>
        <div class="confirm-divider"></div>
        <div class="confirm-row">
            <span class="confirm-label">Hora</span>
            <span class="confirm-value">${appt.time}</span>
        </div>
        <div class="confirm-divider"></div>
        <div class="confirm-row">
            <span class="confirm-label">Cliente</span>
            <span class="confirm-value">${appt.clientName}</span>
        </div>
    `;

    // Configure WhatsApp confirmation button link
    const waMessage = `Hola Stefany, acabo de agendar una cita para *${appt.serviceEmoji} ${appt.service}* en *${appt.location || 'Mexicali'}* el *${dayStr}* a las *${appt.time}*. Mi nombre es *${appt.clientName}*.`;
    const waUrl = `https://wa.me/5216864401681?text=${encodeURIComponent(waMessage)}`;
    document.getElementById('btnWhatsAppConfirm').setAttribute('href', waUrl);

    // Update progress bar to all completed
    document.querySelectorAll('.progress-step').forEach(ps => ps.classList.add('completed'));
    document.querySelectorAll('.progress-line').forEach(l => l.classList.add('filled'));
}

function resetBooking() {
    selectedLocation = '';
    selectedService = null;
    selectedDate = null;
    selectedTime = null;

    const locationSelect = document.getElementById('locationSelect');
    if (locationSelect) locationSelect.value = '';

    const serviceSelect = document.getElementById('serviceSelect');
    if (serviceSelect) {
        serviceSelect.value = '';
        serviceSelect.disabled = true;
    }

    document.getElementById('serviceInfo').style.display = 'none';
    document.getElementById('clientName').value = '';
    document.getElementById('clientPhone').value = '';
    document.getElementById('btnNext1').disabled = true;
    document.getElementById('btnNext2').disabled = true;
    document.getElementById('btnConfirm').disabled = false;
    document.getElementById('btnConfirm').textContent = 'Confirmar Cita ✨';

    calendarMonth = new Date().getMonth();
    calendarYear = new Date().getFullYear();

    goToStep(1);
}

// ── Helpers ──
function getHoursForDate(date) {
    const dateStr = formatDateStr(date);
    // Check custom hours first
    if (customHours[dateStr]) return customHours[dateStr];
    // Default hours
    const dow = date.getDay();
    return defaultHours[dow] || null;
}

function formatDateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function timeToMinutes(timeStr) {
    // Handle "4:30 PM" format
    const ampmMatch = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (ampmMatch) {
        let h = parseInt(ampmMatch[1]);
        const m = parseInt(ampmMatch[2]);
        const period = ampmMatch[3].toUpperCase();
        if (period === 'PM' && h !== 12) h += 12;
        if (period === 'AM' && h === 12) h = 0;
        return h * 60 + m;
    }
    // Handle "16:00" format
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

function minutesToTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// ── Email Notification Removed ──

function updateBusinessHoursLabel() {
    const labelEl = document.getElementById('businessHoursLabel');
    if (!labelEl) return;

    const dayNamesShort = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const groups = [];
    let currentGroup = null;

    const getHoursString = (h) => {
        if (!h) return 'Cerrado';
        return `${formatTime12(h.open)}—${formatTime12(h.close)}`;
    };

    const formatTime12 = (timeStr) => {
        const [h, m] = timeStr.split(':').map(Number);
        const period = h >= 12 ? 'PM' : 'AM';
        let h12 = h % 12;
        if (h12 === 0) h12 = 12;
        const mStr = m === 0 ? '' : `:${String(m).padStart(2, '0')}`;
        return `${h12}${mStr}${period}`;
    };

    for (let i = 1; i <= 7; i++) {
        const d = i % 7; // Start at Mon (1) to Sat (6), then Sun (0)
        const h = defaultHours[d];
        const hrsStr = getHoursString(h);

        if (currentGroup && currentGroup.hours === hrsStr) {
            currentGroup.end = d;
        } else {
            if (currentGroup) {
                groups.push(currentGroup);
            }
            currentGroup = { start: d, end: d, hours: hrsStr };
        }
    }
    if (currentGroup) {
        groups.push(currentGroup);
    }

    const activeGroups = groups.filter(g => g.hours !== 'Cerrado');
    if (activeGroups.length === 0) {
        labelEl.textContent = 'Cerrado temporalmente';
        return;
    }

    const parts = activeGroups.map(g => {
        let daysStr = '';
        if (g.start === g.end) {
            daysStr = dayNamesShort[g.start];
        } else {
            const list = [];
            let curr = g.start;
            while (curr !== g.end) {
                list.push(curr);
                curr = (curr + 1) % 7;
            }
            list.push(g.end);

            if (list.length === 2) {
                daysStr = `${dayNamesShort[g.start]} y ${dayNamesShort[g.end]}`;
            } else {
                daysStr = `${dayNamesShort[g.start]}-${dayNamesShort[g.end]}`;
            }
        }
        return `${daysStr} ${g.hours}`;
    });

    labelEl.textContent = parts.join(' · ');
}
