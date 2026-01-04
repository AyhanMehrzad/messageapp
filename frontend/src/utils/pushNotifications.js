const PUBLIC_VAPID_KEY = 'BJ4gQqMmCldTvZqCTMN1ZjuB33m4bn0Xo0703fIM49cP6VuDNP7B0T-Ogl4jlRarkAbG27npHdrQd-AOsemCYaY';

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

export async function registerPushNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.warn('Push notifications not supported');
        return null;
    }

    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        console.warn('Notification permission denied');
        return null;
    }

    // Register Service Worker
    const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
    });
    console.log('Service Worker registered');

    // Check existing subscription
    let subscription = await registration.pushManager.getSubscription();

    // If no subscription, create new one
    if (!subscription) {
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
        });
    }

    return subscription;
}

export async function sendSubscriptionToBackend(subscription, username) {
    if (!subscription || !username) return;

    try {
        const response = await fetch('/api/subscribe', {
            method: 'POST',
            body: JSON.stringify({
                subscription: subscription,
                username: username,
                user_agent: navigator.userAgent
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to send subscription to backend');
        }
        console.log('Push Subscription saved to backend');
    } catch (err) {
        console.error('Error saving subscription:', err);
    }
}
