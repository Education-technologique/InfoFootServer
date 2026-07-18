# InfoFoot Pro — Serveur

Backend Express + Socket.io pour le site InfoFoot Pro :
- `GET /matches` — scores en direct et à venir (proxy [football-data.org](https://www.football-data.org))
- `GET /news?q=...` — actualités football (proxy [newsapi.org](https://newsapi.org))
- Chat temps réel (public + messages privés) via Socket.io

## Déploiement sur Render

1. Pousse ce dossier `server/` dans un repo GitHub.
2. Sur [render.com](https://render.com) → **New +** → **Web Service** → connecte le repo.
3. Configuration :
   - **Root Directory** : `server` (si le repo contient aussi le front)
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Instance Type** : Free (suffisant pour démarrer)
4. Onglet **Environment** → ajoute les variables (voir `.env.example`) :
   - `FOOTBALL_DATA_KEY`
   - `NEWS_API_KEY`
   - `CLIENT_ORIGIN` (l'URL de ton site, ex: `https://infofoot.tondomaine.com`)
5. Déploie. Render te donne une URL du type `https://infofoot-pro-server.onrender.com`.
6. Dans `index.html`, mets à jour `SERVER_URL` avec cette URL.

## Test en local

```bash
cd server
npm install
cp .env.example .env   # puis remplis tes clés
node server.js
```

Le serveur écoute sur `http://localhost:3000`. Teste avec :
```bash
curl http://localhost:3000/health
curl http://localhost:3000/matches
curl "http://localhost:3000/news?q=football"
```

## Notes

- Un petit cache mémoire limite les appels aux APIs externes (30s pour les scores, 2min pour les actus) afin de rester dans les quotas gratuits.
- L'historique du chat public est gardé en mémoire (50 derniers messages), perdu au redémarrage du service. Pour de la persistance, brancher une base (Redis/Postgres) sur ce même service.
- Le plan gratuit Render met le service en veille après inactivité : le premier appel après une pause peut prendre ~30-50s (cold start).
