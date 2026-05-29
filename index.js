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

const cfxEndpoint = 'https://servers-frontend.fivem.net/api/servers/single/e6e6lmp';
let liveMessage = null;
let refreshInterval = null;

client.once('ready', () => {
    console.log(`Bot login sebagai ${client.user.tag}`);
    
    // Jalankan fungsi update kurs untuk status profil bot
    updateKurs();
    setInterval(updateKurs, 60000); 
});

// --- FUNGSI UPDATE STATUS WATCHING USD ---
async function updateKurs() {
    try {
        const res = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
        const kursIdr = res.data.rates.IDR.toLocaleString('id-ID', { style: 'currency', currency: 'IDR' });
        
        client.user.setActivity(`${kursIdr} / USD`, { type: ActivityType.Watching });
    } catch (error) {
        console.error('Gagal narik data kurs:', error.message);
    }
}

// --- FUNGSI TARIK DATA FIVEM ---
async function updateStatus() {
    try {
        const response = await axios.get(`${cfxEndpoint}?t=${Date.now()}`);
        return response.data.Data;
    } catch (error) {
        console.error('Gagal update status utama:', error.message);
        return null;
    }
}

async function createStatusEmbed(serverData) {
    if (!serverData) return null;

    const players = serverData.players || [];
    
    // Urutkan pemain berdasarkan ID (terkecil ke terbesar)
    players.sort((a, b) => a.id - b.id);
    
    let playerListText = "";
    
    if (players.length > 0) {
        players.forEach((p, index) => {
            playerListText += `${index + 1}. **${p.name}** (ID: ${p.id} | Ping: ${p.ping}ms)\n`;
        });
    } else {
        playerListText = "Lagi sepi, ga ada warga yang online.";
    }

    // Setting jam WIB
    const waktuLokal = new Date().toLocaleTimeString('id-ID', { 
        timeZone: 'Asia/Jakarta', 
        hour: '2-digit', 
        minute: '2-digit' 
    });

    return new EmbedBuilder()
        .setTitle(`🟢 Sunda Pride Roleplay Status (LIVE)`)
        .setColor(0x00FF00)
        .setDescription(`**Player Online:** ${serverData.clients}/${serverData.sv_maxclients}\n\n**Daftar Warga:**\n${playerListText}`)
        .setFooter({ text: `Auto-refresh tiap 60 detik • Update: Jam ${waktuLokal} WIB`, iconURL: serverData.ownerAvatar });
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!live') {
        const serverData = await updateStatus();
        const embed = await createStatusEmbed(serverData);
        if (!embed) return message.channel.send('Gagal narik data dari server.');

        liveMessage = await message.channel.send({ embeds: [embed] });
        message.delete().catch(() => {});

        if (refreshInterval) clearInterval(refreshInterval);

        refreshInterval = setInterval(async () => {
            if (liveMessage) {
                const newData = await updateStatus();
                const newEmbed = await createStatusEmbed(newData);
                if (newEmbed) {
                    await liveMessage.edit({ embeds: [newEmbed] }).catch(err => console.error('Gagal edit pesan:', err.message));
                }
            }
        }, 60000);
    }
});

client.login(process.env.DISCORD_TOKEN);
