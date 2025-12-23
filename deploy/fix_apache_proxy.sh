#!/bin/bash

# Fix Apache Configuration to Proxy to Flask App
# Usage: sudo ./fix_apache_proxy.sh

echo "Enabling Apache Proxy Modules..."
a2enmod proxy
a2enmod proxy_http
a2enmod proxy_wstunnel
a2enmod ssl
a2enmod headers

# Back up existing config
cp /etc/apache2/sites-available/000-default.conf /etc/apache2/sites-available/000-default.conf.bak

echo "Configuring Apache VirtualHost..."
cat > /etc/apache2/sites-available/000-default.conf <<EOL
<VirtualHost *:80>
    ServerAdmin webmaster@localhost
    DocumentRoot /var/www/html

    # Redirect HTTP to HTTPS
    RewriteEngine On
    RewriteCond %{HTTPS} off
    RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
</VirtualHost>

<VirtualHost *:443>
    ServerAdmin webmaster@localhost
    DocumentRoot /var/www/html

    # SSL Configuration (Attempting to use existing Certbot path if available)
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/securechanel.xyz/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/securechanel.xyz/privkey.pem
    
    # Fallback if certs don't exist (comment out if causing issues, or use snakeoil)
    # SSLCertificateFile /etc/ssl/certs/ssl-cert-snakeoil.pem
    # SSLCertificateKeyFile /etc/ssl/private/ssl-cert-snakeoil.key

    # Enable Rewrite Engine for WebSockets
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule /(.*)           ws://127.0.0.1:5000/$1 [P,L]
    RewriteCond %{HTTP:Upgrade} !=websocket [NC]
    RewriteRule /(.*)           http://127.0.0.1:5000/$1 [P,L]

    # Proxy Configuration
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:5000/
    ProxyPassReverse / http://127.0.0.1:5000/

    # Allow encoded slashes
    AllowEncodedSlashes On

    ErrorLog \${APACHE_LOG_DIR}/error.log
    CustomLog \${APACHE_LOG_DIR}/access.log combined
</VirtualHost>
EOL

echo "Restarting Apache..."
systemctl restart apache2
echo "Apache configured! Refresh your browser."
