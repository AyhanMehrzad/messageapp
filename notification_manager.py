import sqlite3
import json
import threading
from typing import List, Dict, Optional

class NotificationManager:
    """
    Manages Web Push Subscriptions for the Hybrid Notification System.
    Stores subscriptions in a SQLite database.
    """
    def __init__(self, db_path: str = 'notifications.db'):
        self.db_path = db_path
        self.lock = threading.Lock()
        self._init_database()

    def _init_database(self):
        """Initialize the subscriptions table"""
        with self.lock:
            conn = sqlite3.connect(self.db_path, check_same_thread=False)
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS push_subscriptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user TEXT NOT NULL,
                    endpoint TEXT NOT NULL UNIQUE,
                    p256dh TEXT NOT NULL,
                    auth TEXT NOT NULL,
                    user_agent TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            conn.commit()
            conn.close()

    def add_subscription(self, user: str, subscription_info: Dict, user_agent: str = "") -> bool:
        """
        Add or update a push subscription for a user.
        subscription_info should be the JSON object from the client (contains endpoint, keys).
        """
        endpoint = subscription_info.get('endpoint')
        keys = subscription_info.get('keys', {})
        p256dh = keys.get('p256dh')
        auth = keys.get('auth')

        if not endpoint or not p256dh or not auth:
            return False

        with self.lock:
            conn = sqlite3.connect(self.db_path, check_same_thread=False)
            cursor = conn.cursor()
            try:
                # Use REPLACE (or INSERT OR REPLACE) to handle updates for the same endpoint
                cursor.execute('''
                    INSERT OR REPLACE INTO push_subscriptions (user, endpoint, p256dh, auth, user_agent)
                    VALUES (?, ?, ?, ?, ?)
                ''', (user, endpoint, p256dh, auth, user_agent))
                conn.commit()
                return True
            except Exception as e:
                print(f"Error adding subscription: {e}")
                return False
            finally:
                conn.close()

    def get_subscriptions(self, user: str) -> List[Dict]:
        """Retrieve all active subscriptions for a specific user"""
        with self.lock:
            conn = sqlite3.connect(self.db_path, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            cursor.execute('SELECT * FROM push_subscriptions WHERE user = ?', (user,))
            rows = cursor.fetchall()
            
            subs = []
            for row in rows:
                subs.append({
                    'endpoint': row['endpoint'],
                    'keys': {
                        'p256dh': row['p256dh'],
                        'auth': row['auth']
                    }
                })
            conn.close()
            return subs
            
    def remove_subscription(self, endpoint: str):
        """Remove a stale or unsubscribed endpoint"""
        with self.lock:
            conn = sqlite3.connect(self.db_path, check_same_thread=False)
            cursor = conn.cursor()
            try:
                cursor.execute('DELETE FROM push_subscriptions WHERE endpoint = ?', (endpoint,))
                conn.commit()
            except Exception as e:
                print(f"Error removing subscription: {e}")
            finally:
                conn.close()
