const express = require('express');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'barbearia.db');
const ADMIN_CREDENTIALS = { username: 'roger9090', password: 'karina90' };
const adminTokens = new Map();

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: false,
  lastModified: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Erro ao abrir banco de dados:', err.message);
    process.exit(1);
  }

  console.log('Banco de dados conectado com sucesso.');
  initializeDatabase();
});

function initializeDatabase() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        duration INTEGER NOT NULL,
        price REAL NOT NULL,
        category TEXT DEFAULT 'Geral'
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS professionals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        specialty TEXT NOT NULL,
        status TEXT DEFAULT 'ativo'
      )
    `);

    db.run(`DELETE FROM services WHERE id NOT IN (
      SELECT MIN(id) FROM services GROUP BY name, duration, price, category
    )`);

    db.run(`DELETE FROM professionals WHERE id NOT IN (
      SELECT MIN(id) FROM professionals GROUP BY name, specialty, status
    )`);

    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_services_unique ON services(name, duration, price, category)`);
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_professionals_unique ON professionals(name, specialty, status)`);

    db.run(`
      CREATE TABLE IF NOT EXISTS appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_id INTEGER NOT NULL,
        professional_id INTEGER NOT NULL,
        customer_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        appointment_date TEXT NOT NULL,
        appointment_time TEXT NOT NULL,
        status TEXT DEFAULT 'confirmado',
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(service_id) REFERENCES services(id),
        FOREIGN KEY(professional_id) REFERENCES professionals(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS blocked_slots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        professional_id INTEGER NOT NULL,
        appointment_date TEXT NOT NULL,
        appointment_time TEXT NOT NULL,
        reason TEXT,
        FOREIGN KEY(professional_id) REFERENCES professionals(id)
      )
    `);

    const seedServices = [
      ['Corte Clássico', 60, 45.0, 'Cabelo'],
      ['Barba e Bigode', 45, 35.0, 'Barba'],
      ['Corte + Barba', 90, 75.0, 'Combo'],
      ['Hidratação Capilar', 45, 40.0, 'Tratamento'],
      ['Sobrancelha', 30, 20.0, 'Detalhe']
    ];

    seedServices.forEach(([name, duration, price, category]) => {
      db.run(
        `INSERT OR IGNORE INTO services (name, duration, price, category) VALUES (?, ?, ?, ?)`,
        [name, duration, price, category]
      );
    });

    const seedProfessionals = [
      ['Carlos', 'Corte masculino', 'ativo'],
      ['Rafael', 'Barba e design', 'ativo'],
      ['Bruno', 'Estilo e acabamento', 'ativo']
    ];

    seedProfessionals.forEach(([name, specialty, status]) => {
      db.run(
        `INSERT OR IGNORE INTO professionals (name, specialty, status) VALUES (?, ?, ?)`,
        [name, specialty, status]
      );
    });

    seedSampleAppointments();
  });
}

function seedSampleAppointments() {
  db.get('SELECT COUNT(*) AS total FROM appointments', (countErr, result) => {
    if (countErr) {
      console.error('Erro ao contar agendamentos:', countErr.message);
      return;
    }

    if (Number(result.total) > 0) {
      return;
    }

    const today = new Date();
    const isoDate = (offset) => {
      const date = new Date(today);
      date.setDate(today.getDate() + offset);
      return date.toISOString().split('T')[0];
    };

    const samples = [
      { service_id: 1, professional_id: 1, customer_name: 'João', phone: '(11) 98765-4321', date: isoDate(0), time: '09:00' },
      { service_id: 2, professional_id: 2, customer_name: 'Mateus', phone: '(11) 91234-5678', date: isoDate(1), time: '14:00' },
      { service_id: 3, professional_id: 3, customer_name: 'Lucas', phone: '(11) 99876-5432', date: isoDate(2), time: '16:30' }
    ];

    samples.forEach((item) => {
      db.run(
        `INSERT INTO appointments (service_id, professional_id, customer_name, phone, appointment_date, appointment_time, status)
         VALUES (?, ?, ?, ?, ?, ?, 'confirmado')`,
        [item.service_id, item.professional_id, item.customer_name, item.phone, item.date, item.time]
      );
    });
  });
}

function getAdminTokenFromRequest(req) {
  const headerToken = req.headers.authorization;
  if (headerToken && headerToken.startsWith('Bearer ')) {
    return headerToken.slice(7);
  }

  return req.headers['x-admin-token'] || '';
}

function requireAdminAuth(req, res, next) {
  const token = getAdminTokenFromRequest(req);

  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: 'Acesso negado. Faça login como administrador.' });
  }

  req.adminUser = adminTokens.get(token);
  next();
}

function minutesFromTime(timeString) {
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
}

function formatTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function getAvailableSlotsForDay(professionalId, date, serviceDuration) {
  return new Promise((resolve, reject) => {
    const workingStart = 9 * 60;
    const workingEnd = 19 * 60;
    const slotStep = 30;
    const slots = [];

    db.all(
      `SELECT a.appointment_time, s.duration
       FROM appointments a
       INNER JOIN services s ON s.id = a.service_id
       WHERE a.professional_id = ? AND a.appointment_date = ? AND a.status != 'cancelado'`,
      [professionalId, date],
      (err, appointments) => {
        if (err) {
          reject(err);
          return;
        }

        db.all(
          `SELECT appointment_time, reason FROM blocked_slots WHERE professional_id = ? AND appointment_date = ?`,
          [professionalId, date],
          (blockError, blockedSlots) => {
            if (blockError) {
              reject(blockError);
              return;
            }

            for (let current = workingStart; current + serviceDuration <= workingEnd; current += slotStep) {
              const currentTime = formatTime(current);
              const currentEnd = current + serviceDuration;
              let isOccupied = false;

              appointments.forEach((appointment) => {
                const start = minutesFromTime(appointment.appointment_time);
                const end = start + appointment.duration;
                if (overlaps(current, currentEnd, start, end)) {
                  isOccupied = true;
                }
              });

              blockedSlots.forEach((slot) => {
                const blockedStart = minutesFromTime(slot.appointment_time);
                const blockedEnd = blockedStart + 30;
                if (overlaps(current, currentEnd, blockedStart, blockedEnd)) {
                  isOccupied = true;
                }
              });

              if (!isOccupied) {
                slots.push(currentTime);
              }
            }

            resolve(slots);
          }
        );
      }
    );
  });
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'API da barbearia funcionando.' });
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Informe usuário e senha.' });
  }

  if (username !== ADMIN_CREDENTIALS.username || password !== ADMIN_CREDENTIALS.password) {
    return res.status(401).json({ error: 'Credenciais inválidas.' });
  }

  const token = crypto.randomBytes(24).toString('hex');
  adminTokens.set(token, { username, createdAt: Date.now() });

  return res.json({
    token,
    user: { username },
    message: 'Login realizado com sucesso.'
  });
});

app.get('/api/admin/validate', requireAdminAuth, (req, res) => {
  res.json({ ok: true, user: req.adminUser });
});

app.post('/api/admin/reset-day', requireAdminAuth, (req, res) => {
  const { date } = req.body || {};
  const targetDate = date || new Date().toISOString().split('T')[0];

  db.run('DELETE FROM appointments WHERE appointment_date = ?', [targetDate], function (appointmentErr) {
    if (appointmentErr) {
      return res.status(500).json({ error: appointmentErr.message });
    }

    db.run('DELETE FROM blocked_slots WHERE appointment_date = ?', [targetDate], function (blockedErr) {
      if (blockedErr) {
        return res.status(500).json({ error: blockedErr.message });
      }

      res.json({
        date: targetDate,
        message: 'Agenda do dia reiniciada com sucesso.',
        deletedAppointments: this.changes
      });
    });
  });
});

app.get('/api/services', (req, res) => {
  db.all('SELECT DISTINCT id, name, duration, price, category FROM services ORDER BY name', (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.get('/api/professionals', (req, res) => {
  db.all('SELECT DISTINCT id, name, specialty, status FROM professionals WHERE status = "ativo" ORDER BY name', (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.get('/api/availability', async (req, res) => {
  const { professionalId, serviceId, date } = req.query;

  if (!professionalId || !serviceId || !date) {
    return res.status(400).json({ error: 'Campos obrigatórios: professionalId, serviceId e date.' });
  }

  db.get('SELECT duration FROM services WHERE id = ?', [serviceId], async (err, service) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!service) {
      return res.status(404).json({ error: 'Serviço não encontrado.' });
    }

    try {
      const slots = await getAvailableSlotsForDay(Number(professionalId), date, Number(service.duration));
      res.json({ date, slots });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
});

app.post('/api/appointments', (req, res) => {
  const { customerName, phone, serviceId, professionalId, date, time } = req.body;

  if (!customerName || !phone || !serviceId || !professionalId || !date || !time) {
    return res.status(400).json({ error: 'Preencha todos os campos do agendamento.' });
  }

  const normalizedName = String(customerName).trim();
  const normalizedPhone = String(phone).trim();
  const professionalIdNumber = Number(professionalId);

  db.get(
    `SELECT id FROM appointments
     WHERE appointment_date = ?
       AND appointment_time = ?
       AND professional_id = ?
       AND status != 'cancelado'
     LIMIT 1`,
    [date, time, professionalIdNumber],
    (sameSlotErr, sameSlotRow) => {
      if (sameSlotErr) {
        return res.status(500).json({ error: sameSlotErr.message });
      }

      if (sameSlotRow) {
        return res.status(409).json({
          error: 'Esse horário já foi agendado para esse profissional na mesma data.'
        });
      }

      db.get(
        `SELECT id FROM appointments
         WHERE LOWER(TRIM(customer_name)) = LOWER(?)
           AND TRIM(phone) = ?
           AND appointment_date = ?
           AND appointment_time = ?
           AND status != 'cancelado'
         LIMIT 1`,
        [normalizedName, normalizedPhone, date, time],
        (sameCustomerErr, sameCustomerRow) => {
          if (sameCustomerErr) {
            return res.status(500).json({ error: sameCustomerErr.message });
          }

          if (sameCustomerRow) {
            return res.status(409).json({
              error: 'Essa pessoa já possui esse mesmo horário agendado para o mesmo dia.'
            });
          }

          db.get('SELECT duration FROM services WHERE id = ?', [serviceId], (serviceErr, service) => {
            if (serviceErr) {
              return res.status(500).json({ error: serviceErr.message });
            }

            if (!service) {
              return res.status(404).json({ error: 'Serviço não encontrado.' });
            }

            getAvailableSlotsForDay(Number(professionalId), date, Number(service.duration))
              .then((slots) => {
                if (!slots.includes(time)) {
                  return res.status(409).json({ error: 'Esse horário não está disponível para a data selecionada.' });
                }

                db.run(
                  `INSERT INTO appointments (service_id, professional_id, customer_name, phone, appointment_date, appointment_time, status)
                   VALUES (?, ?, ?, ?, ?, ?, 'confirmado')`,
                  [serviceId, professionalId, normalizedName, normalizedPhone, date, time],
                  function (insertErr) {
                    if (insertErr) {
                      return res.status(500).json({ error: insertErr.message });
                    }

                    const appointmentId = this.lastID;
                    res.status(201).json({
                      id: appointmentId,
                      message: 'Agendamento confirmado com sucesso.',
                      data: {
                        customerName: normalizedName,
                        phone: normalizedPhone,
                        serviceId,
                        professionalId,
                        date,
                        time
                      }
                    });
                  }
                );
              })
              .catch((error) => {
                res.status(500).json({ error: error.message });
              });
          });
        }
      );
    }
  );
});

app.get('/api/admin/dashboard', requireAdminAuth, (req, res) => {
  const { date } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];

  db.all(
    `SELECT a.id, a.customer_name, a.appointment_time, a.status, s.name AS service_name, s.price, p.name AS professional_name
     FROM appointments a
     INNER JOIN services s ON s.id = a.service_id
     INNER JOIN professionals p ON p.id = a.professional_id
     WHERE a.appointment_date = ?
     ORDER BY a.appointment_time ASC`,
    [targetDate],
    (err, appointments) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      db.get(
        `SELECT COUNT(*) AS total, COALESCE(SUM(s.price), 0) AS revenue
         FROM appointments a
         INNER JOIN services s ON s.id = a.service_id
         WHERE a.appointment_date = ? AND a.status != 'cancelado'`,
        [targetDate],
        (summaryErr, summary) => {
          if (summaryErr) {
            return res.status(500).json({ error: summaryErr.message });
          }

          res.json({
            date: targetDate,
            totalAppointments: Number(summary.total || 0),
            revenue: Number(summary.revenue || 0),
            appointments
          });
        }
      );
    }
  );
});

app.patch('/api/admin/appointments/:id/status', requireAdminAuth, (req, res) => {
  const appointmentId = Number(req.params.id);
  const { status } = req.body || {};

  if (!appointmentId || !status) {
    return res.status(400).json({ error: 'ID do agendamento e status são obrigatórios.' });
  }

  const validStatuses = ['confirmado', 'cancelado', 'pendente'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Status inválido.' });
  }

  db.run(
    'UPDATE appointments SET status = ? WHERE id = ?',
    [status, appointmentId],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      res.json({
        id: appointmentId,
        status,
        message: status === 'confirmado' ? 'Cliente aceito com sucesso.' : 'Cliente recusado com sucesso.'
      });
    }
  );
});

app.post('/api/admin/services', requireAdminAuth, (req, res) => {
  const { name, duration, price, category } = req.body;

  if (!name || !duration || !price) {
    return res.status(400).json({ error: 'Nome, duração e preço são obrigatórios.' });
  }

  db.run(
    `INSERT INTO services (name, duration, price, category) VALUES (?, ?, ?, ?)`,
    [name, Number(duration), Number(price), category || 'Geral'],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      res.status(201).json({ id: this.lastID, message: 'Serviço cadastrado com sucesso.' });
    }
  );
});

app.post('/api/admin/block-slot', requireAdminAuth, (req, res) => {
  const { professionalId, date, time, reason } = req.body;

  if (!professionalId || !date || !time) {
    return res.status(400).json({ error: 'ProfessionalId, data e horário são obrigatórios.' });
  }

  db.run(
    `INSERT INTO blocked_slots (professional_id, appointment_date, appointment_time, reason) VALUES (?, ?, ?, ?)`,
    [professionalId, date, time, reason || 'Bloqueado pela administração'],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      res.status(201).json({ message: 'Horário bloqueado com sucesso.' });
    }
  );
});

app.post('/api/reminders/send', requireAdminAuth, (req, res) => {
  const { date } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];

  db.all(
    `SELECT a.id, a.customer_name, a.phone, a.appointment_date, a.appointment_time, s.name AS service_name
     FROM appointments a
     INNER JOIN services s ON s.id = a.service_id
     WHERE a.appointment_date = ? AND a.status = 'confirmado'`,
    [targetDate],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      const reminders = rows.map((appointment) => ({
        to: appointment.phone,
        message: `Olá ${appointment.customer_name}! Confirmação de agendamento para ${appointment.service_name} às ${appointment.appointment_time}.`
      }));

      console.log('Lembretes enviados:', reminders);

      res.json({
        sent: reminders.length,
        reminders
      });
    }
  );
});

app.get('/agendar', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'agendar.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
