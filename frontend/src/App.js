import React, { useState, useEffect, lazy, Suspense, useCallback, useRef } from 'react';
import { registerPushNotifications, sendSubscriptionToBackend } from './utils/pushNotifications';
import { io } from 'socket.io-client';
import './App.css';

const Header = lazy(() => import('./components/Header'));
const ChatWindow = lazy(() => import('./components/ChatWindow'));
const MessageInput = lazy(() => import('./components/MessageInput'));
const ReplyPreview = lazy(() => import('./components/ReplyPreview'));
const Login = lazy(() => import('./components/Login'));
const PermissionModal = lazy(() => import('./components/PermissionModal'));

// Initialize socket connection
const BACKEND_URL = window.location.origin; // Use current origin (works for both dev and prod)
const socket = io(BACKEND_URL, {
  transports: ['websocket'], // Force websocket only for better performance
  reconnection: true,
  withCredentials: true,
  path: '/socket.io',
  autoConnect: false
});

function App() {
  const [view, setView] = useState('chat'); // 'chat' | 'exit'
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [replyTo, setReplyTo] = useState(null);
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [loading, setLoading] = useState(true);
  const messageInputRef = useRef(null);

  useEffect(() => {
    // 1. Check Authentication via API
    fetch('/api/user')
      .then(res => {
        if (res.status === 401) {
          setLoading(false);
          return null;
        }
        return res.json();
      })
      .then(data => {
        if (data && data.username) {
          setUser(data.username);
          // Connect socket now that we have a user
          if (!socket.connected) {
            socket.connect();
          }
          // Register for Push Notifications
          registerPushNotifications().then(subscription => {
            if (subscription) {
              sendSubscriptionToBackend(subscription, data.username);
            }
          });
        }
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch user:", err);
        setLoading(false);
      });

    // 2. Socket Listeners
    const onConnect = () => {
      console.log('✅ Socket Connected');
      setIsConnected(true);
    };

    const onDisconnect = () => {
      console.log('❌ Socket Disconnected');
      setIsConnected(false);
    };

    const onChatMessage = (msg) => {
      console.log('📩 New Message Received:', msg);
      setMessages((prev) => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    };

    const onRecentMessages = (data) => {
      if (data.messages) {
        setMessages(data.messages);
      }
    };

    const onPing = (data) => {
      // Simple visual feedback for ping
      const sender = data.user || 'Someone';
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
      alert(`🔔 ${sender} pinged you!`);
    };

    const onPingError = (data) => {
      alert(`⚠️ ${data.msg || 'Telegram service is currently down.'}`);
    };

    const onClearHistory = (data) => {
      const user = data.user || 'Someone';
      setMessages([]); // Clear local messages
      console.log(`🗑️ History cleared by ${user}`);
    };

    const onHeaderAction = (e) => {
      const { action } = e.detail;
      if (action === 'ping') {
        socket.emit('ping');
      }
    };

    window.addEventListener('header-action', onHeaderAction);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('chat_message', onChatMessage);
    socket.on('recent_messages', onRecentMessages);
    socket.on('ping', onPing);
    socket.on('clear_history', onClearHistory);
    socket.on('ping_error', onPingError);

    return () => {
      window.removeEventListener('header-action', onHeaderAction);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('chat_message', onChatMessage);
      socket.off('recent_messages', onRecentMessages);
      socket.off('ping', onPing);
      socket.off('clear_history', onClearHistory);
      socket.off('ping_error', onPingError);
    };
  }, []);

  const sendMessage = (content) => {
    // Content can be string (legacy) or object {msg, type}
    let msgText = '';
    let msgType = 'text';

    if (typeof content === 'string') {
      msgText = content;
    } else {
      msgText = content.msg;
      msgType = content.type;
    }

    if (!msgText) return;

    socket.emit('chat_message', {
      msg: msgText,
      type: msgType,
      reply_to: replyTo ? replyTo.id : null
    });

    setReplyTo(null);
  };

  const loadMoreMessages = useCallback(async (oldestTimestamp) => {
    try {
      const res = await fetch(`/api/messages/before?before=${oldestTimestamp}&limit=20`);
      if (res.ok) {
        const data = await res.json();
        if (data.messages && data.messages.length > 0) {
          setMessages(prev => [...data.messages, ...prev]);
        }
      }
    } catch (err) {
      console.error("Error loading history:", err);
    }
  }, []);

  if (loading) {
    return <div className="loading-indicator"><div className="loading-spinner"></div>INITIALIZING...</div>;
  }

  // View Switching
  if (view === 'exit') {
    return (
      <div className="exit-screen">
        <div className="exit-content">
          <h1>Goodbye, {user}!</h1>
          <p>You have left the chat.</p>
          <button className="btn-rejoin" onClick={() => window.location.reload()}>Rejoin</button>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Suspense fallback={<div className="loading-indicator">LOADING UI...</div>}>
        <Login />
      </Suspense>
    );
  }



  return (
    <div className="app-container">
      <Suspense fallback={<div className="loading-indicator"><div className="loading-spinner"></div>ESTABLISHING LINK...</div>}>
        <PermissionModal onComplete={() => console.log("Permissions flow complete")} />
        <Header
          user={user}
          isConnected={isConnected}
          onStopHardware={() => {
            console.log("Stopping hardware via Header action");
            if (messageInputRef.current) {
              messageInputRef.current.stopHardware();
            }
          }}
        />

        <ChatWindow
          messages={messages}
          user={user}
          setReplyTo={setReplyTo}
          onLoadMore={loadMoreMessages}
        />

        {/* Stacked Layout Wrapper */}
        <div className="bottom-stack-wrapper">
          {replyTo && (
            <ReplyPreview
              replyTo={replyTo}
              onClose={() => setReplyTo(null)}
            />
          )}

          <MessageInput
            ref={messageInputRef}
            onSend={sendMessage}
            onSocketAction={(action) => {
              if (action === 'ping') socket.emit('ping');
              if (action === 'clear') socket.emit('clear_history');
              if (action === 'exit') setView('exit');
            }}
          />
        </div>
      </Suspense>
    </div>
  );
}

export default App;
