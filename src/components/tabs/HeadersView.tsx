import type { Header } from '../../../shared/types';

export function HeadersView({ headers }: { headers: Header[] }) {
  if (!headers?.length) return <div className="p-4 text-xs text-pb-muted">暂无数据</div>;
  return (
    <table className="w-full text-xs font-mono">
      <tbody>
        {headers.map((h, i) => (
          <tr key={i} className="border-b border-pb-border/30">
            <td className="px-2 py-1 text-pb-muted align-top w-1/3 break-all">{h.name}</td>
            <td className="px-2 py-1 break-all">{h.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
