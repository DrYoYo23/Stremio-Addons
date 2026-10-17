console.log("Iniciando servidor Open TV completo...");

const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const ID_PREFIX = "open_tv:";

const PAISES = {
    "DO": "República Dominicana",
    "US": "Estados Unidos",
    "ES": "España",
    "MX": "México",
    "AR": "Argentina",
    "CO": "Colombia",
    "CL": "Chile",
    "PE": "Perú",
    "PR": "Puerto Rico"
};

// Función para generar un logo limpio con el nombre del canal (nunca falla ni da error de Imgur)
function getLogoSeguro(nombre) {
    const texto = encodeURIComponent(nombre.replace(/\[.*?\]\s*/, "").substring(0, 18));
    return `https://placehold.co/400x400/1a1a2e/ffffff.png?text=${texto}`;
}

// Canales base inmediatos (cargan en 0 segundos mientras descarga el resto)
const CANALES_BASE = [
    {
        id: "rtve_24h",
        name: "[ES] RTVE 24 Horas",
        country: "ES",
        url: "https://rtvelivestream.akamaized.net/rtvesec/24h/24h_main.m3u8"
    },
    {
        id: "dw_espanol",
        name: "[ES] DW Español",
        country: "ES",
        url: "https://dwamdstream104.akamaized.net/hls/live/2015530/dwstream104/index.m3u8"
    }
];

const manifest = {
    id: "org.opentv.latam.stremio",
    version: "1.4.0",
    name: "Open TV (Hispano & US)",
    description: "Canales de TV abierta filtrados por país",
    resources: ["catalog", "meta", "stream"],
    types: ["tv"],
    idPrefixes: [ID_PREFIX],
    catalogs: [
        {
            type: "tv",
            id: "open_tv_filtered",
            name: "TV Filtrada por País",
            extra: [
                { name: "search", isRequired: false },
                {
                    name: "genre",
                    isRequired: false,
                    options: Object.values(PAISES)
                }
            ]
        }
    ]
};

const builder = new addonBuilder(manifest);

let catalogCache = [];
let streamsMap = new Map();

// 1. Cargar canales base al instante
function initBaseChannels() {
    const metas = [];
    streamsMap.clear();

    for (const c of CANALES_BASE) {
        const logoUrl = getLogoSeguro(c.name);
        streamsMap.set(c.id, [{ url: c.url, quality: "HD" }]);
        metas.push({
            id: `${ID_PREFIX}${c.id}`,
            type: "tv",
            name: c.name,
            poster: logoUrl,
            posterShape: "square",
            logo: logoUrl,
            genres: [PAISES[c.country]],
            description: `Señal en vivo de ${c.name}`
        });
    }
    catalogCache = metas;
}

// 2. Descargar todos los canales de IPTV-org en segundo plano sin bloquear Stremio
async function fetchFullCatalogInBackground() {
    try {
        console.log("[Addon] Descargando lista completa de canales desde IPTV-org en segundo plano...");
        const [channelsRes, streamsRes] = await Promise.all([
            fetch("https://iptv-org.github.io/api/channels.json"),
            fetch("https://iptv-org.github.io/api/streams.json")
        ]);

        const channelsData = await channelsRes.json();
        const streamsData = await streamsRes.json();

        const tempStreams = new Map();
        for (const st of streamsData) {
            if (!st.channel || !st.url || !st.url.startsWith("http")) continue;
            if (!tempStreams.has(st.channel)) {
                tempStreams.set(st.channel, []);
            }
            tempStreams.get(st.channel).push({
                url: st.url,
                quality: st.quality || "Directo"
            });
        }

        const newMetas = [...catalogCache];
        for (const [k, v] of tempStreams.entries()) {
            streamsMap.set(k, v);
        }

        for (const ch of channelsData) {
            if (!PAISES[ch.country]) continue;
            if (!tempStreams.has(ch.id)) continue;
            if (ch.is_nsfw) continue;

            const displayName = `[${ch.country}] ${ch.name}`;
            const logoUrl = (ch.logo && !ch.logo.includes("imgur.com")) ? ch.logo : getLogoSeguro(displayName);

            newMetas.push({
                id: `${ID_PREFIX}${ch.id}`,
                type: "tv",
                name: displayName,
                poster: logoUrl,
                posterShape: "square",
                logo: logoUrl,
                genres: [PAISES[ch.country]],
                description: `Canal de ${PAISES[ch.country]} (${ch.categories ? ch.categories.join(", ") : "TV"})`
            });
        }

        catalogCache = newMetas;
        console.log(`[Addon] ¡Catálogo completo listo! Total cargados: ${catalogCache.length} canales.`);
    } catch (err) {
        console.error("[Addon] Aviso: No se pudo descargar la lista externa, manteniendo canales base:", err.message);
    }
}

initBaseChannels();
fetchFullCatalogInBackground();

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    if (type !== "tv" || id !== "open_tv_filtered") return { metas: [] };

    let metas = catalogCache;

    if (extra && extra.genre) {
        metas = metas.filter(c => c.genres && c.genres.includes(extra.genre));
    }

    if (extra && extra.search) {
        const q = extra.search.toLowerCase();
        metas = metas.filter(c => c.name.toLowerCase().includes(q));
    }

    return { metas: metas.slice(0, 150) };
});

builder.defineMetaHandler(async ({ type, id }) => {
    if (type !== "tv" || !id.startsWith(ID_PREFIX)) return { meta: null };
    const found = catalogCache.find(c => c.id === id);
    return { meta: found || null };
});

builder.defineStreamHandler(async ({ type, id }) => {
    if (type !== "tv" || !id.startsWith(ID_PREFIX)) return { streams: [] };
    
    const channelId = id.replace(ID_PREFIX, "");
    const channelStreams = streamsMap.get(channelId) || [];

    return {
        streams: channelStreams.map((st, idx) => ({
            name: `OpenTV\nOpción ${idx + 1}`,
            title: `Señal en vivo (${st.quality})`,
            url: st.url
        }))
    };
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });