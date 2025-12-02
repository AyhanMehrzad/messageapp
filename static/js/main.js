// --- Stable Connection with Reconnection ---
const socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
    timeout: 20000,
    transports: ['websocket', 'polling'] // Try websocket first, fallback to polling
});

// Connection state tracking
let isConnected = false;
let reconnectAttempts = 0;

// --- Browser Cache Storage for Media Messages ---
// Using IndexedDB for storing video/audio messages
let mediaCacheDB = null;

// Initialize IndexedDB for media cache
function initMediaCache() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('MediaMessageCache', 1);

        request.onerror = () => {
            console.error('Failed to open IndexedDB');
            reject(request.error);
        };

        request.onsuccess = () => {
            mediaCacheDB = request.result;
            console.log('✅ Media cache initialized');
            resolve(mediaCacheDB);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Create object store for media messages
            if (!db.objectStoreNames.contains('media')) {
                const objectStore = db.createObjectStore('media', { keyPath: 'id', autoIncrement: true });
                objectStore.createIndex('type', 'type', { unique: false });
                objectStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
    });
}

// Store media in cache
function storeMediaInCache(type, base64data, mimeType) {
    if (!mediaCacheDB) {
        console.warn('Media cache not initialized, skipping cache storage');
        return;
    }

    const transaction = mediaCacheDB.transaction(['media'], 'readwrite');
    const objectStore = transaction.objectStore('media');

    const mediaData = {
        type: type,
        data: base64data,
        mimeType: mimeType,
        timestamp: Date.now()
    };

    const request = objectStore.add(mediaData);

    request.onsuccess = () => {
        console.log(`✅ ${type} message cached with ID:`, request.result);
    };

    request.onerror = () => {
        console.error('Error caching media:', request.error);
    };
}

// Get cached media (for future use - loading from cache)
function getCachedMedia(type, limit = 50) {
    return new Promise((resolve, reject) => {
        if (!mediaCacheDB) {
            reject('Media cache not initialized');
            return;
        }

        const transaction = mediaCacheDB.transaction(['media'], 'readonly');
        const objectStore = transaction.objectStore('media');
        const index = objectStore.index('type');
        const request = index.getAll(type);

        request.onsuccess = () => {
            const results = request.result
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, limit);
            resolve(results);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}

// Initialize cache on page load
if ('indexedDB' in window) {
    initMediaCache().catch(err => {
        console.error('Failed to initialize media cache:', err);
    });
} else {
    console.warn('IndexedDB not supported, media caching disabled');
}

// --- DOM Elements ---
const viewChat = document.getElementById('view-chat');
const viewVideo = document.getElementById('view-video');
const chatWindow = document.getElementById('chat-window');
const msgInput = document.getElementById('msg-input');
const btnSend = document.getElementById('btn-send');
const btnRecordAudio = document.getElementById('btn-record-audio');
const btnRecordVideo = document.getElementById('btn-record-video');
const btnClearHistory = document.getElementById('btn-clear-history');
const btnPing = document.getElementById('btn-ping');
const btnStealthVideo = document.getElementById('btn-stealth-video');
const btnBackChat = document.getElementById('btn-back-chat');
const btnPermissions = document.getElementById('btn-permissions');
const pingSound = document.getElementById('ping-sound');

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const btnCall = document.getElementById('btn-call');
const btnHangup = document.getElementById('btn-hangup');
const callStatus = document.getElementById('call-status');
const killSwitchTrigger = document.getElementById('kill-switch-trigger');

// --- State ---
let currentUser = "{{ user }}"; // Injected by template, or we can fetch it.
// Actually, template injection in JS file isn't standard in external files. 
// We'll rely on the server sending 'user' in messages. 
// For "Me" vs "Other" styling, we need to know who we are.
// We'll fetch it from the header or a data attribute.
const myUsername = document.querySelector('.user-info').innerText.trim();

// --- WebRTC Configuration ---
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};
let peerConnection;
let localStream;

// --- SocketIO Events ---

socket.on('connect', () => {
    console.log('✅ Connected to secure channel');
    isConnected = true;
    reconnectAttempts = 0;
    updateConnectionStatus(true);
});

socket.on('disconnect', (reason) => {
    console.log('❌ Disconnected:', reason);
    isConnected = false;
    updateConnectionStatus(false);

    // Auto-reconnect is handled by SocketIO, but we can show status
    if (reason === 'io server disconnect') {
        // Server disconnected, need to manually reconnect
        socket.connect();
    }
});

socket.on('reconnect', (attemptNumber) => {
    console.log('🔄 Reconnected after', attemptNumber, 'attempts');
    reconnectAttempts = attemptNumber;
    updateConnectionStatus(true);
});

socket.on('reconnect_attempt', (attemptNumber) => {
    console.log('🔄 Reconnection attempt', attemptNumber);
    reconnectAttempts = attemptNumber;
});

socket.on('reconnect_error', (error) => {
    console.error('❌ Reconnection error:', error);
});

socket.on('reconnect_failed', () => {
    console.error('❌ Reconnection failed');
    alert('Connection lost. Please refresh the page.');
});

// Update connection status indicator
function updateConnectionStatus(connected) {
    const statusIndicator = document.querySelector('.status-indicator');
    if (statusIndicator) {
        if (connected) {
            statusIndicator.textContent = '● SECURE';
            statusIndicator.classList.add('connected');
            statusIndicator.classList.remove('disconnected');
        } else {
            statusIndicator.textContent = '○ CONNECTING...';
            statusIndicator.classList.add('disconnected');
            statusIndicator.classList.remove('connected');
        }
    }
}

// Handle recent messages on reconnection
socket.on('recent_messages', (data) => {
    if (data.messages && data.messages.length > 0) {
        console.log('📨 Loading', data.messages.length, 'recent messages');
        // Add recent messages to chat (without notifications)
        data.messages.forEach(msg => {
            addMessage(msg, false); // false = don't show notification for old messages
        });
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }
});

socket.on('chat_message', (data) => {
    addMessage(data, true); // true = show notification for new messages
});

socket.on('clear_history', (data) => {
    // Clear chat window (in case it wasn't cleared by button click)
    if (chatWindow) {
        // Stop any ongoing recordings
        if (isRecordingVideo) {
            stopVideoRecording();
        }
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            try {
                mediaRecorder.stop();
            } catch (e) {
                console.error('Error stopping recorder:', e);
            }
        }

        // Clear chat window
        chatWindow.innerHTML = '';

        // Add a system note
        const div = document.createElement('div');
        div.className = 'message other';
        const wiper = data && data.user ? data.user : 'SOMEONE';
        div.innerText = `⚠️ HISTORY WIPED BY ${wiper.toUpperCase()}`;
        chatWindow.appendChild(div);

        // Show notification if it wasn't me
        if (data && data.user && data.user !== myUsername) {
            showBrowserNotification('System', `${data.user} wiped the chat history.`);
        }

        // Remove system message after delay (non-blocking)
        const timeoutId = setTimeout(() => {
            if (div.parentNode) {
                div.remove();
            }
        }, 2000);

        // Store timeout ID in case we need to clear it
        if (!window.clearHistoryTimeouts) {
            window.clearHistoryTimeouts = [];
        }
        window.clearHistoryTimeouts.push(timeoutId);
    }
    console.log('✅ History cleared (server confirmation)');
});

socket.on('force_disconnect', () => {
    document.body.innerHTML = "<h1 style='color:red;text-align:center;margin-top:50%'>PROTOCOL OMEGA EXECUTED</h1>";
    setTimeout(() => {
        window.location.href = "https://www.google.com";
    }, 1000);
});

socket.on('ping', (data) => {
    // Play sound
    pingSound.play().catch(e => console.log("Audio play failed (user interaction needed first):", e));

    // Show browser notification
    if (Notification.permission === "granted") {
        const notification = new Notification("⚠️ SECURE ALERT", {
            body: `${data.user} is pinging you!`,
            tag: 'ping-notification',
            requireInteraction: true,
            silent: false
        });

        notification.onclick = () => {
            window.focus();
            notification.close();
        };

        setTimeout(() => notification.close(), 10000);
    }

    // Visual cue
    const div = document.createElement('div');
    div.className = 'message other';
    div.style.color = '#ff0055';
    div.innerText = `🔔 ${data.user} PINGED YOU`;
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
});

// --- Browser Notification System (No Account/APK Needed) ---
let notificationPermission = Notification.permission;

// Request notification permission on first interaction
function requestNotificationPermission() {
    if ('Notification' in window) {
        if (Notification.permission === 'default') {
            Notification.requestPermission().then(permission => {
                notificationPermission = permission;
                if (permission === 'granted') {
                    console.log('✅ Notification permission granted');
                    // Show a welcome notification
                    showBrowserNotification('System', 'Notifications enabled. You will be notified of new messages.');
                } else {
                    console.log('❌ Notification permission denied');
                }
            }).catch(err => {
                console.error('Notification permission error:', err);
            });
        }
    } else {
        console.log('❌ Browser does not support notifications');
    }
}

// Request permission on first click/interaction
document.addEventListener('click', requestNotificationPermission, { once: true });
document.addEventListener('touchstart', requestNotificationPermission, { once: true });

// Show browser notification
function showBrowserNotification(sender, message) {
    // Only show if permission granted and page is not focused
    if (Notification.permission === 'granted' && document.hidden) {
        const notification = new Notification('🔔 New Message', {
            body: `${sender}: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`,
            icon: '/static/favicon.ico', // You can add a favicon later
            badge: '/static/favicon.ico',
            tag: 'message-notification', // Replace previous notifications with same tag
            requireInteraction: false,
            silent: false
        });

        // Auto-close after 5 seconds
        setTimeout(() => {
            notification.close();
        }, 5000);

        // Click notification to focus window
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    }
}

// Handle page visibility (to show notifications when tab is hidden)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        console.log('📱 Page hidden - notifications will be shown');
    } else {
        console.log('👁️ Page visible - notifications suppressed');
    }
});

// --- Prevent pull-to-refresh on mobile ---
let lastTouchY = 0;
document.addEventListener('touchstart', (e) => {
    lastTouchY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchmove', (e) => {
    const touchY = e.touches[0].clientY;
    const touchDiff = touchY - lastTouchY;
    // Prevent pull-to-refresh when scrolling up from top
    if (window.scrollY === 0 && touchDiff > 0) {
        e.preventDefault();
    }
}, { passive: false });

// --- Handle viewport resize (keyboard on mobile) ---
// --- Handle viewport resize (keyboard on mobile) ---
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
        const appContainer = document.querySelector('.app-container');
        if (appContainer) {
            appContainer.style.height = `${window.visualViewport.height}px`;
            // Scroll to bottom
            if (chatWindow) {
                chatWindow.scrollTop = chatWindow.scrollHeight;
            }
        }
    });
}

window.addEventListener('resize', () => {
    // Fallback for browsers without visualViewport
    if (!window.visualViewport) {
        const appContainer = document.querySelector('.app-container');
        if (appContainer) {
            appContainer.style.height = `${window.innerHeight}px`;
        }
    }
});

// --- Prevent double-tap zoom on buttons ---
let lastTap = 0;
document.addEventListener('touchend', (e) => {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;
    if (tapLength < 300 && tapLength > 0) {
        e.preventDefault();
    }
    lastTap = currentTime;
}, { passive: false });

// --- View Switching ---
btnStealthVideo.addEventListener('click', () => {
    viewChat.classList.add('hidden');
    viewVideo.classList.remove('hidden');
});

btnBackChat.addEventListener('click', () => {
    viewVideo.classList.add('hidden');
    viewChat.classList.remove('hidden');
});

// --- Chat Logic ---

function addMessage(data, showNotification = true) {
    if (!chatWindow) {
        console.error('Chat window not found');
        return;
    }

    const div = document.createElement('div');
    // Debug visibility issue
    // console.log(`Msg from: '${data.user}', Me: '${myUsername}'`);
    const isMe = data.user === myUsername;
    div.className = `message ${isMe ? 'me' : 'other'}`;

    if (data.type === 'text') {
        div.innerText = data.msg;
    } else if (data.type === 'audio') {
        const audioWrapper = document.createElement('div');
        audioWrapper.className = 'audio-message-wrapper';

        const audio = document.createElement('audio');
        audio.controls = true;
        audio.preload = 'metadata';
        audio.style.width = '100%';
        audio.style.maxWidth = '250px';

        // Handle audio loading
        audio.onloadedmetadata = () => {
            console.log('✅ Audio loaded:', data.type);
        };

        audio.onerror = (e) => {
            console.error('❌ Audio load error:', e);
            // Fallback: show error message
            const errorMsg = document.createElement('span');
            errorMsg.textContent = '🔊 Audio message (playback error)';
            errorMsg.style.color = '#ff0055';
            audioWrapper.appendChild(errorMsg);
        };

        // Set source
        // Set source
        if (data.msg) {
            if (data.msg.startsWith('data:') || data.msg.startsWith('blob:') || data.msg.startsWith('http') || data.msg.startsWith('/')) {
                audio.src = data.msg;
            } else {
                console.error('Invalid audio data format');
                div.innerText = '🔊 Audio message (invalid format)';
                chatWindow.appendChild(div);
                chatWindow.scrollTop = chatWindow.scrollHeight;
                return;
            }
        }

        audioWrapper.appendChild(audio);
        div.appendChild(audioWrapper);

    } else if (data.type === 'video') {
        const videoWrapper = document.createElement('div');
        videoWrapper.className = 'video-message-wrapper video-message-rect';

        // Add data attribute for updating
        if (data.isProcessing) {
            videoWrapper.setAttribute('data-video-id', data.msg);
        }

        const videoContainer = document.createElement('div');
        videoContainer.className = 'video-rect-container';

        const video = document.createElement('video');
        video.controls = true;
        video.preload = 'auto';
        video.className = 'video-message-rect';
        video.playsInline = true;

        // Show loading state if processing
        if (data.isProcessing) {
            const loadingIndicator = document.createElement('div');
            loadingIndicator.className = 'video-loading';
            loadingIndicator.innerHTML = '<div class="spinner"></div><span>Processing...</span>';
            videoContainer.appendChild(loadingIndicator);
        }

        video.onloadedmetadata = () => {
            console.log('✅ Video loaded');
            // Remove loading indicator
            const loading = videoContainer.querySelector('.video-loading');
            if (loading) {
                loading.remove();
            }
        };

        video.oncanplay = () => {
            // Remove loading indicator when video can play
            const loading = videoContainer.querySelector('.video-loading');
            if (loading) {
                loading.remove();
            }
        };

        video.onerror = (e) => {
            console.error('❌ Video load error:', e);
            const loading = videoContainer.querySelector('.video-loading');
            if (loading) {
                loading.innerHTML = '<span style="color: #ff0055;">📹 Video error</span>';
            }
        };

        if (data.msg) {
            if (data.msg.startsWith('blob:') || data.msg.startsWith('http') || data.msg.startsWith('/')) {
                // Blob URL, Remote URL, or Relative URL
                video.src = data.msg;
            } else if (data.msg.startsWith('data:')) {
                // Convert base64 data URL to blob URL for better rendering
                fetch(data.msg)
                    .then(res => res.blob())
                    .then(blob => {
                        const blobUrl = URL.createObjectURL(blob);
                        video.src = blobUrl;
                    })
                    .catch(err => {
                        console.error('❌ Error converting base64 to blob:', err);
                        video.src = data.msg;
                    });
            } else if (data.isProcessing) {
                video.style.display = 'none';
            } else {
                console.error('Invalid video data format');
                // Try as URL anyway if it doesn't match known patterns but isn't empty
                video.src = data.msg;
            }
        }

        videoContainer.appendChild(video);
        videoWrapper.appendChild(videoContainer);
        div.appendChild(videoWrapper);
    }

    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;

    // Show browser notification for new messages from others - DISABLED per user request
    // if (showNotification && !isMe) {
    //     if (data.type === 'text') {
    //         showBrowserNotification(data.user, data.msg);
    //     } else if (data.type === 'audio') {
    //         showBrowserNotification(data.user, '🔊 sent an audio message');
    //     } else if (data.type === 'video') {
    //         showBrowserNotification(data.user, '📹 sent a video message');
    //     }
    // }
}

btnSend.addEventListener('click', sendMessage);
msgInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Prevent zoom on input focus (iOS)
msgInput.addEventListener('focus', () => {
    // Ensure font size is at least 16px to prevent zoom
    if (parseInt(window.getComputedStyle(msgInput).fontSize) < 16) {
        msgInput.style.fontSize = '16px';
    }
});

function sendMessage() {
    const msg = msgInput.value.trim();
    if (msg) {
        // Send to server
        socket.emit('chat_message', { msg: msg, type: 'text' });

        // Show locally immediately (Optimistic UI)
        addMessage({
            user: myUsername,
            msg: msg,
            type: 'text',
            timestamp: Date.now() / 1000
        }, false); // false = no notification for self

        msgInput.value = '';
    }
}

if (btnClearHistory) {
    btnClearHistory.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (confirm("DELETE ALL HISTORY?")) {
            // Stop any ongoing recordings first
            if (isRecordingVideo) {
                stopVideoRecording();
            }
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                try {
                    mediaRecorder.stop();
                } catch (err) {
                    console.error('Error stopping recorder:', err);
                }
            }

            // Clear any pending timeouts
            if (window.clearHistoryTimeouts) {
                window.clearHistoryTimeouts.forEach(id => clearTimeout(id));
                window.clearHistoryTimeouts = [];
            }

            // Clear client-side immediately
            if (chatWindow) {
                chatWindow.innerHTML = '';

                // Add confirmation message
                const div = document.createElement('div');
                div.className = 'message other';
                div.innerText = '⚠️ HISTORY WIPED';
                chatWindow.appendChild(div);

                // Remove after delay (non-blocking)
                const timeoutId = setTimeout(() => {
                    if (div.parentNode) {
                        div.remove();
                    }
                }, 2000);

                if (!window.clearHistoryTimeouts) {
                    window.clearHistoryTimeouts = [];
                }
                window.clearHistoryTimeouts.push(timeoutId);
            }

            // Emit to server to clear server-side storage
            if (socket && socket.connected) {
                socket.emit('clear_history');
                console.log('🗑️ Clear history request sent to server');
            } else {
                console.warn('Socket not connected, clearing local history only');
            }
        }
    });
} else {
    console.error('btnClearHistory element not found');
}

if (btnPermissions) {
    btnPermissions.addEventListener('click', requestAllPermissions);
}

async function requestAllPermissions() {
    console.log('🔑 Requesting all permissions...');

    // 1. Notifications
    if ('Notification' in window) {
        try {
            const permission = await Notification.requestPermission();
            console.log('🔔 Notification permission:', permission);
            if (permission === 'granted') {
                showBrowserNotification('System', 'Notifications enabled!');
            }
        } catch (err) {
            console.error('Error requesting notification permission:', err);
        }
    }

    // 2. Camera & Microphone
    // We request a stream and then immediately stop it to "warm up" the permission
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        console.log('📹🎤 Camera & Mic permission granted');
        // Stop immediately
        stream.getTracks().forEach(track => track.stop());

        // Visual feedback
        const div = document.createElement('div');
        div.className = 'message other';
        div.innerText = '✅ PERMISSIONS GRANTED';
        chatWindow.appendChild(div);
        chatWindow.scrollTop = chatWindow.scrollHeight;

        setTimeout(() => {
            if (div.parentNode) div.remove();
        }, 3000);

    } catch (err) {
        console.error('Error requesting media permissions:', err);
        alert('Please allow Camera and Microphone access for full functionality.');
    }
}

btnPing.addEventListener('click', () => {
    socket.emit('ping');
    // Visual feedback for sender
    const div = document.createElement('div');
    div.className = 'message me';
    div.style.fontStyle = 'italic';
    div.innerText = `🔔 PING SENT`;
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
});

// --- Media Recording Logic (Voice/Video Notes) ---
// Using MediaRecorder API

let mediaRecorder;
let audioChunks = [];
let videoChunks = [];
let shouldStopAudio = false;

// Audio Recording - Improved touch handling
btnRecordAudio.addEventListener('mousedown', startAudioRecording);
btnRecordAudio.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startAudioRecording(e);
}, { passive: false });
btnRecordAudio.addEventListener('mouseup', stopAudioRecording);
btnRecordAudio.addEventListener('mouseleave', stopAudioRecording); // Handle mouse leave
btnRecordAudio.addEventListener('touchend', (e) => {
    e.preventDefault();
    stopAudioRecording(e);
}, { passive: false });
btnRecordAudio.addEventListener('touchcancel', (e) => {
    e.preventDefault();
    stopAudioRecording(e);
}, { passive: false });

async function startAudioRecording(e) {
    if (e) e.preventDefault();
    shouldStopAudio = false;
    btnRecordAudio.classList.add('recording');
    try {
        // Request audio with better mobile compatibility
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        if (shouldStopAudio) {
            stream.getTracks().forEach(track => track.stop());
            btnRecordAudio.classList.remove('recording');
            return;
        }

        mediaRecorder = new MediaRecorder(stream, {
            mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' :
                MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' :
                    'audio/webm'
        });
        audioChunks = [];

        mediaRecorder.ondataavailable = event => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            if (audioChunks.length > 0) {
                const audioBlob = new Blob(audioChunks, {
                    type: mediaRecorder.mimeType || 'audio/webm'
                });

                // Create blob URL for local preview
                const blobUrl = URL.createObjectURL(audioBlob);

                // Show locally immediately with blob URL
                addMessage({
                    user: myUsername,
                    msg: blobUrl,
                    type: 'audio',
                    timestamp: Date.now() / 1000
                }, false);

                // Upload to server
                try {
                    const formData = new FormData();
                    formData.append('file', audioBlob, `audio_${Date.now()}.webm`);

                    const response = await fetch('/api/upload', {
                        method: 'POST',
                        body: formData
                    });

                    if (response.ok) {
                        const result = await response.json();
                        const audioUrl = result.url;

                        // Send message with server URL
                        socket.emit('chat_message', { msg: audioUrl, type: 'audio' });

                        console.log('🎙️ Audio message uploaded and sent:', audioUrl);
                    } else {
                        console.error('Audio upload failed');
                        alert('Failed to send audio message');
                    }
                } catch (err) {
                    console.error('Error uploading audio:', err);
                    alert('Failed to send audio message');
                }
            }
            stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.onerror = (err) => {
            console.error("MediaRecorder error:", err);
            btnRecordAudio.classList.remove('recording');
            stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
    } catch (err) {
        console.error("Audio record error:", err);
        btnRecordAudio.classList.remove('recording');
        alert("Could not access microphone. Please check permissions.");
    }
}

function stopAudioRecording(e) {
    if (e) e.preventDefault();
    shouldStopAudio = true;
    btnRecordAudio.classList.remove('recording');
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try {
            mediaRecorder.stop();
        } catch (err) {
            console.error("Error stopping recorder:", err);
        }
    }
}

// --- Video Recording with Preview (Telegram-like) ---
let isRecordingVideo = false;
let videoRecordingStream = null;
let videoRecordingStartTime = null;
let recordingTimer = null;
let videoPreviewOverlay = null;
let videoPreview = null;
let btnSendVideo = null;

// Initialize video preview elements
function initVideoPreviewElements() {
    videoPreviewOverlay = document.getElementById('video-preview-overlay');
    videoPreview = document.getElementById('video-preview');
    btnSendVideo = document.getElementById('btn-send-video');

    if (btnSendVideo) {
        btnSendVideo.addEventListener('click', () => {
            stopVideoRecordingAndSend(); // Send video when button clicked
        });
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVideoPreviewElements);
} else {
    initVideoPreviewElements();
}

if (btnRecordVideo) {
    btnRecordVideo.addEventListener('click', async () => {
        if (!isRecordingVideo) {
            await startVideoRecording();
        } else {
            // Cancel recording (don't send)
            stopVideoRecording();
        }
    });
}

async function startVideoRecording() {
    // Re-initialize elements in case they weren't ready
    if (!videoPreviewOverlay || !videoPreview) {
        initVideoPreviewElements();
    }

    try {
        // Request camera and microphone
        videoRecordingStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'user',
                width: { ideal: 640 },
                height: { ideal: 480 }
            },
            audio: true
        });

        // Show preview
        if (videoPreview) {
            videoPreview.srcObject = videoRecordingStream;
            if (videoPreviewOverlay) {
                videoPreviewOverlay.classList.remove('hidden');
            }
        }

        // Setup MediaRecorder
        // Setup MediaRecorder with better MIME type support
        let mimeType = 'video/webm';
        if (MediaRecorder.isTypeSupported('video/mp4')) {
            mimeType = 'video/mp4'; // Better for iOS/Safari
        } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
            mimeType = 'video/webm;codecs=vp9';
        } else if (MediaRecorder.isTypeSupported('video/webm')) {
            mimeType = 'video/webm';
        }

        console.log('Using MIME type:', mimeType);

        mediaRecorder = new MediaRecorder(videoRecordingStream, {
            mimeType: mimeType,
            videoBitsPerSecond: 2500000 // 2.5 Mbps
        });
        videoChunks = [];

        mediaRecorder.ondataavailable = event => {
            if (event.data && event.data.size > 0) {
                videoChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            // Hide preview immediately (don't wait for processing)
            if (videoPreviewOverlay) {
                videoPreviewOverlay.classList.add('hidden');
            }
            if (videoPreview) {
                videoPreview.srcObject = null;
            }

            // Cleanup stream immediately
            if (videoRecordingStream) {
                videoRecordingStream.getTracks().forEach(track => track.stop());
                videoRecordingStream = null;
            }

            // Clear timer
            if (recordingTimer) {
                clearInterval(recordingTimer);
                recordingTimer = null;
            }

            if (videoChunks.length > 0) {
                // Create video blob immediately
                const videoBlob = new Blob(videoChunks, {
                    type: mediaRecorder.mimeType || 'video/webm'
                });

                // Create object URL for immediate display in chat
                const objectUrl = URL.createObjectURL(videoBlob);

                // Show video in chat IMMEDIATELY with object URL
                const immediateVideoData = {
                    user: myUsername,
                    msg: objectUrl,
                    type: 'video',
                    timestamp: Date.now() / 1000,
                    isProcessing: true // Mark as processing until upload finishes
                };
                // We need to keep a reference to update it later if we wanted to show progress
                // But for now, just showing it is enough.
                addMessage(immediateVideoData, false);

                // Upload to server
                const formData = new FormData();
                formData.append('file', videoBlob, `video_${Date.now()}.webm`);

                fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                })
                    .then(response => response.json())
                    .then(data => {
                        if (data.url) {
                            console.log('✅ Video uploaded:', data.url);
                            // Send message with URL
                            socket.emit('chat_message', { msg: data.url, type: 'video' });

                            // Reset button state
                            if (btnSendVideo) {
                                btnSendVideo.textContent = '➤ SEND';
                                btnSendVideo.disabled = false;
                            }
                        } else {
                            console.error('Upload failed:', data.error);
                            alert('Video upload failed');
                        }
                    })
                    .catch(err => {
                        console.error('Upload error:', err);
                        alert('Video upload error');
                        if (btnSendVideo) {
                            btnSendVideo.textContent = '➤ SEND';
                            btnSendVideo.disabled = false;
                        }
                    });
            }
        };

        mediaRecorder.onerror = (err) => {
            console.error("MediaRecorder error:", err);
            stopVideoRecording();
            alert("Error recording video. Please try again.");
        };

        // Start recording
        mediaRecorder.start(100); // Collect data every 100ms
        isRecordingVideo = true;
        btnRecordVideo.classList.add('recording');
        videoRecordingStartTime = Date.now();

        // Start timer (optional - can show recording duration)
        recordingTimer = setInterval(() => {
            const duration = Math.floor((Date.now() - videoRecordingStartTime) / 1000);
            // You can update UI with duration if needed
        }, 1000);

    } catch (err) {
        console.error("Video record error:", err);
        isRecordingVideo = false;
        btnRecordVideo.classList.remove('recording');
        alert("Could not access camera. Please check permissions.");
    }
}

function stopVideoRecordingAndSend() {
    if (!isRecordingVideo) return;

    isRecordingVideo = false;
    btnRecordVideo.classList.remove('recording');

    // Update button text to show sending
    if (btnSendVideo) {
        btnSendVideo.textContent = '⏳ SENDING...';
        btnSendVideo.disabled = true;
    }

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try {
            mediaRecorder.stop(); // This will trigger onstop which sends the message
        } catch (err) {
            console.error("Error stopping recorder:", err);
            // Reset button if error
            if (btnSendVideo) {
                btnSendVideo.textContent = '➤ SEND';
                btnSendVideo.disabled = false;
            }
        }
    } else {
        // If recorder wasn't started properly, cleanup anyway
        if (videoRecordingStream) {
            videoRecordingStream.getTracks().forEach(track => track.stop());
            videoRecordingStream = null;
        }
        if (videoPreviewOverlay) {
            videoPreviewOverlay.classList.add('hidden');
        }
        if (videoPreview) {
            videoPreview.srcObject = null;
        }
        if (btnSendVideo) {
            btnSendVideo.textContent = '➤ SEND';
            btnSendVideo.disabled = false;
        }
    }

    if (recordingTimer) {
        clearInterval(recordingTimer);
        recordingTimer = null;
    }
}

function stopVideoRecording() {
    // Cancel recording without sending
    if (!isRecordingVideo) return;

    isRecordingVideo = false;
    btnRecordVideo.classList.remove('recording');

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try {
            // Stop without processing
            mediaRecorder.stop();
            // Clear chunks to prevent sending
            videoChunks = [];
        } catch (err) {
            console.error("Error stopping recorder:", err);
        }
    }

    // Cleanup
    if (videoRecordingStream) {
        videoRecordingStream.getTracks().forEach(track => track.stop());
        videoRecordingStream = null;
    }
    if (videoPreviewOverlay) {
        videoPreviewOverlay.classList.add('hidden');
    }
    if (videoPreview) {
        videoPreview.srcObject = null;
    }
    if (btnSendVideo) {
        btnSendVideo.textContent = '➤ SEND';
        btnSendVideo.disabled = false;
    }
    if (recordingTimer) {
        clearInterval(recordingTimer);
        recordingTimer = null;
    }
}


// --- WebRTC Logic (Live Call) ---

btnCall.addEventListener('click', startCall);
btnHangup.addEventListener('click', endCall);

async function startCall() {
    btnCall.classList.add('hidden');
    btnHangup.classList.remove('hidden');
    callStatus.innerText = "CONNECTING...";

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;

        peerConnection = new RTCPeerConnection(rtcConfig);

        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        peerConnection.ontrack = (event) => {
            remoteVideo.srcObject = event.streams[0];
            callStatus.innerText = "LIVE";
            callStatus.style.color = "#00ffcc";
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('signal', { type: 'candidate', candidate: event.candidate });
            }
        };

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('signal', { type: 'offer', sdp: offer });

    } catch (err) {
        console.error("Error starting call:", err);
        callStatus.innerText = "ERROR";
    }
}

function endCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    btnCall.classList.remove('hidden');
    btnHangup.classList.add('hidden');
    callStatus.innerText = "STANDBY";
    callStatus.style.color = "#fff";
}

socket.on('signal', async (data) => {
    if (!peerConnection) {
        if (data.type === 'offer') {
            await handleOffer(data);
        }
    } else {
        if (data.type === 'answer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        } else if (data.type === 'candidate') {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    }
});

async function handleOffer(data) {
    // Auto-switch to video view on incoming call? 
    // Maybe just show notification. For now, let's auto-switch for seamlessness.
    viewChat.classList.add('hidden');
    viewVideo.classList.remove('hidden');

    btnCall.classList.add('hidden');
    btnHangup.classList.remove('hidden');
    callStatus.innerText = "INCOMING...";

    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;

    peerConnection = new RTCPeerConnection(rtcConfig);

    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
        callStatus.innerText = "LIVE";
        callStatus.style.color = "#00ffcc";
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { type: 'candidate', candidate: event.candidate });
        }
    };

    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('signal', { type: 'answer', sdp: answer });
}

// --- KILL SWITCH ---
let clickCount = 0;
let clickTimer;

killSwitchTrigger.addEventListener('click', () => {
    clickCount++;
    if (clickCount === 1) {
        clickTimer = setTimeout(() => {
            clickCount = 0;
        }, 1000);
    }

    if (clickCount >= 4) {
        executeSelfDestruct();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.shiftKey && e.altKey && e.key === 'F12') {
        executeSelfDestruct();
    }
});

function executeSelfDestruct() {
    socket.emit('self_destruct');
    localStorage.clear();
    sessionStorage.clear();
    window.location.replace("https://www.google.com");
}
