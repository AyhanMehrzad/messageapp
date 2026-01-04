import os
import time
import asyncio
import subprocess
import urllib.parse
import urllib.request
from datetime import datetime
from typing import List, Optional

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, UploadFile, File, Form, Depends, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
import socketio

from message_store import MessageStore

# --- Configuration ---
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

TELEGRAM_BOT_TOKEN = "8536507693:AAHebjRYhiXcQQ6LqtNwCeqotzXO15iLfOU"
USER_TELEGRAM_MAPPING = {
    "ayhan": "8004922440",
    "sana": "7116732902"
}

# --- Dependencies ---
message_store = MessageStore()

# --- FastAPI App ---
app = FastAPI()

# CORS
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://0.0.0.0:3001",
    "http://localhost:3002",
    "http://127.0.0.1:3002",
    "http://0.0.0.0:3002",
    "https://securechanel.xyz",
    "https://www.securechanel.xyz"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Async SocketIO Server
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins=origins,
    ping_timeout=60,
    ping_interval=25,
    max_http_buffer_size=50 * 1024 * 1024
)

# Mount Static & Templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# --- Helpers ---
async def send_telegram_notification(chat_id: str, message: str):
    """Async Telegram notification with proxy support"""
    status_file = "/dev/shm/tg_proxy_status"
    proxy_url = None
    
    if os.path.exists(status_file):
        try:
            with open(status_file, "r") as f:
                proxy_url = f.read().strip()
        except:
            proxy_url = os.environ.get('TELEGRAM_PROXY')
    else:
        proxy_url = os.environ.get('TELEGRAM_PROXY')

    print(f"DEBUG: Attempting Telegram notification to {chat_id} (Proxy: {proxy_url if proxy_url else 'None'})")
    
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        params = urllib.parse.urlencode({'chat_id': chat_id, 'text': message})
        full_url = f"{url}?{params}"
        
        # We use a run_in_executor for the blocking urllib call or could use httpx/aiohttp
        # For minimal dep change, wrap urllib
        def _request():
            if proxy_url:
                proxy_handler = urllib.request.ProxyHandler({'http': proxy_url, 'https': proxy_url})
                opener = urllib.request.build_opener(proxy_handler)
            else:
                opener = urllib.request.build_opener()
            
            with opener.open(full_url, timeout=10) as response:
                return response.read().decode()

        loop = asyncio.get_event_loop()
        res_body = await loop.run_in_executor(None, _request)
        print(f"DEBUG: Telegram API Success for {chat_id}: {res_body}")
        return True
            
    except Exception as e:
        print(f"DEBUG: Telegram notification FAILED for {chat_id}: {e}")
        return False

# --- Active User Management (SocketIO) ---
# {sid: username}
active_sessions = {}

# --- Routes ---

@app.get("/", response_class=HTMLResponse)
async def login_page(request: Request):
    """Legacy login page / React App Container"""
    # Check if this is an API content negotiation
    if request.headers.get("accept") == "application/json":
         user = request.session.get("user") # Starlette sessions? 
         # Note: FastAPI doesn't have built-in session middleware enabled by default unless we add SessionMiddleware.
         # For transition compatibility, we might need SessionMiddleware or just rely on Client Logic.
         # Since React App manages state, let's keep it simple.
         # For simplicity in this refactor, we are moving to Token/Client-side auth or just trusting the Login POST.
         pass
    
    return templates.TemplateResponse("index.html", {"request": request})

@app.post("/")
async def login_post(request: Request):
    """Handle Login POST"""
    # Need to parse form data
    form = await request.form()
    username = form.get("username")
    password = form.get("password")
    
    # Hardcoded users from app.py
    users = {
        "sana": "13851208",
        "ayhan": "512683"
    }

    if username in users and users[username] == password:
        # Success
        if request.headers.get("accept") == "application/json":
            response = JSONResponse({"status": "success", "user": username})
            response.set_cookie(key="user", value=username, httponly=False) # HttpOnly False for now if JS needs it, but usage is implicit
            return response
        # For browser submit, we would set a cookie. 
        # But wait, the previous app used Flask sessions (signed cookies).
        # We should use starlette SessionMiddleware if we want to mimic that exactly.
        # OR, since we are moving to React-first, we return JSON/Redirect.
        response = RedirectResponse(url="/dashboard", status_code=303)
        response.set_cookie(key="user", value=username) # Simple cookie for now
        return response
    
    if request.headers.get("accept") == "application/json":
        return JSONResponse({"error": "Invalid Credentials"}, status_code=401)
    
    # Return to login with error?
    return templates.TemplateResponse("index.html", {"request": request, "error": "Invalid Credentials"})

@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard(request: Request):
    user = request.cookies.get("user")
    if not user:
        return RedirectResponse(url="/")
    return templates.TemplateResponse("index.html", {"request": request, "user": user})

@app.get("/logout")
async def logout():
    response = RedirectResponse(url="/")
    response.delete_cookie("user")
    return response

@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "timestamp": str(datetime.now())}

@app.delete("/api/chat/{chat_id}/clear")
async def clear_chat_history(chat_id: str):
    """
    Clear history for a specific chat ID.
    """
    # Assuming user check via cookie for simplicity as in other routes
    # In a real app, use proper dependency injection for auth
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, message_store.clear_all)
    await sio.emit('clear_history', {'user': 'System'}, room='secure_channel')
    return {"status": "success", "message": "Chat history cleared"}

# --- API Routes ---

@app.get("/api/user")
async def api_user(request: Request):
    user = request.cookies.get("user")
    if not user:
         return JSONResponse({"error": "Unauthorized"}, status_code=401)
    return {"username": user, "is_authenticated": True}

@app.get("/api/messages/recent")
async def get_recent_messages(request: Request, limit: int = 50):
    user = request.cookies.get("user")
    if not user:
         return JSONResponse({"error": "Unauthorized"}, status_code=401)
    
    # Run sync DB call in threadpool
    loop = asyncio.get_event_loop()
    messages = await loop.run_in_executor(None, message_store.get_recent_messages, limit)
    return {"messages": messages}

@app.get("/api/messages/before")
async def get_messages_before(request: Request, before: float, limit: int = 50):
    user = request.cookies.get("user")
    if not user:
         return JSONResponse({"error": "Unauthorized"}, status_code=401)
    
    loop = asyncio.get_event_loop()
    messages = await loop.run_in_executor(None, message_store.get_messages_before, before, limit)
    return {"messages": messages}

@app.post("/api/upload")
async def upload_file(request: Request, file: UploadFile = File(...)):
    user = request.cookies.get("user")
    if not user:
         return JSONResponse({"error": "Unauthorized"}, status_code=401)
    
    filename = f"{int(time.time())}_{os.urandom(4).hex()}_{file.filename}"
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    
    try:
        async with aiofiles.open(filepath, 'wb') as out_file:
            content = await file.read()
            await out_file.write(content)
        
        url = f"/static/uploads/{filename}"
        return {"url": url, "filename": filename}
    except Exception as e:
        print(f"Upload error: {e}")
        return JSONResponse({"error": "Upload failed"}, status_code=500)

# --- WebSocket Video Stream (FastAPI Native) ---
@app.websocket("/ws/chat/stream")
async def websocket_stream(websocket: WebSocket):
    await websocket.accept()
    
    # We can try to get user from cookie
    user = websocket.cookies.get("user", "Unknown")
    
    filename = f"vid_{int(time.time())}_{os.urandom(4).hex()}.mp4"
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    
    # FFmpeg command for circular crop (square output)
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
    
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    print(f"Starting generic stream: {filename}")
    
    try:
        while True:
            data = await websocket.receive_bytes()
            if not data:
                break
            # Write to ffmpeg sync stdin (blocking but short)
            # For high perf, maybe use asyncio subprocess, but piped stdin write is tricky async
            try:
                process.stdin.write(data)
            except BrokenPipeError:
                break
    except WebSocketDisconnect:
        print("Stream disconnected")
    except Exception as e:
        print(f"Stream error: {e}")
    finally:
        if process:
            process.stdin.close()
            process.wait()
            
        # Notify via SocketIO if file exists
        if os.path.exists(filepath) and os.path.getsize(filepath) > 0:
            url = f"/static/uploads/{filename}"
            timestamp = time.time()
            
            # Save to DB
            loop = asyncio.get_event_loop()
            msg_id = await loop.run_in_executor(None, message_store.save_message, user, url, 'video', timestamp, None)
            
            message_data = {
                'id': msg_id,
                'user': user,
                'msg': url,
                'type': 'video',
                'timestamp': timestamp,
                'reply_to': None,
                'reply_context': None
            }
            
            await sio.emit('chat_message', message_data, room='secure_channel')
            print(f"Video note processed and sent: {filename}")

# --- SocketIO Events ---

@sio.event
async def connect(sid, environ):
    # Retrieve cookies from environ?
    # environ is ASGI scope
    # Parsing headers manually or trusting client-side logic
    # For now, we will handle auth by `socket.emit('join', {user: ...})` or just trust cookies if wrapped
    # The previous logic relied on Flask Session.
    # We can't easily access Flask Session here.
    # We'll rely on a "authenticate" event or just check if cookie exists in headers
    print(f"Socket connected: {sid}")
    
    # Hacky cookie parse
    headers = dict(environ.get('headers', []))
    cookie_header = headers.get(b'cookie', b'').decode()
    user = "Unknown"
    if "user=" in cookie_header:
        # Very simple parse
        parts = cookie_header.split(';')
        for part in parts:
            if "user=" in part:
                 user = part.split("user=")[1].strip()
    
    if user == "Unknown":
        # Maybe reject? Or wait for specific login packet?
        # Let's allow but require identification?
        pass
    else:
        active_sessions[sid] = user
        sio.enter_room(sid, 'secure_channel')
        
        loop = asyncio.get_event_loop()
        recent_messages = await loop.run_in_executor(None, message_store.get_recent_messages, 20)
        await sio.emit('recent_messages', {'messages': recent_messages}, to=sid)
        
        await sio.emit('system_message', {'msg': f'{user} connected.'}, room='secure_channel')

@sio.event
async def disconnect(sid):
    if sid in active_sessions:
        user = active_sessions[sid]
        del active_sessions[sid]
        await sio.emit('system_message', {'msg': f'{user} disconnected.'}, room='secure_channel')
    print(f"Socket disconnected: {sid}")

@sio.event
async def chat_message(sid, data):
    user = active_sessions.get(sid, 'Unknown')
    msg_text = data.get('msg', '')
    msg_type = data.get('type', 'text')
    reply_to = data.get('reply_to')
    timestamp = time.time()
    
    loop = asyncio.get_event_loop()
    msg_id = None
    if msg_text:
        msg_id = await loop.run_in_executor(
            None, message_store.save_message,
            user, msg_text, msg_type, timestamp, reply_to
        )
    
    reply_context = None
    if reply_to:
        reply_context = await loop.run_in_executor(None, message_store.get_message_by_id, reply_to)
        
    message_data = {
        'id': msg_id,
        'user': user,
        'msg': msg_text,
        'type': msg_type,
        'timestamp': timestamp,
        'reply_to': reply_to,
        'reply_context': reply_context
    }
    
    await sio.emit('chat_message', message_data, room='secure_channel')

@sio.event
async def ping(sid):
    sender = active_sessions.get(sid, 'Unknown')
    print(f"Ping from {sender}")
    recipient = "sana" if sender == "ayhan" else "ayhan"
    recipient_tg_id = USER_TELEGRAM_MAPPING.get(recipient)
    
    if recipient_tg_id:
        asyncio.create_task(send_telegram_notification(recipient_tg_id, "dont forget to study your lessons"))
        # Trigger FCM PING (Placeholder)
        asyncio.create_task(send_fcm_notification(recipient))
        
    await sio.emit('ping', {'user': sender}, room='secure_channel', skip_sid=sid)

async def send_fcm_notification(recipient: str):
    """Placeholder for FCM Ping Notification"""
    print(f"DEBUG: Sending FCM PING to {recipient} (Stub)")
    return

@sio.event
async def clear_history(sid):
    user = active_sessions.get(sid, 'Unknown')
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, message_store.clear_all)
    await sio.emit('clear_history', {'user': user}, room='secure_channel')

@sio.event
async def signal(sid, data):
    await sio.emit('signal', data, room='secure_channel', skip_sid=sid)

# --- App Assemble ---
# Mount SocketIO App
app_asgi = socketio.ASGIApp(sio, app)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app_asgi, host="0.0.0.0", port=3001)
