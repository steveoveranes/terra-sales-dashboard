export default function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="card">
      <div className="placeholder">
        <h2>{title}</h2>
        <p>{note}</p>
      </div>
    </div>
  );
}
