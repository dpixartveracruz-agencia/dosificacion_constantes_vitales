/**
 * ============================================================================
 * SERVICE WORKER (sw.js) - MODO NETWORK-FIRST (SIEMPRE ACTUALIZADO)
 * Prioriza la versión más nueva de Cloudflare y usa caché solo si estás Offline
 * Powered by DPixART Arte y Diseño
 * ============================================================================
 */

const CACHE_NAME = 'dpixart-vitalcontrol-v5';
const DB_NAME = 'DPixART_VitalControl_DB';
const DB_VERSION = 1;

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
];

// Al instalar, fuerza descarga fresca desde el servidor (cache: 'reload')
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.all(
        ASSETS_TO_CACHE.map(url =>
          fetch(new Request(url, { cache: 'reload' }))
            .then(res => cache.put(url, res))
            .catch(() => {})
        )
      );
    })
  );
});

// Al activar, borra todos los cachés viejos (v1, v2, v3, v4)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : null)))
    ).then(() => self.clients.claim())
  );
});

// ESTRATEGIA NETWORK-FIRST: Siempre intenta traer el diseño más nuevo de Internet;
// si no hay señal (Offline), entonces usa la copia guardada en el celular.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('script.google.com')) return;

  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        const clone = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});

function resolvePendingDoseFromIDB() {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => resolve(null);
      req.onsuccess = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('state')) {
          resolve(null);
          return;
        }
        const tx = db.transaction('state', 'readonly');
        const store = tx.objectStore('state');
        const getAllReq = store.getAll();

        getAllReq.onsuccess = () => {
          const rows = getAllReq.result || [];
          let medicamentos = [];
          let tomas = [];

          rows.forEach(r => {
            if (r.key === 'medicamentos' && Array.isArray(r.val)) medicamentos = r.val;
            if (r.key === 'tomas' && Array.isArray(r.val)) tomas = r.val;
          });

          const activeMeds = medicamentos.filter(m => String(m.ESTADO).toUpperCase() === 'ACTIVO');
          if (activeMeds.length === 0) {
            resolve(null);
            return;
          }

          const now = new Date();
          const yyyy = now.getFullYear();
          const mm = String(now.getMonth() + 1).padStart(2, '0');
          const dd = String(now.getDate()).padStart(2, '0');
          const todayISO = `${yyyy}-${mm}-${dd}`;
          const nowMinutes = now.getHours() * 60 + now.getMinutes();

          let bestCandidate = null;
          let minAbsDiff = 99999;

          activeMeds.forEach(med => {
            let times = [];
            try {
              times = typeof med.HORARIOS_JSON === 'string' ? JSON.parse(med.HORARIOS_JSON) : med.HORARIOS_JSON;
            } catch (err) {
              times = String(med.HORARIOS_JSON || '08:00').split(',').map(s => s.trim());
            }

            (times || []).forEach(hora => {
              const parts = String(hora).split(':').map(Number);
              if (parts.length === 2) {
                const doseMinutes = parts[0] * 60 + parts[1];
                const idToma = `${med.ID_MED}_${todayISO}_${hora}`;
                const alreadyTaken = tomas.some(
                  t => String(t.ID_TOMA) === idToma && String(t.ESTATUS).toUpperCase() === 'TOMADO'
                );

                if (!alreadyTaken) {
                  const diff = Math.abs(nowMinutes - doseMinutes);
                  if (diff < minAbsDiff) {
                    minAbsDiff = diff;
                    bestCandidate = {
                      title: `⏰ Hora de medicamento: ${med.NOMBRE_COMERCIAL}`,
                      body: `Dosis: ${med.DOSIS_ACTUAL} ${med.UNIDAD} (${med.SUSTANCIA_ACTIVA || 'Esquema activo'}) — Programado ${hora} hrs`,
                      data: {
                        id_toma: idToma,
                        id_med: med.ID_MED,
                        nombre: med.NOMBRE_COMERCIAL,
                        dosis_txt: `${med.DOSIS_ACTUAL} ${med.UNIDAD}`,
                        hora: hora
                      }
                    };
                  }
                }
              }
            });
          });

          resolve(bestCandidate);
        };
        getAllReq.onerror = () => resolve(null);
      };
    } catch (err) {
      resolve(null);
    }
  });
}

self.addEventListener('push', event => {
  event.waitUntil(
    (async () => {
      let payload = null;

      if (event.data) {
        try {
          payload = JSON.parse(event.data.text());
        } catch (e) {
          const rawText = event.data.text();
          if (rawText && rawText.trim().length > 0) {
            payload = {
              title: '⏰ Alerta de Medicación — VitalControl',
              body: rawText,
              data: {}
            };
          }
        }
      }

      if (!payload || !payload.title) {
        const idbDose = await resolvePendingDoseFromIDB();
        if (idbDose) {
          payload = idbDose;
        } else {
          payload = {
            title: '⏰ Alerta de Medicación — VitalControl',
            body: 'Hay una toma programada pendiente de confirmar para el paciente.',
            data: {}
          };
        }
      }

      const options = {
        body: payload.body,
        icon: 'https://cdn-icons-png.flaticon.com/512/2966/2966327.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/2966/2966327.png',
        vibrate: [500, 200, 500, 200, 1000],
        requireInteraction: true,
        tag: payload.data?.id_toma || 'med-alert',
        renotify: true,
        data: payload.data || {},
        actions: [
          { action: 'CONFIRM_DOSE', title: '✅ Confirmar Toma' },
          { action: 'SNOOZE_10', title: '⏳ Posponer 10 min' }
        ]
      };

      return self.registration.showNotification(payload.title, options);
    })()
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const action = event.action;
  const notifData = event.notification.data || {};

  if (action === 'SNOOZE_10') {
    event.waitUntil(
      new Promise(resolve => {
        setTimeout(() => {
          self.registration.showNotification('⏰ Recordatorio Pospuesto (10 min)', {
            body: event.notification.body,
            icon: 'https://cdn-icons-png.flaticon.com/512/2966/2966327.png',
            vibrate: [600, 200, 600, 200, 1200],
            requireInteraction: true,
            tag: notifData.id_toma || 'med-alert-snooze',
            renotify: true,
            data: notifData,
            actions: [
              { action: 'CONFIRM_DOSE', title: '✅ Confirmar Toma' },
              { action: 'SNOOZE_10', title: '⏳ Posponer 10 min' }
            ]
          }).then(resolve);
        }, 10 * 60 * 1000);
      })
    );
    return;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({
            type: 'NOTIFICATION_ACTION',
            action: action || 'OPEN',
            data: notifData
          });
          return;
        }
      }
      if (clients.openWindow) {
        const query = notifData.id_toma
          ? `?toma=${encodeURIComponent(notifData.id_toma)}&action=${encodeURIComponent(action || 'OPEN')}`
          : '';
        return clients.openWindow('./index.html' + query);
      }
    })
  );
});