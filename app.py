import os
import time
import threading
from datetime import datetime, timedelta
from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room, disconnect
from flask_cors import CORS
from message_store import MessageStore

app = Flask(__name__)
# Enable CORS for React dev server (port 3000) interacting with Flask (port 5000)
CORS(app, resources={r"/*": {"origins": ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5000", "http://127.0.0.1:5000", "http://0.0.0.0:5000", "https://securechanel.xyz", "https://www.securechanel.xyz"]}}, supports_credentials=True)

app.config['SECRET_KEY'] = os.urandom(24)
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB limit

# Ensure upload directory exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
socketio = SocketIO(
    app, 
    cors_allowed_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5000", "http://127.0.0.1:5000", "http://0.0.0.0:5000", "https://securechanel.xyz", "https://www.securechanel.xyz"],
    max_http_buffer_size=50 * 1024 * 1024,  # 50MB for large video files
    ping_timeout=60,  # Increase timeout for large file transfers
    ping_interval=25,  # Keep default ping interval
    async_mode='eventlet'  # Use eventlet for better async support
)

# --- In-Memory Storage (For Prototype / Stealth) ---
# In a real production scenario with multiple workers, use Redis.
users = {
    "sana": "512683",
    "ayhan": "512683"
}

# Active sessions: {session_id: username}
active_sessions = {}

# Blocked IPs: {ip_address: expiry_timestamp}
blocked_ips = {}

# Message Storage (500MB limit with auto-cleanup)
message_store = MessageStore()

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
    if request.headers.get('Accept') == 'application/json':
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
            return jsonify({'error': 'Upload failed'}), 500

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
    emit('ping', {'user': active_sessions.get(request.sid, 'Unknown')}, room='secure_channel', include_self=False)

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
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
