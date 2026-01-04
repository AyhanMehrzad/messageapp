import React, { useState } from 'react';

const Login = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleLogin = async (e) => {
        e.preventDefault();
        try {
            // We still use the standard form submission or an API call. 
            // Since the backend expects form data for '/', let's try to mimic that or use fetch.
            // But a simple form submit to localhost:5000/ and letting it redirect back might be complex with ports.
            // Better to make a JSON API login endpoint or handle form post via fetch.

            // Let's try fetch first. The current backend '/' route returns HTML or redirects.
            // It doesn't return JSON on success.
            // We might need to modify backend to accept JSON login or just assume form post.

            const formData = new FormData();
            formData.append('username', username);
            formData.append('password', password);

            const response = await fetch('/', {
                method: 'POST',
                headers: { 'Accept': 'application/json' },
                body: formData,
            });

            const data = await response.json();

            if (data.status === 'success') {
                window.location.reload();
            } else {
                setError('Invalid Credentials');
            }
        } catch (err) {
            setError('Login failed. Ensure backend is running.');
        }
    };

    return (
        <div className="login-wrapper">
            <div className="login-container">
                <h1 className="login-title">SECURE LINK</h1>
                <div className="login-glitch">AUTHENTICATE</div>

                <form onSubmit={handleLogin}>
                    <div className="input-group">
                        <input
                            type="text"
                            placeholder="IDENTITY"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                        />
                    </div>
                    <div className="input-group">
                        <input
                            type="password"
                            placeholder="KEY"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>

                    <button type="submit" className="btn-login">INITIALIZE</button>

                    {error && <div className="error-msg">{error}</div>}
                </form>
            </div>
        </div>
    );
};

export default Login;
