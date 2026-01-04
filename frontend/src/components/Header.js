import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const Header = ({ user, isConnected, onStopHardware }) => {
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [activeFilter, setActiveFilter] = useState('All');
  const [showMenu, setShowMenu] = useState(false);

  const filters = ['All', 'Photos', 'Videos', 'Files'];

  const handleMenuAction = (action) => {
    setShowMenu(false);
    switch (action) {
      case 'search':
        setIsSearchActive(true);
        break;
      case 'wipe':
        if (window.confirm("Are you sure you want to delete ALL messages? This cannot be undone.")) {
          fetch('/api/chat/secure_channel/clear', { method: 'DELETE' })
            .then(res => res.json())
            .then(data => {
              console.log("Chat cleared", data);
            })
            .catch(err => console.error("Failed to clear chat", err));
        }
        break;
      case 'tv':
        if (onStopHardware) onStopHardware();
        window.open('https://youtube.com/tv', '_blank');
        break;
      case 'ping':
        // Emit ping event via a custom event or we need socket access here?
        // App.js handles socket. Header doesn't have socket prop directly but App has listeners.
        // Wait, Header was receiving isConnected. 
        // We can dispatch a global event or better, ask App to pass a "onPing" handler.
        // OR, just use fetch to trigger it if we had an endpoint? 
        // Actually App.js passes `onSocketAction` to MessageInput but not Header.
        // Let's assume for now we can't emit directly unless we pass socket or handler.
        // HACK: Dispatch a custom window event that App or someone listens to? No, that's messy.
        // BETTER: I'll use the assumption that 'ping' logic is on the socket.
        // I will dispatch a window event 'trigger-ping' and listen in App? 
        // NO, I should have passed onPing. 
        // Let's just use `window.socket` if it was global (it is defined in App.js module scope but not exported).
        // Let's look at App.js imports. `socket` is created at module level in App.js.
        // It is NOT exported.
        // Re-Modify App.js to pass `onPing`? Or we can import `socket` if we move it to a separate file.
        // For now, let's use a workaround: window.dispatchEvent(new CustomEvent('app-action', { detail: 'ping' }));
        // And add listener in App.js? 
        // actually, let's just cheat and assume we can `import { socket } from '../App'` if we exported it? No it's default export App.

        // Let's stick to the plan: I will assume I can pass `onAction` props or modify App.js again.
        // Since I'm in the middle of edits, let's modify App.js NEXT to pass `onAction` to Header.
        // For now, I will emit a synthetic event that I will hook up in App.js.
        window.dispatchEvent(new CustomEvent('header-action', { detail: { action: 'ping' } }));
        break;
      default:
        break;
    }
  };

  return (
    <header className="app-header">
      {!isSearchActive ? (
        <>
          <div className="header-main">
            <div className="app-title">SecureChanel</div>
            <div className={`user-status ${isConnected ? 'connected' : ''}`}>
              {isConnected ? '● SECURE' : '○ CONNECTING...'}
            </div>
          </div>

          <div className="header-actions" style={{ position: 'relative' }}>
            <button className="btn-menu-toggle" onClick={() => setShowMenu(!showMenu)} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#fff' }}>
              ⋮
            </button>

            <AnimatePresence>
              {showMenu && (
                <motion.div
                  className="header-dropdown"
                  initial={{ opacity: 0, scale: 0.9, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: -10 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  style={{
                    position: 'absolute',
                    top: '40px',
                    right: '0',
                    background: '#fff',
                    borderRadius: '8px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    padding: '8px 0',
                    zIndex: 100,
                    minWidth: '200px',
                    color: '#000'
                  }}
                >
                  <div className="menu-item" onClick={() => handleMenuAction('search')} style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span>🔍</span> Search
                  </div>
                  <div className="menu-item" onClick={() => handleMenuAction('wipe')} style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', color: '#ff3b30' }}>
                    <span>🗑️</span> Wipe Chat
                  </div>
                  <div className="menu-item" onClick={() => handleMenuAction('tv')} style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span>📺</span> Go to TV
                  </div>
                  <div className="menu-item" onClick={() => handleMenuAction('ping')} style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span>🔔</span> Ping User
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      ) : (
        <motion.div
          className="header-search-container"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
        >
          <div className="search-top-row">
            <input
              type="text"
              placeholder="Search..."
              className="search-input"
              autoFocus
            />
            <button className="btn-calendar" title="Jump to Date">📅</button>
            <button className="btn-close-search" onClick={() => setIsSearchActive(false)}>✕</button>
          </div>
          <div className="search-chips-row">
            {filters.map(f => (
              <button
                key={f}
                className={`chip ${activeFilter === f ? 'active' : ''}`}
                onClick={() => setActiveFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </header>
  );
};

export default Header;
