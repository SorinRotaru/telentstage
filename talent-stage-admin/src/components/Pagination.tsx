interface PaginationData {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface Props {
  data: PaginationData;
  onPage: (p: number) => void;
}

function fmt(n: number) { return Number(n || 0).toLocaleString(); }

export default function Pagination({ data, onPage }: Props) {
  const { total, page, limit, totalPages } = data;
  if (total === 0) return null;
  const start = Math.min((page - 1) * limit + 1, total);
  const end = Math.min(page * limit, total);

  const pages: number[] = [];
  const startP = Math.max(1, Math.min(page - 2, totalPages - 4));
  for (let i = 0; i < Math.min(5, totalPages); i++) {
    const p = startP + i;
    if (p <= totalPages) pages.push(p);
  }

  return (
    <div className="pagination">
      <span>{fmt(start)}-{fmt(end)} of {fmt(total)}</span>
      <div className="pg-btns">
        <button className="pg-btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Prev</button>
        {pages.map(p => (
          <button key={p} className={`pg-btn ${p === page ? 'active' : ''}`} onClick={() => onPage(p)}>{p}</button>
        ))}
        <button className="pg-btn" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next ›</button>
      </div>
    </div>
  );
}
