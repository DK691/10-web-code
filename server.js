const WebSocket = require('ws');
const http = require('http');
// const static = require('node-static');
const multiparty = require('multiparty');

const HTTP_PORT = 5500;
const WS_PORT = 5501;
const MJPEG_BOUNDARY = "ESP32CAM_BOUNDARY";

let latestMjpegFrame = null;
let latestMjpegFrameTimestamp = 0;

const wss = new WebSocket.Server({ port: WS_PORT });
const clients = new Map();
let nextClientId = 1;

let esp32CamWs = null;
let esp32DevKitWs = null;

wss.on('connection', function connection(ws, req) {
    const clientId = nextClientId++;
    let clientType = 'Browser';

    clients.set(ws, { id: clientId, type: clientType });
    console.log(`[WS] Client ${clientId} connected. Initial type: ${clientType}`);

    ws.send(`Welcome. You are client ${clientId}.`);
    broadcastToBrowsers(ws, `Client ${clientId} has joined the session.`);

    ws.on('message', function incoming(message) {
        const { id: senderId, type: senderType } = clients.get(ws);

        if (typeof message === 'string') {
            const msgStr = message.trim();
            console.log(`[WS] Received text from ${senderType} ${senderId}: "${msgStr}"`);

            if (msgStr === "ESP32-CAM connected!") {
                console.log(`[WS] Identified client ${senderId} as ESP32-CAM.`);
                clients.set(ws, { id: senderId, type: 'ESP32-CAM' });
                esp32CamWs = ws;
                broadcastToBrowsers(null, `ESP32-CAM is now connected!`);
                return;
            } else if (msgStr === "ESP32-DevKit connected!") {
                console.log(`[WS] Identified client ${senderId} as ESP32-DevKit.`);
                clients.set(ws, { id: senderId, type: 'ESP32-DevKit' });
                esp32DevKitWs = ws;
                broadcastToBrowsers(null, `ESP32-DevKit is now connected!`);
                return;
            }

            if (senderType === 'Browser') {
                if (msgStr.startsWith('pan ') || msgStr.startsWith('tilt ') || 
                    ['forward', 'reverse', 'left', 'right', 'stop', 'motor1_on', 'motor1_off'].includes(msgStr)) {
                    if (esp32DevKitWs && esp32DevKitWs.readyState === WebSocket.OPEN) {
                        esp32DevKitWs.send(msgStr);
                        console.log(`[WS] Forwarded command to ESP32-DevKit: "${msgStr}"`);
                        ws.send(`Server: Command "${msgStr}" sent to ESP32-DevKit.`);
                    } else {
                        console.warn(`[WS] ESP32-DevKit not connected. Command "${msgStr}" not sent.`);
                        ws.send(`Server: ESP32-DevKit not connected. Command not sent.`);
                    }
                } else if (msgStr.startsWith('volume ')) {
                    const volumeLevel = parseInt(msgStr.substring(7), 10);
                    if (!isNaN(volumeLevel) && volumeLevel >= 0 && volumeLevel <= 100) {
                        if (esp32DevKitWs && esp32DevKitWs.readyState === WebSocket.OPEN) {
                            esp32DevKitWs.send(`volume ${volumeLevel}`);
                            console.log(`[WS] Forwarded volume command to ESP32-DevKit: "${volumeLevel}"`);
                            ws.send(`Server: Volume set to ${volumeLevel} on ESP32-DevKit.`);
                        } else {
                            console.warn(`[WS] ESP32-DevKit not connected. Volume command not sent.`);
                            ws.send(`Server: ESP32-DevKit not connected. Volume command not sent.`);
                        }
                    } else {
                        console.warn(`[WS] Invalid volume level: "${msgStr}". Expected 0-100.`);
                        ws.send(`Server: Invalid volume level. Please use a number between 0 and 100.`);
                    }
                } else if (msgStr.startsWith('speed ')) {
                    const speedLevel = parseInt(msgStr.substring(6), 10);
                    if (!isNaN(speedLevel) && speedLevel >= 0 && speedLevel <= 255) {
                        if (esp32DevKitWs && esp32DevKitWs.readyState === WebSocket.OPEN) {
                            esp32DevKitWs.send(`speed ${speedLevel}`);
                            console.log(`[WS] Forwarded speed command to ESP32-DevKit: "${speedLevel}"`);
                            ws.send(`Server: Speed set to ${speedLevel} on ESP32-DevKit.`);
                        } else {
                            console.warn(`[WS] ESP32-DevKit not connected. Speed command not sent.`);
                            ws.send(`Server: ESP32-DevKit not connected. Speed command not sent.`);
                        }
                    } else {
                        console.warn(`[WS] Invalid speed level: "${msgStr}". Expected 0-255.`);
                        ws.send(`Server: Invalid speed level. Please use a number between 0 and 255.`);
                    }
                } else {
                    broadcastToBrowsers(ws, `Client ${senderId}: ${msgStr}`);
                    ws.send(`Server: Your message broadcasted.`);
                }
            } else if (senderType === 'ESP32-CAM') {
                console.log(`[WS] ESP32-CAM status: ${msgStr}`);
                broadcastToBrowsers(null, `ESP32-CAM: ${msgStr}`);
            } else if (senderType === 'ESP32-DevKit') {
                console.log(`[WS] ESP32-DevKit status: ${msgStr}`);
                broadcastToBrowsers(null, `ESP32-DevKit: ${msgStr}`);
            }
        } else if (message instanceof Buffer) {
            console.log(`[WS] Received binary data (${message.length} bytes) from ${senderType} ${senderId}.`);

            if (senderType === 'ESP32-DevKit') {
                broadcastToBrowsers(null, message, { binary: true });
            } else if (senderType === 'Browser') {
                if (esp32DevKitWs && esp32DevKitWs.readyState === WebSocket.OPEN) {
                    esp32DevKitWs.send(message, { binary: true });
                } else {
                    console.warn(`[WS] ESP32-DevKit not connected. Stereo audio not sent.`);
                }
            }
        }
    });

    ws.on('close', () => {
        const { id: disconnectedId, type: disconnectedType } = clients.get(ws);
        console.log(`[WS] ${disconnectedType} client ${disconnectedId} disconnected.`);
        clients.delete(ws);
        if (disconnectedType === 'ESP32-CAM') {
            esp32CamWs = null;
            broadcastToBrowsers(null, `ESP32-CAM has disconnected!`);
        } else if (disconnectedType === 'ESP32-DevKit') {
            esp32DevKitWs = null;
            broadcastToBrowsers(null, `ESP32-DevKit has disconnected!`);
        } else {
            broadcastToBrowsers(ws, `Client ${disconnectedId} has left the session.`);
        }
    });

    ws.on('error', (error) => {
        const { id: errorId, type: errorType } = clients.get(ws);
        console.error(`[WS] WebSocket error from ${errorType} client ${errorId}:`, error);
    });
});

function broadcastToBrowsers(senderWs, message, options = {}) {
    wss.clients.forEach(function each(client) {
        const clientInfo = clients.get(client);
        if (client !== senderWs && clientInfo && clientInfo.type === 'Browser' && client.readyState === WebSocket.OPEN) {
            client.send(message, options);
        }
    });
}

const httpServer = http.createServer((req, res) => {
    if (req.url === '/mjpeg_input' && req.method === 'POST') {
        console.log(`[HTTP] Received MJPEG stream POST request from ${req.socket.remoteAddress}`);

        const contentType = req.headers['content-type'] || '';
        if (!contentType.includes('multipart/x-mixed-replace')) {
            console.error('[HTTP] Invalid Content-Type for MJPEG stream:', contentType);
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Bad Request: Expected multipart/x-mixed-replace');
            return;
        }

        const boundaryMatch = contentType.match(/boundary=(.+)/);
        if (!boundaryMatch || boundaryMatch[1] !== MJPEG_BOUNDARY) {
            console.error('[HTTP] Mismatched MJPEG boundary. Expected:', MJPEG_BOUNDARY, 'Got:', boundaryMatch ? boundaryMatch[1] : 'None');
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Bad Request: Mismatched boundary');
            return;
        }

        const streamBoundary = `--${MJPEG_BOUNDARY}`;
        res.writeHead(200, { 'Content-Type': 'text/plain' });

        let keepAliveInterval = setInterval(() => {
            if (res.writable) {
                res.write('\n');
            } else {
                clearInterval(keepAliveInterval);
            }
        }, 3000);

        let buffer = Buffer.alloc(0);
        req.on('data', chunk => {
            buffer = Buffer.concat([buffer, chunk]);
            let startIndex = 0;

            while (true) {
                const boundaryIndex = buffer.indexOf(streamBoundary, startIndex);
                if (boundaryIndex === -1) break;

                const nextBoundaryIndex = buffer.indexOf(streamBoundary, boundaryIndex + streamBoundary.length);
                if (nextBoundaryIndex === -1) break;

                const part = buffer.slice(boundaryIndex + streamBoundary.length, nextBoundaryIndex);
                const headerEnd = part.indexOf('\r\n\r\n');
                if (headerEnd !== -1) {
                    const jpegStart = headerEnd + 4;
                    const jpegData = part.slice(jpegStart);
                    latestMjpegFrame = jpegData;
                    latestMjpegFrameTimestamp = Date.now();
                }
                startIndex = nextBoundaryIndex;
            }
        });

        req.on('end', () => {
            clearInterval(keepAliveInterval);
            console.log('[HTTP] MJPEG stream ended.');
        });
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

httpServer.listen(HTTP_PORT, () => {
    console.log(`[HTTP] MJPEG server listening on port ${HTTP_PORT}`);
});
