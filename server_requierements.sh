#!/bin/bash

# Server Setup & Monitoring Stack Installation Script
# Author: Server Admin
# Description: Installs Node.js, React, Apache, Git, Python, and monitoring tools

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[*]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[+]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[!]${NC} $1"
}

# Function to check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        print_error "This script must be run as root"
        exit 1
    fi
}

# Function to update system
update_system() {
    print_status "Updating system packages..."
    apt-get update -y && apt-get upgrade -y
    apt-get install -y software-properties-common apt-transport-https ca-certificates curl
    print_success "System updated"
}

# Function to install network tools
install_network_tools() {
    print_status "Installing network monitoring tools..."
    
    # Basic network utilities
    apt-get install -y \
        net-tools \
        iproute2 \
        iputils-ping \
        traceroute \
        mtr \
        netcat \
        tcpdump \
        wireshark \
        iptraf-ng \
        nethogs \
        iftop \
        bmon \
        vnstat \
        ethtool \
        bridge-utils \
        dnsutils \
        whois
    
    print_success "Network tools installed"
}

# Function to install Node.js and npm
install_nodejs() {
    print_status "Installing Node.js and npm..."
    
    # Install Node.js from NodeSource repository (LTS version)
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
    
    # Verify installation
    node --version && npm --version
    print_success "Node.js and npm installed"
}

# Function to install React and global packages
install_react_packages() {
    print_status "Installing React and global Node packages..."
    
    # Install create-react-app globally
    npm install -g create-react-app
    npm install -g react-scripts
    
    # Additional useful global packages
    npm install -g \
        nodemon \
        pm2 \
        express-generator \
        yarn \
        typescript \
        webpack \
        webpack-cli \
        babel-cli \
        eslint
    
    print_success "React and global packages installed"
}

# Function to install Apache
install_apache() {
    print_status "Installing and configuring Apache..."
    
    apt-get install -y apache2
    
    # Enable useful modules
    a2enmod rewrite
    a2enmod headers
    a2enmod ssl
    a2enmod proxy
    a2enmod proxy_http
    
    # Create directories for virtual hosts
    mkdir -p /var/www/html
    mkdir -p /etc/apache2/sites-available
    mkdir -p /etc/apache2/sites-enabled
    
    # Start and enable Apache
    systemctl start apache2
    systemctl enable apache2
    
    print_success "Apache installed and configured"
}

# Function to install Git
install_git() {
    print_status "Installing Git..."
    
    apt-get install -y git
    
    # Configure Git (optional - you might want to customize this)
    git config --global user.name "Server Admin"
    git config --global user.email "admin@server.com"
    git config --global core.editor "nano"
    git config --global init.defaultBranch "main"
    
    print_success "Git installed and configured"
}

# Function to install Python and pip
install_python() {
    print_status "Installing Python and pip..."
    
    apt-get install -y \
        python3 \
        python3-pip \
        python3-venv \
        python3-dev \
        python3-setuptools
    
    # Install pip for Python 2 (if needed)
    apt-get install -y python-pip || print_warning "Python 2 pip not available"
    
    # Update pip to latest version
    pip3 install --upgrade pip
    
    # Install useful Python packages
    pip3 install \
        virtualenv \
        django \
        flask \
        requests \
        beautifulsoup4 \
        pandas \
        numpy \
        matplotlib \
        jupyter \
        ansible \
        fabric
    
    print_success "Python and pip installed"
}

# Function to install server monitoring tools
install_monitoring_tools() {
    print_status "Installing server monitoring tools..."
    
    # System monitoring
    apt-get install -y \
        htop \
        atop \
        iotop \
        sysstat \
        dstat \
        glances \
        nmon \
        lm-sensors \
        psensor \
        smartmontools \
        ncdu \
        tree \
        tmux \
        screen \
        jq \
        zip \
        unzip \
        rar \
        unrar \
        fail2ban \
        ufw \
        logwatch
    
    # Install netdata for real-time monitoring (optional)
    print_status "Installing Netdata for real-time monitoring..."
    bash <(curl -Ss https://my-netdata.io/kickstart.sh) --non-interactive
    
    # Install cockpit for web-based management
    apt-get install -y cockpit
    
    # Install prometheus node exporter
    useradd -m -s /bin/bash prometheus
    wget https://github.com/prometheus/node_exporter/releases/download/v1.3.1/node_exporter-1.3.1.linux-amd64.tar.gz
    tar xvf node_exporter-1.3.1.linux-amd64.tar.gz
    mv node_exporter-1.3.1.linux-amd64/node_exporter /usr/local/bin/
    rm -rf node_exporter-1.3.1.linux-amd64*
    
    # Create systemd service for node_exporter
    cat << EOF > /etc/systemd/system/node_exporter.service
[Unit]
Description=Node Exporter
After=network.target

[Service]
User=prometheus
ExecStart=/usr/local/bin/node_exporter

[Install]
WantedBy=multi-user.target
EOF
    
    systemctl daemon-reload
    systemctl enable node_exporter
    systemctl start node_exporter
    
    print_success "Monitoring tools installed"
}

# Function to install database tools
install_database_tools() {
    print_status "Installing database tools..."
    
    # MySQL client and tools
    apt-get install -y \
        mysql-client \
        postgresql-client \
        sqlite3 \
        redis-tools \
        mongodb-clients
    
    print_success "Database tools installed"
}

# Function to install web server tools
install_web_tools() {
    print_status "Installing web server tools..."
    
    # PHP and related tools (optional)
    apt-get install -y \
        php \
        php-cli \
        php-common \
        php-curl \
        php-mysql \
        php-pgsql \
        php-sqlite3 \
        php-mbstring \
        php-xml \
        php-zip \
        composer
    
    # SSL certificates
    apt-get install -y certbot python3-certbot-apache
    
    # Nginx (optional - if you want to use it alongside Apache)
    # apt-get install -y nginx
    
    print_success "Web tools installed"
}

# Function to configure firewall
configure_firewall() {
    print_status "Configuring firewall..."
    
    # Enable UFW if not enabled
    ufw --force enable
    
    # Allow SSH
    ufw allow 22/tcp
    
    # Allow HTTP and HTTPS
    ufw allow 80/tcp
    ufw allow 443/tcp
    
    # Allow Apache if running on non-standard ports
    ufw allow 8080/tcp
    
    # Allow Netdata
    ufw allow 19999/tcp
    
    # Allow Cockpit
    ufw allow 9090/tcp
    
    # Allow Node.js development ports
    ufw allow 3000/tcp
    ufw allow 3001/tcp
    ufw allow 4200/tcp
    
    # Reload firewall
    ufw reload
    
    print_success "Firewall configured"
}

# Function to create useful aliases and configurations
create_aliases() {
    print_status "Creating useful aliases and configurations..."
    
    # Create .bash_aliases for root
    cat << 'EOF' > /root/.bash_aliases
# System Monitoring Aliases
alias ll='ls -la'
alias la='ls -A'
alias l='ls -CF'
alias h='history'
alias df='df -h'
alias du='du -h'
alias free='free -h'
alias psg='ps aux | grep'
alias top='htop'
alias ports='netstat -tulpn'
alias ipinfo='curl ipinfo.io'
alias weather='curl wttr.in'
alias sslcheck='openssl s_client -connect'

# Git Aliases
alias gs='git status'
alias ga='git add'
alias gc='git commit'
alias gp='git push'
alias gl='git log --oneline --graph --all'

# Service Management
alias apache-restart='systemctl restart apache2'
alias apache-status='systemctl status apache2'
alias apache-logs='tail -f /var/log/apache2/error.log'
alias node-restart='pm2 restart all'
alias node-logs='pm2 logs'
alias monitor='glances'

# Network Aliases
alias myip='curl ifconfig.me'
alias ports='netstat -tulpn'
alias listen='lsof -i -P -n | grep LISTEN'
alias traffic='iftop -i eth0'
alias connections='ss -s'

# Custom Functions
function mkcd() { mkdir -p "$1" && cd "$1"; }
function cg() { curl -s "https://cht.sh/$1"; }
EOF
    
    # Source aliases for current session
    source /root/.bash_aliases
    
    # Create similar for regular users if needed
    if [ -d "/home" ]; then
        for userdir in /home/*; do
            if [ -d "$userdir" ]; then
                cp /root/.bash_aliases "$userdir/.bash_aliases"
                chown $(basename "$userdir"):$(basename "$userdir") "$userdir/.bash_aliases"
            fi
        done
    fi
    
    print_success "Aliases and configurations created"
}

# Function to create monitoring script
create_monitoring_script() {
    print_status "Creating monitoring script..."
    
    cat << 'EOF' > /usr/local/bin/server-monitor
#!/bin/bash

# Server Monitoring Script
echo "=========================================="
echo "        SERVER MONITORING REPORT"
echo "=========================================="
echo ""
echo "System Uptime:"
uptime
echo ""
echo "Memory Usage:"
free -h
echo ""
echo "Disk Usage:"
df -h
echo ""
echo "Top Processes by CPU:"
ps aux --sort=-%cpu | head -10
echo ""
echo "Top Processes by Memory:"
ps aux --sort=-%mem | head -10
echo ""
echo "Network Connections:"
netstat -an | grep ESTABLISHED | wc -l
echo "Active Connections"
echo ""
echo "Apache Status:"
systemctl status apache2 --no-pager -l
echo ""
echo "Recent Security Logs:"
tail -20 /var/log/auth.log
echo ""
echo "=========================================="
EOF
    
    chmod +x /usr/local/bin/server-monitor
    
    # Create a daily cron job for monitoring report
    echo "0 8 * * * root /usr/local/bin/server-monitor > /var/log/server-status.log" > /etc/cron.d/server-monitor
    
    print_success "Monitoring script created"
}

# Function to display installation summary
show_summary() {
    clear
    echo "=========================================="
    echo "     INSTALLATION COMPLETE"
    echo "=========================================="
    echo ""
    echo "Installed Services:"
    echo "-------------------"
    echo "• Node.js $(node --version)"
    echo "• npm $(npm --version)"
    echo "• Apache 2"
    echo "• Git $(git --version)"
    echo "• Python 3 $(python3 --version | cut -d' ' -f2)"
    echo "• pip $(pip3 --version | cut -d' ' -f2)"
    echo ""
    echo "Monitoring Tools:"
    echo "-----------------"
    echo "• Netdata (Port 19999)"
    echo "• Cockpit (Port 9090)"
    echo "• Node Exporter (Port 9100)"
    echo "• htop, glances, nmon"
    echo ""
    echo "Network Tools:"
    echo "--------------"
    echo "• iftop, nethogs, bmon"
    echo "• tcpdump, wireshark"
    echo "• mtr, traceroute"
    echo ""
    echo "Useful Commands:"
    echo "----------------"
    echo "• server-monitor  - View server status"
    echo "• glances         - Real-time monitoring"
    echo "• htop            - Process viewer"
    echo "• pm2             - Node.js process manager"
    echo ""
    echo "Web Interfaces:"
    echo "---------------"
    echo "• Netdata:    http://$(hostname -I | awk '{print $1}'):19999"
    echo "• Cockpit:    https://$(hostname -I | awk '{print $1}'):9090"
    echo "• Apache:     http://$(hostname -I | awk '{print $1}')"
    echo ""
    echo "Firewall Status:"
    echo "----------------"
    ufw status numbered
    echo ""
    echo "=========================================="
    echo "Reboot recommended for all changes to take effect"
    echo "=========================================="
}

# Main installation function
main() {
    print_status "Starting server setup and monitoring stack installation..."
    print_warning "This script will install multiple packages and modify system configurations"
    print_warning "Estimated time: 5-15 minutes depending on internet speed"
    
    # Check if running as root
    check_root
    
    # Log everything to a file
    exec > >(tee -i /var/log/server-setup-$(date +%Y%m%d-%H%M%S).log)
    exec 2>&1
    
    # Update system first
    update_system
    
    # Install components
    install_network_tools
    install_git
    install_python
    install_nodejs
    install_react_packages
    install_apache
    install_monitoring_tools
    install_database_tools
    install_web_tools
    
    # Configure system
    configure_firewall
    create_aliases
    create_monitoring_script
    
    # Enable services
    systemctl enable cockpit.socket
    systemctl start cockpit.socket
    
    # Final cleanup
    apt-get autoremove -y
    apt-get clean
    
    # Show summary
    show_summary
    
    print_success "Installation complete! Please review the summary above."
    print_warning "Consider rebooting the server: sudo reboot"
}

# Run main function
main "$@"