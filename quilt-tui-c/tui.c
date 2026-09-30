/* tui.c — raw-ANSI spreadsheet over the quilt-c kernel (no ncurses, no deps).
 * keys: arrows/hjkl move · e value+ENTER · f formula ("sum A1,B2")+ENTER ·
 *       l link (ENTER src, ENTER dst) · x effect · v view · t tick ·
 *       d forget · q quit
 * QUILT_HEADLESS=1 → line-based stdin keys, no TTY needed (test hook). */
#include "core.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <termios.h>

#define COLS 8
#define ROWS 6
#define CW 10
#define CH 3
#define OX 2
#define OY 2

static qfabric_t F;
static int cur_c, cur_r, running = 1;
static char status[256] = "e value · f formula · l link · x effect · v view · t tick · d forget · q quit";
static int headless = 0;

static const char *addr_of(int c, int r) {
    static char ids[COLS * ROWS][3];
    ids[c * ROWS + r][0] = (char)('A' + c);
    ids[c * ROWS + r][1] = (char)('1' + r);
    ids[c * ROWS + r][2] = 0;
    return ids[c * ROWS + r];
}
static int slot_of(const char *a) {
    for (int c = 0; c < COLS; c++) for (int r = 0; r < ROWS; r++)
        if (strcmp(addr_of(c, r), a) == 0) return c * ROWS + r;
    return -1;
}

static void line_at(int y, int x, const char *s) {
    if (!headless) printf("\x1b[%d;%dH%s", y, x, s);
}

static void render(void) {
    if (headless) return;
    printf("\x1b[?1049h\x1b[?25l\x1b[H");
    char buf[256];
    for (int r = 0; r < ROWS; r++) {
        for (int c = 0; c < COLS; c++) {
            const char *a = addr_of(c, r);
            int sel = (c == cur_c && r == cur_r);
            int s = slot_of(a);
            const char *kind = "";
            long val = 0;
            int present = 0;
            if (s >= 0 && (size_t)s < F.e.n_cells && strcmp(F.e.cells[s].id, a) == 0) {
                present = 1;
                val = F.e.cells[s].value.t == QUILT_V_INT ? (long)F.e.cells[s].value.u.i : 0;
                kind = F.e.cells[s].eval ? "Σ" : "";
            }
            snprintf(buf, sizeof buf, "%s\x1b[0m", "");
            char cellbuf[64];
            snprintf(cellbuf, sizeof cellbuf, "%s%s%s", sel ? "\x1b[7m" : "",
                     present ? a : "·", sel ? "\x1b[0m" : "");
            line_at(OY + r * CH, OX + c * CW, cellbuf);
            char vbuf[64];
            snprintf(vbuf, sizeof vbuf, "%s%ld%s%s", sel ? "\x1b[7m" : "",
                     present ? val : 0, kind, sel ? "\x1b[0m" : "");
            line_at(OY + r * CH + 1, OX + c * CW, vbuf);
            (void)buf;
        }
    }
    char g[17]; qf_gdigest(&F, g);
    const char *a = addr_of(cur_c, cur_r);
    int s = slot_of(a);
    char meta[256];
    if (s >= 0 && (size_t)s < F.e.n_cells && strcmp(F.e.cells[s].id, a) == 0)
        snprintf(meta, sizeof meta, " %s v%lu dials=%lld %s", a,
                 (unsigned long)F.e.cells[s].version,
                 (long long)(F.e.cells[s].value.t == QUILT_V_INT ? F.e.cells[s].value.u.i : 0),
                 F.e.cells[s].eval ? "formula" : "value");
    else
        snprintf(meta, sizeof meta, " %s (empty)", a);
    line_at(22, 1, meta);
    snprintf(meta, sizeof meta, "tick=%llu journal=%llu gdigest=%s",
             (unsigned long long)F.e.tick, (unsigned long long)F.e.journal_len, g);
    line_at(23, 1, meta);
    line_at(24, 1, status);
    fflush(stdout);
}

static void do_op(const char *op, const char *cell, const char *other,
                  long long val, const char *kind, char **reads, int nreads) {
    char receipt[512];
    qf_op(&F, op, cell, other, val, kind, reads, nreads, receipt, sizeof receipt);
    /* mirror the receipt into the status bar, compactly */
    char *ok = strstr(receipt, "\"ok\":true");
    char *valp = strstr(receipt, "\"value\":");
    if (strcmp(op, "VIEW") == 0 && valp)
        snprintf(status, sizeof status, "%s", valp);
    else
        snprintf(status, sizeof status, "%s %s -> %s", op, cell, ok ? "ok" : "ERR");
    render();
}

/* line-based prompt (works headless: caller feeds lines) */
static void prompt_line(const char *msg, char *out, size_t cap) {
    if (!headless) {
        char m[128];
        snprintf(m, sizeof m, "\x1b[?25h%s", msg);
        line_at(24, 1, m);
        fflush(stdout);
    }
    if (!fgets(out, (int)cap, stdin)) { out[0] = 0; running = 0; return; }
    out[strcspn(out, "\r\n")] = 0;
    if (!headless) printf("\x1b[?25l");
}

static void key_value(void) {
    char buf[64];
    prompt_line(" value> ", buf, sizeof buf);
    if (!running) return;
    char *end;
    long long v = strtoll(buf, &end, 10);
    if (end == buf) { snprintf(status, sizeof status, "not an integer"); render(); return; }
    do_op("BIND", addr_of(cur_c, cur_r), NULL, v, "generic", NULL, 0);
}

static void key_formula(void) {
    char buf[128];
    prompt_line(" kind reads(A1,B2)> ", buf, sizeof buf);
    if (!running) return;
    char kind[16] = ""; char *reads[QF_MAX_READS]; int nr = 0;
    static char rstore[QF_MAX_READS][QF_ID_CAP];
    char *sp = buf;
    char *tok = strtok(sp, " \t");
    if (!tok) { snprintf(status, sizeof status, "empty formula"); render(); return; }
    snprintf(kind, sizeof kind, "%s", tok);
    tok = strtok(NULL, " \t");
    if (tok) {
        char *p = strtok(tok, ",");
        while (p && nr < QF_MAX_READS) {
            snprintf(rstore[nr], QF_ID_CAP, "%s", p);
            reads[nr] = rstore[nr];
            nr++; p = strtok(NULL, ",");
        }
    }
    /* BIND creates/updates the cell; then rewire kind+reads by re-binding
     * through the core dispatcher with kind set (idempotent-safe). */
    char receipt[512];
    qf_op(&F, "BIND", addr_of(cur_c, cur_r), NULL, 0, kind, reads, nr,
          receipt, sizeof receipt);
    snprintf(status, sizeof status, "FORMULA %s(%s) %s", kind,
             nr ? reads[0] : "∅", strstr(receipt, "\"ok\":true") ? "ok" : "ERR");
    render();
}

static int link_src = -1; /* slot c*ROWS+r */
static void key_link(void) {
    if (link_src < 0) {
        link_src = cur_c * ROWS + cur_r;
        snprintf(status, sizeof status, "link from %s — move, ENTER again",
                 addr_of(cur_c, cur_r));
        render();
        return;
    }
    int sc = link_src / ROWS, sr = link_src % ROWS;
    if (sc == cur_c && sr == cur_r) { link_src = -1; snprintf(status, sizeof status, "link cancelled"); render(); return; }
    do_op("LINK", addr_of(sc, sr), addr_of(cur_c, cur_r), 0, "generic", NULL, 0);
    link_src = -1;
}

static void handle(const char *key) {
    if (!strcmp(key, "q") || !strcmp(key, "ESC")) { running = 0; return; }
    if (!strcmp(key, "LEFT") || !strcmp(key, "h")) { if (cur_c > 0) cur_c--; render(); return; }
    if (!strcmp(key, "RIGHT") || !strcmp(key, "l")) { if (cur_c < COLS - 1) cur_c++; render(); return; }
    if (!strcmp(key, "UP") || !strcmp(key, "k")) { if (cur_r > 0) cur_r--; render(); return; }
    if (!strcmp(key, "DOWN") || !strcmp(key, "j")) { if (cur_r < ROWS - 1) cur_r++; render(); return; }
    if (!strcmp(key, "e")) { key_value(); return; }
    if (!strcmp(key, "f")) { key_formula(); return; }
    if (!strcmp(key, "L")) { key_link(); return; }   /* capital L: link mode (l is cursor) */
    if (!strcmp(key, "ENTER")) { if (link_src >= 0) key_link(); return; }
    if (!strcmp(key, "x")) { do_op("EFFECT", addr_of(cur_c, cur_r), NULL, 0, "generic", NULL, 0); return; }
    if (!strcmp(key, "v")) { do_op("VIEW", addr_of(cur_c, cur_r), NULL, 0, "generic", NULL, 0); return; }
    if (!strcmp(key, "t")) { do_op("TICK", "", NULL, 0, "generic", NULL, 0); return; }
    if (!strcmp(key, "d")) { do_op("FORGET", addr_of(cur_c, cur_r), NULL, 0, "generic", NULL, 0); return; }
}

int main(void) {
    headless = getenv("QUILT_HEADLESS") != NULL;
    qf_init(&F);
    render();
    if (headless) {
        char line[64];
        while (running && fgets(line, sizeof line, stdin)) {
            line[strcspn(line, "\r\n")] = 0;
            if (line[0]) handle(line);
        }
    } else {
        struct termios oldt, raw;
        tcgetattr(0, &oldt);
        raw = oldt;
        raw.c_lflag &= (tcflag_t)~(ICANON | ECHO);
        raw.c_cc[VMIN] = 1;
        tcsetattr(0, TCSANOW, &raw);
        char seq[3];
        while (running) {
            int c = getchar();
            if (c == EOF) break;
            if (c == 27) {
                seq[0] = (char)getchar(); seq[1] = (char)getchar();
                if (seq[0] == '[') {
                    if (seq[1] == 'A') handle("UP");
                    else if (seq[1] == 'B') handle("DOWN");
                    else if (seq[1] == 'C') handle("RIGHT");
                    else if (seq[1] == 'D') handle("LEFT");
                    else handle("ESC");
                } else handle("ESC");
            } else if (c == '\r' || c == '\n') handle("ENTER");
            else { seq[0] = (char)c; seq[1] = 0; handle(seq); }
        }
        tcsetattr(0, TCSANOW, &oldt);
    }
    if (!headless) printf("\x1b[?25h\x1b[?1049l");
    char g[17]; qf_gdigest(&F, g);
    fprintf(stderr, "\nfinal gdigest=%s tick=%llu journal=%llu\n",
            g, (unsigned long long)F.e.tick, (unsigned long long)F.e.journal_len);
    return 0;
}
