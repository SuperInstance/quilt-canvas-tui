# quilt-tui-c — the C99 spreadsheet port over the quilt-c kernel
QUILT   := /tmp/quilt-c
CC      ?= cc
CFLAGS  ?= -std=c99 -Wall -Wextra -Wpedantic -O2 -I$(QUILT)/include
ENGINE  := $(QUILT)/src/engine.c

all: driver tui test_bytematch

driver: driver.c core.c core.h $(ENGINE)
	$(CC) $(CFLAGS) driver.c core.c $(ENGINE) -o $@

tui: tui.c core.c core.h $(ENGINE)
	$(CC) $(CFLAGS) tui.c core.c $(ENGINE) -o $@

test_bytematch: test_bytematch.c core.c core.h $(ENGINE)
	$(CC) $(CFLAGS) test_bytematch.c core.c $(ENGINE) -o $@

expected_journal.hex: gen_expected_journal.py
	python3 gen_expected_journal.py > expected_journal.hex
	sed -n '2p' expected_journal.hex > expected_gdigest.txt

test: test_bytematch expected_journal.hex
	./test_bytematch

smoke: driver
	printf '%s\n' \
	  '{"op":"BIND","cell":"A1","value":1}' \
	  '{"op":"BIND","cell":"B1","value":2}' \
	  '{"op":"BIND","cell":"C1","kind":"sum","reads":["A1","B1"]}' \
	  '{"op":"EFFECT","cell":"C1"}' \
	  '{"op":"VIEW","cell":"C1"}' \
	  '{"op":"TICK"}' | ./driver

clean:
	rm -f driver tui test_bytematch expected_journal.hex expected_gdigest.txt

.PHONY: all test smoke clean
