#!/bin/bash
# start_board.sh — boot the quilt-canvas-tui fleet-board dogfood demo
pkill -f "fleet_boar[d]" 2>/dev/null
sleep 0.5
tmux kill-session -t qdog 2>/dev/null
cd /home/eileen/scratch/quilt-canvas-tui/bridge || exit 1
QUILT_SOCK=/home/eileen/tmp/quilt-fleet.sock setsid node fleet_board.mjs > /home/eileen/tmp/fleet_board.log 2>&1 < /dev/null &
sleep 1
head -2 /home/eileen/tmp/fleet_board.log
tmux new-session -d -s qdog -x 110 -y 30
tmux send-keys -t qdog "cd /home/eileen/scratch/quilt-canvas-tui/bridge && node canvas.mjs /home/eileen/tmp/quilt-fleet.sock" Enter
sleep 4
echo "=== FABRIC MODE (default) ==="
tmux capture-pane -t qdog -p | sed -n '1,20p'
