#!/bin/bash
# ref_controller_test.sh — A/B: their known-good controller on my sock path
pkill -f "fleet_boar[d]" 2>/dev/null
pkill -f "controller.ms[j]" 2>/dev/null
sleep 0.5
tmux kill-session -t qdog 2>/dev/null
cd /home/eileen/scratch/quilt-canvas-tui/bridge || exit 1
QUILT_SOCK=/home/eileen/tmp/quilt-fleet.sock setsid node controller.mjs > /home/eileen/tmp/ref_controller.log 2>&1 < /dev/null &
sleep 1
tmux new-session -d -s qdog -x 110 -y 30
tmux send-keys -t qdog "cd /home/eileen/scratch/quilt-canvas-tui/bridge && node canvas.mjs /home/eileen/tmp/quilt-fleet.sock" Enter
sleep 4
echo "=== REF CONTROLLER RENDER (head) ==="
tmux capture-pane -t qdog -p | head -6
echo "=== footer ==="
tmux capture-pane -t qdog -p | tail -2
echo "=== ref controller log ==="
tail -5 /home/eileen/tmp/ref_controller.log
