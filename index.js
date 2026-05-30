const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const axios = require('axios');
const express = require('express');

// --- DUMMY WEB SERVER UNTUK RAILWAY ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Live Status Bot Active!'));
app.listen(port, () => console.log(`Server running on port ${port}`));

// --- SETUP BOT DISCORD ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// --- CONFIG ---
const SERVER_IP   = '151.243.226.39';
const SERVER_PORT = 30120;
const TIMEOUT_MS  = 60000; // 60 detik

// Pakai Map biar support multi-channel
const liveMessages    = new Map(); // channelId -> Message
const refreshIntervals = new Map(); // channelId -> intervalId

// -------------------------------------------------------------------
// READY
// -------------------------------------------------------------------
client.once('ready', () => {
    console.log(`✅ Bot login sebagai ${client.user.tag}`);
    updateKurs();
    setInterval(updateKurs, 60000);
});

// -------------------------------------------------------------------
// FUNGSI UPDATE STATUS WATCHING USD
// -------------------------------------------------------------------
async function updateKurs() {
    try {
        const res = await axios.get('https://api.exchangerate-api.com/v4/latest/USD', {
            timeout: TIMEOUT_MS
        });
        const rate    = res.data.rates.IDR;
        const kursIdr = `Rp ${Math.round(rate).toLocaleString('id-ID')}`;
        client.user.setActivity(`${kursIdr} / USD`, { type: ActivityType.Watching });
    } catch (error) {
        console.error('Gagal narik data kurs:', error.message);
    }
}

// -------------------------------------------------------------------
// FUNGSI TARIK DATA FIVEM (direct ke IP server)
// -------------------------------------------------------------------
async function updateStatus() {
    try {
        const [playersRes, infoRes] = await Promise.all([
            axios.get(`http://${SERVER_IP}:${SERVER_PORT}/players.json`, { timeout: TIMEOUT_MS }),
            axios.get(`http://${SERVER_IP}:${SERVER_PORT}/info.json`,    { timeout: TIMEOUT_MS })
        ]);

        return {
            players:        playersRes.data,
            clients:        playersRes.data.length,
            sv_maxclients:  infoRes.data.vars?.sv_maxClients || 64,
            ownerAvatar:    null
        };
    } catch (error) {
        if (error.code === 'ECONNABORTED') {
            console.error('Timeout: server FiveM tidak merespons dalam 60 detik.');
        } else {
            console.error('Gagal update status:', error.message);
        }
        return null;
    }
}

// -------------------------------------------------------------------
// BUAT EMBED
// -------------------------------------------------------------------
async function createStatusEmbed(serverData) {
    // Embed khusus kalau server ga bisa diakses
    if (!serverData) {
        return new EmbedBuilder()
            .setTitle('🔴 Sunda Pride Roleplay — OFFLINE')
            .setColor(0xFF0000)
            .setDescription('Server tidak dapat ditemukan atau sedang offline.')
            .setFooter({
                text: `Last check: ${new Date().toLocaleTimeString('id-ID', {
                    timeZone: 'Asia/Jakarta'
                })} WIB`
            });
    }

    const players = [...(serverData.players || [])];
    players.sort((a, b) => a.id - b.id);

    let playerListText = players.length > 0
        ? players.map((p, i) => `${i + 1}. **${p.name}** (ID: ${p.id} | Ping: ${p.ping}ms)`).join('\n')
        : 'Lagi sepi, ga ada warga yang online.';

    // Jaga embed biar ga overflow (max ~4096 char)
    if (playerListText.length > 3800) {
        playerListText = playerListText.substring(0, 3800) + '\n_... dan lainnya_';
    }

    const waktuLokal = new Date().toLocaleTimeString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour:     '2-digit',
        minute:   '2-digit'
    });

    const footerOptions = {
        text: `Auto-refresh tiap 60 detik • Update: Jam ${waktuLokal} WIB`
    };
    if (serverData.ownerAvatar) {
        footerOptions.iconURL = serverData.ownerAvatar;
    }

    return new EmbedBuilder()
        .setTitle('🟢 Sunda Pride Roleplay Status (LIVE)')
        .setColor(0x00FF00)
        .setDescription(
            `**Player Online:** ${serverData.clients}/${serverData.sv_maxclients}\n\n` +
            `**Daftar Warga:**\n${playerListText}`
        )
        .setFooter(footerOptions);
}

// -------------------------------------------------------------------
// MESSAGE HANDLER
// -------------------------------------------------------------------
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const channelId = message.channel.id;

    // !live — mulai live status
    if (message.content === '!live') {
        message.delete().catch(err => console.warn('Gagal hapus pesan:', err.message));

        const serverData = await updateStatus();
        const embed      = await createStatusEmbed(serverData);

        // Bersihkan interval lama di channel ini
        if (refreshIntervals.has(channelId)) {
            clearInterval(refreshIntervals.get(channelId));
            refreshIntervals.delete(channelId);
        }

        const sentMessage = await message.channel.send({ embeds: [embed] });
        liveMessages.set(channelId, sentMessage);

        const interval = setInterval(async () => {
            const targetMsg = liveMessages.get(channelId);
            if (!targetMsg) return;

            const newData  = await updateStatus();
            const newEmbed = await createStatusEmbed(newData);

            await targetMsg.edit({ embeds: [newEmbed] })
                .catch(err => console.error('Gagal edit pesan:', err.message));
        }, 60000);

        refreshIntervals.set(channelId, interval);
        console.log(`▶ Live status dimulai di channel ${channelId}`);
    }

    // !stoplive — stop live status di channel ini
    if (message.content === '!stoplive') {
        message.delete().catch(err => console.warn('Gagal hapus pesan:', err.message));

        if (refreshIntervals.has(channelId)) {
            clearInterval(refreshIntervals.get(channelId));
            refreshIntervals.delete(channelId);
        }

        if (liveMessages.has(channelId)) {
            const liveMsg = liveMessages.get(channelId);
            await liveMsg.edit({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('⏹ Live Status Dihentikan')
                        .setColor(0x808080)
                        .setDescription('Live status telah dihentikan.')
                        .setFooter({ text: new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB' })
                ]
            }).catch(() => {});
            liveMessages.delete(channelId);
        }

        console.log(`⏹ Live status dihentikan di channel ${channelId}`);
    }
});

// -------------------------------------------------------------------
// LOGIN
// -------------------------------------------------------------------
client.login(process.env.DISCORD_TOKEN);
