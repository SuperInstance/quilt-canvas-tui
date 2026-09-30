/* core.h — shared fabric ops for the quilt-c C TUI port.
 * Wraps quilt-c's public cell.h engine. Scalar model: one value per cell,
 * formula cells via the kernel's evaluator function-pointer slot.
 * See PORTING.md for what carries over from cell_api.py and what does not. */
#ifndef QUILT_TUI_CORE_H
#define QUILT_TUI_CORE_H

#include <quilt/cell.h>
#include <stdint.h>
#include <stddef.h>

#define QF_MAX_CELLS 64
#define QF_MAX_READS 8
#define QF_JOURNAL_CAP 8192
#define QF_ID_CAP 24

typedef struct {
    quilt_engine_t e;
    quilt_cell_t   cells[QF_MAX_CELLS];
    uint8_t        journal[QF_JOURNAL_CAP];
    /* formula-cell storage: reads ids + pointer arrays, caller-owned */
    char           read_ids[QF_MAX_CELLS][QF_MAX_READS][QF_ID_CAP];
    const char    *read_ptrs[QF_MAX_CELLS][QF_MAX_READS];
    /* stable cell-id storage: the kernel BORROWS id pointers, so the fabric
     * must own the bytes. Indexed by engine slot (<= QF_MAX_CELLS live). */
    char           id_ring[QF_MAX_CELLS][QF_ID_CAP];
} qfabric_t;

void qf_init(qfabric_t *f);
/* returns 0 on success, -1 on kernel error; fills out (outcap) with a
 * one-line JSON receipt summary */
int  qf_op(qfabric_t *f, const char *op,
           const char *cell, const char *other,     /* BIND/EFFECT/VIEW/FORGET cell; LINK from/to */
           int64_t value, const char *kind,         /* BIND value + optional formula kind */
           char **reads, int n_reads,
           char *out, size_t outcap);
/* deterministic fabric hash: FNV-1a 64 over the kernel journal bytes.
 * Same hash family the python port uses over its canonical bytes — the
 * digest ALGORITHM is the shared pin; the state model is scalar here. */
void qf_gdigest(const qfabric_t *f, char hex[17]);

/* the hash itself, exposed for the cross-port vector pin */
uint64_t qf_fnv1a64(const uint8_t *bytes, size_t n);

/* formula evaluators (kernel function-pointer kinds) */
quilt_value_t qf_eval_sum(const quilt_value_t *inputs, size_t n, void *user);
quilt_value_t qf_eval_product(const quilt_value_t *inputs, size_t n, void *user);
quilt_value_t qf_eval_max(const quilt_value_t *inputs, size_t n, void *user);
quilt_value_t qf_eval_min(const quilt_value_t *inputs, size_t n, void *user);

#endif
