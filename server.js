/**
 * InfoFoot Pro - Serveur
 * ------------------------------------------------------------------
 * - GET  /matches         -> proxy API-Football (api-sports.io) : tous les matchs
 *                             du jour + matchs en direct, toutes ligues du monde
 * - GET  /news?q=xxx       -> proxy newsapi.org (actualités football)
 * - Socket.io              -> chat public + messages privés (DM)
 *
 * Variables d'environnement à définir sur Render :
 *   API_FOOTBALL_KEY   = clé API api-sports.io (plan gratuit : 100 requêtes/jour)
 *   NEWS_API_KEY       = clé API newsapi.org
 *   CLIENT_ORIGIN      = URL(s) autorisée(s) en CORS, ex: https://tonsite.com
 *                        (plusieurs origines séparées par une virgule, "*" par défaut)
 *   PORT                = port d'écoute (fourni automatiquement par Render)
 */

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// ── CORS ──────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CLIENT_ORIGIN || '*')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

const corsOptions = {
    origin: allowedOrigins.includes('*') ? true : allowedOrigins,
    methods: ['GET', 'POST'],
};

app.use(cors(corsOptions));
app.use(express.json());

const io = new Server(server, { cors: corsOptions });

// ── Config ───────────────────────────────────────────────────────
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || '';
const NEWS_API_KEY = process.env.NEWS_API_KEY || '';
const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';
const NEWS_API_BASE = 'https://newsapi.org/v2';

// Petit cache mémoire pour éviter de dépasser les quotas gratuits des APIs
const cache = new Map();
function getCached(key, ttlMs) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.time < ttlMs) return hit.data;
    return null;
}
function setCached(key, data) {
    cache.set(key, { data, time: Date.now() });
}

// ── Helpers ──────────────────────────────────────────────────────
async function fetchJson(url, headers) {
    const res = await fetch(url, { headers });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Requête échouée (${res.status}) sur ${url} : ${body.slice(0, 200)}`);
    }
    return res.json();
}

// Convertit le statut API-Football (1H, HT, FT, NS...) vers le format attendu par le front
function mapStatus(shortStatus) {
    const live = ['1H', '2H', 'ET', 'BT', 'LIVE', 'P'];
    const paused = ['HT'];
    const finished = ['FT', 'AET', 'PEN', 'AWD', 'WO'];
    if (live.includes(shortStatus)) return 'IN_PLAY';
    if (paused.includes(shortStatus)) return 'PAUSED';
    if (finished.includes(shortStatus)) return 'FINISHED';
    return 'SCHEDULED'; // NS, TBD, PST, CANC, SUSP, INT...
}

// Transforme une "fixture" API-Football en objet attendu par le front (style football-data.org)
function mapFixture(f) {
    return {
        id: f.fixture.id,
        utcDate: f.fixture.date,
        status: mapStatus(f.fixture.status?.short),
        competition: { code: f.league?.id, name: f.league?.name },
        homeTeam: { shortName: f.teams?.home?.name, name: f.teams?.home?.name, crest: f.teams?.home?.logo },
        awayTeam: { shortName: f.teams?.away?.name, name: f.teams?.away?.name, crest: f.teams?.away?.logo },
        score: {
            fullTime: { home: f.goals?.home, away: f.goals?.away },
            halfTime: { home: f.score?.halftime?.home, away: f.score?.halftime?.away },
        },
    };
}

// ── Routes ───────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get('/matches', async (req, res) => {
    try {
        if (!API_FOOTBALL_KEY) return res.json({ matches: [] });

        const cacheKey = 'matches';
        const cached = getCached(cacheKey, 30_000); // 30s
        if (cached) return res.json(cached);

        const today = new Date().toISOString().slice(0, 10);
        const headers = { 'x-apisports-key': API_FOOTBALL_KEY };

        // Tous les matchs du jour, toutes compétitions/pays confondus
        const dayData = await fetchJson(`${API_FOOTBALL_BASE}/fixtures?date=${today}`, headers);
        let fixtures = dayData.response || [];

        // Complète avec les matchs en direct dans le monde (au cas où fuseaux horaires décalent la date)
        try {
            const liveData = await fetchJson(`${API_FOOTBALL_BASE}/fixtures?live=all`, headers);
            const liveFixtures = liveData.response || [];
            const knownIds = new Set(fixtures.map(f => f.fixture.id));
            liveFixtures.forEach(f => { if (!knownIds.has(f.fixture.id)) fixtures.push(f); });
        } catch (e) {
            console.error('[matches] live=all ->', e.message);
        }

        let matches = fixtures.map(mapFixture);

        // Live/en cours en premier, puis à venir triées par date
        matches.sort((a, b) => {
            const rank = s => (s === 'IN_PLAY' || s === 'PAUSED') ? 0 : (s === 'SCHEDULED') ? 1 : 2;
            const diff = rank(a.status) - rank(b.status);
            if (diff !== 0) return diff;
            return new Date(a.utcDate) - new Date(b.utcDate);
        });

        const payload = { matches };
        setCached(cacheKey, payload);
        res.json(payload);
    } catch (err) {
        console.error('[GET /matches]', err.message);
        res.status(500).json({ matches: [], error: 'Impossible de récupérer les matchs.' });
    }
});

app.get('/news', async (req, res) => {
    try {
        if (!NEWS_API_KEY) return res.json({ articles: [] });

        const q = (req.query.q || 'football').toString().slice(0, 100);
        const cacheKey = `news:${q}`;
        const cached = getCached(cacheKey, 120_000); // 2min
        if (cached) return res.json(cached);

        const url = `${NEWS_API_BASE}/everything?q=${encodeURIComponent(q)}&language=fr&sortBy=publishedAt&pageSize=30`;
        const data = await fetchJson(url, { 'X-Api-Key': NEWS_API_KEY });

        const payload = { articles: data.articles || [] };
        setCached(cacheKey, payload);
        res.json(payload);
    } catch (err) {
        console.error('[GET /news]', err.message);
        res.status(500).json({ articles: [], error: 'Impossible de récupérer les actualités.' });
    }
});

// ── Chat temps réel ──────────────────────────────────────────────
// Historique en mémoire (public seulement, borné, perdu au redémarrage)
const PUBLIC_HISTORY_LIMIT = 50;
let publicHistory = [];

io.on('connection', socket => {
    socket.emit('history', publicHistory);

    socket.on('identify', username => {
        if (typeof username !== 'string' || !username.trim()) return;
        socket.data.username = username.trim().slice(0, 30);
        socket.join(socket.data.username);
    });

    socket.on('message', data => {
        if (!data || typeof data.text !== 'string' || !data.text.trim()) return;
        const safe = {
            username: String(data.username || 'Anonyme').slice(0, 30),
            text: String(data.text).slice(0, 500),
            team: String(data.team || '').slice(0, 30),
            time: new Date().toISOString(),
        };
        publicHistory.push(safe);
        if (publicHistory.length > PUBLIC_HISTORY_LIMIT) publicHistory.shift();
        io.emit('message', safe);
    });

    socket.on('private_message', data => {
        if (!data || typeof data.text !== 'string' || !data.text.trim() || !data.to) return;
        const safe = {
            from: String(data.from || 'Anonyme').slice(0, 30),
            to: String(data.to).slice(0, 30),
            text: String(data.text).slice(0, 500),
            time: new Date().toISOString(),
        };
        // Envoyé uniquement au destinataire (room = son pseudo) + à l'expéditeur lui-même
        io.to(safe.to).emit('private_message', safe);
        socket.emit('private_message', safe);
    });

    socket.on('disconnect', () => {});
});

// ── Démarrage ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`InfoFoot Pro server listening on port ${PORT}`);
    if (!API_FOOTBALL_KEY) console.warn('⚠️  API_FOOTBALL_KEY manquante — /matches renverra une liste vide.');
    if (!NEWS_API_KEY) console.warn('⚠️  NEWS_API_KEY manquante — /news renverra une liste vide.');
});
