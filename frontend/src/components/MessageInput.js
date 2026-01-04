import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const MessageInput = forwardRef(({ onSend, onSocketAction }, ref) => {
    const [text, setText] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const [recordingType, setRecordingType] = useState(null); // 'audio' | 'video'
    const [recordingTime, setRecordingTime] = useState(0);
    const [isUploading, setIsUploading] = useState(false);
    const [facingMode, setFacingMode] = useState('user');

    const textareaRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const chunksRef = useRef([]);
    const timerRef = useRef(null);
    const fileInputRef = useRef(null);

    // Video Refs
    const videoSourceRef = useRef(null); // Hidden video element for raw stream
    const canvasRef = useRef(null);      // Canvas for processing/displaying
    const streamRef = useRef(null);      // Current active stream (audio+video or audio)
    const animationFrameRef = useRef(null);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
        }
    }, [text]);

    const websocketRef = useRef(null);

    useImperativeHandle(ref, () => ({
        stopHardware: () => {
            cancelRecording();
            cleanupMedia();
        }
    }));

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            cleanupMedia();
        };
    }, []);

    const cleanupMedia = useCallback(() => {
        // 1. Stop all tracks in the active stream
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }

        // 2. Stop the video source element to release hardware
        if (videoSourceRef.current) {
            videoSourceRef.current.pause();
            videoSourceRef.current.srcObject = null;
        }

        // 3. Stop animation frame
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }

        // 4. Close WebSocket if open
        if (websocketRef.current) {
            websocketRef.current.close();
            websocketRef.current = null;
        }
    }, []);

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleSend = () => {
        if (text.trim()) {
            onSend(text);
            setText('');
            if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
                textareaRef.current.focus();
            }
        }
    };

    const drawCanvas = () => {
        if (videoSourceRef.current && canvasRef.current && !videoSourceRef.current.paused && !videoSourceRef.current.ended) {
            const ctx = canvasRef.current.getContext('2d');
            // Draw video to canvas
            ctx.drawImage(videoSourceRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
            animationFrameRef.current = requestAnimationFrame(drawCanvas);
        }
    };

    const getSupportedMimeType = () => {
        const types = ['video/mp4', 'video/webm;codecs=h264', 'video/webm'];
        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) {
                return type;
            }
        }
        return 'video/webm';
    };

    const startRecording = async (type) => {
        try {
            cleanupMedia(); // Ensure clean slate

            let recorderStream;
            let mimeType = 'audio/webm'; // Default

            // Setup Stream
            if (type === 'video') {
                const constraints = {
                    video: { facingMode: facingMode },
                    audio: true
                };

                const rawStream = await navigator.mediaDevices.getUserMedia(constraints);
                streamRef.current = rawStream;

                // Setup Canvas for Preview
                if (canvasRef.current && videoSourceRef.current) {
                    videoSourceRef.current.srcObject = rawStream;
                    await videoSourceRef.current.play();

                    // Set canvas size to match video
                    canvasRef.current.width = videoSourceRef.current.videoWidth;
                    canvasRef.current.height = videoSourceRef.current.videoHeight;

                    // Start Drawing Loop
                    drawCanvas();

                    // Use the RAW stream for recording to avoid mirror affects?
                    // actually, the user wants "Smart Mirroring (No Reversing)".
                    // "Capture the raw, un-mirrored stream in MediaRecorder."
                    // So we use 'rawStream' directly if possible?
                    // But we used canvas before. Let's stick to canvas captureStream for consistency if we were drawing effects,
                    // BUT, if we draw raw video to canvas, canvas is raw.
                    // We only flip the canvas VIEW with CSS.
                    // So 'canvasStream' IS raw/unmirrored. Correct.

                    const canvasStream = canvasRef.current.captureStream(30);

                    // Add audio track from raw stream
                    const audioTrack = rawStream.getAudioTracks()[0];
                    if (audioTrack) {
                        canvasStream.addTrack(audioTrack);
                    }

                    recorderStream = canvasStream;
                    mimeType = getSupportedMimeType();
                }
            } else {
                // Audio Only
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                streamRef.current = stream;
                recorderStream = stream;
                mimeType = 'audio/webm';
            }

            // Setup MediaRecorder
            const mediaRecorder = new MediaRecorder(recorderStream, { mimeType });
            mediaRecorderRef.current = mediaRecorder;

            // Setup WebSocket for Streaming
            if (type === 'video') {
                // Detect protocol
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const host = window.location.host; // includes port
                const wsUrl = `${protocol}//${host}/ws/chat/stream`;

                const ws = new WebSocket(wsUrl);
                websocketRef.current = ws;

                ws.onopen = () => {
                    console.log('Video Stream Connected');
                    mediaRecorder.start(100); // 100ms chunks
                };

                ws.onerror = (e) => {
                    console.error('WebSocket Error', e);
                    // Fallback or alert?
                };

                mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
                        ws.send(e.data);
                    }
                };

                mediaRecorder.onstop = () => {
                    // Close WS
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.close();
                    }
                    cleanupMedia();
                };

            } else {
                // Audio legacy upload flow
                chunksRef.current = [];
                mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) chunksRef.current.push(e.data);
                };
                mediaRecorder.onstop = () => {
                    const blob = new Blob(chunksRef.current, { type: mimeType });
                    uploadFile(blob, type, 'webm');
                    cleanupMedia();
                };
                mediaRecorder.start();
            }

            setIsRecording(true);
            setRecordingType(type);
            setRecordingTime(0);

            timerRef.current = setInterval(() => {
                setRecordingTime(prev => prev + 1);
            }, 1000);

        } catch (err) {
            console.error("Error accessing media devices:", err);
            alert("Could not access camera/microphone. Please check permissions.");
        }
    };

    const switchCamera = async () => {
        if (recordingType === 'video' && streamRef.current) {
            const newMode = facingMode === 'user' ? 'environment' : 'user';
            setFacingMode(newMode);

            try {
                // 1. Get new video stream
                const newStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: newMode }
                });

                // 2. Update Video Element (source for canvas)
                const oldVideoTrack = streamRef.current.getVideoTracks()[0];
                if (oldVideoTrack) oldVideoTrack.stop(); // Stop old camera

                videoSourceRef.current.srcObject = newStream;
                await videoSourceRef.current.play();

                // Add new track to tracking ref so it gets cleaned up
                // Note: The 'recorderStream' from canvas keeps working because it grabs the canvas pixels
                const newVideoTrack = newStream.getVideoTracks()[0];
                streamRef.current.addTrack(newVideoTrack);
                streamRef.current.removeTrack(oldVideoTrack);

            } catch (err) {
                console.error("Error switching camera:", err);
            }
        }
    };


    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            setRecordingType(null);
            clearInterval(timerRef.current);
        }
    };

    const cancelRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.onstop = null; // Prevent upload
            mediaRecorderRef.current.stop();
            cleanupMedia();
            setIsRecording(false);
            setRecordingType(null);
            clearInterval(timerRef.current);
        }
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            let type = 'file';
            let ext = file.name.split('.').pop(); // Simple extension extraction
            if (file.type.startsWith('image/')) type = 'image';
            else if (file.type.startsWith('video/')) type = 'video';
            else if (file.type.startsWith('audio/')) type = 'audio';

            uploadFile(file, type, ext);
        }
    };

    const uploadFile = async (fileBlob, type, ext = 'webm') => {
        setIsUploading(true);
        const formData = new FormData();
        const filename = type === 'image' ? (fileBlob.name || 'image.png') : `recording.${ext}`;
        // If fileBlob has a name (from input), use it if type isn't generic
        const finalName = fileBlob.name || filename;

        formData.append('file', fileBlob, finalName);

        // This is where we could assume the backend detects type. 
        // For video messages, we send it as a file upload.
        // App.js / ChatWindow needs to know if it's "video" or "file".
        // The backend `upload_file` returns a URL.
        // We then emit a message with type.

        try {
            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (data.url) {
                // Send as message
                onSend({ msg: data.url, type: type });
            }
        } catch (err) {
            console.error("Upload failed", err);
            alert("Upload failed.");
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const formatTime = (seconds) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    // Emoji Helper
    const addEmoji = (emoji) => {
        setText(prev => prev + emoji);
    };

    // --- Gesture Engine State ---
    const [mediaMode, setMediaMode] = useState('audio'); // 'audio' | 'video'
    const gestureStartTime = useRef(0);
    const longPressTimer = useRef(null);
    const isLocked = useRef(false);
    const startY = useRef(0);
    const startX = useRef(0);

    // Dynamic Morphing Variants
    const iconVariants = {
        initial: { scale: 0.8, rotate: -90, opacity: 0 },
        animate: { scale: 1, rotate: 0, opacity: 1 },
        exit: { scale: 0.8, rotate: 90, opacity: 0 },
        tap: { scale: 0.9 }
    };

    // --- Gesture Handlers ---
    const handlePointerDown = (e) => {
        gestureStartTime.current = Date.now();
        isLocked.current = false;
        startY.current = e.clientY;
        startX.current = e.clientX;

        // Start Long Press Timer
        longPressTimer.current = setTimeout(() => {
            // Trigger Recording
            startRecording(mediaMode);
        }, 200); // 200ms threshold
    };

    const handlePointerUp = (e) => {
        clearTimeout(longPressTimer.current);
        const duration = Date.now() - gestureStartTime.current;

        if (isRecording) {
            if (!isLocked.current) {
                stopRecording(); // Send
            }
        } else {
            if (duration < 200) {
                // Tap: Toggle Mode
                setMediaMode(prev => prev === 'audio' ? 'video' : 'audio');
            }
        }
    };

    const handlePointerMove = (e) => {
        if (!isRecording || isLocked.current) return;

        const deltaY = startY.current - e.clientY; // Up is positive
        const deltaX = startX.current - e.clientX; // Left is positive

        // Lock Logic (Swipe Up)
        if (deltaY > 60) {
            isLocked.current = true;
            // Visual Feedback for Lock?
        }

        // Cancel Logic (Swipe Left)
        if (deltaX > 60) {
            cancelRecording();
        }
    };

    // --- RENDER ---

    return (
        <div className="message-input-stack">
            {/* Recording Overlay */}
            <AnimatePresence>
                {isRecording && (
                    <motion.div
                        className="input-container recording-mode"
                        initial={{ opacity: 0, y: 50 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 50 }}
                    >
                        {/* Hidden Video Source for Canvas */}
                        <video
                            ref={videoSourceRef}
                            style={{ display: 'none' }}
                            playsInline
                            muted
                            autoPlay
                        />

                        {/* Video Preview - Circular Pulse */}
                        {recordingType === 'video' && (
                            <div className="video-preview-circle-container">
                                <canvas
                                    ref={canvasRef}
                                    className="video-preview-feed-circle"
                                    style={{
                                        transform: facingMode === 'user' ? 'scaleX(-1)' : 'none',
                                    }}
                                />
                                <div className="recording-pulse-border"></div>
                            </div>
                        )}

                        <div className="recording-status">
                            <span className="rec-dot"></span>
                            <span className="rec-time">{formatTime(recordingTime)}</span>
                            {isLocked.current && <span className="rec-locked">🔒 Locked</span>}
                        </div>

                        <div className="recording-controls">
                            <button className="btn-cancel-rec" onClick={cancelRecording}>Cancel</button>
                            <button className="btn-send-rec" onClick={stopRecording}>Stop & Send</button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {!isRecording && (
                <div className="input-pill-container" style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', width: '100%', maxWidth: '700px', margin: '0 auto' }}>

                    <div className="input-pill-box" style={{
                        flex: 1,
                        background: '#fff',
                        borderRadius: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        padding: '6px 12px',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                    }}>
                        {/* Attachment / Bot Menu (MOVED INSIDE) */}
                        <AnimatePresence mode="wait">
                            {text.startsWith('/') ? (
                                <motion.button
                                    key="bot-cmd"
                                    className="pin-btn bot-cmd-btn"
                                    onClick={() => {/* Open Bot Menu */ }}
                                    initial={{ scale: 0, rotate: -180 }}
                                    animate={{ scale: 1, rotate: 0 }}
                                    exit={{ scale: 0, rotate: 180 }}
                                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                                    style={{ color: '#3390ec', marginRight: '8px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px' }}
                                >
                                    🤖
                                </motion.button>
                            ) : (
                                <motion.button
                                    key="attach"
                                    className="pin-btn"
                                    onClick={() => fileInputRef.current.click()}
                                    whileTap={{ scale: 0.9 }}
                                    initial={{ scale: 0, rotate: 180 }}
                                    animate={{ scale: 1, rotate: 0 }}
                                    exit={{ scale: 0, rotate: -180 }}
                                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                                    style={{ color: '#707579', marginRight: '8px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '22px' }}
                                >
                                    📎
                                </motion.button>
                            )}
                        </AnimatePresence>

                        <textarea
                            ref={textareaRef}
                            className="input-field-pill"
                            placeholder="Message"
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            rows={1}
                            disabled={isUploading}
                            style={{ flex: 1, border: 'none', outline: 'none', resize: 'none', fontSize: '16px', maxHeight: '100px', padding: '4px 0', fontFamily: 'inherit' }}
                        />

                        {/* Emoji Icon (NEW) */}
                        <button
                            className="emoji-btn"
                            onClick={() => {/* Toggle Emoji Picker */ }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '22px', marginLeft: '8px', color: '#707579' }}
                        >
                            😊
                        </button>
                    </div>

                    {/* Morphing Send/Mic Button (MOVED OUTSIDE) */}
                    <div className="action-btn-circle" style={{ width: '48px', height: '48px', flexShrink: 0 }}>
                        <AnimatePresence mode="popLayout">
                            {text.trim() ? (
                                <motion.button
                                    key="send"
                                    className="send-btn-pill"
                                    onClick={handleSend}
                                    variants={iconVariants}
                                    initial="initial"
                                    animate="animate"
                                    exit="exit"
                                    whileTap="tap"
                                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                                    style={{
                                        width: '100%', height: '100%', borderRadius: '50%',
                                        background: '#3390ec', color: '#fff', border: 'none',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        cursor: 'pointer', fontSize: '20px'
                                    }}
                                >
                                    ➤
                                </motion.button>
                            ) : (
                                <motion.div
                                    key="media"
                                    className="media-gesture-btn"
                                    onPointerDown={handlePointerDown}
                                    onPointerUp={handlePointerUp}
                                    onPointerMove={handlePointerMove}
                                    onPointerLeave={cancelRecording} // Safety
                                    variants={iconVariants}
                                    initial="initial"
                                    animate="animate"
                                    exit="exit"
                                    whileTap="tap"
                                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                                    style={{
                                        width: '100%', height: '100%', borderRadius: '50%',
                                        background: '#f5f5f5', color: '#707579', // Telegram-style grey circle? Or maybe transparent if default
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        cursor: 'pointer', fontSize: '24px'
                                    }}
                                >
                                    {mediaMode === 'audio' ? '🎤' : '📹'}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            )}

            {/* Hidden File Input */}
            <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={handleFileChange}
                accept="image/*,video/*,audio/*"
            />
        </div>
    );
});

export default MessageInput;
