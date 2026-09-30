/* driver.c — JSON-lines opcode driver for the C port.
 * stdin: one flat JSON object per line (the op shapes below)
 * stdout: one JSON receipt per line (from qf_op)
 *
 *   {"op":"BIND","cell":"A1","value":5}
 *   {"op":"BIND","cell":"C1","kind":"sum","reads":["A1","B1"]}
 *   {"op":"LINK","from":"A1","to":"B1"}
 *   {"op":"EFFECT","cell":"C1"}
 *   {"op":"VIEW","cell":"A1"}
 *   {"op":"TICK"}
 *   {"op":"FORGET","cell":"A1"}
 */
#include "core.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

typedef struct {
    char op[16], cell[QF_ID_CAP], other[QF_ID_CAP], kind[16];
    char reads[QF_MAX_READS][QF_ID_CAP];
    char *read_ptrs[QF_MAX_READS];
    int n_reads;
    long long value;
    int has_op, has_cell, has_value;
} op_t;

static const char *skip_ws(const char *p) {
    while (*p && isspace((unsigned char)*p)) p++;
    return p;
}

/* parse a flat JSON object into op_t; returns pointer past '}' or NULL */
static const char *parse_op(const char *p, op_t *o) {
    memset(o, 0, sizeof *o);
    p = skip_ws(p);
    if (*p != '{') return NULL;
    p++;
    for (;;) {
        p = skip_ws(p);
        if (*p == '}') return p + 1;
        if (*p != '"') return NULL;
        char key[32]; int k = 0;
        p++;
        while (*p && *p != '"' && k < 31) key[k++] = *p++;
        key[k] = 0;
        if (*p != '"') return NULL;
        p++;
        p = skip_ws(p);
        if (*p != ':') return NULL;
        p = skip_ws(++p);
        if (*p == '"') {
            char val[QF_ID_CAP * 2]; int v = 0;
            p++;
            while (*p && *p != '"' && v < (int)sizeof(val) - 1) {
                if (*p == '\\' && p[1]) p++;
                val[v++] = *p++;
            }
            val[v] = 0;
            if (*p != '"') return NULL;
            p++;
            if (!strcmp(key, "op")) { snprintf(o->op, 16, "%.*s", 15, val); o->has_op = 1; }
            else if (!strcmp(key, "cell")) { snprintf(o->cell, sizeof o->cell, "%.*s", (int)sizeof(o->cell)-1, val); o->has_cell = 1; }
            else if (!strcmp(key, "from")) { snprintf(o->cell, sizeof o->cell, "%.*s", (int)sizeof(o->cell)-1, val); o->has_cell = 1; }
            else if (!strcmp(key, "to")) snprintf(o->other, sizeof o->other, "%.*s", (int)sizeof(o->other)-1, val);
            else if (!strcmp(key, "kind")) snprintf(o->kind, 16, "%.*s", 15, val);
        } else if (*p == '[') {
            p++;
            while (*p) {
                p = skip_ws(p);
                if (*p == ']') { p++; break; }
                if (*p == '"') {
                    char val[QF_ID_CAP]; int v = 0;
                    p++;
                    while (*p && *p != '"' && v < QF_ID_CAP - 1) val[v++] = *p++;
                    val[v] = 0;
                    if (*p == '"') p++;
                    if (o->n_reads < QF_MAX_READS) {
                        snprintf(o->reads[o->n_reads], QF_ID_CAP, "%s", val);
                        o->read_ptrs[o->n_reads] = o->reads[o->n_reads];
                        o->n_reads++;
                    }
                } else if (*p == ',') p++;
                else return NULL;
            }
        } else if (isdigit((unsigned char)*p) || *p == '-' || *p == '+') {
            char *end;
            long long n = strtoll(p, &end, 10);
            if (end == p) return NULL;
            p = end;
            if (!strcmp(key, "value")) { o->value = n; o->has_value = 1; }
        } else return NULL;
        p = skip_ws(p);
        if (*p == ',') { p++; continue; }
        if (*p == '}') return p + 1;
        return NULL;
    }
}

int main(void) {
    qfabric_t f; qf_init(&f);
    char line[1024];
    long n = 0, bad = 0;
    while (fgets(line, sizeof line, stdin)) {
        op_t o;
        const char *end = parse_op(line, &o);
        if (!end || !o.has_op) {
            printf("{\"op\":\"PARSE\",\"ok\":false,\"line\":%ld}\n", n + 1);
            bad++;
            continue;
        }
        char receipt[512];
        const char *cell = o.has_cell ? o.cell : "";
        const char *other = o.other[0] ? o.other : NULL;
        const char *kind = o.kind[0] ? o.kind : NULL;
        qf_op(&f, o.op, cell, other, o.has_value ? o.value : 0,
              kind, o.read_ptrs, o.n_reads, receipt, sizeof receipt);
        printf("%s\n", receipt);
        n++;
    }
    fprintf(stderr, "driver: %ld ops (%ld parse errors), tick=%llu, journal_len=%llu\n",
            n, bad, (unsigned long long)f.e.tick, (unsigned long long)f.e.journal_len);
    return bad ? 1 : 0;
}
