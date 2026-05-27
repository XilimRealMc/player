const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const express = require('express');

// --- DUMMY WEB SERVER UNTUK RENDER ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot Discord Sunda Pride Aktif!'));
app.listen(port, () => console.log(`Dummy server nyala di port ${port}`));
// -------------------------------------

// --- SETUP BOT DISCORD ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const cfxEndpoint = 'https://servers-frontend.fivem.net/api/servers/single/e6e6lmp';

client.once('ready', () => {
    console.log(`Bot berhasil login sebagai ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!warga') {
        try {
            const response = await axios.get(cfxEndpoint);
            const serverData = response.data.Data;
            
            const players = serverData.players;
            const totalPlayers = serverData.clients;
            const maxPlayers = serverData.sv_maxclients;

            let playerListText = "";
            if (players && players.length > 0) {
                players.forEach((p, index) => {
                    playerListText += `${index + 1}. **${p.name}** (ID: ${p.id} | Ping: ${p.ping}ms)\n`;
                });
            } else {
                playerListText = "Lagi sepi, ga ada warga yang online.";
            }

            const embed = new EmbedBuilder()
                .setTitle(`🟢 Sunda Pride Roleplay Status`)
                .setColor(0x00FF00)
                .setDescription(`**Player Online:** ${totalPlayers}/${maxPlayers}\n\n**Daftar Warga:**\n${playerListText}`)
                .setFooter({ text: 'Data dari CFX API', iconURL: serverData.ownerAvatar });

            message.channel.send({ embeds: [embed] });

        } catch (error) {
            console.error('Error:', error);
            message.channel.send('Gagal narik data dari server, coba lagi nanti.');
        }
    }
});

// Tarik token dari Environment Variable Render
client.login(process.env.DISCORD_TOKEN);
