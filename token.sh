#!/bin/bash
if [ -z "$1" ]; then
  echo "Usage: ./token.sh <new-token>"
  exit 1
fi

sed -i '' "s/export FLIPPER_TOKEN=\".*\"/export FLIPPER_TOKEN=\"$1\"/" ~/.zshrc
export FLIPPER_TOKEN="$1"
echo "Token updated. Restart Claude Code to apply."
