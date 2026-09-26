/**
 * Minimal dense linear algebra for the two places we fit models in the
 * browser: ridge regression (gaze calibration) and Newton/IRLS logistic
 * regression (behavioral classifier). Matrices are small (<= ~20 x 20).
 */

export type Matrix = number[][];

export function zeros(rows: number, cols: number): Matrix {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
}

export function identity(n: number): Matrix {
  const m = zeros(n, n);
  for (let i = 0; i < n; i++) m[i][i] = 1;
  return m;
}

/** Solves A x = b for symmetric positive definite A (Cholesky), with jitter fallback. */
export function solveSPD(A: Matrix, b: number[]): number[] {
  const n = A.length;
  let jitter = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    const L = cholesky(A, jitter);
    if (L) {
      // Forward substitution: L y = b
      const y = new Array<number>(n).fill(0);
      for (let i = 0; i < n; i++) {
        let s = b[i];
        for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
        y[i] = s / L[i][i];
      }
      // Back substitution: L^T x = y
      const x = new Array<number>(n).fill(0);
      for (let i = n - 1; i >= 0; i--) {
        let s = y[i];
        for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
        x[i] = s / L[i][i];
      }
      return x;
    }
    jitter = jitter === 0 ? 1e-9 : jitter * 100;
  }
  return solveGaussian(A, b);
}

function cholesky(A: Matrix, jitter: number): Matrix | null {
  const n = A.length;
  const L = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j] + (i === j ? jitter : 0);
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 0 || !Number.isFinite(sum)) return null;
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  return L;
}

/** Gaussian elimination with partial pivoting (fallback for ill-conditioned systems). */
export function solveGaussian(A: Matrix, b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const p = M[col][col];
    if (Math.abs(p) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / p;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}

export function dot(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
