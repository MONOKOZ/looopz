# LOOOPZ - Project Documentation for Claude Code

## 🎵 Project Overview

**LOOOPZ** is a sophisticated Spotify-integrated web application that enables users to create perfect, viral-ready music loops from any Spotify track. The app focuses on precision timing, mobile-first design, and seamless user experience.

### Core Mission
Transform any Spotify song into perfectly timed loops for social media, music production, and creative content creation.

## 🏗 Current Code Structure

```
looopz/
├── index.html          # Main app HTML (COMPLETE - sophisticated UI)
├── style.css           # All styling (COMPLETE - mobile-optimized)
├── script.js           # Core functionality (COMPLETE - advanced features)
├── assets/
│   └── icons/          # Feather SVG icons
└── vercel.json         # Deployment config
```

### Code Architecture Principles
- **Vanilla JavaScript** - No frameworks, maximum performance
- **Mobile-First** - iPhone X optimized, works everywhere
- **Component-Based** - Modular functions, clean separation
- **Progressive Enhancement** - Works without JavaScript for basic features

## 🎯 Key Features (ALREADY IMPLEMENTED)

### ✅ Spotify Integration
- **OAuth 2.0** with PKCE flow
- **Web Playback SDK** integration
- **Real-time track control**
- **Premium account detection**

### ✅ Loop Creation Engine
- **Precision timing** (millisecond accuracy)
- **Drag-and-drop handles** for loop start/end
- **Smart Loop Assist** with quality scoring
- **Visual feedback** and haptic responses

### ✅ Advanced Features
- **Playlist Management** with drag-and-drop reordering
- **Loop Library** with save/export functionality
- **Search Integration** (tracks, artists, albums)
- **Mobile Touch Optimization**
- **Progressive Web App** capabilities

### ✅ UI/UX Excellence
- **Modern glassmorphism design**
- **Smooth animations** and transitions
- **Responsive layout** for all devices
- **Intuitive navigation** with bottom tab bar

## 🛠 Development Guidelines for Claude Code

### CRITICAL RULES - ALWAYS FOLLOW

#### 1. **SURGICAL EDITS ONLY**
- **NEVER rewrite entire files** - only modify specific lines that need changes
- **PRESERVE existing functionality** - the app is sophisticated and working
- **TEST before suggesting** - ensure changes don't break existing features
- **INCREMENTAL IMPROVEMENTS** - small, focused changes only

#### 2. **RESPECT THE CODEBASE**
- This is a **production-quality application** with intricate systems
- **Every function has a purpose** - understand before modifying
- **Maintain code style** and patterns established
- **Comment your changes** clearly

#### 3. **MOBILE-FIRST APPROACH**
- **Always test on iPhone** - this is the primary target device
- **Touch-friendly interfaces** - 44px minimum touch targets
- **Performance matters** - keep JavaScript optimized
- **Responsive design** - works on all screen sizes

### Code Modification Approach

#### When Adding Features:
1. **Understand existing patterns** first
2. **Follow established naming conventions**
3. **Add to existing modules** rather than creating new ones
4. **Test integration** with current features
5. **Update UI consistently** with existing design

#### When Fixing Issues:
1. **Identify root cause** before changing code
2. **Minimal viable fix** - don't over-engineer
3. **Preserve backward compatibility**
4. **Test on mobile devices** first

#### When Optimizing:
1. **Measure before optimizing** - no premature optimization
2. **Focus on user experience** improvements
3. **Maintain feature completeness**
4. **Document performance gains**

## 🔧 Technical Details

### Spotify API Integration
- **Client ID**: `46637d8f5adb41c0a4be34e0df0c1597`
- **Redirect URI**: `https://looopz.vercel.app/`
- **Scopes**: Streaming, user data, playback control
- **Token Management**: Auto-refresh with error handling

### State Management
- **Global state object** for app-wide data
- **Local storage** for persistence
- **Event-driven updates** for UI synchronization
- **Error boundaries** for graceful failure handling

### Performance Optimizations
- **Debounced user inputs** to prevent excessive API calls
- **Cached audio analysis** for loop quality scoring
- **Lazy loading** for search results
- **Efficient DOM updates** with minimal reflows

## 🚀 Deployment Workflow

### Current Setup
- **GitHub Repository** with main branch
- **Vercel Hosting** with auto-deploy on push
- **Live Site**: https://looopz.vercel.app
- **Instant deployment** via GitHub integration

### Deployment Process
1. **Make changes** in Claude Code
2. **Test locally** in development environment
3. **Commit and push** to GitHub repository
4. **Auto-deployment** triggers on Vercel
5. **Verify live site** functionality

### Quality Gates
- **Code review** by Claude Code
- **Mobile testing** on target devices
- **Feature verification** on live site
- **Performance monitoring** post-deployment

## 💬 Communication Style for Claude Code

### How to Interact
- **Be conversational** - "Can you help me add..."
- **Ask for explanations** - "Why does this work this way?"
- **Request iterations** - "Make it more responsive"
- **Seek advice** - "What's the best approach for..."

### Expected Responses
- **Explain changes** clearly before implementing
- **Show code differences** when making modifications
- **Suggest alternatives** when appropriate
- **Ask for confirmation** before major changes

## 🎯 Current Priorities

### Enhancement Opportunities
1. **User Experience** improvements
2. **Performance optimizations**
3. **New loop creation features**
4. **Social sharing capabilities**
5. **Advanced playlist management**

### Technical Debt
- **Code documentation** improvements
- **Error handling** enhancements
- **Test coverage** expansion
- **Accessibility** improvements

## 🔒 Security & Privacy

### Data Handling
- **No user data storage** on servers
- **Client-side only** authentication
- **Spotify API compliance** maintained
- **Privacy-first** approach

### Security Measures
- **HTTPS enforcement**
- **CSRF protection** via state parameters
- **Token expiration** handling
- **Secure credential management**

## 📋 Project Status: PRODUCTION READY

This is a **fully functional, sophisticated application** that:
- ✅ **Works flawlessly** on mobile devices
- ✅ **Integrates seamlessly** with Spotify
- ✅ **Provides professional UX** for loop creation
- ✅ **Handles edge cases** gracefully
- ✅ **Performs optimally** on target devices

### Claude Code's Role
You are the **senior developer** for this project. Your job is to:
- **Enhance existing features** with surgical precision
- **Add new capabilities** that fit the established patterns
- **Optimize performance** without breaking functionality
- **Maintain code quality** and user experience standards

### Remember
- This app is **already amazing** - make it even better
- Users **depend on stability** - don't break what works
- **Mobile experience** is paramount
- **Every change matters** - this is production code

---

**Ready to build amazing features for LOOOPZ!** 🎵✨
