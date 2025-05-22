// IMPORTANT: Replace YOUR_SERVER_IP with the actual IP of your Node.js server
const SERVER_IP = 'YOUR_SERVER_IP'; // e.g., '192.168.1.10' or 'localhost'
const HTTP_PORT = 5500;
const WS_PORT = 5501; 

const ws = new WebSocket(`ws://${SERVER_IP}:${WS_PORT}/ws`);
const messagesDiv = document.getElementById('messages'); // For general system messages
const chatMessagesDiv = document.getElementById('chat-messages'); // For chat log

// --- Web Audio API Setup ---
let audioContext = null;
let audioBufferQueue = []; // Queue to hold incoming audio buffers
let isPlaying = false;
let gainNode = null; // For volume control

// Create audio context when user interaction happens (required by browsers)
function initAudioContext() {
    if (!audioContext) {
        try {
            // Set sample rate for incoming mono audio from ESP32 DevKit (16kHz)
            audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            console.log('Web Audio API context created.');

            // Create a GainNode for volume control
            gainNode = audioContext.createGain();
            gainNode.connect(audioContext.destination);
            // Set initial volume from slider
            const volumeSlider = document.getElementById('volume-slider');
            if (volumeSlider) {
                gainNode.gain.value = volumeSlider.value / 100;
            } else {
                gainNode.gain.value = 0.75; // Default volume
            }

            // Start processing the queue when the context is ready/running
            if (audioContext.state === 'running') {
                processAudioQueue();
            } else {
                audioContext.resume().then(() => {
                    console.log('Audio context resumed successfully.');
                    processAudioQueue();
                });
            }
        } catch (e) {
            console.error('Web Audio API is not supported in this browser:', e);
            document.getElementById("connection-text").textContent = "Audio not supported"; // Or similar feedback
        }
    }
}

// Function to process and play buffers from the queue
function processAudioQueue() {
    if (!audioContext || audioBufferQueue.length === 0 || isPlaying) {
        return;
    }

    isPlaying = true;
    const audioData = audioBufferQueue.shift(); // Get the oldest buffer

    const numberOfChannels = 1; // Mono from ESP32 DevKit mic
    const sampleRate = 16000; // Sample rate from ESP32 DevKit mic
    const bytesPerSample = 2; // 16-bit audio

    // Ensure audioData is an ArrayBuffer
    const arrayBuffer = audioData instanceof ArrayBuffer ? audioData : new Uint8Array(audioData).buffer;

    // Create a temporary buffer to hold the PCM data
    // Need to convert 16-bit integers to 32-bit floating point for AudioBuffer
    const pcmArray = new Float32Array(arrayBuffer.byteLength / bytesPerSample);
    const dataView = new DataView(arrayBuffer);

    for (let i = 0; i < pcmArray.length; i++) {
        // Read 16-bit signed integer, convert to float between -1 and 1
        const int16Sample = dataView.getInt16(i * bytesPerSample, true); // true for little-endian
        pcmArray[i] = int16Sample / 32768.0; // Convert to float (range -1 to 1)
    }

    // Create AudioBuffer
    const audioBuffer = audioContext.createBuffer(numberOfChannels, pcmArray.length, sampleRate);

    // Copy the PCM data to the AudioBuffer
    if (numberOfChannels === 1) {
        audioBuffer.copyToChannel(pcmArray, 0); // Copy to the first (and only) channel
    }


    // Create AudioBufferSourceNode
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;

    // Connect source to gain node for volume control
    source.connect(gainNode);

    // Play the buffer
    let startTime = audioContext.currentTime;
    if (processAudioQueue.nextStartTime && processAudioQueue.nextStartTime > startTime) {
        startTime = processAudioQueue.nextStartTime;
    }

    source.start(startTime);

    // Schedule the start time for the next buffer
    processAudioQueue.nextStartTime = startTime + audioBuffer.duration;

    source.onended = () => {
        isPlaying = false;
        // Process the next buffer in the queue
        processAudioQueue();
    };
}


document.addEventListener('DOMContentLoaded', () => {
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const body = document.body;

    // Event listener for user interaction to initialize audio context
    document.body.addEventListener('click', initAudioContext, { once: true });
    document.body.addEventListener('keydown', initAudioContext, { once: true });
    document.body.addEventListener('touchstart', initAudioContext, { once: true });


    // Check for saved dark mode preference
    if (localStorage.getItem('darkMode') === 'enabled') {
        body.setAttribute('data-theme', 'dark');
        darkModeToggle.querySelector('i').classList.replace('fa-moon', 'fa-sun');
    }

    // Toggle dark mode on button click
    darkModeToggle.addEventListener('click', () => {
        const isDarkMode = body.getAttribute('data-theme') === 'dark';
        if (isDarkMode) {
            body.removeAttribute('data-theme');
        } else {
            body.setAttribute('data-theme', 'dark');
        }

        // Update icon based on mode
        darkModeToggle.querySelector('i').classList.toggle('fa-moon', isDarkMode);
        darkModeToggle.querySelector('i').classList.toggle('fa-sun', !isDarkMode);

        // Save preference to localStorage
        localStorage.setItem('darkMode', !isDarkMode ? 'enabled' : 'disabled');
    });

    // Servo control: Pan and Tilt sliders
    const panSlider = document.getElementById("pan-slider");
    const tiltSlider = document.getElementById("tilt-slider");

    if (panSlider) {
        panSlider.addEventListener("input", () => {
            const angle = panSlider.value;
            sendCommand(`pan ${angle}`);
        });
    }

    if (tiltSlider) {
        tiltSlider.addEventListener("input", () => {
            const angle = tiltSlider.value;
            sendCommand(`tilt ${angle}`);
        });
    }

    // New: Speed Control Slider
    const speedSlider = document.getElementById("speed-slider");
    if (speedSlider) {
        speedSlider.addEventListener("input", () => {
            const speed = speedSlider.value;
            sendCommand(`speed ${speed}`);
        });
    }

    // New: Volume Control Slider
    const volumeSlider = document.getElementById("volume-slider");
    if (volumeSlider) {
        volumeSlider.addEventListener("input", () => {
            const volume = volumeSlider.value;
            // Update the gain node directly if audio context is active
            if (gainNode) {
                gainNode.gain.value = volume / 100;
            }
            // Also send command to ESP32 DevKit for its speaker volume
            sendCommand(`volume ${volume}`); 
        });
    }


    // Servo control: Mouse movement over video stream
    const videoStream = document.getElementById("videoStream"); // Changed from mjpeg-stream to videoStream
    let lastPanAngle = -1;
    let lastTiltAngle = -1;
    let isMouseOverStream = false;

    // Throttle function to limit how often we send commands
    function throttle(func, delay) {
        let lastCall = 0;
        return (...args) => {
            const now = Date.now();
            if (now - lastCall >= delay) {
                lastCall = now;
                return func(...args);
            }
        };
    }

    const updateServoAngles = throttle((panAngle, tiltAngle) => {
        // Ensure commands are sent even if throttle skips some updates
        // Avoid redundant sending if angle hasn't actually changed from the last *sent* angle
        const panChanged = panAngle !== lastPanAngle;
        const tiltChanged = tiltAngle !== lastTiltAngle;

        if (panChanged) {
            sendCommand(`pan ${panAngle}`);
            lastPanAngle = panAngle;
        }
        if (tiltChanged) {
            sendCommand(`tilt ${tiltAngle}`);
            lastTiltAngle = tiltAngle;
        }
    }, 100); // Throttle to 100ms intervals

    if (videoStream) {
        videoStream.addEventListener("mousemove", (e) => {
            if (!isMouseOverStream) return;

            // Get the bounding rectangle of the video stream
            const rect = videoStream.getBoundingClientRect();

            // Calculate mouse position relative to the video stream
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // Calculate position as percentage of the stream dimensions
            const percentX = (mouseX / rect.width) * 100;
            const percentY = (mouseY / rect.height) * 100;

            // Map percentage to servo angles (0-180 degrees)
            // Invert X axis so left = 180, right = 0 (assuming camera faces you)
            const panAngle = Math.round(180 - (percentX * 180 / 100));
            // For Y axis, top = 0, bottom = 180
            const tiltAngle = Math.round(percentY * 180 / 100);

            // Ensure angles are within bounds
            const constrainedPan = Math.max(0, Math.min(180, panAngle));
            const constrainedTilt = Math.max(0, Math.min(180, tiltAngle));

            // Send the updated angles
            updateServoAngles(constrainedPan, constrainedTilt);
        });

        videoStream.addEventListener("mouseenter", () => {
            isMouseOverStream = true;
        });

        videoStream.addEventListener("mouseleave", () => {
            isMouseOverStream = false;
            // Optionally, reset to a default position when mouse leaves
            // sendCommand(`pan 90`);
            // sendCommand(`tilt 90`);
            // lastPanAngle = 90;
            // lastTiltAngle = 90;
        });
    }
});

// WebSocket connection status handling
ws.onopen = () => {
    console.log("Connected to WebSocket server");
    document.getElementById("connection-dot").style.backgroundColor = "green";
    document.getElementById("connection-text").textContent = "Connected";
    // Attempt to resume audio context if it exists but is suspended
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
            console.log('Audio context resumed after WebSocket reconnect.');
        });
    }
};

ws.onclose = () => {
    console.log("WebSocket disconnected");
    document.getElementById("connection-dot").style.backgroundColor = "red";
    document.getElementById("connection-text").textContent = "Disconnected";
    // Pause audio playback when disconnected
    if (audioContext && audioContext.state === 'running') {
        audioContext.suspend().then(() => {
            console.log('Audio context suspended due to WebSocket disconnect.');
        });
    }
};

ws.onerror = (error) => {
    console.error("WebSocket Error:", error);
    document.getElementById("connection-dot").style.backgroundColor = "orange"; // Indicate error state
    document.getElementById("connection-text").textContent = "Error";
};

// --- Modified ws.onmessage handler ---
ws.onmessage = (event) => {
    if (typeof event.data === 'string') {
        // Handle text messages (commands, system messages)
        console.log("Received text:", event.data);
        
        // Check if it's a server message about client commands
        if (event.data.startsWith('Server: ') || event.data.startsWith('Welcome to')) {
            appendMessage("Server", event.data);
        } 
        // Check if it's a broadcast from another client
        else if (event.data.startsWith('From Client: ')) {
            const parts = event.data.split(':');
            if (parts.length >= 3) {
                const clientId = parts[1].trim();
                const message = parts.slice(2).join(':').trim();
                appendMessage(`Client ${clientId}`, message);
            } else {
                appendMessage("Other Client", event.data.substring(13));
            }
        }
        // Default case - system message
        else {
            appendMessage("System", event.data);
        }
    } else if (event.data instanceof Blob || event.data instanceof ArrayBuffer) {
        // Handle binary messages (assuming audio data)

        // --- START: User requested change here ---
        // Change logging from byte count to attempted text conversion
        if (event.data instanceof Blob) {
            event.data.text().then(textData => {
                console.log("Received binary data (attempted text conversion):", textData);
            }).catch(e => {
                console.error("Failed to read blob as text:", e);
                console.log("Received binary data (Blob):", event.data.size, "bytes"); // Fallback logging
            });
        } else if (event.data instanceof ArrayBuffer) {
            try {
                const textData = new TextDecoder().decode(event.data);
                console.log("Received binary data (attempted text conversion):", textData);
            } catch (e) {
                console.error("Failed to decode ArrayBuffer as text:", e);
                console.log("Received binary data (ArrayBuffer):", event.data.byteLength, "bytes"); // Fallback logging
            }
        }
        // --- END: User requested change ---


        // Use FileReader to get ArrayBuffer from Blob if necessary
        const processAudio = (arrayBuffer) => {
            if (!audioContext) {
                console.warn("Audio context not initialized. Cannot play audio.");
                // Store the data anyway, it might be played later
                audioBufferQueue.push(arrayBuffer);
                return;
            }
            audioBufferQueue.push(arrayBuffer);
            processAudioQueue(); // Attempt to play the newly added buffer
            // Indicate audio activity (optional, based on previous suggestion)
            // indicateAudioActivity();
        };

        if (event.data instanceof Blob) {
            const reader = new FileReader();
            reader.onloadend = () => {
                processAudio(reader.result); // reader.result is an ArrayBuffer
            };
            reader.readAsArrayBuffer(event.data); // Still need ArrayBuffer for audio processing
        } else if (event.data instanceof ArrayBuffer) {
            processAudio(event.data); // Already an ArrayBuffer
        }
    } else {
        console.log("Received unknown message type.");
    }
};

// Send command via WebSocket
function sendCommand(command) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(command);
        appendMessage("You", command); // Add command to the chat console
    } else {
        console.warn("WebSocket is not connected. Command not sent:", command);
        // Optionally add a system message to the console
        appendMessage("System", `Command failed (not connected): ${command}`);
    }
}

// Handle control button clicks
document.querySelectorAll(".control-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        const command = btn.getAttribute("data-command");
        if (command) {
            sendCommand(command);
        }
    });
});

// Handle chat send button
document.getElementById("send-btn").addEventListener("click", () => {
    const input = document.getElementById("message-input");
    const msg = input.value.trim();
    if (msg) {
        sendCommand(msg);
        input.value = "";
    }
});

// Handle pressing Enter in chat input
document.getElementById("message-input").addEventListener("keypress", (e) => {
    if (e.key === 'Enter') {
        e.preventDefault(); // Prevent default form submission if in a form
        document.getElementById("send-btn").click(); // Trigger send button click
    }
});

// Keyboard controls (WASD + Space)
// Keep track of the currently pressed movement key to avoid spamming commands
let currentMovementCommand = null;
document.addEventListener("keydown", (e) => {
    // Ignore if typing in input or textarea
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
        return;
    }

    let commandToSend = null;
    switch (e.key.toLowerCase()) {
        case "w":
            commandToSend = "forward";
            break;
        case "a":
            commandToSend = "left";
            break;
        case "s":
            commandToSend = "reverse";
            break;
        case "d":
            commandToSend = "right";
            break;
        case " ":
            e.preventDefault(); // prevent page scroll
            commandToSend = "stop";
            break;
        // Add other key bindings if needed, e.g., for audio start/stop
        // case "r": // Example for recording/streaming audio
        //     sendCommand("start_audio");
        //     break;
        // case "t": // Example for stopping audio
        //     sendCommand("stop_audio");
        //     break;
    }

    // Only send command if it's different from the last held movement command
    // This prevents spamming 'forward' while 'w' is held down, but sends 'stop' on space.
    if (commandToSend !== null) {
        if (commandToSend === 'stop' || currentMovementCommand !== commandToSend) {
            sendCommand(commandToSend);
            if (commandToSend !== 'stop') {
                currentMovementCommand = commandToSend;
            } else {
                currentMovementCommand = null; // Clear movement command after stop
            }
        }
    }
});

// Add a keyup listener to stop movement when a movement key is released
document.addEventListener("keyup", (e) => {
    // Ignore if typing in input or textarea
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
        return;
    }

    const releasedKey = e.key.toLowerCase();
    const movementKeys = ['w', 'a', 's', 'd'];

    if (movementKeys.includes(releasedKey)) {
        // If the released key is the one currently commanding movement, send stop
        // This helps stop the robot when the key is lifted
        if (currentMovementCommand !== null) {
            let shouldStop = false;
            switch(releasedKey) {
                case 'w': if (currentMovementCommand === 'forward') shouldStop = true; break;
                case 'a': if (currentMovementCommand === 'left') shouldStop = true; break;
                case 's': if (currentMovementCommand === 'reverse') shouldStop = true; break;
                case 'd': if (currentMovementCommand === 'right') shouldStop = true; break;
            }

            // This logic is slightly flawed for combinations (e.g., holding W+D and releasing D),
            // but is sufficient for basic WASD single presses.
            // A better state machine would track all held keys.

            if (currentMovementCommand !== null) {
                sendCommand("stop");
                currentMovementCommand = null; // Clear the current command state
            }
        }
    }
});

// Add message to the chat console
function appendMessage(sender, message) {
    const container = document.getElementById("chat-messages");
    const time = new Date().toLocaleTimeString();

    const msgDiv = document.createElement("div");
    msgDiv.classList.add("message", sender === "System" ? "system" : 
                                    (sender === "Server" ? "server" : 
                                    (sender === "You" ? "user" : "other"))); // Differentiate sender types

    const content = document.createElement("div");
    content.classList.add("message-content");
    content.innerHTML = `<strong>${sender}:</strong> ${message}`; // Use innerHTML for potentially formatted messages

    const timestamp = document.createElement("div");
    timestamp.classList.add("message-time");
    timestamp.textContent = time;

    msgDiv.appendChild(content);
    msgDiv.appendChild(timestamp);
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight; // Auto-scroll to the latest message
}

// --- Placeholder for UI element to show audio activity ---
// You can add an HTML element like <div id="audio-status"></div> to your page
function indicateAudioActivity() {
    const audioStatusDiv = document.getElementById("audio-status");
    if (audioStatusDiv) {
        audioStatusDiv.textContent = "Receiving Audio...";
        // Use CSS classes to animate or change color briefly
        audioStatusDiv.classList.add('active');
        setTimeout(() => {
            audioStatusDiv.classList.remove('active');
            audioStatusDiv.textContent = "Ready"; // Or blank, or a default status
        }, 200); // Flash the status for 200ms
    }
}

// Initial connection status display
if (ws.readyState === WebSocket.CONNECTING) {
    document.getElementById("connection-dot").style.backgroundColor = "orange";
    document.getElementById("connection-text").textContent = "Connecting...";
}

// Set the MJPEG stream source
document.getElementById('videoStream').src = `http://${SERVER_IP}:${HTTP_PORT}/mjpeg_stream`;

// Function to toggle microphone and send stereo audio
let micStream = null;
let micInputNode = null;
let micProcessor = null;

async function toggleMic() {
    const button = document.getElementById('startMic');
    if (micStream) {
        // Stop mic
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
        if (micInputNode) micInputNode.disconnect();
        if (micProcessor) micProcessor.disconnect();
        logMessage('Microphone stopped.');
        button.textContent = 'Start Mic';
    } else {
        // Start mic
        try {
            // Ensure audioContext is initialized with correct sample rate for sending stereo audio (44.1kHz)
            audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
            
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            micInputNode = audioContext.createMediaStreamSource(micStream);
            
            // Create a ScriptProcessorNode to get raw audio data
            // Buffer size, 2 input channels (stereo mic), 2 output channels (stereo to server)
            micProcessor = audioContext.createScriptProcessor(2048, 2, 2); 
            micInputNode.connect(micProcessor);
            micProcessor.connect(audioContext.destination); // Connect to speakers to hear yourself (optional)

            micProcessor.onaudioprocess = (event) => {
                const inputBuffer = event.inputBuffer;
                // Get stereo audio (left and right channels)
                const leftChannel = inputBuffer.getChannelData(0);
                const rightChannel = inputBuffer.getChannelData(1);

                // Interleave stereo 16-bit PCM samples
                const outputBuffer = new Int16Array(leftChannel.length * 2);
                for (let i = 0; i < leftChannel.length; i++) {
                    outputBuffer[2 * i] = Math.max(-32768, Math.min(32767, leftChannel[i] * 32767));  // Left channel
                    outputBuffer[2 * i + 1] = Math.max(-32768, Math.min(32767, rightChannel[i] * 32767)); // Right channel
                }
                
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(outputBuffer.buffer); // Send as ArrayBuffer (binary)
                }
            };
            logMessage('Microphone started. Sending stereo audio to server.');
            button.textContent = 'Stop Mic';
        } catch (err) {
            logMessage(`Error accessing microphone: ${err.message}`, true);
        }
    }
}

// Function to toggle speaker and play received mono audio
let speakerSourceNode = null; // For playing received mono audio from ESP32 DevKit
let speakerPlaybackNode = null; // For connecting mic input to speakers (optional, not used for received audio)
let speakerPlaying = false; // Flag for playing received audio

function toggleSpeaker() {
    const button = document.getElementById('startSpeaker');
    if (speakerPlaying) {
        speakerPlaying = false;
        // Stop any currently playing audio source if it exists
        if (speakerSourceNode) {
            speakerSourceNode.stop();
            speakerSourceNode.disconnect();
            speakerSourceNode = null;
        }
        logMessage('Speaker stopped.');
        button.textContent = 'Start Speaker';
    } else {
        speakerPlaying = true;
        // ESP32 mic sends 16kHz mono audio, so audioContext should be initialized for this rate
        // It's already initialized in initAudioContext with 16kHz for incoming audio.
        audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 }); 
        logMessage('Speaker started. Listening for mono audio from ESP32 DevKit.');
        button.textContent = 'Stop Speaker';
        processAudioQueue(); // Start/resume playing queued audio
    }
}