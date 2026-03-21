# TOOLS.md — Local Environment Notes

TOOLS.md is your personal environment configuration file.
It is NOT shared — it lives in your workspace and contains details
specific to your machine and setup.

The principle: **Skills are shared. Your setup is yours.**

---

## Local API Keys (Non-Provider)

Add keys for services that are not AI providers but are used by skills:

```
# Web search (used by web_search skill if configured)
BRAVE_API_KEY=...

# Weather API
WEATHER_API_KEY=...
```

---

## Local Devices

```
# Cameras
camera_office:   Logitech C920 — facing desk
camera_outside:  Reolink PTZ — south garden

# SSH hosts
server_home:     192.168.1.50  user: admin
server_vps:      vps.example.com  user: ubuntu
```

---

## Preferences

```
# Text-to-speech voice
tts_voice: alloy

# Default search engine for web queries
search_engine: brave

# Editor preference
editor: code
```

---

## Local File Paths

```
# Project roots
projects_dir:    ~/Projects
notes_dir:       ~/Notes
downloads_dir:   ~/Downloads
```

---

## Notes

Add any other machine-specific context here that would help the agent
operate more effectively in your environment.

- What software is installed?
- What services are running locally?
- Any quirks or special configurations?
