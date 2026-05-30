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
// CONFIG — edit bagian ini kalau ada perubahan
// ================================================================
const SERVER_IP        = '151.243.226.39';
const SERVER_PORT      = 30120;
const FIVEM_TIMEOUT    = 120000; // 2 menit (server lambat respon)
const KURS_TIMEOUT     = 8000;   // 8 detik (API kurs cepet)
const REFRESH_INTERVAL = 60000;  // refresh embed tiap 60 detik
const MAX_RETRIES      = 3;      // jumlah retry kalau gagal
const RETRY_DELAY      = 5000;   // delay antar retry (5 detik)

// Support multi-channel
const liveMessages     = new Map(); // channelId -> Message
const refreshIntervals = new Map(); // channelId -> intervalId

// ================================================================
// READY
// ================================================================
client.once('ready', () => {
    console.log(`[BOT] Login sebagai ${client.user.tag}`);
    updateKurs();
    setInterval(updateKurs, 60000);
});

// ================================================================
// HELPER: sleep
// ================================================================
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ================================================================
// FUNGSI UPDATE STATUS WATCHING USD
// ================================================================
async function updateKurs() {
    try {
        const res  = await axios.get('https://api.exchangerate-api.com/v4/latest/USD', {
            timeout: KURS_TIMEOUT
        });
        const rate    = res.data?.rates?.IDR;
        if (!rate) throw new Error('Field IDR tidak ditemukan di response');

        const kursIdr = `Rp ${Math.round(rate).toLocaleString('id-ID')}`;
        client.user.setActivity(`${kursIdr} / USD`, { type: ActivityType.Watching });
        console.log(`[KURS] Updated: ${kursIdr} / USD`);
    } catch (error) {
        console.error('[KURS] Gagal narik data kurs:', error.message);
    }
}

// ================================================================
// FUNGSI TARIK DATA FIVEM — dengan retry
// ================================================================
async function updateStatus() {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[FIVEM] Attempt ${attempt}/${MAX_RETRIES}...`);

            const [playersRes, infoRes] = await Promise.all([
                axios.get(`http://${SERVER_IP}:${SERVER_PORT}/players.json`, { timeout: FIVEM_TIMEOUT }),
                axios.get(`http://${SERVER_IP}:${SERVER_PORT}/info.json`,    { timeout: FIVEM_TIMEOUT })
            ]);

            // Validasi response
            if (!Array.isArray(playersRes.data)) throw new Error('players.json bukan array');
            if (!infoRes.data?.vars)             throw new Error('info.json tidak punya field vars');

            console.log(`[FIVEM] Berhasil: ${playersRes.data.length} player online`);

            return {
                players:       playersRes.data,
                clients:       playersRes.data.length,
                sv_maxclients: infoRes.data.vars?.sv_maxClients || 64,
                hostname:      infoRes.data.vars?.sv_projectName || 'Sunda Pride Roleplay'
            };

        } catch (error) {
            const isTimeout = error.code === 'ECONNABORTED' || error.message.includes('timeout');
            console.warn(`[FIVEM] Attempt ${attempt} gagal (${isTimeout ? 'TIMEOUT' : error.message})`);

            if (attempt < MAX_RETRIES) {
                console.log(`[FIVEM] Retry dalam ${RETRY_DELAY / 1000} detik...`);
                await sleep(RETRY_DELAY);
            }
        }
    }

    console.error('[FIVEM] Semua attempt gagal, return null');
    return null;
}

// ================================================================
// BUAT EMBED
// ================================================================
function createStatusEmbed(serverData) {
    const waktuLokal = new Date().toLocaleTimeString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour:     '2-digit',
        minute:   '2-digit'
    });

    // Embed offline
    if (!serverData) {
        return new EmbedBuilder()
            .setTitle('🔴 Sunda Pride Roleplay — OFFLINE')
            .setColor(0xFF0000)
            .setDescription(
                '> Server tidak dapat diakses saat ini.\n> Kemungkinan sedang maintenance atau restart.'
            )
            .setFooter({ text: `Last check: ${waktuLokal} WIB` })
            .setTimestamp();
    }

    // Urutkan player by ID
    const players = [...serverData.players].sort((a, b) => a.id - b.id);

    // Buat list player
    let playerListText;
    if (players.length === 0) {
        playerListText = '_Lagi sepi, ga ada warga yang online._';
    } else {
        playerListText = players
            .map((p, i) => `\`${String(i + 1).padStart(2, '0')}\` **${p.name}** — ID: \`${p.id}\` | Ping: \`${p.ping}ms\``)
            .join('\n');
    }

    // Potong kalau terlalu panjang (embed description max 4096 char)
    if (playerListText.length > 3500) {
        const lines      = playerListText.split('\n');
        let   truncated  = '';
        for (const line of lines) {
            if ((truncated + line).length > 3400) break;
            truncated += line + '\n';
        }
        playerListText = truncated.trimEnd() + `\n_... dan ${players.length - truncated.split('\n').filter(Boolean).length} lainnya_`;
    }

    // Warna berdasarkan kepadatan server
    const ratio = serverData.clients / serverData.sv_maxclients;
    const color = ratio >= 0.9 ? 0xFF4500  // merah — hampir full
                : ratio >= 0.5 ? 0xFFA500  // oranye — setengah
                :                0x00FF00; // hijau — sepi

    return new EmbedBuilder()
        .setTitle(`🟢 ${serverData.hostname} — LIVE`)
        .setColor(color)
        .setDescription(
            `**Player Online:** \`${serverData.clients}/${serverData.sv_maxclients}\`\n\n` +
            `**Daftar Warga:**\n${playerListText}`
        )
        .setFooter({ text: `Auto-refresh tiap 60 detik • Update: ${waktuLokal} WIB` })
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
        // Hapus pesan command
        message.delete().catch(err => console.warn('[CMD] Gagal hapus pesan:', err.message));

        // Kirim pesan loading dulu biar ga keliatan kosong
        const loadingEmbed = new EmbedBuilder()
            .setTitle('⏳ Sunda Pride Roleplay — Fetching Data...')
            .setColor(0xFFFF00)
            .setDescription('Sedang mengambil data server, harap tunggu...')
            .setFooter({ text: 'Ini bisa memakan waktu hingga 2 menit' });

        // Hentikan interval lama di channel ini kalau ada
        if (refreshIntervals.has(channelId)) {
            clearInterval(refreshIntervals.get(channelId));
            refreshIntervals.delete(channelId);
            console.log(`[LIVE] Interval lama di channel ${channelId} dihentikan`);
        }

        // Edit pesan lama kalau ada, atau kirim baru
        let sentMessage;
        if (liveMessages.has(channelId)) {
            sentMessage = liveMessages.get(channelId);
            await sentMessage.edit({ embeds: [loadingEmbed] }).catch(async () => {
                // Kalau pesan lama udah dihapus, kirim baru
                sentMessage = await message.channel.send({ embeds: [loadingEmbed] });
            });
        } else {
            sentMessage = await message.channel.send({ embeds: [loadingEmbed] });
        }
        liveMessages.set(channelId, sentMessage);

        // Tarik data pertama kali
        const serverData = await updateStatus();
        const embed      = createStatusEmbed(serverData);
        await sentMessage.edit({ embeds: [embed] })
            .catch(err => console.error('[LIVE] Gagal edit pesan pertama:', err.message));

        // Set interval refresh
        const interval = setInterval(async () => {
            const targetMsg = liveMessages.get(channelId);
            if (!targetMsg) {
                clearInterval(refreshIntervals.get(channelId));
                refreshIntervals.delete(channelId);
                return;
            }

            const newData  = await updateStatus();
            const newEmbed = createStatusEmbed(newData);

            await targetMsg.edit({ embeds: [newEmbed] })
                .catch(err => {
                    console.error('[LIVE] Gagal edit pesan refresh:', err.message);
                    // Kalau pesan dihapus manual, cleanup
                    if (err.code === 10008) {
                        liveMessages.delete(channelId);
                        clearInterval(refreshIntervals.get(channelId));
                        refreshIntervals.delete(channelId);
                        console.log(`[LIVE] Pesan di channel ${channelId} sudah dihapus, interval dibersihkan`);
                    }
                });
        }, REFRESH_INTERVAL);

        refreshIntervals.set(channelId, interval);
        console.log(`[LIVE] Live status dimulai di channel ${channelId}`);
    }

    // ── !stoplive ──────────────────────────────────────────────────
    if (content === '!stoplive') {
        message.delete().catch(err => console.warn('[CMD] Gagal hapus pesan:', err.message));

        const hasInterval = refreshIntervals.has(channelId);
        const hasMessage  = liveMessages.has(channelId);

        if (!hasInterval && !hasMessage) {
            const reply = await message.channel.send('⚠️ Tidak ada live status yang aktif di channel ini.');
            setTimeout(() => reply.delete().catch(() => {}), 5000);
            return;
        }

        if (hasInterval) {
            clearInterval(refreshIntervals.get(channelId));
            refreshIntervals.delete(channelId);
        }

        if (hasMessage) {
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

        console.log(`[LIVE] Live status dihentikan di channel ${channelId}`);
    }
});

// ================================================================
// ERROR HANDLING GLOBAL — biar bot ga crash
// ================================================================
process.on('unhandledRejection', (error) => {
    console.error('[ERROR] Unhandled rejection:', error.message);
});

process.on('uncaughtException', (error) => {
    console.error('[ERROR] Uncaught exception:', error.message);
    // Jangan exit — biar bot tetap jalan
});

client.on('error', (error) => {
    console.error('[DISCORD] Client error:', error.message);
});

// ================================================================
// LOGIN
// ================================================================
client.login(process.env.DISCORD_TOKEN);
