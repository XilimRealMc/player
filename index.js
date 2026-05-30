const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const axios = require('axios');
const express = require('express');

// ================================================================
// DUMMY WEB SERVER UNTUK RAILWAY
// ================================================================
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Live Status Bot Active!'));
app.listen(port, () => console.log(`[SERVER] Running on port ${port}`));

// ================================================================
// SETUP BOT DISCORD
// ================================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ================================================================
// CONFIG
// ================================================================
const CFX_JOIN_URL     = 'https://cfx.re/join/e6e6lmp';
const FIVEM_TIMEOUT    = 15000;
const KURS_TIMEOUT     = 8000;
const REFRESH_INTERVAL = 60000;
const MAX_RETRIES      = 3;
const RETRY_DELAY      = 3000;

const liveMessages     = new Map();
const refreshIntervals = new Map();

const BROWSER_HEADERS = {
    'User-Agent':                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language':           'id-ID,id;q=0.9,en-US;q=0.8',
    'Accept-Encoding':           'gzip, deflate, br',
    'Connection':                'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control':             'no-cache'
};

// ================================================================
// READY
// ================================================================
client.once('ready', () => {
    console.log(`[BOT] Login sebagai ${client.user.tag}`);
    updateKurs();
    setInterval(updateKurs, 60000);
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ================================================================
// UPDATE KURS USD
// ================================================================
async function updateKurs() {
    try {
        const res  = await axios.get('https://api.exchangerate-api.com/v4/latest/USD', { timeout: KURS_TIMEOUT });
        const rate = res.data?.rates?.IDR;
        if (!rate) throw new Error('Field IDR tidak ditemukan');
        const kursIdr = `Rp ${Math.round(rate).toLocaleString('id-ID')}`;
        client.user.setActivity(`${kursIdr} / USD`, { type: ActivityType.Watching });
        console.log(`[KURS] Updated: ${kursIdr} / USD`);
    } catch (error) {
        console.error('[KURS] Gagal:', error.message);
    }
}

// ================================================================
// SCRAPE PLAYER COUNT DARI cfx.re/join — tanpa cheerio
// Pakai regex langsung ke HTML mentah
// ================================================================
async function updateStatus() {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[CFX] Attempt ${attempt}/${MAX_RETRIES}...`);

            const res = await axios.get(CFX_JOIN_URL, {
                timeout: FIVEM_TIMEOUT,
                headers: BROWSER_HEADERS
            });

            const html = res.data;

            // Cari <span class="players"> ... angka ... </span>
            // Dari inspeksi HTML: <span class="players"><span ...>people_outline</span>\n2\n</span>
            const match = html.match(/class="players"[^>]*>[\s\S]*?(\d+)[\s\S]*?<\/span>/);
            if (!match) throw new Error('Tidak bisa parse jumlah player dari HTML');

            const count = parseInt(match[1], 10);
            console.log(`[CFX] OK: ${count} player online`);
            return { clients: count };

        } catch (error) {
            console.warn(`[CFX] Attempt ${attempt} gagal: ${error.message}`);
            if (attempt < MAX_RETRIES) {
                console.log(`[CFX] Retry dalam ${RETRY_DELAY / 1000} detik...`);
                await sleep(RETRY_DELAY);
            }
        }
    }
    console.error('[CFX] Semua attempt gagal');
    return null;
}

// ================================================================
// BUAT EMBED
// ================================================================
function createStatusEmbed(data, isLoading = false) {
    const waktu = new Date().toLocaleTimeString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour:     '2-digit',
        minute:   '2-digit'
    });

    if (isLoading) {
        return new EmbedBuilder()
            .setTitle('⏳ Sunda Pride Roleplay — Fetching...')
            .setColor(0xFFFF00)
            .setDescription('Sedang mengambil data server...')
            .setFooter({ text: 'Harap tunggu sebentar' })
            .setTimestamp();
    }

    if (!data) {
        return new EmbedBuilder()
            .setTitle('🔴 Sunda Pride Roleplay — OFFLINE')
            .setColor(0xFF0000)
            .setDescription('> Server tidak dapat diakses saat ini.\n> Kemungkinan sedang maintenance atau restart.')
            .setFooter({ text: `Last check: ${waktu} WIB` })
            .setTimestamp();
    }

    const count = data.clients;
    const color = count >= 50 ? 0xFF4500
                : count >= 20 ? 0xFFA500
                : count >= 1  ? 0x00FF00
                :               0x888888;

    const status = count === 0 ? '😴 Server sepi, ga ada yang online'
                 : count === 1 ? '👤 Ada **1 warga** yang lagi online'
                 :               `👥 Ada **${count} warga** yang lagi online`;

    return new EmbedBuilder()
        .setTitle('🟢 Sunda Pride Roleplay — LIVE')
        .setColor(color)
        .setDescription(status)
        .setFooter({ text: `Auto-refresh tiap 60 detik • Update: ${waktu} WIB` })
        .setTimestamp();
}

// ================================================================
// MESSAGE HANDLER
// ================================================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const channelId = message.channel.id;
    const content   = message.content.trim().toLowerCase();

    // ── !live ──────────────────────────────────────────────────────
    if (content === '!live') {
        message.delete().catch(err => console.warn('[CMD] Gagal hapus pesan:', err.message));

        if (refreshIntervals.has(channelId)) {
            clearInterval(refreshIntervals.get(channelId));
            refreshIntervals.delete(channelId);
        }

        let sentMessage;
        const loadingEmbed = createStatusEmbed(null, true);

        if (liveMessages.has(channelId)) {
            sentMessage = liveMessages.get(channelId);
            await sentMessage.edit({ embeds: [loadingEmbed] }).catch(async () => {
                sentMessage = await message.channel.send({ embeds: [loadingEmbed] });
            });
        } else {
            sentMessage = await message.channel.send({ embeds: [loadingEmbed] });
        }
        liveMessages.set(channelId, sentMessage);

        const data  = await updateStatus();
        const embed = createStatusEmbed(data);
        await sentMessage.edit({ embeds: [embed] })
            .catch(err => console.error('[LIVE] Gagal edit embed pertama:', err.message));

        const interval = setInterval(async () => {
            const targetMsg = liveMessages.get(channelId);
            if (!targetMsg) {
                clearInterval(refreshIntervals.get(channelId));
                refreshIntervals.delete(channelId);
                return;
            }
            const newData  = await updateStatus();
            const newEmbed = createStatusEmbed(newData);
            await targetMsg.edit({ embeds: [newEmbed] }).catch(err => {
                console.error('[LIVE] Gagal edit refresh:', err.message);
                if (err.code === 10008) {
                    liveMessages.delete(channelId);
                    clearInterval(refreshIntervals.get(channelId));
                    refreshIntervals.delete(channelId);
                }
            });
        }, REFRESH_INTERVAL);

        refreshIntervals.set(channelId, interval);
        console.log(`[LIVE] Dimulai di channel ${channelId}`);
    }

    // ── !stoplive ──────────────────────────────────────────────────
    if (content === '!stoplive') {
        message.delete().catch(err => console.warn('[CMD] Gagal hapus pesan:', err.message));

        if (!refreshIntervals.has(channelId) && !liveMessages.has(channelId)) {
            const reply = await message.channel.send('⚠️ Tidak ada live status yang aktif di channel ini.');
            setTimeout(() => reply.delete().catch(() => {}), 5000);
            return;
        }

        if (refreshIntervals.has(channelId)) {
            clearInterval(refreshIntervals.get(channelId));
            refreshIntervals.delete(channelId);
        }

        if (liveMessages.has(channelId)) {
            const liveMsg = liveMessages.get(channelId);
            const waktu   = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });
            await liveMsg.edit({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('⏹ Sunda Pride Roleplay — Dihentikan')
                        .setColor(0x808080)
                        .setDescription('Live status telah dihentikan secara manual.')
                        .setFooter({ text: `Dihentikan pada: ${waktu} WIB` })
                        .setTimestamp()
                ]
            }).catch(() => {});
            liveMessages.delete(channelId);
        }

        console.log(`[LIVE] Dihentikan di channel ${channelId}`);
    }
});

// ================================================================
// GLOBAL ERROR HANDLER
// ================================================================
process.on('unhandledRejection', error => console.error('[ERROR] Unhandled rejection:', error.message));
process.on('uncaughtException',  error => console.error('[ERROR] Uncaught exception:', error.message));
client.on('error', error => console.error('[DISCORD] Client error:', error.message));

// ================================================================
// LOGIN
// ================================================================
client.login(process.env.DISCORD_TOKEN);
