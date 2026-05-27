const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
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

client.once('ready', () => {
    console.log(`Bot berhasil login sebagai ${client.user.tag}`);
});

// Fungsi untuk menarik data dan membuat embed
async function createStatusEmbed() {
    try {
        const response = await axios.get(`${cfxEndpoint}?t=${Date.now()}`); // Bypass cache
        const serverData = response.data.Data;
        
        const players = serverData.players || [];
        const totalPlayers = serverData.clients;
        const maxPlayers = serverData.sv_maxclients;

        let playerListText = "";
        if (players.length > 0) {
            players.forEach((p, index) => {
                playerListText += `${index + 1}. **${p.name}** (ID: ${p.id} | Ping: ${p.ping}ms)\n`;
            });
        } else {
            playerListText = "Lagi sepi, ga ada warga yang online.";
        }

        const waktuLokal = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

        return new EmbedBuilder()
            .setTitle(`🟢 Sunda Pride Roleplay Status (LIVE)`)
            .setColor(0x00FF00)
            .setDescription(`**Player Online:** ${totalPlayers}/${maxPlayers}\n\n**Daftar Warga:**\n${playerListText}`)
            .setFooter({ text: `Auto-refresh tiap 60 detik • Update terakhir: Jam ${waktuLokal} WIB`, iconURL: serverData.ownerAvatar });
            
    } catch (error) {
        console.error('Gagal mengambil data:', error.message);
        return null;
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Ketik !live untuk memunculkan pesan auto-refresh
    if (message.content === '!live') {
        const embed = await createStatusEmbed();
        if (!embed) return message.channel.send('Gagal mengambil data awal dari server.');

        // Kirim pesan status utama
        liveMessage = await message.channel.send({ embeds: [embed] });
        
        // Hapus command !live dari chat biar channel tetap bersih
        message.delete().catch(() => {});

        // Jalankan perulangan otomatis tiap 60 detik (60000 ms)
        setInterval(async () => {
            if (liveMessage) {
                const updatedEmbed = await createStatusEmbed();
                if (updatedEmbed) {
                    await liveMessage.edit({ embeds: [updatedEmbed] }).catch(err => console.error('Gagal edit pesan:', err.message));
                }
            }
        }, 60000);
    }
});

client.login(process.env.DISCORD_TOKEN);
