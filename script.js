// Connect to WebSocket server running on local machine
const ws = new WebSocket("ws://192.168.x.x:3000"); // ← Replace with your PC's local IP

// DOM Elements
const chatMessages = document.getElementById('chat-messages');
const sendBtn = document.getElementById('send-btn');
const messageInput = document.getElementById('message-input');
const videoStream = document.getElementById('videoStream') || document.getElementById('video-stream');

// Connection status
const connectionDot = document.getElementById('connection-dot');
const connectionText = document.getElementById('connection-text');
const darkModeToggle = document.getElementById('dark-mode-toggle');

// On open
ws.addEventListener('open', () => {
    appendMessage('System', 'Connected to control server.');
    connectionDot.classList.add('connected');
    connectionText.textContent = 'Connected';
});

// On close
ws.addEventListener('close', () => {
    appendMessage('System', 'Disconnected from control server.');
    connectionDot.classList.remove('connected');
    connectionText.textContent = 'Disconnected';
});

function appendMessage(sender, text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message user';

    msgDiv.innerHTML = `
        <div class="message-content"><strong>${sender}:</strong> ${text}</div>
        <div class="message-time">${new Date().toLocaleTimeString()}</div>
    `;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendCommand(command, value = null) {
    const payload = { command, value };
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
        appendMessage('You', `${command}${value !== null ? `: ${value}` : ''}`);
    }
}

// Button click events
document.querySelectorAll('[data-command]').forEach(button => {
    button.addEventListener('click', () => {
        const cmd = button.dataset.command;
        sendCommand(cmd);
    });
});

// Keyboard Events (WASD)
const keyMap = {
    'w': 'forward',
    'a': 'left',
    's': 'reverse',
    'd': 'right'
};

document.addEventListener('keydown', (e) => {
    if (document.activeElement === messageInput) return;

    const key = e.key.toLowerCase();
    if (keyMap[key]) {
        e.preventDefault();
        sendCommand(keyMap[key]);
    }
});

document.addEventListener('keyup', (e) => {
    if (document.activeElement === messageInput) return;

    const key = e.key.toLowerCase();
    if (Object.values(keyMap).includes(keyMap[key])) {
        sendCommand('stop');
    }
});

// Mouse Pan/Tilt Control
let isDragging = false;

videoStream?.addEventListener('mousedown', (e) => {
    isDragging = true;
    document.body.style.cursor = 'grabbing';
});

document.addEventListener('mouseup', () => {
    isDragging = false;
    document.body.style.cursor = 'default';
});

videoStream?.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const rect = videoStream.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    let pan = Math.round(90 + 90 * ((x - centerX)/centerX));
    let tilt = Math.round(90 + 90 * (-(y - centerY)/centerY));

    pan = Math.max(0, Math.min(180, pan));
    tilt = Math.max(0, Math.min(180, tilt));

    if (Math.abs(pan - 90) > 5) sendCommand('pan', pan);
    if (Math.abs(tilt - 90) > 5) sendCommand('tilt', tilt);
});

// Chat Input Handling
sendBtn.addEventListener('click', handleChatInput);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleChatInput();
});

function handleChatInput() {
    const input = messageInput.value.trim();
    if (!input) return;

    const [cmd, val] = input.split(':').map(s => s.trim().toLowerCase());

    const validCommands = ['forward', 'reverse', 'left', 'right', 'stop', 'pan', 'tilt'];
    if (validCommands.includes(cmd)) {
        sendCommand(cmd, val || null);
    } else {
        appendMessage('System', `Unknown command: ${cmd}`);
    }

    messageInput.value = '';
}

// Dark Mode Toggle
darkModeToggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const icon = darkModeToggle.querySelector('i');

    if (currentTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
        icon.classList.replace('fa-sun', 'fa-moon');
    } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
        icon.classList.replace('fa-moon', 'fa-sun');
    }
});

window.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);

    const icon = darkModeToggle.querySelector('i');
    if (savedTheme === 'dark') {
        icon.classList.replace('fa-moon', 'fa-sun');
    } else {
        icon.classList.replace('fa-sun', 'fa-moon');
    }

    // Load MJPG stream from ESP32
    if (videoStream) {
        videoStream.src = "http://<esp32-ip>/stream"; // ← Replace with actual ESP32 IP
    }
});