// sw.js — Service worker de la app instalable (PWA)
//
// Estrategia:
// - Archivos propios (HTML, CSS, JS, íconos): primero red y, sin conexión, la copia guardada.
//   Así siempre se ve la versión más reciente y la app abre aunque no haya internet (modo simulación).
// - Librerías de CDN y modelo de IA (URLs con versión fija): primero la copia guardada.
// - API del vehículo, WebSocket y API de Claude: nunca se guardan.

const VERSION = 'v1';
const CACHE_APP = `vehiculo-iot-app-${VERSION}`;
const CACHE_CDN = `vehiculo-iot-cdn-${VERSION}`;

const ESENCIALES = [
    './',
    './index.html',
    './manifest.webmanifest',
    './assets/icons/icon-192.png',
    './assets/icons/icon-512.png',
    './assets/icons/apple-touch-icon.png'
];

const HOSTS_CDN = new Set([
    'cdn.jsdelivr.net',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'storage.googleapis.com' // modelo de gestos de MediaPipe
]);

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_APP)
            .then((cache) => cache.addAll(ESENCIALES.map((u) => new Request(u, { cache: 'reload' }))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((claves) => Promise.all(
                claves
                    .filter((c) => c.startsWith('vehiculo-iot-') && c !== CACHE_APP && c !== CACHE_CDN)
                    .map((c) => caches.delete(c))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

    if (url.origin === self.location.origin) {
        event.respondWith(primeroRed(req));
    } else if (HOSTS_CDN.has(url.hostname)) {
        event.respondWith(primeroCache(req));
    }
    // Todo lo demás (API del vehículo, Claude) va directo a la red
});

async function primeroRed(req) {
    const cache = await caches.open(CACHE_APP);
    try {
        const resp = await fetch(req);
        if (resp.ok) cache.put(req, resp.clone());
        return resp;
    } catch {
        const guardada = await cache.match(req);
        if (guardada) return guardada;
        if (req.mode === 'navigate') {
            const inicio = await cache.match('./index.html') || await cache.match('./');
            if (inicio) return inicio;
        }
        return new Response('Sin conexión', { status: 503, statusText: 'Sin conexión' });
    }
}

async function primeroCache(req) {
    const cache = await caches.open(CACHE_CDN);
    const guardada = await cache.match(req);
    if (guardada) return guardada;
    const resp = await fetch(req);
    if (resp.ok || resp.type === 'opaque') cache.put(req, resp.clone());
    return resp;
}
