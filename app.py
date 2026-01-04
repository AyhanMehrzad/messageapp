import os
import time
import threading
import urllib.request
import urllib.parse
import json
from datetime import datetime, timedelta
from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room, disconnect
from flask_cors import CORS
from flask_sock import Sock
from message_store import MessageStore
from notification_manager import NotificationManager
from pywebpush import webpush, WebPushException
import subprocess

# --- VAPID KEYS ---
VAPID_PRIVATE_KEY = "4vwtQqLRBgbRRvozry3Wqrz9meVtBqcEpahasFoOqf4"
VAPID_CLAIMS = {
    "sub": "mailto:admin@securechanel.xyz"
}

app = Flask(__name__)
sock = Sock(app)
# Enable CORS for React dev server (port 3000) interacting with Flask (port 5000)
CORS(app, resources={r"/*": {"origins": ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3002", "http://127.0.0.1:3002", "http://0.0.0.0:3002", "https://securechanel.xyz", "https://www.securechanel.xyz"]}}, supports_credentials=True)

app.config['SECRET_KEY'] = os.urandom(24)
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB limit

# Ensure upload directory exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
socketio = SocketIO(
    app, 
    cors_allowed_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3002", "http://127.0.0.1:3002", "http://0.0.0.0:3002", "https://securechanel.xyz", "https://www.securechanel.xyz"],
    max_http_buffer_size=50 * 1024 * 1024,  # 50MB for large video files
    ping_timeout=60,  # Increase timeout for large file transfers
    ping_interval=25,  # Keep default ping interval
    async_mode='eventlet'  # Use eventlet for better async support
)

# --- In-Memory Storage (For Prototype / Stealth) ---
# In a real production scenario with multiple workers, use Redis.
users = {
    "sana": "13851208",
    "ayhan": "512683"
}

# Active sessions: {session_id: username}
active_sessions = {}

# Blocked IPs: {ip_address: expiry_timestamp}
blocked_ips = {}

# Message Storage (500MB limit with auto-cleanup)
# Message Storage (500MB limit with auto-cleanup)
message_store = MessageStore()
notification_manager = NotificationManager()

# --- Telegram Notification Settings ---
TELEGRAM_BOT_TOKEN = "8536507693:AAHebjRYhiXcQQ6LqtNwCeqotzXO15iLfOU"
USER_TELEGRAM_MAPPING = {
    "ayhan": "8004922440",
    "sana": "7116732902"
}

def send_telegram_notification(chat_id, message):
    """Send a telegram notification with dynamic proxy support from proxy_manager"""
    status_file = "/dev/shm/tg_proxy_status"
    proxy_url = None
    
    if os.path.exists(status_file):
        try:
            with open(status_file, "r") as f:
                proxy_url = f.read().strip()
                # If the manager is running but found nothing, we should honor that
                # and not fallback to a potentially broken environment variable
        except:
            proxy_url = os.environ.get('TELEGRAM_PROXY')
    else:
        proxy_url = os.environ.get('TELEGRAM_PROXY')

    print(f"DEBUG: Attempting Telegram notification to {chat_id} (Proxy: {proxy_url if proxy_url else 'None'})")
    
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        params = urllib.parse.urlencode({'chat_id': chat_id, 'text': message})
        full_url = f"{url}?{params}"
        
        # Configure proxy if available
        if proxy_url:
            proxy_handler = urllib.request.ProxyHandler({'http': proxy_url, 'https': proxy_url})
            opener = urllib.request.build_opener(proxy_handler)
        else:
            opener = urllib.request.build_opener()
            
        with opener.open(full_url, timeout=10) as response:
            res_body = response.read().decode()
            print(f"DEBUG: Telegram API Success for {chat_id}: {res_body}")
            return True
            
    except Exception as e:
        print(f"DEBUG: Telegram notification FAILED for {chat_id}: {e}")
        # If it failed and we were using a proxy, maybe the proxy is dead
        # The proxy_manager will handle rotation, but we should tell the frontend
        return False

def threaded_telegram_send(chat_id, message, sid):
    success = send_telegram_notification(chat_id, message)
    if not success:
        # Notify the specific user that the notification failed
        socketio.emit('ping_error', {'msg': 'Telegram service is currently unavailable or filtered.'}, room=sid)

def send_web_push(username, message_data):
    """Send Web Push Notification to offline user"""
    subscriptions = notification_manager.get_subscriptions(username)
    if not subscriptions:
        print(f"DEBUG: No push subscriptions found for {username}")
        return

    payload = json.dumps({
        "title": f"New message from {message_data.get('user', 'Someone')}",
        "body": message_data.get('msg', 'Sent a file'),
        "url": "/" 
    })

    print(f"DEBUG: Sending Web Push to {len(subscriptions)} endpoints for {username}")
    
    for sub in subscriptions:
        try:
            webpush(
                subscription_info=sub,
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=VAPID_CLAIMS
            )
        except WebPushException as ex:
            print(f"Web Push Failed: {ex}")
            # If 410 Gone, remove subscription
            if ex.response and ex.response.status_code == 410:
                notification_manager.remove_subscription(sub['endpoint'])
        except Exception as e:
            print(f"General Push Error: {e}")

# --- Middleware / Helpers ---

def is_blocked(ip):
    if ip in blocked_ips:
        if datetime.now() < blocked_ips[ip]:
            return True
        else:
            del blocked_ips[ip]
    return False

def block_ip(ip, duration_minutes=5):
    blocked_ips[ip] = datetime.now() + timedelta(minutes=duration_minutes)

@app.before_request
def check_block():
    if is_blocked(request.remote_addr):
        return "Service Unavailable", 503

# --- Routes ---

@app.route('/', methods=['GET', 'POST'])
def login():
    # Helper to check if it's an API call/JSON request
    if request.headers.get('Accept') == 'application/json' and request.method == 'GET':
         if 'user' in session:
             return jsonify({'status': 'logged_in', 'user': session['user']})
         return jsonify({'error': 'Unauthorized'}), 401

    # For normal browser access, always serve the React App on GET
    if request.method == 'GET':
        return render_template('index.html')

    # Handle Login POST (used by React App)
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        if username in users and users[username] == password:
            session['user'] = username
            if request.headers.get('Accept') == 'application/json':
                return jsonify({'status': 'success', 'user': username})
            return redirect(url_for('dashboard'))
        else:
            if request.headers.get('Accept') == 'application/json':
                return jsonify({'error': 'Invalid Credentials'}), 401
            # If not JSON, we can't render login.html anymore as it's legacy. 
            # But the React app handles the response. 
            return jsonify({'error': 'Invalid Credentials'}), 401
            
    # Fallback for HEAD or other methods
    return render_template('index.html')


@app.route('/dashboard')
def dashboard():
    if 'user' not in session:
        return redirect(url_for('login'))
    return render_template('index.html', user=session['user'])

@app.route('/logout')
def logout():
    session.pop('user', None)
    return redirect(url_for('login'))

# --- API Routes ---

@app.route('/api/health')
def health_check():
    """Health check endpoint for monitoring"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'active_sessions': len(active_sessions),
        'blocked_ips': len([ip for ip, expiry in blocked_ips.items() if datetime.now() < expiry])
    }), 200

@app.route('/api/status')
def api_status():
    """Get current application status"""
    if 'user' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    db_stats = message_store.get_stats()
    
    return jsonify({
        'user': session['user'],
        'active_sessions': len(active_sessions),
        'connected_users': list(set(active_sessions.values())),
        'timestamp': datetime.now().isoformat(),
        'message_store': {
            'message_count': db_stats['message_count'],
            'size_mb': round(db_stats['size_mb'], 2),
            'max_size_mb': db_stats['max_size_mb']
        }
    }), 200

@app.route('/api/user')
def api_user():
    """Get current user information"""
    if 'user' not in session:
        return jsonify({'error': 'Unauthorized'}), 401 
    
    return jsonify({
        'username': session['user'],
        'is_authenticated': True
    }), 200


@app.route('/api/messages/recent')
def get_recent_messages():
    """Get recent messages (for reconnection/recovery)"""
    if 'user' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    limit = request.args.get('limit', 50, type=int)
    messages = message_store.get_recent_messages(limit=limit)
    return jsonify({'messages': messages}), 200

@app.route('/api/messages/paginated')
def get_paginated_messages():
    """Get messages with pagination support"""
    if 'user' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    limit = request.args.get('limit', 50, type=int)
    offset = request.args.get('offset', 0, type=int)
    messages = message_store.get_messages_paginated(limit=limit, offset=offset)
    return jsonify({'messages': messages, 'limit': limit, 'offset': offset}), 200

@app.route('/api/messages/before')
def get_messages_before():
    """Get messages before a specific timestamp"""
    if 'user' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    before_timestamp = request.args.get('before', type=float)
    if not before_timestamp:
        return jsonify({'error': 'Missing before parameter'}), 400
    
    limit = request.args.get('limit', 50, type=int)
    messages = message_store.get_messages_before(before_timestamp, limit=limit)
    return jsonify({'messages': messages, 'has_more': len(messages) == limit}), 200

@app.route('/api/messages/<int:message_id>')
def get_message(message_id):
    """Get a specific message by ID"""
    if 'user' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    message = message_store.get_message_by_id(message_id)
    if message:
        return jsonify({'message': message}), 200
    return jsonify({'error': 'Message not found'}), 404

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """Handle file uploads (video/audio)"""
    if 'user' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
        
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
        
    if file:
        # Generate unique filename
        filename = f"{int(time.time())}_{os.urandom(4).hex()}_{file.filename}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        try:
            file.save(filepath)
            # Return URL relative to static
            url = url_for('static', filename=f'uploads/{filename}')
            return jsonify({'url': url, 'filename': filename}), 200
        except Exception as e:
            print(f"Upload error: {e}")
            print(f"Upload error: {e}")
            return jsonify({'error': 'Upload failed'}), 500

@app.route('/api/subscribe', methods=['POST'])
def subscribe_push():
    """Handle Web Push Subscriptions"""
    if 'user' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.json
    subscription = data.get('subscription')
    user_agent = data.get('user_agent', '')
    
    if not subscription:
        return jsonify({'error': 'Missing subscription'}), 400

    success = notification_manager.add_subscription(session['user'], subscription, user_agent)
    if success:
        return jsonify({'status': 'success'}), 200
    return jsonify({'error': 'Failed to save subscription'}), 500

@sock.route('/ws/chat/stream')
def handle_stream(ws):
    """
    Handle streaming video chunks via WebSocket (flask-sock).
    Pipes data directly to ffmpeg to create a square, circular-cropped MP4.
    """
    # Simple authentication check (could be robustified)
    # Since flask-sock runs in request context, we can access session?
    # NOTE: flask-sock websockets might not always share session cookies easily 
    # if valid credentials aren't passed. For now, we assume if they can connect, they are good,
    # or we can pass a token in the query string.
    # Let's rely on session being available if possible, or skip for prototype.
    
    # Generate filename
    filename = f"vid_{int(time.time())}_{os.urandom(4).hex()}.mp4"
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    
    # FFmpeg command:
    # 1. -i - : Read from stdin
    # 2. -vf ... : Crop to square (min dimension), scale to 640x640 suitable for circular mask
    # 3. -c:v libx264 -preset superfast ... : Encode to MP4
    # 4. -f mp4 pipe:1 : Output to pipe? No, we want to write to file directly for safety/broadcasting.
    # Actually, let's write to file directly.
    
    command = [
        'ffmpeg',
        '-i', '-',
        '-vf', "crop='min(iw,ih)':'min(iw,ih)',scale=640:640,format=yuv420p",
        '-c:v', 'libx264',
        '-preset', 'superfast',
        '-movflags', '+faststart',
        '-y',
        filepath
    ]
    
    print(f"Starting legacy recording stream: {filename}")
    
    process = None
    try:
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=subprocess.PIPE) # stderr for logs if needed
        
        while True:
            chunk = ws.receive()
            if chunk is None:
                break
            try:
                process.stdin.write(chunk)
            except BrokenPipeError:
                print("FFmpeg process ended unexpectedly")
                break
                
    except Exception as e:
        print(f"Streaming error: {e}")
    finally:
        if process:
            try:
                process.stdin.close()
                process.wait()
            except:
                pass
                
        # Access user from session if available, else anonymous/default
        username = session.get('user', 'Unknown')
        
        # Verify file exists and is valid
        if os.path.exists(filepath) and os.path.getsize(filepath) > 0:
            url = url_for('static', filename=f'uploads/{filename}')
            
            # Broadcast the message via SocketIO
            # We need to construct the message data manually since we are outside the standard HTTP flow
            timestamp = time.time()
            message_id = message_store.save_message(username, url, 'video', timestamp)
            
            message_data = {
                'id': message_id,
                'user': username,
                'msg': url,
                'type': 'video',
                'timestamp': timestamp,
                'reply_to': None,
                'reply_context': None
            }
            
            # Use external socketio emit 
            socketio.emit('chat_message', message_data, room='secure_channel')
            print(f"Video note sent: {filename}")
        else:
            print("Video note failed: output file empty or missing")

# --- SocketIO Events ---

@socketio.on('connect')
def on_connect():
    if 'user' not in session:
        return False  # Reject connection
    
    username = session['user']
    active_sessions[request.sid] = username
    join_room('secure_channel')
    
    # Send recent messages for reconnection
    recent_messages = message_store.get_recent_messages(limit=20)
    emit('recent_messages', {'messages': recent_messages})
    
    emit('system_message', {'msg': f'{username} connected.'}, room='secure_channel')
    print(f"User {username} connected with SID {request.sid}")

@socketio.on('disconnect')
def on_disconnect():
    if request.sid in active_sessions:
        username = active_sessions[request.sid]
        del active_sessions[request.sid]
        emit('system_message', {'msg': f'{username} disconnected.'}, room='secure_channel')


@socketio.on('chat_message')
def handle_message(data):
    # Data structure: { 'msg': '...', 'type': 'text'|'audio'|'video', 'reply_to': <id> }
    username = active_sessions.get(request.sid, 'Unknown')
    message_text = data.get('msg', '')
    message_type = data.get('type', 'text')
    reply_to = data.get('reply_to', None)
    timestamp = time.time()
    
    # Save message to storage
    message_id = None
    if message_text:
        message_id = message_store.save_message(username, message_text, message_type, timestamp, reply_to)
    
    # Fetch reply context if replying to a message
    reply_context = None
    if reply_to:
        reply_context = message_store.get_message_by_id(reply_to)
    
    # Broadcast to all clients
    message_data = {
        'id': message_id,
        'user': username,
        'msg': message_text,
        'type': message_type,
        'timestamp': timestamp,
        'reply_to': reply_to,
        'reply_context': reply_context
    }
    
    emit('chat_message', message_data, room='secure_channel', include_self=True)

    # --- HYBRID NOTIFICATION LOGIC ---
    # Check if recipient is connected. Since we are in a group room 'secure_channel',
    # we iterate over potential recipients (hardcoded logic for 2-user prototype)
    sender = username
    recipient = "sana" if sender == "ayhan" else "ayhan" # Logic for 2-user demo
    
    # Check if recipient is online
    recipient_online = any(u == recipient for u in active_sessions.values())
    
    if not recipient_online:
         print(f"DEBUG: {recipient} is OFFLINE. Triggering Web Push.")
         # Send Web Push
         threading.Thread(target=send_web_push, args=(recipient, message_data)).start()


@socketio.on('clear_history')
def handle_clear_history():
    try:
        username = active_sessions.get(request.sid, 'Unknown')
        # Clear server-side storage
        message_store.clear_all()
        # Broadcast command to clear client-side history
        emit('clear_history', {'user': username}, room='secure_channel')
        print(f"History cleared by {username}")
    except Exception as e:
        print(f"Error clearing history: {e}")
        emit('error', {'msg': 'Failed to clear history'}, room=request.sid)

@socketio.on('ping')
def handle_ping():
    sender = active_sessions.get(request.sid, 'Unknown')
    print(f"DEBUG: Received ping request from {sender} (SID: {request.sid})")
    # Determine the recipient (the other user in this two-user app)
    recipient = "sana" if sender == "ayhan" else "ayhan"
    
    # Send telegram message to the recipient's registered ID
    recipient_tg_id = USER_TELEGRAM_MAPPING.get(recipient)
    if recipient_tg_id:
        print(f"DEBUG: Triggering Telegram notification for recipient: {recipient} (ID: {recipient_tg_id})")
        # Run in a thread with proxy-aware helper
        threading.Thread(target=threaded_telegram_send, 
                         args=(recipient_tg_id, "dont forget to study your lessons", request.sid)).start()
        
        # Trigger FCM PING (Background Task)
        threading.Thread(target=threaded_fcm_ping, args=(recipient,)).start()

        # Trigger Web Push for Ping
        ping_data = {'user': sender, 'msg': '📌 PINGED YOU!'}
        threading.Thread(target=send_web_push, args=(recipient, ping_data)).start()
    else:
        print(f"DEBUG: No Telegram ID found for recipient: {recipient}")
                         
    emit('ping', {'user': sender}, room='secure_channel', include_self=False)

def threaded_fcm_ping(recipient):
    """
    Placeholder for FCM Ping Notification.
    In a real implementation, you would use firebase-admin SDK here.
    """
    print(f"DEBUG: Sending FCM PING to {recipient} (Stub)")
    # Example:
    # message = messaging.Message(
    #     data={'type': 'PING', 'timestamp': str(time.time())},
    #     token=recipient_fcm_token,
    # )
    # messaging.send(message)
    return

@app.route('/api/chat/<chat_id>/clear', methods=['DELETE'])
def clear_chat_history(chat_id):
    """
    Clear history for a specific chat ID.
    Currently maps to global clear_all() as we only have one channel 'secure_channel'.
    """
    if 'user' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    # In a multi-chat app, we would filter by chat_id.
    # For now, we assume chat_id refers to the active room.
    try:
        message_store.clear_all()
        # Broadcast via SocketIO that history is cleared
        socketio.emit('clear_history', {'user': session['user']}, room='secure_channel')
        return jsonify({'status': 'success', 'message': 'Chat history cleared'}), 200
    except Exception as e:
        print(f"Error clearing chat via API: {e}")
        return jsonify({'error': 'Failed to clear chat'}), 500

# --- WebRTC Signaling ---
@socketio.on('signal')
def handle_signal(data):
    # Relay signaling data (SDP, candidates) to other peers
    # We broadcast to everyone else in the room (which is just the other agent)
    emit('signal', data, room='secure_channel', include_self=False)

# --- SELF DESTRUCT ---
@socketio.on('self_destruct')
def handle_self_destruct():
    ip = request.remote_addr
    print(f"!!! SELF DESTRUCT TRIGGERED BY {ip} !!!")
    
    # 1. Block the IP
    block_ip(ip, duration_minutes=5)
    
    # 2. Clear all server-side session data and messages
    active_sessions.clear()
    message_store.clear_all()
    
    # 3. Force disconnect everyone
    socketio.emit('force_disconnect', {'reason': 'PROTOCOL_OMEGA'})
    disconnect() 

if __name__ == '__main__':
    # SSL Context would be added here for production: ssl_context=('cert.pem', 'key.pem')
    socketio.run(app, host='0.0.0.0', port=3002, debug=False)
