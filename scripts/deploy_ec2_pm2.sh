#!/usr/bin/env bash
# Deploy AL-E Core to EC2 Ubuntu with PM2
# Usage:
#   ./scripts/deploy_ec2_pm2.sh 13.220.60.13 ~/.ssh/mercado-pago.pem OPENAI_API_KEY SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY
# Requirements:
# - ssh access with provided PEM
# - Internet access on EC2
# - Security Group permits inbound TCP 4000 if exposing API

set -euo pipefail

HOST=${1:?"EC2 Host IP required"}
PEM=${2:?"Path to PEM key required"}
OPENAI_API_KEY=${3:?"OPENAI_API_KEY required"}
SUPABASE_ANON_KEY=${4:?"SUPABASE_ANON_KEY required"}
SUPABASE_SERVICE_ROLE_KEY=${5:?"SUPABASE_SERVICE_ROLE_KEY required"}

SSH="ssh -i ${PEM} ubuntu@${HOST}"

# Ensure key permissions
chmod 600 "${PEM}" || true

# Clone or update repo
${SSH} 'set -e; \
  if [ ! -d ~/AL-E-Core ]; then \
    git clone https://github.com/KVAdmi/AL-E-Core.git ~/AL-E-Core; \
  else \
    cd ~/AL-E-Core && git pull; \
  fi'

# Create .env
${SSH} "bash -lc 'cd ~/AL-E-Core && cat > .env << EOF
PORT=4000
OPENAI_API_KEY=${OPENAI_API_KEY}
SUPABASE_URL=https://gptwzmuqwtztijgjrry.supabase.co
SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
EOF'"

# Install Node, npm, pm2 if needed
${SSH} 'set -e; \
  if ! command -v node >/dev/null 2>&1; then \
    sudo apt-get update -y && sudo apt-get install -y nodejs npm; \
  fi; \
  if ! command -v pm2 >/dev/null 2>&1; then \
    sudo npm install -g pm2; \
  fi'

# Install dependencies and build
${SSH} 'set -e; cd ~/AL-E-Core && npm install && npm run build'

# Start with PM2 and persist
${SSH} 'set -e; cd ~/AL-E-Core && pm2 start dist/index.js --name ale-core || pm2 restart ale-core && pm2 save'
${SSH} 'set -e; PM2_CMD=$(pm2 startup systemd -u ubuntu --hp /home/ubuntu | tail -n 1); eval "$PM2_CMD"; pm2 save'

# Verify
${SSH} 'set -e; pm2 status; curl -s http://localhost:4000/api/ai/ping || true; curl -s http://localhost:4000/api/ai/status || true'

echo "Deployment complete. API base: http://${HOST}:4000"
echo "Chat endpoint: POST http://${HOST}:4000/api/ai/chat"