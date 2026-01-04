import React, { useEffect, useRef, useState } from 'react';
import { motion, useAnimation, useMotionValue, useTransform, AnimatePresence } from 'framer-motion';

// --- SVGs for Checks ---
const SingleCheck = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="msg-check single">
    <path d="M13.5 4.5L6.5 11.5L3 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const DoubleCheck = () => (
  <svg width="16" height="16" viewBox="0 0 20 16" fill="none" className="msg-check double">
    <path d="M13.5 4.5L6.5 11.5L3 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M17.5 4.5L10.5 11.5L8 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
  </svg>
);

const Message = ({ msg, user, setReplyTo, onContextMenu }) => {
  const isMe = msg.user === user;
  const controls = useAnimation();
  const x = useMotionValue(0);
  const opacity = useTransform(x, [-100, 0], [0, 1]); // Fade reply icon icon

  // Haptic Feedback Logic
  const handleDragEnd = (_, info) => {
    if (info.offset.x < -60) {
      // Trigger Reply
      if (navigator.vibrate) navigator.vibrate(10);
      setReplyTo(msg);
      controls.start({ x: 0 }); // Snap back
    } else {
      controls.start({ x: 0 }); // Snap back
    }
  };

  // Helper to detect RTL characters (Arabic, Persian, Hebrew)
  const isRTL = (text) => {
    const rtlChar = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
    return rtlChar.test(text);
  };

  // Spoiler Component
  const Spoiler = ({ text }) => {
    const [revealed, setRevealed] = useState(false);
    return (
      <span
        className={`spoiler ${revealed ? 'revealed' : ''}`}
        onClick={(e) => { e.stopPropagation(); setRevealed(true); }}
      >
        {text}
      </span>
    );
  };

  const parseText = (text) => {
    // Regex for ||spoiler||
    const parts = text.split(/(\|\|.*?\|\|)/g);
    return parts.map((part, index) => {
      if (part.startsWith('||') && part.endsWith('||')) {
        return <Spoiler key={index} text={part.slice(2, -2)} />;
      }
      return part;
    });
  };

  const renderContent = () => {
    switch (msg.type) {
      case 'image':
        return <img src={msg.msg} alt="attachment" className="msg-image" />;
      case 'video':
        return (
          <div className="video-msg-wrapper" style={{ position: 'relative', display: 'inline-block' }}>
            <video src={msg.msg} controls className="msg-video" />
            <a href={msg.msg} download className="video-download-btn">⬇</a>
          </div>
        );
      case 'audio':
        return <audio src={msg.msg} controls className="msg-audio" />;
      case 'file':
        const filename = msg.msg.split('/').pop().split('_').slice(2).join('_');
        return (
          <a href={msg.msg} target="_blank" rel="noopener noreferrer" className="msg-file">
            📄 {filename || 'Download File'}
          </a>
        );
      default:
        const direction = isRTL(msg.msg) ? 'rtl' : 'ltr';
        return (
          <div className="msg-text" style={{ direction: direction, textAlign: direction === 'rtl' ? 'right' : 'left' }}>
            {parseText(msg.msg)}
          </div>
        );
    }
  };

  return (
    <div className="message-row" style={{ display: 'flex', position: 'relative', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
      <motion.div
        className={`message ${isMe ? 'me' : 'other'} ${msg.type}`}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.5, right: 0 }}
        onDragEnd={handleDragEnd}
        animate={controls}
        whileDrag={{ scale: 0.98 }}
      >
        {/* Reply Icon (Hidden until swiped) */}
        <motion.div style={{ position: 'absolute', right: -40, top: '50%', y: '-50%', opacity: useTransform(x, [-60, 0], [1, 0]) }}>
          ↩
        </motion.div>

        {/* Reply Context - Telegram Style */}
        {msg.reply_context && (
          <div className="message-reply-context">
            <div className="reply-line"></div>
            <div className="reply-content">
              <div className="reply-author">Replying to</div>
              <div className="reply-text">
                {msg.reply_context.type === 'text' ? msg.reply_context.msg : `[${msg.reply_context.type}]`}
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="msg-content-wrapper">
          {renderContent()}
        </div>

        {/* Time & Checks */}
        <div className="msg-meta">
          <span className="msg-time">
            {new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {isMe && (
            <span className="msg-status">
              {/* Logic: Single Check (Sent) -> Double Check (Read). For now simulate generic Double Check */}
              <DoubleCheck />
            </span>
          )}
        </div>
      </motion.div>
    </div>
  );
};

const ChatWindow = ({ messages, user, setReplyTo, onLoadMore }) => {
  const chatWindowRef = useRef(null);
  const scrollSentinelRef = useRef(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Check if we should auto-scroll before updates
  const handleScroll = () => {
    if (chatWindowRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatWindowRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShouldAutoScroll(isNearBottom);

      // Infinite Scroll: Load more when near top
      if (scrollTop < 50 && !isLoadingHistory && messages.length > 0) {
        setIsLoadingHistory(true);
        // Find oldest message timestamp
        const oldestMsg = messages[0];
        if (oldestMsg && onLoadMore) {
          onLoadMore(oldestMsg.timestamp).finally(() => {
            setIsLoadingHistory(false);
          });
        }
      }
    }
  };

  // Effect to handle auto-scrolling
  useEffect(() => {
    if (shouldAutoScroll && scrollSentinelRef.current) {
      scrollSentinelRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, shouldAutoScroll]);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState(null); // { x, y, msg }

  const handleContextMenu = (e, msg) => {
    e.preventDefault();
    // Calculate position
    let x = e.clientX;
    let y = e.clientY;

    // Flip logic
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const menuW = 150;
    const menuH = 120;

    if (x + menuW > screenW) x = screenW - menuW - 10;
    if (y + menuH > screenH) y = screenH - menuH - 10;

    setContextMenu({ x, y, msg });
  };

  const closeContextMenu = () => setContextMenu(null);

  // Close context menu on click elsewhere
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  return (
    <div
      className="chat-window"
      ref={chatWindowRef}
      onScroll={handleScroll}
    >
      {isLoadingHistory && <div className="loading-history">Loading history...</div>}

      {messages.map((msg, index) => (
        <Message
          key={msg.id || `${msg.timestamp}-${index}`}
          msg={msg}
          user={user}
          setReplyTo={setReplyTo}
          onContextMenu={(e) => handleContextMenu(e, msg)}
        />
      ))}
      <div ref={scrollSentinelRef} className="chat-spacer"></div>

      {/* Custom Context Menu */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div
            className="custom-context-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <div className="menu-item" onClick={() => { setReplyTo(contextMenu.msg); closeContextMenu(); }}>↩ Reply</div>
            <div className="menu-item" onClick={() => { navigator.clipboard.writeText(contextMenu.msg.msg); closeContextMenu(); }}>📋 Copy</div>
            <div className="menu-item" onClick={() => closeContextMenu()}>✏️ Edit</div>
            <div className="menu-item" onClick={() => closeContextMenu()}>➡️ Forward</div>
            <div className="menu-item delete" onClick={() => closeContextMenu()}>🗑️ Delete</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ChatWindow;
