// Cliente da API do jogo (/api/drag). O token do piloto fica só neste navegador (localStorage).
const TOKEN_KEY = 'arrancada.piloto';

function readToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

export const api = {
    token: readToken(),

    setToken(token) {
        this.token = token;
        try {
            if (token) localStorage.setItem(TOKEN_KEY, token);
            else localStorage.removeItem(TOKEN_KEY);
        } catch { /* modo privado: vale só nesta aba */ }
    },

    async request(method, url, body) {
        const headers = { 'Accept': 'application/json' };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (this.token) headers['X-Drag-Token'] = this.token;
        let res;
        try {
            res = await fetch('/api/drag' + url, {
                method, headers, body: body === undefined ? undefined : JSON.stringify(body),
                credentials: 'same-origin', cache: 'no-store'
            });
        } catch {
            throw new ApiError(0, 'Sem conexão com o servidor.');
        }
        let data = null;
        try { data = await res.json(); } catch { }
        if (!res.ok) {
            const msg = data?.error ?? (res.status === 429 ? 'Muitas tentativas. Aguarde um pouco.' : `Erro ${res.status}`);
            throw new ApiError(res.status, msg);
        }
        return data;
    },

    catalog() { return this.request('GET', '/catalog'); },
    me() { return this.request('GET', '/players/me'); },
    async createPlayer(name) {
        const r = await this.request('POST', '/players', { name });
        this.setToken(r.token);
        return r.player;
    },
    leaderboard(top = 10) { return this.request('GET', '/leaderboard?top=' + top); },
    startRace(opponentId) { return this.request('POST', '/races', { opponentId }); },
    finishRace(raceId, events) { return this.request('POST', `/races/${encodeURIComponent(raceId)}/finish`, { events }); }
};
