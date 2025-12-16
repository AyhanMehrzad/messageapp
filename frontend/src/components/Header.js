import React from 'react';

const Header = ({ user, isConnected }) => {
  return (
    <header className="app-header">
      <div className="app-title">SecureChanel</div>
      <div className={`user-status ${isConnected ? 'connected' : ''}`}>
        {isConnected ? '● SECURE' : '○ CONNECTING...'}
      </div>
    </header>
  );
};

export default Header;
