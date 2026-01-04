import React, { useState, useEffect } from 'react';

const PermissionModal = ({ onComplete }) => {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // Check local storage for permission grant (v2 key to force re-prompt after update)
        const hasGranted = localStorage.getItem('permissions_granted_v2');
        if (!hasGranted) {
            setIsVisible(true);
        } else {
            onComplete();
        }
    }, [onComplete]);

    const handleGrant = async () => {
        try {
            // 1. Request Media Permissions
            await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

            // 2. Request Notification Permission
            if ("Notification" in window) {
                await Notification.requestPermission();
            }

            // Cache the result
            localStorage.setItem('permissions_granted_v2', 'true');

            // Close modal
            setIsVisible(false);
            onComplete();
        } catch (err) {
            console.error("Permission denied or error:", err);
            alert("Permissions are required to use this app. Please allow access when prompted.");
            // Do not close the modal on error, force retry or manual fix
        }
    };

    if (!isVisible) return null;

    return (
        <div className="permission-overlay">
            <div className="permission-modal">
                <h2 className="perm-title">Permissions Required</h2>
                <p className="perm-desc">
                    To enable secure calls and file sharing, the app needs access to your device's camera, microphone, and notification services.
                </p>

                <div className="perm-list">
                    <div className="perm-item">
                        <div className="perm-icon">📷</div>
                        <div className="perm-info">
                            <span className="perm-name">Camera Access</span>
                            <span className="perm-detail">For making secure video calls and sending photos.</span>
                        </div>
                    </div>

                    <div className="perm-item">
                        <div className="perm-icon">🎤</div>
                        <div className="perm-info">
                            <span className="perm-name">Microphone Access</span>
                            <span className="perm-detail">For making secure voice and video calls.</span>
                        </div>
                    </div>

                    <div className="perm-item">
                        <div className="perm-icon">🔔</div>
                        <div className="perm-info">
                            <span className="perm-name">Notifications</span>
                            <span className="perm-detail">To receive alerts when you get a secure message.</span>
                        </div>
                    </div>
                </div>

                <button className="btn-grant" onClick={handleGrant}>Grant Permissions</button>
            </div>
        </div>
    );
};

export default PermissionModal;
