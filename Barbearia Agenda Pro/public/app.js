const state = {
  selectedSlot: null,
  services: [],
  professionals: []
};

let dashboardRefreshTimer = null;

const messageEl = document.querySelector('#message, #global-message, #login-message');
const bookingForm = document.getElementById('booking-form');
const serviceSelect = document.getElementById('service');
const professionalSelect = document.getElementById('professional');
const dateInput = document.getElementById('date');
const slotsContainer = document.getElementById('slots');

function getToken() {
  return localStorage.getItem('barbeariaAgendaToken') || '';
}

function applyAuthHeader(options = {}) {
  const token = getToken();
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('X-Admin-Token', token);
  }

  return {
    ...options,
    headers
  };
}

async function fetchJson(url, options = {}) {
  const preparedOptions = applyAuthHeader({
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const response = await fetch(url, preparedOptions);

  let data = {};
  try {
    data = await response.json();
  } catch (error) {
    data = {};
  }

  if (!response.ok) {
    const message = data?.error || 'Erro ao carregar dados.';

    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem('barbeariaAgendaToken');
      if (window.location.pathname.includes('/admin')) {
        window.location.href = '/login';
      }
    }

    throw new Error(message);
  }

  return data;
}

function setMessage(text, isError = false) {
  if (!messageEl) return;
  messageEl.textContent = text;
  messageEl.classList.toggle('error', isError);
}

function renderServiceOptions() {
  if (!serviceSelect) return;
  serviceSelect.innerHTML = '<option value="">Selecione um serviço</option>' +
    state.services.map((service) => `<option value="${service.id}">${service.name} - R$ ${Number(service.price).toFixed(2)}</option>`).join('');
}

function renderProfessionalOptions() {
  if (!professionalSelect) return;
  professionalSelect.innerHTML = '<option value="">Selecione um profissional</option>' +
    state.professionals.map((professional) => `<option value="${professional.id}">${professional.name} - ${professional.specialty}</option>`).join('');
}

async function loadCatalog() {
  try {
    const [services, professionals] = await Promise.all([
      fetchJson('/api/services'),
      fetchJson('/api/professionals')
    ]);

    state.services = services;
    state.professionals = professionals;

    renderServiceOptions();
    renderProfessionalOptions();

    if (dateInput) {
      const today = new Date();
      dateInput.value = today.toISOString().split('T')[0];
    }

    if (document.getElementById('dashboard-date')) {
      const dashboardDate = document.getElementById('dashboard-date');
      dashboardDate.value = new Date().toISOString().split('T')[0];
      loadDashboard();
    }
  } catch (error) {
    console.error(error);
    setMessage(error.message, true);
  }
}

async function refreshAvailability() {
  if (!serviceSelect || !professionalSelect || !dateInput || !slotsContainer) {
    return;
  }

  const serviceId = serviceSelect.value;
  const professionalId = professionalSelect.value;
  const selectedDate = dateInput.value;

  if (!serviceId || !professionalId || !selectedDate) {
    slotsContainer.innerHTML = '';
    state.selectedSlot = null;
    return;
  }

  try {
    const data = await fetchJson(`/api/availability?professionalId=${professionalId}&serviceId=${serviceId}&date=${selectedDate}`);
    const slots = data.slots || [];

    slotsContainer.innerHTML = slots.length
      ? slots.map((slot) => `<button type="button" class="slot ${state.selectedSlot === slot ? 'selected' : ''}" data-slot="${slot}">${slot}</button>`).join('')
      : '<p>Nenhum horário disponível para a data escolhida.</p>';

    slotsContainer.querySelectorAll('.slot').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedSlot = button.dataset.slot;
        slotsContainer.querySelectorAll('.slot').forEach((item) => item.classList.toggle('selected', item.dataset.slot === state.selectedSlot));
      });
    });
  } catch (error) {
    setMessage(error.message, true);
  }
}

if (bookingForm) {
  bookingForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!state.selectedSlot) {
      setMessage('Selecione um horário disponível antes de confirmar.', true);
      return;
    }

    const formData = new FormData(bookingForm);
    const payload = {
      customerName: formData.get('customerName'),
      phone: formData.get('phone'),
      serviceId: Number(formData.get('serviceId')),
      professionalId: Number(formData.get('professionalId')),
      date: formData.get('date'),
      time: state.selectedSlot
    };

    try {
      const result = await fetchJson('/api/appointments', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      setMessage(result.message || 'Agendamento realizado com sucesso!');
      bookingForm.reset();
      state.selectedSlot = null;
      refreshAvailability();
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  [serviceSelect, professionalSelect, dateInput].forEach((element) => {
    element?.addEventListener('change', refreshAvailability);
  });
}

async function loadDashboard() {
  const dateInputValue = document.getElementById('dashboard-date')?.value;
  const agendaEl = document.getElementById('agenda');
  const totalAppointmentsEl = document.getElementById('total-appointments');
  const totalRevenueEl = document.getElementById('total-revenue');

  if (!dateInputValue || !agendaEl) return;

  try {
    const data = await fetchJson(`/api/admin/dashboard?date=${dateInputValue}`);
    totalAppointmentsEl.textContent = data.totalAppointments;
    totalRevenueEl.textContent = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(data.revenue || 0);

    agendaEl.innerHTML = data.appointments.length
      ? data.appointments.map((item) => `
          <div class="agenda-item">
            <div>
              <strong>${item.customer_name}</strong>
              <span>${item.service_name} • ${item.professional_name}</span>
            </div>
            <div class="agenda-meta">
              <span>${item.appointment_time}</span>
              <span class="badge">${item.status}</span>
            </div>
            <div class="agenda-actions">
              <button type="button" class="mini-btn accept-btn" data-id="${item.id}" data-status="confirmado">Aceitar</button>
              <button type="button" class="mini-btn reject-btn" data-id="${item.id}" data-status="cancelado">Recusar</button>
            </div>
          </div>
        `).join('')
      : '<p>Nenhum agendamento para este dia.</p>';

    agendaEl.querySelectorAll('[data-status]').forEach((button) => {
      button.addEventListener('click', async () => {
        const appointmentId = button.dataset.id;
        const status = button.dataset.status;

        try {
          const result = await fetchJson(`/api/admin/appointments/${appointmentId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status })
          });

          setMessage(result.message || 'Status atualizado.');
          await loadDashboard();
          if (document.getElementById('dashboard-date')) {
            await refreshAvailability();
          }
        } catch (error) {
          setMessage(error.message, true);
        }
      });
    });
  } catch (error) {
    console.error(error);

    if (error.message?.includes('Acesso negado') || error.message?.includes('Faça login')) {
      if (dashboardRefreshTimer) {
        clearInterval(dashboardRefreshTimer);
        dashboardRefreshTimer = null;
      }
      return;
    }

    agendaEl.innerHTML = '<p>Não foi possível carregar a agenda.</p>';
  }
}

function startDashboardAutoRefresh() {
  if (dashboardRefreshTimer) {
    clearInterval(dashboardRefreshTimer);
  }

  if (!document.getElementById('dashboard-date')) {
    return;
  }

  dashboardRefreshTimer = setInterval(async () => {
    if (document.visibilityState === 'visible') {
      await loadDashboard();
      if (serviceSelect && professionalSelect && dateInput && document.getElementById('dashboard-date')) {
        const currentDate = document.getElementById('dashboard-date').value;
        if (currentDate) {
          await refreshAvailability();
        }
      }
    }
  }, 5000);
}

if (document.visibilityState !== undefined) {
  document.addEventListener('visibilitychange', async () => {
    if (!document.hidden) {
      await loadDashboard();
      if (serviceSelect && professionalSelect && dateInput && slotsContainer) {
        await refreshAvailability();
      }
    }
  });
}

if (document.getElementById('dashboard-date')) {
  document.getElementById('dashboard-date').addEventListener('change', () => {
    loadDashboard();
    startDashboardAutoRefresh();
  });
}

if (document.getElementById('service-form')) {
  document.getElementById('service-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());

    try {
      const result = await fetchJson('/api/admin/services', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setMessage(result.message || 'Serviço salvo com sucesso!');
      form.reset();
      loadCatalog();
    } catch (error) {
      setMessage(error.message, true);
    }
  });
}

if (document.getElementById('block-form')) {
  const blockForm = document.getElementById('block-form');
  const blockDate = document.getElementById('block-date');

  if (blockDate) {
    blockDate.value = new Date().toISOString().split('T')[0];
  }

  blockForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(blockForm).entries());

    try {
      const result = await fetchJson('/api/admin/block-slot', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setMessage(result.message || 'Horário bloqueado!');
      blockForm.reset();
      refreshAvailability();
    } catch (error) {
      setMessage(error.message, true);
    }
  });
}

document.getElementById('send-reminders')?.addEventListener('click', async () => {
  const date = document.getElementById('dashboard-date')?.value || new Date().toISOString().split('T')[0];

  try {
    const result = await fetchJson(`/api/reminders/send?date=${date}`);
    setMessage(`${result.sent} lembrete(s) enviado(s).`);
  } catch (error) {
    setMessage(error.message, true);
  }
});

document.getElementById('reset-day')?.addEventListener('click', async () => {
  const date = document.getElementById('dashboard-date')?.value || new Date().toISOString().split('T')[0];

  try {
    const result = await fetchJson('/api/admin/reset-day', {
      method: 'POST',
      body: JSON.stringify({ date })
    });

    setMessage(result.message || 'Agenda do dia reiniciada.');
    await loadDashboard();
    if (document.getElementById('dashboard-date')) {
      await refreshAvailability();
    }
  } catch (error) {
    setMessage(error.message, true);
  }
});

async function validateAdminSession() {
  const token = getToken();
  if (!window.location.pathname.includes('/admin')) {
    return false;
  }

  if (!token) {
    window.location.href = '/login';
    return false;
  }

  try {
    const response = await fetchJson('/api/admin/validate');
    return response.ok ?? true;
  } catch (error) {
    localStorage.removeItem('barbeariaAgendaToken');
    window.location.href = '/login';
    return false;
  }
}

if (document.getElementById('login-form')) {
  const passwordInput = document.getElementById('login-password');
  const togglePasswordButton = document.getElementById('toggle-password');

  togglePasswordButton?.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    togglePasswordButton.textContent = isPassword ? 'Ocultar' : 'Mostrar';
  });

  document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());

    try {
      const result = await fetchJson('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      localStorage.setItem('barbeariaAgendaToken', result.token);
      setMessage(result.message || 'Login realizado.');
      window.location.href = '/admin';
    } catch (error) {
      setMessage(error.message, true);
    }
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  if (window.location.pathname.includes('/admin')) {
    const isValid = await validateAdminSession();
    if (!isValid) return;
  }

  await loadCatalog();

  if (document.getElementById('dashboard-date')) {
    startDashboardAutoRefresh();
    await loadDashboard();
  }

  if (professionalSelect && serviceSelect && dateInput) {
    professionalSelect.addEventListener('change', refreshAvailability);
    serviceSelect.addEventListener('change', refreshAvailability);
    dateInput.addEventListener('change', refreshAvailability);
  }

  if (document.getElementById('block-professional')) {
    fetchJson('/api/professionals').then((professionals) => {
      const blockProfessional = document.getElementById('block-professional');
      blockProfessional.innerHTML = professionals.map((professional) => `<option value="${professional.id}">${professional.name}</option>`).join('');
    });
  }
});
