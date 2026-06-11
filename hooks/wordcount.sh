#!/bin/sh
set -e

words=$(wc -w < "$1" | tr -d ' ')
echo "demo hook: counted $words words in $(basename "$1")"
echo "nothing was published. write a real hook when you are ready."
