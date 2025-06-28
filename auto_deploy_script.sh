#!/bin/bash

# ==================================================
# LOOOPZ AUTO-DEPLOY SCRIPT
# Seamless GitHub → Vercel deployment from Claude Code
# ==================================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Emojis for better UX
ROCKET="🚀"
MUSIC="🎵"
CHECK="✅"
WARNING="⚠️"
ERROR="❌"
GEAR="⚙️"

echo -e "${PURPLE}${MUSIC} LOOOPZ Auto-Deploy${NC}"
echo -e "${BLUE}========================${NC}"

# Check if we're in the right directory
if [ ! -f "index.html" ] || [ ! -f "script.js" ] || [ ! -f "style.css" ]; then
    echo -e "${ERROR} ${RED}Not in LOOOPZ project directory!${NC}"
    echo -e "${WARNING} ${YELLOW}Make sure you're in the root folder with index.html${NC}"
    exit 1
fi

echo -e "${CHECK} ${GREEN}LOOOPZ project detected${NC}"

# Check git status
if ! git status &> /dev/null; then
    echo -e "${ERROR} ${RED}Not a git repository!${NC}"
    echo -e "${WARNING} ${YELLOW}Run: git init && git remote add origin <your-repo-url>${NC}"
    exit 1
fi

# Check if Vercel is installed and linked
if ! command -v vercel &> /dev/null; then
    echo -e "${GEAR} ${YELLOW}Installing Vercel CLI...${NC}"
    npm install -g vercel
fi

# Check current branch
BRANCH=$(git branch --show-current)
echo -e "${BLUE}Current branch: ${BRANCH}${NC}"

# Show current changes
if ! git diff-index --quiet HEAD --; then
    echo -e "${GEAR} ${YELLOW}Changes detected:${NC}"
    git status --porcelain | while read status file; do
        case $status in
            M*) echo -e "  ${BLUE}Modified:${NC} $file" ;;
            A*) echo -e "  ${GREEN}Added:${NC} $file" ;;
            D*) echo -e "  ${RED}Deleted:${NC} $file" ;;
            ??) echo -e "  ${PURPLE}New file:${NC} $file" ;;
        esac
    done
    echo ""
else
    echo -e "${CHECK} ${GREEN}No uncommitted changes${NC}"
fi

# Pre-deployment checks
echo -e "${GEAR} ${BLUE}Running pre-deployment checks...${NC}"

# Check for basic syntax errors in JavaScript
if command -v node &> /dev/null; then
    if ! node -c script.js 2>/dev/null; then
        echo -e "${ERROR} ${RED}JavaScript syntax error detected in script.js!${NC}"
        echo -e "${WARNING} ${YELLOW}Please fix syntax errors before deploying${NC}"
        exit 1
    fi
    echo -e "${CHECK} ${GREEN}JavaScript syntax OK${NC}"
fi

# Check for required Spotify configuration
if ! grep -q "46637d8f5adb41c0a4be34e0df0c1597" script.js; then
    echo -e "${WARNING} ${YELLOW}Spotify Client ID not found - make sure integration is configured${NC}"
fi

# Commit changes if any
if ! git diff-index --quiet HEAD --; then
    echo -e "${GEAR} ${BLUE}Committing changes...${NC}"
    
    # Generate commit message based on files changed
    COMMIT_MSG="🎵 LOOOPZ Update - $(date '+%Y-%m-%d %H:%M')"
    
    # Check what files were modified for better commit message
    if git diff-index --quiet HEAD -- style.css; then
        :
    else
        COMMIT_MSG="🎨 Update LOOOPZ styling - $(date '+%Y-%m-%d %H:%M')"
    fi
    
    if git diff-index --quiet HEAD -- script.js; then
        :
    else
        COMMIT_MSG="⚡ Update LOOOPZ functionality - $(date '+%Y-%m-%d %H:%M')"
    fi
    
    if git diff-index --quiet HEAD -- index.html; then
        :
    else
        COMMIT_MSG="🏗️ Update LOOOPZ structure - $(date '+%Y-%m-%d %H:%M')"
    fi
    
    git add .
    git commit -m "$COMMIT_MSG"
    echo -e "${CHECK} ${GREEN}Changes committed: $COMMIT_MSG${NC}"
fi

# Push to GitHub
echo -e "${ROCKET} ${BLUE}Pushing to GitHub...${NC}"
if git push origin $BRANCH; then
    echo -e "${CHECK} ${GREEN}Successfully pushed to GitHub${NC}"
else
    echo -e "${ERROR} ${RED}Failed to push to GitHub!${NC}"
    echo -e "${WARNING} ${YELLOW}Check your internet connection and repository permissions${NC}"
    exit 1
fi

# Deploy to Vercel
echo -e "${ROCKET} ${BLUE}Deploying to Vercel...${NC}"

# Check if linked to Vercel project
if [ ! -f ".vercel/project.json" ]; then
    echo -e "${GEAR} ${YELLOW}Linking to Vercel project...${NC}"
    echo -e "${WARNING} ${YELLOW}You may need to select your existing 'looopz' project${NC}"
    vercel link
fi

# Deploy to production
if vercel --prod --yes; then
    echo ""
    echo -e "${CHECK} ${GREEN}${ROCKET} DEPLOYMENT SUCCESSFUL! ${ROCKET}${NC}"
    echo -e "${MUSIC} ${PURPLE}LOOOPZ is live at: ${BLUE}https://looopz.vercel.app${NC}"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo -e "  1. ${GREEN}Test the live site on your iPhone${NC}"
    echo -e "  2. ${GREEN}Check Spotify integration works${NC}"
    echo -e "  3. ${GREEN}Verify loop creation functionality${NC}"
    echo -e "  4. ${GREEN}Ready to create viral loops! ${MUSIC}${NC}"
    echo ""
    
    # Optional: Open in browser (works in some environments)
    if command -v open &> /dev/null; then
        echo -e "${BLUE}Opening live site...${NC}"
        open https://looopz.vercel.app
    elif command -v xdg-open &> /dev/null; then
        echo -e "${BLUE}Opening live site...${NC}"
        xdg-open https://looopz.vercel.app
    fi
    
else
    echo -e "${ERROR} ${RED}Deployment failed!${NC}"
    echo -e "${WARNING} ${YELLOW}Check Vercel configuration and try again${NC}"
    echo -e "${BLUE}Debug steps:${NC}"
    echo -e "  1. Run: ${YELLOW}vercel --help${NC}"
    echo -e "  2. Check: ${YELLOW}vercel ls${NC}"
    echo -e "  3. Re-link: ${YELLOW}vercel link${NC}"
    exit 1
fi

echo -e "${PURPLE}========================================${NC}"
echo -e "${MUSIC} ${GREEN}LOOOPZ deployment complete!${NC} ${MUSIC}"
echo -e "${PURPLE}========================================${NC}"
