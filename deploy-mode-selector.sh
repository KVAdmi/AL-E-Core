#!/bin/bash

# ═══════════════════════════════════════════════════════════════
# DEPLOY MODE SELECTOR TO EC2
# P0 CORE - Executive VIP Quality
# ═══════════════════════════════════════════════════════════════

echo "🚀 Starting MODE SELECTOR deployment..."
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Pull latest changes
echo "📥 Step 1/5: Pulling latest code from GitHub..."
git pull origin main
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Git pull failed${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Code pulled successfully${NC}"
echo ""

# Step 2: Install dependencies (if needed)
echo "📦 Step 2/5: Checking dependencies..."
npm install
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ npm install failed${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Dependencies checked${NC}"
echo ""

# Step 3: Build TypeScript
echo "🔨 Step 3/5: Building TypeScript..."
npm run build
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Build successful${NC}"
echo ""

# Step 4: Restart PM2
echo "🔄 Step 4/5: Restarting ALEON API with PM2..."
pm2 restart aleon-api
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ PM2 restart failed${NC}"
    exit 1
fi
echo -e "${GREEN}✅ PM2 restarted${NC}"
echo ""

# Step 5: Show logs
echo "📊 Step 5/5: Showing recent logs..."
echo ""
pm2 logs aleon-api --lines 30 --nostream

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ MODE SELECTOR DEPLOYED SUCCESSFULLY${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "📋 Next steps:"
echo "1. Monitor MODE classification: pm2 logs aleon-api | grep 'STEP 4.6'"
echo "2. Test MODE_A: 'receta de galletas' → Should use no tools"
echo "3. Test MODE_B: 'últimas noticias IA' → Should use web_search"
echo "4. Test MODE_C: 'agenda reunión' → Should validate evidence"
echo ""
echo "🔍 Live monitoring:"
echo "  pm2 logs aleon-api --lines 100"
echo ""
