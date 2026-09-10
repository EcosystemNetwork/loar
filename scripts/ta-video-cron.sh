#!/usr/bin/env bash
# Hourly drain of the Techno Antichrist Veo quota window.
#
# Veo on the AI Studio key is rate-limited to ~10-15 video clips per rolling
# window regardless of billing credit, so gen-techno-antichrist-video.ts is run
# once an hour with --max to take the window's worth of clips and exit. The
# script is resumable (every clip checks Firestore first), so once every
# motion/episode/trailer shot exists each run is a fast no-op.
#
# Install:  (crontab -l 2>/dev/null; echo '17 * * * * /home/god/Desktop/loar/loar/scripts/ta-video-cron.sh >> /tmp/ta-video-cron.log 2>&1') | crontab -
# Watch:    tail -f /tmp/ta-video-cron.log
# Stop:     crontab -e   # delete the line
set -euo pipefail

export HOME="${HOME:-/home/god}"
export PATH="$HOME/.config/nvm/versions/node/v22.19.0/bin:$HOME/.local/share/pnpm:/usr/local/bin:/usr/bin:/bin"

cd /home/god/Desktop/loar/loar

echo "==== $(date -Is) ===="
exec railway run --service loar -- pnpm tsx scripts/gen-techno-antichrist-video.ts \
  --live --motion --episodes --trailer --res=1080p --dur=8 --max=25
