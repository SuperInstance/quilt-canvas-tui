/* core.c — implementation. Every opcode delegates to the quilt-c kernel;
 * this file only adds: formula-kind wiring, the op dispatcher, receipts,
 * and the FNV-1a fabric digest. */
#include "core.h"
#include <stdio.h>
#include <string.h>

uint64_t qf_fnv1a64(const uint8_t *bytes, size_t n) {
    uint64_t h = 0xcbf29ce484222325ULL;
    for (size_t i = 0; i < n; i++) {
        h ^= (uint64_t)bytes[i];
        h *= 0x100000001b3ULL;
    }
    return h;
}

void qf_gdigest(const qfabric_t *f, char hex[17]) {
    uint64_t h = qf_fnv1a64(f->journal, f->e.journal_len);
    snprintf(hex, 17, "%016llx", (unsigned long long)h);
}

static int64_t as_int(quilt_value_t v) {
    if (v.t == QUILT_V_INT) return v.u.i;
    if (v.t == QUILT_V_FLOAT) return (int64_t)v.u.f;
    if (v.t == QUILT_V_BOOL) return v.u.b ? 1 : 0;
    return 0;
}

quilt_value_t qf_eval_sum(const quilt_value_t *in, size_t n, void *u) {
    (void)u; int64_t s = 0;
    for (size_t i = 0; i < n; i++) s += as_int(in[i]);
    return quilt_v_int(s);
}
quilt_value_t qf_eval_product(const quilt_value_t *in, size_t n, void *u) {
    (void)u; int64_t s = 1;
    for (size_t i = 0; i < n; i++) s *= as_int(in[i]);
    return quilt_v_int(s);
}
quilt_value_t qf_eval_max(const quilt_value_t *in, size_t n, void *u) {
    (void)u; int64_t s = n ? as_int(in[0]) : 0;
    for (size_t i = 1; i < n; i++) { int64_t v = as_int(in[i]); if (v > s) s = v; }
    return quilt_v_int(s);
}
quilt_value_t qf_eval_min(const quilt_value_t *in, size_t n, void *u) {
    (void)u; int64_t s = n ? as_int(in[0]) : 0;
    for (size_t i = 1; i < n; i++) { int64_t v = as_int(in[i]); if (v < s) s = v; }
    return quilt_v_int(s);
}

void qf_init(qfabric_t *f) {
    memset(f, 0, sizeof *f);
    quilt_engine_init(&f->e, f->cells, QF_MAX_CELLS);
    f->e.journal = f->journal;
    f->e.journal_cap = QF_JOURNAL_CAP;
}

static int cell_slot(const qfabric_t *f, const char *id) {
    for (size_t i = 0; i < f->e.n_cells; i++)
        if (strcmp(f->e.cells[i].id, id) == 0) return (int)i;
    return -1;
}

static void esc_json(const char *s, char *out, size_t cap) {
    size_t o = 0;
    for (const char *p = s; *p && o + 2 < cap; p++) {
        if (*p == '"' || *p == '\\') out[o++] = '\\';
        out[o++] = *p;
    }
    out[o] = 0;
}

int qf_op(qfabric_t *f, const char *op,
          const char *cell, const char *other,
          int64_t value, const char *kind,
          char **reads, int n_reads,
          char *out, size_t outcap) {
    int ok = 0;
    quilt_value_t v = quilt_v_int(value);
    long version = -1;
    char cellj[64] = "";
    if (cell) { esc_json(cell, cellj, sizeof cellj); }

    if (strcmp(op, "BIND") == 0) {
        char idbuf[QF_ID_CAP];
        snprintf(idbuf, sizeof idbuf, "%s", cell);
        size_t n0 = f->e.n_cells;
        ok = quilt_bind(&f->e, idbuf, v);
        if (f->e.n_cells > n0) {
            /* a cell was just created at the tail — give it a stable id */
            size_t slot_i = f->e.n_cells - 1;
            snprintf(f->id_ring[slot_i], QF_ID_CAP, "%s", idbuf);
            f->e.cells[slot_i].id = f->id_ring[slot_i];
        }
        int slot = cell_slot(f, cell);
        if (slot >= 0) {
            version = (long)f->e.cells[slot].version;
            if (kind && strcmp(kind, "generic") != 0) {
                /* wire the formula kind into the kernel's evaluator slot */
                quilt_cell_t *c = &f->e.cells[slot];
                int nr = n_reads < QF_MAX_READS ? n_reads : QF_MAX_READS;
                for (int i = 0; i < nr; i++) {
                    snprintf(f->read_ids[slot][i], QF_ID_CAP, "%s", reads[i]);
                    f->read_ptrs[slot][i] = f->read_ids[slot][i];
                }
                c->reads = (const char **)&f->read_ptrs[slot][0];
                c->n_reads = (size_t)nr;
                if (strcmp(kind, "sum") == 0) c->eval = qf_eval_sum;
                else if (strcmp(kind, "product") == 0) c->eval = qf_eval_product;
                else if (strcmp(kind, "max") == 0) c->eval = qf_eval_max;
                else if (strcmp(kind, "min") == 0) c->eval = qf_eval_min;
                else { ok = -2; } /* unknown kind: fail closed */
            }
        }
    } else if (strcmp(op, "LINK") == 0) {
        ok = quilt_link(&f->e, cell, other);   /* LINK from=cell to=other */
    } else if (strcmp(op, "EFFECT") == 0) {
        ok = quilt_effect(&f->e, cell);
        int slot = cell_slot(f, cell);
        if (slot >= 0) version = (long)f->e.cells[slot].version;
    } else if (strcmp(op, "VIEW") == 0) {
        quilt_value_t outv;
        ok = quilt_view(&f->e, cell, &outv);
        version = as_int(outv);
    } else if (strcmp(op, "TICK") == 0) {
        version = (long)quilt_tick(&f->e);
        ok = 0;
    } else if (strcmp(op, "FORGET") == 0) {
        ok = quilt_forget(&f->e, cell);
    } else {
        snprintf(out, outcap, "{\"op\":%s,\"error\":\"UNKNOWN_OPCODE\"}", op);
        return -3;
    }

    char g[17]; qf_gdigest(f, g);
    if (strcmp(op, "VIEW") == 0)
        snprintf(out, outcap,
                 "{\"op\":\"VIEW\",\"cell\":\"%s\",\"ok\":%s,\"value\":%ld,"
                 "\"tick\":%llu,\"journal_len\":%llu,\"gdigest\":\"%s\"}",
                 cellj, ok == 0 ? "true" : "false", version,
                 (unsigned long long)f->e.tick,
                 (unsigned long long)f->e.journal_len, g);
    else
        snprintf(out, outcap,
                 "{\"op\":\"%s\",\"cell\":\"%s\",\"ok\":%s,\"version\":%ld,"
                 "\"tick\":%llu,\"journal_len\":%llu,\"gdigest\":\"%s\"}",
                 op, cellj, ok == 0 ? "true" : "false", version,
                 (unsigned long long)f->e.tick,
                 (unsigned long long)f->e.journal_len, g);
    return ok;
}
