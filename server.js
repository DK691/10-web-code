const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files like index.html, styles.css, script.js
app.use(express.static(__dirname));
//ok
// Optional: Use axios if you're forwarding commands via HTTP to ESP32
// Run: npm install axios
const axios = require('axios');
const ESP32_IP = 'http://192.168.x.x'; // Replace with your ESP32 IP address

wss.on('connection', (socket) => {
    console.log('✅ Browser client connected.');

    socket.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());

            console.log('📨 Received from browser:', data);

            // Broadcast message to all other connected clients
            wss.clients.forEach((client) => {
                if (client !== socket && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });

            // 🔁 Forward command to ESP32 via HTTP GET request
            // Example: http://192.168.x.x/control?command=pan&value=90
            if (data.command) {
                const url = `${ESP32_IP}/control?command=${encodeURIComponent(data.command)}`;
                const fullUrl = data.value !== undefined ? `${url}&value=${encodeURIComponent(data.value)}` : url;

                axios.get(fullUrl)
                    .then(() => {
                        console.log(`📤 Sent to ESP32: ${fullUrl}`);
                    })
                    .catch(err => {
                        console.error(`❌ Failed to send to ESP32: ${err.message}`);
                    });
            }

        } catch (err) {
            console.error('⚠️ Error parsing message:', err.message);
        }
    });

    socket.on('close', () => {
        console.log('🔌 Browser client disconnected.');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌐 Server running at http://localhost:${PORT}`);
});